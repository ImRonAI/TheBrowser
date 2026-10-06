/**
 * Oubli mascot: pure rig math. Ported from `docs/reference/oubli-mascot.html` with explicit types and
 * two independent audio inputs (voice drives the mouth, music drives the body),
 * so Ron talking over a track never lip-syncs the kick drum.
 *
 * No React, no DOM, no `@/` imports so `node --test` can run the colocated test.
 * `Oubli.tsx` owns the SVG and calls `stepMascot` once per animation frame.
 */

import type { WeightedPrompt } from './voice-events.ts'

export type Viseme = 'AH' | 'O' | 'EE'
export type Genre = 'electronic' | 'country' | 'rock' | 'pop' | 'rap' | 'classical'
export const GENRES: readonly Genre[] = ['electronic', 'country', 'rock', 'pop', 'rap', 'classical']

/** Three-band energy of a byte frequency spectrum (0-255 each). */
export interface Bands { low: number; mid: number; high: number }

export function bands(data: ArrayLike<number>, binHz: number): Bands {
  const sum = (a: number, b: number) => {
    let s = 0
    const i0 = Math.max(1, Math.floor(a / binHz)), i1 = Math.min(data.length - 1, Math.ceil(b / binHz))
    for (let i = i0; i <= i1; i++) s += data[i]
    return s / Math.max(1, i1 - i0 + 1)
  }
  return { low: sum(85, 500), mid: sum(500, 2200), high: sum(2200, 6000) }
}

/** Mouth opening (0-1) and vowel shape from the voice spectrum: rounded when lows dominate, wide when highs do. */
export function analyseVoice(data: ArrayLike<number>, binHz: number): { open: number; viseme: Viseme } {
  const b = bands(data, binHz)
  const total = b.low + b.mid + b.high + 1e-6
  const open = Math.min(1, (b.low + b.mid * 1.4 + b.high * 0.8) / 300)
  if (open < 0.05) return { open: 0, viseme: 'AH' }
  const lowR = b.low / total, highR = b.high / total
  return { open, viseme: lowR > 0.55 && highR < 0.18 ? 'O' : highR > 0.30 && lowR < 0.35 ? 'EE' : 'AH' }
}

/** Bass (0-1) and overall energy (0-1) of the music spectrum. */
export function analyseMusic(data: ArrayLike<number>, binHz: number): { bass: number; energy: number } {
  const b = bands(data, binHz)
  return { bass: Math.min(1, b.low / 200), energy: Math.min(1, (b.low + b.mid + b.high) / 450) }
}

// ─── Genre from Lyria prompts ────────────────────────────────────────────────

const GENRE_KEYWORDS: Record<Genre, RegExp> = {
  electronic: /\b(techno|house|edm|trance|dubstep|drum\s*(&|and)\s*bass|dnb|breakbeat|electro|synth|ambient|chiptune|glitch|psytrance|vaporwave|lo-?fi|trip\s*hop|moombahton|hyperpop|808|909|303|dj|rave|bass)\b/i,
  country: /\b(country|bluegrass|folk|banjo|fiddle|acoustic guitar|americana|western|cowboy|mandolin|dulcimer|celtic|irish)\b/i,
  rock: /\b(rock|metal|punk|grunge|shoegaze|garage|indie|shredding|distort(ed|ion)|fuzz|electric guitar|riff|blues)\b/i,
  pop: /\b(pop|disco|funk|soul|r&b|rnb|neo-?soul|synthpop|dance-?pop|ballad|vocal(s|ization)?|new jack swing|reggaeton|afrobeat|bossa nova|salsa|cumbia|latin)\b/i,
  rap: /\b(rap|hip[\s-]*hop|trap|grime|boom[\s-]*bap|drill|g-?funk)\b/i,
  classical: /\b(classical|orchestra(l)?|symphony|baroque|chamber|piano|strings|cello|violin|viola|harp|concerto|sonata|opera(tic)?|choir|score|cinematic|renaissance|waltz)\b/i,
}
/** Resolution order when several buckets match one prompt: the more specific styles win over "pop". */
const GENRE_PRIORITY: readonly Genre[] = ['rap', 'electronic', 'rock', 'country', 'classical', 'pop']

