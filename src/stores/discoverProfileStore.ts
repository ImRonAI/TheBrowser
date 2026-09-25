import { useMemo } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { answerFor, useOnboardingStore, type OnboardingAnswer } from './onboardingStore.ts'
import { buildProfile, DEFAULT_PROFILE, type DiscoverProfile } from '../lib/discover-profile.ts'

/**
 * Structured Discover homepage profile. The base profile is *derived* from onboarding
 * answers on every read (so re-running onboarding changes it), and per-field overrides
 * let the homepage edit a card (change city, add a ticker) without rewriting interview
 * answers. Only the overrides persist.
 */
interface DiscoverProfileState {
  overrides: Partial<DiscoverProfile>
  setOverride: <K extends keyof DiscoverProfile>(key: K, value: DiscoverProfile[K]) => void
  clearOverride: (key: keyof DiscoverProfile) => void
  resetOverrides: () => void
}

export const useDiscoverProfileStore = create<DiscoverProfileState>()(
  persist(
    (set) => ({
      overrides: {},
      setOverride: (key, value) => set((state) => ({ overrides: { ...state.overrides, [key]: value } })),
      clearOverride: (key) => set((state) => {
        const { [key]: _dropped, ...rest } = state.overrides
        return { overrides: rest }
      }),
      resetOverrides: () => set({ overrides: {} }),
    }),
    {
      name: 'discover-profile-storage',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({ overrides: state.overrides }),
      migrate: (persisted) => persisted as Partial<DiscoverProfileState>,
    },
  ),
)

export function resolveDiscoverProfile(answers: OnboardingAnswer[], overrides: Partial<DiscoverProfile>): DiscoverProfile {
  const base = answers.length ? buildProfile((id) => answerFor(answers, id)) : DEFAULT_PROFILE
  return { ...base, ...overrides, media: { ...base.media, ...(overrides.media || {}) } }
}

/** Non-hook accessor for effects and the Electron bridge. */
export function getDiscoverProfile(): DiscoverProfile {
  return resolveDiscoverProfile(useOnboardingStore.getState().answers, useDiscoverProfileStore.getState().overrides)
}

/** React hook: onboarding answers + overrides → profile, memoised on both inputs. */
export function useDiscoverProfile(): DiscoverProfile {
  const answers = useOnboardingStore((state) => state.answers)
  const overrides = useDiscoverProfileStore((state) => state.overrides)
  return useMemo(() => resolveDiscoverProfile(answers, overrides), [answers, overrides])
}
