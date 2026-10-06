#!/usr/bin/env bash
# Apply supabase/migrations/*.sql that are not yet applied, in order, with psql.
# Usage: SUPABASE_DB_URL='postgresql://postgres:<db-password>@db.<ref>.supabase.co:5432/postgres?sslmode=require' \
#        deploy/apply-migrations.sh [--dry-run]
# The URL is the Dashboard's "Connection string" (Direct or Session pooler); the password is the
# database password, not an API key. Applied files are recorded in public.ron_migrations.
set -Eeuo pipefail

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "usage: SUPABASE_DB_URL=postgresql://... $0 [--dry-run]" >&2
  exit 2
fi
cd "$(dirname "$0")/.."
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

PSQL=(psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q)

"${PSQL[@]}" -c "create table if not exists public.ron_migrations (name text primary key, applied_at timestamptz not null default now());" >/dev/null

# Seed the ledger with migrations whose objects already exist (pre-ledger deploys).
"${PSQL[@]}" <<'SQL' >/dev/null
insert into public.ron_migrations(name) select m.name from (values
  ('001','projects'), ('011_harness_agents.sql','harness_agents'), ('012_songs.sql','songs'), ('013_playlists.sql','playlists')
) as m(name, tbl)
where exists (select 1 from information_schema.tables where table_schema='public' and table_name=m.tbl)
  and m.name like '%.sql'
on conflict do nothing;
SQL

applied=$("${PSQL[@]}" -At -c "select name from public.ron_migrations")
for f in supabase/migrations/*.sql; do
  name=$(basename "$f")
  if grep -qx "$name" <<<"$applied"; then continue; fi
  # Older migrations predate the ledger: skip any whose first created table already exists.
  tbl=$(grep -m1 -oiE 'create table (if not exists )?(public\.)?[a-z_]+' "$f" | awk '{print $NF}' | sed 's/public\.//')
  if [ -n "$tbl" ] && [ "$("${PSQL[@]}" -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$tbl'")" = "1" ]; then
    "${PSQL[@]}" -c "insert into public.ron_migrations(name) values ('$name') on conflict do nothing" >/dev/null
    echo "[skip] $name ($tbl exists)"; continue
  fi
  echo "[apply] $name"
  [ "$DRY" = 1 ] && continue
  "${PSQL[@]}" -1 -f "$f"
  "${PSQL[@]}" -c "insert into public.ron_migrations(name) values ('$name')" >/dev/null
done
echo "MIGRATIONS OK"
