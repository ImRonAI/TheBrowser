import test from 'node:test'
import assert from 'node:assert/strict'
import {
  documentContent, htmlToText, importantDates, issueContent, issueItem, mentionAt, projectContent, projectItem, removeMention,
  searchContexts, threadContent, threadItem, todayItem, type ContextCategory,
} from './chat-context.ts'
import type { Issue, Project } from '../types/projects.ts'
import type { Thread } from './threads-api.ts'

const NOW = new Date(2026, 10, 7, 10, 0).getTime()
const at = (days: number, hour = 12) => new Date(2026, 10, 7 + days, hour, 0).toISOString()

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1', version: 1, lifecycle: 'active', key: 'RON', name: 'Ron Browser', type: 'software-development',
  summary: 'The agentic browser', createdAt: NOW, updatedAt: NOW, settings: { allowCrossProjectParents: false }, ...over,
})
const issue = (over: Partial<Issue> = {}): Issue => ({
  id: 'i1', number: 7, version: 1, customFields: {}, workProducts: [], context: [], projectId: 'p1', type: 'task',
  title: 'Ship the context menu', status: 'in-progress', priority: 'high', assignees: [], labels: ['ui'],
  createdAt: NOW, updatedAt: NOW, rank: 1, ...over,
})

test('issues and projects become items keyed by their record, with real keys and status', () => {
  const projects = [project()]
  const item = issueItem(issue({ dueDate: at(2) }), projects, NOW)
  assert.equal(item.id, 'issue:i1')
  assert.equal(item.name, 'RON-7 Ship the context menu')
  assert.match(item.description!, /In Progress · Ron Browser · due in 2 days/)
  assert.deepEqual(item.ref, { issueId: 'i1', projectId: 'p1' })
  assert.equal(issueItem(issue({ dueDate: at(-1) }), projects, NOW).meta, 'Overdue')

  const summary = projectItem(project(), [issue(), issue({ id: 'i2', status: 'done' }), issue({ id: 'i3', projectId: 'other' })])
  assert.equal(summary.description, 'RON · 1 open of 2 issues')
})

test('important dates: overdue first, then upcoming due/start/end dates in order; done issues are never due', () => {
  const issues = [
    issue({ id: 'late', title: 'Late', dueDate: at(-3) }),
    issue({ id: 'soon', title: 'Soon', dueDate: at(1), startDate: at(0, 15) }),
    issue({ id: 'far', title: 'Far', dueDate: at(90) }),
    issue({ id: 'old', title: 'Old', dueDate: at(-45) }),
    issue({ id: 'finished', title: 'Finished', status: 'done', dueDate: at(2), endDate: at(5) }),
  ]
  const events = importantDates(issues, [project()], NOW)
  assert.deepEqual(events.map((event) => event.id), ['event:late:due', 'event:soon:start', 'event:soon:due', 'event:finished:end'])
  assert.equal(events[0].meta, 'Overdue')
  assert.equal(events[1].meta, 'Today')
  assert.equal(events[2].meta, 'Tomorrow')
  assert.equal(events[0].ref?.dateKind, 'due')
  assert.equal(importantDates(issues, [project({ lifecycle: 'archived' })], NOW).length, 0)
  assert.equal(todayItem(NOW, 'America/New_York').ref?.dateKind, 'today')
})

test('search ranks prefix matches across categories and keeps the category', () => {
  const categories: ContextCategory[] = [
    { id: 'tabs', name: 'Open tabs', description: '', items: [{ id: 't', type: 'tab', name: 'GitHub', url: 'https://github.com/ron' }] },
    { id: 'issues', name: 'Issues', description: '', items: [{ id: 'i', type: 'issue', name: 'RON-1 Fix the GitHub sync' }, { id: 'x', type: 'issue', name: 'Unrelated' }] },
  ]
  const results = searchContexts(categories, 'git')
  assert.deepEqual(results.map((result) => result.item.id), ['t', 'i'])
  assert.equal(results[1].category.id, 'issues')
  assert.equal(searchContexts(categories, '').length, 3)
  assert.equal(searchContexts(categories, 'zzz').length, 0)
})

