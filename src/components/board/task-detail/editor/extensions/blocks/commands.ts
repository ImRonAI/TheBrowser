import type { CommandProps } from '@tiptap/core'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { Selection } from '@tiptap/pm/state'

/**
 * Put a new block where the cursor's block is, the way Notion's "/" does: an empty paragraph is
 * replaced, otherwise the block goes right after the current one (`replaceRangeWith` moves the
 * insertion point out of anything that cannot hold it). The cursor then moves into the first
 * editable spot inside the new block; after an atom block (an embed, a card, …) it moves to the
 * paragraph below, which is created when nothing editable follows.
 */
export function placeBlock(build: (schema: Schema) => PMNode | null) {
  return ({ tr, dispatch }: CommandProps): boolean => {
    const node = build(tr.doc.type.schema)
    if (!node) return false
    if (!dispatch) return true
    const { $from } = tr.selection
    let depth = $from.depth
    while (depth > 0 && !$from.node(depth).isTextblock) depth -= 1
    if (depth > 0 && $from.node(depth).content.size === 0) {
      tr.replaceRangeWith($from.before(depth), $from.after(depth), node)
    } else {
      const after = depth > 0 ? $from.after(depth) : tr.selection.to
      tr.replaceRangeWith(after, after, node)
    }
    let at = -1
    tr.doc.descendants((child, pos) => {
      if (at >= 0) return false
      if (child === node) { at = pos; return false }
      return true
    })
    if (at < 0) return true
    if (node.isAtom) {
      const end = at + node.nodeSize
      const $end = tr.doc.resolve(end)
      const paragraph = tr.doc.type.schema.nodes.paragraph
      if (!$end.nodeAfter?.isTextblock && paragraph && $end.parent.canReplaceWith($end.index(), $end.index(), paragraph)) {
        tr.insert(end, paragraph.create())
      }
      tr.setSelection(Selection.near(tr.doc.resolve(Math.min(end + 1, tr.doc.content.size)), 1))
    } else {
      tr.setSelection(Selection.near(tr.doc.resolve(at + 1), 1))
    }
    tr.scrollIntoView()
    return true
  }
}
