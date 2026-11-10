import { useEffect, useMemo, useRef, useState } from 'react'
import { History, LoaderCircle } from 'lucide-react'
import { computeDashboard, defaultFlowTypes, type Measure, type ProjectHistory, type RangeKey } from '@/lib/agile-metrics'
import { fetchProjectHistory } from '@/lib/projects-api'
import { projectsRequestFor, projectUtils } from '@/stores/projectsStore'
import { ISSUE_TYPE_CONFIG, type Issue, type Project } from '@/types/projects'
import { cn } from '@/utils/cn'
import { AgingWipChart, CumulativeFlowChart, CycleTimeChart } from './FlowCharts'
import { BurnupChart, ForecastChart, ThroughputChart } from './DeliveryCharts'
import { AttentionLists, KpiRow } from './Overview'
import { VIZ_VARS, formatDate } from './viz'

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 30, label: '30 days' }, { key: 90, label: '90 days' }, { key: 180, label: '180 days' }, { key: 'all', label: 'All time' },
]
const ESTIMATE_UNITS = {
  points: { label: 'Points', unit: 'points' },
  hours: { label: 'Hours', unit: 'hours' },
  effort: { label: 'Effort', unit: 'effort points' },
  items: { label: 'Estimate', unit: 'estimated items' },
} as const

interface HistoryState { projectId: string; history: ProjectHistory | null; loading: boolean; error: string | null }

/** The project's status history; refetched (debounced) whenever one of its issues is saved. */
function useProjectHistory(userId: string | null, projectId: string, revision: string): HistoryState {
  const [state, setState] = useState<HistoryState>({ projectId, history: null, loading: true, error: null })
  const loaded = useRef(false)
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setState((current) => current.projectId === projectId ? { ...current, loading: true } : { projectId, history: null, loading: true, error: null })
    const timer = setTimeout(() => {
      fetchProjectHistory(projectsRequestFor(userId), projectId)
        .then((history) => { if (!cancelled) { loaded.current = true; setState({ projectId, history, loading: false, error: null }) } })
        .catch((error: unknown) => {
          if (!cancelled) setState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Status history could not be loaded.' }))
        })
    }, loaded.current ? 600 : 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [userId, projectId, revision])
  return state
}

