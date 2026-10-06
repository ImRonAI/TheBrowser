-- Playlists and albums over saved songs (012_songs.sql). A playlist is an ordered list of songs; an
-- album is the same structure flagged `kind = 'album'` (a curated, titled release the user assembled).
-- Ordering lives in playlist_songs.position; the renderer plays entries sequentially or shuffled.
-- The Ron API writes with the service-role key filtered by owner_id; RLS lets a signed-in user read and
-- manage only their own playlists. Deleting a song removes it from every playlist (cascade).
create table public.playlists (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 kind text not null default 'playlist' check(kind in ('playlist', 'album')),
 title text not null check(length(title) between 1 and 120),
 description text not null default '' check(length(description) <= 2000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index playlists_owner on public.playlists(owner_id, updated_at desc);
create function public.touch_playlist() returns trigger language plpgsql set search_path = public as $$
begin
 new.updated_at = now();
 return new;
end $$;
create trigger touch_playlist before update on public.playlists
 for each row execute function public.touch_playlist();
alter table public.playlists enable row level security;
create policy "Own playlists" on public.playlists for all to authenticated
 using (owner_id = (select auth.uid()))
 with check (owner_id = (select auth.uid()));
revoke all on public.playlists from anon;
grant select, insert, update, delete on public.playlists to authenticated;

create table public.playlist_songs (
 playlist_id uuid not null references public.playlists(id) on delete cascade,
 song_id uuid not null references public.songs(id) on delete cascade,
 position integer not null check(position >= 0),
 added_at timestamptz not null default now(),
 primary key (playlist_id, song_id)
);
create index playlist_songs_order on public.playlist_songs(playlist_id, position);
alter table public.playlist_songs enable row level security;
create policy "Own playlist songs" on public.playlist_songs for all to authenticated
 using (exists (select 1 from public.playlists p where p.id = playlist_id and p.owner_id = (select auth.uid())))
 with check (exists (select 1 from public.playlists p where p.id = playlist_id and p.owner_id = (select auth.uid())));
revoke all on public.playlist_songs from anon;
grant select, insert, update, delete on public.playlist_songs to authenticated;
