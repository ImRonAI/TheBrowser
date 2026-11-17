import { useState, type ReactNode } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart, Minus, PaintBucket, PanelLeft, PanelTop, Trash2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import { TABLE_HEADER_COLORS } from './extensions/blocks/RenTable'

/** The table around the selection, as the editor draws it (the column-resizing wrapper). */
function tableElement(editor: Editor): HTMLElement | null {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name !== 'table') continue
    const dom = editor.view.nodeDOM($from.before(depth))
    return dom instanceof HTMLElement ? dom : null
  }
  return null
}

/**
 * Table controls above a table while the cursor is in it: add and remove columns and rows, the header row and
 * header column, and the header colour (one gradient across the row and down the column). Columns resize by
 * dragging their edges.
 */
export function TableMenu({ editor }: { editor: Editor }) {
  const [colors, setColors] = useState(false)
  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      const table = editor.isActive('table')
      const color: unknown = table ? editor.getAttributes('table').headerColor : null
      return {
        headerRow: table && isHeaderRow(editor),
        headerColumn: table && isHeaderColumn(editor),
        color: typeof color === 'string' ? color : null,
      }
    },
  })
  const run = (command: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => command(editor.chain().focus()).run()

  return (
    <BubbleMenu editor={editor} pluginKey="tableMenu" updateDelay={0}
      shouldShow={({ editor }) => editor.isEditable && editor.isActive('table')}
      getReferencedVirtualElement={() => {
        const element = tableElement(editor)
        return element ? { getBoundingClientRect: () => element.getBoundingClientRect(), contextElement: element } : null
      }}
      options={{ placement: 'top-start', offset: 8, flip: true, shift: { padding: 8 }, onHide: () => setColors(false) }}
      className="z-[120] flex items-center rounded-xl border border-surface-200 bg-surface-0 p-1 shadow-medium dark:border-surface-700 dark:bg-surface-850 dark:shadow-dark-medium">
      {colors ? (
        <div role="radiogroup" aria-label="Header colour" className="flex items-center gap-1.5 pl-1">
          <Tool label="Done" active onClick={() => setColors(false)}><PaintBucket /></Tool>
          <span className="select-none pr-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted dark:text-ink-inverse-muted">Header colour</span>
          {TABLE_HEADER_COLORS.map((choice) => {
            const selected = (state.color ?? 'none') === choice.id
            return (
              <button key={choice.id} type="button" role="radio" aria-checked={selected} title={choice.label} aria-label={choice.label}
                data-header-color={choice.value ? choice.id : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => run((chain) => chain.setTableHeaderColor(choice.value ? choice.id : null))}
                className={cn('ren-table-swatch size-6 shrink-0 overflow-hidden rounded-md border outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-blurple-600',
                  selected ? 'border-transparent ring-2 ring-blurple-600 ring-offset-1 ring-offset-surface-0 dark:ring-blurple-400 dark:ring-offset-surface-850' : 'border-surface-200 dark:border-surface-700')}>
                {!choice.value && <span className="block h-full w-full bg-[linear-gradient(135deg,transparent_45%,#D44C47_45%,#D44C47_55%,transparent_55%)]" />}
              </button>
            )
          })}
          <span className="w-1" />
        </div>
      ) : (
        <div className="flex items-center gap-0.5">
          <Group label="Column">
            <Tool label="Add a column on the left" onClick={() => run((chain) => chain.addColumnBefore())}><BetweenVerticalStart /></Tool>
            <Tool label="Add a column on the right" onClick={() => run((chain) => chain.addColumnAfter())}><BetweenVerticalEnd /></Tool>
            <Tool label="Remove this column" onClick={() => run((chain) => chain.deleteColumn())}><Minus /></Tool>
          </Group>
          <Divider />
          <Group label="Row">
            <Tool label="Add a row above" onClick={() => run((chain) => chain.addRowBefore())}><BetweenHorizontalStart /></Tool>
            <Tool label="Add a row below" onClick={() => run((chain) => chain.addRowAfter())}><BetweenHorizontalEnd /></Tool>
            <Tool label="Remove this row" onClick={() => run((chain) => chain.deleteRow())}><Minus /></Tool>
          </Group>
          <Divider />
          <Tool label="Header row" active={state.headerRow} onClick={() => run((chain) => chain.toggleHeaderRow())}><PanelTop /></Tool>
          <Tool label="Header column" active={state.headerColumn} onClick={() => run((chain) => chain.toggleHeaderColumn())}><PanelLeft /></Tool>
          <Tool label="Header colour" onClick={() => setColors(true)}>
            <PaintBucket />
            {state.color && <span data-header-color={state.color} className="ren-table-swatch absolute bottom-1 left-1/2 h-[3px] w-3.5 -translate-x-1/2 rounded-full" />}
          </Tool>
          <Divider />
          <Tool label="Delete table" onClick={() => run((chain) => chain.deleteTable())}><Trash2 /></Tool>
        </div>
      )}
    </BubbleMenu>
  )
}

function isHeaderRow(editor: Editor): boolean {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name !== 'table') continue
    const first = node.firstChild
    if (!first) return false
    let all = true
    first.forEach((cell) => { if (cell.type.name !== 'tableHeader') all = false })
    return all
  }
  return false
}

function isHeaderColumn(editor: Editor): boolean {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name !== 'table') continue
    let all = node.childCount > 0
    node.forEach((row) => { if (row.firstChild?.type.name !== 'tableHeader') all = false })
    return all
  }
  return false
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5">
      <span className="select-none px-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted dark:text-ink-inverse-muted">{label}</span>
      {children}
    </div>
  )
}

const Divider = () => <span aria-hidden className="mx-1 h-5 w-px bg-surface-200 dark:bg-surface-700" />

function Tool({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()} onClick={onClick}
      className={cn('relative grid size-8 place-items-center rounded-lg text-ink-secondary transition-colors [&_svg]:size-4 hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse',
        active && 'bg-blurple-50 text-blurple-600 hover:bg-blurple-100 hover:text-blurple-700 dark:bg-blurple-400/15 dark:text-blurple-300 dark:hover:bg-blurple-400/20 dark:hover:text-blurple-200')}>
      {children}
    </button>
  )
}
