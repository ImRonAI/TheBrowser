/**
 * Deep Research store: the runs, the open run's snapshot folded from its Strands events, and one
 * SSE stream per running run (started here or by an agent's `deep_research_start`).
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEFAULT_AGENT_MODEL, type AgentModelSelection } from '@/components/agent-panel/ModelSelector'
import { openInternalUrl } from '@/components/board/task-detail/editor/extensions/blocks/workspace'
import {
  DEFAULT_FORMATION_TOPOLOGY,
  DEFAULT_RESEARCH_DEPTH,
  RESEARCH_DEPTHS,
  cancelDeepResearchRun,
  deleteDeepResearchRun,
  fetchDeepResearchStatus,
  getDeepResearchRun,
  listDeepResearchRuns,
  normalizeDeepResearchSnapshot,
  parseResearchUrl,
  reduceDeepResearchEvent,
  researchUrl,
  startDeepResearchRun,
  streamDeepResearchEvents,
  type DeepResearchEvent,
  type DeepResearchSelection,
  type DeepResearchSnapshot,
  type FormationTopology,
  type ResearchDepth,
} from '@/lib/deep-research-api'
import { useAuthStore } from '@/stores/authStore'
import { useTabStore } from '@/stores/tabStore'

/** Resolve the active account's user id using the same convention as `usePanelChat` and `ThreadsList`. */
export function resolveResearchUserId(explicit?: string | null): string {
  if (explicit && explicit.trim()) return explicit.trim()
  return useAuthStore.getState().user?.id || 'default'
}

export function useResearchUserId(): string {
  return useAuthStore((state) => state.user?.id || 'default')
}

interface StartRunParams {
  query: string
  userId?: string
  depth?: ResearchDepth
  context?: string
  provider?: string | null
  modelId?: string | null
  reasoningEffort?: string | null
  navigate?: boolean
}

export interface DeepResearchState {
  available: boolean
  statusChecked: boolean
  defaultSelection: DeepResearchSelection
  topology: FormationTopology
  depths: ResearchDepth[]
  preferredDepth: ResearchDepth
  preferredModel: AgentModelSelection
  /** The Formation tab as the agent graph or as the stage list. */
  formationView: 'graph' | 'list'
  runs: DeepResearchSnapshot[]
  activeSessionId: string | null
  snapshotsBySession: Record<string, DeepResearchSnapshot>
  streamingSessions: Record<string, boolean>
  loadingRuns: boolean
  starting: boolean
  error: string | null

  setPreferredDepth: (depth: ResearchDepth) => void
  setPreferredModel: (selection: AgentModelSelection) => void
  setFormationView: (view: 'graph' | 'list') => void
  clearError: () => void
  setActiveSession: (sessionId: string | null, syncUrl?: boolean) => void
  init: (userId?: string) => Promise<void>
  refreshRuns: (userId?: string) => Promise<void>
  startRun: (params: StartRunParams) => Promise<DeepResearchSnapshot | null>
  openRun: (sessionId: string, userId?: string, options?: { syncUrl?: boolean }) => Promise<void>
  cancelRun: (sessionId: string, userId?: string) => Promise<void>
  deleteRun: (sessionId: string, userId?: string) => Promise<void>
  disconnectAllStreams: () => void
}

const activeControllers = new Map<string, AbortController>()

function syncResearchTabUrl(sessionId: string | null): void {
  const target = researchUrl(sessionId)
  const tabState = useTabStore.getState()
  const currentUrl = tabState.tabs.find((t) => t.id === tabState.activeTabId)?.url
  if (currentUrl === target) return
  // Only rewrite the active tab's URL if we are already inside Deep Research or explicitly opening it.
  if (currentUrl && parseResearchUrl(currentUrl) === null && sessionId === null) {
    openInternalUrl(target)
    return
  }
  openInternalUrl(target)
}

