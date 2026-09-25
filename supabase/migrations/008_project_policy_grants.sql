-- INSERT ... RETURNING must authorize the new row directly. A STABLE helper
-- querying projects cannot see that row in the INSERT statement's snapshot.
drop policy "Projects readable by owner or member" on public.projects;
create policy "Projects readable by owner or member" on public.projects
  for select to authenticated
  using (user_id = (select auth.uid()) or public.can_access_project(id));

-- Supabase default privileges include explicit role grants, so revoking only
-- PUBLIC does not remove anon's EXECUTE permission.
revoke all on function public.can_access_project(uuid), public.owns_project(uuid),
  public.lock_project_configuration(uuid), public.next_project_issue_number(uuid)
  from public, anon;
grant execute on function public.can_access_project(uuid), public.owns_project(uuid),
  public.lock_project_configuration(uuid), public.next_project_issue_number(uuid)
  to authenticated;

-- Trigger execution does not require clients to have direct EXECUTE grants.
revoke all on function public.audit_canonical_issue(), public.validate_issue_link(),
  public.validate_project_configuration(), public.validate_canonical_issue()
  from public, anon, authenticated;

-- Anonymous clients have no project access. Explicit targets also avoid
-- evaluating authenticated-only helpers for anonymous SELECT requests.
alter policy "Projects insert by owner" on public.projects to authenticated;
alter policy "Projects update by owner" on public.projects to authenticated;