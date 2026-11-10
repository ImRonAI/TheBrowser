-- Files attached to issues from the Context widget (screenshots, screen recordings, images, videos,
-- other files). Private bucket; objects live under `<project_id>/<issue_id>/<file>`, so the first
-- path segment names the project and access follows the project (owner or member), exactly like the
-- issue rows themselves. The issue's `context` entry (020) references the object path; the renderer
-- reads it with a short-lived signed URL under the viewer's own session.
insert into storage.buckets (id, name, public, file_size_limit)
 values ('issue-attachments', 'issue-attachments', false, 104857600)
 on conflict (id) do nothing;

create policy "Issue attachments read" on storage.objects for select to authenticated
 using (bucket_id = 'issue-attachments'
   and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and public.can_access_project(((storage.foldername(name))[1])::uuid));
create policy "Issue attachments write" on storage.objects for insert to authenticated
 with check (bucket_id = 'issue-attachments'
   and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and public.can_access_project(((storage.foldername(name))[1])::uuid));
create policy "Issue attachments delete" on storage.objects for delete to authenticated
 using (bucket_id = 'issue-attachments'
   and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and public.can_access_project(((storage.foldername(name))[1])::uuid));
