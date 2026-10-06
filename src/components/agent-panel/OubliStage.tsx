import { useCallback, useEffect, useRef } from 'react'
import { Oubli, type OubliHandle } from './Oubli'
import { useMascotStore } from '@/stores/mascotStore'
import { useLiveMusicStore } from '@/stores/liveMusicStore'
import { MOVER_H, shouldPeek, type MascotInputs } from '@/lib/mascot'
import { cn } from '@/utils/cn'

/** CSS px per stage unit: the figure is MOVER_H (380) units tall, so 0.5 draws him 190 px tall. */
export const PINNED_SCALE = 0.5
export const COMPACT_SCALE = 0.36
export const PEEK_SCALE = 0.38

/**
 * Oubli in the Agent Panel. Reads the mascot store (flags published by Chat and
 * Live) and the two analyser taps, and peeks out whenever Ron is being asked
 * anything, is working, speaking, or performing; otherwise he tucks down to the
 * panel's bottom edge so the conversation keeps the room.
 *
 * The stage spans the panel's width so he has room to wander, flee the cursor and be
 * thrown; `scale` sets his size. `pinned` keeps him fully out (the Live view, where he is
 * the presence).
 */
export function OubliStage({ pinned = false, scale, className }: { pinned?: boolean; scale?: number; className?: string }) {
  const handle = useRef<OubliHandle | null>(null)
  const asking = useMascotStore((s) => s.asking)
  const processing = useMascotStore((s) => s.processing)
  const liveOpen = useMascotStore((s) => s.liveOpen)
  const musicOn = useMascotStore((s) => s.musicOn)
  const speaking = useLiveMusicStore((s) => s.playing) // music audible counts as "performing"
  const subscribeThought = useMascotStore((s) => s.subscribeThought)

  useEffect(() => subscribeThought((event) => {
    const rig = handle.current
    if (!rig) return
    if (event.kind === 'delta') rig.think(event.text)
    else if (event.kind === 'settle') rig.settle()
    else rig.clear()
  }), [subscribeThought])

  const source = useCallback((): Omit<MascotInputs, 'pointer' | 'stageWidth'> => {
    const s = useMascotStore.getState()
    return {
      voice: s.voiceTap?.() ?? null,
      music: s.musicOn ? (s.musicTap?.() ?? null) : null,
      thinking: s.thinking,
      working: s.working,
      genre: s.genre,
      bpm: s.bpm,
    }
  }, [])

  const voiceSpeaking = useMascotStore((s) => s.voiceTap !== null) && liveOpen
  const visible = pinned || shouldPeek({ asking, processing, speaking: speaking || voiceSpeaking, music: musicOn, liveOpen })
  const figureScale = scale ?? (pinned ? PINNED_SCALE : PEEK_SCALE)
  const figureHeight = MOVER_H * figureScale
  // Out: the whole figure (so running, kicking and flailing all read). Tucked: a thin strip, just
  // the antenna bulb shows above the composer.
  const frameHeight = visible ? figureHeight : Math.round(figureHeight * 0.12)
  return <div className={cn('oubli-frame relative w-full transition-[height] duration-500', !visible && 'overflow-hidden', className)} style={{ height: frameHeight }}>
    <div className="absolute inset-x-0 bottom-0">
      <Oubli ref={handle} source={source} visible={visible} scale={figureScale} />
    </div>
  </div>
}
