import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EMPTY_QUEUE, createQueue, currentId, jumpTo, next, previous, setMode, setRepeat, upcoming,
  type PlayMode, type QueueState, type RepeatMode,
} from '@/lib/playlist'
import type { SavedSong } from '@/lib/music-api'

/**
 * Continuous playback of saved songs (a playlist/album or the whole library) through one
 * `<audio>` element: when a track ends the queue advances and the next signed URL loads,
 * in order or shuffled, with repeat off/all/one. Separate from the Lyria stream (Web Audio)
 * and the voice sink, so starting a playlist never touches the live music or barge-in.
 *
 * Signed URLs expire after an hour; `refresh` lets the deck re-fetch the song list when a
 * load fails, and the player retries once with the refreshed URL.
 */
export interface PlaylistPlayer {
  queue: QueueState
  current: SavedSong | null
  playing: boolean
  /** Source label shown in the deck header. */
  source: { kind: 'playlist' | 'album' | 'library'; title: string } | null
  position: number
  duration: number
  error: string
  start: (songs: SavedSong[], source: PlaylistPlayer['source'], options?: { mode?: PlayMode; startId?: string }) => void
  toggle: () => void
  skip: () => void
  back: () => void
  jump: (id: string) => void
  setMode: (mode: PlayMode) => void
  setRepeat: (repeat: RepeatMode) => void
  seek: (seconds: number) => void
  setVolume: (value: number) => void
  stop: () => void
  upcoming: SavedSong[]
}

export function usePlaylistPlayer(refresh?: () => Promise<SavedSong[]>): PlaylistPlayer {
  const audio = useRef<HTMLAudioElement | null>(null)
  const songs = useRef(new Map<string, SavedSong>())
  const retried = useRef<string | null>(null)
  const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE)
  const [source, setSource] = useState<PlaylistPlayer['source']>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')
  const queueRef = useRef(queue)
  queueRef.current = queue

  // One element for the hook's lifetime; never attached to the DOM.
  useEffect(() => {
    const element = new Audio()
    element.preload = 'auto'
    audio.current = element
    const onEnded = () => setQueue((q) => next(q, 'ended'))
    const onTime = () => setPosition(element.currentTime)
    const onMeta = () => setDuration(Number.isFinite(element.duration) ? element.duration : 0)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onError = () => {
      const id = currentId(queueRef.current)
      if (id && refresh && retried.current !== id) {
        retried.current = id
        void refresh().then((fresh) => {
          for (const song of fresh) songs.current.set(song.id, song)
          const url = songs.current.get(id)?.signed_url
          if (url) { element.src = url; void element.play().catch(() => undefined) }
        })
        return
      }
      setError('This song could not be played.')
      setQueue((q) => next(q, 'skip'))
    }
    element.addEventListener('ended', onEnded)
    element.addEventListener('timeupdate', onTime)
    element.addEventListener('loadedmetadata', onMeta)
    element.addEventListener('play', onPlay)
    element.addEventListener('pause', onPause)
    element.addEventListener('error', onError)
    return () => {
      element.pause()
      element.removeAttribute('src')
      element.load()
      element.removeEventListener('ended', onEnded)
      element.removeEventListener('timeupdate', onTime)
      element.removeEventListener('loadedmetadata', onMeta)
      element.removeEventListener('play', onPlay)
      element.removeEventListener('pause', onPause)
      element.removeEventListener('error', onError)
      audio.current = null
    }
  }, [refresh])

  // Load whatever the queue points at; `repeat: one` re-plays the same src on `ended`.
  const current = useMemo(() => { const id = currentId(queue); return id ? songs.current.get(id) ?? null : null }, [queue])
  const lastLoaded = useRef<{ id: string | null; token: number }>({ id: null, token: 0 })
  useEffect(() => {
    const element = audio.current
    if (!element) return
    const id = currentId(queue)
    if (!id) { element.pause(); element.removeAttribute('src'); element.load(); setPosition(0); setDuration(0); return }
    const song = songs.current.get(id)
    if (!song?.signed_url) { setError('This song has no playable file.'); setQueue((q) => next(q, 'skip')); return }
    if (lastLoaded.current.id === id && queue.repeat === 'one' && element.ended) { element.currentTime = 0 }
    else if (lastLoaded.current.id !== id || element.src !== song.signed_url) { element.src = song.signed_url; lastLoaded.current = { id, token: lastLoaded.current.token + 1 } }
    setError('')
    void element.play().catch(() => setPlaying(false))
  }, [queue])

  const start = useCallback<PlaylistPlayer['start']>((list, from, options) => {
    songs.current = new Map(list.map((song) => [song.id, song]))
    retried.current = null
    lastLoaded.current = { id: null, token: 0 }
    setSource(from)
    setQueue(createQueue(list.map((song) => song.id), { mode: options?.mode ?? queueRef.current.mode, repeat: queueRef.current.repeat, startId: options?.startId }))
  }, [])

  const toggle = useCallback(() => {
    const element = audio.current
    if (!element || !currentId(queueRef.current)) return
    if (element.paused) void element.play().catch(() => setPlaying(false))
    else element.pause()
  }, [])

  const stop = useCallback(() => { setQueue((q) => ({ ...q, cursor: -1 })); setSource(null) }, [])

  return {
    queue, current, playing, source, position, duration, error,
    start, toggle, stop,
    skip: useCallback(() => setQueue((q) => next(q, 'skip')), []),
    back: useCallback(() => {
      const element = audio.current
      // Standard transport: restart the track when past 3 s, otherwise go to the previous one.
      if (element && element.currentTime > 3) { element.currentTime = 0; return }
      setQueue((q) => previous(q))
    }, []),
    jump: useCallback((id: string) => setQueue((q) => jumpTo(q, id)), []),
    setMode: useCallback((mode: PlayMode) => setQueue((q) => setMode(q, mode)), []),
    setRepeat: useCallback((repeat: RepeatMode) => setQueue((q) => setRepeat(q, repeat)), []),
    seek: useCallback((seconds: number) => { if (audio.current) audio.current.currentTime = seconds }, []),
    setVolume: useCallback((value: number) => { if (audio.current) audio.current.volume = Math.max(0, Math.min(1, value)) }, []),
    upcoming: useMemo(() => upcoming(queue).map((id) => songs.current.get(id)).filter((song): song is SavedSong => Boolean(song)), [queue]),
  }
}
