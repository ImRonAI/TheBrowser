-- Personal pages: a page with no project belongs to the person who wrote it ("My documents" in the Documents
-- library, ron://documents). Only its author sees it, and the pages nested under it are that author's personal
-- pages too. A page joins a project, or moves to another one, only through public.move_document: the pages under
-- it move with it, it leaves its parent, and its issue links and conversations stay (their policies defer to this
-- table's). Errors carry the HTTP status PostgREST answers with (SQLSTATE PTxyz).
alter table public.project_documents alter column project_id drop not null;

create or replace function public.validate_project_document() returns trigger
language plpgsql set search_path = public as $$
declare ancestor uuid; depth integer := 0;
begin
 if tg_op = 'INSERT' then
   new.version := 1;
   new.created_by := auth.uid();
   new.created_at := now();
 else
   if new.id <> old.id or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
     raise sqlstate 'PT422' using message = 'Document identity is immutable';
   end if;
   -- move_document sets this for its own transaction only; a direct update cannot leave the subtree behind.
   if new.project_id is distinct from old.project_id and coalesce(current_setting('ron.document_move', true), '') <> 'on' then
     raise sqlstate 'PT422' using message = 'Move pages with move_document';
   end if;
   new.version := old.version + 1;
 end if;
 new.updated_at := now();
 if new.parent_id is not null then
   if not exists (select 1 from public.project_documents p where p.id = new.parent_id
                  and p.project_id is not distinct from new.project_id
                  and (new.project_id is not null or p.created_by = new.created_by)) then
     raise sqlstate 'PT422' using message = case when new.project_id is null
       then 'Parent page must be one of your personal pages' else 'Parent page must belong to the same project' end;
   end if;
   ancestor := new.parent_id;
   while ancestor is not null loop
     if ancestor = new.id then raise sqlstate 'PT422' using message = 'A page cannot be nested under itself'; end if;
     depth := depth + 1;
     if depth > 50 then raise sqlstate 'PT422' using message = 'Pages are nested too deeply'; end if;
     select parent_id into ancestor from public.project_documents where id = ancestor;
   end loop;
 end if;
 return new;
end $$;
revoke all on function public.validate_project_document() from public, anon, authenticated;

drop policy if exists "Project documents by project access" on public.project_documents;
drop policy if exists "Project pages by project access, personal pages by their author" on public.project_documents;
create policy "Project pages by project access, personal pages by their author" on public.project_documents
 for all to authenticated
 using (case when project_id is null then created_by = (select auth.uid()) else public.can_access_project(project_id) end)
 with check (case when project_id is null then created_by = (select auth.uid()) else public.can_access_project(project_id) end);

-- Security invoker: the caller must see the page and its subtree, and RLS checks every moved row.
create or replace function public.move_document(p_document uuid, p_project uuid) returns public.project_documents
language plpgsql security invoker set search_path = public as $$
declare page public.project_documents; child record;
begin
 select * into page from public.project_documents where id = p_document;
 if not found then
   raise sqlstate 'PT404' using message = 'Document not found or not accessible';
 end if;
 if p_project is null or not public.can_access_project(p_project) then
   raise sqlstate 'PT403' using message = 'Project not accessible';
 end if;
 if page.project_id is not distinct from p_project then
   raise sqlstate 'PT422' using message = 'The page is already in that project';
 end if;
 perform set_config('ron.document_move', 'on', true);
 update public.project_documents set project_id = p_project, parent_id = null where id = p_document returning * into page;
 -- Parent first, so each page's parent is already in the project when the trigger checks it.
 for child in
   with recursive subtree(id, depth) as (
     select d.id, 1 from public.project_documents d where d.parent_id = p_document
     union all
     select d.id, s.depth + 1 from public.project_documents d join subtree s on d.parent_id = s.id where s.depth < 100
   ) select subtree.id from subtree order by subtree.depth, subtree.id
 loop
   update public.project_documents set project_id = p_project where id = child.id;
 end loop;
 perform set_config('ron.document_move', 'off', true);
 return page;
end $$;
revoke all on function public.move_document(uuid, uuid) from public, anon;
grant execute on function public.move_document(uuid, uuid) to authenticated;
