-- Threads: a read model of the native Strands session (SnapshotSessionManager) for the UI.
-- The SDK snapshot under the user's HF storage is the source of truth; `agent/api/core/threads.py`
-- projects it here on every snapshot save (ThreadProjection hook) so a signed-in user can list their
-- threads and read them in sequential order from any device. Both agent kinds (Chat `Agent`, Live
-- `BidiAgent`) share one thread per `session_id` through the same native agent_id; `last_agent` records
-- which one wrote last, and `browser` which browser the current run drives (`cloud` after a takeover).
create table public.threads (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 session_id text not null check(length(session_id) between 1 and 128),
 destination text not null default 'panel' check(destination in ('panel', 'search', 'build')),
 title text not null default '' check(length(title) <= 200),
 last_agent text not null default 'chat' check(last_agent in ('chat', 'live')),
 browser text not null default 'user' check(browser in ('user', 'cloud')),
 message_count integer not null default 0 check(message_count >= 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (owner_id, session_id)
);
create index threads_owner_updated on public.threads(owner_id, updated_at desc);
alter table public.threads enable row level security;
create policy "Own threads" on public.threads for all to authenticated
 using (owner_id = (select auth.uid()))
 with check (owner_id = (select auth.uid()));
revoke all on public.threads from anon;
grant select, insert, update, delete on public.threads to authenticated;

-- One row per native message in `agent.messages`, in order. `kind` names what the row carries:
-- user_prompt | assistant_output | reasoning | tool_call | tool_result (one row per content block type
-- present in the message; a message holding both reasoning and text yields two rows with the same seq).
create table public.thread_messages (
 id uuid primary key default gen_random_uuid(),
 thread_id uuid not null references public.threads(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 seq integer not null check(seq >= 0),
 role text not null check(role in ('user', 'assistant')),
 kind text not null check(kind in ('user_prompt', 'assistant_output', 'reasoning', 'tool_call', 'tool_result')),
 agent text not null default 'chat' check(agent in ('chat', 'live')),
 content jsonb not null default '[]'::jsonb check(jsonb_typeof(content) = 'array'),
 created_at timestamptz not null default now(),
 unique (thread_id, seq, kind)
);
create index thread_messages_order on public.thread_messages(thread_id, seq);
alter table public.thread_messages enable row level security;
create policy "Own thread messages" on public.thread_messages for all to authenticated
 using (owner_id = (select auth.uid()))
 with check (owner_id = (select auth.uid()));
revoke all on public.thread_messages from anon;
grant select, insert, update, delete on public.thread_messages to authenticated;
