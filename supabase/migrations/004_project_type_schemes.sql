-- Phase 4: Global Project Type Schemes and Issue Types

create table if not exists public.project_type_schemes (
  key text primary key,
  label text not null,
  description text,
  issue_types text[] not null default '{}',
  board_issue_types text[] not null default '{}',
  statuses text[] not null default '{}',
  estimate_unit text not null default 'points',
  is_discovery boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.issue_types (
  key text primary key,
  label text not null,
  level integer not null,
  color text,
  parent_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.issue_rank (
  issue_id uuid primary key references public.issues(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id uuid references public.issues(id) on delete set null,
  rank numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_issue_rank_project on public.issue_rank(project_id);
create index if not exists idx_issue_rank_parent on public.issue_rank(parent_id);

alter table public.project_type_schemes enable row level security;
alter table public.issue_types enable row level security;
alter table public.issue_rank enable row level security;

create policy "Project type schemes readable by authenticated"
  on public.project_type_schemes for select
  using (auth.uid() is not null);

create policy "Issue types readable by authenticated"
  on public.issue_types for select
  using (auth.uid() is not null);

create policy "Issue rank readable by project access"
  on public.issue_rank for select
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

create policy "Issue rank insert by project access"
  on public.issue_rank for insert
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

create policy "Issue rank update by project access"
  on public.issue_rank for update
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

-- Seed issue types
insert into public.issue_types (key, label, level, color, parent_type)
values
  ('initiative', 'Initiative', 1, 'emerald', 'epic'),
  ('epic', 'Epic', 2, 'blue', 'story'),
  ('story', 'Story', 3, 'violet', 'task'),
  ('task', 'Task', 4, 'amber', 'subtask'),
  ('subtask', 'Subtask', 5, 'slate', null)
on conflict (key) do nothing;

-- Seed project type schemes
insert into public.project_type_schemes (key, label, description, issue_types, board_issue_types, statuses, estimate_unit, is_discovery)
values
  ('software-development', 'Software Development', 'Ship software with a structured delivery workflow.',
    array['initiative','epic','story','task','subtask'], array['task','story'],
    array['backlog','in-progress','review','blocked','done'], 'points', false),
  ('work-operations', 'Work (Operations)', 'Operational work and cross-functional execution.',
    array['initiative','epic','story','task','subtask'], array['task'],
    array['backlog','in-progress','review','blocked','done'], 'hours', false),
  ('founder', 'Founder', 'Strategic initiatives, fundraising, and company building.',
    array['initiative','epic','story','task','subtask'], array['task','story'],
    array['backlog','in-progress','review','blocked','done'], 'effort', false),
  ('academic', 'Academic', 'Research, coursework, and academic project work.',
    array['initiative','epic','story','task','subtask'], array['task'],
    array['backlog','in-progress','review','blocked','done'], 'hours', false),
  ('research', 'Research', 'Research tracks, experiments, and analysis.',
    array['initiative','epic','story','task','subtask'], array['story','task'],
    array['backlog','in-progress','review','blocked','done'], 'effort', false),
  ('data-accrual', 'Data Accrual', 'Data collection and pipeline build-out.',
    array['initiative','epic','story','task','subtask'], array['task'],
    array['backlog','in-progress','review','blocked','done'], 'items', false),
  ('personal-goals', 'Personal Goals', 'Personal milestones and structured self-management.',
    array['initiative','epic','story','task','subtask'], array['task'],
    array['backlog','in-progress','review','blocked','done'], 'effort', false),
  ('product-discovery', 'Product Discovery', 'Discovery workflow. Specialized hierarchy coming in PRD 2.',
    array['initiative','epic','story','task','subtask'], array['story','task'],
    array['backlog','in-progress','review','blocked','done'], 'effort', true)
on conflict (key) do nothing;
