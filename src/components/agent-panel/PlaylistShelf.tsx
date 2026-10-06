import { useCallback, useEffect, useState } from 'react'
import {
  ArrowDownIcon, ArrowUpIcon, DiscIcon, ListMusicIcon, PauseIcon, PlayIcon, PlusIcon, Repeat1Icon, RepeatIcon, ShuffleIcon,
  SkipBackIcon, SkipForwardIcon, SquareIcon, Trash2Icon, XIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupText } from '@/components/ui/button-group'
import { Badge } from '@/components/ai-elements/badge'
import {
  formatSeconds, musicAddPlaylistSongs, musicCreatePlaylist, musicDeletePlaylist, musicPlaylist, musicPlaylists, musicRemovePlaylistSong,
  musicReorderPlaylist, type MusicRequest, type Playlist, type PlaylistKind, type PlaylistSummary, type SavedSong,
} from '@/lib/music-api'
import { totalSeconds } from '@/lib/playlist'
import type { PlaylistPlayer } from './usePlaylistPlayer'
import { cn } from '@/utils/cn'

/**
 * Playlists and albums over the saved-song library, plus the continuous player's transport.
 * A playlist is an ordered list; an album is the same thing the user chose to call a release.
 * "Play" runs it in order, "Shuffle" at random; repeat off/all/one; the whole library can be
 * played or shuffled too. Editing (create, add from the library, remove, reorder) goes through
 * `/music/playlists*`, the same helpers the agent's `music_playlist_*` tools use.
 */
