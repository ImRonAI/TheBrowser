import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMusicRequest, describeConfig, formatSeconds, musicAddPlaylistSongs, musicControl, musicCreatePlaylist, musicHeaders, musicRemovePlaylistSong, musicSave } from './music-api.ts'

const hex = 'a'.repeat(64)

test('musicHeaders: bearer token for the signed-in user only; guests and mismatched sessions are refused', () => {
  assert.deepEqual(musicHeaders('u1', { user: { id: 'u1' }, access_token: 'jwt' }), { Authorization: 'Bearer jwt', 'Content-Type': 'application/json' })
  assert.throws(() => musicHeaders(`guest:${hex}`, null), /Sign in/)
  assert.throws(() => musicHeaders('default', null), /Sign in/)
  assert.throws(() => musicHeaders('u1', { user: { id: 'u2' }, access_token: 'jwt' }), /Sign in/)
})

test('createMusicRequest targets /music/* with the identity headers and surfaces FastAPI detail', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (url.endsWith('/music/save')) return new Response(JSON.stringify({ detail: 'Sign in to Ron to save music' }), { status: 401 })
    return new Response(JSON.stringify({ action: 'play', playback: 'playing' }), { status: 200 })
  }) as unknown as typeof fetch
  const request = createMusicRequest('http://localhost:8765/', async () => ({ user: { id: 'u1' }, access_token: 'jwt' }), 'u1', fetcher)
  const result = await musicControl(request, 'agent-1', 'play')
  assert.deepEqual(result, { action: 'play', playback: 'playing' })
  assert.equal(calls[0].url, 'http://localhost:8765/music/control')
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { agent_id: 'agent-1', action: 'play' })
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer jwt')
  await assert.rejects(musicSave(request, 'agent-1', 'x'), /Sign in to Ron to save music/)
})

test('formatSeconds and describeConfig produce deck readouts', () => {
  assert.equal(formatSeconds(0), '0:00'); assert.equal(formatSeconds(65.9), '1:05')
  assert.deepEqual(describeConfig({ bpm: 120, scale: 'D_MAJOR_B_MINOR', density: 0.4, mute_bass: true, music_generation_mode: 'QUALITY' }),
    ['120 bpm', 'd major / b minor', 'density 0.4', 'mute bass'])
  assert.deepEqual(describeConfig({ scale: 'SCALE_UNSPECIFIED', music_generation_mode: 'DIVERSITY' }), ['diversity'])
})


test('playlist helpers target /music/playlists with encoded ids', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const fetcher = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{}', { status: 200 }) }) as unknown as typeof fetch
  const request = createMusicRequest('http://localhost:8765', async () => ({ user: { id: 'u1' }, access_token: 'jwt' }), 'u1', fetcher)
  await musicCreatePlaylist(request, { title: 'Mix', kind: 'album', song_ids: ['s1'] })
  await musicAddPlaylistSongs(request, 'p/1', ['s2'])
  await musicRemovePlaylistSong(request, 'p1', 's 2')
  assert.equal(calls[0].url, 'http://localhost:8765/music/playlists'); assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { title: 'Mix', kind: 'album', song_ids: ['s1'] })
  assert.equal(calls[1].url, 'http://localhost:8765/music/playlists/p%2F1/songs')
  assert.equal(calls[2].url, 'http://localhost:8765/music/playlists/p1/songs/s%202'); assert.equal(calls[2].init.method, 'DELETE')
})