function upsertRunInList(
  runs: readonly DeepResearchSnapshot[],
  updated: DeepResearchSnapshot,
): DeepResearchSnapshot[] {
  const filtered = runs.filter((item) => item.session_id !== updated.session_id)
  return [updated, ...filtered].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export const useDeepResearchStore = create<DeepResearchState>()(
  persist(
    (set, get) => {
      const applyEvent = (sessionId: string, event: DeepResearchEvent) => {
        const current = get().snapshotsBySession[sessionId]
        if (!current) return
        const nextSnapshot = reduceDeepResearchEvent(current, event)
        if (nextSnapshot === current) return
        set((state) => ({
          snapshotsBySession: {
            ...state.snapshotsBySession,
            [sessionId]: nextSnapshot,
          },
          runs: upsertRunInList(state.runs, nextSnapshot),
        }))
      }

      const attachStream = (sessionId: string, userId: string, initialAfter?: number) => {
        if (activeControllers.has(sessionId)) return
        const controller = new AbortController()
        activeControllers.set(sessionId, controller)
        set((state) => ({
          streamingSessions: { ...state.streamingSessions, [sessionId]: true },
        }))

        const refresh = async (signal?: AbortSignal) => {
          const fresh = await getDeepResearchRun(sessionId, userId, { signal })
          set((state) => ({
            snapshotsBySession: { ...state.snapshotsBySession, [sessionId]: fresh },
            runs: upsertRunInList(state.runs, fresh),
          }))
          return fresh
        }

        const pump = async () => {
          let cursor = initialAfter ?? get().snapshotsBySession[sessionId]?.sequence ?? 0
          try {
            for (let attempt = 0; attempt < 3 && !controller.signal.aborted; attempt++) {
              const { finished, lastSequence } = await streamDeepResearchEvents(sessionId, userId, {
                after: cursor,
                signal: controller.signal,
                onEvent: (event) => applyEvent(sessionId, event),
              })
              cursor = Math.max(cursor, lastSequence)
              if (finished || controller.signal.aborted) break
              // The stream closed before the run ended: reload the run and stream on from it.
              const fresh = await refresh(controller.signal)
              if (!fresh.active) break
              cursor = fresh.sequence
            }
          } catch (err) {
            if (!controller.signal.aborted) set({ error: err instanceof Error ? err.message : String(err) })
          } finally {
            if (activeControllers.get(sessionId) === controller) activeControllers.delete(sessionId)
            set((state) => {
              const nextStreaming = { ...state.streamingSessions }
              delete nextStreaming[sessionId]
              return { streamingSessions: nextStreaming }
            })
            // The finished run's status, workspace files, report and deck.
            if (!controller.signal.aborted) void refresh().catch(() => undefined)
          }
        }

        void pump()
      }

      return {
        available: true,
        statusChecked: false,
        defaultSelection: { provider: null, model_id: null, reasoning_effort: null },
        topology: DEFAULT_FORMATION_TOPOLOGY,
        depths: [...RESEARCH_DEPTHS],
        preferredDepth: DEFAULT_RESEARCH_DEPTH,
        preferredModel: { model: DEFAULT_AGENT_MODEL, provider: '', effort: '' },
        formationView: 'graph',
        runs: [],
        activeSessionId: null,
        snapshotsBySession: {},
        streamingSessions: {},
        loadingRuns: false,
        starting: false,
        error: null,

        setPreferredDepth: (depth) => set({ preferredDepth: depth }),
        setPreferredModel: (selection) => set({ preferredModel: selection }),
        setFormationView: (view) => set({ formationView: view }),
        clearError: () => set({ error: null }),

        setActiveSession: (sessionId, syncUrl = true) => {
          set({ activeSessionId: sessionId, error: null })
          if (syncUrl) syncResearchTabUrl(sessionId)
        },

        init: async (explicitUserId) => {
          const userId = resolveResearchUserId(explicitUserId)
          await Promise.all([
            fetchDeepResearchStatus()
              .then((status) => {
                set({
                  available: status.available,
                  statusChecked: true,
                  defaultSelection: status.default_selection,
                  depths: status.depths,
                  topology: status.topology,
                })
              })
              .catch(() => {
                set({ statusChecked: true })
              }),
            get().refreshRuns(userId),
          ])
        },

        refreshRuns: async (explicitUserId) => {
          const userId = resolveResearchUserId(explicitUserId)
          set({ loadingRuns: true })
          try {
            const listed = await listDeepResearchRuns(userId, { limit: 50 })
            set((state) => {
              const nextMap = { ...state.snapshotsBySession }
              const mergedRuns = listed.map((item) => {
                // A run with a live stream attached is ahead of this poll: its events already built a
                // newer state (and the agents' transcripts), which an older listing must not replace.
                const streamed = activeControllers.has(item.session_id) ? nextMap[item.session_id] : undefined
                if (streamed) return streamed
                const merged = normalizeDeepResearchSnapshot(item, nextMap[item.session_id])
                nextMap[item.session_id] = merged
                return merged
              })
              return {
                runs: mergedRuns,
                snapshotsBySession: nextMap,
                loadingRuns: false,
              }
            })
            // If the user is currently viewing an active background run (e.g. started by Ren via `deep_research_start`),
            // attach its live SSE stream automatically.
            const activeId = get().activeSessionId
            if (activeId) {
              const snap = get().snapshotsBySession[activeId]
              if (snap?.active && !activeControllers.has(activeId)) {
                attachStream(activeId, userId, snap.sequence)
              }
            }
          } catch {
            set({ loadingRuns: false })
          }
        },

        startRun: async (params) => {
          const query = params.query.trim()
          if (!query || get().starting) return null
          const userId = resolveResearchUserId(params.userId)
          const depth = params.depth ?? get().preferredDepth
          set({ starting: true, error: null })
          try {
            const snapshot = await startDeepResearchRun({
              query,
              user_id: userId,
              depth,
              context: params.context?.trim() || undefined,
              provider: params.provider || undefined,
              model_id: params.modelId || undefined,
              reasoning_effort: params.reasoningEffort || undefined,
            })
            set((state) => ({
              starting: false,
              activeSessionId: snapshot.session_id,
              snapshotsBySession: {
                ...state.snapshotsBySession,
                [snapshot.session_id]: snapshot,
              },
              runs: upsertRunInList(state.runs, snapshot),
            }))
            if (params.navigate !== false) {
              syncResearchTabUrl(snapshot.session_id)
            }
            if (snapshot.active) {
              attachStream(snapshot.session_id, userId, snapshot.sequence)
            }
            return snapshot
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            set({ starting: false, error: message })
            return null
          }
        },

        openRun: async (sessionId, explicitUserId, options) => {
          const trimmed = sessionId.trim()
          if (!trimmed) return
          const userId = resolveResearchUserId(explicitUserId)
          set({ activeSessionId: trimmed, error: null })
          if (options?.syncUrl !== false) {
            syncResearchTabUrl(trimmed)
          }
          try {
            const merged = await getDeepResearchRun(trimmed, userId)
            set((state) => ({
              snapshotsBySession: {
                ...state.snapshotsBySession,
                [trimmed]: merged,
              },
              runs: upsertRunInList(state.runs, merged),
            }))
            if (merged.active) {
              attachStream(trimmed, userId, merged.sequence)
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            set({ error: message })
          }
        },

        cancelRun: async (sessionId, explicitUserId) => {
          const userId = resolveResearchUserId(explicitUserId)
          try {
            const merged = await cancelDeepResearchRun(sessionId, userId, {}, get().snapshotsBySession[sessionId])
            const controller = activeControllers.get(sessionId)
            if (controller) {
              controller.abort()
              activeControllers.delete(sessionId)
            }
            set((state) => {
              const nextStreaming = { ...state.streamingSessions }
              delete nextStreaming[sessionId]
              return {
                snapshotsBySession: {
                  ...state.snapshotsBySession,
                  [sessionId]: merged,
                },
                runs: upsertRunInList(state.runs, merged),
                streamingSessions: nextStreaming,
              }
            })
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            set({ error: message })
          }
        },

        deleteRun: async (sessionId, explicitUserId) => {
          const userId = resolveResearchUserId(explicitUserId)
          const controller = activeControllers.get(sessionId)
          if (controller) {
            controller.abort()
            activeControllers.delete(sessionId)
          }
          try {
            await deleteDeepResearchRun(sessionId, userId)
            const wasActive = get().activeSessionId === sessionId
            set((state) => {
              const nextMap = { ...state.snapshotsBySession }
              delete nextMap[sessionId]
              const nextStreaming = { ...state.streamingSessions }
              delete nextStreaming[sessionId]
              return {
                runs: state.runs.filter((item) => item.session_id !== sessionId),
                snapshotsBySession: nextMap,
                streamingSessions: nextStreaming,
                activeSessionId: wasActive ? null : state.activeSessionId,
              }
            })
            if (wasActive) {
              syncResearchTabUrl(null)
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            set({ error: message })
          }
        },

        disconnectAllStreams: () => {
          for (const controller of activeControllers.values()) {
            controller.abort()
          }
          activeControllers.clear()
          set({ streamingSessions: {} })
        },
      }
    },
    {
      name: 'ron-deep-research-prefs',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        preferredDepth: state.preferredDepth,
        preferredModel: state.preferredModel,
        formationView: state.formationView,
      }),
    },
  ),
)

