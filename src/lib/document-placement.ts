/**
 * Where Ron's draft goes when the user inserts it into a page: the user clicks in the page and the
 * draft lands at that block boundary, never over existing content.
 *
 * - caret in an empty line → the draft fills that empty line;
 * - caret at the very start of a block → the draft goes before that block;
 * - anywhere else (or a selection) → the draft goes after the block holding the end of the selection.
 *
 * A ProseMirror decoration marks the spot while the user chooses (official Plugin/Decoration API,
 * registered with Tiptap's `editor.registerPlugin`). Relative imports only, so node:test can run it.
 */
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface PlacementTarget {
  /** Document position the draft is inserted at. */
  at: number
  /** Range the draft replaces: only ever an empty line. */
  replace?: { from: number; to: number }
  relation: 'after' | 'before' | 'into'
  /** Short description of the neighbouring block, e.g. “Intro paragraph…”. */
  anchor: string
}

const NODE_NAMES: Record<string, string> = {
  workflowBlock: 'the workflow', table: 'the table', horizontalRule: 'the divider', image: 'the image',
  codeBlock: 'the code block', blockquote: 'the quote', bulletList: 'the list', orderedList: 'the list', taskList: 'the task list',
}

export function blockLabel(node: PMNode): string {
  const text = node.textContent.replace(/\s+/g, ' ').trim()
  if (text) return `“${text.length > 48 ? `${text.slice(0, 48).trimEnd()}…` : text}”`
  return NODE_NAMES[node.type.name] ?? 'the selected block'
}

/** The insertion point for a caret/selection ending at `to`. */
export function insertionTarget(doc: PMNode, to: number): PlacementTarget {
  const $pos = doc.resolve(Math.max(0, Math.min(to, doc.content.size)))
  if ($pos.depth === 0) {
    // Between top-level blocks (gap cursor or a selected block).
    if ($pos.nodeBefore) return { at: $pos.pos, relation: 'after', anchor: blockLabel($pos.nodeBefore) }
    if ($pos.nodeAfter) return { at: $pos.pos, relation: 'before', anchor: blockLabel($pos.nodeAfter) }
    return { at: $pos.pos, relation: 'into', anchor: '' }
  }
  const block = $pos.node(1)
  const start = $pos.before(1)
  const end = $pos.after(1)
  if (block.isTextblock && block.content.size === 0) return { at: start, replace: { from: start, to: end }, relation: 'into', anchor: '' }
  if (doc.textBetween(start, $pos.pos, '\n', ' ').length === 0) return { at: start, relation: 'before', anchor: blockLabel(block) }
  return { at: end, relation: 'after', anchor: blockLabel(block) }
}

export function describeTarget(target: PlacementTarget): string {
  if (target.relation === 'into') return 'In the empty line you picked'
  return `${target.relation === 'after' ? 'After' : 'Before'} ${target.anchor}`
}

export const PLACEMENT_KEY = new PluginKey('ron-placement')

/** Marks where the draft will go, following the selection as the user clicks around the page. */
export function placementPlugin(createMarker: () => HTMLElement): Plugin {
  const marker = createMarker()
  return new Plugin({
    key: PLACEMENT_KEY,
    props: {
      decorations(state: EditorState) {
        const target = insertionTarget(state.doc, state.selection.to)
        return DecorationSet.create(state.doc, [
          Decoration.widget(target.at, marker, { side: target.relation === 'after' ? -1 : 1, key: 'ron-placement-marker', ignoreSelection: true }),
        ])
      },
    },
  })
}
