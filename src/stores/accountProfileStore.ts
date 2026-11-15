import { useEffect } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { API_BASE_URL } from '@/lib/api-base'
import { createProfileClient, firstSync, graphChanged, profileOf, sameProfile, type AccountProfile } from '@/lib/account-profile'
import { isGuestUserId } from '@/lib/sign-in'
import { useAuthStore } from '@/stores/authStore'
import { useInterestsStore } from '@/stores/interestsStore'
import { useOnboardingStore } from '@/stores/onboardingStore'

const SAVE_AFTER_MS = 1500
const READ_TIMEOUT_MS = 8000

interface AccountProfileState {
  /** The account this device's interview and graph belong to (null: not synced with one yet). */
  owner: string | null
  /** When this device last changed them. */
  updatedAt: number
  /** The signed-in account whose profile this device has fetched (or failed to): until then the interview waits. */
  readyFor: string
  error: string
}

export const useAccountProfileStore = create<AccountProfileState>()(
  persist(
    (): AccountProfileState => ({ owner: null, updatedAt: 0, readyFor: '', error: '' }),
    {
      name: 'account-profile-sync',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({ owner: state.owner, updatedAt: state.updatedAt }),
    },
  ),
)

const localProfile = (updatedAt: number): AccountProfile => profileOf(useOnboardingStore.getState(), useInterestsStore.getState(), updatedAt)

function apply(profile: AccountProfile): void {
  useOnboardingStore.getState().applyAccount(profile.onboarding.answers, profile.onboarding.isComplete)
  useInterestsStore.getState().applyAccountGraph(profile.interests)
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

/**
 * Keeps the interview and the interest graph on the signed-in account (`/context/profile`): on sign-in this device
 * takes the account's copy (or gives the account its own, see `firstSync`), then saves its changes back a moment
 * after they happen. Mounted once by each page that shows the interview or the graph.
 */
export function useAccountProfileSync(): void {
  const userId = useAuthStore((state) => state.isAuthenticated ? state.user?.id ?? '' : '')

  useEffect(() => {
    if (isGuestUserId(userId)) {
      useAccountProfileStore.setState({ readyFor: '', error: '' })
      return
    }
    const client = createProfileClient(API_BASE_URL, userId)
    const aborted = new AbortController()
    let synced: AccountProfile | null = null
    let timer: number | undefined
    let stopped = false

    const save = async () => {
      timer = undefined
      const profile = localProfile(useAccountProfileStore.getState().updatedAt)
      try {
        const kept = await client.save(profile)
        if (stopped) return
        synced = kept
        if (!sameProfile(kept, profile)) {
          // Another device saved a newer copy first: this device takes it.
          apply(kept)
          useAccountProfileStore.setState({ updatedAt: kept.updated_at })
        }
        useAccountProfileStore.setState({ owner: userId, error: '' })
      } catch (error) {
        if (!stopped) useAccountProfileStore.setState({ error: `Your profile could not be saved to your account: ${messageOf(error)}` })
      }
    }

    const changed = () => {
      if (stopped || !synced) return
      if (sameProfile(localProfile(0), synced)) return
      useAccountProfileStore.setState({ updatedAt: Date.now() })
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { void save() }, SAVE_AFTER_MS)
    }

    const start = async () => {
      useAccountProfileStore.setState({ readyFor: '', error: '' })
      const timeout = window.setTimeout(() => aborted.abort(), READ_TIMEOUT_MS)
      try {
        const remote = await client.read(aborted.signal)
        if (stopped) return
        const { owner, updatedAt } = useAccountProfileStore.getState()
        const step = firstSync(remote, { profile: localProfile(updatedAt), owner, updatedAt }, userId)
        if (step.kind === 'apply') {
          apply(step.profile)
          useAccountProfileStore.setState({ owner: userId, updatedAt: step.profile.updated_at })
          synced = step.profile
        } else if (step.kind === 'reset') {
          useOnboardingStore.getState().resetOnboarding()
          useInterestsStore.getState().resetInterests()
          useAccountProfileStore.setState({ owner: userId, updatedAt: 0 })
          synced = localProfile(0)
        } else if (step.kind === 'push') {
          synced = remote ?? localProfile(0)
          if (!updatedAt) useAccountProfileStore.setState({ updatedAt: Date.now() })
          await save()
        } else {
          useAccountProfileStore.setState({ owner: userId })
          synced = remote ?? localProfile(0)
        }
      } catch (error) {
        // The account couldn't be reached: this device goes on with its own copy and saves it once it changes.
        if (stopped) return
        synced = localProfile(0)
        useAccountProfileStore.setState({ error: `Your profile could not be loaded from your account: ${messageOf(error)}` })
      } finally {
        window.clearTimeout(timeout)
        if (!stopped) useAccountProfileStore.setState({ readyFor: userId })
      }
    }

    const offOnboarding = useOnboardingStore.subscribe((state, previous) => {
      if (state.answers !== previous.answers || state.isComplete !== previous.isComplete) changed()
    })
    const offInterests = useInterestsStore.subscribe((state, previous) => { if (graphChanged(state, previous)) changed() })
    void start()
    return () => {
      stopped = true
      aborted.abort()
      offOnboarding()
      offInterests()
      if (timer !== undefined) {
        window.clearTimeout(timer)
        void save()
      }
    }
  }, [userId])
}

/** False while a signed-in account's profile is still on its way, so the interview isn't shown to a user who took it elsewhere. */
export function useAccountProfileReady(): boolean {
  const userId = useAuthStore((state) => state.isAuthenticated ? state.user?.id ?? '' : '')
  const readyFor = useAccountProfileStore((state) => state.readyFor)
  return isGuestUserId(userId) || readyFor === userId
}
