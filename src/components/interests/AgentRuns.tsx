import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { RenMark } from '@/components/brand'
import { useAgentUi } from '@/context/AgentUiContext'
import { agoLabel, plainSummary, runErrorLine, runHeadline, runNotifications, runStatusLabel, type AgentRun } from '@/lib/context-api'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { useInterestsStore } from '@/stores/interestsStore'
import { usePanelAgentStore } from '@/stores/panelAgentStore'
import { cn } from '@/utils/cn'
import { iconButton, mutedText, primaryButton, sectionLabel } from './contextUi'

const EASE = [0.19, 1, 0.22, 1] as const

/**
 * Review a specialist's run: open its session in the Agent Panel. The panel restores the session's pinned agent
 * (`selection.agent`), so the user reads the run and keeps talking to that specialist in the same conversation.
 */
export function useReviewRun() {
  const { openPanel } = useAgentUi()
  return useCallback((run: AgentRun) => {
    usePanelAgentStore.getState().requestThread(run.session_id)
    openPanel()
    const store = useContextAgentStore.getState()
    if (!run.seen_at) void store.markRunSeen(run.id)
    store.yieldToPanel()
  }, [openPanel])
}

/** Re-render once a minute so "5 min ago" stays true. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function runText(run: AgentRun): string {
  return run.status === 'failed' && run.error ? runErrorLine(run.error) : plainSummary(run.summary)
}

/** The Context Agent's notification above the orb: the newest finished run the user has not opened. */
export function AgentRunNotice() {
  const runs = useContextAgentStore((state) => state.runs)
  const draftsWaiting = useContextAgentStore((state) => state.replyDrafts.length > 0)
  const notices = useMemo(() => runNotifications(runs), [runs])
  const review = useReviewRun()
  const now = useNow()
  const cardRef = useRef<HTMLDivElement>(null)
  const run = notices[0]
  useLayoutEffect(() => {
    const el = cardRef.current
    const report = (window as { contextSurface?: { reportMetrics?: (m: { noticeHeight?: number }) => void } }).contextSurface?.reportMetrics
    if (!el || !report || draftsWaiting) return
    const sync = () => report({ noticeHeight: Math.ceil(el.getBoundingClientRect().height) })
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => observer.disconnect()
  }, [run?.id, notices.length, draftsWaiting])

  if (!run || draftsWaiting) return null
  const text = runText(run)
  const more = notices.length - 1
  const openAgents = () => {
    useContextAgentStore.getState().setTab('agents')
    useInterestsStore.getState().setExpanded(true)
  }

  return (
    <motion.div
      ref={cardRef}
      key={run.id}
      role="status"
      aria-live="polite"
      aria-label={`${run.agent_name || 'Your agent'}: ${runHeadline(run)}`}
      data-testid="agent-run-notice"
      initial={{ y: 8, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 8, opacity: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      className="fixed bottom-[84px] right-5 z-40 w-[300px]"
    >
      {/* The surface lives on an inner layer: `ron-glass-panel` positions itself relatively in Glass. */}
      <div className="ron-glass-panel rounded-xl border border-surface-200 bg-surface-0 p-3 text-ink shadow-float dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse">
      <div className="flex items-start gap-2.5">
        <RenMark className="mt-0.5 h-6 w-6 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{run.agent_name || 'Your agent'}</p>
          <p className={cn('text-[12px]', run.status === 'failed' ? 'text-red-700 dark:text-red-300' : 'text-ink-secondary dark:text-ink-inverse-secondary')}>
            {runHeadline(run)} · {agoLabel(run.finished_at ?? run.started_at, now)}
          </p>
        </div>
        <button type="button" onClick={() => void useContextAgentStore.getState().markRunSeen(run.id)} aria-label="Dismiss notification" title="Dismiss" className={cn(iconButton, '-mr-1 -mt-1')}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {text && <p className={cn('mt-2 line-clamp-3', mutedText)}>{text}</p>}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        {more > 0
          ? <button type="button" onClick={openAgents} className="text-[12px] font-medium text-ink-secondary underline-offset-2 hover:underline dark:text-ink-inverse-secondary">{more} more {more === 1 ? 'run' : 'runs'}</button>
          : <span />}
        <button type="button" onClick={() => review(run)} title="Open this run in the Agent Panel" className={primaryButton}>Review</button>
      </div>
      </div>
    </motion.div>
  )
}

/** The Agents tab's run list: every recent run, unopened finished ones marked. */
export function RecentRuns() {
  const runs = useContextAgentStore((state) => state.runs)
  const review = useReviewRun()
  const now = useNow()
  if (!runs.length) return null

  return <section aria-label="Agent runs" className="space-y-2">
    <h3 className={sectionLabel}>Runs</h3>
    <ul className="space-y-1.5">
      {runs.slice(0, 8).map((run) => {
        const fresh = run.status !== 'running' && !run.seen_at
        const text = runText(run)
        return <li key={run.id} data-testid="agent-run" className="flex items-start gap-2.5 rounded-xl border border-surface-200 px-3 py-2 dark:border-surface-800">
          <span aria-hidden className={cn('mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full', fresh ? 'bg-blurple-600 dark:bg-blurple-400' : 'bg-transparent')} />
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-2">
              <span className="truncate text-[13px] font-semibold text-ink dark:text-ink-inverse">{run.agent_name || 'Agent'}</span>
              <span className={cn('flex-shrink-0 text-[11px]', run.status === 'failed' ? 'text-red-700 dark:text-red-300' : 'text-ink-muted dark:text-ink-inverse-muted')}>
                {runStatusLabel(run.status)} · {agoLabel(run.finished_at ?? run.started_at, now)}{run.trigger === 'schedule' ? ' · scheduled' : ''}
              </span>
            </p>
            {text && <p className={cn('line-clamp-2', mutedText)}>{text}</p>}
          </div>
          <button type="button" onClick={() => review(run)} title="Open this run in the Agent Panel"
            className="inline-flex h-7 flex-shrink-0 items-center rounded-lg px-2.5 text-[12px] font-semibold text-blurple-700 transition-colors hover:bg-blurple-600/10 dark:text-blurple-300 dark:hover:bg-blurple-400/15">
            {run.status === 'running' ? 'Watch' : 'Review'}
          </button>
        </li>
      })}
    </ul>
  </section>
}
