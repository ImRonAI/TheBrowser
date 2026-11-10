-- An issue's Context: what the user collected with the Context widget (links, articles, search results,
-- notes, highlighted text, chat threads, project pages, screenshots, screen recordings, images, videos,
-- files) and sent to this issue. Each entry is {id, kind, title, content (Markdown), url, files[],
-- images[], source, added, attachedAt}; `files` reference objects in the private `issue-attachments`
-- bucket (019). Stored on the issue row, so it follows the issue's RLS, optimistic version and audit
-- trail exactly like `work_products`.
alter table public.issues add column if not exists context jsonb not null default '[]'::jsonb;
alter table public.issues drop constraint if exists issues_context_is_array;
alter table public.issues add constraint issues_context_is_array check (jsonb_typeof(context) = 'array');
