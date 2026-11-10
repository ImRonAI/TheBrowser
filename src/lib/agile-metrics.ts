/**
 * Agile flow metrics for one project, from its issues and their status history
 * (`GET /projects/{id}/history`). Pure functions with relative `.ts` imports so
 * `node --experimental-strip-types --test src/lib/agile-metrics.test.ts` runs them.
 *
 * Definitions followed:
 * - Cumulative flow: issues per status at the end of each day, finished work at the
 *   bottom (Atlassian Jira, "What is the cumulative flow diagram?").
 * - Burnup: total scope vs completed work over time, by issue count or estimate
 *   (Atlassian Jira, "Burnup Chart").
 * - Throughput: items finished per period (ActionableAgile "Throughput Run Chart");
 *   summed estimates per period are velocity (Atlassian Jira "Velocity Chart").
 * - Cycle time: (end date - start date) + 1 calendar days, from the first entry into
 *   a started status to the final entry into done; lead time starts at creation
 *   (ActionableAgile "Cycle Time Scatterplot"; Atlassian Jira "Control Chart").
 * - Percentiles: "85% of items finished in N days or less" (nearest rank).
 * - Aging WIP: age of in-flight items counted like cycle time, read against the
 *   finished-item percentiles (ActionableAgile "Aging Work in Progress").
 * - Monte Carlo "when": resample daily throughput (zero days included) until the
 *   remaining items are done, many times; report the 50/85/95th percentile days
 *   (ActionableAgile "Monte Carlo: When"; Vacanti, "When Will It Be Done?").
 * - Little's Law: average cycle time = average WIP / average throughput (Vacanti).
 */
import type { Issue, IssueStatus } from '../types/projects.ts'

export const DAY_MS = 86_400_000
/** Statuses between the commitment point and done: work in progress. */
export const WIP_STATUSES = ['in-progress', 'review', 'blocked'] as const
export type WipStatus = typeof WIP_STATUSES[number]
/** Bottom-to-top band order of the cumulative flow diagram (done at the bottom, arrivals on top). */
export const FLOW_BANDS: readonly IssueStatus[] = ['done', 'review', 'in-progress', 'blocked', 'backlog']
/** ActionableAgile needs at least 10 completed items before it computes pace percentiles. */
export const MIN_FINISHED_FOR_PERCENTILES = 10
/** A Monte Carlo forecast samples at least two weeks of daily throughput. */
export const MIN_FORECAST_DAYS = 14

export type Measure = 'count' | 'estimate'
export type RangeKey = 30 | 90 | 180 | 'all'

export interface IssueTransition {
  issueId: string
  at: number
  status: IssueStatus
  estimate: number | null
  type: string | null
}

export interface ProjectHistory {
  transitions: IssueTransition[]
  rowsRead: number
  /** The server stopped at its row cap; history before `since` is missing. */
  truncated: boolean
  since: number | null
}

/** `GET /projects/{id}/history` response row shape → renderer shape. */
export function mapHistory(body: { transitions?: Record<string, unknown>[]; rows_read?: number; truncated?: boolean; since?: number | null }): ProjectHistory {
  const transitions = (body.transitions ?? []).flatMap((row) => typeof row.issue_id === 'string' && typeof row.at === 'number' && typeof row.status === 'string'
    ? [{ issueId: row.issue_id, at: row.at, status: row.status as IssueStatus,
        estimate: typeof row.estimate === 'number' ? row.estimate : null, type: typeof row.type === 'string' ? row.type : null }]
    : [])
  return { transitions, rowsRead: body.rows_read ?? transitions.length, truncated: body.truncated === true, since: body.since ?? null }
}

// ── Calendar days (local time) ───────────────────────────────────────────────

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function addDays(ms: number, days: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime()
}

/** Whole calendar days from `a` to `b` (DST-safe). */
export function daysBetween(a: number, b: number): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS)
}

/** Calendar days counting both ends, so an item started and finished the same day takes 1 day. */
export function elapsedDays(start: number, end: number): number {
  return daysBetween(start, end) + 1
}

const endOfDay = (dayStart: number) => addDays(dayStart, 1) - 1

// ── Timelines ────────────────────────────────────────────────────────────────

export interface IssueEvent { at: number; status: IssueStatus; estimate: number | null }

export interface IssueTimeline {
  issue: Issue
  created: number
  /** Ascending; the first event is the issue's state at creation. */
  events: IssueEvent[]
  /** First entry into in-progress, review or blocked; undefined if the issue never started. */
  started?: number
  /** Final entry into done, when the issue is done now. */
  finished?: number
  /** No audit row was available: inferred from createdAt, the current status and updatedAt. */
  inferred: boolean
}

