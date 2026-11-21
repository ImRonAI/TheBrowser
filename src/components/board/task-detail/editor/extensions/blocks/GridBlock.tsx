import { useMemo } from 'react'
import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Trash2 } from 'lucide-react'
import { GridView } from '@/components/grid/GridView'
import { gridDisplay, gridMarkdown, gridValue, type GridDisplaySheet, type GridValue } from '@/lib/grid'
import { BlockFrame, IconButton } from './ui'

function parsed(json: string | null): unknown {
  try {
    return json ? JSON.parse(json) : null
  } catch {
    return null
  }
}

/** What each sheet's table shows, as a block a spreadsheet calculated saves them. */
function tables(block: HTMLElement): GridDisplaySheet[] {
  return Array.from(block.querySelectorAll('table'), (table) => ({
    name: table.caption?.textContent ?? '',
    rows: Array.from(table.rows, (row) => Array.from(row.cells, (shown) => shown.textContent ?? '')),
  }))
}

/** What the block holds; one made without a grid holds an empty sheet. */
const held = (attrs: { readonly [name: string]: unknown }): GridValue =>
  gridValue(attrs["grid"], attrs["display"], attrs["workbook"])
    ?? { grid: { title: 'Spreadsheet', sheets: [{ name: 'Sheet1', rows: [] }] }, display: null, workbook: null }

/**
 * NOT NATIVE: a spreadsheet (`GridView`): sheets with formulas, number formats, sorting and filters, shown as a
 * table per sheet and opened over the whole screen to work in. Saved as `<grid-block data-grid="{…}">` holding the
 * grid agents read and write (`@/lib/grid`), with a table per sheet for print and for readers without the editor.
 * Once a spreadsheet has calculated it the block is `data-calculated` and its tables hold what each cell shows; once
 * it has been changed in the spreadsheet, `data-workbook` holds the workbook the spreadsheet keeps. Markdown is the
 * grid's ```grid fence.
 */
export const GridBlock = Node.create({
  name: 'grid',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      grid: { default: null, rendered: false },
      display: { default: null, rendered: false },
      workbook: { default: null, rendered: false },
    }
  },

  parseHTML() {
    return [{
      tag: 'grid-block',
      // A block whose grid can't be read is not a grid: its tables stay tables.
      getAttrs: (block) => gridValue(parsed(block.getAttribute('data-grid')),
        block.hasAttribute('data-calculated') ? tables(block) : null, parsed(block.getAttribute('data-workbook'))) ?? false,
    }]
  },

  renderHTML({ node }) {
    const { grid, display, workbook } = held(node.attrs)
    return ['grid-block', {
      'data-grid': JSON.stringify(grid),
      ...(display ? { 'data-calculated': '' } : {}),
      ...(workbook ? { 'data-workbook': JSON.stringify(workbook) } : {}),
    }, ...(display ?? gridDisplay(grid)).map((sheet) => ['table', ['caption', sheet.name],
      ['tbody', ...sheet.rows.map((row, r) => ['tr', ...row.map((shown) => [r === 0 ? 'th' : 'td', shown])])]])]
  },

  renderMarkdown: (node) => gridMarkdown(held(node.attrs ?? {}).grid),

  addNodeView() {
    return ReactNodeViewRenderer(GridBlockView)
  },
})

function GridBlockView({ node, editor, selected, getPos, deleteNode }: NodeViewProps) {
  const value = useMemo(() => held({ grid: node.attrs["grid"], display: node.attrs["display"], workbook: node.attrs["workbook"] }),
    [node.attrs["grid"], node.attrs["display"], node.attrs["workbook"]])
  const editable = editor.isEditable
  // What a spreadsheet calculated is not an edit to undo; what was changed in it is.
  const save = (next: GridValue, edited: boolean) => {
    const at = getPos()
    if (at === undefined) return
    const saved = editor.state.tr.setNodeMarkup(at, undefined, { ...next })
    editor.view.dispatch(edited ? saved : saved.setMeta('addToHistory', false))
  }

  return <BlockFrame selected={selected}>
    <GridView value={value} editable={editable} onChange={editable ? save : undefined}>
      {editable && <IconButton label="Remove spreadsheet" className="enabled:hover:text-red-600 dark:enabled:hover:text-red-400" onClick={() => deleteNode()}><Trash2 className="size-4" /></IconButton>}
    </GridView>
  </BlockFrame>
}
