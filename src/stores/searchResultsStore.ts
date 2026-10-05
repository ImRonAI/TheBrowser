/**
 * Search Results Store
 *
 * One live search run: POST /search/stream (agent/api/endpoints/search.py) folded
 * through the pure reducer in src/lib/search-api.ts. A new search aborts the previous
 * one; unmounting the results page cancels the stream.
 */
import { create } from 'zustand'
import {
  applySearchEvent,
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
  startedAt: number | null
  /** Fatal failure before/around the stream itself (unreachable backend, 503, ...). */
  fatal: { code: string; message: string } | null
  start: (q: string, level: SearchLevel, opts?: { country?: string; location?: SearchLocationHint }) => void
  cancel: () => void
}

let controller: AbortController | null = null

export const useSearchResultsStore = create<SearchResultsState>()((set, get) => ({
  run: initialRunState(),
  isRunning: false,
  startedAt: null,
  fatal: null,

  start: (q, level, opts) => {
    get().cancel()
    const next = new AbortController()
    controller = next
    set({ run: initialRunState(), isRunning: true, startedAt: Date.now(), fatal: null })
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
        if (controller === next && !next.signal.aborted) set({ isRunning: false })
      })
      .catch((error: unknown) => {
        if (next.signal.aborted) return
        const record = error as { code?: string; message?: string }
        set({
          isRunning: false,
          fatal: { code: record?.code || 'error', message: record?.message || 'Search failed' },
        })
      })
  },

  cancel: () => {
    controller?.abort()
    controller = null
    if (get().isRunning) set({ isRunning: false })
  },
}))
