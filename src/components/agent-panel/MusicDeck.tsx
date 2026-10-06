import { useCallback, useEffect, useMemo, useState } from 'react'
import { PauseIcon, PlayIcon, RotateCcwIcon, SaveIcon, SquareIcon, Trash2Icon, Volume2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupText } from '@/components/ui/button-group'
import {
  AudioPlayer, AudioPlayerControlBar, AudioPlayerDurationDisplay, AudioPlayerElement, AudioPlayerMuteButton,
  AudioPlayerPlayButton, AudioPlayerTimeDisplay, AudioPlayerTimeRange,
} from '@/components/ai-elements/audio-player'
import { Badge } from '@/components/ai-elements/badge'
import { getSession } from '@/api/supabase'
import { LIVE_API_BASE_URL } from '@/pages/types/api'
import {
  createMusicRequest, describeConfig, formatSeconds, musicControl, musicDeleteSong, musicDiscardTake, musicSave, musicSongs,
  SIGN_IN_MESSAGE, SOURCE_LABELS, type MusicAction, type SavedSong,
} from '@/lib/music-api'
import { musicCaption, useLiveMusicStore } from '@/stores/liveMusicStore'
import { PlaylistShelf } from './PlaylistShelf'
import { usePlaylistPlayer } from './usePlaylistPlayer'
import { cn } from '@/utils/cn'

/**
 * The Live Music deck under Oubli in the panel's Live view. Transport (Play / Pause /
 * Stop / Reset context) calls the backend's playback controls for THIS Live session
 * (`POST /music/control`, the same code path as the agent's `music_playback_control`
 * tool), so the deck and the agent never disagree about state. Volume is local to the
 * music sink. Saved songs play through the AI Elements `AudioPlayer` (media-chrome); playlists,
 * albums and the whole library play continuously (in order or shuffled) through `PlaylistShelf`.
 */
