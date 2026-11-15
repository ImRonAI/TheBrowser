/**
 * DeepResearchPage (`ron://research` & `ron://research/<sessionId>`):
 * Ren's multi-agent skill formation research environment.
 *
 * - Idle (`sessionId === null` and no selected run): centered hero + `.ron-field` composer +
 *   depth selector + 4 one-click starter briefs.
 * - Active / Completed run: split workbench (`Formation Inspector` + `Research Studio`) when
 *   measured workspace width >= 820px via `useElementWidth`, switching to tabs when narrower
 *   (e.g. when the Agent Panel is open beside it).
 * - Polls `/deep-research/runs` every 5s while mounted so async runs launched by Ren or any
 *   specialist/issue/live agent via `deep_research_start` surface automatically.
 */
import { useEffect, useRef, useState } from 'react'
import { FileText, GitFork } from 'lucide-react'
import {
  DeepResearchFormationView,
  DeepResearchHeaderBar,
  DeepResearchHero,
  DeepResearchReportStudio,
  DeepResearchRunsRail,
} from '@/components/deep-research'
import { useElementWidth } from '@/hooks/useElementWidth'
import { emptyDeepResearchSnapshot } from '@/lib/deep-research-api'
import { useDeepResearchStore, useResearchUserId } from '@/stores/deepResearchStore'
import { cn } from '@/utils/cn'

/** Split Formation Inspector and Research Studio side-by-side at >= 820px of measured workspace width. */
const SPLIT_MIN_WIDTH = 820
/** Dock the Runs rail inline only when total page width leaves >= 820px for the split workbench. */
const DOCK_RAIL_MIN_WIDTH = 1160
const POLL_RUNS_MS = 5000

