import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_API_BASE_URL, normalizeApiBaseUrl } from './api-origin.ts'

test('normalizeApiBaseUrl uses default and strips trailing slash', () => {
  assert.equal(normalizeApiBaseUrl(undefined), DEFAULT_API_BASE_URL)
  assert.equal(normalizeApiBaseUrl('http://localhost:8766/'), 'http://localhost:8766')
})

test('normalizeApiBaseUrl rejects non-origin URLs', () => {
  assert.throws(() => normalizeApiBaseUrl('http://localhost:8766/path'))
})
