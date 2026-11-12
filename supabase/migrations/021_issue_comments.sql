-- Comments on project issues: where the team discusses an issue. Anyone who can access the project (owner or
-- member, public.can_access_project) reads and writes them, and so do the agents working for them: issue agents,
-- the issue's Ren tab and project agents call the Ron API with their user's own credential, so an agent's comment
-- is that user's row marked author_kind 'agent' with the agent's name. The trigger stamps the identity (author,
-- the issue's project, a display name read from the JWT, because public.users is not populated) and never takes
-- it from the client. Afterwards only the body of a person's comment changes, version-checked like issues; agent
-- comments are never edited, only deleted. Errors carry the HTTP status PostgREST answers with (SQLSTATE PTxyz).
create table if not exists public.issue_comments (
 id uuid primary key default gen_random_uuid(),
 issue_id uuid not null references public.issues(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 author_id uuid references auth.users(id) on delete set null,
 author_name text not null default '',
 author_kind text not null default 'user' check (author_kind in ('user', 'agent')),
 agent_name text check (agent_name is null or length(trim(agent_name)) between 1 and 120),
 body text not null check (length(trim(body)) between 1 and 20000),
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 edited_at timestamptz,
 check ((author_kind = 'agent') = (agent_name is not null))
);
create index if not exists issue_comments_issue on public.issue_comments(issue_id, created_at, id);
create index if not exists issue_comments_project on public.issue_comments(project_id);

create or replace function public.stamp_issue_comment() returns trigger
language plpgsql set search_path = public as $$
declare claims jsonb;
begin
 if tg_op = 'INSERT' then
   -- The issue as the caller sees it (RLS): its project, or nothing when the caller cannot access it.
   select i.project_id into new.project_id from public.issues i where i.id = new.issue_id;
   if not found then
     raise sqlstate 'PT404' using message = 'Issue not found or not accessible';
   end if;
   claims := coalesce(auth.jwt(), '{}'::jsonb);
   new.author_id := auth.uid();
   new.author_name := left(coalesce(nullif(trim(claims #>> '{user_metadata,full_name}'), ''),
                                    nullif(trim(claims #>> '{user_metadata,name}'), ''),
                                    nullif(split_part(coalesce(claims ->> 'email', ''), '@', 1), ''), 'Someone'), 120);
   new.version := 1;
   new.created_at := now();
   new.updated_at := now();
   new.edited_at := null;
   return new;
 end if;
 -- Deleting an account clears author_id through the foreign key (a nested trigger); nothing else may change.
 if new.id <> old.id or new.issue_id <> old.issue_id or new.project_id <> old.project_id
    or new.author_name <> old.author_name or new.author_kind <> old.author_kind
    or new.agent_name is distinct from old.agent_name or new.created_at <> old.created_at
    or (new.author_id is distinct from old.author_id and not (new.author_id is null and pg_trigger_depth() > 1)) then
   raise sqlstate 'PT422' using message = 'Comment identity is immutable';
 end if;
 if new.body is distinct from old.body then
   if old.author_kind = 'agent' then
     raise sqlstate 'PT403' using message = 'Agent comments can''t be edited';
   end if;
   new.edited_at := now();
 else
   new.edited_at := old.edited_at;
 end if;
 new.version := old.version + 1;
 new.updated_at := now();
 return new;
end $$;
revoke all on function public.stamp_issue_comment() from public, anon, authenticated;
drop trigger if exists issue_comment_rules on public.issue_comments;
create trigger issue_comment_rules before insert or update on public.issue_comments
 for each row execute function public.stamp_issue_comment();

alter table public.issue_comments enable row level security;
drop policy if exists "Issue comments readable by project access" on public.issue_comments;
create policy "Issue comments readable by project access" on public.issue_comments for select to authenticated
 using (public.can_access_project(project_id));
-- Checked after the trigger has stamped project_id and author_id.
drop policy if exists "Issue comments written by project access" on public.issue_comments;
create policy "Issue comments written by project access" on public.issue_comments for insert to authenticated
 with check (public.can_access_project(project_id) and author_id = (select auth.uid()));
drop policy if exists "Issue comments edited by their author" on public.issue_comments;
create policy "Issue comments edited by their author" on public.issue_comments for update to authenticated
 using (author_id = (select auth.uid()) and public.can_access_project(project_id))
 with check (author_id = (select auth.uid()) and public.can_access_project(project_id));
drop policy if exists "Issue comments deleted by their author or the project owner" on public.issue_comments;
create policy "Issue comments deleted by their author or the project owner" on public.issue_comments for delete to authenticated
 using (public.can_access_project(project_id) and (author_id = (select auth.uid()) or public.owns_project(project_id)));
revoke all on public.issue_comments from public, anon, authenticated;
grant select, insert, update, delete on public.issue_comments to authenticated;
