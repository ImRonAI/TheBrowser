import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.TZ = 'America/New_York'

const {
  addDays, isCurrentPeriod, issuesInRange, issuesOnDay, layoutOverlaps, monthWeeks, periodLabel, periodRange,
  placeIssuesOnDay, quarterMonths, startOfWeek, stepDate, unscheduledIssues, weekDays,
} = await import('./calendar.ts')
const { fromLocalDateTime } = await import('./project-issue-utils.ts')
type Issue = import('../types/projects.ts').Issue

const base: Issue = { id: 'i', projectId: 'p', number: 1, version: 1, type: 'task', title: 'Issue', status: 'backlog', priority: 'medium',
  rank: 1, createdAt: 0, updatedAt: 0, assignees: [], labels: [], customFields: {}, workProducts: [], context: [] }
const at = (local: string) => fromLocalDateTime(local)
const issue = (id: string, dates: Partial<Pick<Issue, 'startDate' | 'endDate' | 'dueDate'>>): Issue => ({ ...base, id, ...dates })
const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

test('weeks start on Sunday', () => {
  assert.equal(ymd(startOfWeek(new Date(2026, 10, 5))), '2026-11-1')
  assert.equal(ymd(startOfWeek(new Date(2026, 10, 1))), '2026-11-1')
  assert.deepEqual(weekDays(new Date(2026, 10, 7)).map((d) => d.getDay()), [0, 1, 2, 3, 4, 5, 6])
})

test('month grid uses only the weeks the month needs', () => {
  assert.equal(monthWeeks(new Date(2026, 1, 10)).length, 4) // Feb 2026: Sun 1 .. Sat 28
  assert.equal(monthWeeks(new Date(2026, 10, 10)).length, 5) // Nov 2026
  assert.equal(monthWeeks(new Date(2026, 7, 10)).length, 6) // Aug 2026 starts Saturday
  const nov = monthWeeks(new Date(2026, 10, 10))
  assert.equal(ymd(nov[0][0]), '2026-11-1')
  assert.equal(ymd(nov[4][6]), '2026-12-5')
})

test('stepping keeps the day of month, clamps short months and crosses years', () => {
  assert.equal(ymd(stepDate(new Date(2026, 0, 31), 'month', 1)), '2026-2-28')
  assert.equal(ymd(stepDate(new Date(2026, 11, 15), 'month', 1)), '2027-1-15')
  assert.equal(ymd(stepDate(new Date(2026, 10, 5), 'quarter', 1)), '2027-2-5')
  assert.equal(ymd(stepDate(new Date(2026, 0, 5), 'quarter', -1)), '2025-10-5')
  assert.equal(ymd(stepDate(new Date(2026, 10, 5), 'week', -1)), '2026-10-29')
  assert.equal(ymd(stepDate(new Date(2026, 11, 31), 'day', 1)), '2027-1-1')
})

test('day arithmetic survives DST transitions', () => {
  assert.equal(ymd(addDays(new Date(2026, 2, 7), 1)), '2026-3-8')
  assert.equal(ymd(addDays(new Date(2026, 2, 8), 1)), '2026-3-9')
  assert.equal(weekDays(new Date(2026, 10, 1)).map(ymd).join(' '), '2026-11-1 2026-11-2 2026-11-3 2026-11-4 2026-11-5 2026-11-6 2026-11-7')
})

test('periods: labels, ranges and the current period', () => {
  const day = new Date(2026, 10, 5)
  assert.equal(periodLabel(day, 'month', 'en-US'), 'November 2026')
  assert.equal(periodLabel(day, 'day', 'en-US'), 'Thursday, November 5, 2026')
  assert.match(periodLabel(day, 'week', 'en-US'), /^Nov 1\s*–\s*7, 2026$/)
  assert.match(periodLabel(day, 'quarter', 'en-US'), /^Q4 2026 · Oct\s*–\s*Dec$/)
  assert.deepEqual(quarterMonths(day).map((d) => d.getMonth()), [9, 10, 11])
  const quarter = periodRange(day, 'quarter')
  assert.equal(`${ymd(quarter.start)} ${ymd(quarter.end)}`, '2026-10-1 2026-12-31')
  assert.equal(isCurrentPeriod(new Date(2026, 10, 7), 'week', day), true)
  assert.equal(isCurrentPeriod(new Date(2026, 10, 8), 'week', day), false)
  assert.equal(isCurrentPeriod(new Date(2026, 11, 31), 'quarter', day), true)
  assert.equal(isCurrentPeriod(new Date(2026, 9, 31), 'month', day), false)
})

test('placement: same-day spans and lone dates are timed, multi-day spans are all-day', () => {
  const issues = [
    issue('meeting', { startDate: at('2026-11-05T09:00'), endDate: at('2026-11-05T10:30') }),
    issue('sprint', { startDate: at('2026-11-03T09:00'), endDate: at('2026-11-06T17:00'), dueDate: at('2026-11-09T12:00') }),
    issue('due', { dueDate: at('2026-11-05T15:00') }),
    issue('kickoff', { startDate: at('2026-11-05T23:50') }),
    issue('handoff', { endDate: at('2026-11-05T17:00') }),
    issue('elsewhere', { dueDate: at('2026-11-20T12:00') }),
  ]
  const { timed, allDay } = placeIssuesOnDay(issues, new Date(2026, 10, 5))
  assert.deepEqual(allDay.map((i) => i.id), ['sprint'])
  assert.deepEqual(timed.map((t) => [t.issue.id, t.kind, t.startMinutes, t.endMinutes]), [
    ['meeting', 'span', 540, 630],
    ['due', 'due', 900, 930],
    ['handoff', 'end', 1020, 1050],
    ['kickoff', 'start', 1410, 1440],
  ])
  // The span's due date lands on its own day as a due block.
  assert.deepEqual(placeIssuesOnDay(issues, new Date(2026, 10, 9)).timed.map((t) => [t.issue.id, t.kind]), [['sprint', 'due']])
  assert.deepEqual(issuesOnDay(issues, new Date(2026, 10, 4)).map((i) => i.id), ['sprint'])
})

test('range queries and unscheduled issues', () => {
  const issues = [
    issue('nov', { dueDate: at('2026-11-30T12:00') }),
    issue('span', { startDate: at('2026-10-28T09:00'), endDate: at('2026-11-02T09:00') }),
    issue('dec', { dueDate: at('2026-12-01T09:00') }),
    issue('none', {}),
  ]
  assert.deepEqual(issuesInRange(issues, new Date(2026, 10, 1), new Date(2026, 10, 30)).map((i) => i.id), ['span', 'nov'])
  assert.deepEqual(unscheduledIssues(issues).map((i) => i.id), ['none'])
})

test('overlapping blocks share columns per cluster', () => {
  const mk = (id: string, s: number, e: number) => ({ issue: issue(id, {}), kind: 'span' as const, startMinutes: s, endMinutes: e })
  const laid = layoutOverlaps([mk('a', 540, 600), mk('b', 570, 660), mk('c', 600, 630), mk('d', 720, 750)])
  const byId = Object.fromEntries(laid.map((b) => [b.issue.id, [b.column, b.columns]]))
  assert.deepEqual(byId, { a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] })
})
