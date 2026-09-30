import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_GEMINI_VOICE, DEFAULT_REASONING_EFFORT, GEMINI_VOICES, REASONING_EFFORTS,
  isGeminiVoice, isMicUnavailableError, isReasoningEffort, micConstraints, personaCaption, personaState,
} from './voice-settings.ts'

test('micConstraints threads only the chosen device into getUserMedia', () => {
  const unpinned = micConstraints()
  assert.equal(unpinned.video, false)
  assert.deepEqual(unpinned.audio, { echoCancellation: true, noiseSuppression: true })

  const pinned = micConstraints('abc')
  assert.equal(pinned.video, false)
  assert.deepEqual(pinned.audio, { echoCancellation: true, noiseSuppression: true, deviceId: { exact: 'abc' } })
})

test('isMicUnavailableError recognises a vanished device only', () => {
  assert.equal(isMicUnavailableError({ name: 'OverconstrainedError' }), true)
  assert.equal(isMicUnavailableError({ name: 'NotFoundError' }), true)
  assert.equal(isMicUnavailableError({ name: 'NotAllowedError' }), false)
  assert.equal(isMicUnavailableError(null), false)
  assert.equal(isMicUnavailableError('OverconstrainedError'), false)
})

test('personaState sleeps when disconnected and thinks while connecting', () => {
  assert.equal(personaState('idle', 'speaking'), 'asleep')
  assert.equal(personaState('connecting', 'idle'), 'thinking')
  assert.equal(personaState('ready', 'speaking'), 'speaking')
  assert.equal(personaState('ready', 'listening'), 'listening')
})

test('personaCaption describes the live session', () => {
  assert.equal(personaCaption('idle', 'idle', false, null), 'Not connected')
  assert.equal(personaCaption('connecting', 'idle', false, null), 'Connecting…')
  assert.equal(personaCaption('ready', 'listening', true, 'screen'), 'Listening · Sharing screen · Mic on')
  assert.equal(personaCaption('ready', 'speaking', false, 'camera'), 'Speaking · Sharing camera · Mic muted')
  assert.equal(personaCaption('ready', 'idle', false, null), 'Ready · Mic muted')
})

test('catalogues are complete and guarded', () => {
  const ids = GEMINI_VOICES.map((voice) => voice.id)
  assert.equal(ids.length, 8)
  assert.equal(new Set(ids).size, 8)
  assert.ok(ids.includes(DEFAULT_GEMINI_VOICE))
  assert.deepEqual(REASONING_EFFORTS.map((effort) => effort.id), ['low', 'medium', 'high'])
  assert.ok(REASONING_EFFORTS.some((effort) => effort.id === DEFAULT_REASONING_EFFORT))
  assert.equal(isGeminiVoice('Zephyr'), true)
  assert.equal(isGeminiVoice('Nope'), false)
  assert.equal(isReasoningEffort('medium'), true)
  assert.equal(isReasoningEffort('ultra'), false)
  assert.equal(isReasoningEffort(3), false)
})