const isWip = (status: IssueStatus): status is WipStatus => (WIP_STATUSES as readonly string[]).includes(status)

export function buildTimelines(issues: Issue[], transitions: IssueTransition[]): IssueTimeline[] {
  const byIssue = new Map<string, IssueTransition[]>()
  for (const transition of transitions) {
    const list = byIssue.get(transition.issueId)
    if (list) list.push(transition)
    else byIssue.set(transition.issueId, [transition])
  }
  return issues.map((issue) => {
    const estimate = issue.estimate ?? null
    const rows = [...(byIssue.get(issue.id) ?? [])].sort((a, b) => a.at - b.at)
    const inferred = rows.length === 0
    let events: IssueEvent[]
    if (inferred) {
      events = issue.status === 'done' && issue.updatedAt > issue.createdAt
        ? [{ at: issue.createdAt, status: 'backlog', estimate }, { at: issue.updatedAt, status: 'done', estimate }]
        : [{ at: issue.createdAt, status: issue.status, estimate }]
    } else {
      events = rows.map(({ at, status, estimate: value }) => ({ at, status, estimate: value }))
      // History truncated after creation: the earliest known state stands for the first one.
      if (events[0].at > issue.createdAt) events.unshift({ ...events[0], at: issue.createdAt })
      const last = events[events.length - 1]
      // A save not in the fetched history yet: the issue row is the latest state.
      if (last.status !== issue.status || last.estimate !== estimate)
        events.push({ at: Math.max(issue.updatedAt, last.at), status: issue.status, estimate })
    }
    events = events.filter((event, index) => index === 0 ||
      event.status !== events[index - 1].status || event.estimate !== events[index - 1].estimate)
    const started = events.find((event) => isWip(event.status))?.at
    let finished: number | undefined
    if (issue.status === 'done') {
      for (let index = events.length - 1; index >= 0; index--) {
        if (events[index].status !== 'done') break
        finished = events[index].at
      }
    }
    return { issue, created: events[0].at, events, started, finished, inferred }
  })
}

/** The issue's state at time `t`, or undefined before it existed. */
export function stateAt(timeline: IssueTimeline, t: number): IssueEvent | undefined {
  let state: IssueEvent | undefined
  for (const event of timeline.events) {
    if (event.at > t) break
    state = event
  }
  return state
}

const weightOf = (measure: Measure, estimate: number | null) => measure === 'count' ? 1 : (estimate ?? 0)

// ── Range ────────────────────────────────────────────────────────────────────

/**
 * First day of the charted window. A fixed range never starts before the first item was created: days
 * before the project had any work would draw flat zero bands and feed empty days to the forecast.
 */
export function rangeStart(range: RangeKey, timelines: IssueTimeline[], now: number): number {
  const today = startOfDay(now)
  let first = today
  for (const timeline of timelines) first = Math.min(first, startOfDay(timeline.created))
  if (range === 'all') return first
  const window = addDays(today, -(range - 1))
  return timelines.length ? Math.max(window, first) : window
}

export function dayList(from: number, now: number): number[] {
  const days: number[] = []
  const today = startOfDay(now)
  for (let day = startOfDay(from); day <= today; day = addDays(day, 1)) days.push(day)
  return days
}

/** At most `max` evenly spaced entries, always keeping the last (today). */
export function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items
  const step = Math.ceil(items.length / max)
  return items.filter((_, index) => (items.length - 1 - index) % step === 0)
}

// ── Cumulative flow and burnup ───────────────────────────────────────────────

export type FlowPoint = { day: number } & Record<IssueStatus, number>

/** Items (or estimate) in each status at the end of each day. */
export function cumulativeFlow(timelines: IssueTimeline[], days: number[], measure: Measure = 'count'): FlowPoint[] {
  return days.map((day) => {
    const point: FlowPoint = { day, backlog: 0, 'in-progress': 0, review: 0, blocked: 0, done: 0 }
    const end = endOfDay(day)
    for (const timeline of timelines) {
      const state = stateAt(timeline, end)
      if (state) point[state.status] += weightOf(measure, state.estimate)
    }
    return point
  })
}

export interface BurnupPoint { day: number; scope: number; done: number }

