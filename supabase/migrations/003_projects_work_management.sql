-- Phase 3: Projects + Issues core schema (Jira-like)

create extension if not exists "pgcrypto";

-- Projects (extend existing table if present)
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_id uuid references auth.users(id),
  key text not null,
  name text not null,
  type text not null,
  summary text,
  settings jsonb not null default '{"allowCrossProjectParents": false}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

alter table public.projects add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.projects add column if not exists owner_id uuid references auth.users(id);
alter table public.projects add column if not exists key text;
alter table public.projects add column if not exists type text;
alter table public.projects add column if not exists summary text;
alter table public.projects add column if not exists settings jsonb not null default '{"allowCrossProjectParents": false}';
alter table public.projects add column if not exists created_at timestamptz not null default now();
alter table public.projects add column if not exists updated_at timestamptz not null default now();

-- Backfill key from legacy project_key if present
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'projects' and column_name = 'project_key') then
    update public.projects set key = project_key where key is null and project_key is not null;
  end if;
end $$;

create unique index if not exists idx_projects_user_key on public.projects(user_id, key);
create index if not exists idx_projects_user_id on public.projects(user_id);

-- Issues
create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id uuid references public.issues(id) on delete set null,
  type text not null,
  title text not null,
  description text,
  status text not null,
  priority text not null,
  estimate numeric,
  assignees uuid[] not null default '{}',
  labels text[] not null default '{}',
  start_date timestamptz,
  end_date timestamptz,
  due_date timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rank numeric not null default 0
);

create index if not exists idx_issues_project_id on public.issues(project_id);
create index if not exists idx_issues_parent_id on public.issues(parent_id);

-- Issue links
create table if not exists public.issue_links (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.issues(id) on delete cascade,
  target_id uuid not null references public.issues(id) on delete cascade,
  type text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_issue_links_source on public.issue_links(source_id);
create index if not exists idx_issue_links_target on public.issue_links(target_id);

-- Activity log (audit)
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  issue_id uuid references public.issues(id) on delete set null,
  actor_id uuid references auth.users(id),
  actor_name text,
  actor_type text not null default 'user',
  action text not null,
  field text,
  old_value text,
  new_value text,
  timestamp timestamptz not null default now()
);

create index if not exists idx_activity_project on public.activity_log(project_id);
create index if not exists idx_activity_issue on public.activity_log(issue_id);

-- Project members (future-proof governance)
create table if not exists public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create index if not exists idx_project_members_project on public.project_members(project_id);
create index if not exists idx_project_members_user on public.project_members(user_id);

-- RLS
alter table public.projects enable row level security;
alter table public.issues enable row level security;
alter table public.issue_links enable row level security;
alter table public.activity_log enable row level security;
alter table public.project_members enable row level security;

-- Projects policies
create policy "Projects readable by owner or member"
  on public.projects for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.project_members m
      where m.project_id = id and m.user_id = auth.uid()
    )
  );

create policy "Projects insert by owner"
  on public.projects for insert
  with check (user_id = auth.uid());

create policy "Projects update by owner or member"
  on public.projects for update
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.project_members m
      where m.project_id = id and m.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.project_members m
      where m.project_id = id and m.user_id = auth.uid()
    )
  );

-- Issues policies
create policy "Issues readable by project access"
  on public.issues for select
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id
      and (
        p.user_id = auth.uid()
        or exists (
          select 1 from public.project_members m
          where m.project_id = p.id and m.user_id = auth.uid()
        )
      )
    )
  );

create policy "Issues insert by project access"
  on public.issues for insert
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
      and (
        p.user_id = auth.uid()
        or exists (
          select 1 from public.project_members m
          where m.project_id = p.id and m.user_id = auth.uid()
        )
      )
    )
  );

create policy "Issues update by project access"
  on public.issues for update
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id
      and (
        p.user_id = auth.uid()
        or exists (
          select 1 from public.project_members m
          where m.project_id = p.id and m.user_id = auth.uid()
        )
      )
    )
  );

-- Issue links policies
create policy "Issue links readable by project access"
  on public.issue_links for select
  using (
    exists (
      select 1 from public.issues i
      join public.projects p on p.id = i.project_id
      where i.id = source_id
      and (
        p.user_id = auth.uid()
        or exists (
          select 1 from public.project_members m
          where m.project_id = p.id and m.user_id = auth.uid()
        )
      )
    )
  );

create policy "Issue links insert by project access"
  on public.issue_links for insert
  with check (
    exists (
      select 1 from public.issues i
      join public.projects p on p.id = i.project_id
      where i.id = source_id
      and (
        p.user_id = auth.uid()
        or exists (
          select 1 from public.project_members m
          where m.project_id = p.id and m.user_id = auth.uid()
        )
      )
    )
  );

create policy "Issue links delete by project access"
  on public.issue_links for delete
  using (
    exists (
      select 1 from public.issues i
      join public.projects p on p.id = i.project_id
      where i.id = source_id
      and (
        p.user_id = auth.uid()
        or exists (
          select 1 from public.project_members m
          where m.project_id = p.id and m.user_id = auth.uid()
        )
      )
    )
  );

-- Activity log policies
create policy "Activity readable by project access"
  on public.activity_log for select
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id
      and (
        p.user_id = auth.uid()
        or exists (
          select 1 from public.project_members m
          where m.project_id = p.id and m.user_id = auth.uid()
        )
      )
    )
  );

create policy "Activity insert by project access"
  on public.activity_log for insert
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
      and (
        p.user_id = auth.uid()
        or exists (
          select 1 from public.project_members m
          where m.project_id = p.id and m.user_id = auth.uid()
        )
      )
    )
  );

-- Project members policies
create policy "Project members readable by project access"
  on public.project_members for select
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
    )
    or user_id = auth.uid()
  );

create policy "Project members insert by owner"
  on public.project_members for insert
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
    )
  );

create policy "Project members delete by owner"
  on public.project_members for delete
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
    )
  );
