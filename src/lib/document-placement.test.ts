import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { insertionTarget } from './document-placement.ts'

// The real editor schema (StarterKit), so positions are the ones Tiptap uses.
const schema = getSchema([StarterKit])
const p = (text?: string) => schema.node('paragraph', null, text ? [schema.text(text)] : [])
const doc = schema.node('doc', null, [p('Intro paragraph'), p(), p('Closing words')])
// Positions: Intro paragraph = [0, 17), its text 1..16; empty paragraph = [17, 19); Closing = [19, 34).

test('a cursor inside a block puts the draft after that block, never inside the text', () => {
  assert.deepEqual(insertionTarget(doc, 6), { at: 17 })
})

test('a cursor at the start of a block puts the draft before it', () => {
  assert.deepEqual(insertionTarget(doc, 20), { at: 19 })
})

test('an empty line is filled, and that is the only thing ever replaced', () => {
  assert.deepEqual(insertionTarget(doc, 18), { at: 17, replace: { from: 17, to: 19 } })
})

test('a selection keeps the selected text: the draft goes after the block where it ends', () => {
  assert.deepEqual(insertionTarget(doc, 30), { at: 34 })
})
