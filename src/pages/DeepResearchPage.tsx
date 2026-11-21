/**
 * DeepResearchPage (`ron://research` & `ron://research/<sessionId>`):
 * Ren's multi-agent skill formation research environment.
 *
 * - Idle (`sessionId === null` and no selected run): centered hero + `.ron-field` composer +
 *   depth selector + 4 one-click starter briefs.
 * - Active / Completed run: two full-width tabs, `Formation` (the agent graph, or the stage list)
 *   and `Report Studio`, which a run that writes no report names after what it makes (DataGrid, Web App, Website,
 *   Mobile App).
 * - Polls `/deep-research/runs` every 5s while mounted so async runs launched by Ren or any
 *   specialist/issue/live agent via `deep_research_start` surface automatically.
 */
import { useEffect, useRef, useState } from 'react'
import { FileText, GitFork } from 'lucide-react'
import {
  DeepResearchFormationWorkbench,
  DeepResearchHeaderBar,
  DeepResearchHero,
  DeepResearchReportStudio,
  DeepResearchRunsRail,
  madeOutcome,
} from '@/components/deep-research'
import { useElementWidth } from '@/hooks/useElementWidth'
import { DEFAULT_SQUAD_OUTCOME, emptyDeepResearchSnapshot } from '@/lib/deep-research-api'
import { useDeepResearchStore, useResearchUserId } from '@/stores/deepResearchStore'
import { cn } from '@/utils/cn'

/** Dock the Runs rail inline only when the page is wide enough to keep the workbench roomy beside it. */
const DOCK_RAIL_MIN_WIDTH = 1160
const POLL_RUNS_MS = 5000

export function DeepResearchPage({ sessionId = null }: { sessionId?: string | null }) {
  const userId = useResearchUserId()
  const {
    available,
    defaultSelection,
    depths,
    preferredDepth,
    preferredModel,
    formationView,
    topology,
    topologies,
    outcomes,
    preferredOutcome,
    runs,
    activeSessionId,
    snapshotsBySession,
    starting,
    error,
    setPreferredDepth,
    setPreferredOutcome,
    setPreferredModel,
    setFormationView,
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
  const [pane, setPane] = useState<'formation' | 'studio'>('formation')
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
        status: 'running',
        active: true,
      }))
    : null

  // What a run that writes no report makes: its Studio tab carries that name and shows the spreadsheet, or the
  // app OpenCode built.
  const made = madeOutcome(activeSnapshot?.outcome)

  // Switch to the Studio tab when the final report, the spreadsheet, the artifacts or the app are ready.
  const hasStudioOutput = Boolean(
    activeSnapshot &&
      (activeSnapshot.report_markdown.trim() ||
        activeSnapshot.slidev_markdown.trim() ||
        activeSnapshot.grid_json.trim() ||
        activeSnapshot.artifacts?.report_pdf_url ||
        activeSnapshot.artifacts?.slidev_preview_url ||
        activeSnapshot.application),
  )
  useEffect(() => {
    if (activeSnapshot && !activeSnapshot.active && hasStudioOutput) {
      setPane('studio')
    }
  }, [activeSnapshot?.session_id, activeSnapshot?.active, hasStudioOutput])

  const dockedRail = railOpen && pageWidth >= DOCK_RAIL_MIN_WIDTH
  const overlayRail = railOpen && !dockedRail
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
              outcome={outcomes.includes(preferredOutcome) ? preferredOutcome : DEFAULT_SQUAD_OUTCOME}
              outcomes={outcomes}
              preferredModel={preferredModel}
              defaultSelection={defaultSelection}
              starting={starting}
              available={available}
              error={error}
              topology={topology}
              containerWidth={workspaceWidth || pageWidth}
              onDepthChange={setPreferredDepth}
              onOutcomeChange={setPreferredOutcome}
              onModelChange={setPreferredModel}
              onSubmit={({ query, depth, outcome, context, provider, modelId, reasoningEffort }) => {
                setPane('formation')
                void startRun({
                  query,
                  userId,
                  depth,
                  outcome,
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
              <div
                  role="tablist"
                  aria-label="Squad workbench panes"
                  className="flex h-11 shrink-0 items-center justify-center border-b border-surface-200 bg-surface-0 px-3 dark:border-surface-800 dark:bg-surface-900"
                >
                  <div className="inline-flex items-center rounded-full bg-surface-100 p-0.5 dark:bg-surface-800">
                    {(
                      [
                        ['formation', 'Formation', GitFork],
                        ['studio', made?.label ?? 'Report Studio', made?.icon ?? FileText],
                      ] as const
                    ).map(([id, label, Icon]) => {
                      const selected = pane === id
                      return (
                        <button
                          key={id}
                          type="button"
                          role="tab"
                          aria-selected={selected}
                          onClick={() => setPane(id)}
                          className={cn(
                            'inline-flex h-7 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors',
                            selected
                              ? 'bg-surface-0 text-ink shadow-sm dark:bg-surface-900 dark:text-ink-inverse'
                              : 'text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse',
                          )}
                        >
                          <Icon className={cn('h-3.5 w-3.5', selected && 'text-volt')} aria-hidden />
                          <span>{label}</span>
                          {id === 'formation' && activeSnapshot.active && pane !== 'formation' && (
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-volt" aria-hidden />
                          )}
                          {id === 'studio' && Boolean(activeSnapshot.report_markdown.trim() || activeSnapshot.application) && pane !== 'studio' && (
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                          )}
                        </button>
                      )
                    })}
                  </div>
              </div>

              <div className="flex min-h-0 flex-1">
                <div
                  className={cn(
                    'min-h-0 min-w-0 flex-col',
                    pane === 'formation' ? 'flex flex-1' : 'hidden',
                  )}
                >
                  {/* Mounted only while shown: the canvas measures and fits itself to a visible box. */}
                  {pane === 'formation' && (
                    <DeepResearchFormationWorkbench
                      snapshot={activeSnapshot}
                      topology={(activeSnapshot.outcome && topologies[activeSnapshot.outcome]) || topology}
                      view={formationView}
                      onViewChange={setFormationView}
                      onCancel={() => void cancelRun(activeSnapshot.session_id, userId)}
                    />
                  )}
                </div>

                <div
                  className={cn(
                    'min-h-0 min-w-0 flex-1 flex-col',
                    pane === 'studio' ? 'flex' : 'hidden',
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

