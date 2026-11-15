/**
 * Deep Research header bar and collapsible Runs drawer/rail.
 * Provides quick access to active & historical runs (including async runs launched by Ren
 * via `deep_research_start`), status indicators, depth badges, citation counts, and deletion.
 */
import { History, Plus, Trash2, X } from 'lucide-react'
import { RenMark } from '@/components/brand'
import type { DeepResearchRunStatus, DeepResearchSnapshot } from '@/lib/deep-research-api'
import { relativeTime } from '@/lib/threads-api'
import { cn } from '@/utils/cn'

function capitalizeLabel(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
}

function RunStatusDot({ status, active }: { status: DeepResearchRunStatus; active: boolean }) {
  if (active || status === 'executing' || status === 'pending') {
    return (
      <span className="relative flex h-2 w-2 shrink-0" aria-label="Executing">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-volt opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-volt" />
      </span>
    )
  }
  if (status === 'completed') {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-label="Completed" />
  }
  if (status === 'failed') {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" aria-label="Failed" />
  }
  if (status === 'interrupted') {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-label="Interrupted" />
  }
  return <span className="h-2 w-2 shrink-0 rounded-full bg-surface-400 dark:bg-surface-600" aria-label="Cancelled" />
}

export interface DeepResearchHeaderBarProps {
  runs: DeepResearchSnapshot[]
  activeSnapshot: DeepResearchSnapshot | null
  railOpen: boolean
  compact: boolean
  onToggleRail: () => void
  onNewResearch: () => void
}

