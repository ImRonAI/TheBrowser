import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, useEditorState, type NodeViewProps } from '@tiptap/react'
import { ListTree, Trash2 } from 'lucide-react'
import { tocRows, type HeadingEntry } from '@/lib/editor-blocks'
import { cn } from '@/lib/utils'
import { placeBlock } from './commands'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      /** A live outline of the page's headings. */
      insertTableOfContents: () => ReturnType
    }
  }
}

/**
 * NOT NATIVE: a live outline of the page's headings (`<div data-type="table-of-contents">`). The official
 * TableOfContents extension was not used because it writes an id onto every heading as soon as a page
 * loads, which would mark every page and issue description as edited. This block only reads the document.
 */
export const TableOfContentsBlock = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  draggable: true,

  parseHTML() {
    return [{ tag: 'div[data-type="table-of-contents"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'table-of-contents' }), 'Table of contents']
  },

  // The outline is derived from the headings, so Markdown readers skip it.
  renderMarkdown: () => '',

  addCommands() {
    return {
      insertTableOfContents: () => placeBlock((schema) => schema.nodes.tableOfContents.create()),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(TocView)
  },
})

const sameHeadings = (a: HeadingEntry[], b: HeadingEntry[] | null) =>
  !!b && a.length === b.length && a.every((entry, index) => entry.pos === b[index].pos && entry.level === b[index].level && entry.text === b[index].text)

function TocView({ editor, selected, deleteNode }: NodeViewProps) {
  const headings = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const found: HeadingEntry[] = []
      current.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') found.push({ level: Number(node.attrs.level) || 1, text: node.textContent, pos })
        return true
      })
      return found
    },
    equalityFn: sameHeadings,
  }) ?? []
  const rows = tocRows(headings)
  const go = (pos: number) => {
    const target = editor.view.nodeDOM(pos)
    if (editor.isEditable) editor.chain().setTextSelection(pos + 1).focus(undefined, { scrollIntoView: false }).run()
    if (target instanceof HTMLElement) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return <NodeViewWrapper data-type="table-of-contents" contentEditable={false}
    className={cn('ron-toc not-prose group/toc relative my-4 rounded-xl border border-surface-200 px-3 py-2.5 dark:border-surface-700', selected && 'ring-2 ring-accent/40')}>
    <div className="mb-1 flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted dark:text-ink-inverse-muted">
      <ListTree className="size-3.5" />Table of contents
      {editor.isEditable && <button type="button" aria-label="Remove table of contents" title="Remove table of contents" onClick={() => deleteNode()}
        className="ml-auto flex size-6 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-surface-100 hover:text-danger focus:opacity-100 group-hover/toc:opacity-100 dark:hover:bg-surface-800">
        <Trash2 className="size-3" /></button>}
    </div>
    {rows.length
      ? <ol className="space-y-0.5">{rows.map((row) => <li key={row.pos} style={{ paddingLeft: `${row.depth * 16}px` }}>
          <button type="button" onClick={() => go(row.pos)}
            className={cn('w-full truncate rounded px-1.5 py-0.5 text-left text-[13.5px] text-ink-secondary underline-offset-2 hover:bg-surface-100 hover:text-ink hover:underline dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse',
              row.level === 1 && 'font-medium')}>
            {row.text || <span className="italic text-ink-muted">Untitled heading</span>}
          </button>
        </li>)}</ol>
      : <p className="px-1.5 py-0.5 text-[13px] text-ink-muted dark:text-ink-inverse-muted">Add headings (/h1, /h2, /h3) and they are listed here.</p>}
  </NodeViewWrapper>
}
