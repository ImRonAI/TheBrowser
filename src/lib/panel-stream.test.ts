import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CHAIN_TOOLS, PanelReplayOverflow, PanelSSEParser, emptyPanelState, groupThinkParts, hydratePanelSession, parsePanelEvent, readPanelStream, reconcilePanelSession, isBrowserUnavailable, isHitlApproval, repairToolTitle, isNativePart, reducePanelEvent, resolveBrowserSelection, shouldFollowPanel,
  type NativePart, type PanelEvent, type PanelPart, type ToolPart,
} from './panel-stream.ts'

function event(sequence: number, type: string, payload: Record<string, unknown> = {}): PanelEvent {
  return { version: 1, sequence, session_id: 'session', run_id: 'run', node_path: [], type, ...payload }
}

test('SSE supports every character boundary, CRLF, comments, multiline JSON and an EOF frame', () => {
  const first = event(1, 'text_delta', { data: 'a café 🌍\nnext line' })
  const second = event(2, 'run_finished', { status: 'completed' })
  const multiline = JSON.stringify(first, null, 2).split('\n').map((line) => `data: ${line}`).join('\r\n')
  const wire = `\uFEFF: heartbeat\r\nid: 1\r\nevent: message\r\n${multiline}\r\n\r\ndata: ${JSON.stringify(second)}`
  for (let split = 0; split <= wire.length; split++) {
    const events: PanelEvent[] = []
    const parser = new PanelSSEParser((value) => events.push(value))
    parser.push(wire.slice(0, split))
    parser.push(wire.slice(split), true)
    assert.deepEqual(events, [first, second], `split ${split}`)
  }
})

test('bytewise UTF-8 stream is decoded and terminal errors are delivered, not swallowed', async () => {
  const expected = [event(1, 'text_delta', { data: '你好 🌍' }), event(2, 'error', { error: 'Provider failed after text' })]
  const bytes = new TextEncoder().encode(expected.map((item) => `data: ${JSON.stringify(item)}\n\n`).join(''))
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
    controller.close()
  } }))
  const events: PanelEvent[] = []
  assert.equal(await readPanelStream(response, (item) => { events.push(item) }), true)
  assert.deepEqual(events, expected)
  const state = events.reduce(reducePanelEvent, emptyPanelState('session'))
  assert.equal(state.status, 'error')
  assert.equal(state.error, 'Provider failed after text')
  assert.equal(state.messages[0].parts[0].kind, 'text')
})

test('provider failures remain visible through terminal events and snapshot hydration', () => {
  const error = { type: 'EventLoopException', message: "Unexpected role 'tool' after role 'user'" }
  let state = reducePanelEvent(emptyPanelState('session'), event(1, 'error', { error, recovery_required: false }))
  state = reducePanelEvent(state, event(2, 'run_finished', { status: 'failed', stop_reason: 'error' }))
  assert.match(state.error!, /Unexpected role/)
  assert.notEqual(state.recoveryRequired, true)
  const restored = hydratePanelSession('session', { status: 'failed', error, recovery_required: false })
  assert.match(restored.error!, /Unexpected role/)
  assert.equal(restored.recoveryRequired, false)
  for (const recovery of [
    reducePanelEvent(emptyPanelState('session'), event(1, 'error', { error, recovery_required: true })),
    hydratePanelSession('session', { status: 'failed', error, recovery_required: true }),
  ]) {
    assert.match(recovery.error!, /Unexpected role/)
    assert.match(recovery.error!, /Recovery required/)
    assert.equal(recovery.recoveryRequired, true)
  }
  assert.equal(hydratePanelSession('session', { status: 'failed', error: null }).error, 'Previous agent run failed')
})

test('malformed envelopes and malformed EOF data fail explicitly', async () => {
  assert.throws(() => parsePanelEvent('{'), /Invalid JSON/)
  assert.throws(() => parsePanelEvent(JSON.stringify({ type: 'text_delta', data: 'legacy' })), /envelope/)
  await assert.rejects(readPanelStream(new Response('data: {"version":1'), () => {}), /Invalid JSON/)
  assert.equal(await readPanelStream(new Response(`data: ${JSON.stringify(event(1, 'text_delta', { data: 'partial' }))}`), () => {}), false)
  await assert.rejects(readPanelStream(new Response('{"detail":"Invalid model"}', { status: 422 }), () => {}), /Invalid model/)
})

test('replay ignores historical terminal frames and stops on the accepted run', async () => {
  const old = event(1, 'run_finished', { run_id: 'old', status: 'completed' })
  const current = event(2, 'text_delta', { data: 'still working' })
  const response = new Response(`data: ${JSON.stringify(old)}\n\ndata: ${JSON.stringify(current)}\n\n`)
  assert.equal(await readPanelStream(response, (item) => item.run_id !== 'old'), false)
})

