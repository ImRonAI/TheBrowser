import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Issue, IssueStatus } from '../types/projects.ts'
import {
  addDays, agingWip, blockedItems, buildTimelines, burnup, computeDashboard, cumulativeFlow, dailyThroughput, dayList,
  defaultFlowTypes, dueItems, elapsedDays, finishedItems, littlesLaw, mapHistory, monteCarloWhen, percentile, percentiles,
  rangeStart, sampleEvenly, startOfDay, weeklyThroughput, type IssueTransition,
} from './agile-metrics.ts'

/** Local-time instants, so the assertions hold in any timezone. */
const at = (month: number, day: number, hour = 12) => new Date(2026, month - 1, day, hour).getTime()

const issue = (id: string, over: Partial<Issue> = {}): Issue => ({
  id, number: 1, version: 1, customFields: {}, workProducts: [], context: [], projectId: 'p', type: 'task',
  title: id, status: 'backlog', priority: 'medium', assignees: [], labels: [], rank: 1,
  createdAt: at(1, 1), updatedAt: at(1, 1), ...over,
})

const move = (issueId: string, when: number, status: IssueStatus, estimate: number | null = null): IssueTransition =>
  ({ issueId, at: when, status, estimate, type: 'task' })

test('elapsed days count both ends; percentiles use nearest rank', () => {
  assert.equal(elapsedDays(at(3, 2, 9), at(3, 2, 17)), 1)
  assert.equal(elapsedDays(at(3, 2, 23), at(3, 3, 1)), 2)
  // Across the spring DST change in most zones: still whole calendar days.
  assert.equal(elapsedDays(at(3, 1), at(3, 31)), 31)
  const values = Array.from({ length: 20 }, (_, index) => index + 1)
  assert.equal(percentile(values, 50), 10)
  assert.equal(percentile(values, 85), 17)
  assert.equal(percentile(values, 95), 19)
  assert.equal(percentile([7], 85), 7)
  assert.equal(percentile([], 50), null)
  assert.deepEqual(percentiles([3, 1, 2]), { p50: 2, p85: 3, p95: 3, count: 3 })
})

test('timelines follow history, repair a truncated start and a pending save, and infer when history is missing', () => {
  const issues = [
    issue('a', { status: 'done', createdAt: at(1, 1), updatedAt: at(1, 9) }),
    issue('b', { status: 'review', createdAt: at(1, 1) }),
    issue('c', { status: 'done', createdAt: at(1, 2), updatedAt: at(1, 6) }),
    issue('d', { status: 'in-progress', createdAt: at(1, 3) }),
    issue('e', { status: 'done', createdAt: at(1, 1), updatedAt: at(1, 12) }),
  ]
  const [a, b, c, d, e] = buildTimelines(issues, [
    move('a', at(1, 1), 'backlog'), move('a', at(1, 3), 'in-progress'), move('a', at(1, 5), 'done'),
    move('a', at(1, 7), 'in-progress'), move('a', at(1, 9), 'done'),
    // b's creation row was cut off by the row cap; its first known state stands for creation.
    move('b', at(1, 4), 'in-progress'),
    move('e', at(1, 1), 'backlog'), move('e', at(1, 10), 'done'),
  ])
  assert.equal(a.started, at(1, 3))
  assert.equal(a.finished, at(1, 9), 'reopened work finishes at its final done')
  assert.equal(a.inferred, false)
  assert.deepEqual(b.events.map((event) => [event.at, event.status]), [[at(1, 1), 'in-progress'], [at(1, 4), 'review']])
  assert.equal(b.started, at(1, 1))
  assert.deepEqual(c.events.map((event) => event.status), ['backlog', 'done'])
  assert.equal(c.inferred, true)
  assert.equal(c.started, undefined)
  assert.equal(c.finished, at(1, 6))
  assert.deepEqual(d.events.map((event) => event.status), ['in-progress'])
  assert.equal(d.started, at(1, 3))
  assert.equal(e.finished, at(1, 10))
})

