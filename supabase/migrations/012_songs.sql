-- Saved generated music. Three sources write here with the service-role key:
--   `lyria-realtime` (agent/api/core/live_music.py TakeRecorder: the Live stream recorded as WAV;
--     `timeline` = segments from each chunk's sourceMetadata, i.e. the prompts/config in effect),
--   `lyria` (agent/api/core/music_generation.py: Lyria 3.5 / Lyria 3 Clip via the Interactions API,
--     MP3; `lyrics` = output_text),
--   `elevenlabs` (ElevenLabs Music v2.5 /v1/music/detailed, MP3; `composition_plan`/`lyrics`).
-- Files live in the private `music` Storage bucket at `<owner_id>/<song_id>.<ext>`.
-- RLS lets a signed-in user read and manage only their own rows and files.
create table public.songs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(length(title) between 1 and 120),
 source text not null default 'lyria-realtime' check(source in ('lyria-realtime', 'lyria', 'elevenlabs')),
 model text not null default 'models/lyria-realtime-exp',
 duration_seconds numeric(10,3) not null check(duration_seconds >= 0),
 sample_rate integer not null default 48000,
 channels integer not null default 2 check(channels between 1 and 2),
 format text not null default 'wav' check(format in ('wav', 'mp3')),
 prompt text not null default '' check(length(prompt) <= 8000),
 lyrics text not null default '' check(length(lyrics) <= 20000),
 composition_plan jsonb not null default '{}'::jsonb check(jsonb_typeof(composition_plan) = 'object'),
 storage_path text not null unique,
 prompts jsonb not null default '[]'::jsonb check(jsonb_typeof(prompts) = 'array'),
 config jsonb not null default '{}'::jsonb check(jsonb_typeof(config) = 'object'),
 timeline jsonb not null default '[]'::jsonb check(jsonb_typeof(timeline) = 'array'),
 filtered_prompts jsonb not null default '[]'::jsonb check(jsonb_typeof(filtered_prompts) = 'array'),
 created_at timestamptz not null default now()
);
create index songs_owner on public.songs(owner_id, created_at desc);
alter table public.songs enable row level security;
create policy "Own songs" on public.songs for all to authenticated
 using (owner_id = (select auth.uid()))
 with check (owner_id = (select auth.uid()));
revoke all on public.songs from anon;
grant select, insert, update, delete on public.songs to authenticated;

-- Private bucket; files live under `<owner_id>/...` so the first path segment is the owner.
insert into storage.buckets (id, name, public) values ('music', 'music', false)
 on conflict (id) do nothing;
create policy "Own music files read" on storage.objects for select to authenticated
 using (bucket_id = 'music' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Own music files write" on storage.objects for insert to authenticated
 with check (bucket_id = 'music' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Own music files delete" on storage.objects for delete to authenticated
 using (bucket_id = 'music' and (storage.foldername(name))[1] = (select auth.uid())::text);
