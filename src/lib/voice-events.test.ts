import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EMPTY_LIVE_STATE, authFrame, boundContext, canHandOff, contextFrame, decodePcm16, deriveActivity, historyFromMessages, isScopeBlocker,
  liveHistory, liveQuery, pendingTools, reduceLiveEvent, withPlayback, type LiveState,
} from './voice-events.ts'

const base = { userId: 'u1', agentScope: 'panel', browser: 'user' as const, voice: 'Kore' as const, effort: 'low' as const, conversationId: 'agent-abc' }

test('liveQuery sends model, voice and conversation id; effort only for extended thinking', () => {
  const extended = liveQuery({ ...base, model: 'gemini-3.8-live-extended-thinking' })
  assert.equal(extended.get('model'), 'gemini-3.8-live-extended-thinking')
  assert.equal(extended.get('voice'), 'Kore')
  assert.equal(extended.get('effort'), 'low')
  assert.equal(extended.get('conversation_id'), 'agent-abc')
  assert.equal(extended.get('agent_scope'), 'panel')
  assert.equal(extended.get('browser'), 'user')
  const regular = liveQuery({ ...base, model: 'gemini-3.8-live' })
  assert.equal(regular.get('model'), 'gemini-3.8-live')
  assert.equal(regular.has('effort'), false)
  assert.equal(regular.has('token'), false)
  const guestIssue = liveQuery({ ...base, userId: `guest:${'a'.repeat(64)}`, agentScope: 'issue:42', model: 'gemini-3.8-live' })
  assert.equal(guestIssue.has('user_id'), false, 'issue identity is resolved only from the auth frame')
  assert.equal(guestIssue.toString().includes('a'.repeat(64)), false, 'guest capability never enters the URL')
})

test('authFrame exists only for issue scopes and mirrors the Projects identity', () => {
  assert.equal(authFrame('panel', { userId: 'u1', accessToken: 'tok' }), null)
  assert.deepEqual(authFrame('issue:42', { userId: 'u1', accessToken: 'tok' }), { type: 'auth', token: 'tok' })
  const hex = 'a'.repeat(64)
  assert.deepEqual(authFrame('issue:42', { userId: `guest:${hex}`, accessToken: null }), { type: 'auth', workspace: hex })
  assert.equal(authFrame('issue:42', { userId: 'u1', accessToken: null }), null)
  assert.equal(authFrame('issue:42', { userId: 'guest:short', accessToken: null }), null)
})

test('boundContext caps every field and keeps the latest history turns', () => {
  const context = boundContext({
    page_url: 'https://x', page_title: ' T ', selected_text: '', page_text: 'x'.repeat(20_000),
    history: Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' as const : 'user' as const, text: `turn ${i}` })),
    issue: { id: 'i1', title: 'Title', description: 'd'.repeat(5_000) },
  })
  assert.equal(context.page_title, 'T')
  assert.equal('selected_text' in context, false)
  assert.equal(context.page_text!.length, 12_001)
  assert.ok(context.page_text!.endsWith('…'))
  assert.equal(context.history!.length, 12)
  assert.equal(context.history![11].text, 'turn 19')
  assert.equal(context.issue!.description!.length, 4_001)
  assert.deepEqual(contextFrame({ page_url: 'u' }), { type: 'context', context: { page_url: 'u' } })
  assert.ok(JSON.stringify(contextFrame(context)).length < 48 * 1024)
})

test('historyFromMessages keeps only visible text parts (no tools, reasoning, attachments)', () => {
  const turns = historyFromMessages([
    { role: 'user', parts: [{ kind: 'text', text: 'hi' }, { kind: 'text', text: 'ron-article:{"id":1}' }] },
    { role: 'assistant', parts: [{ kind: 'reasoning', text: 'secret' }, { kind: 'tool', text: 'x' }, { kind: 'text', text: 'hello' }] },
    { role: 'assistant', parts: [{ kind: 'tool' }] },
  ])
  assert.deepEqual(turns, [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }])
})

const run = (events: unknown[], start: LiveState = EMPTY_LIVE_STATE) => events.reduce<{ state: LiveState; effects: string[] }>((acc, event) => {
  const next = reduceLiveEvent(acc.state, event)
  return { state: next.state, effects: [...acc.effects, ...next.effects] }
}, { state: start, effects: [] })

test('ready records the negotiated selection and flips to listening', () => {
  const { state } = run([{ type: 'ready', model: 'gemini-3.8-live', voice: 'Puck', effort: 'low', conversation_id: 'agent-1' }])
  assert.equal(state.status, 'ready')
  assert.equal(state.activity, 'listening')
  assert.equal(state.model, 'gemini-3.8-live')
  assert.equal(state.voice, 'Puck')
  assert.equal(state.conversationId, 'agent-1')
})

