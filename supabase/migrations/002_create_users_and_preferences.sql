-- Create users and user_preferences tables (auth-backed profiles + preferences)

create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  avatar_url text,
  tenant_id uuid not null,
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  theme text not null default 'system',
  interaction_mode text not null default 'type',
  search_mode text not null default 'ai-web',
  content_density text not null default 'comfortable',
  show_animations boolean not null default true,
  reduce_motion boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists idx_users_tenant_id on public.users(tenant_id);
create index if not exists idx_user_preferences_user_id on public.user_preferences(user_id);

alter table public.users enable row level security;
alter table public.user_preferences enable row level security;

create policy "Users read own profile"
  on public.users for select
  using (auth.uid() = id);

create policy "Users insert own profile"
  on public.users for insert
  with check (auth.uid() = id);

create policy "Users update own profile"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users read own preferences"
  on public.user_preferences for select
  using (auth.uid() = user_id);

create policy "Users insert own preferences"
  on public.user_preferences for insert
  with check (auth.uid() = user_id);

create policy "Users update own preferences"
  on public.user_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