/**
 * Pick the costume for a weighted prompt set: every prompt votes for the genres its
 * text matches, weighted by its prompt weight; ties go to `GENRE_PRIORITY`. Null when
 * nothing matches (no costume; idle body).
 */
export function genreFromPrompts(prompts: readonly WeightedPrompt[]): Genre | null {
  const votes = new Map<Genre, number>()
  for (const prompt of prompts) {
    for (const genre of GENRES) if (GENRE_KEYWORDS[genre].test(prompt.text)) votes.set(genre, (votes.get(genre) ?? 0) + Math.abs(prompt.weight))
  }
  let best: Genre | null = null, bestScore = 0
  for (const genre of GENRE_PRIORITY) {
    const score = votes.get(genre) ?? 0
    if (score > bestScore) { best = genre; bestScore = score }
  }
  return best
}

// ─── Mascot state ────────────────────────────────────────────────────────────

export interface MascotInputs {
  /** Voice spectrum from the Live voice sink, null when Ron is not speaking. */
  voice: { data: ArrayLike<number>; binHz: number } | null
  /** Music spectrum from the Lyria sink, null when no music is audible. */
  music: { data: ArrayLike<number>; binHz: number } | null
  /** Gemini reported `interaction_status=in_progress` (reasoning / waiting on tools). */
  thinking: boolean
  /** A tool call is running (laptop + typing pose). */
  working: boolean
  /** Costume + dance; null = plain Oubli. */
  genre: Genre | null
  /** Beat clock in BPM; from `music_config.bpm` when set, else the fallback. */
  bpm: number
  /**
   * Pointer in stage units (reference px, see `MOVER_W`/`MOVER_H`), origin at the stage's
   * top-left; `vx`/`vy` in stage units per second; `idle` seconds since it last moved
   * (large when it left the panel). Null when the pointer was never seen.
   */
  pointer: { x: number; y: number; vx: number; vy: number; idle: number } | null
  /** Stage width in stage units; Oubli wanders, flees and bounces within it. */
  stageWidth: number
  /** Run from the cursor (the reference's `fleeEnabled`). */
  flee?: boolean
}

/**
 * Stage units are the reference mover's pixels: the figure is `MOVER_W` x `MOVER_H` and its feet
 * stand on the stage floor (`y = MOVER_H`). The renderer multiplies by one scale factor, so every
 * speed, radius and threshold below is the reference's number unchanged.
 */
export const MOVER_W = 236
export const MOVER_H = 380
/** Face centre below the mover's top edge (eye-follow and flee/catch distances are measured here). */
export const FACE_Y = 150
/** Wall margin: he never gets closer than this to a stage edge. */
export const WALL = 130

export interface SpeedLine { opacity: number; x: number; y: number }

export interface Pose {
  jumpY: number; sqX: number; sqY: number; lean: number
  headY: number; headR: number
  armL: number; armR: number; handL: number; handR: number
  footL: string; footR: string
  /** 0-1 mouth opening and current viseme; `open < 0.05` shows the resting smile. */
  open: number; viseme: Viseme
  /** Antenna bulb opacity (pulses while thinking). */
  bulb: number
  /** Pupil offsets, and the pupil scale (shrinks to .68 while he is caught). */
  pupilL: { x: number; y: number }; pupilR: { x: number; y: number }; pupilScale: number
  /** Laptop scale 0-1 (eased). */
  laptop: number
  /** Platter rotation (deg) and deck light opacities for the DJ costume. */
  platter: number; platter2: number; deckLights: number[]
  /** Mover placement in stage units: centre x, altitude above the floor, hang angle, facing (+1 right). */
  x: number; alt: number; dangle: number; facing: 1 | -1
  /** Shadow shrinks and fades with altitude. */
  shadowScale: number; shadowOpacity: number
  /** Sweat drop (running or caught) and the worried face (caught). */
  sweat: boolean; worried: boolean
  /** Three speed lines while he sprints; opacity 0 when not. */
  speedLines: SpeedLine[]
}

