import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Issue, Project } from '@/types/projects'
import {
  TIMELINE_RANGE_LABELS, defaultTimelineCursor, issueKey, layoutTimeline, stepTimelineCursor, timelineTicks, timelineWindow,
  type TimelineRange, type TimelineRow,
} from '@/lib/execute-issues'
import { IssueTypeBadge } from '@/components/projects/badges'
import { SURFACE, STATUS_FILL, shortDate } from './IssueBits'
import { cn } from '@/utils/cn'
import { BLOCKED_BAR, BlockedTag } from '@/components/projects/BlockedTag'
import { useIssueBlocking } from '@/hooks/useIssueBlocking'

interface ExecuteTimelineProps {
  issues: Issue[]
  projects: Project[]
  now: number
  onOpen: (issueId: string) => void
}

const RANGES = Object.keys(TIMELINE_RANGE_LABELS) as TimelineRange[]
const LABEL_COLUMN = 'md:grid-cols-[minmax(11rem,15rem)_minmax(0,1fr)]'

function tickLabel(at: number, unit: 'week' | 'month' | 'quarter', now: number) {
  const date = new Date(at)
  if (unit === 'week') return shortDate(at, now)
  if (unit === 'quarter') return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`
  return date.toLocaleDateString(undefined, { month: 'short', ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: '2-digit' } : {}) })
}

function spanText(row: TimelineRow, now: number) {
  if (row.span.milestone) return row.issue.dueDate ? `Due ${shortDate(row.span.start, now)}` : shortDate(row.span.start, now)
  return `${shortDate(row.span.start, now)} – ${shortDate(row.span.end, now)}`
}

/**
 * Gantt-style bars from each issue's real start/end/due dates, grouped by project. Issues with no dates
 * are counted, never drawn. On narrow widths each row stacks its label above its bar.
 */
export function ExecuteTimeline({ issues, projects, now, onOpen }: ExecuteTimelineProps) {
  const [range, setRange] = useState<TimelineRange>('fit')
  const [cursor, setCursor] = useState(() => defaultTimelineCursor(new Date(now)))
  const frame = useMemo(() => timelineWindow(issues, range, cursor, new Date(now)), [issues, range, cursor, now])
  const layout = useMemo(() => layoutTimeline(issues, projects, frame), [issues, projects, frame])
  const ticks = useMemo(() => timelineTicks(frame), [frame])
  const byId = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const blockingFor = useIssueBlocking()
  const total = frame.end - frame.start
  const todayPct = now >= frame.start && now < frame.end ? ((now - frame.start) / total) * 100 : null
  const windowLabel = `${shortDate(frame.start, now)} – ${shortDate(frame.end - 1, now)}`

  return (
    <section aria-label="Timeline" className={cn(SURFACE, 'min-w-0 overflow-hidden p-4 sm:p-6')}>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="mr-auto min-w-0">
          <h2 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">Timeline</h2>
          <p className="mt-0.5 text-[11px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">{windowLabel}</p>
        </div>
        {range !== 'fit' && (
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous range" onClick={() => setCursor((value) => stepTimelineCursor(value, range, -1))}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-surface-200 text-ink-secondary hover:bg-surface-50 dark:border-surface-800 dark:text-ink-inverse-secondary dark:hover:bg-surface-850">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setCursor(defaultTimelineCursor(new Date(now)))}
              className="h-8 rounded-lg border border-surface-200 px-3 text-[12px] font-medium text-ink-secondary hover:bg-surface-50 dark:border-surface-800 dark:text-ink-inverse-secondary dark:hover:bg-surface-850">
              Today
            </button>
            <button type="button" aria-label="Next range" onClick={() => setCursor((value) => stepTimelineCursor(value, range, 1))}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-surface-200 text-ink-secondary hover:bg-surface-50 dark:border-surface-800 dark:text-ink-inverse-secondary dark:hover:bg-surface-850">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
        <div role="group" aria-label="Range" className="flex items-center gap-0.5 rounded-lg bg-surface-100 p-0.5 dark:bg-surface-800">
          {RANGES.map((value) => (
            <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}
              className={cn('h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors',
                range === value ? 'bg-surface-0 text-ink shadow-sm dark:bg-surface-700 dark:text-ink-inverse' : 'text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse')}>
              {TIMELINE_RANGE_LABELS[value]}
            </button>
          ))}
        </div>
      </header>

      {layout.groups.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-surface-200 px-4 py-8 text-center text-body-sm text-ink-muted dark:border-surface-800 dark:text-ink-inverse-muted">
          {layout.outside > 0 ? 'No scheduled issues in this range.' : 'None of these issues has a start, end or due date yet.'}
        </p>
      ) : (
        <div className="mt-5">
          {/* Axis: aligned with the bar column from md up. */}
          <div className={cn('hidden gap-x-4 px-1 md:grid', LABEL_COLUMN)}>
            <div />
            <div className="relative h-6 border-b border-surface-200 dark:border-surface-800">
              {ticks.map((tick) => (
                <span key={tick.at} className="absolute bottom-1 -translate-x-1/2 whitespace-nowrap text-[10px] tabular-nums text-ink-muted dark:text-ink-inverse-muted" style={{ left: `${tick.pct}%` }}>
                  {tickLabel(tick.at, tick.unit, now)}
                </span>
              ))}
            </div>
          </div>
          {layout.groups.map((group) => (
            <div key={group.projectId} className="mt-4 first:mt-3">
              <h3 className="flex items-baseline gap-2 border-b border-surface-200 pb-1.5 text-[12px] font-semibold text-ink dark:border-surface-800 dark:text-ink-inverse">
                <span className="font-mono">{group.project?.key ?? 'Unknown project'}</span>
                <span className="truncate font-normal text-ink-secondary dark:text-ink-inverse-secondary">{group.project?.name}</span>
                <span className="ml-auto shrink-0 text-[11px] font-normal tabular-nums text-ink-muted dark:text-ink-inverse-muted">{group.rows.length}</span>
              </h3>
              <ul>
                {group.rows.map((row) => { const blocking = blockingFor(row.issue); return (
                  <li key={row.issue.id}>
                    <button type="button" onClick={() => onOpen(row.issue.id)}
                      className={cn('grid w-full grid-cols-1 items-center gap-x-4 gap-y-1.5 rounded-lg px-1 py-2 text-left transition-colors hover:bg-surface-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 dark:hover:bg-surface-850', LABEL_COLUMN)}>
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">{issueKey(row.issue, byId)}</span>
                          <span className="truncate text-body-sm font-medium text-ink dark:text-ink-inverse">{row.issue.title}</span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-2 text-[11px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">
                          <IssueTypeBadge type={row.issue.type} className="px-1.5 py-0 text-[9px]" />
                          {spanText(row, now)}
                          {blocking.blocked && <BlockedTag label={blocking.label} className="shrink-0" />}
                        </span>
                      </span>
                      <span title={blocking.label || undefined} className={cn('relative block h-5 overflow-hidden rounded-md',
                        blocking.blocked ? 'bg-rose-500/[0.07] ring-1 ring-inset ring-rose-500/20 dark:bg-rose-400/[0.07] dark:ring-rose-300/15' : 'bg-surface-100/70 dark:bg-surface-800/60')}>
                        {ticks.map((tick) => <span key={tick.at} aria-hidden className="absolute inset-y-0 w-px bg-surface-200 dark:bg-surface-700/70" style={{ left: `${tick.pct}%` }} />)}
                        {todayPct !== null && <span aria-hidden className="absolute inset-y-0 z-10 w-0.5 bg-danger/70" style={{ left: `${todayPct}%` }} />}
                        {row.span.milestone ? (
                          <span aria-hidden className={cn('absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px]', blocking.blocked ? BLOCKED_BAR : STATUS_FILL[row.issue.status])}
                            style={{ left: `${row.leftPct}%` }} />
                        ) : (
                          <span aria-hidden className={cn('absolute top-1/2 -translate-y-1/2 rounded-full', blocking.blocked ? cn('h-3', BLOCKED_BAR) : cn('h-2.5', STATUS_FILL[row.issue.status]),
                            row.clippedStart && 'rounded-l-none', row.clippedEnd && 'rounded-r-none')}
                            style={{ left: `${row.leftPct}%`, width: `${row.widthPct}%`, minWidth: 6 }} />
                        )}
                      </span>
                    </button>
                  </li>
                )})}
              </ul>
            </div>
          ))}
        </div>
      )}

      {(layout.unscheduled > 0 || layout.outside > 0) && (
        <p className="mt-4 text-[11px] text-ink-muted dark:text-ink-inverse-muted">
          {[layout.unscheduled > 0 && `${layout.unscheduled} without dates`, layout.outside > 0 && `${layout.outside} outside this range`].filter(Boolean).join(' · ')}
        </p>
      )}
    </section>
  )
}
