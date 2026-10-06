import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_BPM, EMPTY_THOUGHT, analyseMusic, analyseVoice, bands, createMascotState, genreFromPrompts, shouldPeek,
  FACE_Y, MOVER_H, WALL, stepMascot, thoughtAppend, thoughtSettle, thoughtStep, type MascotInputs,
} from './mascot.ts'

const spectrum = (fill: (hz: number) => number, bins = 512, binHz = 24000 / 1024) =>
  ({ data: Uint8Array.from({ length: bins }, (_, i) => Math.max(0, Math.min(255, fill(i * binHz)))), binHz })

const quiet: MascotInputs = { voice: null, music: null, thinking: false, working: false, genre: null, bpm: DEFAULT_BPM, pointer: null, stageWidth: 800 }

test('bands splits the spectrum into low/mid/high averages', () => {
  const { data, binHz } = spectrum((hz) => (hz < 500 ? 200 : hz < 2200 ? 100 : 20))
  const b = bands(data, binHz)
  assert.ok(b.low > 150 && b.mid > 80 && b.mid < 120 && b.high < 40)
})

test('analyseVoice: silence closes the mouth, lows round it, highs widen it', () => {
  const silence = spectrum(() => 0)
  assert.deepEqual(analyseVoice(silence.data, silence.binHz), { open: 0, viseme: 'AH' })
  const lows = spectrum((hz) => (hz < 500 ? 230 : 5))
  assert.equal(analyseVoice(lows.data, lows.binHz).viseme, 'O')
  const highs = spectrum((hz) => (hz > 2200 && hz < 6000 ? 230 : 10))
  assert.equal(analyseVoice(highs.data, highs.binHz).viseme, 'EE')
  // Speech-like roll-off: balanced lows/mids with weaker highs reads as the open "AH".
  const mixed = spectrum((hz) => (hz < 500 ? 150 : hz < 2200 ? 150 : 60))
  const r = analyseVoice(mixed.data, mixed.binHz)
  assert.equal(r.viseme, 'AH'); assert.ok(r.open > 0.5)
})

test('analyseMusic reports bass and energy in 0..1', () => {
  const loud = spectrum(() => 255, 1024, 48000 / 2048)
  const r = analyseMusic(loud.data, loud.binHz)
  assert.equal(r.bass, 1); assert.equal(r.energy, 1)
})

test('genreFromPrompts votes by weight and ignores unknown prompts', () => {
  assert.equal(genreFromPrompts([{ text: 'minimal techno', weight: 1 }, { text: 'deep sub bass', weight: 0.6 }]), 'electronic')
  assert.equal(genreFromPrompts([{ text: 'boom-bap hip hop', weight: 1 }, { text: 'warm piano', weight: 0.3 }]), 'rap')
  assert.equal(genreFromPrompts([{ text: 'bluegrass banjo', weight: 0.4 }, { text: 'shredding guitar', weight: 1 }]), 'rock')
  assert.equal(genreFromPrompts([{ text: 'orchestral score', weight: 1 }]), 'classical')
  assert.equal(genreFromPrompts([{ text: 'disco funk', weight: 1 }]), 'pop')
  assert.equal(genreFromPrompts([{ text: 'flamenco guitar', weight: 1 }, { text: 'bossa nova', weight: 0.2 }]), 'pop')
  assert.equal(genreFromPrompts([{ text: 'rain sounds', weight: 1 }]), null)
  assert.equal(genreFromPrompts([]), null)
})

test('stepMascot: idle pose is calm, music poses move to the beat, voice opens the mouth', () => {
  const state = createMascotState()
  stepMascot(state, 1 / 60, quiet, () => 0.5)
  assert.ok(Math.abs(state.pose.armL) < 5 && state.pose.open === 0 && state.pose.laptop === 0 && state.pose.bulb === 1)
  const music = spectrum(() => 200, 1024, 48000 / 2048)
  for (let i = 0; i < 30; i++) stepMascot(state, 1 / 60, { ...quiet, genre: 'electronic', music, bpm: 120 }, () => 0.5)
  assert.ok(state.beat > 0.9 && state.beat < 1.1, `beat clock follows bpm (${state.beat})`)
  assert.ok(state.pose.platter !== 0 && state.pose.deckLights.every((v) => v > 0 && v <= 1.3))
  assert.ok(state.energy > 0.5)
  const voice = spectrum(() => 150)
  for (let i = 0; i < 20; i++) stepMascot(state, 1 / 60, { ...quiet, voice }, () => 0.5)
  assert.ok(state.pose.open > 0.4, 'voice opens the mouth')
  for (let i = 0; i < 60; i++) stepMascot(state, 1 / 60, quiet, () => 0.5)
  assert.ok(state.pose.open < 0.05, 'mouth closes when the voice tap goes quiet')
})

