/**
 * Where Ron's draft goes when the user inserts it: at the cursor, on a block boundary, never over
 * existing content.
 *
 * - cursor in an empty line → the draft fills that empty line;
 * - cursor at the very start of a block → the draft goes before that block;
 * - anywhere else (or a selection) → the draft goes after the block holding the end of the selection.
 *
 * Relative imports only, so node:test can run it.
 */
import type { Node as PMNode } from '@tiptap/pm/model'

export interface InsertionTarget {
  /** Document position the draft is inserted at. */
  at: number
  /** Range the draft replaces: only ever an empty line. */
  replace?: { from: number; to: number }
}

/** The insertion point for a cursor/selection ending at `to`. */
export function insertionTarget(doc: PMNode, to: number): InsertionTarget {
  const $pos = doc.resolve(Math.max(0, Math.min(to, doc.content.size)))
  if ($pos.depth === 0) return { at: $pos.pos } // between top-level blocks (gap cursor or a selected block)
  const block = $pos.node(1)
  const start = $pos.before(1)
  const end = $pos.after(1)
  if (block.isTextblock && block.content.size === 0) return { at: start, replace: { from: start, to: end } }
  if (doc.textBetween(start, $pos.pos, '\n', ' ').length === 0) return { at: start }
  return { at: end }
}