test('cumulative flow and burnup count each day end, by items or by estimate', () => {
  const now = at(1, 5)
  const issues = [
    issue('a', { status: 'done', estimate: 3, createdAt: at(1, 1), updatedAt: at(1, 4) }),
    issue('b', { status: 'in-progress', estimate: 5, createdAt: at(1, 2) }),
    issue('c', { status: 'backlog', createdAt: at(1, 4) }),
  ]
  const timelines = buildTimelines(issues, [
    move('a', at(1, 1), 'backlog', 3), move('a', at(1, 2), 'in-progress', 3), move('a', at(1, 4), 'done', 3),
    move('b', at(1, 2), 'backlog', 5), move('b', at(1, 3), 'in-progress', 5),
    move('c', at(1, 4), 'backlog'),
  ])
  const days = dayList(at(1, 1), now)
  assert.equal(days.length, 5)
  const flow = cumulativeFlow(timelines, days)
  assert.deepEqual(flow.map((point) => [point.backlog, point['in-progress'], point.done]),
    [[1, 0, 0], [1, 1, 0], [0, 2, 0], [1, 1, 1], [1, 1, 1]])
  assert.deepEqual(cumulativeFlow(timelines, days, 'estimate').map((point) => point.done), [0, 0, 0, 3, 3])
  assert.deepEqual(burnup(timelines, days).map((point) => [point.scope, point.done]), [[1, 0], [2, 0], [2, 0], [3, 1], [3, 1]])
  assert.deepEqual(burnup(timelines, days, 'estimate').map((point) => [point.scope, point.done]), [[3, 0], [8, 0], [8, 0], [8, 3], [8, 3]])
})

test('burnup done drops when finished work is reopened', () => {
  const timelines = buildTimelines([issue('a', { status: 'in-progress' })],
    [move('a', at(1, 1), 'backlog'), move('a', at(1, 2), 'done'), move('a', at(1, 3), 'in-progress')])
  assert.deepEqual(burnup(timelines, dayList(at(1, 1), at(1, 3))).map((point) => point.done), [0, 1, 0])
})

test('weekly throughput buckets end today; velocity sums estimates; daily throughput keeps zero days', () => {
  const now = at(2, 28)
  const issues = [
    issue('a', { status: 'done', estimate: 2, updatedAt: at(2, 28) }),
    issue('b', { status: 'done', estimate: 3, updatedAt: at(2, 22) }),
    issue('c', { status: 'done', estimate: 5, updatedAt: at(2, 21) }),
    issue('d', { status: 'in-progress', estimate: 8 }),
  ]
  const timelines = buildTimelines(issues, [])
  const from = addDays(startOfDay(now), -13)
  const weeks = weeklyThroughput(timelines, from, now)
  assert.deepEqual(weeks.map((week) => [week.start, week.end, week.value]),
    [[startOfDay(at(2, 15)), startOfDay(at(2, 21)), 1], [startOfDay(at(2, 22)), startOfDay(at(2, 28)), 2]])
  assert.deepEqual(weeklyThroughput(timelines, from, now, 'estimate').map((week) => week.value), [5, 5])
  const daily = dailyThroughput(timelines, dayList(from, now))
  assert.equal(daily.length, 14)
  assert.equal(daily.reduce((sum, value) => sum + value, 0), 3)
  assert.equal(daily.filter((value) => value === 0).length, 11)
})

test('cycle time runs from the first start to the final done; straight-to-done work has lead time only', () => {
  const issues = [
    issue('a', { status: 'done', createdAt: at(1, 1), updatedAt: at(1, 10) }),
    issue('b', { status: 'done', createdAt: at(1, 2), updatedAt: at(1, 8) }),
  ]
  const timelines = buildTimelines(issues, [
    move('a', at(1, 1), 'backlog'), move('a', at(1, 4), 'in-progress'), move('a', at(1, 6), 'blocked'), move('a', at(1, 10), 'done'),
  ])
  const finished = finishedItems(timelines, at(1, 1), at(1, 20))
  assert.deepEqual(finished.map((item) => [item.issue.id, item.cycleDays, item.leadDays]), [['b', null, 7], ['a', 7, 10]])
  assert.deepEqual(finishedItems(timelines, at(1, 9), at(1, 20)).map((item) => item.issue.id), ['a'])
})

