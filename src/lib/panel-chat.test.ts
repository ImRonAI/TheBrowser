import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatScopeFields, DEFAULT_RUNTIME_OPTIONS, panelSessionKey, panelStatusText, sendsProjectCredential } from './panel-chat.ts'
import { AGENT_LABELS, ARTICLE_DESTINATIONS } from './articles.ts'
import { hydratePanelSession } from './panel-stream.ts'

test('every destination but issue keeps its single remembered session per user', () => {
  assert.equal(panelSessionKey('u1', 'panel'), 'ron-panel-session:u1')
  assert.equal(panelSessionKey('u1', 'build'), 'ron-build-session:u1')
  assert.equal(panelSessionKey('default', 'search'), 'ron-search-session:default')
  // An issue id passed to another destination changes nothing.
  assert.equal(panelSessionKey('u1', 'panel', 'issue-1'), 'ron-panel-session:u1')
})

test('an issue chat remembers one session per user and issue', () => {
  assert.equal(panelSessionKey('u1', 'issue', 'i-1'), 'ron-issue-session:u1:i-1')
  assert.notEqual(panelSessionKey('u1', 'issue', 'i-1'), panelSessionKey('u1', 'issue', 'i-2'))
  assert.notEqual(panelSessionKey('u1', 'issue', 'i-1'), panelSessionKey('u2', 'issue', 'i-1'))
  assert.throws(() => panelSessionKey('u1', 'issue'), /issue id/)
})

test('only issue turns name the issue in the /chat body', () => {
  assert.deepEqual(chatScopeFields('issue', 'i-1'), { issue_id: 'i-1' })
  for (const destination of ['panel', 'search', 'build', 'voice'] as const) {
    assert.deepEqual(chatScopeFields(destination, 'i-1'), {})
    // Spreading the fields leaves another destination's body byte-for-byte unchanged.
    const body = { session_id: 's', destination, attachments: [] }
    assert.equal(JSON.stringify({ ...body, ...chatScopeFields(destination) }), JSON.stringify(body))
  }
  assert.throws(() => chatScopeFields('issue', ''), /issue id/)
})

test('every issue turn and every project-agent turn carries the project credential; nothing else does', () => {
  assert.equal(sendsProjectCredential('issue', 'ron'), true)
  assert.equal(sendsProjectCredential('panel', 'project'), true)
  assert.equal(sendsProjectCredential('panel', 'ron'), false)
  assert.equal(sendsProjectCredential('panel', 'specialist'), false)
  assert.equal(sendsProjectCredential('build', 'ron'), false)
})

test('the status line follows the connection first, then the run', () => {
  assert.equal(panelStatusText({ connection: 'loading', status: 'running' }), 'Restoring session…')
  assert.equal(panelStatusText({ connection: 'reconnecting', status: 'idle' }), 'Reconnecting to run…')
  assert.equal(panelStatusText({ connection: 'detached', status: 'running' }), 'Disconnected · run may still be active')
  assert.equal(panelStatusText({ connection: 'connected', status: 'running' }), 'Working')
  assert.equal(panelStatusText({ connection: 'connected', status: 'running', background: true }), 'Working · background enabled')
  assert.equal(panelStatusText({ connection: 'connected', status: 'checkpointed' }), 'Paused at checkpoint')
  assert.equal(panelStatusText({ connection: 'connected', status: 'interrupted' }), 'Waiting for your response')
  assert.equal(panelStatusText({ connection: 'connected', status: 'cancelled' }), 'Stopped')
  assert.equal(panelStatusText({ connection: 'connected', status: 'error' }), 'Run failed')
  assert.equal(panelStatusText({ connection: 'connected', status: 'completed' }), 'Completed')
  assert.equal(panelStatusText({ connection: 'connected', status: 'idle' }), 'Ready')
})

test('new conversations start from the native defaults', () => {
  assert.deepEqual(DEFAULT_RUNTIME_OPTIONS, { checkpointing: false, tool_execution: 'concurrent', context: 'auto', goal: '', background: false })
})

test('an issue snapshot hydrates like any other session (destination and issue_id are pinned server-side)', () => {
  const state = hydratePanelSession('agent-1', {
    run_id: 'r1', sequence: 4, status: 'completed', configuration_locked: true,
    selection: { destination: 'issue', issue_id: 'i-1', provider: 'xai', model_id: 'grok-4.7', reasoning_effort: 'high', agent: { kind: 'ron', id: '' } },
    options: { goal: '' },
    messages: [{ role: 'user', content: [{ text: 'Split this into child issues' }] }, { role: 'assistant', content: [{ text: 'Done.' }] }],
  })
  assert.equal(state.status, 'completed')
  assert.equal(state.configurationLocked, true)
  assert.deepEqual(state.configuration, { model: 'grok-4.7', provider: 'xai', effort: 'high', options: { goal: '' }, agent: { kind: 'ron', id: '' } })
  assert.equal(state.messages.length, 2)
  assert.equal(state.error, undefined)
})

test('issue is a chat destination, not an "Attach to" target for articles', () => {
  assert.equal(AGENT_LABELS.issue, 'Issue agent')
  assert.ok(!ARTICLE_DESTINATIONS.includes('issue'))
  // The attach menu keeps exactly its previous destinations, in order.
  assert.deepEqual([...ARTICLE_DESTINATIONS], ['panel', 'search', 'build', 'voice'])
})