export function DeepResearchPage({ sessionId = null }: { sessionId?: string | null }) {
  const userId = useResearchUserId()
  const {
    available,
    depths,
    preferredDepth,
    preferredModel,
    topology,
    runs,
    activeSessionId,
    snapshotsBySession,
    starting,
    error,
    setPreferredDepth,
    setPreferredModel,
    setActiveSession,
    init,
    refreshRuns,
    startRun,
    openRun,
    cancelRun,
    deleteRun,
  } = useDeepResearchStore()

  const pageRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const pageWidth = useElementWidth(pageRef)
  const workspaceWidth = useElementWidth(workspaceRef)

  const [railOpen, setRailOpen] = useState(false)
  const [narrowPane, setNarrowPane] = useState<'formation' | 'studio'>('formation')
  const prevRouteSessionRef = useRef<string | null | undefined>(undefined)

  // Initial status + runs fetch, plus periodic 5s poll for background agent-started runs.
  useEffect(() => {
    void init(userId)
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void refreshRuns(userId)
      }
    }, POLL_RUNS_MS)
    return () => window.clearInterval(timer)
  }, [userId, init, refreshRuns])

  // Synchronize URL route `ron://research/<sessionId>` <-> store `activeSessionId`.
  useEffect(() => {
    const prev = prevRouteSessionRef.current
    prevRouteSessionRef.current = sessionId
    if (sessionId) {
      void openRun(sessionId, userId, { syncUrl: false })
    } else if (prev && sessionId === null) {
      setActiveSession(null, false)
    }
  }, [sessionId, userId, openRun, setActiveSession])

  const effectiveSessionId = sessionId ?? activeSessionId
  const activeSnapshot = effectiveSessionId
    ? (snapshotsBySession[effectiveSessionId] ??
      emptyDeepResearchSnapshot(effectiveSessionId, {
        user_id: userId,
        status: 'executing',
        active: true,
      }))
    : null

  // Automatically switch narrow view to Studio when the final report or artifacts finish if user hasn't pinned Formation.
  const hasStudioOutput = Boolean(
    activeSnapshot &&
      (activeSnapshot.report_markdown.trim() ||
        activeSnapshot.slidev_markdown.trim() ||
        activeSnapshot.artifacts?.report_pdf_url ||
        activeSnapshot.artifacts?.slidev_preview_url),
  )
  useEffect(() => {
    if (activeSnapshot && !activeSnapshot.active && hasStudioOutput) {
      setNarrowPane('studio')
    }
  }, [activeSnapshot?.session_id, activeSnapshot?.active, hasStudioOutput])

  const dockedRail = railOpen && pageWidth >= DOCK_RAIL_MIN_WIDTH
  const overlayRail = railOpen && !dockedRail
  const isNarrowSplit = workspaceWidth > 0 && workspaceWidth < SPLIT_MIN_WIDTH
  const isCompactHeader = pageWidth > 0 && pageWidth < 560

  const handleNewResearch = () => {
    setActiveSession(null, true)
    if (overlayRail) setRailOpen(false)
  }

  const handleSelectRun = (id: string) => {
    void openRun(id, userId, { syncUrl: true })
    if (overlayRail) setRailOpen(false)
  }

  const handleDeleteRun = (id: string) => {
    void deleteRun(id, userId)
  }

  return (
    <div
      ref={pageRef}
      className={cn(
        'flex h-full min-h-0 flex-col font-sans text-ink dark:text-ink-inverse',
        activeSnapshot && 'bg-surface-0 dark:bg-surface-900',
      )}
    >
      <DeepResearchHeaderBar
        runs={runs}
        activeSnapshot={activeSnapshot}
        railOpen={railOpen}
        compact={isCompactHeader}
        onToggleRail={() => setRailOpen((prev) => !prev)}
        onNewResearch={handleNewResearch}
      />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {railOpen && (
          <>
            {overlayRail && (
              <div
                aria-hidden
                onClick={() => setRailOpen(false)}
                className="absolute inset-0 z-20 bg-ink/20 backdrop-blur-[1px] dark:bg-black/45"
              />
            )}
            <DeepResearchRunsRail
              runs={runs}
              activeSessionId={effectiveSessionId}
              overlay={overlayRail}
              onSelectRun={handleSelectRun}
              onDeleteRun={handleDeleteRun}
              onNewResearch={handleNewResearch}
              onClose={() => setRailOpen(false)}
            />
          </>
        )}

        <div ref={workspaceRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!activeSnapshot ? (
            <DeepResearchHero
              userId={userId}
              depth={preferredDepth}
              depths={depths}
              preferredModel={preferredModel}
              starting={starting}
              available={available}
              error={error}
              topology={topology}
              containerWidth={workspaceWidth || pageWidth}
              onDepthChange={setPreferredDepth}
              onModelChange={setPreferredModel}
              onSubmit={({ query, depth, context, provider, modelId, reasoningEffort }) => {
                setNarrowPane('formation')
                void startRun({
                  query,
                  userId,
                  depth,
                  context,
                  provider,
                  modelId,
                  reasoningEffort,
                  navigate: true,
                })
              }}
            />
          ) : (
            <>
              {isNarrowSplit && (
                <div
                  role="tablist"
                  aria-label="Deep Research workbench panes"
                  className="flex h-11 shrink-0 items-center justify-center border-b border-surface-200 bg-surface-0 px-3 dark:border-surface-800 dark:bg-surface-900"
                >
                  <div className="inline-flex items-center rounded-full bg-surface-100 p-0.5 dark:bg-surface-800">
                    {(
                      [
                        ['formation', 'Formation', GitFork],
                        ['studio', 'Report Studio', FileText],
                      ] as const
                    ).map(([id, label, Icon]) => {
                      const selected = narrowPane === id
                      return (
                        <button
                          key={id}
                          type="button"
                          role="tab"
                          aria-selected={selected}
                          onClick={() => setNarrowPane(id)}
                          className={cn(
                            'inline-flex h-7 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors',
                            selected
                              ? 'bg-surface-0 text-ink shadow-sm dark:bg-surface-900 dark:text-ink-inverse'
                              : 'text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse',
                          )}
                        >
                          <Icon className={cn('h-3.5 w-3.5', selected && 'text-volt')} aria-hidden />
                          <span>{label}</span>
                          {id === 'formation' && activeSnapshot.active && narrowPane !== 'formation' && (
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-volt" aria-hidden />
                          )}
                          {id === 'studio' && Boolean(activeSnapshot.report_markdown.trim()) && narrowPane !== 'studio' && (
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="flex min-h-0 flex-1">
                <div
                  className={cn(
                    'min-h-0 min-w-0 flex-col',
                    isNarrowSplit
                      ? narrowPane === 'formation'
                        ? 'flex flex-1'
                        : 'hidden'
                      : 'flex w-[clamp(360px,42%,520px)] shrink-0 border-r border-surface-200 dark:border-surface-800',
                  )}
                >
                  <DeepResearchFormationView
                    snapshot={activeSnapshot}
                    topology={topology}
                    onCancel={() => void cancelRun(activeSnapshot.session_id, userId)}
                  />
                </div>

                <div
                  className={cn(
                    'min-h-0 min-w-0 flex-1 flex-col',
                    isNarrowSplit ? (narrowPane === 'studio' ? 'flex' : 'hidden') : 'flex',
                  )}
                >
                  <DeepResearchReportStudio snapshot={activeSnapshot} userId={userId} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default DeepResearchPage

