-- Corrective migration for Zustand/Supabase SDK compliance audit findings.

create extension if not exists "pgcrypto";

-- Normalize legacy/new projects schema drift from migrations 001 and 003.
alter table public.projects add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.projects add column if not exists owner_id uuid references auth.users(id);
alter table public.projects add column if not exists key text;
alter table public.projects add column if not exists type text;
alter table public.projects add column if not exists summary text;
alter table public.projects add column if not exists settings jsonb not null default '{"allowCrossProjectParents": false}';
alter table public.projects add column if not exists created_at timestamptz not null default now();
alter table public.projects add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects' and column_name = 'project_key'
  ) then
    update public.projects set key = coalesce(key, project_key) where key is null;
  end if;
end $$;

update public.projects
set key = coalesce(
  key,
  nullif(upper(left(regexp_replace(coalesce(name, ''), '[^A-Za-z0-9]', '', 'g'), 4)), '') || '-' || left(replace(id::text, '-', ''), 8),
  replace(id::text, '-', '')
)
where key is null;
update public.projects set type = 'software-development' where type is null;
update public.projects set settings = '{"allowCrossProjectParents": false}' where settings is null;
update public.projects set owner_id = user_id where owner_id is null and user_id is not null;

alter table public.projects alter column key set not null;
alter table public.projects alter column type set not null;
alter table public.projects alter column settings set not null;

create unique index if not exists idx_projects_user_key on public.projects(user_id, key);
create index if not exists idx_projects_user_id on public.projects(user_id);

alter table public.projects enable row level security;

drop policy if exists "Users manage own projects" on public.projects;
drop policy if exists "Projects readable by owner or member" on public.projects;
drop policy if exists "Projects insert by owner" on public.projects;
drop policy if exists "Projects update by owner or member" on public.projects;

create policy "Projects readable by owner or member"
  on public.projects for select
  using (
    auth.uid() is not null
    and (
      user_id = auth.uid()
      or exists (
        select 1 from public.project_members m
        where m.project_id = id and m.user_id = auth.uid()
      )
    )
  );

create policy "Projects insert by owner"
  on public.projects for insert
  with check (auth.uid() is not null and user_id = auth.uid());

create policy "Projects update by owner or member"
  on public.projects for update
  using (
    auth.uid() is not null
    and (
      user_id = auth.uid()
      or exists (
        select 1 from public.project_members m
        where m.project_id = id and m.user_id = auth.uid()
      )
    )
  )
  with check (
    auth.uid() is not null
    and (
      user_id = auth.uid()
      or exists (
        select 1 from public.project_members m
        where m.project_id = id and m.user_id = auth.uid()
      )
    )
  );

-- Verify legacy tasks table security if that table exists in this database.
alter table if exists public.tasks add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table if exists public.tasks enable row level security;

do $$
begin
  if to_regclass('public.tasks') is not null then
    create index if not exists idx_tasks_project_id on public.tasks(project_id);
  end if;
end $$;

do $$
begin
  if to_regclass('public.tasks') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'tasks' and column_name = 'user_id'
    ) then
      drop policy if exists "Tasks readable by owner" on public.tasks;
      drop policy if exists "Tasks insert by owner" on public.tasks;
      drop policy if exists "Tasks update by owner" on public.tasks;
      drop policy if exists "Tasks delete by owner" on public.tasks;

      create policy "Tasks readable by owner"
        on public.tasks for select
        using (auth.uid() is not null and user_id = auth.uid());

      create policy "Tasks insert by owner"
        on public.tasks for insert
        with check (auth.uid() is not null and user_id = auth.uid());

      create policy "Tasks update by owner"
        on public.tasks for update
        using (auth.uid() is not null and user_id = auth.uid())
        with check (auth.uid() is not null and user_id = auth.uid());

      create policy "Tasks delete by owner"
        on public.tasks for delete
        using (auth.uid() is not null and user_id = auth.uid());
    elsif exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'tasks' and column_name = 'project_id'
    ) then
      drop policy if exists "Tasks readable by project access" on public.tasks;
      drop policy if exists "Tasks insert by project access" on public.tasks;
      drop policy if exists "Tasks update by project access" on public.tasks;
      drop policy if exists "Tasks delete by project access" on public.tasks;

      create policy "Tasks readable by project access"
        on public.tasks for select
        using (
          auth.uid() is not null
          and exists (
            select 1 from public.projects p
            where p.id = project_id and p.user_id = auth.uid()
          )
        );

      create policy "Tasks insert by project access"
        on public.tasks for insert
        with check (
          auth.uid() is not null
          and exists (
            select 1 from public.projects p
            where p.id = project_id and p.user_id = auth.uid()
          )
        );

      create policy "Tasks update by project access"
        on public.tasks for update
        using (
          auth.uid() is not null
          and exists (
            select 1 from public.projects p
            where p.id = project_id and p.user_id = auth.uid()
          )
        )
        with check (
          auth.uid() is not null
          and exists (
            select 1 from public.projects p
            where p.id = project_id and p.user_id = auth.uid()
          )
        );

      create policy "Tasks delete by project access"
        on public.tasks for delete
        using (
          auth.uid() is not null
          and exists (
            select 1 from public.projects p
            where p.id = project_id and p.user_id = auth.uid()
          )
        );
    end if;
  end if;
end $$;