export interface MascotState {
  t: number
  open: number; viseme: Viseme; visHold: number
  bass: number; energy: number; beat: number; beatFlash: number
  lap: number
  hopT: number
  /** Position/physics (stage units). `x < 0` until the first step centres him on the stage. */
  x: number; vx: number; facing: 1 | -1
  alt: number; vy: number; landT: number
  fleeing: boolean; caught: boolean; catchT: number; swing: number
  wanderX: number; wanderT: number
  pose: Pose
}

export const DEFAULT_BPM = 90

export function createMascotState(): MascotState {
  return {
    t: 0, open: 0, viseme: 'AH', visHold: 0, bass: 0, energy: 0, beat: 0, beatFlash: 0, lap: 0, hopT: -9,
    x: -1, vx: 0, facing: 1, alt: 0, vy: 0, landT: -9, fleeing: false, caught: false, catchT: -9, swing: 0,
    wanderX: -1, wanderT: 0,
    pose: {
      jumpY: 0, sqX: 1, sqY: 1, lean: 0, headY: 0, headR: 0, armL: 0, armR: 0, handL: 0, handR: 0,
      footL: 'translate(0px,0px) rotate(0deg)', footR: 'translate(0px,0px) rotate(0deg)',
      open: 0, viseme: 'AH', bulb: 1, pupilL: { x: 0, y: 0 }, pupilR: { x: 0, y: 0 }, pupilScale: 1, laptop: 0,
      platter: 0, platter2: 0, deckLights: [1, 1, 1, 1, 1, 1],
      x: 0, alt: 0, dangle: 0, facing: 1, shadowScale: 1, shadowOpacity: 1, sweat: false, worried: false,
      speedLines: [{ opacity: 0, x: 0, y: 0 }, { opacity: 0, x: 0, y: 0 }, { opacity: 0, x: 0, y: 0 }],
    },
  }
}

const REST_FOOT = 'translate(0px,0px) rotate(0deg)'
const clamp = (lo: number, hi: number, v: number) => Math.max(lo, Math.min(hi, v))

