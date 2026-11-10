import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, CalendarClock, OctagonAlert, TriangleAlert } from 'lucide-react'
import { MIN_FINISHED_FOR_PERCENTILES, type DashboardMetrics } from '@/lib/agile-metrics'
import { ISSUE_STATUS_CONFIG, type Issue } from '@/types/projects'
import { cn } from '@/utils/cn'
import { formatDate, formatDays, formatNumber, plural } from './viz'

// ── KPI row ──────────────────────────────────────────────────────────────────

function StatTile({ label, value, detail, flag }: { label: string; value: string; detail: ReactNode; flag?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl glass-card border border-white/10 px-4 py-3 shadow-soft">
      <p className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 text-xl sm:text-2xl font-semibold text-ink dark:text-ink-inverse">
        {flag}
        <span className="min-w-0 break-words">{value}</span>
      </p>
      <div className="mt-1 text-[11px] leading-snug text-ink-muted dark:text-ink-inverse-muted">{detail}</div>
    </div>
  )
}

function Delta({ current, previous }: { current: number; previous: number }) {
  const change = current - previous
  if (change === 0) return <span>Same as the 14 days before</span>
  const up = change > 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-medium', up ? 'text-success dark:text-emerald-400' : 'text-danger dark:text-red-400')}>
      <Icon aria-hidden className="size-3.5" />
      {up ? '+' : '−'}{formatNumber(Math.abs(change))} vs the 14 days before
    </span>
  )
}

export function KpiRow({ metrics, unit }: { metrics: DashboardMetrics; unit: string }) {
  const { kpis, cycle, forecast, aging, littles, due } = metrics
  const byStatus = (status: 'in-progress' | 'review' | 'blocked') => aging.filter((item) => item.status === status).length
  const dueSoon = due.filter((item) => !item.overdue).length
  const oldestBlocked = metrics.blocked[0]
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
      <StatTile label="Work in progress" value={formatNumber(kpis.wip)}
        detail={<>
          {byStatus('in-progress')} in progress · {byStatus('review')} in review
          {littles && littles.impliedCycleDays !== null && <span className="block" title="Little's Law: average cycle time = average WIP ÷ average throughput">
            Little's Law: {formatNumber(littles.avgWip)} avg WIP ÷ {formatNumber(littles.throughputPerDay)}/day ≈ {formatDays(Math.round(littles.impliedCycleDays))}
          </span>}
        </>} />
      <StatTile label="Finished, last 14 days" value={`${formatNumber(kpis.throughput14)} ${unit}`}
        detail={<Delta current={kpis.throughput14} previous={kpis.throughputPrev14} />} />
      <StatTile label="Cycle time, median" value={cycle ? formatDays(cycle.p50) : '—'}
        detail={cycle
          ? <>85% within {formatDays(cycle.p85)} · {plural(cycle.count, 'item')}{cycle.count < MIN_FINISHED_FOR_PERCENTILES && ' (small sample)'}</>
          : 'No item with a recorded start finished in this range'} />
      <StatTile label="Blocked" value={formatNumber(kpis.blocked)}
        flag={kpis.blocked > 0 ? <><OctagonAlert aria-hidden className="size-5 shrink-0 text-danger dark:text-red-400" /><span className="sr-only">Needs attention:</span></> : undefined}
        detail={oldestBlocked ? `Oldest blocked for ${formatDays(oldestBlocked.days)}` : 'Nothing is blocked'} />
      <StatTile label="Overdue" value={formatNumber(kpis.overdue)}
        flag={kpis.overdue > 0 ? <><CalendarClock aria-hidden className="size-5 shrink-0 text-danger dark:text-red-400" /><span className="sr-only">Past due:</span></> : undefined}
        detail={dueSoon > 0 ? `${dueSoon} more due within 7 days` : 'Nothing else due within 7 days'} />
      <StatTile label="Forecast, 85% likely" value={forecast.dates ? formatDate(forecast.dates.p85) : forecast.status === 'done' ? 'Done' : '—'}
        detail={forecast.dates
          ? `${plural(forecast.remaining, 'open item')} · 50% by ${formatDate(forecast.dates.p50)}`
          : forecast.status === 'done' ? 'No open items of the selected types' : forecast.reason} />
    </div>
  )
}

