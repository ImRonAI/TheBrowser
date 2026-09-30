import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  REST, ROTATE_EVERY_MS, SPECS, SWAP_ANIMATIONS, cardTilt, hashString, nextSlotToRotate, pickAnimation,
  resolveSpec, reverseEase, reverseOf, stickerHue, swapVariants, type SwapCustom,
} from './story-animations.ts'

const custom = (overrides: Partial<SwapCustom> = {}): SwapCustom => ({ name: 'fall', direction: 1, reducedMotion: false, ...overrides })
const variant = (name: 'initial' | 'animate' | 'exit', c: SwapCustom) => {
  const resolver = swapVariants[name]
  assert.equal(typeof resolver, 'function')
  return (resolver as (c: SwapCustom) => Record<string, unknown>)(c)
}

test('pickAnimation is deterministic and covers all six names', () => {
  const picked = [0, 1, 2, 3, 4, 5].map(pickAnimation)
  assert.deepEqual(new Set(picked), new Set(SWAP_ANIMATIONS))
  assert.equal(pickAnimation(7), pickAnimation(7))
  assert.equal(pickAnimation(-1), pickAnimation(1))
})

test('hashString is stable and distinguishes inputs', () => {
  assert.equal(hashString('a'), hashString('a'))
  assert.notEqual(hashString('a'), hashString('b'))
  assert.ok(hashString('anything') >= 0)
})

test('reverseEase mirrors a cubic bezier', () => {
  assert.deepEqual(reverseEase([0.55, 0, 1, 0.45]), [0, 0.55, 0.45, 1])
})

test('reverseOf swaps from/to and mirrors ease', () => {
  const reversed = reverseOf(SPECS.fall)
  assert.deepEqual(reversed.from, SPECS.fall.to)
  assert.deepEqual(reversed.to, SPECS.fall.from)
  assert.deepEqual(reversed.ease, reverseEase(SPECS.fall.ease))
  assert.equal(reversed.duration, SPECS.fall.duration)
  assert.deepEqual(resolveSpec(custom({ direction: -1 })), reversed)
  assert.deepEqual(resolveSpec(custom()), SPECS.fall)
})

test('forward variants play the spec and carry their transition', () => {
  assert.deepEqual(variant('initial', custom()), SPECS.fall.from)
  assert.deepEqual(variant('exit', custom()), { ...SPECS.fall.to, transition: { duration: 0.55, ease: [0.55, 0, 1, 0.45] } })
  assert.deepEqual(variant('animate', custom()), { ...REST, transition: { duration: 0.55, ease: [0.55, 0, 1, 0.45] } })
})

test('previous direction plays the exact reverse motion', () => {
  const back = custom({ direction: -1 })
  assert.deepEqual(variant('initial', back), SPECS.fall.to)
  assert.deepEqual(variant('exit', back), { ...SPECS.fall.from, transition: { duration: 0.55, ease: reverseEase(SPECS.fall.ease) } })
})

test('reduced motion collapses to instant opacity swaps', () => {
  const reduced = custom({ reducedMotion: true })
  assert.deepEqual(variant('initial', reduced), { opacity: 0 })
  assert.deepEqual(variant('animate', reduced), { opacity: 1, transition: { duration: 0 } })
  assert.deepEqual(variant('exit', reduced), { opacity: 0, transition: { duration: 0 } })
})

test('every spec animates only keys that REST returns to', () => {
  const restKeys = new Set(Object.keys(REST))
  for (const name of SWAP_ANIMATIONS) {
    for (const key of [...Object.keys(SPECS[name].from), ...Object.keys(SPECS[name].to)]) {
      assert.ok(restKeys.has(key), `${name}.${key} missing from REST`)
    }
    for (const target of [SPECS[name].from, SPECS[name].to]) {
      const clip = (target as { clipPath?: string }).clipPath
      if (clip) assert.match(clip, /^inset\(/)
    }
  }
})

test('scheduler rotates exactly one slot round-robin every five minutes', () => {
  assert.equal(ROTATE_EVERY_MS, 300_000)
  assert.equal(nextSlotToRotate(-1, 3), 0)
  assert.equal(nextSlotToRotate(0, 3), 1)
  assert.equal(nextSlotToRotate(2, 3), 0)
  assert.equal(nextSlotToRotate(0, 0), 0)
})

test('card quirks are deterministic and bounded', () => {
  const tilts = new Set([-0.9, -0.5, 0.5, 0.9])
  const hues = new Set(['amber', 'rose', 'emerald', 'sky', 'violet'])
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'https://x.test/1', 'Technology']) {
    assert.ok(tilts.has(cardTilt(seed)), `tilt ${cardTilt(seed)}`)
    assert.ok(hues.has(stickerHue(seed)))
    assert.equal(cardTilt(seed), cardTilt(seed))
  }
})
