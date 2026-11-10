import assert from 'node:assert/strict'
import test from 'node:test'
import { INTRO_HASH, INTRO_SEEN_KEY, markIntroSeen, shouldPlayIntro } from './intro.ts'
import { FIRST_RUN_KEY, markLaunched } from './sign-in.ts'

const memory = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

test('a fresh install plays the opening once; seeing it or launching before ends that', () => {
  const fresh = memory()
  assert.equal(shouldPlayIntro(fresh, ''), true)
  markIntroSeen(fresh)
  assert.ok(fresh.getItem(INTRO_SEEN_KEY))
  assert.equal(shouldPlayIntro(fresh, ''), false)

  const launched = memory()
  markLaunched(launched)
  assert.ok(launched.getItem(FIRST_RUN_KEY))
  assert.equal(shouldPlayIntro(launched, ''), false, 'an install that already launched is not a first-time user')
})

test('#intro replays it for anyone', () => {
  const seen = memory()
  markLaunched(seen)
  markIntroSeen(seen)
  assert.equal(shouldPlayIntro(seen, INTRO_HASH), true)
})
