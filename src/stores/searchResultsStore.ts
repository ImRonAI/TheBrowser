/**
 * Search Results Store
 *
 * One live search run: POST /search/stream (agent/api/endpoints/search.py) folded
 * through the pure reducer in src/lib/search-api.ts. A new search aborts the previous
 * one. The run outlives the results page: leaving the search tab keeps it streaming into
 * this store, and the page restarts it only when the query or level changes (`runKey`).
 * Stopping settles every unfinished lane (`settleCancelledRun`).
 */
import { create } from 'zustand'
import { fetchDiscoverFeed, type FeedSection } from '@/lib/discover-feed'
import {
  DEFAULT_SEARCH_LEVEL,
  applySearchEvent,
  beginFollowUpState,
  initialRunState,
  placesRefreshRequest,
  searchRunKey,
  settleCancelledRun,
  streamSearch,
  type SearchLevel,
  type SearchRunState,
} from '@/lib/search-api'

export interface SearchLocationHint {
  location?: string
  latitude?: number
  longitude?: number
}

interface SearchResultsState {
  run: SearchRunState
  /** `searchRunKey(q, level)` of the stored run; null before the first search. */
  runKey: string | null
  isRunning: boolean
  followUpLoading: boolean
  startedAt: number | null
  /** Fatal failure before/around the stream itself (unreachable backend, 503, ...). */
  fatal: { code: string; message: string } | null
  start: (q: string, level: SearchLevel, opts?: { country?: string; location?: SearchLocationHint }) => void
  sendFollowUp: (message: string, opts?: { country?: string; location?: SearchLocationHint }) => Promise<void>
  /** Re-run only the Places section (POST /discover/feed) for a new location; the rest of the run is kept. */
  refreshPlaces: (q: string, opts: { country: string; location?: string | null }) => Promise<void>
  cancel: () => void
}

let controller: AbortController | null = null
/** Bumped by every `start` and `refreshPlaces`, so a slower, older Places response is dropped. */
let placesRequest = 0

export const useSearchResultsStore = create<SearchResultsState>()((set, get) => ({
  run: initialRunState(),
  runKey: null,
  isRunning: false,
  followUpLoading: false,
  startedAt: null,
  fatal: null,

  start: (q, level, opts) => {
    get().cancel()
    placesRequest += 1
    const next = new AbortController()
    controller = next
    set({
      run: { ...initialRunState(), activeQuestion: q },
      runKey: searchRunKey(q, level),
      isRunning: true,
      followUpLoading: false,
      startedAt: Date.now(),
      fatal: null,
    })
    void streamSearch(
      {
        q,
        level,
        ...(opts?.country ? { country: opts.country } : {}),
        ...(opts?.location ? { location: opts.location } : {}),
      },
      (event) => {
        if (next.signal.aborted) return
        set((state) => ({ run: applySearchEvent(state.run, event) }))
      },
      next.signal,
    )
      .then(() => {
        if (controller === next && !next.signal.aborted) set({ isRunning: false, followUpLoading: false })
      })
      .catch((error: unknown) => {
        if (next.signal.aborted) return
        const record = error as { code?: string; message?: string }
        set({
          isRunning: false,
          followUpLoading: false,
          fatal: { code: record?.code || 'error', message: record?.message || 'Search failed' },
        })
      })
  },

  sendFollowUp: async (message, opts) => {
    const trimmed = message.trim()
    if (!trimmed) return
    const current = get()
    if (current.isRunning) {
      current.cancel()
    }
    const next = new AbortController()
    controller = next
    const level = ((current.run.meta?.level as SearchLevel | undefined) ?? DEFAULT_SEARCH_LEVEL)
    const country = opts?.country || current.run.meta?.country || 'US'
    const sessionId = current.run.sessionId
    set((state) => ({
      run: beginFollowUpState(state.run, trimmed),
      isRunning: true,
      followUpLoading: true,
      fatal: null,
    }))
    try {
      await streamSearch(
        {
          q: trimmed,
          level,
          country,
          session_id: sessionId,
          follow_up: true,
          ...(opts?.location ? { location: opts.location } : {}),
        },
        (event) => {
          if (next.signal.aborted) return
          set((state) => ({ run: applySearchEvent(state.run, event) }))
        },
        next.signal,
      )
      if (controller === next && !next.signal.aborted) {
        set({ isRunning: false, followUpLoading: false })
      }
    } catch (error: unknown) {
      if (next.signal.aborted) return
      const record = error as { code?: string; message?: string }
      set((state) => ({
        isRunning: false,
        followUpLoading: false,
        run: {
          ...state.run,
          agent: {
            ...state.run.agent,
            status: 'error',
            error: {
              source: 'agent',
              code: record?.code || 'error',
              message: record?.message || 'Follow-up failed',
            },
          },
        },
      }))
    }
  },

  refreshPlaces: async (q, opts) => {
    placesRequest += 1
    const request = placesRequest
    // Without a Places section the tab shows its loading skeleton until the new one lands.
    set((state) => {
      const sections = { ...state.run.sections }
      delete sections.places
      return { run: { ...state.run, sections } }
    })
    let section: FeedSection
    try {
      const feed = await fetchDiscoverFeed(placesRefreshRequest(q, opts))
      section = feed.sections.find((entry) => entry.kind === 'places') ?? {
        kind: 'places', q, status: 'error', items: [],
        error: { code: 'malformed', message: 'The places search returned no results section' },
      }
    } catch (error: unknown) {
      const record = error as { code?: string; message?: string; status?: number }
      section = {
        kind: 'places', q, status: 'error', items: [],
        error: { code: record?.code || 'error', message: record?.message || 'Places search failed', status: record?.status ?? null },
      }
    }
    if (request !== placesRequest) return
    set((state) => ({ run: { ...state.run, sections: { ...state.run.sections, places: section } } }))
  },

  cancel: () => {
    controller?.abort()
    controller = null
    const { isRunning, followUpLoading, run } = get()
    if (!isRunning && !followUpLoading) return
    set({
      isRunning: false,
      followUpLoading: false,
      run: settleCancelledRun(run, followUpLoading ? 'follow-up' : 'search'),
    })
  },
}))