/** Advance the rig by `dt` seconds and compute the pose. Mutates and returns `state`. */
export function stepMascot(state: MascotState, dt: number, input: MascotInputs, random: () => number = Math.random): MascotState {
  const step = Math.min(0.05, Math.max(0, dt))
  state.t += step
  const t = state.t
  const W = Math.max(2 * WALL + 1, input.stageWidth)
  if (state.x < 0) { state.x = W / 2; state.wanderX = W / 2 }
  state.x = clamp(WALL, W - WALL, state.x)

  // ── cursor: flee, catch, hold, throw (reference `frame`) ──
  const cursor = input.pointer
  const mouseActive = cursor !== null && cursor.idle < 2.5
  const cx = cursor?.x ?? -9999, cy = cursor?.y ?? -9999, cvx = cursor?.vx ?? 0, cvy = cursor?.vy ?? 0
  const distC = Math.hypot(cx - state.x, cy - FACE_Y)
  if (!state.caught && (input.flee ?? true) && mouseActive && distC < 180) state.fleeing = true
  else if (distC > 300 || !mouseActive) state.fleeing = false
  const curSpeed = Math.hypot(cvx, cvy)
  if (!state.caught && mouseActive && distC < 90) { state.caught = true; state.catchT = t; state.fleeing = false }
  if (state.caught) {
    // held: lifted so his feet sit at the cursor, wherever it goes
    state.x += (cx - state.x) * Math.min(1, step * 18)
    state.alt += (Math.max(0, MOVER_H - cy) - state.alt) * Math.min(1, step * 14)
    state.vx = cvx * 0.008
    const swingTarget = clamp(-22, 22, cvx * 0.02) + Math.sin(t * 7.5) * 7
    state.swing += (swingTarget - state.swing) * Math.min(1, step * 6)
    // he wriggles free after ~3 s, or a fast flick throws him
    if (t - state.catchT > 3 || curSpeed > 2600) {
      state.caught = false
      state.vx = clamp(-14, 14, cvx * 0.012)
      state.vy = clamp(-10, 16, -cvy * 0.012)
    }
  }
  if (!state.caught && (state.alt > 0 || state.vy !== 0)) {
    state.alt += state.vy * 60 * step; state.vy -= 30 * step
    if (state.alt <= 0) { state.alt = 0; if (state.vy < -4) state.landT = t; state.vy = 0 }
  }

  // ── wander + locomotion ──
  const musicOn = input.genre !== null && input.music !== null
  const stopped = input.working && !musicOn && !state.caught
  if (!state.fleeing && !stopped) {
    state.wanderT -= step
    if (state.wanderT <= 0) { state.wanderX = WALL + 20 + random() * (W - 2 * (WALL + 20)); state.wanderT = 7 + random() * 9 }
  }
  if (state.caught) { /* driven by the cursor above */ }
  else if (state.fleeing) {
    const dir = (state.x - cx) / (distC || 1)
    state.vx = clamp(-7.5, 7.5, state.vx + dir * 90 * step)
  } else if (!stopped) {
    state.vx += (Math.sign(state.wanderX - state.x) * 0.7 - state.vx) * Math.min(1, step * 2)
    if (Math.abs(state.wanderX - state.x) < 30) state.vx *= Math.pow(0.001, step)
  } else {
    state.vx *= Math.pow(0.001, step)
  }
  state.x += state.vx * 60 * step
  if (state.x < WALL) { state.x = WALL; state.vx = Math.abs(state.vx) * 0.4 }
  if (state.x > W - WALL) { state.x = W - WALL; state.vx = -Math.abs(state.vx) * 0.4 }
  const running = state.fleeing && Math.abs(state.vx) > 0.6
  if (Math.abs(state.vx) > 0.4) state.facing = state.vx > 0 ? 1 : -1
  const dangle = state.caught ? state.swing * Math.min(1, (t - state.catchT) * 4) : 0

  // ── mouth (voice tap only) ──
  let openTarget = 0, visPick: Viseme = state.viseme
  if (input.voice) { const r = analyseVoice(input.voice.data, input.voice.binHz); openTarget = r.open; visPick = r.viseme }
  state.visHold -= step * 1000
  if (visPick !== state.viseme && state.visHold <= 0) { state.viseme = visPick; state.visHold = 70 }
  state.open += (openTarget - state.open) * Math.min(1, step * 24)
  const open = state.open

  // ── music (music tap only) ──
  if (input.music) {
    const r = analyseMusic(input.music.data, input.music.binHz)
    state.bass += (r.bass - state.bass) * Math.min(1, step * 14)
    state.energy += (r.energy - state.energy) * Math.min(1, step * 8)
    state.beat += step * ((input.bpm > 0 ? input.bpm : DEFAULT_BPM) / 60)
    state.beatFlash = Math.max(Math.exp(-(state.beat % 1) * 6) * state.bass, 0)
  } else { state.bass *= 0.9; state.energy *= 0.9; state.beatFlash = 0 }

  // ── pose ──
  let jumpY = 0, sqX = 1, sqY = 1, lean = 0, headY = 0, headR = 0
  let armL = 0, armR = 0, handL = 0, handR = 0, footL = REST_FOOT, footR = REST_FOOT
  let platter = state.pose.platter, platter2 = state.pose.platter2
  let deckLights = state.pose.deckLights
  const bpm = input.bpm > 0 ? input.bpm : DEFAULT_BPM

  if (musicOn && input.genre) {
    const beat = state.beat, e = state.energy, fl = state.beatFlash
    switch (input.genre) {
      case 'electronic':
        jumpY = -6 * Math.abs(Math.sin(Math.PI * beat)) * (0.4 + e)
        headY = 6 * Math.sin(Math.PI * beat) * (0.4 + e)
        headR = 7 * Math.sin(Math.PI * beat * 0.5)
        armR = -38 + 24 * Math.sin(Math.PI * beat)
        armL = -24 + 10 * Math.sin(Math.PI * beat * 2)
        platter = t * 210; platter2 = -t * 260
        deckLights = [0, 1, 2, 3, 4, 5].map((i) => 0.15 + 0.85 * Math.abs(Math.sin(t * (bpm / 60) * Math.PI + i)) * (0.3 + fl))
        break
      case 'country':
        lean = 5 * Math.sin(Math.PI * beat * 0.5); jumpY = -4 * Math.abs(Math.sin(Math.PI * beat)) * e
        armR = 40 + 26 * Math.sin(Math.PI * beat * 2)
        headR = 6 * Math.sin(Math.PI * beat * 0.5)
        break
      case 'rock':
        headY = 12 * Math.sin(Math.PI * beat * 2) * (0.5 + e); headR = 12 * Math.sin(Math.PI * beat * 2)
        lean = -8 + 6 * Math.sin(Math.PI * beat); jumpY = -8 * Math.abs(Math.sin(Math.PI * beat)) * e
        armR = 50 + 30 * Math.sin(Math.PI * beat * 2)
        break
      case 'pop':
        jumpY = -5 * Math.abs(Math.sin(Math.PI * beat)) * e
        lean = 6 * Math.sin(Math.PI * beat * 0.5)
        armL = -50; armR = -50
        headY = 3 * Math.sin(Math.PI * beat)
        break
      case 'rap':
        jumpY = -7 * Math.abs(Math.sin(Math.PI * beat)) * (0.4 + e)
        lean = 7 * Math.sin(Math.PI * beat * 0.5)
        armR = -30 + 40 * Math.sin(Math.PI * beat)
        headR = 8 * Math.sin(Math.PI * beat)
        break
      case 'classical':
        lean = 4 * Math.sin(Math.PI * beat * 0.5)
        armR = -70 + 55 * Math.sin(Math.PI * beat); armL = -70 + 55 * Math.sin(Math.PI * beat + Math.PI * 0.5)
        headY = 3 * Math.sin(Math.PI * beat)
        break
    }
    sqY = 1 + 0.04 * fl; sqX = 2 - sqY
  } else if (state.caught) {
    const p = t * 21 // frantic flailing the whole time he is held
    const s = Math.sin(p), c = Math.cos(p * 0.9)
    jumpY = 6 * Math.sin(p * 2)
    lean = 10 * c
    sqX = 1 + 0.05 * s; sqY = 1 - 0.05 * s
    armL = -70 + 65 * s; armR = 70 - 65 * s // windmilling arms
    handL = 32 * c; handR = -32 * c
    footL = `translate(${8 * c}px,${-16 * Math.max(0, s)}px) rotate(${44 * s}deg)` // kicking
    footR = `translate(${-8 * c}px,${-16 * Math.max(0, -s)}px) rotate(${-44 * s}deg)`
    headY = 4; headR = 9 * Math.sin(t * 13) // "no no no"
  } else if (running) {
    const p = t * 17, s = Math.sin(p), f = state.facing
    jumpY = -7 * Math.abs(s); lean = f * 11
    sqX = 1 + 0.03 * Math.sin(p * 2); sqY = 1 - 0.03 * Math.sin(p * 2)
    footL = `translate(${-f * 10 * s}px,${-14 * Math.max(0, -s)}px) rotate(${30 * s}deg)`
    footR = `translate(${f * 10 * s}px,${-14 * Math.max(0, s)}px) rotate(${-30 * s}deg)`
    armL = 42 * s; armR = -42 * s; handL = 14 * s; handR = -14 * s
    headY = 3; headR = -f * 4
  } else if (input.working) {
    const p = t * 24
    armL = -46 + Math.sin(p) * 4; armR = 46 + Math.sin(p + Math.PI) * 4
    handL = Math.sin(p) * 11; handR = Math.sin(p + Math.PI) * 11
    headY = 5 + Math.sin(t * 2.2) * 1.2; headR = Math.sin(t * 1.3) * 1.5
    lean = Math.sin(t * 0.8) * 0.8
  } else {
    if (t - state.hopT > 6 + random() * 3) state.hopT = t
    const hp = (t - state.hopT) / 0.55
    if (hp < 1) { jumpY = -36 * Math.sin(Math.PI * hp); sqY = 1 + 0.06 * Math.sin(Math.PI * hp); sqX = 2 - sqY }
    lean = Math.sin(t * 0.6) * 1.6
    armL = Math.sin(t * 0.9) * 4; armR = -Math.sin(t * 0.9 + 0.5) * 4
    headR = Math.sin(t * 0.5) * 2
  }

  // landing squash after a throw
  const lt = (t - state.landT) / 0.3
  if (lt >= 0 && lt < 1 && !state.caught) { const k = Math.sin(lt * Math.PI); sqY *= 1 - 0.16 * k; sqX *= 1 + 0.12 * k }

  // laptop eases in while working (never while he is being carried around)
  state.lap += ((stopped ? 1 : 0) - state.lap) * Math.min(1, step * 7)
  const laptop = state.lap > 0.02 ? Math.max(0.001, state.lap * (1 + 0.18 * Math.sin(Math.min(1, state.lap) * Math.PI))) : 0

  // bulb + pupils
  const bulb = input.thinking && !state.caught ? 0.25 + 0.75 * Math.abs(Math.sin(t * 3.2)) : 1
  let pupilL = { x: 0, y: 0 }, pupilR = { x: 0, y: 0 }, pupilScale = 1
  if (state.caught) {
    const dx = Math.sin(t * 17) * 7, dy = 4 + Math.cos(t * 15) * 3
    pupilL = { x: dx, y: dy }; pupilR = { x: dx * 0.8, y: dy * 0.8 }; pupilScale = 0.68
  } else if (input.thinking) {
    const glance = Math.sin(t * 0.7) * 4
    pupilL = { x: glance, y: -9 }; pupilR = { x: glance * 0.8, y: -9 }
  } else if (stopped) {
    pupilL = { x: -3, y: 9 }; pupilR = { x: -1, y: 9 }
  } else if (cursor) {
    const dx = clamp(-9, 9, (cx - state.x) / 26) * state.facing, dy = clamp(-8, 9, (cy - FACE_Y) / 34)
    pupilL = { x: dx, y: dy }; pupilR = { x: dx * 0.8, y: dy * 0.8 }
  }

  // shadow shrinks + fades with altitude so the lift reads clearly
  const altK = Math.min(1, state.alt / 420)
  const shadowScale = (1 - jumpY / 220) * (1 - altK * 0.55), shadowOpacity = 1 - altK * 0.65

  // speed lines trail him while he sprints
  const linesOn = running && Math.abs(state.vx) > 2
  const lineX = state.facing === 1 ? state.x - 150 : state.x + 80
  const speedLines = [0, 1, 2].map((i) => ({
    opacity: linesOn ? Math.min(1, Math.abs(state.vx) / 6) * (1 - i * 0.25) : 0,
    x: lineX, y: 120 + i * 80 + Math.sin(t * 20 + i) * 8,
  }))

  state.pose = {
    jumpY, sqX, sqY, lean, headY: headY + open * 3, headR: headR + Math.sin(t * 7) * 2.5 * open,
    armL, armR, handL, handR, footL, footR, open, viseme: state.viseme, bulb, pupilL, pupilR, pupilScale, laptop,
    platter, platter2, deckLights,
    x: state.x, alt: state.alt, dangle, facing: state.facing, shadowScale, shadowOpacity,
    sweat: running || state.caught, worried: state.caught, speedLines,
  }
  return state
}

