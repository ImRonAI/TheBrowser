import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
} })
const { useVoiceSettingsStore } = await import('./voiceSettingsStore.ts')
const reset = () => useVoiceSettingsStore.setState({ micDeviceId: undefined, model: 'gemini-3.8-live', voice: 'Kore', effort: 'high' })

beforeEach(() => { storage.clear(); reset() })

test('defaults match the backend voice session', () => {
  const state = useVoiceSettingsStore.getState()
  assert.equal(state.micDeviceId, undefined)
  assert.equal(state.model, 'gemini-3.8-live')
  assert.equal(state.voice, 'Kore')
  assert.equal(state.effort, 'high')
})

test('selections persist under ron-voice-settings and survive rehydration', async () => {
  const { setMicDeviceId, setModel, setVoice, setEffort } = useVoiceSettingsStore.getState()
  setMicDeviceId('mic-42')
  setModel('gemini-3.8-live-extended-thinking')
  setVoice('Zephyr')
  setEffort('low')
  const saved = storage.get('ron-voice-settings')!
  assert.ok(saved.includes('Zephyr'))
  assert.ok(saved.includes('gemini-3.8-live-extended-thinking"'))
  reset()
  storage.set('ron-voice-settings', saved)
  await useVoiceSettingsStore.persist.rehydrate()
  const state = useVoiceSettingsStore.getState()
  assert.equal(state.micDeviceId, 'mic-42')
  assert.equal(state.model, 'gemini-3.8-live-extended-thinking')
  assert.equal(state.voice, 'Zephyr')
  assert.equal(state.effort, 'low')
})

test('corrupt persisted values fall back to defaults', async () => {
  storage.set('ron-voice-settings', JSON.stringify({
    state: { micDeviceId: 42, model: 'gemini-9', voice: 'Nope', effort: 'ultra' }, version: 2,
  }))
  await useVoiceSettingsStore.persist.rehydrate()
  const state = useVoiceSettingsStore.getState()
  assert.equal(state.micDeviceId, undefined)
  assert.equal(state.model, 'gemini-3.8-live')
  assert.equal(state.voice, 'Kore')
  assert.equal(state.effort, 'high')
  assert.equal(typeof state.setModel, 'function')
})

test('version 1 payloads keep voice and effort and gain the default model', async () => {
  storage.set('ron-voice-settings', JSON.stringify({ state: { micDeviceId: 'm', voice: 'Puck', effort: 'medium' }, version: 1 }))
  await useVoiceSettingsStore.persist.rehydrate()
  const state = useVoiceSettingsStore.getState()
  assert.equal(state.voice, 'Puck')
  assert.equal(state.effort, 'medium')
  assert.equal(state.model, 'gemini-3.8-live')
})