test('aging WIP reads age against the finished percentiles only with enough history', () => {
  const now = at(3, 31)
  const done = Array.from({ length: 10 }, (_, index) => issue(`done-${index}`, { status: 'done', createdAt: at(3, 1), updatedAt: at(3, 20) }))
  const wip = [
    issue('young', { status: 'in-progress', createdAt: at(3, 30) }),
    issue('middle', { status: 'review', createdAt: at(3, 1) }),
    issue('old', { status: 'blocked', createdAt: at(1, 1) }),
  ]
  const transitions = [
    ...done.flatMap((item, index) => [move(item.id, at(3, 1), 'in-progress'), move(item.id, at(3, 1 + index), 'done')]),
    move('young', at(3, 30), 'in-progress'),
    move('middle', at(3, 1), 'backlog'), move('middle', at(3, 25), 'in-progress'), move('middle', at(3, 28), 'review'),
    move('old', at(1, 1), 'in-progress'), move('old', at(2, 1), 'blocked'),
  ]
  const timelines = buildTimelines([...done, ...wip], transitions)
  const cycle = percentiles(finishedItems(timelines, at(3, 1), now).flatMap((item) => item.cycleDays ?? []))
  assert.deepEqual(cycle, { p50: 5, p85: 9, p95: 10, count: 10 })
  const aging = agingWip(timelines, now, cycle)
  assert.deepEqual(aging.map((item) => [item.issue.id, item.ageDays, item.pace]),
    [['old', 90, 'past-85'], ['middle', 7, 'within-85'], ['young', 2, 'within-50']])
  assert.ok(agingWip(timelines, now, { ...cycle!, count: 9 }).every((item) => item.pace === 'unknown'))
  assert.deepEqual(blockedItems(timelines, now).map((item) => [item.issue.id, item.since, item.days]), [['old', at(2, 1), 59]])
})

test('due items list open overdue and due-soon work, soonest first', () => {
  const now = at(5, 10)
  const due = dueItems([
    issue('late', { dueDate: new Date(at(5, 7)).toISOString() }),
    issue('soon', { dueDate: new Date(at(5, 14)).toISOString() }),
    issue('later', { dueDate: new Date(at(5, 30)).toISOString() }),
    issue('finished', { status: 'done', dueDate: new Date(at(5, 1)).toISOString() }),
  ], now)
  assert.deepEqual(due.map((item) => [item.issue.id, item.overdue, item.days]), [['late', true, 3], ['soon', false, 4]])
})

test("Little's Law: average WIP over average daily throughput", () => {
  const flow = [0, 1, 2, 3].map((index) => ({ day: index, backlog: 9, 'in-progress': 1, review: 1, blocked: 0, done: 0 }))
  assert.deepEqual(littlesLaw(flow, 2), { avgWip: 2, throughputPerDay: 0.5, impliedCycleDays: 4 })
  assert.equal(littlesLaw(flow, 0)?.impliedCycleDays, null)
  assert.equal(littlesLaw([], 1), null)
})

