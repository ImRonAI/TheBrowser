-- Phase 1: Add projects table and extend tasks table with project_id

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  project_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own projects"
  ON projects FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX idx_projects_user_id ON projects(user_id);

-- Extend tasks table
ALTER TABLE IF EXISTS public.tasks ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;
do $$
begin
  if to_regclass('public.tasks') is not null then
    create index if not exists idx_tasks_project_id on public.tasks(project_id);
  end if;
end $$;
