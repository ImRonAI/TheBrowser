import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describeTarget, insertionTarget } from './document-placement.ts'

// The real editor schema (StarterKit), so positions are the ones Tiptap uses.
const schema = getSchema([StarterKit])
const p = (text?: string) => schema.node('paragraph', null, text ? [schema.text(text)] : [])
const doc = schema.node('doc', null, [p('Intro paragraph'), p(), p('Closing words')])
// Positions: Intro paragraph = [0, 17), its text 1..16; empty paragraph = [17, 19); Closing = [19, 34).

test('a caret inside a block places the draft after that block, never inside the text', () => {
  const target = insertionTarget(doc, 6)
  assert.deepEqual([target.at, target.relation, target.replace], [17, 'after', undefined])
  assert.equal(describeTarget(target), 'After “Intro paragraph”')
})

test('a caret at the start of a block places the draft before it', () => {
  const target = insertionTarget(doc, 20)
  assert.deepEqual([target.at, target.relation], [19, 'before'])
  assert.equal(describeTarget(target), 'Before “Closing words”')
})

test('an empty line is filled, and that is the only thing ever replaced', () => {
  const target = insertionTarget(doc, 18)
  assert.deepEqual(target, { at: 17, replace: { from: 17, to: 19 }, relation: 'into', anchor: '' })
  assert.equal(describeTarget(target), 'In the empty line you picked')
})

test('a selection keeps the selected text: the draft goes after the block where it ends', () => {
  const target = insertionTarget(doc, 30)
  assert.deepEqual([target.at, target.relation], [34, 'after'])
})

test('long blocks are shortened in the description', () => {
  const long = schema.node('doc', null, [p('x'.repeat(80))])
  assert.match(describeTarget(insertionTarget(long, 5)), /^After “x{48}…”$/)
})
