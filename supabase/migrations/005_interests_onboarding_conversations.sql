-- Phase 5: Core app tables for interests, onboarding, and chat persistence

create extension if not exists "pgcrypto";

-- Interests
create table if not exists public.interests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  weight numeric not null default 0.5,
  category text not null,
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_interests_user_id on public.interests(user_id);
create index if not exists idx_interests_user_weight on public.interests(user_id, weight desc);

-- Interest connections
create table if not exists public.interest_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  from_interest_id uuid not null references public.interests(id) on delete cascade,
  to_interest_id uuid not null references public.interests(id) on delete cascade,
  strength numeric not null default 0.5,
  created_at timestamptz not null default now(),
  unique (user_id, from_interest_id, to_interest_id)
);

create index if not exists idx_interest_connections_user_id on public.interest_connections(user_id);
create index if not exists idx_interest_connections_from_id on public.interest_connections(from_interest_id);
create index if not exists idx_interest_connections_to_id on public.interest_connections(to_interest_id);

-- Onboarding answers
create table if not exists public.onboarding_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  answer text not null,
  question_index integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_onboarding_answers_user_id on public.onboarding_answers(user_id);
create index if not exists idx_onboarding_answers_user_question_index on public.onboarding_answers(user_id, question_index);

-- Conversations
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  system_prompt text,
  context jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz
);

create index if not exists idx_conversations_user_id on public.conversations(user_id);
create index if not exists idx_conversations_user_last_message on public.conversations(user_id, last_message_at desc);

-- Messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  tool_uses jsonb,
  model text,
  tokens_input integer,
  tokens_output integer,
  stop_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_conversation_id on public.messages(conversation_id);
create index if not exists idx_messages_user_id on public.messages(user_id);
create index if not exists idx_messages_created_at on public.messages(created_at desc);

-- RLS
alter table public.interests enable row level security;
alter table public.interest_connections enable row level security;
alter table public.onboarding_answers enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Interests policies
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'interests' and policyname = 'Interests select own'
  ) then
    create policy "Interests select own" on public.interests
      for select using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'interests' and policyname = 'Interests insert own'
  ) then
    create policy "Interests insert own" on public.interests
      for insert with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'interests' and policyname = 'Interests update own'
  ) then
    create policy "Interests update own" on public.interests
      for update using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'interests' and policyname = 'Interests delete own'
  ) then
    create policy "Interests delete own" on public.interests
      for delete using (user_id = auth.uid());
  end if;
end $$;

-- Interest connections policies
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'interest_connections' and policyname = 'Interest connections select own'
  ) then
    create policy "Interest connections select own" on public.interest_connections
      for select using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'interest_connections' and policyname = 'Interest connections insert own'
  ) then
    create policy "Interest connections insert own" on public.interest_connections
      for insert with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'interest_connections' and policyname = 'Interest connections update own'
  ) then
    create policy "Interest connections update own" on public.interest_connections
      for update using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'interest_connections' and policyname = 'Interest connections delete own'
  ) then
    create policy "Interest connections delete own" on public.interest_connections
      for delete using (user_id = auth.uid());
  end if;
end $$;

-- Onboarding answers policies
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onboarding_answers' and policyname = 'Onboarding answers select own'
  ) then
    create policy "Onboarding answers select own" on public.onboarding_answers
      for select using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onboarding_answers' and policyname = 'Onboarding answers insert own'
  ) then
    create policy "Onboarding answers insert own" on public.onboarding_answers
      for insert with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onboarding_answers' and policyname = 'Onboarding answers update own'
  ) then
    create policy "Onboarding answers update own" on public.onboarding_answers
      for update using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onboarding_answers' and policyname = 'Onboarding answers delete own'
  ) then
    create policy "Onboarding answers delete own" on public.onboarding_answers
      for delete using (user_id = auth.uid());
  end if;
end $$;

-- Conversations policies
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conversations' and policyname = 'Conversations select own'
  ) then
    create policy "Conversations select own" on public.conversations
      for select using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conversations' and policyname = 'Conversations insert own'
  ) then
    create policy "Conversations insert own" on public.conversations
      for insert with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conversations' and policyname = 'Conversations update own'
  ) then
    create policy "Conversations update own" on public.conversations
      for update using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conversations' and policyname = 'Conversations delete own'
  ) then
    create policy "Conversations delete own" on public.conversations
      for delete using (user_id = auth.uid());
  end if;
end $$;

-- Messages policies
-- Restrict reads/writes to rows owned by auth.uid and tied to conversations the user owns.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'messages' and policyname = 'Messages select own'
  ) then
    create policy "Messages select own" on public.messages
      for select using (
        user_id = auth.uid()
        and exists (
          select 1 from public.conversations c
          where c.id = conversation_id and c.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'messages' and policyname = 'Messages insert own'
  ) then
    create policy "Messages insert own" on public.messages
      for insert with check (
        user_id = auth.uid()
        and exists (
          select 1 from public.conversations c
          where c.id = conversation_id and c.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'messages' and policyname = 'Messages update own'
  ) then
    create policy "Messages update own" on public.messages
      for update using (
        user_id = auth.uid()
        and exists (
          select 1 from public.conversations c
          where c.id = conversation_id and c.user_id = auth.uid()
        )
      ) with check (
        user_id = auth.uid()
        and exists (
          select 1 from public.conversations c
          where c.id = conversation_id and c.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'messages' and policyname = 'Messages delete own'
  ) then
    create policy "Messages delete own" on public.messages
      for delete using (
        user_id = auth.uid()
        and exists (
          select 1 from public.conversations c
          where c.id = conversation_id and c.user_id = auth.uid()
        )
      );
  end if;
end $$;