test('transcripts accumulate per content_id and role; blocks finalise', () => {
  const { state } = run([
    { type: 'ready' },
    { type: 'bidi_transcript_start', role: 'user', content_id: 'u' },
    { type: 'bidi_transcript_delta', role: 'user', content_id: 'u', delta: 'hel' },
    { type: 'bidi_transcript_delta', role: 'user', content_id: 'u', delta: 'lo' },
    { type: 'bidi_transcript_delta', role: 'assistant', content_id: 'a', delta: 'Hi' },
    { type: 'bidi_transcript_block', role: 'assistant', content_id: 'a', transcript: 'Hi there' },
    { type: 'bidi_transcript_stop', role: 'user', content_id: 'u' },
  ])
  assert.deepEqual(state.turns.map((t) => [t.role, t.kind, t.text, t.final]), [['user', 'transcript', 'hello', true], ['assistant', 'transcript', 'Hi there', true]])
})

test('barge-in (bidi_barge_in, not bidi_interruption) stops playback and returns to listening', () => {
  const ready = run([{ type: 'ready' }, { type: 'bidi_response_start' }]).state
  const speaking = withPlayback(ready, true)
  assert.equal(speaking.activity, 'speaking')
  const { state, effects } = reduceLiveEvent(speaking, { type: 'bidi_barge_in' })
  assert.deepEqual(effects, ['stop_playback'])
  assert.equal(state.processing, false)
  assert.equal(state.activity, 'listening')
  assert.deepEqual(reduceLiveEvent(speaking, { type: 'bidi_interruption' }).effects, [])
})

test('interaction_status distinguishes processing from playback; response_stop defers while in_progress', () => {
  let { state } = run([{ type: 'ready' }, { type: 'bidi_response_start' }])
  assert.equal(state.activity, 'thinking')
  state = reduceLiveEvent(state, { type: 'bidi_interaction_status', status: 'in_progress', turn_complete: true }).state
  state = reduceLiveEvent(state, { type: 'bidi_response_stop', response_id: 'r' }).state
  assert.equal(state.processing, true, 'extended thinking still working after output ended')
  assert.equal(deriveActivity(state), 'thinking')
  assert.equal(withPlayback(state, true).activity, 'speaking', 'playback wins while audio drains')
  state = reduceLiveEvent(state, { type: 'bidi_interaction_status', status: 'idle', turn_complete: true }).state
  assert.equal(state.processing, false)
  assert.equal(state.activity, 'listening')
  // Regular model: no interaction_status, response_stop alone finishes.
  const regular = run([{ type: 'ready' }, { type: 'bidi_response_start' }, { type: 'bidi_response_stop', response_id: 'r' }]).state
  assert.equal(regular.processing, false)
})

test('tool use blocks, cancellation and hand-off gating', () => {
  let { state } = run([{ type: 'ready' }, { type: 'bidi_tool_use_blocks', tool_uses: [{ toolUseId: 't1', name: 'shell', input: { command: 'ls' } }, { toolUseId: 't2', name: 'editor', input: {} }] }])
  assert.equal(pendingTools(state).length, 2)
  assert.equal(canHandOff(state).ok, false)
  assert.match(canHandOff(state).reason!, /2 tool calls/)
  state = reduceLiveEvent(state, { type: 'bidi_tool_cancel', tool_use_ids: ['t2'] }).state
  assert.equal(pendingTools(state).length, 2, 'provider cancellation does not stop a host tool')
  assert.equal(state.turns.find((t) => t.id === 't2')!.cancelled, true)
  state = reduceLiveEvent(state, { type: 'tool_result', tool_result: { toolUseId: 't2', status: 'success' } }).state
  assert.equal(pendingTools(state).length, 1)
  assert.equal(canHandOff(EMPTY_LIVE_STATE).ok, true)
  assert.equal(canHandOff({ ...EMPTY_LIVE_STATE, unknownResults: ['t2'] }).ok, false)
  const idle = reduceLiveEvent({ ...state, turns: [], processing: true }, { type: 'bidi_interaction_status', status: 'idle' }).state
  assert.equal(canHandOff(idle).ok, true)
  assert.equal(canHandOff({ ...idle, processing: true }).ok, false)
})

test('errors carry codes, connection stop closes, unknown frames are ignored', () => {
  const failed = reduceLiveEvent(EMPTY_LIVE_STATE, { type: 'error', message: 'nope', code: 'unsupported_scope' })
  assert.equal(failed.state.error, 'nope')
  assert.equal(isScopeBlocker(failed.state.errorCode), true)
  assert.equal(isScopeBlocker('timeout'), false)
  const stopped = reduceLiveEvent({ ...EMPTY_LIVE_STATE, status: 'ready' }, { type: 'bidi_connection_stop', reason: 'user_request' })
  assert.deepEqual(stopped.effects, ['stop_playback', 'close'])
  assert.equal(stopped.state.status, 'idle')
  assert.equal(reduceLiveEvent(EMPTY_LIVE_STATE, { type: 'bidi_grounding' }).state, EMPTY_LIVE_STATE)
  assert.equal(reduceLiveEvent(EMPTY_LIVE_STATE, 'garbage').state, EMPTY_LIVE_STATE)
  const restarted = reduceLiveEvent(EMPTY_LIVE_STATE, { type: 'bidi_connection_restart', reason: 'scheduled', turn_interrupted: true }).state
  assert.match(restarted.restartNotice!, /restarted/)
})

