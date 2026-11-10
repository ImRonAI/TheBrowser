import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { buildFeedRequest, type DiscoverProfile } from '../lib/discover-profile.ts'
import { DiscoverFeedError, feedRequestKey, fetchDiscoverFeed, isFresh, type FeedSection, type Fetcher } from '../lib/discover-feed.ts'

/**
 * Cached `POST /discover/feed` result for the homepage. The cache is keyed by the exact
 * request body, so editing the profile invalidates it; otherwise the feed is reused for
 * FEED_TTL_MS across tabs/reloads so opening the home page does not hit Brave every time.
 */
export interface DiscoverFeedState {
  requestKey: string | null
  sections: FeedSection[]
  fetchedAt: number | null
  loading: boolean
  error: { code: string; message: string } | null
  load: (profile: DiscoverProfile, options?: { force?: boolean; fetcher?: Fetcher; now?: number }) => Promise<void>
  clear: () => void
}

let inFlight: Promise<void> | null = null

export const useDiscoverFeedStore = create<DiscoverFeedState>()(
  persist(
    (set, get) => ({
      requestKey: null,
      sections: [],
      fetchedAt: null,
      loading: false,
      error: null,
      load: async (profile, options = {}) => {
        const body = buildFeedRequest(profile)
        const key = feedRequestKey(body)
        const state = get()
        const now = options.now ?? Date.now()
        if (!options.force && state.requestKey === key && isFresh(state.fetchedAt, now) && state.sections.length) return
        // A newer request (e.g. the interest graph changed) waits for the running one, then loads.
        if (inFlight) { await inFlight; return get().load(profile, options) }
        set({ loading: true, error: null })
        inFlight = (async () => {
          try {
            const response = await fetchDiscoverFeed(body, options.fetcher)
            set({ requestKey: key, sections: response.sections, fetchedAt: now, loading: false, error: null })
          } catch (error) {
            const failure = error instanceof DiscoverFeedError ? { code: error.code, message: error.message }
              : { code: 'unknown', message: error instanceof Error ? error.message : String(error) }
            set({ loading: false, error: failure })
          } finally {
            inFlight = null
          }
        })()
        return inFlight
      },
      clear: () => set({ requestKey: null, sections: [], fetchedAt: null, error: null }),
    }),
    {
      name: 'discover-feed-storage',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({ requestKey: state.requestKey, sections: state.sections, fetchedAt: state.fetchedAt }),
    },
  ),
)
