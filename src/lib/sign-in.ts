/**
 * The one way into the sign-in page. `App.tsx` renders `SignInPage` while the hash is `#signin`
 * and the user is not authenticated; every "Sign in" affordance (user menu, music deck, future
 * gated features) goes through here so none of them can drift to a dead link.
 *
 * Pure (no `@/` imports) so `node --experimental-strip-types` can run the colocated test.
 */
export const SIGN_IN_HASH = '#signin'

/** Guest identities the backend refuses for owner-scoped data (songs, playlists, specialists). */
export function isGuestUserId(userId: string | null | undefined): boolean {
  return !userId || userId === 'default' || userId.startsWith('guest:') || userId === 'dev-user'
}

export function openSignIn(location: { hash: string } = window.location): void {
  location.hash = SIGN_IN_HASH
}

export function closeSignIn(location: { hash: string } = window.location): void {
  if (location.hash === SIGN_IN_HASH) location.hash = ''
}

/**
 * First-run gate: a fresh install opens on the sign-in page once. Signing in or choosing
 * "Continue without an account" marks the install as launched; `resetAppStorage` (Cmd/Ctrl+Shift+K)
 * clears localStorage and therefore restores the fresh-install experience.
 */
export const FIRST_RUN_KEY = 'ron-first-run-v1'

type FirstRunStorage = Pick<Storage, 'getItem' | 'setItem'>

export function isFirstRun(storage: FirstRunStorage = localStorage): boolean {
  return storage.getItem(FIRST_RUN_KEY) === null
}

export function markLaunched(storage: FirstRunStorage = localStorage): void {
  storage.setItem(FIRST_RUN_KEY, new Date().toISOString())
}
