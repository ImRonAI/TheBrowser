import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { shortcutFor } from './shortcuts.ts'

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; repeat: boolean }> = {}) => ({
  key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods,
})

test('⌘J asks Ron and ⌘K searches on macOS', () => {
  assert.equal(shortcutFor(key('j', { metaKey: true }), true), 'ask-ron')
  assert.equal(shortcutFor(key('K', { metaKey: true }), true), 'search')
  assert.equal(shortcutFor(key('\\', { metaKey: true }), true), 'toggle-sidebar')
  assert.equal(shortcutFor(key('l', { metaKey: true }), true), 'focus-url')
})

test('Ctrl is the modifier elsewhere', () => {
  assert.equal(shortcutFor(key('j', { ctrlKey: true }), false), 'ask-ron')
  assert.equal(shortcutFor(key('j', { metaKey: true }), false), null)
  assert.equal(shortcutFor(key('j', { ctrlKey: true }), true), null)
})

test('Shift, Alt and auto-repeat never fire (⌘⇧K stays the dev reset)', () => {
  assert.equal(shortcutFor(key('K', { metaKey: true, shiftKey: true }), true), null)
  assert.equal(shortcutFor(key('j', { metaKey: true, altKey: true }), true), null)
  assert.equal(shortcutFor(key('j', { metaKey: true, repeat: true }), true), null)
  assert.equal(shortcutFor(key('x', { metaKey: true }), true), null)
})
