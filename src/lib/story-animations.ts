/**
 * Swap animations for Discover story slots.
 *
 * Six reversible motions, each defined once as `from` (how a new card enters)
 * and `to` (how the old card leaves). Playing a slot "backwards" (previous
 * arrow) uses the exact reverse: the card enters along the old exit path and
 * leaves along the old entry path, with a mirrored cubic-bezier.
 *
 * Every clipPath uses the same `inset(a b c d round r)` shape so framer-motion
 * can interpolate it; `REST` carries every animated key so all six variants
 * settle on identical resting values. Transitions live inside the variant
 * targets because AnimatePresence only re-reads exiting children via `custom`.
 *
 * Pure module: no React, no app imports — runnable under `node --test`.
 */
import type { Target, Transition, Variants } from 'framer-motion'

export type SwapAnimationName = 'fall' | 'disintegrate' | 'flip' | 'slideOver' | 'crumple' | 'iris'

export const SWAP_ANIMATIONS: readonly SwapAnimationName[] = ['fall', 'disintegrate', 'flip', 'slideOver', 'crumple', 'iris']

export type SwapDirection = 1 | -1

export interface SwapCustom {
  name: SwapAnimationName
  direction: SwapDirection
  reducedMotion: boolean
}

/** Exactly one slot advances per tick. */
export const ROTATE_EVERY_MS = 5 * 60_000

export const REST = {
  x: 0, y: 0, rotate: 0, rotateY: 0, scale: 1, skewX: 0, opacity: 1,
  filter: 'blur(0px) saturate(1)',
  clipPath: 'inset(0% 0% 0% 0% round 16px)',
} satisfies Target

export type Ease = [number, number, number, number]

export interface SwapSpec {
  from: Target
  to: Target
  duration: number
  ease: Ease
}

export const SPECS: Record<SwapAnimationName, SwapSpec> = {
  fall: {
    from: { y: -140, rotate: -6, opacity: 0 },
    to: { y: 240, rotate: 10, opacity: 0 },
    duration: 0.55, ease: [0.55, 0, 1, 0.45],
  },
  disintegrate: {
    from: { scale: 0.94, opacity: 0, filter: 'blur(12px) saturate(0.3)', clipPath: 'inset(0% 42% 0% 42% round 16px)' },
    to: { scale: 1.06, y: -12, opacity: 0, filter: 'blur(14px) saturate(0.2)', clipPath: 'inset(42% 0% 42% 0% round 16px)' },
    duration: 0.6, ease: [0.4, 0, 0.6, 1],
  },
  flip: {
    from: { rotateY: -90, scale: 0.96, opacity: 0 },
    to: { rotateY: 90, scale: 0.96, opacity: 0 },
    duration: 0.5, ease: [0.2, 0.8, 0.2, 1],
  },
  slideOver: {
    from: { x: '110%', rotate: 2, opacity: 1 },
    to: { x: '-110%', rotate: -2, opacity: 0.6 },
    duration: 0.5, ease: [0.16, 1, 0.3, 1],
  },
  crumple: {
    from: { scale: 0.2, rotate: 25, skewX: 12, opacity: 0 },
    to: { scale: 0.1, rotate: -30, skewX: -18, y: 40, opacity: 0 },
    duration: 0.5, ease: [0.7, 0, 0.84, 0],
  },
  iris: {
    from: { clipPath: 'inset(50% 0% 50% 0% round 16px)', opacity: 0 },
    to: { clipPath: 'inset(50% 50% 50% 50% round 999px)', scale: 0.9, opacity: 0 },
    duration: 0.55, ease: [0.83, 0, 0.17, 1],
  },
}

/** FNV-1a 32-bit, unsigned. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function pickAnimation(seed: number): SwapAnimationName {
  return SWAP_ANIMATIONS[Math.abs(Math.trunc(seed)) % SWAP_ANIMATIONS.length]
}

export function reverseEase([x1, y1, x2, y2]: Ease): Ease {
  const round = (value: number) => Math.round(value * 1e4) / 1e4
  return [round(1 - x2), round(1 - y2), round(1 - x1), round(1 - y1)]
}

export function reverseOf(spec: SwapSpec): SwapSpec {
  return { ...spec, from: spec.to, to: spec.from, ease: reverseEase(spec.ease) }
}

export function resolveSpec(custom: SwapCustom): SwapSpec {
  const spec = SPECS[custom.name]
  return custom.direction === -1 ? reverseOf(spec) : spec
}

export function swapTransition(custom: SwapCustom): Transition {
  if (custom.reducedMotion) return { duration: 0 }
  const { duration, ease } = resolveSpec(custom)
  return { duration, ease }
}

export const swapVariants: Variants = {
  initial: (c: SwapCustom) => (c.reducedMotion ? { opacity: 0 } : resolveSpec(c).from),
  animate: (c: SwapCustom) => ({ ...(c.reducedMotion ? { opacity: 1 } : REST), transition: swapTransition(c) }),
  exit: (c: SwapCustom) => ({ ...(c.reducedMotion ? { opacity: 0 } : resolveSpec(c).to), transition: swapTransition(c) }),
}

/** Round-robin: the slot after `lastSlot`, wrapping; `-1` starts at slot 0. */
export function nextSlotToRotate(lastSlot: number, slotCount: number): number {
  if (slotCount <= 0) return 0
  return (lastSlot + 1 + slotCount) % slotCount
}

const TILTS = [-0.9, -0.5, 0.5, 0.9] as const

export function cardTilt(seed: string): number {
  return TILTS[hashString(seed) % TILTS.length]
}

export type StickerHue = 'amber' | 'rose' | 'emerald' | 'sky' | 'violet'

const HUES: readonly StickerHue[] = ['amber', 'rose', 'emerald', 'sky', 'violet']

export function stickerHue(seed: string): StickerHue {
  return HUES[hashString(seed) % HUES.length]
}
