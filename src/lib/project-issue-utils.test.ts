import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canPlaceIssue, fromLocalDateTime, issueDefinitions, issueOnDay, toLocalDateTime, validateIssueDates } from './project-issue-utils.ts'
import { issueDraftPatch, rebaseIssueDraft } from './project-issue-draft.ts'
import type { Issue, Project } from '../types/projects.ts'

const project: Project = { id: 'p', version: 1, key: 'PR', name: 'Project', type: 'research', lifecycle: 'active', createdAt: 0, updatedAt: 0,
  settings: { allowCrossProjectParents: false, issueTypes: [{ key: 'goal', label: 'Goal', level: 3 }, { key: 'experiment', label: 'Experiment', level: 4 }, { key: 'step', label: 'Step', level: 5 }] } }
const issue: Issue = { id: 'i', projectId: 'p', number: 1, version: 1, type: 'experiment', title: 'Canonical', status: 'backlog', priority: 'medium',
  rank: 100.5, createdAt: 0, updatedAt: 0, assignees: [], labels: [], customFields: { one: 'original', two: 2 }, workProducts: [], context: [] }

test('configured hierarchy supports custom types and forbids cross-project parents', () => {
  assert.equal(issueDefinitions(project)[0].key, 'goal')
  assert.equal(canPlaceIssue(project, 'step', issue), true)
  assert.equal(canPlaceIssue(project, 'step'), false)
  assert.equal(canPlaceIssue(project, 'experiment'), true)
  assert.equal(canPlaceIssue(project, 'step', { ...issue, projectId: 'other' }), false)
  assert.equal(canPlaceIssue(project, 'unknown'), false)
  assert.equal(canPlaceIssue(project, 'experiment', issue), false)
})

test('datetime local conversion is a round trip and nullable clearing is explicit', () => {
  assert.equal(toLocalDateTime(fromLocalDateTime('2026-09-21T14:30')), '2026-09-21T14:30')
  assert.equal(fromLocalDateTime(''), undefined)
  assert.equal(toLocalDateTime(undefined), '')
  assert.equal(toLocalDateTime('invalid'), '')
  assert.throws(() => fromLocalDateTime('2026-02-30T10:00'), /does not exist/)
})

test('DST nonexistent wall time is rejected, not silently shifted', () => {
  const previous = process.env.TZ
  try {
    process.env.TZ = 'America/New_York'
    assert.throws(() => fromLocalDateTime('2026-03-08T02:30'), /does not exist/)
    assert.equal(fromLocalDateTime('2026-03-08T03:30'), '2026-03-08T07:30:00.000Z')
    assert.equal(toLocalDateTime('2026-09-22T01:00:00Z'), '2026-09-21T21:00')
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

test('calendar covers actual start/end spans and independent due dates without invented dates', () => {
  const dated = { ...issue, startDate: fromLocalDateTime('2026-09-21T09:00'), endDate: fromLocalDateTime('2026-09-23T12:00'), dueDate: fromLocalDateTime('2026-09-25T15:00') }
  assert.equal(issueOnDay(dated, new Date(2026, 8, 22)), true)
  assert.equal(issueOnDay(dated, new Date(2026, 8, 25)), true)
  assert.equal(issueOnDay(dated, new Date(2026, 8, 24)), false)
  assert.equal(issueOnDay(issue, new Date(2026, 8, 21)), false)
  assert.equal(issueOnDay({ ...issue, endDate: dated.endDate }, new Date(2026, 8, 23)), true)
  assert.throws(() => validateIssueDates({ startDate: dated.endDate, endDate: dated.startDate }), /End/)
})

test('draft patches include only changed mutable fields, including explicit clears', () => {
  assert.deepEqual(issueDraftPatch(issue, { ...issue, id: 'forged', version: 100, title: 'Draft', rank: 900 }), { title: 'Draft' })
  assert.deepEqual(issueDraftPatch({ ...issue, dueDate: '2026-09-21T10:00:00Z' }, issue), { dueDate: undefined })
  assert.deepEqual(issueDraftPatch(issue, structuredClone(issue)), {})
})

test('explicit conflict rebase preserves remote-only changes and merges custom fields by key', () => {
  const draft = { ...issue, title: 'Local', customFields: { one: 'Local', two: 2 } }
  const remote = { ...issue, version: 2, title: 'Remote', description: 'Remote description', customFields: { one: 'Remote', two: 3, three: true } }
  const rebased = rebaseIssueDraft(issue, draft, remote)
  assert.equal(rebased.title, 'Local')
  assert.equal(rebased.version, 2)
  assert.equal(rebased.description, 'Remote description')
  assert.deepEqual(rebased.customFields, { one: 'Local', two: 3, three: true })
  assert.deepEqual(rebaseIssueDraft(issue, { ...issue, customFields: { two: 2 } }, remote).customFields, { two: 3, three: true })
  assert.throws(() => rebaseIssueDraft(issue, draft, { ...remote, id: 'other' }), /between issues/)
  assert.equal(draft.title, 'Local')
  assert.equal(issue.title, 'Canonical')
})