// ── Needs attention ──────────────────────────────────────────────────────────

interface Row { issue: Issue; meta: string; flag?: string }

function AttentionList({ title, icon, rows, empty, issueKey, onIssueSelect, limit = 6 }: {
  title: string
  icon: ReactNode
  rows: Row[]
  empty: string
  issueKey: (issue: Issue) => string
  onIssueSelect: (issueId: string) => void
  limit?: number
}) {
  return (
    <section className="min-w-0 rounded-3xl glass-card border border-white/10 p-4 sm:p-5 shadow-soft">
      <h3 className="flex items-center gap-2 text-body-sm font-semibold text-ink dark:text-ink-inverse">
        {icon}
        {title}
        <span className="ml-auto rounded-full bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink-secondary dark:text-ink-inverse-secondary">{rows.length}</span>
      </h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-body-xs text-ink-muted dark:text-ink-inverse-muted">{empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-black/5 dark:divide-white/5">
          {rows.slice(0, limit).map((row) => (
            <li key={row.issue.id}>
              <button type="button" onClick={() => onIssueSelect(row.issue.id)}
                className="group flex w-full min-w-0 items-start gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-100/60 dark:hover:bg-surface-800/60 transition-colors">
                <span className="mt-0.5 shrink-0 text-[11px] font-semibold tabular-nums text-ink-muted dark:text-ink-inverse-muted">{issueKey(row.issue)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm text-ink group-hover:text-accent dark:text-ink-inverse dark:group-hover:text-accent-light">{row.issue.title}</span>
                  <span className="mt-0.5 block text-[11px] text-ink-muted dark:text-ink-inverse-muted">{row.meta}</span>
                  {row.flag && (
                    <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-danger dark:text-red-400">
                      <TriangleAlert aria-hidden className="size-3" />
                      {row.flag}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > limit && (
        <p className="mt-2 px-2 text-[11px] text-ink-muted dark:text-ink-inverse-muted">+{rows.length - limit} more; see the board or list view.</p>
      )}
    </section>
  )
}

export function AttentionLists({ metrics, issueKey, onIssueSelect }: {
  metrics: DashboardMetrics
  issueKey: (issue: Issue) => string
  onIssueSelect: (issueId: string) => void
}) {
  const p85 = metrics.cycle && metrics.cycle.count >= MIN_FINISHED_FOR_PERCENTILES ? metrics.cycle.p85 : null
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <AttentionList title="Blocked" issueKey={issueKey} onIssueSelect={onIssueSelect}
        icon={<OctagonAlert aria-hidden className="size-4 text-danger dark:text-red-400" />}
        empty="Nothing is blocked."
        rows={metrics.blocked.map((item) => ({ issue: item.issue, meta: `Blocked since ${formatDate(item.since)} · ${formatDays(item.days)}` }))} />
      <AttentionList title="Overdue and due soon" issueKey={issueKey} onIssueSelect={onIssueSelect}
        icon={<CalendarClock aria-hidden className="size-4 text-ink-muted dark:text-ink-inverse-muted" />}
        empty="No open item is overdue or due in the next 7 days."
        rows={metrics.due.map((item) => ({
          issue: item.issue,
          meta: `${ISSUE_STATUS_CONFIG[item.issue.status].label} · due ${formatDate(item.due)}`,
          flag: item.overdue ? `${item.days === 0 ? 'Due earlier today' : `${formatDays(item.days)} overdue`}` : undefined,
        }))} />
      <AttentionList title="Oldest work in progress" issueKey={issueKey} onIssueSelect={onIssueSelect}
        icon={<TriangleAlert aria-hidden className="size-4 text-ink-muted dark:text-ink-inverse-muted" />}
        empty="Nothing is in progress, in review or blocked."
        rows={metrics.aging.map((item) => ({
          issue: item.issue,
          meta: `${ISSUE_STATUS_CONFIG[item.status].label} · ${formatDays(item.ageDays)} since work started`,
          flag: item.pace === 'past-85' && p85 !== null ? `Older than 85% of finished items (${formatDays(p85)})` : undefined,
        }))} />
    </div>
  )
}
