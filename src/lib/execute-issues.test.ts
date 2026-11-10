import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_FILTERS, activeFilterCount, assigneeOptions, filterIssues, groupByStatus, isDueSoon, isOverdue, issueKey, issueSpan,
  layoutTimeline, personFor, projectOptions, sortIssues, summarize, timelineTicks, timelineWindow, typeLabel, typeOptions,
} from './execute-issues.ts'
import { RON_ASSIGNEE, type Issue, type Person, type Project } from '../types/projects.ts'

const DAY = 24 * 60 * 60 * 1000
const now = Date.parse('2026-11-07T12:00:00.000Z')
const iso = (offsetDays: number) => new Date(now + offsetDays * DAY).toISOString()

const project = (id: string, key: string, extra: Partial<Project> = {}): Project => ({
  id, key, name: `${key} project`, version: 1, lifecycle: 'active', type: 'software-development', createdAt: 0, updatedAt: 0,
  settings: { allowCrossProjectParents: false }, ...extra,
})
const issue = (id: string, extra: Partial<Issue> = {}): Issue => ({
  id, projectId: 'p1', number: 1, version: 1, type: 'task', title: `Issue ${id}`, status: 'backlog', priority: 'medium',
  rank: 1, createdAt: 0, updatedAt: 0, assignees: [], labels: [], customFields: {}, workProducts: [], context: [], ...extra,
})

const me: Person = { id: 'user-1', name: 'Tim Hunter', initials: 'TH' }
const people = [me, RON_ASSIGNEE]
const projects = [
  project('p1', 'RON'),
  project('p2', 'OPS', { settings: { allowCrossProjectParents: false, issueTypes: [{ key: 'goal', label: 'Goal', level: 3 }, { key: 'step', label: 'Step', level: 5 }] } }),
  project('p3', 'OLD', { lifecycle: 'archived' }),
]
const issues = [
  issue('a', { number: 12, title: 'Ship calendar', status: 'in-progress', priority: 'high', assignees: [me.id], dueDate: iso(-1), description: '<p>Day &amp; <strong>week</strong> views</p>' }),
  issue('b', { number: 3, projectId: 'p2', type: 'goal', title: 'Hire', status: 'blocked', priority: 'critical', assignees: [RON_ASSIGNEE.id], dueDate: iso(3) }),
  issue('c', { number: 4, title: 'Docs', status: 'done', priority: 'low', dueDate: iso(-5) }),
  issue('d', { number: 7, projectId: 'p3', title: 'Archived work', status: 'review' }),
]
const filter = (overrides: Partial<typeof DEFAULT_FILTERS>) =>
  filterIssues(issues, projects, { ...DEFAULT_FILTERS, ...overrides }, { userId: me.id, now }).map((item) => item.id)

test('issue keys use the project key and number', () => {
  assert.equal(issueKey(issues[0], projects), 'RON-12')
  assert.equal(issueKey(issues[1], new Map(projects.map((p) => [p.id, p]))), 'OPS-3')
  assert.equal(issueKey({ projectId: 'missing', number: 9 }, projects), 'ISSUE-9')
})

test('overdue ignores done issues; due soon is the next seven days', () => {
  assert.equal(isOverdue(issues[0], now), true)
  assert.equal(isOverdue(issues[2], now), false)
  assert.equal(isOverdue(issues[3], now), false)
  assert.equal(isDueSoon(issues[1], now), true)
  assert.equal(isDueSoon(issues[0], now), false)
  assert.equal(isDueSoon(issue('x', { dueDate: iso(8) }), now), false)
})

test('"all projects" hides archived projects; picking one shows it', () => {
  assert.deepEqual(filter({}), ['a', 'b', 'c'])
  assert.deepEqual(filter({ projectId: 'p3' }), ['d'])
  assert.deepEqual(filter({ projectId: 'p2' }), ['b'])
})

