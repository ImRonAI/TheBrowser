/**
 * The account's profile: the interview (`onboardingStore`) and the interest graph (`interestsStore`), kept on the
 * account by `/context/profile` (agent/api/endpoints/context.py) so a user can start on desktop or on ren mobile
 * and the other picks them up when it signs in to the same account. The graph's on-screen layout (positions,
 * velocities) stays on each device.
 *
 * Pure (fetch + relative imports, no React) so node:test can run it.
 */
import type { InterestCategory } from './context-api.ts'

export interface ProfileAnswer { question: string; answer: string; timestamp: number }
export interface ProfileInterest {
  id: string; label: string; weight: number; category: InterestCategory; source: 'onboarding' | 'browsing'
  reason?: string; lastUpdated: number
}
export interface ProfileConnection { id: string; from: string; to: string; strength: number }
export interface AccountProfile {
  onboarding: { answers: ProfileAnswer[]; isComplete: boolean }
  interests: { nodes: ProfileInterest[]; connections: ProfileConnection[]; isInitialized: boolean }
  /** When the device that wrote it last changed it, in ms since the epoch. */
  updated_at: number
}

/** What this device holds: the stores' profile, the account it last synced with, and when it last changed it. */
export interface LocalProfile { profile: AccountProfile; owner: string | null; updatedAt: number }

export type FirstSync =
  | { kind: 'apply'; profile: AccountProfile }
  | { kind: 'push' }
  | { kind: 'reset' }
  | { kind: 'none' }

interface InterestLike extends ProfileInterest { position?: unknown; velocity?: unknown }

export function profileOf(
  onboarding: { answers: ProfileAnswer[]; isComplete: boolean },
  interests: { nodes: InterestLike[]; connections: ProfileConnection[]; isInitialized: boolean },
  updatedAt: number,
): AccountProfile {
  return {
    onboarding: {
      answers: onboarding.answers.map(({ question, answer, timestamp }) => ({ question, answer, timestamp })),
      isComplete: onboarding.isComplete,
    },
    interests: {
      nodes: interests.nodes.map(({ id, label, weight, category, source, reason, lastUpdated }) =>
        reason === undefined ? { id, label, weight, category, source, lastUpdated } : { id, label, weight, category, source, reason, lastUpdated }),
      connections: interests.connections.map(({ id, from, to, strength }) => ({ id, from, to, strength })),
      isInitialized: interests.isInitialized,
    },
    updated_at: updatedAt,
  }
}

/** JSON with sorted keys and without null or absent fields, so two copies compare by content. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, field]) => field !== null && field !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, field]) => `${JSON.stringify(key)}:${canonical(field)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** The same interview and graph, whenever each was written. */
export function sameProfile(a: AccountProfile, b: AccountProfile): boolean {
  return canonical({ ...a, updated_at: 0 }) === canonical({ ...b, updated_at: 0 })
}

/** Whether a store change touched what the account keeps (the graph's layout changes many times a second and doesn't). */
export function graphChanged(
  next: { nodes: InterestLike[]; connections: ProfileConnection[]; isInitialized: boolean },
  previous: { nodes: InterestLike[]; connections: ProfileConnection[]; isInitialized: boolean },
): boolean {
  if (next.connections !== previous.connections || next.isInitialized !== previous.isInitialized) return true
  if (next.nodes.length !== previous.nodes.length) return true
  return next.nodes.some((node, index) => {
    const before = previous.nodes[index]
    return node.id !== before.id || node.label !== before.label || node.weight !== before.weight || node.category !== before.category
      || node.source !== before.source || node.reason !== before.reason || node.lastUpdated !== before.lastUpdated
  })
}

export function hasContent(profile: AccountProfile): boolean {
  return profile.onboarding.isComplete || profile.onboarding.answers.length > 0 || profile.interests.nodes.length > 0
}

/**
 * What to do when `userId` signs in: take the account's profile, unless this device changed its own copy of that
 * account's profile since; give the account this device's profile when the account has none yet (a survey taken
 * before signing in, or before the account kept one); and start over when the device's profile is another
 * account's.
 */
export function firstSync(remote: AccountProfile | null, local: LocalProfile, userId: string): FirstSync {
  const mine = local.owner === userId
  if (remote) {
    if (mine && local.updatedAt > remote.updated_at && !sameProfile(local.profile, remote)) return { kind: 'push' }
    return sameProfile(local.profile, remote) ? { kind: 'none' } : { kind: 'apply', profile: remote }
  }
  if (local.owner !== null && !mine) return hasContent(local.profile) ? { kind: 'reset' } : { kind: 'none' }
  return hasContent(local.profile) ? { kind: 'push' } : { kind: 'none' }
}

async function failure(response: Response): Promise<Error> {
  let detail = `${response.status} ${response.statusText}`.trim()
  try {
    const body = await response.json() as { detail?: unknown }
    if (typeof body.detail === 'string') detail = body.detail
  } catch { /* not JSON */ }
  return new Error(detail)
}

export function createProfileClient(apiBase: string, userId: string, fetcher: typeof fetch = fetch) {
  const base = apiBase.replace(/\/$/, '')
  return {
    read: async (signal?: AbortSignal): Promise<AccountProfile | null> => {
      const response = await fetcher(`${base}/context/profile?user_id=${encodeURIComponent(userId)}`, { signal })
      if (!response.ok) throw await failure(response)
      return (await response.json() as { profile: AccountProfile | null }).profile
    },
    /** Saves `profile`; the account keeps whichever is newer and returns it. */
    save: async (profile: AccountProfile): Promise<AccountProfile> => {
      const response = await fetcher(`${base}/context/profile`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, profile }),
      })
      if (!response.ok) throw await failure(response)
      return (await response.json() as { profile: AccountProfile }).profile
    },
  }
}
