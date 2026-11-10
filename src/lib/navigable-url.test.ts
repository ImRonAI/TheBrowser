import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toNavigableUrl } from './navigable-url.ts'

test('a bare host gets https, and the result parses as a URL', () => {
  for (const [typed, expected] of [
    ['example.com', 'https://example.com'],
    ['github.com/anthropics', 'https://github.com/anthropics'],
    ['www.example.com/a?b=1#c', 'https://www.example.com/a?b=1#c'],
    ['example.com:8443/x', 'https://example.com:8443/x'],
    ['//cdn.example.com/a.js', 'https://cdn.example.com/a.js'],
  ]) {
    assert.equal(toNavigableUrl(typed), expected)
    assert.doesNotThrow(() => new URL(toNavigableUrl(typed)))
  }
})

test('localhost and IP literals get http, with or without a port or path', () => {
  assert.equal(toNavigableUrl('localhost'), 'http://localhost')
  assert.equal(toNavigableUrl('localhost:3000'), 'http://localhost:3000')
  assert.equal(toNavigableUrl('LOCALHOST:5173/app'), 'http://LOCALHOST:5173/app')
  assert.equal(toNavigableUrl('192.168.1.1:8080'), 'http://192.168.1.1:8080')
  assert.equal(toNavigableUrl('127.0.0.1/health?x=1'), 'http://127.0.0.1/health?x=1')
  assert.equal(toNavigableUrl('[::1]:8765'), 'http://[::1]:8765')
  assert.equal(new URL(toNavigableUrl('localhost:3000')).protocol, 'http:', 'not parsed as a "localhost:" scheme')
})

test('a hostname that merely starts like localhost or an IP is a normal host', () => {
  assert.equal(toNavigableUrl('localhost.example.com'), 'https://localhost.example.com')
  assert.equal(toNavigableUrl('1.2.3.4.example.com'), 'https://1.2.3.4.example.com')
})

test('addresses that already name a scheme are unchanged (trimmed)', () => {
  for (const address of ['https://example.com', 'HTTP://example.com', 'ron://home', 'ron://search?q=a%20b&level=medium',
    'file:///Users/me/a.html', 'about:blank', 'mailto:me@example.com', 'data:text/plain,hi']) {
    assert.equal(toNavigableUrl(address), address)
  }
  assert.equal(toNavigableUrl('  https://example.com  '), 'https://example.com')
  assert.equal(toNavigableUrl('   '), '')
})