test('stepMascot: thinking pulses the bulb and glances up; working brings the laptop', () => {
  const state = createMascotState()
  for (let i = 0; i < 10; i++) stepMascot(state, 1 / 60, { ...quiet, thinking: true }, () => 0.5)
  assert.ok(state.pose.bulb < 1 && state.pose.pupilL.y === -9)
  for (let i = 0; i < 60; i++) stepMascot(state, 1 / 60, { ...quiet, working: true }, () => 0.5)
  assert.ok(state.pose.laptop > 0.9 && Math.abs(state.pose.armL + 46) < 5)
})

test('thought bubble streams deltas, trims the tail, and settles after the stream', () => {
  let thought = thoughtAppend(EMPTY_THOUGHT, 'Checking the ')
  thought = thoughtAppend(thought, 'page first.')
  assert.equal(thought.target, 'Checking the page first.'); assert.equal(thought.hideAt, Infinity)
  let out = thoughtStep(thought, 0.1, 1)
  assert.equal(out.text, 'Che', 'types ~34 chars/s')
  out = thoughtStep(out.thought, 5, 6)
  assert.equal(out.text, 'Checking the page first.')
  const settled = thoughtSettle(out.thought, 6)
  assert.ok(Number.isFinite(settled.hideAt))
  assert.equal(thoughtStep(settled, 0.016, settled.hideAt + 1).text, '', 'hides after the hold')
  const long = thoughtAppend(EMPTY_THOUGHT, 'x'.repeat(500))
  assert.equal(long.target.length, 420)
})

test('shouldPeek: Oubli comes out whenever Ron is asked, working, speaking, performing, or Live is open', () => {
  assert.equal(shouldPeek({ asking: false, processing: false, speaking: false, music: false, liveOpen: false }), false)
  assert.equal(shouldPeek({ asking: true, processing: false, speaking: false, music: false, liveOpen: false }), true)
  assert.equal(shouldPeek({ asking: false, processing: false, speaking: false, music: true, liveOpen: false }), true)
})

const pointer = (x: number, y: number, vx = 0, vy = 0, idle = 0) => ({ x, y, vx, vy, idle })

test('stepMascot: he starts centred, wanders within the walls, and faces the way he walks', () => {
  const state = createMascotState()
  stepMascot(state, 1 / 60, quiet, () => 0.5)
  assert.equal(state.pose.x, 400)
  // a wander target far to the right (random() = 0.99): he walks right and stays inside the walls
  for (let i = 0; i < 60 * 12; i++) stepMascot(state, 1 / 60, quiet, () => 0.99)
  assert.ok(state.pose.x > 400 && state.pose.x <= 800 - WALL, `walked right to ${state.pose.x}`)
  assert.equal(state.pose.facing, 1)
  for (let i = 0; i < 60 * 25; i++) stepMascot(state, 1 / 60, quiet, () => 0.01)
  assert.ok(state.pose.x >= WALL && state.pose.x < 400, `walked back left to ${state.pose.x}`)
  assert.equal(state.pose.facing, -1)
})

test('stepMascot: the cursor near his face makes him run away (sweat, speed lines, running pose)', () => {
  const state = createMascotState()
  stepMascot(state, 1 / 60, quiet, () => 0.5)
  const start = state.pose.x
  // cursor 120 units to his left at face height, moving
  for (let i = 0; i < 20; i++) stepMascot(state, 1 / 60, { ...quiet, pointer: pointer(start - 120, FACE_Y) }, () => 0.5)
  assert.ok(state.fleeing, 'flees inside 180 units')
  assert.ok(state.pose.x > start + 20, `ran right: ${state.pose.x} > ${start}`)
  assert.ok(Math.abs(state.vx) <= 7.5, 'capped at the reference sprint speed')
  assert.equal(state.pose.facing, 1)
  assert.ok(state.pose.sweat && state.pose.lean > 5, 'running pose: sweat drop + forward lean')
  assert.ok(state.pose.speedLines[0].opacity > 0 && state.pose.speedLines[0].x < state.pose.x, 'speed lines trail behind')
  assert.ok(!state.pose.worried)
  // the cursor stops moving: after 2.5 s he calms down
  for (let i = 0; i < 60; i++) stepMascot(state, 1 / 60, { ...quiet, pointer: pointer(start - 120, FACE_Y, 0, 0, 3) }, () => 0.5)
  assert.ok(!state.fleeing && !state.pose.sweat)
  // flee disabled: the cursor can sit next to him
  const calm = createMascotState()
  for (let i = 0; i < 30; i++) stepMascot(calm, 1 / 60, { ...quiet, flee: false, pointer: pointer(400 - 120, FACE_Y) }, () => 0.5)
  assert.ok(!calm.fleeing && Math.abs(calm.pose.x - 400) < 5)
})