/** Total scope (every issue that exists) and completed work (done) at the end of each day. */
export function burnup(timelines: IssueTimeline[], days: number[], measure: Measure = 'count'): BurnupPoint[] {
  return days.map((day) => {
    const end = endOfDay(day)
    let scope = 0
    let done = 0
    for (const timeline of timelines) {
      const state = stateAt(timeline, end)
      if (!state) continue
      const weight = weightOf(measure, state.estimate)
      scope += weight
      if (state.status === 'done') done += weight
    }
    return { day, scope, done }
  })
}

// ── Throughput ───────────────────────────────────────────────────────────────

export interface ThroughputBucket { start: number; end: number; value: number; items: number }

/** Items (or estimate = velocity) finished in consecutive 7-day periods ending today. */
export function weeklyThroughput(timelines: IssueTimeline[], from: number, now: number, measure: Measure = 'count'): ThroughputBucket[] {
  const today = startOfDay(now)
  const weeks = Math.max(1, Math.floor((daysBetween(from, today) + 1) / 7))
  const buckets: ThroughputBucket[] = []
  for (let week = weeks - 1; week >= 0; week--) {
    const end = addDays(today, -7 * week)
    buckets.push({ start: addDays(end, -6), end, value: 0, items: 0 })
  }
  for (const timeline of timelines) {
    if (timeline.finished === undefined) continue
    const day = startOfDay(timeline.finished)
    const bucket = buckets.find((candidate) => day >= candidate.start && day <= candidate.end)
    if (!bucket) continue
    bucket.items += 1
    bucket.value += weightOf(measure, timeline.issue.estimate ?? null)
  }
  return buckets
}

/** Items finished on each day (zero days included): the sample a Monte Carlo forecast draws from. */
export function dailyThroughput(timelines: IssueTimeline[], days: number[]): number[] {
  const index = new Map(days.map((day, position) => [day, position]))
  const counts = days.map(() => 0)
  for (const timeline of timelines) {
    if (timeline.finished === undefined) continue
    const position = index.get(startOfDay(timeline.finished))
    if (position !== undefined) counts[position] += 1
  }
  return counts
}

/** Finished (done now) within [from, end of `to`'s day], weighted by measure. */
export function finishedBetween(timelines: IssueTimeline[], from: number, to: number, measure: Measure = 'count'): number {
  const start = startOfDay(from)
  const end = endOfDay(startOfDay(to))
  return timelines.reduce((sum, timeline) => timeline.finished !== undefined && timeline.finished >= start && timeline.finished <= end
    ? sum + weightOf(measure, timeline.issue.estimate ?? null) : sum, 0)
}

// ── Cycle time, lead time, percentiles ───────────────────────────────────────

export interface FinishedItem {
  issue: Issue
  finished: number
  /** Null when the issue went to done without passing through a started status. */
  cycleDays: number | null
  leadDays: number
}

export function finishedItems(timelines: IssueTimeline[], from: number, now: number): FinishedItem[] {
  const start = startOfDay(from)
  const end = endOfDay(startOfDay(now))
  return timelines.flatMap((timeline) => {
    const { finished, started, created } = timeline
    if (finished === undefined || finished < start || finished > end) return []
    return [{
      issue: timeline.issue, finished,
      cycleDays: started !== undefined && started <= finished ? elapsedDays(started, finished) : null,
      leadDays: elapsedDays(created, finished),
    }]
  }).sort((a, b) => a.finished - b.finished)
}

/** Nearest-rank percentile: the smallest value with at least p% of values at or below it. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)))
  return sorted[rank - 1]
}

export interface PercentileSet { p50: number; p85: number; p95: number; count: number }

export function percentiles(values: number[]): PercentileSet | null {
  if (values.length === 0) return null
  return { p50: percentile(values, 50)!, p85: percentile(values, 85)!, p95: percentile(values, 95)!, count: values.length }
}

// ── Aging work in progress ───────────────────────────────────────────────────

export type Pace = 'within-50' | 'within-85' | 'past-85' | 'unknown'

export interface AgingItem { issue: Issue; status: WipStatus; started: number; ageDays: number; pace: Pace }

/** Every in-flight item with its age (counted like cycle time) against the finished-item percentiles. */
export function agingWip(timelines: IssueTimeline[], now: number, cycle: PercentileSet | null): AgingItem[] {
  const usable = cycle && cycle.count >= MIN_FINISHED_FOR_PERCENTILES ? cycle : null
  return timelines.flatMap((timeline) => {
    const status = timeline.issue.status
    if (!isWip(status)) return []
    const started = timeline.started ?? timeline.created
    const ageDays = elapsedDays(started, now)
    const pace: Pace = !usable ? 'unknown' : ageDays <= usable.p50 ? 'within-50' : ageDays <= usable.p85 ? 'within-85' : 'past-85'
    return [{ issue: timeline.issue, status, started, ageDays, pace }]
  }).sort((a, b) => b.ageDays - a.ageDays)
}