function Segmented<T extends string | number>({ label, options, value, onChange }: {
  label: string; options: { key: T; label: string }[]; value: T; onChange: (value: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-full glass-subtle border border-black/5 dark:border-white/10 p-0.5">
      {options.map((option) => (
        <button key={String(option.key)} type="button" aria-pressed={value === option.key} onClick={() => onChange(option.key)}
          className={cn('rounded-full px-3 py-1 text-[11px] font-semibold whitespace-nowrap transition-colors',
            value === option.key ? 'bg-accent/15 text-accent dark:text-accent-light' : 'text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse')}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

function SectionHeading({ title, question }: { title: string; question: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <h2 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">{title}</h2>
      <p className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">{question}</p>
    </div>
  )
}

export function ProjectDashboard({ project, issues, userId, onIssueSelect }: {
  project: Project
  issues: Issue[]
  userId: string | null
  onIssueSelect: (issueId: string) => void
}) {
  const revision = useMemo(() => `${issues.length}:${issues.reduce((sum, issue) => sum + issue.version, 0)}:${Math.max(0, ...issues.map((issue) => issue.updatedAt))}`, [issues])
  const { history, loading, error } = useProjectHistory(userId, project.id, revision)
  const [range, setRange] = useState<RangeKey>(90)
  const [measureChoice, setMeasure] = useState<Measure>('count')
  const [typeChoice, setTypes] = useState<string[] | null>(null)

  const typeLabel = (type: string) => project.settings.issueTypes?.find((definition) => definition.key === type)?.label ?? ISSUE_TYPE_CONFIG[type]?.label ?? type
  const presentTypes = useMemo(() => {
    const order = project.settings.issueTypes?.map((definition) => definition.key as string) ?? Object.keys(ISSUE_TYPE_CONFIG)
    return [...new Set(issues.map((issue) => issue.type as string))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
  }, [issues, project.settings.issueTypes])
  const defaultTypes = useMemo(() => defaultFlowTypes(presentTypes, (type) =>
    project.settings.issueTypes?.find((definition) => definition.key === type)?.level ?? ISSUE_TYPE_CONFIG[type]?.level), [presentTypes, project.settings.issueTypes])
  const types = useMemo(() => {
    const chosen = (typeChoice ?? defaultTypes).filter((type) => presentTypes.includes(type))
    return chosen.length > 0 ? chosen : defaultTypes
  }, [typeChoice, defaultTypes, presentTypes])
  const scoped = useMemo(() => issues.filter((issue) => types.includes(issue.type)), [issues, types])

  const estimate = ESTIMATE_UNITS[projectUtils.getProjectScheme(project).estimateUnit]
  const hasEstimates = scoped.some((issue) => (issue.estimate ?? 0) > 0)
  const measure: Measure = hasEstimates ? measureChoice : 'count'
  const unit = measure === 'count' ? 'items' : estimate.unit

  const transitions = history?.transitions
  const ready = Boolean(history) || Boolean(error)
  const metrics = useMemo(() => ready
    ? computeDashboard({ issues: scoped, transitions: transitions ?? [], now: Date.now(), range, measure })
    : null, [ready, scoped, transitions, range, measure])
  const issueKey = useMemo(() => (issue: Issue) => `${project.key}-${issue.number}`, [project.key])

  const toggleType = (type: string) => {
    const next = types.includes(type) ? types.filter((value) => value !== type) : [...types, type]
    if (next.length > 0) setTypes(next)
  }

  if (issues.length === 0) {
    return (
      <div className="rounded-3xl glass-card border border-white/10 p-6 sm:p-8 shadow-soft">
        <h2 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">No issues yet</h2>
        <p className="mt-2 max-w-xl text-body-sm text-ink-muted dark:text-ink-inverse-muted">
          The dashboard charts flow, cycle time, throughput and a delivery forecast from your issues and their status changes.
          Create issues and move them across the board to see them here.
        </p>
      </div>
    )
  }

  return (
    <div className={cn(VIZ_VARS, 'space-y-6')}>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Time range" options={RANGES} value={range} onChange={setRange} />
        {hasEstimates && (
          <Segmented label="Measure" value={measure} onChange={setMeasure}
            options={[{ key: 'count' as Measure, label: 'Items' }, { key: 'estimate' as Measure, label: estimate.label }]} />
        )}
        {presentTypes.length > 1 && (
          <div role="group" aria-label="Issue types" className="flex min-w-0 flex-wrap items-center gap-1.5">
            {presentTypes.map((type) => (
              <button key={type} type="button" aria-pressed={types.includes(type)} onClick={() => toggleType(type)}
                className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors border',
                  types.includes(type)
                    ? 'border-accent/30 bg-accent/10 text-accent dark:text-accent-light'
                    : 'border-black/5 dark:border-white/10 text-ink-muted dark:text-ink-inverse-muted hover:text-ink dark:hover:text-ink-inverse')}>
                {typeLabel(type)}
              </button>
            ))}
          </div>
        )}
        <p className="flex items-center gap-1.5 text-[11px] text-ink-muted dark:text-ink-inverse-muted sm:ml-auto">
          {loading ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : <History aria-hidden className="size-3.5" />}
          {loading && !history ? 'Loading status history…'
            : error ? `Status history unavailable (${error}); charts use creation and last-update dates.`
            : history?.truncated && history.since ? `History before ${formatDate(history.since)} is not loaded.`
            : `${history?.transitions.length ?? 0} status changes`}
        </p>
      </div>

      {metrics ? (
        <div className={cn('space-y-6 transition-opacity', loading && 'opacity-60')} aria-busy={loading}>
          <KpiRow metrics={metrics} unit={unit} />

          <section className="space-y-3">
            <SectionHeading title="Needs attention" question="What should the team act on today?" />
            <AttentionLists metrics={metrics} issueKey={issueKey} onIssueSelect={onIssueSelect} />
          </section>

          <section className="space-y-3">
            <SectionHeading title="Flow" question="Is work moving, and what is getting stuck?" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <CumulativeFlowChart metrics={metrics} unit={unit} />
              <AgingWipChart metrics={metrics} issueKey={issueKey} onIssueSelect={onIssueSelect} />
              <CycleTimeChart metrics={metrics} issueKey={issueKey} onIssueSelect={onIssueSelect} className="md:col-span-2 xl:col-span-1" />
            </div>
          </section>

          <section className="space-y-3">
            <SectionHeading title="Delivery" question="How much gets finished, and when will the rest be done?" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <ThroughputChart metrics={metrics} unit={unit} measure={measure} />
              <BurnupChart metrics={metrics} unit={unit} />
              <ForecastChart metrics={metrics} className="md:col-span-2 xl:col-span-1" />
            </div>
          </section>

          {metrics.inferredCount > 0 && !error && (
            <p className="text-[11px] text-ink-muted dark:text-ink-inverse-muted">
              {metrics.inferredCount} {metrics.inferredCount === 1 ? 'issue has' : 'issues have'} no recorded status history; {metrics.inferredCount === 1 ? 'it is' : 'they are'} charted from creation and last-update dates.
            </p>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-3xl glass-card border border-white/10 p-6 text-body-sm text-ink-muted dark:text-ink-inverse-muted shadow-soft">
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          Loading the project's status history…
        </div>
      )}
    </div>
  )
}