// ─── Thought bubble ──────────────────────────────────────────────────────────

export const THOUGHT_MAX_CHARS = 420
export const THOUGHT_TYPE_CPS = 34

export interface ThoughtState {
  /** Full text received so far (tail-trimmed to THOUGHT_MAX_CHARS). */
  target: string
  /** Characters currently revealed. */
  typed: number
  typeT: number
  /** Absolute time (rig seconds) after which an idle bubble hides; Infinity while streaming. */
  hideAt: number
  shown: boolean
}

export const EMPTY_THOUGHT: ThoughtState = { target: '', typed: 0, typeT: 0, hideAt: 0, shown: false }

/** Append a streamed chain-of-thought delta; the bubble stays up while deltas keep arriving. */
export function thoughtAppend(thought: ThoughtState, delta: string): ThoughtState {
  if (!delta) return thought
  let target = thought.target + delta
  let typed = thought.typed
  if (target.length > THOUGHT_MAX_CHARS) {
    const cut = target.length - THOUGHT_MAX_CHARS
    target = target.slice(cut)
    typed = Math.max(0, typed - cut)
  }
  return { target, typed, typeT: thought.typeT, hideAt: Infinity, shown: true }
}

/** Show a whole sentence (idle mutter, or a transcript line when there is no reasoning channel). */
export function thoughtSay(thought: ThoughtState, text: string, now: number): ThoughtState {
  if (!text) return thought
  return { target: text.slice(-THOUGHT_MAX_CHARS), typed: 0, typeT: 0, hideAt: now + Math.max(5, text.length * 0.09 + 3), shown: true }
}