export function PlaylistShelf({ request, songs, player, onNotice }: {
  request: MusicRequest
  songs: SavedSong[]
  player: PlaylistPlayer
  onNotice: (text: string) => void
}) {
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([])
  const [open, setOpen] = useState<Playlist | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newKind, setNewKind] = useState<PlaylistKind>('playlist')
  const [busy, setBusy] = useState(false)

  const guard = useCallback(async (action: () => Promise<void>) => {
    setBusy(true)
    try { await action() } catch (cause) { onNotice(cause instanceof Error ? cause.message : 'Playlist request failed.') }
    finally { setBusy(false) }
  }, [onNotice])

  const load = useCallback(() => guard(async () => { setPlaylists((await musicPlaylists(request)).playlists) }), [guard, request])
  useEffect(() => { void load() }, [load])
  const openPlaylist = (id: string) => guard(async () => { setOpen(await musicPlaylist(request, id)) })
  const refreshOpen = async (updated: Playlist) => { setOpen(updated); await load() }

  const create = () => guard(async () => {
    const created = await musicCreatePlaylist(request, { title: newTitle.trim() || (newKind === 'album' ? 'New album' : 'New playlist'), kind: newKind })
    setNewTitle('')
    await refreshOpen(created)
  })
  const playList = (list: Playlist, mode: 'sequential' | 'shuffle', startId?: string) => {
    if (!list.songs.length) { onNotice('This playlist is empty. Add songs from your library first.'); return }
    player.start(list.songs, { kind: list.kind, title: list.title }, { mode, startId })
  }
  const playLibrary = (mode: 'sequential' | 'shuffle') => {
    if (!songs.length) { onNotice('No saved songs yet.'); return }
    player.start(songs, { kind: 'library', title: 'Your library' }, { mode })
  }
  const move = (list: Playlist, index: number, delta: number) => guard(async () => {
    const ids = list.songs.map((song) => song.id)
    const target = index + delta
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    await refreshOpen(await musicReorderPlaylist(request, list.id, ids))
  })

  const q = player.queue
  const now = player.current
  const inOpen = new Set(open?.songs.map((song) => song.id) ?? [])
  const addable = open ? songs.filter((song) => !inOpen.has(song.id)) : []

  return <div className="mt-3 space-y-3">
    {/* Now playing */}
    {now && player.source && <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-2 dark:border-indigo-900 dark:bg-indigo-950/30">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate"><span className="font-medium">{now.title}</span> <span className="opacity-60">· {player.source.title}{q.mode === 'shuffle' ? ' · shuffled' : ''}</span></p>
        <span className="shrink-0 tabular-nums opacity-70">{formatSeconds(player.position)} / {formatSeconds(player.duration || now.duration_seconds)}</span>
      </div>
      <input type="range" min={0} max={Math.max(1, player.duration || now.duration_seconds)} step={0.1} value={Math.min(player.position, player.duration || now.duration_seconds)}
        aria-label="Seek" className="mt-1 h-1 w-full accent-indigo-600" onChange={(event) => player.seek(Number(event.target.value))} />
      <ButtonGroup orientation="horizontal" aria-label="Playlist transport" className="mt-2">
        <Button size="icon-sm" variant="outline" aria-label="Previous" onClick={player.back}><SkipBackIcon /></Button>
        <Button size="icon-sm" variant="outline" aria-label={player.playing ? 'Pause' : 'Play'} onClick={player.toggle}>{player.playing ? <PauseIcon /> : <PlayIcon />}</Button>
        <Button size="icon-sm" variant="outline" aria-label="Next" onClick={player.skip}><SkipForwardIcon /></Button>
        <Button size="icon-sm" variant="outline" aria-label="Stop" onClick={player.stop}><SquareIcon /></Button>
        <Button size="icon-sm" variant={q.mode === 'shuffle' ? 'default' : 'outline'} aria-pressed={q.mode === 'shuffle'} aria-label="Shuffle"
          onClick={() => player.setMode(q.mode === 'shuffle' ? 'sequential' : 'shuffle')}><ShuffleIcon /></Button>
        <Button size="icon-sm" variant={q.repeat === 'off' ? 'outline' : 'default'} aria-label={`Repeat: ${q.repeat}`}
          onClick={() => player.setRepeat(q.repeat === 'off' ? 'all' : q.repeat === 'all' ? 'one' : 'off')}>{q.repeat === 'one' ? <Repeat1Icon /> : <RepeatIcon />}</Button>
        <ButtonGroupText className="bg-transparent opacity-70">{player.upcoming.length} up next</ButtonGroupText>
      </ButtonGroup>
      {player.error && <p role="status" className="mt-1 text-amber-700 dark:text-amber-300">{player.error}</p>}
    </div>}

    {/* Library-wide play */}
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={!songs.length} onClick={() => playLibrary('sequential')} aria-label="Play whole library in order"><PlayIcon />Play library</Button>
      <Button size="sm" variant="outline" disabled={!songs.length} onClick={() => playLibrary('shuffle')} aria-label="Shuffle whole library"><ShuffleIcon />Shuffle library</Button>
    </div>

    {/* Create */}
    <div className="flex items-center gap-2">
      <select value={newKind} onChange={(event) => setNewKind(event.target.value as PlaylistKind)} aria-label="New collection kind"
        className="rounded-lg border border-surface-200 bg-white/70 px-2 py-1 dark:border-surface-700 dark:bg-surface-850">
        <option value="playlist">Playlist</option><option value="album">Album</option>
      </select>
      <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder={newKind === 'album' ? 'Album title' : 'Playlist title'} aria-label="New collection title"
        className="min-w-0 flex-1 rounded-lg border border-surface-200 bg-white/70 px-2 py-1 dark:border-surface-700 dark:bg-surface-850" />
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void create()} aria-label="Create"><PlusIcon />Create</Button>
    </div>

    {/* Playlists */}
    {playlists.length > 0 && <ul aria-label="Playlists and albums" className="space-y-1.5">
      {playlists.map((item) => <li key={item.id} className={cn('flex items-center justify-between gap-2 rounded-xl border border-surface-200 px-2 py-1.5 dark:border-surface-700', open?.id === item.id && 'border-indigo-300 dark:border-indigo-700')}>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => void openPlaylist(item.id)} aria-label={`Open ${item.title}`}>
          {item.kind === 'album' ? <DiscIcon className="size-3.5 shrink-0" /> : <ListMusicIcon className="size-3.5 shrink-0" />}
          <span className="min-w-0 truncate font-medium">{item.title}</span>
          <Badge variant="secondary">{item.song_count} song{item.song_count === 1 ? '' : 's'}</Badge>
        </button>
        <ButtonGroup orientation="horizontal">
          <Button size="icon-sm" variant="outline" aria-label={`Play ${item.title}`} disabled={busy || !item.song_count} onClick={() => void guard(async () => playList(await musicPlaylist(request, item.id), 'sequential'))}><PlayIcon /></Button>
          <Button size="icon-sm" variant="outline" aria-label={`Shuffle ${item.title}`} disabled={busy || !item.song_count} onClick={() => void guard(async () => playList(await musicPlaylist(request, item.id), 'shuffle'))}><ShuffleIcon /></Button>
          <Button size="icon-sm" variant="ghost" aria-label={`Delete ${item.title}`} disabled={busy} onClick={() => void guard(async () => { await musicDeletePlaylist(request, item.id); if (open?.id === item.id) setOpen(null); await load() })}><Trash2Icon /></Button>
        </ButtonGroup>
      </li>)}
    </ul>}

    {/* Open playlist editor */}
    {open && <div className="rounded-xl border border-surface-200 p-2 dark:border-surface-700">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-medium">{open.kind === 'album' ? 'Album' : 'Playlist'} · {open.title} <span className="font-normal opacity-60">{formatSeconds(totalSeconds(open.songs))}</span></p>
        <Button size="icon-sm" variant="ghost" aria-label="Close editor" onClick={() => setOpen(null)}><XIcon /></Button>
      </div>
      <ol className="mt-2 space-y-1">
        {open.songs.map((song, index) => <li key={song.id} className={cn('flex items-center gap-2 rounded-lg px-1 py-0.5', now?.id === song.id && 'bg-indigo-50 dark:bg-indigo-950/40')}>
          <span className="w-5 shrink-0 tabular-nums opacity-60">{index + 1}</span>
          <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => playList(open, q.mode, song.id)} aria-label={`Play ${song.title} from here`}>{song.title}</button>
          <span className="tabular-nums opacity-60">{formatSeconds(song.duration_seconds)}</span>
          <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={busy || index === 0} onClick={() => void move(open, index, -1)}><ArrowUpIcon /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={busy || index === open.songs.length - 1} onClick={() => void move(open, index, 1)}><ArrowDownIcon /></Button>
          <Button size="icon-sm" variant="ghost" aria-label={`Remove ${song.title}`} disabled={busy} onClick={() => void guard(async () => refreshOpen(await musicRemovePlaylistSong(request, open.id, song.id)))}><XIcon /></Button>
        </li>)}
        {!open.songs.length && <li className="opacity-60">Empty — add songs below.</li>}
      </ol>
      {addable.length > 0 && <div className="mt-2">
        <p className="opacity-70">Add from your library</p>
        <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto">
          {addable.map((song) => <li key={song.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{song.title}</span>
            <Button size="icon-sm" variant="ghost" aria-label={`Add ${song.title}`} disabled={busy} onClick={() => void guard(async () => refreshOpen(await musicAddPlaylistSongs(request, open.id, [song.id])))}><PlusIcon /></Button>
          </li>)}
        </ul>
      </div>}
    </div>}
  </div>
}
