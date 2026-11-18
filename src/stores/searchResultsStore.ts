/**
 * Search Results Store
 *
 * Concurrent search runs keyed by `runKey` (`searchRunKey(q, level, contextId)`) so multiple
 * split `ron://search` panes stream simultaneously without aborting or overwriting each other,
 * while top-level fields (`run`, `runKey`, `isRunning`, `followUpLoading`, `startedAt`, `fatal`)
 * continue mirroring the active/latest run for single-pane callers.
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
import type { PromptAttachment } from '@/lib/prompt-attachments'

export interface SearchLocationHint {
  location?: string
  latitude?: number
  longitude?: number
}

export interface SearchRunSlot {
  run: SearchRunState
  isRunning: boolean
  followUpLoading: boolean
  startedAt: number | null
  fatal: { code: string; message: string } | null
}

interface SearchResultsState {
  run: SearchRunState
  /** `searchRunKey(q, level)` of the latest active run; null before the first search. */
  runKey: string | null
  isRunning: boolean
  followUpLoading: boolean
  startedAt: number | null
  fatal: { code: string; message: string } | null
  /** Concurrent run slots keyed by `searchRunKey(q, level, contextId)` for split panes. */
  runsByKey: Record<string, SearchRunSlot>
  start: (
    q: string,
    level: SearchLevel,
    opts?: {
      country?: string
      location?: SearchLocationHint
      contextId?: string | null
      attachments?: PromptAttachment[]
    },
  ) => void
  sendFollowUp: (
    message: string,
    opts?: { country?: string; location?: SearchLocationHint; key?: string },
  ) => Promise<void>
  refreshPlaces: (q: string, opts: { country: string; location?: string | null; key?: string }) => Promise<void>
  cancel: (key?: string) => void
}

const controllers = new Map<string, AbortController>()
const placesRequestByKey = new Map<string, number>()

function mirrorTopLevel(
  state: SearchResultsState,
  key: string,
  slot: SearchRunSlot,
  forcePrimary = false,
): Partial<SearchResultsState> {
  const runsByKey = { ...state.runsByKey, [key]: slot }
  if (forcePrimary || state.runKey === key || state.runKey === null) {
    return {
      runsByKey,
      runKey: key,
      run: slot.run,
      isRunning: slot.isRunning,
      followUpLoading: slot.followUpLoading,
      startedAt: slot.startedAt,
      fatal: slot.fatal,
    }
  }
  return { runsByKey }
}