/** The stream ended: finish typing, then hide after a short hold. */
export function thoughtSettle(thought: ThoughtState, now: number): ThoughtState {
  if (!thought.shown) return thought
  return { ...thought, hideAt: Number.isFinite(thought.hideAt) ? thought.hideAt : now + 4 }
}

/** Type-on and auto-hide; returns the visible text (empty when hidden). */
export function thoughtStep(thought: ThoughtState, dt: number, now: number): { thought: ThoughtState; text: string } {
  if (!thought.shown) return { thought, text: '' }
  let { typed, typeT } = thought
  if (typed < thought.target.length) {
    typeT += dt
    const n = Math.floor(typeT * THOUGHT_TYPE_CPS)
    if (n > 0) { typed = Math.min(thought.target.length, typed + n); typeT -= n / THOUGHT_TYPE_CPS }
  } else if (now > thought.hideAt) {
    return { thought: EMPTY_THOUGHT, text: '' }
  }
  const next = { ...thought, typed, typeT }
  return { thought: next, text: next.target.slice(0, typed) }
}

export const IDLE_THOUGHTS: readonly string[] = [
  'beep… boop… jk.', 'wonder if anyone can catch me', 'my antenna itches', 'moonwalk practice later', 'did I leave my laptop on?',
  'so shiny today', 'I should learn to juggle', 'hic! …excuse me', 'thinking about snacks',
]

/** Oubli peeks out whenever Ron is being asked something, and stays while he works or performs. */
export function shouldPeek(flags: { asking: boolean; processing: boolean; speaking: boolean; music: boolean; liveOpen: boolean }): boolean {
  return flags.asking || flags.processing || flags.speaking || flags.music || flags.liveOpen
}