export interface BlockedItem { issue: Issue; since: number; days: number }

export function blockedItems(timelines: IssueTimeline[], now: number): BlockedItem[] {
  return timelines.flatMap((timeline) => {
    if (timeline.issue.status !== 'blocked') return []
    let since = timeline.created
    for (let index = timeline.events.length - 1; index >= 0; index--) {
      if (timeline.events[index].status !== 'blocked') break
      since = timeline.events[index].at
    }
    return [{ issue: timeline.issue, since, days: elapsedDays(since, now) }]
  }).sort((a, b) => a.since - b.since)
}

export interface DueItem { issue: Issue; due: number; overdue: boolean; days: number }

/** Open items past due (overdue) or due within `soonDays`, soonest first. */
export function dueItems(issues: Issue[], now: number, soonDays = 7): DueItem[] {
  const horizon = now + soonDays * DAY_MS
  return issues.flatMap((issue) => {
    if (issue.status === 'done' || !issue.dueDate) return []
    const due = Date.parse(issue.dueDate)
    if (!Number.isFinite(due) || due > horizon) return []
    const overdue = due < now
    return [{ issue, due, overdue, days: overdue ? daysBetween(due, now) : daysBetween(now, due) }]
  }).sort((a, b) => a.due - b.due)
}

// ── Little's Law ─────────────────────────────────────────────────────────────

export interface LittlesLaw { avgWip: number; throughputPerDay: number; impliedCycleDays: number | null }

/** Average WIP and throughput over the days of `flow` (counts); implied average cycle time = WIP / throughput. */
export function littlesLaw(flow: FlowPoint[], finished: number): LittlesLaw | null {
  if (flow.length === 0) return null
  const avgWip = flow.reduce((sum, point) => sum + point['in-progress'] + point.review + point.blocked, 0) / flow.length
  const throughputPerDay = finished / flow.length
  return { avgWip, throughputPerDay, impliedCycleDays: throughputPerDay > 0 ? avgWip / throughputPerDay : null }
}

// ── Monte Carlo "when will it be done" ───────────────────────────────────────

/** Small seeded PRNG (mulberry32) so forecasts are reproducible. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface ForecastBucket { week: number; end: number; share: number }

export interface Forecast {
  status: 'ok' | 'done' | 'insufficient'
  remaining: number
  sampleDays: number
  sampleFinished: number
  trials: number
  reason?: string
  /** Days from today (1 = tomorrow) by which 50/85/95% of trials finished. */
  days?: { p50: number; p85: number; p95: number }
  dates?: { p50: number; p85: number; p95: number }
  /** Some trials did not finish within the horizon; percentiles at the horizon are lower bounds. */
  beyondHorizon?: boolean
  /** Share of trials finishing in each week from today. */
  histogram: ForecastBucket[]
}

export function monteCarloWhen({ dailyThroughput: sample, remaining, now, trials = 10_000, seed = 1, horizonDays = 3650 }: {
  dailyThroughput: number[]; remaining: number; now: number; trials?: number; seed?: number; horizonDays?: number
}): Forecast {
  const sampleFinished = sample.reduce((sum, value) => sum + value, 0)
  const base = { remaining, sampleDays: sample.length, sampleFinished, trials: 0, histogram: [] as ForecastBucket[] }
  if (remaining <= 0) return { ...base, status: 'done' }
  if (sample.length < MIN_FORECAST_DAYS)
    return { ...base, status: 'insufficient', reason: `Needs at least ${MIN_FORECAST_DAYS} days of history; this range has ${sample.length}.` }
  if (sampleFinished < MIN_FINISHED_FOR_PERCENTILES)
    return { ...base, status: 'insufficient', reason: `Needs at least ${MIN_FINISHED_FOR_PERCENTILES} items finished in the sampled days; there ${sampleFinished === 1 ? 'is' : 'are'} ${sampleFinished}.` }
  const random = mulberry32(seed)
  const results = new Array<number>(trials)
  for (let trial = 0; trial < trials; trial++) {
    let days = 0
    let done = 0
    while (done < remaining && days <= horizonDays) {
      days += 1
      done += sample[Math.floor(random() * sample.length)]
    }
    results[trial] = days
  }
  const p50 = percentile(results, 50)!
  const p85 = percentile(results, 85)!
  const p95 = percentile(results, 95)!
  const today = startOfDay(now)
  const counts = new Map<number, number>()
  for (const days of results) {
    const week = Math.ceil(days / 7)
    counts.set(week, (counts.get(week) ?? 0) + 1)
  }
  const lastWeek = Math.ceil(p95 / 7)
  const histogram: ForecastBucket[] = []
  for (let week = 1; week <= lastWeek; week++)
    histogram.push({ week, end: addDays(today, week * 7), share: (counts.get(week) ?? 0) / trials })
  return {
    ...base, status: 'ok', trials, histogram,
    days: { p50, p85, p95 },
    dates: { p50: addDays(today, p50), p85: addDays(today, p85), p95: addDays(today, p95) },
    beyondHorizon: results.some((days) => days > horizonDays),
  }
}