export const useSearchResultsStore = create<SearchResultsState>()((set, get) => ({
  run: initialRunState(),
  runKey: null,
  isRunning: false,
  followUpLoading: false,
  startedAt: null,
  fatal: null,
  runsByKey: {},

  start: (q, level, opts) => {
    const key = searchRunKey(q, level, opts?.contextId)
    get().cancel(key)
    placesRequestByKey.set(key, (placesRequestByKey.get(key) ?? 0) + 1)

    const next = new AbortController()
    controllers.set(key, next)

    const initialSlot: SearchRunSlot = {
      run: { ...initialRunState(), activeQuestion: q },
      isRunning: true,
      followUpLoading: false,
      startedAt: Date.now(),
      fatal: null,
    }

    set((state) => mirrorTopLevel(state, key, initialSlot, true))

    void streamSearch(
      {
        q,
        level,
        ...(opts?.country ? { country: opts.country } : {}),
        ...(opts?.location ? { location: opts.location } : {}),
        ...(opts?.attachments?.length ? { prompt_attachments: opts.attachments } : {}),
      },
      (event) => {
        if (next.signal.aborted) return
        set((state) => {
          const currentSlot = state.runsByKey[key] ?? initialSlot
          const nextSlot: SearchRunSlot = {
            ...currentSlot,
            run: applySearchEvent(currentSlot.run, event),
          }
          return mirrorTopLevel(state, key, nextSlot)
        })
      },
      next.signal,
    )
      .then(() => {
        if (controllers.get(key) === next && !next.signal.aborted) {
          controllers.delete(key)
          set((state) => {
            const currentSlot = state.runsByKey[key]
            if (!currentSlot) return state
            return mirrorTopLevel(state, key, {
              ...currentSlot,
              isRunning: false,
              followUpLoading: false,
            })
          })
        }
      })
      .catch((error: unknown) => {
        if (next.signal.aborted) return
        if (controllers.get(key) === next) controllers.delete(key)
        const record = error as { code?: string; message?: string }
        set((state) => {
          const currentSlot = state.runsByKey[key] ?? initialSlot
          return mirrorTopLevel(state, key, {
            ...currentSlot,
            isRunning: false,
            followUpLoading: false,
            fatal: { code: record?.code || 'error', message: record?.message || 'Search failed' },
          })
        })
      })
  },

  sendFollowUp: async (message, opts) => {
    const trimmed = message.trim()
    if (!trimmed) return
    const current = get()
    const key = opts?.key ?? current.runKey
    if (!key) return

    const existingSlot = current.runsByKey[key] ?? {
      run: current.run,
      isRunning: current.isRunning,
      followUpLoading: current.followUpLoading,
      startedAt: current.startedAt,
      fatal: current.fatal,
    }

    if (existingSlot.isRunning) {
      current.cancel(key)
    }

    const next = new AbortController()
    controllers.set(key, next)

    const latestSlot = get().runsByKey[key] ?? existingSlot
    const level = (latestSlot.run.meta?.level as SearchLevel | undefined) ?? DEFAULT_SEARCH_LEVEL
    const country = opts?.country || latestSlot.run.meta?.country || 'US'
    const sessionId = latestSlot.run.sessionId

    set((state) => {
      const slot = state.runsByKey[key] ?? latestSlot
      return mirrorTopLevel(state, key, {
        ...slot,
        run: beginFollowUpState(slot.run, trimmed),
        isRunning: true,
        followUpLoading: true,
        fatal: null,
      })
    })

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
          set((state) => {
            const slot = state.runsByKey[key]
            if (!slot) return state
            return mirrorTopLevel(state, key, {
              ...slot,
              run: applySearchEvent(slot.run, event),
            })
          })
        },
        next.signal,
      )
      if (controllers.get(key) === next && !next.signal.aborted) {
        controllers.delete(key)
        set((state) => {
          const slot = state.runsByKey[key]
          if (!slot) return state
          return mirrorTopLevel(state, key, {
            ...slot,
            isRunning: false,
            followUpLoading: false,
          })
        })
      }
    } catch (error: unknown) {
      if (next.signal.aborted) return
      if (controllers.get(key) === next) controllers.delete(key)
      const record = error as { code?: string; message?: string }
      set((state) => {
        const slot = state.runsByKey[key]
        if (!slot) return state
        return mirrorTopLevel(state, key, {
          ...slot,
          isRunning: false,
          followUpLoading: false,
          run: {
            ...slot.run,
            agent: {
              ...slot.run.agent,
              status: 'error',
              error: {
                source: 'agent',
                code: record?.code || 'error',
                message: record?.message || 'Follow-up failed',
              },
            },
          },
        })
      })
    }
  },

  refreshPlaces: async (q, opts) => {
    const key = opts.key ?? get().runKey
    if (!key) return
    const request = (placesRequestByKey.get(key) ?? 0) + 1
    placesRequestByKey.set(key, request)

    set((state) => {
      const slot = state.runsByKey[key]
      if (!slot) return state
      const sections = { ...slot.run.sections }
      delete sections.places
      return mirrorTopLevel(state, key, { ...slot, run: { ...slot.run, sections } })
    })

    let section: FeedSection
    try {
      const feed = await fetchDiscoverFeed(placesRefreshRequest(q, opts))
      section = feed.sections.find((entry) => entry.kind === 'places') ?? {
        kind: 'places',
        q,
        status: 'error',
        items: [],
        error: { code: 'malformed', message: 'The places search returned no results section' },
      }
    } catch (error: unknown) {
      const record = error as { code?: string; message?: string; status?: number }
      section = {
        kind: 'places',
        q,
        status: 'error',
        items: [],
        error: {
          code: record?.code || 'error',
          message: record?.message || 'Places search failed',
          status: record?.status ?? null,
        },
      }
    }

    if (placesRequestByKey.get(key) !== request) return
    set((state) => {
      const slot = state.runsByKey[key]
      if (!slot) return state
      return mirrorTopLevel(state, key, {
        ...slot,
        run: { ...slot.run, sections: { ...slot.run.sections, places: section } },
      })
    })
  },

  cancel: (explicitKey) => {
    const key = explicitKey ?? get().runKey
    if (!key) return
    const ctrl = controllers.get(key)
    if (ctrl) {
      ctrl.abort()
      controllers.delete(key)
    }
    const slot = get().runsByKey[key]
    if (!slot || (!slot.isRunning && !slot.followUpLoading)) return
    set((state) => {
      const latest = state.runsByKey[key]
      if (!latest) return state
      return mirrorTopLevel(state, key, {
        ...latest,
        isRunning: false,
        followUpLoading: false,
        run: settleCancelledRun(latest.run, latest.followUpLoading ? 'follow-up' : 'search'),
      })
    })
  },
}))
