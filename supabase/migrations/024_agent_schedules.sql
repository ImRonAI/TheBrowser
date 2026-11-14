-- Scheduled specialist runs (agent/api/core/agent_schedules.py).
-- `agent_schedules`: the cadence a user picked for one of their saved specialists (`harness_agents`) and when it
-- is next due. The Ren API claims a due row by moving `next_run_at` forward with a compare-and-set, so two API
-- processes never start the same occurrence.
-- `agent_runs`: one row per run. A run is a panel conversation with that specialist (`session_id` is the native
-- Strands session it ran in); the Context widget shows finished, unseen runs as notifications and opens the session
-- in the Agent Panel. The Ren API writes with the service-role key and filters by owner_id; RLS lets a signed-in user
-- read and manage only their own rows.
create table public.agent_schedules (
 agent_id uuid primary key references public.harness_agents(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 cadence jsonb not null check(jsonb_typeof(cadence) = 'object'),
 task text not null default '' check(length(task) <= 4000),
 enabled boolean not null default true,
 next_run_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index agent_schedules_due on public.agent_schedules(next_run_at) where enabled;
create index agent_schedules_owner on public.agent_schedules(owner_id);
alter table public.agent_schedules enable row level security;
create policy "Own agent schedules" on public.agent_schedules for all to authenticated
 using (owner_id = (select auth.uid()))
 with check (owner_id = (select auth.uid()));
revoke all on public.agent_schedules from anon;
grant select, insert, update, delete on public.agent_schedules to authenticated;

create table public.agent_runs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 agent_id uuid not null references public.harness_agents(id) on delete cascade,
 session_id text not null check(length(session_id) between 1 and 128),
 trigger text not null default 'schedule' check(trigger in ('schedule', 'manual')),
 status text not null default 'running'
  check(status in ('running', 'completed', 'failed', 'cancelled', 'interrupted', 'checkpointed')),
 summary text not null default '' check(length(summary) <= 2000),
 error text not null default '' check(length(error) <= 2000),
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 seen_at timestamptz,
 unique(owner_id, session_id)
);
create index agent_runs_owner on public.agent_runs(owner_id, started_at desc);
create index agent_runs_running on public.agent_runs(status) where status = 'running';
alter table public.agent_runs enable row level security;
create policy "Own agent runs" on public.agent_runs for all to authenticated
 using (owner_id = (select auth.uid()))
 with check (owner_id = (select auth.uid()));
revoke all on public.agent_runs from anon;
grant select, insert, update, delete on public.agent_runs to authenticated;