export function MusicDeck({ userId, agentId, className }: { userId: string; agentId?: string; className?: string }) {
  const deck = useLiveMusicStore()
  const { music, available, liveStatus, playing, volume, setVolume, publishTake } = deck
  const signedIn = userId !== 'default' && !userId.startsWith('guest:')
  const request = useMemo(() => createMusicRequest(LIVE_API_BASE_URL, getSession, userId), [userId])
  const [busy, setBusy] = useState<MusicAction | 'save' | 'discard' | null>(null)
  const [notice, setNotice] = useState('')
  const [title, setTitle] = useState('')
  const [songs, setSongs] = useState<SavedSong[]>([])
  const [signInRequired, setSignInRequired] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)

  const run = useCallback(async (label: MusicAction | 'save' | 'discard', action: () => Promise<unknown>) => {
    if (!signedIn) { setNotice(SIGN_IN_MESSAGE); return }
    if (!agentId) { setNotice('Connect Live first.'); return }
    setBusy(label); setNotice('')
    try { await action() } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Music deck request failed.') }
    finally { setBusy(null) }
  }, [agentId, signedIn])

  const control = (action: MusicAction) => run(action, () => musicControl(request, agentId!, action))
  const save = () => run('save', async () => {
    const result = await musicSave(request, agentId!, title)
    setNotice(`Saved “${result.title}” (${formatSeconds(result.duration_seconds)}, ${result.segments} segment${result.segments === 1 ? '' : 's'}).`)
    setTitle('')
    await loadSongs()
  })
  const discard = () => run('discard', async () => { publishTake(await musicDiscardTake(request, agentId!) as unknown as Record<string, unknown>) })

  const loadSongs = useCallback(async () => {
    try {
      const result = await musicSongs(request)
      setSongs(result.songs); setSignInRequired(result.sign_in_required)
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Could not load your songs.') }
  }, [request])
  // The continuous player re-fetches signed URLs through this when one has expired.
  const refreshSongs = useCallback(async () => { const result = await musicSongs(request); setSongs(result.songs); return result.songs }, [request])
  const player = usePlaylistPlayer(signedIn ? refreshSongs : undefined)
  // Keep the saved-song player at the deck's volume too.
  const setPlayerVolume = player.setVolume
  useEffect(() => { setPlayerVolume(volume) }, [volume, setPlayerVolume])
  useEffect(() => { if (libraryOpen && signedIn) void loadSongs() }, [libraryOpen, signedIn, loadSongs])

  const connected = music.connected && liveStatus === 'ready'
  const transportDisabled = !signedIn || !agentId || !available || busy !== null
  const chips = describeConfig(music.config)
  const takeSeconds = music.take.seconds

  return <section aria-label="Live music deck" className={cn('rounded-2xl border border-surface-200 bg-white/60 p-3 text-xs dark:border-surface-700 dark:bg-surface-850/60', className)}>
    <div className="flex items-center justify-between gap-2">
      <p role="status" className="min-w-0 truncate font-medium">{musicCaption(deck)}</p>
      <Badge variant={playing ? 'default' : 'secondary'} className="shrink-0">{connected ? music.playback : 'off'}</Badge>
    </div>

    <ButtonGroup orientation="horizontal" aria-label="Live music transport" className="mt-3">
      <Button size="icon-sm" variant="outline" aria-label="Play" disabled={transportDisabled || music.playback === 'playing'} onClick={() => void control('play')}><PlayIcon /></Button>
      <Button size="icon-sm" variant="outline" aria-label="Pause" disabled={transportDisabled || music.playback !== 'playing'} onClick={() => void control('pause')}><PauseIcon /></Button>
      <Button size="icon-sm" variant="outline" aria-label="Stop" disabled={transportDisabled || !connected} onClick={() => void control('stop')}><SquareIcon /></Button>
      <Button size="icon-sm" variant="outline" aria-label="Reset context (hard transition, keeps prompts)" disabled={transportDisabled || !connected} onClick={() => void control('reset_context')}><RotateCcwIcon /></Button>
      <ButtonGroupText className="gap-2 bg-transparent">
        <Volume2Icon className="size-3.5" aria-hidden />
        <input type="range" min={0} max={1} step={0.01} value={volume} aria-label="Music volume" className="h-1 w-24 accent-indigo-600" onChange={(event) => setVolume(Number(event.target.value))} />
      </ButtonGroupText>
    </ButtonGroup>

    {music.prompts.length > 0 && <ul aria-label="Weighted prompts" className="mt-3 flex flex-wrap gap-1.5">
      {music.prompts.map((prompt, index) => <li key={`${prompt.text}-${index}`} className="rounded-full border border-indigo-200 bg-indigo-50/70 px-2.5 py-1 dark:border-indigo-900 dark:bg-indigo-950/30">
        {prompt.text} <span className="tabular-nums opacity-60">×{prompt.weight}</span>
      </li>)}
    </ul>}
    {chips.length > 0 && <p className="mt-2 text-ink-muted dark:text-ink-inverse-muted">{chips.join(' · ')}</p>}
    {music.filtered.length > 0 && <p role="status" className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 p-2 dark:border-amber-900 dark:bg-amber-950/20">
      Lyria ignored: {music.filtered.map((item) => `“${item.text ?? '?'}” (${item.reason ?? 'filtered'})`).join(', ')}
    </p>}

    <div className="mt-3 flex items-center gap-2">
      <span className="tabular-nums text-ink-muted dark:text-ink-inverse-muted" aria-label="Recorded take">● {formatSeconds(takeSeconds)} recorded</span>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Song title" aria-label="Song title"
        className="min-w-0 flex-1 rounded-lg border border-surface-200 bg-white/70 px-2 py-1 dark:border-surface-700 dark:bg-surface-850" />
      <Button size="sm" variant="outline" disabled={!signedIn || !agentId || takeSeconds <= 0 || busy !== null} onClick={() => void save()} aria-label="Save recorded music"><SaveIcon />Save</Button>
      <Button size="icon-sm" variant="ghost" disabled={!signedIn || !agentId || takeSeconds <= 0 || busy !== null} onClick={() => void discard()} aria-label="Discard recorded take"><Trash2Icon /></Button>
    </div>
    {!signedIn && <p role="status" className="mt-2 text-ink-muted dark:text-ink-inverse-muted">{SIGN_IN_MESSAGE} Ron can still play music for you by voice.</p>}
    {notice && <p role="status" className="mt-2 whitespace-pre-wrap break-words">{notice}</p>}

    <details className="mt-3" open={libraryOpen} onToggle={(event) => setLibraryOpen((event.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer font-medium">Saved songs{songs.length ? ` · ${songs.length}` : ''}</summary>
      {signInRequired && <p className="mt-2 text-ink-muted dark:text-ink-inverse-muted">Sign in to Ron to save and replay music.</p>}
      {signedIn && libraryOpen && <PlaylistShelf request={request} songs={songs} player={player} onNotice={setNotice} />}
      <p className="mt-3 font-medium">Songs</p>
      <ul className="mt-2 space-y-3">
        {songs.map((song) => <li key={song.id} className="rounded-xl border border-surface-200 p-2 dark:border-surface-700">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate font-medium">{song.title} <span className="tabular-nums font-normal opacity-60">{formatSeconds(song.duration_seconds)}</span> <Badge variant="outline" className="ml-1 align-middle">{SOURCE_LABELS[song.source] ?? song.source}</Badge></p>
            <Button size="icon-sm" variant="ghost" aria-label={`Delete ${song.title}`} onClick={() => void run('discard', async () => { await musicDeleteSong(request, song.id); await loadSongs() })}><Trash2Icon /></Button>
          </div>
          {song.signed_url && <AudioPlayer className="mt-2">
            <AudioPlayerElement src={song.signed_url} preload="none" />
            <AudioPlayerControlBar>
              <AudioPlayerPlayButton />
              <AudioPlayerTimeDisplay />
              <AudioPlayerTimeRange />
              <AudioPlayerDurationDisplay />
              <AudioPlayerMuteButton />
            </AudioPlayerControlBar>
          </AudioPlayer>}
          {song.prompts.length > 0 && <p className="mt-1 truncate text-ink-muted dark:text-ink-inverse-muted">{song.prompts.map((p) => p.text).join(' · ')}</p>}
          {song.prompt && <p className="mt-1 truncate text-ink-muted dark:text-ink-inverse-muted">{song.prompt}</p>}
          {song.lyrics && song.lyrics !== '<instrumental>' && <details className="mt-1"><summary className="cursor-pointer text-ink-muted dark:text-ink-inverse-muted">Lyrics</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px]">{song.lyrics}</pre></details>}
        </li>)}
      </ul>
    </details>
  </section>
}
