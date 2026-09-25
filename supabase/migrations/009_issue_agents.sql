-- Private per-user, per-canonical-issue conversations. No legacy task binding.
create table public.issue_agents (
 id uuid primary key default gen_random_uuid(),
 issue_id uuid not null references public.issues(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 provider text not null,
 model_id text not null,
 created_at timestamptz not null default now(),
 unique(issue_id, user_id)
);
create table public.issue_agent_runs (
 id uuid primary key default gen_random_uuid(),
 agent_id uuid not null references public.issue_agents(id) on delete cascade,
 message text not null check(length(message) between 1 and 20000),
 output text not null default '',
 status text not null default 'running' check(status in ('running','completed','failed','canceled','interrupted')),
 error text,
 created_at timestamptz not null default now(),
 finished_at timestamptz
);
create unique index issue_agent_one_active_run on public.issue_agent_runs(agent_id) where status = 'running';
create index issue_agent_runs_history on public.issue_agent_runs(agent_id, created_at);
create index issue_agents_user on public.issue_agents(user_id);
create table public.issue_agent_blobs (
 agent_id uuid not null references public.issue_agents(id) on delete cascade,
 key text not null check(length(key) between 1 and 1024),
 payload text not null,
 primary key(agent_id, key)
);
alter table public.issue_agents enable row level security;
alter table public.issue_agent_runs enable row level security;
alter table public.issue_agent_blobs enable row level security;
create policy "Private accessible issue agent" on public.issue_agents for all to authenticated
 using (user_id = (select auth.uid()) and exists(select 1 from public.issues i where i.id = issue_id))
 with check (user_id = (select auth.uid()) and exists(select 1 from public.issues i where i.id = issue_id));
create policy "Private accessible issue runs" on public.issue_agent_runs for all to authenticated
 using (exists(select 1 from public.issue_agents a where a.id = agent_id))
 with check (exists(select 1 from public.issue_agents a where a.id = agent_id));
create policy "Private accessible issue snapshots" on public.issue_agent_blobs for all to authenticated
 using (exists(select 1 from public.issue_agents a where a.id = agent_id))
 with check (exists(select 1 from public.issue_agents a where a.id = agent_id));
revoke all on public.issue_agents, public.issue_agent_runs, public.issue_agent_blobs from anon;
grant select, insert, update, delete on public.issue_agents, public.issue_agent_runs, public.issue_agent_blobs to authenticated;

-- Claim conversation + run atomically. The partial unique index arbitrates races.
create function public.start_issue_agent_run(p_issue uuid, p_provider text, p_model text, p_message text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare a public.issue_agents; r public.issue_agent_runs;
begin
 insert into public.issue_agents(issue_id, user_id, provider, model_id)
 values(p_issue, auth.uid(), p_provider, p_model)
 on conflict(issue_id, user_id) do update set issue_id = excluded.issue_id
 returning * into a;
 insert into public.issue_agent_runs(agent_id, message) values(a.id, p_message) returning * into r;
 return jsonb_build_object('agent', to_jsonb(a), 'run', to_jsonb(r));
end $$;
create function public.put_issue_agent_blob(p_agent uuid, p_key text, p_payload text)
returns void language sql security invoker set search_path = public as $$
 insert into public.issue_agent_blobs(agent_id, key, payload) values(p_agent, p_key, p_payload)
 on conflict(agent_id, key) do update set payload = excluded.payload;
$$;
revoke all on function public.start_issue_agent_run(uuid,text,text,text), public.put_issue_agent_blob(uuid,text,text) from public, anon;
grant execute on function public.start_issue_agent_run(uuid,text,text,text), public.put_issue_agent_blob(uuid,text,text) to authenticated;