test('mentions: only an @ at a word start, and removal tidies spaces', () => {
  assert.deepEqual(mentionAt('look at @ron', 12), { query: 'ron', start: 8 })
  assert.deepEqual(mentionAt('@', 1), { query: '', start: 0 })
  assert.equal(mentionAt('mail me@ron', 11), null)
  assert.deepEqual(mentionAt('@launch sprint', 14), { query: 'launch sprint', start: 0 })
  assert.deepEqual(mentionAt('see @ron ', 9), { query: 'ron ', start: 4 })
  assert.equal(mentionAt('see @ ', 6), null)
  assert.equal(mentionAt('a@b and @x@y', 12), null)
  assert.deepEqual(removeMention('look at @ron please', 8, 12), { text: 'look at please', caret: 8 })
})

test('what the agent reads: issue fields with plain-text description, project rollup, chat transcript', () => {
  const projects = [project()]
  const parent = issue({ id: 'parent', number: 1, title: 'Epic', type: 'epic' })
  const child = issue({ parentId: 'parent', dueDate: at(-1), description: '<p>First <strong>line</strong></p><ul><li>one</li><li>two &amp; three</li></ul>' })
  const text = issueContent(child, projects, [parent, child], NOW)
  assert.match(text, /^Issue RON-7: Ship the context menu/)
  assert.match(text, /Status: In Progress · Priority: High/)
  assert.match(text, /\(overdue\)/)
  assert.match(text, /Parent: RON-1 Epic/)
  assert.match(text, /Description:\nFirst line\n\n- one\n- two & three/)

  const rollup = projectContent(project(), [child, issue({ id: 'b', title: 'Later', dueDate: at(3), status: 'backlog' })], NOW)
  assert.match(rollup, /Issues: 2 \(Backlog 1, In Progress 1, Review 0, Blocked 0, Done 0\)/)
  assert.match(rollup, /Overdue:\n- RON-7 Ship the context menu/)
  assert.match(rollup, /Next due:\n- RON-7 Later/)

  const thread: Thread = {
    id: 't', session_id: 's', destination: 'panel', title: 'Trip planning', last_agent: 'chat', browser: 'user', message_count: 4,
    created_at: at(-2), updated_at: at(-1),
    messages: [
      { seq: 0, role: 'user', kind: 'user_prompt', agent: 'chat', content: [{ text: 'Find flights to Lisbon' }], created_at: at(-2) },
      { seq: 1, role: 'assistant', kind: 'tool_call', agent: 'chat', content: [{ toolUse: {} }], created_at: at(-2) },
      { seq: 1, role: 'assistant', kind: 'assistant_output', agent: 'chat', content: [{ text: 'TAP has one at 9am.' }], created_at: at(-2) },
    ],
  }
  const transcript = threadContent(thread)
  assert.match(transcript, /^Previous chat "Trip planning" · 4 messages/)
  assert.match(transcript, /User: Find flights to Lisbon\n\nRen: TAP has one at 9am\.$/)
  assert.match(threadContent(thread, 115), /\[1 earlier turn omitted\]\n\nRen: TAP/)
  assert.equal(threadItem(thread, NOW).ref?.sessionId, 's')
})

test('html to text and page content', () => {
  assert.equal(htmlToText('<h1>Plan</h1><p>A<br>B</p><p></p><p>C</p>'), 'Plan\nA\nB\n\nC')
  assert.match(documentContent('Spec', '<p>Hello</p>', 'Ron Browser'), /^Project page "Spec" in Ron Browser:\nHello$/)
  assert.equal(documentContent('Blank', '<p></p>'), 'Project page "Blank":\n(This page is empty.)')
})