test('filters map to real issue fields', () => {
  assert.deepEqual(filter({ status: 'blocked' }), ['b'])
  assert.deepEqual(filter({ priority: 'low' }), ['c'])
  assert.deepEqual(filter({ type: 'goal' }), ['b'])
  assert.deepEqual(filter({ assignee: 'me' }), ['a'])
  assert.deepEqual(filter({ assignee: RON_ASSIGNEE.id }), ['b'])
  assert.deepEqual(filter({ assignee: 'unassigned' }), ['c'])
  assert.deepEqual(filter({ due: 'overdue' }), ['a'])
  assert.deepEqual(filter({ due: 'next7' }), ['b'])
  assert.deepEqual(filterIssues(issues, projects, { ...DEFAULT_FILTERS, due: 'none', projectId: 'p3' }, { userId: me.id, now }).map((i) => i.id), ['d'])
  assert.deepEqual(filterIssues(issues, projects, { ...DEFAULT_FILTERS, assignee: 'me' }, { userId: null, now }), [])
})

test('search covers title, KEY-number and description text without markup', () => {
  assert.deepEqual(filter({ query: 'calendar' }), ['a'])
  assert.deepEqual(filter({ query: 'ops-3' }), ['b'])
  assert.deepEqual(filter({ query: 'RON-12' }), ['a'])
  assert.deepEqual(filter({ query: 'day & week' }), ['a'])
  assert.deepEqual(filter({ query: 'strong' }), [])
  assert.deepEqual(filter({ query: '  ' }), ['a', 'b', 'c'])
})

test('active filter count ignores the search box', () => {
  assert.equal(activeFilterCount(DEFAULT_FILTERS), 0)
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, status: 'done', due: 'none', query: 'x' }), 2)
})

test('options come from projects, schemes, people and the data', () => {
  assert.deepEqual(projectOptions(projects).map((o) => o.label), ['OPS · OPS project', 'RON · RON project', 'OLD · OLD project (archived)'])
  const types = typeOptions(issues, projects).map((o) => o.value)
  for (const type of ['initiative', 'epic', 'story', 'task', 'subtask', 'goal', 'step']) assert.ok(types.includes(type), type)
  assert.equal(typeLabel('goal', projects), 'Goal')
  assert.equal(typeLabel('epic', projects), 'Epic')
  assert.equal(typeLabel('custom', projects), 'custom')
  assert.deepEqual(assigneeOptions(issues, people, me.id).map((o) => o.value), ['me', 'unassigned', RON_ASSIGNEE.id])
  // A guest cannot be assigned, so "Assigned to me" is not offered.
  assert.deepEqual(assigneeOptions([], [RON_ASSIGNEE], 'guest:abc').map((o) => o.value), ['unassigned', RON_ASSIGNEE.id])
  const stranger = assigneeOptions([issue('s', { assignees: ['ffffffff-0000'] })], people, me.id)
  assert.equal(stranger.at(-1)?.label, 'Unknown user (ffffffff)')
  assert.deepEqual(personFor('nobody', people), { id: 'nobody', name: 'Unknown user (nobody)', initials: '?', known: false })
  assert.equal(personFor(me.id, people).initials, 'TH')
})

test('kanban groups every status and orders by priority then due date', () => {
  const columns = groupByStatus([
    issue('m1', { status: 'review', priority: 'low', dueDate: iso(1) }),
    issue('m2', { status: 'review', priority: 'high' }),
    issue('m3', { status: 'review', priority: 'high', dueDate: iso(2) }),
  ])
  assert.deepEqual(Object.keys(columns), ['backlog', 'in-progress', 'review', 'blocked', 'done'])
  assert.deepEqual(columns.review.map((i) => i.id), ['m3', 'm2', 'm1'])
  assert.deepEqual(columns.backlog, [])
})

test('list sorting is stable and puts missing values last', () => {
  const ctx = { projects, people }
  assert.deepEqual(sortIssues(issues, { key: 'key', direction: 'asc' }, ctx).map((i) => i.id), ['d', 'b', 'c', 'a'])
  assert.deepEqual(sortIssues(issues, { key: 'priority', direction: 'asc' }, ctx).map((i) => i.id), ['b', 'a', 'd', 'c'])
  assert.deepEqual(sortIssues(issues, { key: 'due', direction: 'asc' }, ctx).map((i) => i.id), ['c', 'a', 'b', 'd'])
  assert.deepEqual(sortIssues(issues, { key: 'due', direction: 'desc' }, ctx).map((i) => i.id), ['b', 'a', 'c', 'd'])
  assert.deepEqual(sortIssues(issues, { key: 'assignee', direction: 'asc' }, ctx).map((i) => i.id), ['b', 'a', 'd', 'c'])
  assert.deepEqual(sortIssues(issues, { key: 'status', direction: 'desc' }, ctx).map((i) => i.id), ['c', 'b', 'd', 'a'])
  assert.deepEqual(sortIssues(issues, { key: 'project', direction: 'asc' }, ctx).map((i) => i.id)[0], 'd')
  assert.notEqual(sortIssues(issues, { key: 'title', direction: 'asc' }, ctx), issues)
})

