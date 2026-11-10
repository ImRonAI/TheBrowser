import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  inLifecycle, isLifecycleFilter, lifecycleCounts, matchesProjectQuery, sortByActivity, summarizeProjects, updatedLabel,
} from './project-index.ts'
import type { Issue, IssueLink, Project } from '../types/projects.ts'

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
const link = (sourceId: string, targetId: string): IssueLink => ({ id: `${sourceId}-${targetId}`, sourceId, targetId, type: 'blocks', createdAt: 0 })

test('a project summary counts open, done, in-flight, blocked, overdue and due-soon work like the rest of Ren', () => {
  const projects = [project('p1', 'REN', { updatedAt: now - 5 * DAY }), project('p2', 'OPS')]
  const issues = [
    issue('a', { status: 'in-progress', dueDate: iso(-1), updatedAt: now - DAY }),   // overdue, in flight
    issue('b', { status: 'review', dueDate: iso(3) }),                              // due soon, in flight
    issue('c', { status: 'done', dueDate: iso(-9) }),                               // done: never overdue
    issue('d', { status: 'backlog' }),                                              // blocked by a link only
    issue('e', { status: 'blocked', dueDate: iso(20) }),                            // blocked by status, not due soon
    issue('f', { status: 'done' }),
    issue('x', { projectId: 'p2', status: 'backlog' }),
  ]
  const [ren, ops] = summarizeProjects(projects, issues, [link('a', 'd'), link('f', 'x')], now)
  assert.deepEqual(
    { total: ren.total, done: ren.done, open: ren.open, inProgress: ren.inProgress, blocked: ren.blocked, overdue: ren.overdue, dueSoon: ren.dueSoon },
    { total: 6, done: 2, open: 4, inProgress: 2, blocked: 2, overdue: 1, dueSoon: 1 },
  )
  assert.deepEqual(ren.byStatus, { backlog: 1, 'in-progress': 1, review: 1, blocked: 1, done: 2 })
  assert.equal(ren.progress, 2 / 6)
  assert.equal(ren.lastActivity, now - DAY)
  // A finished blocker does not block, and a project without issues reports no progress.
  assert.equal(ops.blocked, 0)
  assert.equal(summarizeProjects([project('p9', 'NEW', { createdAt: 7 })], [], [], now)[0].progress, 0)
  assert.equal(summarizeProjects([project('p9', 'NEW', { createdAt: 7 })], [], [], now)[0].lastActivity, 7)
})

test('the lifecycle filter treats active and paused projects as open', () => {
  assert.equal(inLifecycle({ lifecycle: 'paused' }, 'open'), true)
  assert.equal(inLifecycle({ lifecycle: 'completed' }, 'open'), false)
  assert.equal(inLifecycle({ lifecycle: 'archived' }, 'archived'), true)
  assert.equal(inLifecycle({ lifecycle: 'archived' }, 'all'), true)
  assert.deepEqual(
    lifecycleCounts([{ lifecycle: 'active' }, { lifecycle: 'paused' }, { lifecycle: 'completed' }, { lifecycle: 'archived' }, { lifecycle: 'archived' }]),
    { open: 2, completed: 1, archived: 2, all: 5 },
  )
  assert.equal(isLifecycleFilter('open'), true)
  assert.equal(isLifecycleFilter('paused'), false)
})

test('search matches every word against the name, key or summary', () => {
  const p = { name: 'Coachella rescue', key: 'CVR', summary: 'Websites for local shops' }
  assert.equal(matchesProjectQuery(p, ''), true)
  assert.equal(matchesProjectQuery(p, 'cvr'), true)
  assert.equal(matchesProjectQuery(p, 'local  RESCUE'), true)
  assert.equal(matchesProjectQuery(p, 'rescue mobile'), false)
})

test('projects are ordered open, completed, archived, then by latest activity and name', () => {
  const summaries = summarizeProjects(
    [
      project('p1', 'B', { name: 'Beta', updatedAt: 10 }), project('p2', 'A', { name: 'Alpha', updatedAt: 10 }),
      project('p3', 'C', { updatedAt: 50, lifecycle: 'paused' }), project('p4', 'D', { updatedAt: 900, lifecycle: 'archived' }),
      project('p5', 'E', { updatedAt: 800, lifecycle: 'completed' }),
    ],
    [issue('i', { projectId: 'p1', updatedAt: 99 })], [], now,
  )
  assert.deepEqual(sortByActivity(summaries).map((s) => s.project.id), ['p1', 'p3', 'p2', 'p5', 'p4'])
})

test('activity reads as a relative time, then a date after a month', () => {
  assert.equal(updatedLabel(now - 20_000, now), 'just now')
  assert.equal(updatedLabel(now - 3 * 60 * 60 * 1000, now), '3 h ago')
  assert.equal(updatedLabel(now - 40 * DAY, now), 'on Sep 28')
  assert.equal(updatedLabel(Date.parse('2025-03-04T12:00:00Z'), now), 'on Mar 4, 2025')
  assert.equal(updatedLabel(0, now), 'No activity yet')
})
