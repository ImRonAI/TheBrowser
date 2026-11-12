import assert from 'node:assert/strict'
import test from 'node:test'
import type { Issue, IssueLink, IssueStatus, Project } from '../types/projects.ts'
import {
  DEFAULT_RELATION, RELATION_GROUP_ORDER, RELATION_KINDS, RELATION_KIND_ROWS, isActiveBlock, linkFor, relationCandidates,
  relationCount, relationError, relationGroups, relationKind, relationOf, type RelationKind,
} from './issue-relationships.ts'

const project = (id: string, key: string): Project => ({
  id, key, name: `${key} project`, version: 1, lifecycle: 'active', type: 'software-development',
  createdAt: 0, updatedAt: 0, settings: { allowCrossProjectParents: false },
})
const issue = (id: string, projectId: string, number: number, title: string, status: IssueStatus = 'backlog', updatedAt = 0): Issue => ({
  id, projectId, number, version: 1, type: 'task', title, description: '', status, priority: 'medium',
  assignees: [], labels: [], rank: number, customFields: {}, workProducts: [], context: [], createdAt: 0, updatedAt,
})
const link = (id: string, sourceId: string, targetId: string, type: IssueLink['type'], createdAt = 0): IssueLink =>
  ({ id, sourceId, targetId, type, createdAt })
const KINDS = Object.keys(RELATION_KINDS) as RelationKind[]

test('every type reads two ways (relates one way), with the labels the views use', () => {
  assert.deepEqual(Object.fromEntries(KINDS.map((kind) => [kind, RELATION_KINDS[kind].label])), {
    relates: 'Relates to', blocks: 'Blocks', 'blocked-by': 'Blocked by', enables: 'Enables', 'enabled-by': 'Enabled by',
    implements: 'Implements', 'implemented-by': 'Implemented by', fixes: 'Fixes', 'fixed-by': 'Fixed by',
    discovers: 'Discovers', 'discovered-by': 'Discovered by', duplicates: 'Duplicates', 'duplicated-by': 'Duplicated by',
  })
  for (const type of ['blocks', 'enables', 'implements', 'fixes', 'discovers', 'duplicates'] as const) {
    const readings = KINDS.filter((kind) => RELATION_KINDS[kind].type === type)
    assert.deepEqual(readings.map((kind) => RELATION_KINDS[kind].outgoing), [true, false], type)
  }
  assert.deepEqual(KINDS.filter((kind) => RELATION_KINDS[kind].type === 'relates'), ['relates'])
  assert.equal(DEFAULT_RELATION, 'relates')
  assert.equal(RELATION_KINDS['blocked-by'].hint, 'This issue moves to Blocked until that one is done.')
  for (const kind of KINDS) assert.match(RELATION_KINDS[kind].hint, /^[^\n]{10,80}$/, kind)
  // The picker and the views each show every kind exactly once.
  assert.deepEqual(RELATION_KIND_ROWS.flat().sort(), [...KINDS].sort())
  assert.deepEqual([...RELATION_GROUP_ORDER].sort(), [...KINDS].sort())
  assert.deepEqual(RELATION_GROUP_ORDER.slice(0, 2), ['blocked-by', 'blocks'])
  assert.equal(RELATION_GROUP_ORDER.at(-1), 'relates')
})

test('an inverse kind swaps the ends, and every created link reads back as the chosen kind', () => {
  assert.deepEqual(linkFor('blocks', 'me', 'x'), { sourceId: 'me', targetId: 'x', type: 'blocks' })
  assert.deepEqual(linkFor('blocked-by', 'me', 'x'), { sourceId: 'x', targetId: 'me', type: 'blocks' })
  assert.deepEqual(linkFor('duplicated-by', 'me', 'x'), { sourceId: 'x', targetId: 'me', type: 'duplicates' })
  assert.deepEqual(linkFor('relates', 'me', 'x'), { sourceId: 'me', targetId: 'x', type: 'relates' })
  for (const kind of KINDS) {
    const created: IssueLink = { id: 'l', createdAt: 0, ...linkFor(kind, 'me', 'x') }
    assert.deepEqual(relationOf(created, 'me'), { kind, otherId: 'x' }, kind)
    const inverse = relationOf(created, 'x')!.kind
    assert.equal(RELATION_KINDS[inverse].type, RELATION_KINDS[kind].type)
    assert.equal(inverse === kind, kind === 'relates', kind)
  }
  // `relates` reads the same from either end (Supabase stores it in uuid order).
  assert.deepEqual(relationOf(link('l', 'x', 'me', 'relates'), 'me'), { kind: 'relates', otherId: 'x' })
  assert.equal(relationOf(link('l', 'a', 'b', 'blocks'), 'me'), null)
  assert.equal(relationKind('clones', true), 'relates')
})