test('summary counts the filtered issues', () => {
  assert.deepEqual(summarize(issues.slice(0, 3), now), { total: 3, open: 2, overdue: 1, blocked: 1, dueSoon: 1 })
})

test('spans come from real dates only; a single date is a milestone', () => {
  assert.equal(issueSpan({}), null)
  assert.deepEqual(issueSpan({ dueDate: iso(2) }), { start: now + 2 * DAY, end: now + 2 * DAY, milestone: true })
  assert.deepEqual(issueSpan({ startDate: iso(0), endDate: iso(3), dueDate: iso(9) }), { start: now, end: now + 3 * DAY, milestone: false })
  assert.deepEqual(issueSpan({ startDate: iso(0), dueDate: iso(4) }), { start: now, end: now + 4 * DAY, milestone: false })
  assert.deepEqual(issueSpan({ startDate: iso(5), dueDate: iso(1) }), { start: now + DAY, end: now + 5 * DAY, milestone: false })
})

test('timeline groups by project, clips to the window and counts the rest', () => {
  const scheduled = [
    issue('t1', { number: 2, startDate: iso(-3), endDate: iso(3) }),
    issue('t2', { number: 1, projectId: 'p2', dueDate: iso(1) }),
    issue('t3', { number: 3, startDate: iso(-30), endDate: iso(-20) }),
    issue('t4', { number: 4 }),
  ]
  const window = { start: now - 7 * DAY, end: now + 7 * DAY }
  const layout = layoutTimeline(scheduled, projects, window)
  assert.equal(layout.unscheduled, 1)
  assert.equal(layout.outside, 1)
  assert.deepEqual(layout.groups.map((g) => g.project?.key), ['OPS', 'RON'])
  const [row] = layout.groups[1].rows
  assert.equal(row.issue.id, 't1')
  assert.equal(Math.round(row.leftPct), 29)
  assert.equal(Math.round(row.widthPct), 43)
  assert.equal(row.clippedStart || row.clippedEnd, false)
  const clipped = layoutTimeline([issue('t5', { startDate: iso(-10), endDate: iso(10) })], projects, window).groups[0].rows[0]
  assert.deepEqual([clipped.leftPct, Math.round(clipped.widthPct), clipped.clippedStart, clipped.clippedEnd], [0, 100, true, true])
})

test('fit window covers every span and today; fixed ranges start at the cursor', () => {
  const today = new Date(now)
  const fit = timelineWindow([issue('f', { startDate: iso(-20), dueDate: iso(40) })], 'fit', today, today)
  assert.ok(fit.start <= now - 20 * DAY && fit.end >= now + 40 * DAY)
  const empty = timelineWindow([], 'fit', today, today)
  assert.ok(empty.start <= now && empty.end > now)
  const cursor = new Date(2026, 10, 1)
  const quarter = timelineWindow([], 'quarter', cursor, today)
  assert.equal(quarter.start, cursor.getTime())
  assert.equal(Math.round((quarter.end - quarter.start) / DAY), 91)
})

test('ticks pick a unit that fits the window', () => {
  const start = new Date(2026, 10, 1).getTime()
  assert.equal(timelineTicks({ start, end: start + 42 * DAY })[0].unit, 'week')
  assert.equal(timelineTicks({ start, end: start + 42 * DAY }).length, 6)
  assert.equal(timelineTicks({ start, end: start + 120 * DAY })[0].unit, 'month')
  assert.equal(timelineTicks({ start, end: start + 900 * DAY })[0].unit, 'quarter')
  assert.ok(timelineTicks({ start, end: start + 120 * DAY }).every((tick) => tick.pct >= 0 && tick.pct < 100))
  assert.deepEqual(timelineTicks({ start, end: start }), [])
})