test('Monte Carlo forecast is seeded, exact for constant throughput, and refuses thin history', () => {
  const now = at(6, 1)
  const steady = monteCarloWhen({ dailyThroughput: Array(14).fill(1), remaining: 5, now, trials: 500 })
  assert.equal(steady.status, 'ok')
  assert.deepEqual(steady.days, { p50: 5, p85: 5, p95: 5 })
  assert.equal(steady.dates!.p85, addDays(startOfDay(now), 5))
  assert.deepEqual(steady.histogram.map((bucket) => [bucket.week, bucket.share]), [[1, 1]])

  const lumpy = [0, 0, 3, 0, 1, 0, 0, 2, 0, 0, 4, 0, 1, 0]
  const first = monteCarloWhen({ dailyThroughput: lumpy, remaining: 20, now, seed: 7 })
  const second = monteCarloWhen({ dailyThroughput: lumpy, remaining: 20, now, seed: 7 })
  assert.deepEqual(first.days, second.days)
  assert.ok(first.days!.p50 <= first.days!.p85 && first.days!.p85 <= first.days!.p95)
  // 20 items at ~11 per 14 days: around 25 days at the median.
  assert.ok(first.days!.p50 > 15 && first.days!.p50 < 40, `p50 ${first.days!.p50}`)
  assert.ok(Math.abs(first.histogram.reduce((sum, bucket) => sum + bucket.share, 0) - 1) < 0.06)

  assert.equal(monteCarloWhen({ dailyThroughput: Array(13).fill(1), remaining: 3, now }).status, 'insufficient')
  const thin = monteCarloWhen({ dailyThroughput: [...Array(13).fill(0), 9], remaining: 3, now })
  assert.equal(thin.status, 'insufficient')
  assert.match(thin.reason!, /at least 10 items finished.*there are 9/)
  assert.equal(monteCarloWhen({ dailyThroughput: Array(30).fill(1), remaining: 0, now }).status, 'done')
})

test('ranges, sampling, history mapping and default work-item types', () => {
  const now = at(4, 30)
  assert.equal(rangeStart(30, [], now), startOfDay(at(4, 1)))
  const timelines = buildTimelines([issue('a', { createdAt: at(2, 10) })], [])
  assert.equal(rangeStart('all', timelines, now), startOfDay(at(2, 10)))
  // Fixed ranges start at the first item when the project is younger than the range, otherwise at the range.
  const young = buildTimelines([issue('b', { createdAt: at(4, 27) })], [])
  assert.equal(rangeStart(90, young, now), startOfDay(at(4, 27)))
  assert.equal(rangeStart(30, timelines, now), startOfDay(at(4, 1)))
  const sampled = sampleEvenly(Array.from({ length: 450 }, (_, index) => index), 200)
  assert.ok(sampled.length <= 200 && sampled[sampled.length - 1] === 449)
  assert.deepEqual(mapHistory({ transitions: [{ issue_id: 'x', at: 5, status: 'done', estimate: 2, type: 'bug' }, { issue_id: 1 }], rows_read: 9, truncated: true, since: 5 }),
    { transitions: [{ issueId: 'x', at: 5, status: 'done', estimate: 2, type: 'bug' }], rowsRead: 9, truncated: true, since: 5 })
  const levels: Record<string, number> = { epic: 2, story: 3, task: 4, subtask: 5 }
  assert.deepEqual(defaultFlowTypes(['epic', 'story', 'task', 'subtask'], (type) => levels[type]), ['story', 'task'])
  assert.deepEqual(defaultFlowTypes(['epic'], (type) => levels[type]), ['epic'])
})

test('an empty project computes without errors and says nothing is left to forecast', () => {
  const metrics = computeDashboard({ issues: [], transitions: [], now: at(7, 1), range: 90, measure: 'count' })
  assert.equal(metrics.flow.length, 90)
  assert.equal(metrics.cycle, null)
  assert.equal(metrics.forecast.status, 'done')
  assert.deepEqual(metrics.aging, [])
  assert.equal(metrics.kpis.wip, 0)
})

test('the dashboard forecasts the open items from the range throughput', () => {
  const now = at(7, 31)
  const finished = Array.from({ length: 12 }, (_, index) => issue(`f${index}`, { status: 'done', createdAt: at(6, 1), updatedAt: at(7, 2 + index * 2) }))
  const open = Array.from({ length: 6 }, (_, index) => issue(`o${index}`, { status: index < 2 ? 'in-progress' : 'backlog', createdAt: at(7, 1) }))
  const metrics = computeDashboard({ issues: [...finished, ...open], transitions: [], now, range: 30, measure: 'count', trials: 2000 })
  assert.equal(metrics.kpis.open, 6)
  assert.equal(metrics.forecast.status, 'ok')
  assert.equal(metrics.finishedWithoutStart, 12, 'inferred done items have no recorded start')
  assert.equal(metrics.kpis.throughput14, 4)
})