test('stepMascot: the cursor on him picks him up -- lifted, kicking and flailing, worried, pupils shrunk', () => {
  const state = createMascotState()
  stepMascot(state, 1 / 60, quiet, () => 0.5)
  const grab = pointer(400, FACE_Y) // right on his face
  for (let i = 0; i < 30; i++) stepMascot(state, 1 / 60, { ...quiet, pointer: grab }, () => 0.5)
  assert.ok(state.caught && !state.fleeing)
  assert.ok(state.pose.alt > 100, `lifted so his feet sit at the cursor (alt ${state.pose.alt} -> ${MOVER_H - FACE_Y})`)
  assert.ok(state.pose.worried && state.pose.sweat && state.pose.pupilScale === 0.68 && state.pose.bulb === 1)
  assert.ok(state.pose.shadowScale < 1 && state.pose.shadowOpacity < 1, 'shadow shrinks and fades with altitude')
  // flailing: arms windmill through a wide range, feet kick, head shakes
  let minArm = Infinity, maxArm = -Infinity, kicked = false, shook = false
  for (let i = 0; i < 40; i++) {
    stepMascot(state, 1 / 60, { ...quiet, pointer: grab }, () => 0.5)
    minArm = Math.min(minArm, state.pose.armL); maxArm = Math.max(maxArm, state.pose.armL)
    if (/rotate\((-?\d+(\.\d+)?)deg\)/.test(state.pose.footL) && Math.abs(Number(RegExp.$1)) > 20) kicked = true
    if (Math.abs(state.pose.headR) > 5) shook = true
  }
  assert.ok(maxArm - minArm > 90, `arms windmill (${minArm.toFixed(0)}..${maxArm.toFixed(0)})`)
  assert.ok(kicked && shook)
  assert.ok(state.pose.laptop === 0, 'no laptop while carried, even if working')
  // carried: he follows the cursor
  for (let i = 0; i < 30; i++) stepMascot(state, 1 / 60, { ...quiet, working: true, pointer: pointer(500, 60) }, () => 0.5)
  assert.ok(Math.abs(state.pose.x - 500) < 10 && state.pose.alt > MOVER_H - 60 - 20)
  assert.ok(Math.abs(state.pose.dangle) > 0, 'he hangs and swings')
})

test('stepMascot: he wriggles free after ~3 s, falls under gravity, and squashes on landing', () => {
  const state = createMascotState()
  stepMascot(state, 1 / 60, quiet, () => 0.5)
  // grab him at the face, then carry him high (the cursor stays within reach as he follows it up)
  for (let i = 0; i < 20; i++) stepMascot(state, 1 / 60, { ...quiet, pointer: pointer(400, FACE_Y) }, () => 0.5)
  assert.ok(state.caught)
  const grab = pointer(400, 40)
  for (let i = 0; i < 60 * 3.2 - 20; i++) stepMascot(state, 1 / 60, { ...quiet, pointer: grab }, () => 0.5)
  assert.ok(!state.caught, 'released after 3 s')
  assert.ok(state.pose.alt > 0, 'still in the air right after release')
  let landed = false, squashed = false
  for (let i = 0; i < 60 * 3; i++) {
    stepMascot(state, 1 / 60, { ...quiet, pointer: pointer(400, 40, 0, 0, 5) }, () => 0.5)
    if (state.pose.alt === 0) landed = true
    if (landed && state.pose.sqY < 0.95) squashed = true
  }
  assert.ok(landed && squashed, `landed=${landed} squashed=${squashed}`)
  assert.ok(!state.pose.worried && state.pose.pupilScale === 1)
})

test('stepMascot: a fast flick throws him', () => {
  const state = createMascotState()
  stepMascot(state, 1 / 60, quiet, () => 0.5)
  for (let i = 0; i < 20; i++) stepMascot(state, 1 / 60, { ...quiet, pointer: pointer(400, FACE_Y) }, () => 0.5)
  assert.ok(state.caught)
  stepMascot(state, 1 / 60, { ...quiet, pointer: pointer(400, FACE_Y, 3000, -800) }, () => 0.5)
  assert.ok(!state.caught && state.vx > 5 && state.vy > 0, `thrown right and up (vx ${state.vx}, vy ${state.vy})`)
})
