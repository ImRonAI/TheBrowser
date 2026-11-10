import assert from 'node:assert/strict'
import test from 'node:test'
import type { Issue, IssueLink, IssueStatus } from '../types/projects.ts'
import { blockedLabel, blockersByIssue, blockingOf } from './issue-blocking.ts'

const issue = (id: string, number: number, status: IssueStatus): Issue => ({
  id, projectId: 'p', number, version: 1, type: 'task', title: id, description: '', status, priority: 'medium',
  assignees: [], labels: [], rank: number, customFields: {}, workProducts: [], context: [], createdAt: 0, updatedAt: 0,
} as Issue)
const link = (id: string, sourceId: string, targetId: string, type: IssueLink['type'] = 'blocks'): IssueLink =>
  ({ id, sourceId, targetId, type, createdAt: 0 })
const keyFor = (item: Issue) => `CAL-${item.number}`

test('an issue is blocked by its unfinished blockers only', () => {
  const api = issue('api', 1, 'in-progress'), docs = issue('docs', 2, 'done'), ui = issue('ui', 3, 'blocked')
  const spec = issue('spec', 4, 'review'), free = issue('free', 5, 'backlog')
  const map = blockersByIssue([api, docs, ui, spec, free], [
    link('1', 'api', 'ui'), link('2', 'docs', 'ui'), link('3', 'spec', 'ui'), link('4', 'api', 'free', 'relates'),
  ])
  const blocking = blockingOf(ui, map)
  assert.equal(blocking.blocked, true)
  assert.deepEqual(blocking.blockers.map((b) => b.id), ['api', 'spec'])
  assert.equal(blockedLabel(blocking, keyFor), 'Blocked by CAL-1, CAL-4')
  assert.deepEqual(blockingOf(free, map), { blocked: false, blockers: [] })
  assert.equal(blockedLabel(blockingOf(free, map), keyFor), '')
})

test('Blocked status alone, or an open blocker on a moved issue, still reads as blocked', () => {
  const manual = issue('manual', 1, 'blocked'), moved = issue('moved', 2, 'in-progress'), blocker = issue('b', 3, 'review')
  const map = blockersByIssue([manual, moved, blocker], [link('1', 'b', 'moved')])
  assert.equal(blockedLabel(blockingOf(manual, map), keyFor), 'Blocked')
  assert.equal(blockedLabel(blockingOf(moved, map), keyFor), 'Blocked by CAL-3')
})
