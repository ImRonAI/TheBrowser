-- The people on a project: its owner (projects.user_id) and the existing Ren accounts the owner invited by email
-- (project_members, 003; can_access_project already lets members read and write the project's issues, pages and
-- comments). A member only sees their own membership row (003's policy), so the list and the invite are security
-- definer functions that read auth.users; both check the caller first with can_access_project / owns_project,
-- which read the caller's auth.uid(). The owner removes members (003's delete policy); a member may leave.
-- Errors carry the HTTP status PostgREST answers with (SQLSTATE PTxyz).
create or replace function public.project_people(p_project uuid)
returns table(user_id uuid, name text, email text, role text, joined_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
 with people as (
   select p.user_id as person, 'owner'::text as person_role, p.created_at as joined, 0 as rank
     from public.projects p where p.id = p_project
   union all
   select m.user_id, m.role, m.created_at, 1
     from public.project_members m join public.projects p on p.id = m.project_id
    where m.project_id = p_project and m.user_id <> p.user_id
 )
 select people.person,
        coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
                 nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'Someone'),
        coalesce(u.email, '')::text, people.person_role, people.joined
   from people join auth.users u on u.id = people.person
  where public.can_access_project(p_project)
  order by people.rank, people.joined, people.person
$$;

create or replace function public.invite_project_member(p_project uuid, p_email text)
returns table(user_id uuid, name text, email text, role text, joined_at timestamptz)
language plpgsql security definer set search_path = public, auth as $$
#variable_conflict use_column
declare invitee uuid; address text := lower(trim(coalesce(p_email, '')));
begin
 if not public.owns_project(p_project) then
   raise sqlstate 'PT403' using message = 'Only the project owner can invite people';
 end if;
 if address !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
   raise sqlstate 'PT422' using message = 'Enter the email address of a Ren account';
 end if;
 select u.id into invitee from auth.users u
  where lower(u.email) = address and u.deleted_at is null
  order by u.created_at, u.id limit 1;
 if invitee is null then
   raise sqlstate 'PT404' using message = format('No Ren account uses %s', address);
 end if;
 if invitee = auth.uid() then
   raise sqlstate 'PT422' using message = 'You already own this project';
 end if;
 insert into public.project_members (project_id, user_id, role) values (p_project, invitee, 'member')
 on conflict (project_id, user_id) do nothing;
 return query select people.user_id, people.name, people.email, people.role, people.joined_at
   from public.project_people(p_project) people where people.user_id = invitee;
end $$;

revoke all on function public.project_people(uuid), public.invite_project_member(uuid, text) from public, anon;
grant execute on function public.project_people(uuid), public.invite_project_member(uuid, text) to authenticated;

drop policy if exists "Project members leave" on public.project_members;
create policy "Project members leave" on public.project_members for delete to authenticated
 using (user_id = (select auth.uid()));