test("an issue's links group by how it reads them, dependencies first, oldest link first", () => {
  const issues = [issue('me', 'p', 1, 'Me'), issue('a', 'p', 2, 'A'), issue('b', 'p', 3, 'B'), issue('c', 'q', 4, 'C'), issue('d', 'p', 5, 'D')]
  const links = [
    link('1', 'me', 'b', 'relates', 30),
    link('2', 'a', 'me', 'blocks', 20),
    link('3', 'me', 'c', 'blocks', 10),
    link('4', 'd', 'me', 'blocks', 5),
    link('5', 'a', 'b', 'blocks', 1),
    link('6', 'gone', 'me', 'fixes', 2),
  ]
  const groups = relationGroups('me', links, issues)
  assert.deepEqual(groups.map((group) => [group.kind, group.label, group.relations.map((relation) => relation.otherId)]), [
    ['blocked-by', 'Blocked by', ['d', 'a']],
    ['blocks', 'Blocks', ['c']],
    ['fixed-by', 'Fixed by', ['gone']],
    ['relates', 'Relates to', ['b']],
  ])
  assert.equal(groups[0].relations[1].other?.title, 'A')
  assert.equal(groups[2].relations[0].other, undefined, 'an issue that is not loaded is still listed, without its copy')
  assert.equal(relationCount('me', links), 5)
  assert.deepEqual(relationGroups('nobody', links, issues), [])
})

test('a blocking relationship holds work only while its blocker is unfinished', () => {
  const me = issue('me', 'p', 1, 'Me', 'in-progress')
  const [heldBy, holds] = relationGroups('me', [link('1', 'a', 'me', 'blocks'), link('2', 'me', 'b', 'blocks')],
    [me, issue('a', 'p', 2, 'A', 'review'), issue('b', 'p', 3, 'B', 'blocked')])
  assert.equal(isActiveBlock(heldBy.relations[0], me), true)
  assert.equal(isActiveBlock(holds.relations[0], me), true)
  assert.equal(isActiveBlock(holds.relations[0], { status: 'done' }), false, 'a finished issue holds nothing')
  const [released] = relationGroups('me', [link('1', 'a', 'me', 'blocks')], [me, issue('a', 'p', 2, 'A', 'done')])
  assert.equal(isActiveBlock(released.relations[0], me), false)
  const [related] = relationGroups('me', [link('1', 'me', 'a', 'relates')], [me, issue('a', 'p', 2, 'A')])
  assert.equal(isActiveBlock(related.relations[0], me), false)
})

const projects = [project('p', 'CAL'), project('q', 'OPS')]
const me = issue('me', 'p', 1, 'Calendar sync')
const issues = [
  me,
  issue('cal12', 'p', 12, 'Rename settings', 'backlog', 1),
  issue('cal120', 'p', 120, 'Archive old events', 'done', 5),
  issue('ops7', 'q', 7, 'Cal-12 follow-up', 'in-progress', 9),
  issue('ops8', 'q', 8, 'Fix the  CAL-12 regression', 'review', 3),
  issue('ops9', 'q', 9, 'Unrelated work'),
]
const search = (query: string, kind: RelationKind = 'relates', links: IssueLink[] = [], limit?: number) =>
  relationCandidates(query, { issue: me, kind, issues, projects, links, limit })
const keys = (query: string, kind?: RelationKind, links?: IssueLink[]) => search(query, kind, links).map((candidate) => candidate.key)

test('the search ranks an exact key, a key prefix, a title prefix, then a title containing the query', () => {
  const found = search('  CAL-12 ')
  assert.deepEqual(found.map((candidate) => [candidate.key, candidate.tier]), [['CAL-12', 0], ['CAL-120', 1], ['OPS-7', 2], ['OPS-8', 3]])
  assert.equal(found[2].project?.key, 'OPS')
  assert.deepEqual(keys('cal-'), ['CAL-120', 'CAL-12', 'OPS-7', 'OPS-8'], 'key prefixes rank above title matches')
  assert.deepEqual(keys('archive'), ['CAL-120'])
  assert.deepEqual(keys('nothing like it'), [])
})

test('a bare number finds the issue with that number in every project', () => {
  assert.deepEqual(keys('12'), ['CAL-12', 'CAL-120', 'OPS-7', 'OPS-8'])
  assert.deepEqual(keys('#12'), ['CAL-12', 'CAL-120'])
  assert.deepEqual(keys('9'), ['OPS-9'], 'an exact number in another project still ranks as an exact key')
})

test("with no query every other issue is offered: the issue's own project first, most recently updated first", () => {
  assert.deepEqual(keys(''), ['CAL-120', 'CAL-12', 'OPS-7', 'OPS-8', 'OPS-9'])
  assert.equal(search('', 'relates', [], 2).length, 2)
})

test('an issue already related by the same type is left out, whichever way the link runs', () => {
  const links = [link('1', 'cal12', 'me', 'blocks'), link('2', 'ops7', 'me', 'duplicates'), link('3', 'x', 'ops9', 'relates')]
  assert.ok(!keys('cal-12', 'blocked-by', links).includes('CAL-12'), 'the same relationship')
  assert.ok(!keys('cal-12', 'blocks', links).includes('CAL-12'), 'the reverse would be a deadlock')
  assert.ok(keys('cal-12', 'relates', links).includes('CAL-12'), 'another type is still offered')
  assert.ok(!keys('cal', 'duplicates', links).includes('OPS-7'))
  assert.ok(keys('unrelated', 'relates', links).includes('OPS-9'), "other issues' links do not count")
  assert.ok(!keys('', 'relates', links).includes('CAL-1'), 'never the issue itself')
})

test('a relationship that already exists reads as such; other errors pass through', () => {
  assert.equal(relationError('duplicate key value violates unique constraint "issue_links_unique_edge"'), 'These issues are already related this way.')
  assert.equal(relationError('Relationship already exists'), 'These issues are already related this way.')
  const lost = 'Connection interrupted; no save was confirmed. Reload before retrying.'
  assert.equal(relationError(lost), lost)
})