test('terminal envelope detaches an otherwise open HTTP stream without waiting for EOF', async () => {
  let detached = false
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event(1, 'run_finished', { status: 'cancelled' }))}\n\n`))
    },
    cancel() { detached = true },
  }))
  assert.equal(await readPanelStream(response, () => {}), true)
  assert.equal(detached, true)
})

test('ordered parts distinguish nested tool IDs and dedupe sequences and results', () => {
  let state = emptyPanelState('session')
  const frames = [
    event(1, 'run_started'), event(2, 'text_delta', { data: 'Before' }),
    event(3, 'tool_input', { id: 'same', name: 'root', input: { command: 'pwd' } }),
    event(4, 'tool_input', { id: 'same', name: 'nested', node_path: ['worker'], input: { query: 'abc' } }),
    event(5, 'tool_progress', { id: 'same', name: 'nested', node_path: ['worker'], data: 'searching' }),
    event(6, 'tool_result', { id: 'same', node_path: ['worker'], status: 'success', content: 'nested result' }),
    event(7, 'text_delta', { data: 'After' }),
    event(8, 'tool_result', { id: 'same', status: 'success', content: 'root result' }),
  ]
  for (const frame of frames) state = reducePanelEvent(state, frame)
  assert.deepEqual(state.messages[0].parts.map((part) => part.kind), ['text', 'tool', 'tool', 'text'])
  const root = state.messages[0].parts[1] as ToolPart
  const nested = state.messages[0].parts[2] as ToolPart
  assert.notEqual(root.key, nested.key)
  assert.equal(root.output, 'root result')
  assert.equal(nested.output, 'nested result')
  assert.deepEqual(nested.progress, ['searching'])
  assert.equal(reducePanelEvent(state, frames[6]), state)
  state = reducePanelEvent(state, event(9, 'tool_result', { id: 'same', content: 'root result' }))
  assert.equal((state.messages[0].parts[1] as ToolPart).output, 'root result')
  state = reducePanelEvent(state, event(10, 'tool_result', { id: 'same', content: 'corrected result' }))
  assert.equal((state.messages[0].parts[1] as ToolPart).output, 'corrected result')
  assert.equal(reducePanelEvent(state, event(10, 'text_delta', { session_id: 'old-session', data: 'pollution' })), state)
})

test('retry marks draft text and reasoning discarded without erasing tools or nested output', () => {
  const state = [
    event(1, 'run_started'), event(2, 'text_delta', { data: 'Confident but discarded', model_attempt: 1, cycle: 1 }),
    event(3, 'reasoning_delta', { data: 'Old reasoning', model_attempt: 1, cycle: 1 }),
    event(4, 'text_delta', { node_path: ['worker'], data: 'Independent worker' }),
    event(5, 'tool_input', { id: 't', name: 'search', input: {} }),
    event(6, 'retry', { attempt: 2, model_attempt: 1, cycle: 1, reason: 'Rate limit' }),
    event(7, 'text_delta', { data: 'Recovered response' }),
  ].reduce(reducePanelEvent, emptyPanelState('session'))
  const parts = state.messages[0].parts
  assert.ok(parts[0].kind === 'text' && parts[0].discarded)
  assert.ok(parts[1].kind === 'reasoning' && parts[1].discarded)
  assert.ok(parts[2].kind === 'text' && !parts[2].discarded)
  assert.equal(parts[3].kind, 'tool')
  assert.equal(parts[4].kind, 'retry')
  assert.ok(parts[5].kind === 'text' && !parts[5].discarded)
})

const previousHistory = [
  { role: 'user', content: [{ text: 'First question' }] },
  { role: 'assistant', content: [{ text: 'First answer' }] },
]
const configuration = {
  selection: { model_id: 'grok-test', provider: 'xai', reasoning_effort: 'high' },
  options: { context: 'sliding', tool_execution: 'sequential', checkpointing: true, background: true, goal: 'Saved goal' },
}

test('active PRE-RUN snapshot replays from replay_after, preserves previous answer and adds input exactly once', () => {
  const snapshot = { ...configuration, status: 'running', active: true, run_id: 'run', sequence: 15, replay_after: 10,
    messages: previousHistory, input: 'Second question' }
  let state = hydratePanelSession('session', snapshot)
  assert.equal(state.sequence, 10)
  assert.equal(state.latestSequence, 15)
  assert.equal(state.needsReplay, true)
  assert.equal(state.messages[1].runId, undefined)
  assert.equal(state.messages[2].runId, 'run')
  assert.deepEqual(state.configuration, { model: 'grok-test', provider: 'xai', effort: 'high', options: configuration.options })
  const frames = [event(11, 'run_started'), event(12, 'text_delta', { data: 'Second ' }),
    event(13, 'tool_input', { id: 't', name: 'search', input: {} }),
    event(14, 'tool_progress', { id: 't', data: 'Searching' }), event(15, 'text_delta', { data: 'answer' })]
  state = frames.reduce(reducePanelEvent, state)
  assert.equal(state.messages.length, 4)
  assert.deepEqual(state.messages[1].parts.map((part) => part.kind !== 'tool' && part.kind !== 'native' && part.text), ['First answer'])
  assert.equal(state.messages.filter((message) => message.role === 'user').length, 2)
  assert.deepEqual(frames.reduce(reducePanelEvent, state), state)
  assert.deepEqual(hydratePanelSession('session', snapshot).messages.length, 3)
  assert.equal(new Set(state.messages.map((message) => message.id)).size, 4)
})

test('native statuses, retained completed events, recovery and resume inputs hydrate correctly', () => {
  for (const status of ['starting', 'running', 'finishing']) {
    const state = hydratePanelSession('session', { status, run_id: 'run', sequence: 8, replay_after: 8 })
    assert.equal(state.status, 'running')
    assert.equal(state.needsReplay, true)
  }
  const retained = hydratePanelSession('session', { status: 'completed', run_id: 'run', sequence: 20, replay_after: 10,
    messages: previousHistory, input: 'Second question' })
  assert.equal(retained.needsReplay, true)
  assert.equal(retained.sequence, 10)
  assert.equal(retained.messages[1].runId, undefined)
  for (const input of [{ checkpointResume: { checkpoint: 'opaque' } }, [{ interruptResponse: { interruptId: 'ask', response: true } }]]) {
    const state = hydratePanelSession('session', { status: 'starting', run_id: 'resume', sequence: 10, replay_after: 10,
      messages: previousHistory, input })
    assert.equal(state.messages.length, 2)
  }
  const failed = hydratePanelSession('session', { status: 'failed', recovery_required: true, messages: previousHistory,
    interrupts: [{ id: 'ask', reason: { choices: [1, 2] } }] })
  assert.equal(failed.status, 'error')
  assert.match(failed.error!, /Recovery required.*New chat/)
  assert.equal(failed.recoveryRequired, true)
  assert.deepEqual(failed.interrupts, [{ id: 'ask', reason: { choices: [1, 2] } }])
  assert.equal(reducePanelEvent(emptyPanelState('session'), event(1, 'run_finished', { status: 'failed' })).status, 'error')
})

test('model retry discards only its attempt/cycle/path; tool and unscoped retries preserve model output', () => {
  const state = [
    event(1, 'text_delta', { data: 'Successful cycle', model_attempt: 1, cycle: 1 }),
    event(2, 'tool_input', { id: 't', name: 'search' }),
    event(3, 'tool_result', { id: 't', content: 'Found' }),
    event(4, 'text_delta', { data: 'Failed draft', model_attempt: 1, cycle: 2 }),
    event(5, 'reasoning_delta', { data: 'Failed reasoning', model_attempt: 1, cycle: 2 }),
    event(6, 'text_delta', { data: 'Nested output', model_attempt: 1, cycle: 2, node_path: ['child'] }),
    event(7, 'retry', { attempt: 2, model_attempt: 1, cycle: 2 }),
    event(8, 'text_delta', { data: 'Replacement', model_attempt: 2, cycle: 2 }),
    event(9, 'retry', { attempt: 3, model_attempt: 2, cycle: 2, id: 't', reason: 'tool hook retry' }),
    event(10, 'retry', { attempt: 4, reason: 'Unscoped retry' }),
  ].reduce(reducePanelEvent, emptyPanelState('session'))
  const drafts = state.messages[0].parts.filter((part) => part.kind === 'text' || part.kind === 'reasoning')
  assert.deepEqual(drafts.map((part) => part.kind !== 'tool' && part.kind !== 'native' && Boolean(part.discarded)), [false, true, true, false, false])
  assert.equal((state.messages[0].parts[1] as ToolPart).output, 'Found')
})

test('canonical completion preserves live progress, nested ordering, IDs, and canonical-only blocks', () => {
  let live = hydratePanelSession('session', { ...configuration, run_id: 'run', status: 'running', sequence: 10, replay_after: 10,
    messages: previousHistory, input: 'Second question' })
  live = [event(11, 'run_started'), event(12, 'text_delta', { data: 'Looking' }),
    event(13, 'tool_input', { id: 't', name: 'search', input: { query: 'q' } }),
    event(14, 'tool_progress', { id: 't', data: 'Halfway' }),
    event(15, 'text_delta', { data: 'Child answer', node_path: ['worker'] }),
    event(16, 'tool_result', { id: 't', content: 'Old result' }),
    event(17, 'text_delta', { data: 'Done' }), event(18, 'run_finished', { status: 'completed' }),
  ].reduce(reducePanelEvent, live)
  const canonical = hydratePanelSession('session', { ...configuration, status: 'completed', run_id: 'run', sequence: 18, replay_after: 18,
    messages: [...previousHistory,
      { role: 'user', content: [{ text: 'Second question' }] },
      { role: 'assistant', content: [{ text: 'Looking' }, { toolUse: { toolUseId: 't', name: 'search', input: { query: 'q' } } }] },
      { role: 'user', content: [{ toolResult: { toolUseId: 't', content: 'Canonical result', status: 'success' } }] },
      { role: 'assistant', content: [{ text: 'Done' }, { structured: { answer: 42 } }] },
    ] })
  const result = reconcilePanelSession(live, canonical)
  assert.deepEqual(result.messages.map((message) => message.id), live.messages.map((message) => message.id))
  const parts = result.messages[3].parts
  assert.deepEqual(parts.map((part) => part.kind), ['text', 'tool', 'text', 'text', 'activity'])
  assert.deepEqual((parts[1] as ToolPart).progress, ['Halfway'])
  assert.equal((parts[1] as ToolPart).output, 'Canonical result')
  assert.deepEqual(parts[2].path, ['worker'])
  assert.deepEqual(reconcilePanelSession(result, canonical), result)
})

test('canonical changed root answer wins without losing nested or retry evidence', () => {
  const live = [event(1, 'run_started'), event(2, 'text_delta', { data: 'Draft' }),
    event(3, 'text_delta', { data: 'Nested', node_path: ['child'] })].reduce(reducePanelEvent, emptyPanelState('session'))
  const canonical = hydratePanelSession('session', { status: 'completed', run_id: 'run', sequence: 4, replay_after: 4,
    messages: [{ role: 'assistant', content: [{ text: 'Canonical answer' }] }] })
  const result = reconcilePanelSession(live, canonical)
  assert.equal(result.messages.length, 1)
  assert.deepEqual(result.messages[0].parts.map((part) => part.kind !== 'tool' && part.kind !== 'native' && part.text), ['Canonical answer', 'Nested'])
})

test('HTTP and midstream overflow explicitly require resynchronization', async () => {
  const overflow = { code: 'replay_overflow', resync_required: true, earliest: 10, latest: 20 }
  await assert.rejects(readPanelStream(new Response(`event: replay_overflow\ndata: ${JSON.stringify(overflow)}\n\n`), () => {}), PanelReplayOverflow)
  await assert.rejects(readPanelStream(new Response(JSON.stringify({ detail: overflow }), { status: 409 }), () => {}), PanelReplayOverflow)
})

test('checkpoint resume canonical history merges consecutive runs without losing earlier progress', () => {
  let live = [event(1, 'run_started'), event(2, 'text_delta', { data: 'Before pause' }),
    event(3, 'tool_input', { id: 't', name: 'search' }), event(4, 'tool_progress', { id: 't', data: 'Scanning' }),
    event(5, 'run_finished', { status: 'checkpointed' }),
    event(6, 'run_started', { run_id: 'resume' }), event(7, 'tool_result', { run_id: 'resume', id: 't', content: 'Found' }),
    event(8, 'text_delta', { run_id: 'resume', data: 'After pause' }),
  ].reduce(reducePanelEvent, emptyPanelState('session'))
  const canonical = hydratePanelSession('session', { status: 'completed', run_id: 'resume', sequence: 9, replay_after: 9,
    messages: [
      { role: 'assistant', content: [{ text: 'Before pause' }, { toolUse: { toolUseId: 't', name: 'search', input: {} } }] },
      { role: 'user', content: [{ toolResult: { toolUseId: 't', content: 'Found' } }] },
      { role: 'assistant', content: [{ text: 'After pause' }] },
    ] })
  live = reconcilePanelSession(live, canonical)
  assert.equal(live.messages.length, 1)
  assert.equal(live.messages[0].runId, 'resume')
  const tool = live.messages[0].parts.find((part): part is ToolPart => part.kind === 'tool')!
  assert.deepEqual(tool.progress, ['Scanning'])
  assert.equal(tool.output, 'Found')
  assert.equal(live.messages[0].parts.filter((part) => part.kind === 'tool').length, 1)
})

test('active rehydration rebuilds only the current run and keeps prior rich history', () => {
  const prior = [event(1, 'run_started', { run_id: 'prior' }),
    event(2, 'text_delta', { run_id: 'prior', data: 'First answer' }),
    event(3, 'text_delta', { run_id: 'prior', node_path: ['child'], data: 'Keep child' })]
    .reduce(reducePanelEvent, emptyPanelState('session'))
  let live = hydratePanelSession('session', { status: 'running', run_id: 'run', sequence: 3, replay_after: 3,
    messages: previousHistory, input: 'Second question' })
  live = reconcilePanelSession(prior, live)
  live = [event(4, 'run_started'), event(5, 'text_delta', { data: 'Partial' })].reduce(reducePanelEvent, live)
  const refreshed = hydratePanelSession('session', { status: 'running', run_id: 'run', sequence: 5, replay_after: 3,
    messages: previousHistory, input: 'Second question' })
  const reset = reconcilePanelSession(live, refreshed)
  assert.equal(reset.sequence, 3)
  assert.equal(reset.messages.length, 3)
  assert.equal(reset.messages[1].parts.length, 2)
  const replayed = [event(4, 'run_started'), event(5, 'text_delta', { data: 'Partial' })].reduce(reducePanelEvent, reset)
  assert.equal(replayed.messages.length, 4)
  assert.equal(replayed.messages[3].parts.length, 1)
})

test('failed run refresh keeps incomplete output as evidence alongside committed history', () => {
  let live = hydratePanelSession('session', { status: 'running', run_id: 'run', sequence: 3, replay_after: 3,
    messages: previousHistory, input: 'Second question' })
  live = [event(4, 'run_started'), event(5, 'text_delta', { data: 'Incomplete' })].reduce(reducePanelEvent, live)
  const snapshot = hydratePanelSession('session', { status: 'failed', recovery_required: true, run_id: 'run', sequence: 7,
    replay_after: 7, messages: previousHistory })
  const merged = reconcilePanelSession(live, snapshot)
  assert.equal(merged.messages.length, 4)
  assert.equal(merged.messages[1].runId, undefined)
  assert.equal(merged.recoveryRequired, true)
  assert.deepEqual(reconcilePanelSession(merged, snapshot), merged)
})

test('nested terminal events cannot finish root; pause and interrupt payloads remain opaque', () => {
  let state = reducePanelEvent(emptyPanelState('session'), event(1, 'run_started'))
  state = reducePanelEvent(state, event(2, 'run_finished', { node_path: ['worker'], status: 'completed' }))
  assert.equal(state.status, 'running')
  const reason = { prompt: 'Choose a path', choices: ['a', 'b'] }
  state = reducePanelEvent(state, event(3, 'interrupt', { interrupts: [{ id: 'ask', reason }] }))
  state = reducePanelEvent(state, event(4, 'run_finished', { status: 'interrupted', stop_reason: 'interrupt' }))
  assert.equal(state.status, 'interrupted')
  assert.deepEqual(state.interrupts, [{ id: 'ask', reason }])
  state = reducePanelEvent(state, event(5, 'run_started', { run_id: 'resumed' }))
  assert.deepEqual(state.interrupts, [])
  state = reducePanelEvent(state, event(6, 'checkpoint', { checkpoint: { opaque: [1, 2] } }))
  state = reducePanelEvent(state, event(7, 'run_finished', { status: 'checkpointed' }))
  assert.deepEqual(state.checkpoint, { opaque: [1, 2] })
})

test('SDK snapshot hydration preserves text/tool order and handles result-only user messages', () => {
  const state = hydratePanelSession('session', {
    status: 'interrupted', run_id: 'run', sequence: 21,
    pending_interrupts: [{ id: 'ask', reason: { prompt: 'Name?' } }], checkpoint: 'opaque',
    messages: [
      { role: 'user', content: [{ text: 'Find a file' }] },
      { role: 'assistant', content: [{ text: 'Looking' }, { toolUse: { toolUseId: 't', name: 'read_file', input: { path: 'a' } } }] },
      { role: 'user', content: [{ toolResult: { toolUseId: 't', status: 'success', content: [{ text: 'file contents' }] } }] },
      { role: 'assistant', content: [{ reasoningContent: { reasoningText: { text: 'Reason' } } }, { text: 'Found it' }] },
    ],
  })
  assert.equal(state.sequence, 21)
  assert.equal(state.messages.length, 2)
  assert.deepEqual(state.messages[1].parts.map((part) => part.kind), ['text', 'tool', 'reasoning', 'text'])
  assert.equal(state.messages[1].runId, 'run')
  assert.deepEqual((state.messages[1].parts[1] as ToolPart).output, [{ text: 'file contents' }])
  assert.equal(state.interrupts[0].id, 'ask')
})

test('gap snapshot attaches at latest without duplicating input; terminal refresh recovers missing root text', async () => {
  let state = hydratePanelSession('session', {
    ...configuration, status: 'running', active: true, run_id: 'run', sequence: 100, replay_after: 100,
    history_incomplete: true, replay_status: 'gap', input: null,
    messages: [...previousHistory, { role: 'user', content: [{ text: 'Second question' }] },
      { role: 'assistant', content: [{ text: 'Completed cycle' }] }],
  })
  assert.equal(state.historyIncomplete, true)
  assert.equal(state.sequence, 100)
  assert.equal(shouldFollowPanel(state), true)
  assert.equal(state.messages.filter((message) => message.role === 'user').length, 2)
  const response = new Response([
    event(101, 'text_delta', { data: 'end of in-flight answer', cycle: 'native-cycle-b', model_attempt: 1 }),
    event(102, 'text_delta', { node_path: ['worker'], data: 'Nested progress' }),
    event(103, 'run_finished', { status: 'completed' }),
  ].map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''))
  assert.equal(await readPanelStream(response, (frame) => { state = reducePanelEvent(state, frame) }), true)
  const canonical = hydratePanelSession('session', { ...configuration, status: 'completed', active: false,
    run_id: 'run', sequence: 103, replay_after: 103, history_incomplete: false, replay_status: 'complete',
    messages: [...previousHistory, { role: 'user', content: [{ text: 'Second question' }] },
      { role: 'assistant', content: [{ text: 'Completed cycle' }, { text: 'Full beginning and end of in-flight answer' }] }],
  })
  state = reconcilePanelSession(state, canonical)
  assert.equal(shouldFollowPanel(state), false)
  assert.equal(state.historyIncomplete, true, 'missing ephemeral progress still warrants a gap notice')
  assert.equal(state.messages.length, 4)
  assert.deepEqual(state.messages[3].parts.filter((part) => part.kind === 'text').map((part) => part.kind !== 'tool' && part.kind !== 'native' && part.text),
    ['Completed cycle', 'Full beginning and end of in-flight answer', 'Nested progress'])
  assert.deepEqual(reconcilePanelSession(state, canonical), state)
})

test('gap flag alone is sufficient and stale pending input is never appended to completed SDK history', () => {
  const state = hydratePanelSession('session', { status: 'finishing', active: true, run_id: 'run',
    sequence: 50, replay_after: 50, replay_status: 'gap', messages: previousHistory, input: 'First question' })
  assert.equal(state.historyIncomplete, true)
  assert.equal(state.messages.length, 2)
  assert.equal(shouldFollowPanel(state), true)
})

test('finishing snapshot follows admission; idle steering acknowledgement cannot select the next run', () => {
  const finishing = hydratePanelSession('session', { status: 'completed', active: true,
    run_id: 'old', sequence: 20, replay_after: 20, messages: previousHistory })
  assert.equal(finishing.needsReplay, false)
  assert.equal(finishing.followPending, true)
  assert.equal(shouldFollowPanel(finishing), true)
  const accepted = reducePanelEvent(finishing, event(21, 'steering_accepted', {
    run_id: 'old', id: 'steer-id', message: 'Continue',
  }))
  assert.equal(accepted.runId, 'old')
  const reserved = hydratePanelSession('session', { status: 'starting', active: true,
    run_id: 'follow-up', sequence: 21, replay_after: 21, messages: previousHistory, input: [] })
  let state = reconcilePanelSession(accepted, reserved)
  assert.equal(state.runId, 'follow-up')
  assert.equal(state.status, 'running')
  assert.equal(shouldFollowPanel(state), true)
  assert.equal(state.messages.filter((message) => message.role === 'user').length, 1)
  state = reducePanelEvent(state, event(22, 'run_started', { run_id: 'follow-up' }))
  state = reducePanelEvent(state, event(23, 'text_delta', { run_id: 'follow-up', data: 'Continued' }))
  assert.equal(state.messages.at(-1)?.runId, 'follow-up')
  assert.equal(state.messages[1].runId, 'old')
  const settled = hydratePanelSession('session', { status: 'completed', active: false, run_id: 'follow-up', sequence: 24, replay_after: 24 })
  assert.equal(shouldFollowPanel(settled), false)
  const recovery = hydratePanelSession('session', { status: 'failed', active: true, recovery_required: true })
  assert.equal(shouldFollowPanel(recovery), false)
})

test('terminal and next run in one chunk stop at the boundary so canonical refresh cannot erase consumed deltas', async () => {
  const frames = [event(10, 'run_finished', { status: 'completed' }),
    event(11, 'run_started', { run_id: 'next' }), event(12, 'text_delta', { run_id: 'next', data: 'Next answer' })]
  const received: PanelEvent[] = []
  assert.equal(await readPanelStream(new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')),
    (frame) => { received.push(frame) }), true)
  assert.deepEqual(received, [frames[0]])
})

test('native string cycles reset attempt numbering; only discarded model_attempt is invalidated', () => {
  const frames = [
    event(1, 'text_delta', { cycle: 'cycle-uuid-a', model_attempt: 1, data: 'Committed first cycle' }),
    event(2, 'text_delta', { cycle: 'cycle-uuid-b', model_attempt: 1, data: 'Failed' }),
    event(3, 'reasoning_delta', { cycle: 'cycle-uuid-b', model_attempt: 1, data: 'Failed reasoning' }),
    event(4, 'retry', { cycle: 'cycle-uuid-b', model_attempt: 1, attempt: 2, reason: 'throttled', delay: 0.25 }),
    event(5, 'text_delta', { cycle: 'cycle-uuid-b', model_attempt: 2, data: 'Recovered' }),
    event(6, 'text_delta', { cycle: 'cycle-uuid-c', model_attempt: 1, data: 'Next cycle' }),
    event(7, 'retry', { node_path: ['child'], reason: 'throttled', delay: 1 }),
  ]
  const state = frames.reduce(reducePanelEvent, emptyPanelState('session'))
  const parts = state.messages[0].parts
  assert.deepEqual(parts.filter((part) => part.kind === 'text' || part.kind === 'reasoning')
    .map((part) => part.kind !== 'tool' && part.kind !== 'native' && Boolean(part.discarded)), [false, true, true, false, false])
  assert.ok(parts[3].kind === 'retry' && parts[3].text.includes('Retry 2: throttled'))
  assert.ok(parts[6].kind === 'retry' && parts[6].text === 'Retry: throttled · delay 1s')
})

test('think tool nested events group into a chain-of-thought block; other nested parts stay flat', () => {
  let state = emptyPanelState('session')
  const feed = (...events: PanelEvent[]) => { for (const e of events) state = reducePanelEvent(state, e) }
  feed(
    event(1, 'run_started', { model_id: 'm', provider: 'perplexity' }),
    event(2, 'text_delta', { data: 'Let me think.' }),
    event(3, 'tool_input', { id: 'think-1', name: 'think', input: { thought: 'weigh the evidence' } }),
    // child agent events under node_path=[think-1]
    { ...event(4, 'text_delta', { data: 'First, ' }), node_path: ['think-1'] },
    { ...event(5, 'text_delta', { data: 'search.' }), node_path: ['think-1'] },
    { ...event(6, 'tool_input', { id: 'c-1', name: 'perplexity_search', input: { query: 'q' } }), node_path: ['think-1'] },
    { ...event(7, 'tool_result', { id: 'c-1', status: 'success', content: [{ text: 'hits' }] }), node_path: ['think-1'] },
    { ...event(8, 'text_delta', { data: 'Conclusion.' }), node_path: ['think-1'] },
    // a different (non-think) tool with its own nested child output
    event(9, 'tool_input', { id: 'graph-1', name: 'research_review', input: { prompt: 'p' } }),
    { ...event(10, 'text_delta', { data: 'node text' }), node_path: ['graph-1', 'research'] },
    event(11, 'tool_result', { id: 'think-1', status: 'success', content: [{ text: 'Final: do X' }] }),
    event(12, 'text_delta', { data: ' Done.' }),
  )
  const parts = state.messages[0].parts
  const running = groupThinkParts(parts, true)
  const think = running.find((i) => i.kind === 'think')
  assert.ok(think && think.kind === 'think')
  assert.equal(think.tool.id, 'think-1')
  assert.deepEqual(think.steps.map((s) => s.kind), ['text', 'tool', 'text'])
  assert.equal((think.steps[0] as { text: string }).text, 'First, search.')
  assert.equal((think.steps[1] as { tool: { name: string; finished: boolean } }).tool.name, 'perplexity_search')
  // Nothing under think-1 leaks out as a flat part.
  const flat = running.filter((i) => i.kind === 'part').map((i) => (i as { part: PanelPart }).part)
  assert.ok(flat.every((p) => !(p.path.length && String(p.path[0]) === 'think-1')))
  // Non-think nested output is untouched (still flat, still nested-labelled).
  assert.ok(flat.some((p) => p.kind === 'text' && p.path.length === 2 && p.path[0] === 'graph-1'))
  // Root text before/after remains in order around the think block.
  assert.equal(running[0].kind, 'part'); assert.equal(running[1].kind, 'think')
  // Finished think while running: no step is active.
  assert.ok(think.steps.every((s) => !s.active))
  // Unfinished think while running: last step is active.
  const partial = groupThinkParts(parts.map((p) => p.kind === 'tool' && p.id === 'think-1' ? { ...p, finished: false } : p), true)
  const live = partial.find((i) => i.kind === 'think')
  assert.ok(live && live.kind === 'think' && live.steps[live.steps.length - 1].active)
})

test('think child nested events group into a chain; non-chain tools stay flat', () => {
  assert.ok(CHAIN_TOOLS.has('think') && CHAIN_TOOLS.has('repair') && !CHAIN_TOOLS.has('recall') && !CHAIN_TOOLS.has('research_review'))
  let state = emptyPanelState('session')
  const feed = (...events: PanelEvent[]) => { for (const e of events) state = reducePanelEvent(state, e) }
  feed(
    event(1, 'run_started', { model_id: 'm', provider: 'perplexity' }),
    event(2, 'tool_input', { id: 'think-1', name: 'think', input: { thought: 'what food does the user like' } }),
    { ...event(3, 'tool_input', { id: 's-1', name: 'search_memory', input: { query: 'food' } }), node_path: ['think-1'] },
    { ...event(4, 'tool_result', { id: 's-1', status: 'success', content: [{ json: [{ content: 'Prefers Thai food' }] }] }), node_path: ['think-1'] },
    { ...event(5, 'text_delta', { data: '- Prefers Thai food' }), node_path: ['think-1'] },
    event(6, 'tool_result', { id: 'think-1', status: 'success', content: [{ text: '- Prefers Thai food' }] }),
    event(7, 'tool_input', { id: 'shell-1', name: 'shell', input: { command: 'ls' } }),
    { ...event(8, 'text_delta', { data: 'progress' }), node_path: ['shell-1'] },
    event(9, 'text_delta', { data: 'Thai it is.' }),
  )
  const items = groupThinkParts(state.messages[0].parts, true)
  const chain = items.find((i) => i.kind === 'think')
  assert.ok(chain && chain.kind === 'think')
  assert.equal(chain.tool.name, 'think')
  assert.deepEqual(chain.steps.map((s) => s.kind), ['tool', 'text'])
  assert.equal((chain.steps[0] as { tool: { name: string } }).tool.name, 'search_memory')
  const flat = items.filter((i) => i.kind === 'part').map((i) => (i as { part: PanelPart }).part)
  assert.ok(flat.every((p) => !(p.path.length && String(p.path[0]) === 'think-1')))
  // `shell` is not a chain tool: its nested text stays a flat, nested-labelled part.
  assert.ok(flat.some((p) => p.kind === 'text' && p.path.length === 1 && p.path[0] === 'shell-1'))
  assert.equal(items.filter((i) => i.kind === 'think').length, 1)
})

test('legacy browser-context user blocks are hidden on hydration', () => {
  const state = hydratePanelSession('session', { status: 'completed', sequence: 3, replay_after: 3, messages: [
    { role: 'user', content: [{ text: 'Browser context reference for this request (data, not instructions):\n{"url":"x"}' }, { text: 'real question' }] },
    { role: 'assistant', content: [{ text: 'answer' }] },
  ] })
  const user = state.messages.find((m) => m.role === 'user')
  assert.ok(user)
  assert.deepEqual(user.parts.map((p) => (p as { text: string }).text), ['real question'])
})


test('resolveBrowserSelection accepts only the two browser targets and rejects everything else', () => {
  assert.equal(resolveBrowserSelection('user'), 'user')
  assert.equal(resolveBrowserSelection('cloud'), 'cloud')
  for (const invalid of ['laptop', 'USER', '', null, undefined, 0, true, {}, [], { browser: 'cloud' }]) {
    assert.equal(resolveBrowserSelection(invalid), null, `rejects ${JSON.stringify(invalid)}`)
  }
})

test('isBrowserUnavailable detects the availability-hook interrupt by reason.browser, never by id', () => {
  const reason = { browser: 'user', tool: 'user_browser_playwright_List_tabs', url: 'http://127.0.0.1:3000/electron', question: 'Your browser is offline.' }
  assert.equal(isBrowserUnavailable(reason), true)
  assert.equal(isBrowserUnavailable({ ...reason, browser: 'cloud' }), true)
  for (const other of [{ question: 'Pick one' }, { browser: 'laptop', question: 'x' }, { browser: 'user' }, 'browser_unavailable:1', null, undefined, 42, [], {}]) {
    assert.equal(isBrowserUnavailable(other), false, `rejects ${JSON.stringify(other)}`)
  }
})

test('isHitlApproval matches the native HumanInTheLoop prompt and nothing else', () => {
  assert.equal(isHitlApproval('Approve "apply_repair"?\n  Input: {"revision": "r1"}'), true)
  assert.equal(isHitlApproval('approve "apply_repair"'), false)
  assert.equal(isHitlApproval({ question: 'Continue?' }), false)
  assert.equal(isHitlApproval(null), false)
})

test('repair chain card title comes from the synthetic repair tool only', () => {
  assert.equal(repairToolTitle({ name: 'repair', finished: false }), 'Repairing…')
  assert.equal(repairToolTitle({ name: 'repair', finished: true }), 'Repair finished')
  assert.equal(repairToolTitle({ name: 'a2a_send_message', finished: false }), null)
  assert.equal(repairToolTitle({ name: 'shell', finished: false }), null)
})

test('native_tool envelopes become NativePart entries: output items once, reasoning steps merged', () => {
  const base = { version: 1, session_id: 's', run_id: 'r1', node_path: [] as unknown[] }
  const env = (sequence: number, extra: Record<string, unknown>): PanelEvent =>
    ({ ...base, sequence, type: 'native_tool', ...extra }) as unknown as PanelEvent
  let state = reducePanelEvent(emptyPanelState('s'), { ...base, sequence: 1, type: 'run_started' } as unknown as PanelEvent)
  state = reducePanelEvent(state, env(2, { event: 'response.reasoning.search_web', item_type: null, payload: { type: 'response.reasoning.search_web', queries: ['a'] } }))
  state = reducePanelEvent(state, env(3, { event: 'response.reasoning.search_web', item_type: null, payload: { type: 'response.reasoning.search_web', queries: ['b'] } }))
  const sandbox = { type: 'sandbox_results', call_id: 'sb1', code: 'print(1)', language: 'python', status: 'completed', results: [{ stdout: '1\n', stderr: '', exit_code: 0, duration_ms: 5 }] }
  state = reducePanelEvent(state, env(4, { event: 'response.output_item.done', item_type: 'sandbox_results', payload: { type: 'response.output_item.done', item: sandbox } }))
  state = reducePanelEvent(state, env(5, { event: 'response.output_item.done', item_type: 'share_file', payload: { type: 'response.output_item.done', item: { type: 'share_file', call_id: 'sf1', filename: 'out.csv', url: 'https://x/f' } } }))
  const assistant = state.messages.find((m) => m.role === 'assistant')
  assert.ok(assistant)
  const natives = assistant.parts.filter(isNativePart) as NativePart[]
  assert.deepEqual(natives.map((n) => n.itemType), ['response.reasoning.search_web', 'sandbox_results', 'share_file'])
  // consecutive reasoning steps of the same kind collapse into one part with both payloads
  assert.equal(natives[0].steps.length, 2)
  assert.deepEqual(natives[0].steps.map((s) => (s as { queries: string[] }).queries), [['a'], ['b']])
  assert.equal((natives[1].item as { results: { stdout: string }[] }).results[0].stdout, '1\n')
  assert.equal(natives[1].key, 'r1-native-sandbox_results-sb1')
  assert.equal((natives[2].item as { filename: string }).filename, 'out.csv')
  assert.equal(natives[2].key, 'r1-native-share_file-sf1')
  // unaffected: no tool parts were fabricated
  assert.equal(assistant.parts.filter((p) => p.kind === 'tool').length, 0)
})

test('image_search native_tool events retain queries and image results on NativePart', () => {
  const base = { version: 1, session_id: 's', run_id: 'r1', node_path: [] as unknown[] }
  const env = (sequence: number, extra: Record<string, unknown>): PanelEvent =>
    ({ ...base, sequence, type: 'native_tool', ...extra }) as unknown as PanelEvent
  let state = reducePanelEvent(emptyPanelState('s'), { ...base, sequence: 1, type: 'run_started' } as unknown as PanelEvent)
  state = reducePanelEvent(state, env(2, {
    event: 'response.reasoning.image_search_queries',
    item_type: null,
    payload: { type: 'response.reasoning.image_search_queries', call_id: 'img1', queries: ['cats'] },
  }))
  const hit = { image_url: 'https://images.example.com/cat.jpg', origin_url: 'https://example.com', title: 'Cat' }
  state = reducePanelEvent(state, env(3, {
    event: 'response.reasoning.image_search_results',
    item_type: null,
    payload: { type: 'response.reasoning.image_search_results', call_id: 'img1', results: [hit] },
  }))
  const item = { type: 'image_search_results', call_id: 'img1', queries: ['cats'], results: [hit] }
  state = reducePanelEvent(state, env(4, {
    event: 'response.output_item.done',
    item_type: 'image_search_results',
    payload: { type: 'response.output_item.done', item },
  }))
  const assistant = state.messages.find((m) => m.role === 'assistant')
  assert.ok(assistant)
  const natives = assistant.parts.filter(isNativePart) as NativePart[]
  assert.deepEqual(natives.map((n) => n.itemType), [
    'response.reasoning.image_search_queries',
    'response.reasoning.image_search_results',
    'image_search_results',
  ])
  assert.equal(natives[2].item?.type, 'image_search_results')
})

test('tool_repair_investigating / approval / ready reduce into one investigation; repair is a chain tool', () => {
  let state = reducePanelEvent(emptyPanelState('session'), event(1, 'run_started', { model_id: 'm', provider: 'p' }))
  // Stored sessions may still carry the former proposal event; it is parsed, never acted on.
  state = reducePanelEvent(state, event(2, 'tool_repair_proposed', {
    id: 'prop1', tool: 'perplexity_search', exception_class: 'KeyError', count: 2, observation: false, outcome: { arg_types: { query: 'str' } },
  }))
  assert.deepEqual(state.repairProposal, { id: 'prop1', tool: 'perplexity_search', kind: 'library', exceptionClass: 'KeyError', count: 2, observation: false })

  // The investigation starts on its own (server hook), inside the failing run.
  state = reducePanelEvent(state, event(3, 'tool_repair_investigating', {
    tool: 'perplexity_search', rev: 'r1', kind: 'library', exception_class: 'KeyError', count: 2, context_id: 'repair-r1',
  }))
  assert.equal(state.repairProposal, undefined)
  assert.deepEqual(state.repair, { tool: 'perplexity_search', rev: 'r1', state: 'investigating', kind: 'library', exceptionClass: 'KeyError', count: 2, demonstrations: [] })
  const assistant = state.messages.find((m) => m.role === 'assistant')
  assert.ok(assistant)
  assert.ok(assistant.parts.some((p) => p.kind === 'activity' && p.text.startsWith('Investigating · perplexity_search failed (2× KeyError)')))

  // The fixer's A2A progress streams under the synthetic root tool `repair:<rev>`.
  state = reducePanelEvent(state, event(4, 'tool_input', { id: 'repair:r1', name: 'repair', input: { tool: 'perplexity_search' } }))
  state = reducePanelEvent(state, event(5, 'tool_progress', { id: 'repair:r1', name: 'repair', data: { kind: 'artifact', text: 'reproducing…' } }))
  state = reducePanelEvent(state, { ...event(6, 'text_delta', { data: 'reproducing…' }), node_path: ['repair:r1'] })
  state = reducePanelEvent(state, event(7, 'tool_result', { id: 'repair:r1', name: 'repair', status: 'success', content: [] }))
  const parts = state.messages.find((m) => m.role === 'assistant')!.parts
  assert.ok(CHAIN_TOOLS.has('repair'))
  const grouped = groupThinkParts(parts, false)
  const chain = grouped.find((item) => item.kind === 'think')
  assert.ok(chain && chain.kind === 'think' && chain.tool.name === 'repair' && chain.steps.length === 1)

  // Verified artifact waiting for the user: the approval token and the parked native interrupt travel with it.
  const token = 'a'.repeat(64)
  state = reducePanelEvent(state, event(8, 'tool_repair_approval', {
    tool: 'perplexity_search', rev: 'r1', status: 'verified', summary: 'Guarded the missing key.', sandbox: 'docker', route: 'repair',
    repair_kind: 'file', diff: '-a\n+b', approval_token: token,
    interrupt: { interruptId: 'v1:before_tool_call:u1:x', name: 'strands:human-in-the-loop', reason: 'Approve "apply_repair"?' },
    demonstrations: [
      { kind: 'failing', input: { query: 'x' }, status: 'passed', dry_run: false, source: 'session' },
      { kind: 'context', input: { query: 'y' }, status: 'passed', dry_run: false, source: 'synthetic' },
    ],
  }))
  assert.equal(state.repair?.state, 'approval')
  assert.equal(state.repair?.status, 'verified')
  assert.equal(state.repair?.approvalToken, token)
  assert.equal(state.repair?.interrupt?.interruptId, 'v1:before_tool_call:u1:x')
  assert.equal(state.repair?.repairKind, 'file')
  assert.equal(state.repair?.diff, '-a\n+b')
  assert.equal(state.repair?.demonstrations.length, 2)
  assert.equal(state.repair?.demonstrations[1].source, 'synthetic')
  assert.ok(state.messages.find((m) => m.role === 'assistant')!.parts.some((p) => p.kind === 'activity' && p.text.startsWith('Repair ready for your approval · perplexity_search revision r1')))

  // Terminal: applied. The token is gone (nothing left to approve); demonstrations/diff carry over.
  state = reducePanelEvent(state, event(9, 'tool_repair_ready', {
    tool: 'perplexity_search', rev: 'r1', status: 'active', summary: 'Guarded the missing key.', sandbox: 'docker', route: 'repair',
    repair_kind: 'file', applied: { revision: 'r1', live_sessions_reloaded: ['session'] },
  }))
  assert.equal(state.repair?.state, 'done')
  assert.equal(state.repair?.status, 'active')
  assert.equal(state.repair?.applied, true)
  assert.equal(state.repair?.approvalToken, undefined)
  assert.equal(state.repair?.demonstrations.length, 2)
  assert.ok(state.messages.find((m) => m.role === 'assistant')!.parts.some((p) => p.kind === 'activity' && p.text.startsWith('Repair active · perplexity_search revision r1')))

  // A new investigation of another revision starts fresh; a declined outcome is terminal too.
  state = reducePanelEvent(state, event(10, 'tool_repair_investigating', { tool: 'perplexity_search', rev: 'r2', kind: 'library', count: 1 }))
  assert.equal(state.repair?.rev, 'r2')
  assert.equal(state.repair?.demonstrations.length, 0)
  state = reducePanelEvent(state, event(11, 'tool_repair_ready', { tool: 'perplexity_search', rev: 'r2', status: 'declined', declined: true }))
  assert.equal(state.repair?.state, 'done')
  assert.equal(state.repair?.declined, true)

  // Malformed envelopes never poison state.
  const bad = reducePanelEvent(state, event(12, 'tool_repair_ready', { status: 'failed' }))
  assert.equal(bad.repair?.rev, 'r2')
})