// ── Work-item types ──────────────────────────────────────────────────────────

/** Flow is measured on work items, not containers: types at hierarchy levels 3-4 (story, task, bug); else every type present. */
export function defaultFlowTypes(present: string[], levelOf: (type: string) => number | undefined): string[] {
  const work = present.filter((type) => { const level = levelOf(type); return level === 3 || level === 4 })
  return work.length > 0 ? work : present
}

// ── Everything the dashboard shows ───────────────────────────────────────────

export interface DashboardMetrics {
  from: number
  days: number
  measure: Measure
  timelines: IssueTimeline[]
  flow: FlowPoint[]
  burnup: BurnupPoint[]
  throughput: ThroughputBucket[]
  finished: FinishedItem[]
  cycle: PercentileSet | null
  lead: PercentileSet | null
  /** Finished in range without a recorded start (straight to done): no cycle time. */
  finishedWithoutStart: number
  aging: AgingItem[]
  blocked: BlockedItem[]
  due: DueItem[]
  littles: LittlesLaw | null
  forecast: Forecast
  kpis: {
    wip: number
    blocked: number
    overdue: number
    throughput14: number
    throughputPrev14: number
    open: number
    unestimatedOpen: number
  }
  inferredCount: number
}

export function computeDashboard({ issues, transitions, now, range, measure, seed = 1, trials }: {
  issues: Issue[]; transitions: IssueTransition[]; now: number; range: RangeKey; measure: Measure; seed?: number; trials?: number
}): DashboardMetrics {
  const timelines = buildTimelines(issues, transitions)
  const from = rangeStart(range, timelines, now)
  const allDays = dayList(from, now)
  const chartDays = sampleEvenly(allDays, 200)
  const countFlow = cumulativeFlow(timelines, allDays, 'count')
  const flow = measure === 'count' ? sampleEvenly(countFlow, 200) : cumulativeFlow(timelines, chartDays, measure)
  const finished = finishedItems(timelines, from, now)
  const cycleValues = finished.flatMap((item) => item.cycleDays === null ? [] : [item.cycleDays])
  const cycle = percentiles(cycleValues)
  const today = startOfDay(now)
  const open = issues.filter((issue) => issue.status !== 'done')
  return {
    from, days: allDays.length, measure, timelines, flow,
    burnup: burnup(timelines, chartDays, measure),
    throughput: weeklyThroughput(timelines, from, now, measure),
    finished, cycle,
    lead: percentiles(finished.map((item) => item.leadDays)),
    finishedWithoutStart: finished.length - cycleValues.length,
    aging: agingWip(timelines, now, cycle),
    blocked: blockedItems(timelines, now),
    due: dueItems(issues, now),
    littles: littlesLaw(countFlow, finished.length),
    forecast: monteCarloWhen({ dailyThroughput: dailyThroughput(timelines, allDays), remaining: open.length, now, seed, trials }),
    kpis: {
      wip: issues.filter((issue) => isWip(issue.status)).length,
      blocked: issues.filter((issue) => issue.status === 'blocked').length,
      overdue: open.filter((issue) => issue.dueDate && Date.parse(issue.dueDate) < now).length,
      throughput14: finishedBetween(timelines, addDays(today, -13), now, measure),
      throughputPrev14: finishedBetween(timelines, addDays(today, -27), addDays(today, -14), measure),
      open: open.length,
      unestimatedOpen: open.filter((issue) => !issue.estimate).length,
    },
    inferredCount: timelines.filter((timeline) => timeline.inferred).length,
  }
}
