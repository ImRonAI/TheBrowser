-- Project documents: Confluence-style pages on a project's Docs tab, and their links to issues. A page belongs to one project and
-- may nest under another page of the same project (parent_id); deleting a page deletes its child pages.
-- `content` is the HTML the issue-description editor (NotionEditor / Tiptap) produces, including
-- workflow blocks. Access mirrors issues: anyone who can access the project (owner or member,
-- public.can_access_project) can read, create, edit and delete its pages. The Ron API calls PostgREST
-- with the signed-in user's JWT, so these policies are the authority. Edits are optimistic: the API
-- patches `where version = <expected>` and the trigger increments it.
create table public.project_documents (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 parent_id uuid references public.project_documents(id) on delete cascade,
 title text not null default 'Untitled' check(length(trim(title)) between 1 and 300),
 content text not null default '' check(length(content) <= 2000000),
 version integer not null default 1,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(parent_id is null or parent_id <> id)
);
create index project_documents_project on public.project_documents(project_id, created_at, id);
create index project_documents_parent on public.project_documents(parent_id);

create function public.validate_project_document() returns trigger
language plpgsql set search_path = public as $$
declare ancestor uuid; depth integer := 0;
begin
 if tg_op = 'INSERT' then
   new.version := 1;
   new.created_by := auth.uid();
   new.created_at := now();
 else
   if new.id <> old.id or new.project_id <> old.project_id or new.created_by is distinct from old.created_by
      or new.created_at <> old.created_at then
     raise exception 'Document identity is immutable';
   end if;
   new.version := old.version + 1;
 end if;
 new.updated_at := now();
 if new.parent_id is not null then
   if not exists (select 1 from public.project_documents p where p.id = new.parent_id and p.project_id = new.project_id) then
     raise exception 'Parent page must belong to the same project';
   end if;
   ancestor := new.parent_id;
   while ancestor is not null loop
     if ancestor = new.id then raise exception 'A page cannot be nested under itself'; end if;
     depth := depth + 1;
     if depth > 50 then raise exception 'Pages are nested too deeply'; end if;
     select parent_id into ancestor from public.project_documents where id = ancestor;
   end loop;
 end if;
 return new;
end $$;
revoke all on function public.validate_project_document() from public, anon, authenticated;
create trigger project_document_rules before insert or update on public.project_documents
 for each row execute function public.validate_project_document();

alter table public.project_documents enable row level security;
create policy "Project documents by project access" on public.project_documents for all to authenticated
 using (public.can_access_project(project_id))
 with check (public.can_access_project(project_id));
revoke all on public.project_documents from anon;
grant select, insert, update, delete on public.project_documents to authenticated;

-- A page relates to issues: in its own project or in any other project the user can access (issue
-- links cross projects the same way). One row per (page, issue); deleting either end deletes the link.
-- Links are created and deleted, never edited. Both ends must be visible to the caller: the page through
-- its project, the issue through its project.
create table public.document_issue_links (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.project_documents(id) on delete cascade,
 issue_id uuid not null references public.issues(id) on delete cascade,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 unique (document_id, issue_id)
);
create index document_issue_links_issue on public.document_issue_links(issue_id);

create function public.stamp_document_issue_link() returns trigger
language plpgsql set search_path = public as $$
begin
 new.created_by := auth.uid();
 new.created_at := now();
 return new;
end $$;
revoke all on function public.stamp_document_issue_link() from public, anon, authenticated;
create trigger document_issue_link_stamp before insert on public.document_issue_links
 for each row execute function public.stamp_document_issue_link();

alter table public.document_issue_links enable row level security;
create policy "Document issue links by access to both ends" on public.document_issue_links for all to authenticated
 using (exists (select 1 from public.project_documents d where d.id = document_id)
    and exists (select 1 from public.issues i where i.id = issue_id))
 with check (exists (select 1 from public.project_documents d where d.id = document_id)
    and exists (select 1 from public.issues i where i.id = issue_id));
revoke all on public.document_issue_links from anon;
grant select, insert, delete on public.document_issue_links to authenticated;
