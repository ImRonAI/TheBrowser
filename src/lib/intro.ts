/**
 * When the opening sequence plays: once, on a fresh install (before the first-run sign-in page), and again on
 * demand with `#intro`. Finishing or skipping it marks it seen. `resetAppStorage` (Cmd/Ctrl+Shift+K) clears
 * localStorage, so a reset install sees it again like a new one.
 *
 * Pure (no `@/` imports) so `node --experimental-strip-types` can run the colocated test.
 */
import { isFirstRun } from './sign-in.ts'

export const INTRO_SEEN_KEY = 'ron-intro-seen-v1'
export const INTRO_HASH = '#intro'

type IntroStorage = Pick<Storage, 'getItem' | 'setItem'>

export function shouldPlayIntro(storage: IntroStorage = localStorage, hash: string = window.location.hash): boolean {
  if (hash === INTRO_HASH) return true
  return isFirstRun(storage) && storage.getItem(INTRO_SEEN_KEY) === null
}

export function markIntroSeen(storage: IntroStorage = localStorage): void {
  storage.setItem(INTRO_SEEN_KEY, new Date().toISOString())
}
