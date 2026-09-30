import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
} })
const { useVoiceSettingsStore } = await import('./voiceSettingsStore.ts')

beforeEach(() => {
  storage.clear()
  useVoiceSettingsStore.setState({ micDeviceId: undefined, voice: 'Kore', effort: 'high' })
})

test('defaults match the backend voice session', () => {
  const state = useVoiceSettingsStore.getState()
  assert.equal(state.micDeviceId, undefined)
  assert.equal(state.voice, 'Kore')
  assert.equal(state.effort, 'high')
})

test('selections persist under ron-voice-settings and survive rehydration', async () => {
  const { setMicDeviceId, setVoice, setEffort } = useVoiceSettingsStore.getState()
  setMicDeviceId('mic-42')
  setVoice('Zephyr')
  setEffort('low')
  const saved = storage.get('ron-voice-settings')!
  assert.ok(saved.includes('Zephyr'))
  useVoiceSettingsStore.setState({ micDeviceId: undefined, voice: 'Kore', effort: 'high' })
  storage.set('ron-voice-settings', saved)
  await useVoiceSettingsStore.persist.rehydrate()
  const state = useVoiceSettingsStore.getState()
  assert.equal(state.micDeviceId, 'mic-42')
  assert.equal(state.voice, 'Zephyr')
  assert.equal(state.effort, 'low')
})

test('corrupt persisted values fall back to defaults', async () => {
  storage.set('ron-voice-settings', JSON.stringify({
    state: { micDeviceId: 42, voice: 'Nope', effort: 'ultra' }, version: 1,
  }))
  await useVoiceSettingsStore.persist.rehydrate()
  const state = useVoiceSettingsStore.getState()
  assert.equal(state.micDeviceId, undefined)
  assert.equal(state.voice, 'Kore')
  assert.equal(state.effort, 'high')
  assert.equal(typeof state.setVoice, 'function')
})
