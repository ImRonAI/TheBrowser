import { test } from 'node:test'
import assert from 'node:assert/strict'
import { descriptionRequestMessage, descriptionRetryMessage, draftParts, issueRunMessage, issueRunStatus } from './ron-draft.ts'
import type { PanelMessage } from './panel-stream.ts'

const tool = (id: string, name: string, input: unknown = {}) =>
  ({ kind: 'tool' as const, key: id, id, name, path: [], input, progress: [], finished: true, status: 'success' })
const text = (key: string, value: string) => ({ kind: 'text' as const, key, path: [], text: value })

test('tracing holds research, reasoning and narration; the draft is what Ron wrote after its last research call', () => {
  const workflow = tool('w1', 'render_workflow', { title: 'Release', steps: [{ id: 'a', label: 'Build' }, { id: 'b', label: 'Ship' }] })
  const message: PanelMessage = { id: 'm', role: 'assistant', parts: [
    { kind: 'reasoning', key: 'r1', path: [], text: 'Need sources' },
    text('t1', 'Let me look this up.'),
    tool('s1', 'brave_web_search', { query: 'strands agents' }),
    text('t2', '# Guide\n\nUse the SDK.'),
    workflow,
    text('t3', 'Done.'),
  ] }
  const { tracing, segments } = draftParts(message)
  assert.deepEqual(tracing.map((part) => part.key), ['r1', 't1', 's1'])
  assert.deepEqual(segments.map((segment) => segment.kind), ['text', 'workflow', 'text'])
  assert.equal(segments[0].kind === 'text' && segments[0].text, '# Guide\n\nUse the SDK.')
  assert.deepEqual(draftParts(null), { tracing: [], segments: [] })
})

test('an issue-agent run becomes a panel message: one tool part per call, its output as the draft', () => {
  const message = issueRunMessage({ id: 'run1', output: '## Summary\n\nRotate the keys.', status: 'running', error: null, activity: [
    { id: 'c1', name: 'read_issue', status: 'running', input: {} },
    { id: 'c2', name: 'brave_web_search', status: 'running', input: { query: 'key rotation' } },
    { id: 'c1', name: 'read_issue', status: 'success' },
  ] })
  assert.equal(message.role, 'assistant')
  const tools = message.parts.filter((part) => part.kind === 'tool')
  assert.deepEqual(tools.map((part) => [part.id, part.finished, part.status]), [['c1', true, 'success'], ['c2', false, undefined]])
  assert.deepEqual(tools[1].input, { query: 'key rotation' })
  const { tracing, segments } = draftParts(message)
  assert.equal(tracing.length, 2)
  assert.deepEqual(segments, [{ kind: 'text', text: '## Summary\n\nRotate the keys.' }])
  assert.deepEqual(['running', 'completed', 'canceled', 'interrupted', 'failed'].map(issueRunStatus), ['running', 'completed', 'cancelled', 'interrupted', 'error'])
})

test('description messages open with the sentence the issue agent recognises, and goal mode is a prefix', () => {
  assert.match(descriptionRequestMessage('Add acceptance criteria', false), /^Write the description for this issue\. Add acceptance criteria\n/)
  assert.match(descriptionRequestMessage('Ship it', true), /^\/goal Write the description for this issue\. Ship it/)
  const retry = descriptionRetryMessage('  shorter please ')
  assert.match(retry, /^Write the description for this issue\. Revise your last draft with this feedback: shorter please\n/)
  assert.match(retry, /Do not edit the issue with tools/)
})
