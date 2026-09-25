-- A conversation cannot be rebound to another canonical issue/account/model.
create function public.enforce_issue_agent_binding() returns trigger
language plpgsql set search_path = public as $$
begin
 if new.id <> old.id or new.issue_id <> old.issue_id or new.user_id <> old.user_id
    or new.provider <> old.provider or new.model_id <> old.model_id then
   raise exception 'Task agent identity and model are immutable';
 end if;
 return new;
end $$;
create trigger issue_agent_binding before update on public.issue_agents
 for each row execute function public.enforce_issue_agent_binding();
revoke all on function public.enforce_issue_agent_binding() from public, anon, authenticated;