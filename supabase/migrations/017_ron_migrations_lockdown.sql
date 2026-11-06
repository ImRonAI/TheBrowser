-- public.ron_migrations is deploy/apply-migrations.sh's ledger. Only that script uses it, over a direct
-- Postgres connection as the table owner (postgres), which row level security does not restrict.
-- It was created without RLS and with Supabase's default grants, so anon and authenticated could read,
-- insert, update, delete and truncate it through the Data API. Close it to the API entirely.
alter table public.ron_migrations enable row level security;
revoke all on public.ron_migrations from anon, authenticated;
