-- Specialist agents built with strands_harness create_harness. `config` is the harness's portable
-- agent config (normalize_harness_agent_config output). The Ron API writes with the service-role key
-- and filters by owner_id; RLS lets a signed-in user read and manage only their own rows.
create table public.harness_agents (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 80),
 description text not null default '' check(length(description) <= 4000),
 config jsonb not null check(jsonb_typeof(config) = 'object'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(owner_id, name)
);
create index harness_agents_owner on public.harness_agents(owner_id, updated_at desc);
create function public.touch_harness_agent() returns trigger language plpgsql set search_path = public as $$
begin
 new.updated_at = now();
 return new;
end $$;
create trigger touch_harness_agent before update on public.harness_agents
 for each row execute function public.touch_harness_agent();
alter table public.harness_agents enable row level security;
create policy "Own harness agents" on public.harness_agents for all to authenticated
 using (owner_id = (select auth.uid()))
 with check (owner_id = (select auth.uid()));
revoke all on public.harness_agents from anon;
grant select, insert, update, delete on public.harness_agents to authenticated;
