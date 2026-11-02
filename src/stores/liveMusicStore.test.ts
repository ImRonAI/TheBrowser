import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPTY_MUSIC_STATE } from '../lib/voice-events.ts'
import { musicCaption, shouldShowMusicDeck, useLiveMusicStore } from './liveMusicStore.ts'

test('shouldShowMusicDeck: hidden until music is actually happening or a take awaits a decision', () => {
  const base = { liveStatus: 'ready' as const, playing: false, music: EMPTY_MUSIC_STATE }
  assert.equal(shouldShowMusicDeck({ ...base, liveStatus: 'idle' }), false)
  assert.equal(shouldShowMusicDeck(base), false, 'a Live session that could play music keeps the deck hidden')
  assert.equal(shouldShowMusicDeck({ ...base, music: { ...EMPTY_MUSIC_STATE, connected: true } }), true)
  assert.equal(shouldShowMusicDeck({ ...base, playing: true }), true)
  assert.equal(shouldShowMusicDeck({ ...base, music: { ...EMPTY_MUSIC_STATE, playback: 'paused' } }), true)
  assert.equal(shouldShowMusicDeck({ ...base, music: { ...EMPTY_MUSIC_STATE, take: { ...EMPTY_MUSIC_STATE.take, seconds: 12 } } }), true, 'a recorded take keeps the deck up after music_closed')
  assert.equal(shouldShowMusicDeck({ ...base, music: { ...EMPTY_MUSIC_STATE, error: 'quota' } }), true, 'errors are shown')
})

test('musicCaption reflects the session', () => {
  const base = { liveStatus: 'ready' as const, available: true, playing: true, music: { ...EMPTY_MUSIC_STATE, connected: true } }
  assert.equal(musicCaption(base), 'Live from Lyria RealTime')
  assert.equal(musicCaption({ ...base, playing: false }), 'Generating…')
  assert.equal(musicCaption({ ...base, music: { ...base.music, playback: 'paused' } }), 'Paused')
})

test('side panel: open flag is per Live session and the socket controls carry position + sendText', () => {
  const store = useLiveMusicStore
  store.getState().setOpen(true)
  assert.equal(store.getState().open, true)
  let sent = ''
  store.getState().attach({ setVolume: () => {}, position: () => null, sendText: (text) => { sent = text; return true } })
  store.getState().publish({ liveStatus: 'ready', agentId: 'live-abc', userId: 'u-1' })
  assert.equal(store.getState().agentId, 'live-abc')
  assert.equal(store.getState().controls?.sendText?.('hello'), true)
  assert.equal(sent, 'hello')
  store.getState().reset()
  assert.equal(store.getState().open, false, 'a new Live session starts with the deck closed')
  assert.equal(store.getState().agentId, undefined)
})