test('backend app frames: ready extras, warning, context_applied, native tool_result, stopped', () => {
  let { state } = run([{ type: 'ready', model: 'gemini-3.8-live-extended-thinking', effort: 'high', tools: ['shell', 'use_skill'], history_source: 'snapshot' }])
  assert.deepEqual(state.tools, ['shell', 'use_skill'])
  assert.equal(state.historySource, 'snapshot')
  state = reduceLiveEvent(state, { type: 'warning', code: 'browser_tools_unavailable', message: 'Browser MCP failed' }).state
  state = reduceLiveEvent(state, { type: 'warning', code: 'browser_tools_unavailable', message: 'Browser MCP failed' }).state
  assert.deepEqual(state.warnings, ['Browser MCP failed'])
  state = reduceLiveEvent(state, { type: 'context_applied', mode: 'queued' }).state
  assert.equal(state.contextMode, 'queued')
  state = reduceLiveEvent(state, { type: 'bidi_tool_use_blocks', tool_uses: [{ toolUseId: 'a', name: 'shell', input: {} }, { toolUseId: 'b', name: 'editor', input: {} }] }).state
  state = reduceLiveEvent(state, { type: 'tool_result', tool_result: { toolUseId: 'a', status: 'success', content: [] } }).state
  assert.equal(pendingTools(state).length, 1)
  assert.equal(state.turns.find((t) => t.id === 'a')!.final, true)
  const stopped = reduceLiveEvent(state, { type: 'stopped', pending_tools: ['b'] })
  assert.ok(stopped.effects.includes('stop_playback'))
  assert.deepEqual(stopped.state.unknownResults, ['b'])
  assert.equal(pendingTools(stopped.state).length, 0, 'stop finalises every tool card; unknown results are listed, not replayed')
})

test('liveHistory exports final speech/text only, for Chat context', () => {
  const { state } = run([
    { type: 'ready' },
    { type: 'bidi_transcript_block', role: 'user', content_id: 'u', transcript: 'what time' },
    { type: 'bidi_text_block', content_id: 'x', text: 'Noon.' },
    { type: 'bidi_tool_use_blocks', tool_uses: [{ toolUseId: 't', name: 'clock', input: {} }] },
    { type: 'bidi_transcript_delta', role: 'assistant', content_id: 'partial', delta: 'unfinished' },
  ])
  assert.deepEqual(liveHistory(state), [{ role: 'user', text: 'what time' }, { role: 'assistant', text: 'Noon.' }])
})

test('mic-off frame is the native RealtimeInput audio_stream_end, and context history can be sliced incrementally', () => {
  // Shape the component sends when the user mutes: BidiAgent.send({"realtime_input": {"audio_stream_end": true}}).
  const frame = { realtime_input: { audio_stream_end: true } }
  assert.deepEqual(Object.keys(frame.realtime_input), ['audio_stream_end'])
  const all = [{ role: 'user' as const, text: 'a' }, { role: 'assistant' as const, text: 'b' }, { role: 'user' as const, text: 'c' }]
  const first = contextFrame({ history: all.slice(0) })
  const second = contextFrame({ history: all.slice(3) })
  assert.equal(first.context.history!.length, 3)
  assert.equal('history' in second.context, false, 'nothing new → no replay')
})

test('decodePcm16 handles mono/stereo little-endian frames and rejects non-pcm', () => {
  // Two mono samples: 0x7FFF (~1.0) and 0x8000 (-1.0).
  const mono = decodePcm16({ audio: Buffer.from([0xff, 0x7f, 0x00, 0x80]).toString('base64'), sample_rate: 16000 })
  assert.equal(mono!.channels, 1)
  assert.equal(mono!.sampleRate, 16000)
  assert.equal(mono!.frames, 2)
  assert.ok(Math.abs(mono!.samples[0][0] - 32767 / 32768) < 1e-6)
  assert.equal(mono!.samples[0][1], -1)
  const stereo = decodePcm16({ audio: Buffer.from([0, 0, 0xff, 0x7f]).toString('base64'), channels: 2 })
  assert.equal(stereo!.channels, 2)
  assert.equal(stereo!.sampleRate, 24000)
  assert.equal(stereo!.samples[0][0], 0)
  assert.ok(stereo!.samples[1][0] > 0.99)
  assert.equal(decodePcm16({ audio: 'AAA=', format: 'opus' }), null)
  assert.equal(decodePcm16({ audio: '' }), null)
  assert.equal(decodePcm16({}), null)
})