export function DeepResearchHeaderBar({
  runs,
  activeSnapshot,
  railOpen,
  compact,
  onToggleRail,
  onNewResearch,
}: DeepResearchHeaderBarProps) {
  const executingCount = runs.filter((r) => r.active || r.status === 'executing').length

  return (
    <header
      className={cn(
        'flex h-12 shrink-0 items-center justify-between gap-3 px-4 font-sans transition-colors',
        activeSnapshot
          ? 'border-b border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-900'
          : 'border-b border-ink/[0.06] bg-surface-0/50 backdrop-blur-md dark:border-white/[0.07] dark:bg-surface-900/40',
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={onToggleRail}
          aria-expanded={railOpen}
          aria-label="Toggle research runs history"
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 font-sans text-[12.5px] font-medium transition-colors duration-150',
            railOpen
              ? 'border-blurple-600/40 bg-blurple-600/10 text-ink dark:border-blurple-400/40 dark:bg-blurple-400/15 dark:text-ink-inverse'
              : 'border-ink/[0.08] bg-surface-0/70 text-ink-secondary hover:bg-surface-100/80 hover:text-ink dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-ink-inverse-secondary dark:hover:bg-white/[0.08] dark:hover:text-ink-inverse',
          )}
        >
          <History className={cn('h-3.5 w-3.5', railOpen && 'text-volt')} aria-hidden />
          <span>Runs</span>
          {runs.length > 0 && (
            <span className="rounded-full bg-ink/[0.06] px-1.5 py-px font-sans text-[11px] font-medium tabular-nums text-ink-secondary dark:bg-white/[0.08] dark:text-ink-inverse-secondary">
              {runs.length}
            </span>
          )}
          {executingCount > 0 && (
            <span className="relative flex h-2 w-2" title={`${executingCount} active formation run`}>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-volt opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-volt" />
            </span>
          )}
        </button>

        {activeSnapshot ? (
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="text-surface-300 dark:text-surface-700">/</span>
            <RenMark className="h-4 w-4 shrink-0" />
            <span className="truncate font-sans text-[13px] font-semibold text-ink dark:text-ink-inverse">
              {activeSnapshot.title || activeSnapshot.query || 'Deep Research'}
            </span>
            {!compact && (
              <span className="shrink-0 rounded-full bg-surface-100 px-2 py-0.5 font-sans text-[11px] font-medium text-ink-secondary dark:bg-surface-800 dark:text-ink-inverse-secondary">
                {capitalizeLabel(activeSnapshot.depth)}
              </span>
            )}
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <RenMark className="h-4 w-4 shrink-0" />
            <span className="truncate font-sans text-[13px] font-medium text-ink-secondary dark:text-ink-inverse-secondary">
              Research
            </span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {activeSnapshot && (
          <button
            type="button"
            onClick={onNewResearch}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-blurple-600 px-3.5 font-sans text-[12.5px] font-medium text-white transition-colors duration-150 hover:bg-blurple-700 active:bg-blurple-800 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
            <span>{compact ? 'New' : 'New research'}</span>
          </button>
        )}
      </div>
    </header>
  )
}

export interface DeepResearchRunsRailProps {
  runs: DeepResearchSnapshot[]
  activeSessionId: string | null
  overlay: boolean
  onSelectRun: (sessionId: string) => void
  onDeleteRun: (sessionId: string) => void
  onNewResearch: () => void
  onClose: () => void
}

export function DeepResearchRunsRail({
  runs,
  activeSessionId,
  overlay,
  onSelectRun,
  onDeleteRun,
  onNewResearch,
  onClose,
}: DeepResearchRunsRailProps) {
  return (
    <aside
      aria-label="Deep Research runs"
      className={cn(
        'ron-glass-panel flex h-full w-[288px] shrink-0 flex-col border-r border-surface-200 bg-surface-50/90 font-sans backdrop-blur-xl dark:border-surface-800 dark:bg-surface-900/90',
        overlay && 'ron-popover absolute inset-y-0 left-0 z-30 shadow-float',
      )}
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-surface-200 px-3.5 dark:border-surface-800">
        <span className="font-sans text-[12.5px] font-semibold text-ink dark:text-ink-inverse">
          Research runs
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onNewResearch}
            className="inline-flex h-6 items-center gap-1 rounded-md px-2 font-sans text-[12px] font-medium text-volt transition-colors hover:bg-blurple-600/10 dark:hover:bg-blurple-400/15"
          >
            <Plus className="h-3 w-3" aria-hidden />
            New
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close runs drawer"
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-200/70 hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-surface-800 dark:hover:text-ink-inverse"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-thin">
        {runs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-surface-200 px-3.5 py-6 text-center dark:border-surface-800">
            <p className="font-sans text-[12.5px] font-medium text-ink-secondary dark:text-ink-inverse-secondary">
              No research runs yet.
            </p>
            <p className="mt-1 font-sans text-[11.5px] leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
              Runs started here or asynchronously by Ren appear automatically.
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {runs.map((run) => {
              const selected = run.session_id === activeSessionId
              return (
                <li key={run.session_id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onSelectRun(run.session_id)}
                    aria-current={selected ? 'true' : undefined}
                    className={cn(
                      'flex w-full flex-col gap-1.5 rounded-xl border px-3 py-2.5 pr-8 text-left transition-colors duration-150',
                      selected
                        ? 'border-blurple-600/40 bg-blurple-600/[0.08] text-ink dark:border-blurple-400/40 dark:bg-blurple-400/[0.12] dark:text-ink-inverse'
                        : 'border-transparent text-ink-secondary hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-850 dark:hover:text-ink-inverse',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <RunStatusDot status={run.status} active={run.active} />
                      <span className="min-w-0 flex-1 truncate font-sans text-[12.5px] font-medium text-ink dark:text-ink-inverse">
                        {run.title || run.query || 'Untitled research'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pl-4 font-sans text-[11px] text-ink-muted dark:text-ink-inverse-muted">
                      <span className="rounded-md bg-surface-200/70 px-1.5 py-px font-medium text-ink-secondary dark:bg-surface-800 dark:text-ink-inverse-secondary">
                        {capitalizeLabel(run.depth)}
                      </span>
                      <span>·</span>
                      <span className="tabular-nums">{run.citations.length} sources</span>
                      <span>·</span>
                      <span>{relativeTime(run.updated_at || run.created_at)}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteRun(run.session_id)
                    }}
                    title="Delete research run"
                    aria-label={`Delete ${run.title || run.query || 'research run'}`}
                    className="absolute right-2 top-2.5 flex h-6 w-6 items-center justify-center rounded-md text-ink-muted opacity-0 transition-opacity hover:bg-rose-500/10 hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100 dark:text-ink-inverse-muted dark:hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
