/**
 * Search Results Store
 *
 * One live search run: POST /search/stream (agent/api/endpoints/search.py) folded
 * through the pure reducer in src/lib/search-api.ts. A new search aborts the previous
 * one; unmounting the results page cancels the stream.
 */
import { create } from 'zustand'
import {
  DEFAULT_SEARCH_LEVEL,
  applySearchEvent,
  beginFollowUpState,
  initialRunState,
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
  isRunning: boolean
  followUpLoading: boolean
  startedAt: number | null
  /** Fatal failure before/around the stream itself (unreachable backend, 503, ...). */
  fatal: { code: string; message: string } | null
  start: (q: string, level: SearchLevel, opts?: { country?: string; location?: SearchLocationHint }) => void
  sendFollowUp: (message: string, opts?: { country?: string; location?: SearchLocationHint }) => Promise<void>
  cancel: () => void
}

let controller: AbortController | null = null

export const useSearchResultsStore = create<SearchResultsState>()((set, get) => ({
  run: initialRunState(),
  isRunning: false,
  followUpLoading: false,
  startedAt: null,
  fatal: null,

  start: (q, level, opts) => {
    get().cancel()
    const next = new AbortController()
    controller = next
    set({
      run: { ...initialRunState(), activeQuestion: q },
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

  cancel: () => {
    controller?.abort()
    controller = null
    if (get().isRunning || get().followUpLoading) set({ isRunning: false, followUpLoading: false })
  },
}))
