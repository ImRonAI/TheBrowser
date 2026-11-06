-- Ask Ron conversations on a project page (the Document Agent, panel runtime destination "document").
-- Each row is one saved conversation: private to the user who had it, tied to the page it was about
-- (deleting the page deletes its conversations), like issue_agents for issues. The messages themselves
-- are the native Strands session snapshot of `session_id` in the panel session storage; this table is
-- the page's index of them. They are not threads and never appear in the Agent Panel's thread list.
-- `session_id` is assigned here (`doc-<id>`), never by the client, so a row cannot point at another
-- session. A conversation started in Goal mode keeps that goal for its whole life (session options are
-- immutable), so the renderer starts a new conversation when the mode changes.
create table public.document_conversations (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.project_documents(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 session_id text not null unique,
 title text not null check(length(trim(title)) between 1 and 200),
 goal boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(session_id = 'doc-' || id::text)
);
create index document_conversations_mine on public.document_conversations(document_id, user_id, updated_at desc);

create function public.stamp_document_conversation() returns trigger
language plpgsql set search_path = public as $$
begin
 if tg_op = 'INSERT' then
   new.user_id := auth.uid();
   new.session_id := 'doc-' || new.id::text;
   new.created_at := now();
 elsif new.id <> old.id or new.document_id <> old.document_id or new.user_id <> old.user_id
       or new.session_id <> old.session_id or new.goal <> old.goal or new.created_at <> old.created_at then
   raise exception 'Conversation identity is immutable';
 end if;
 new.updated_at := now();
 return new;
end $$;
revoke all on function public.stamp_document_conversation() from public, anon, authenticated;
create trigger document_conversation_stamp before insert or update on public.document_conversations
 for each row execute function public.stamp_document_conversation();

alter table public.document_conversations enable row level security;
create policy "Own conversations on accessible pages" on public.document_conversations for all to authenticated
 using (user_id = (select auth.uid()) and exists (select 1 from public.project_documents d where d.id = document_id))
 with check (user_id = (select auth.uid()) and exists (select 1 from public.project_documents d where d.id = document_id));
revoke all on public.document_conversations from anon;
grant select, insert, update, delete on public.document_conversations to authenticated;
