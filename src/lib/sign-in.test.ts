import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FIRST_RUN_KEY, SIGN_IN_HASH, closeSignIn, isFirstRun, isGuestUserId, markLaunched, openSignIn } from './sign-in.ts'

test('isGuestUserId: every identity the backend refuses for owner-scoped data is a guest', () => {
  for (const id of ['default', 'guest:abc', 'dev-user', '', null, undefined]) assert.equal(isGuestUserId(id), true, String(id))
  assert.equal(isGuestUserId('5c1e1b2a-7c2e-4d1b-9a1f-2f9d2c3b4a5e'), false)
})

test('openSignIn/closeSignIn drive the #signin hash App.tsx renders SignInPage from', () => {
  const location = { hash: '' }
  openSignIn(location)
  assert.equal(location.hash, SIGN_IN_HASH)
  closeSignIn(location)
  assert.equal(location.hash, '')
  location.hash = '#onboarding'
  closeSignIn(location)
  assert.equal(location.hash, '#onboarding', 'never clobbers another route')
})

test('first run: a fresh install is first-run until signed in or continued as guest; clearing storage restores it', () => {
  const store = new Map<string, string>()
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
  }
  assert.equal(isFirstRun(storage), true)
  markLaunched(storage)
  assert.equal(isFirstRun(storage), false)
  assert.ok(store.has(FIRST_RUN_KEY))
  store.clear() // what resetAppStorage()'s localStorage.clear() does
  assert.equal(isFirstRun(storage), true)
})
