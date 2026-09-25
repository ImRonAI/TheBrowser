import assert from 'node:assert/strict'
import { test } from 'node:test'
import { projectEndpoint } from './project-endpoint.ts'

test('guest database routing stays pinned while account requests use the normal API', () => {
  const storage = { getItem: () => 'http://localhost:8766' }
  assert.equal(projectEndpoint('guest:' + 'a'.repeat(64), 'http://localhost:8765', storage), 'http://localhost:8766')
  assert.equal(projectEndpoint('account', 'http://localhost:8765', storage), 'http://localhost:8765')
  assert.equal(projectEndpoint('guest:x', 'http://localhost:8765', { getItem: () => null }), 'http://localhost:8765')
})

test('workspace capabilities cannot be redirected to external or credential-bearing endpoints', () => {
  for (const endpoint of ['https://evil.example', 'http://localhost.evil.example', 'http://user:password@localhost:8766', 'http://localhost:8766/path', 'http://localhost:8766/?token=x'])
    assert.throws(() => projectEndpoint('guest:x', 'http://localhost:8765', { getItem: () => endpoint }))
})