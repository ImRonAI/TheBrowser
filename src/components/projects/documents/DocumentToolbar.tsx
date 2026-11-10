import { useState, type ReactNode } from 'react'
import { RenIcon } from '@/components/brand'
import { useEditorState, type Editor } from '@tiptap/react'
import { Bold, ChevronDown, Code, CodeSquare, Heading1, Heading2, Heading3, Italic, Link2, List, ListChecks, ListOrdered, Minus, Pilcrow, Plus, Quote, Redo2, Strikethrough, Table, Underline, Undo2, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const STYLES = [
  { id: 'paragraph', label: 'Normal text', icon: Pilcrow },
  { id: 'h1', label: 'Heading 1', icon: Heading1, level: 1 },
  { id: 'h2', label: 'Heading 2', icon: Heading2, level: 2 },
  { id: 'h3', label: 'Heading 3', icon: Heading3, level: 3 },
] as const

const menu = 'z-[120] min-w-[220px] rounded-xl border-surface-200 bg-surface-0 p-1.5 shadow-medium dark:border-surface-700 dark:bg-surface-850 dark:shadow-dark-medium'
const menuItem = 'gap-2.5 rounded-lg px-2.5 py-2 text-ink focus:bg-surface-100 dark:text-ink-inverse dark:focus:bg-surface-800'

const editorIds = new WeakMap<Editor, number>()
let lastEditorId = 0
const editorId = (editor: Editor) => {
  let id = editorIds.get(editor)
  if (id === undefined) { id = ++lastEditorId; editorIds.set(editor, id) }
  return id
}

/**
 * The fixed toolbar above a project document, in the spirit of Confluence's editor bar.
 * Tiptap's `useEditorState` keeps the snapshot of the editor it first saw until that snapshot's editor
 * has a transaction, so a replaced editor (another page, a remount) would leave the toolbar reading a
 * destroyed one: each editor instance gets its own toolbar state.
 */
export function DocumentToolbar({ editor, onAskRon }: { editor: Editor; onAskRon?: () => void }) {
  if (editor.isDestroyed) return null
  return <EditorToolbar key={editorId(editor)} editor={editor} onAskRon={onAskRon} />
}

function EditorToolbar({ editor, onAskRon }: { editor: Editor; onAskRon?: () => void }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      style: current.isActive('heading', { level: 1 }) ? 'h1' : current.isActive('heading', { level: 2 }) ? 'h2'
        : current.isActive('heading', { level: 3 }) ? 'h3' : 'paragraph',
      bold: current.isActive('bold'), italic: current.isActive('italic'), underline: current.isActive('underline'),
      strike: current.isActive('strike'), code: current.isActive('code'), link: current.isActive('link'),
      bulletList: current.isActive('bulletList'), orderedList: current.isActive('orderedList'), taskList: current.isActive('taskList'),
      blockquote: current.isActive('blockquote'), codeBlock: current.isActive('codeBlock'),
      canUndo: current.can().undo(), canRedo: current.can().redo(),
      href: String(current.getAttributes('link').href ?? ''),
    }),
  })
  const style = STYLES.find((item) => item.id === state.style) ?? STYLES[0]
  const chain = () => editor.chain().focus()

  return (
    <div role="toolbar" aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 rounded-2xl border border-surface-200 bg-surface-0/95 px-1.5 py-1.5 shadow-subtle backdrop-blur dark:border-surface-700 dark:bg-surface-900/95 dark:shadow-dark-subtle">
      <Tool label="Undo" disabled={!state.canUndo} onClick={() => chain().undo().run()}><Undo2 /></Tool>
      <Tool label="Redo" disabled={!state.canRedo} onClick={() => chain().redo().run()}><Redo2 /></Tool>
      <Divider />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" aria-label="Text style" className="h-8 w-[118px] justify-between rounded-lg px-2 text-[13px] font-medium text-ink dark:text-ink-inverse">
            {style.label}<ChevronDown className="!size-3.5 text-ink-muted" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className={menu}>
          {STYLES.map((item) => (
            <DropdownMenuItem key={item.id} className={cn(menuItem, state.style === item.id && 'bg-surface-100 dark:bg-surface-800')}
              onSelect={() => ('level' in item ? chain().setHeading({ level: item.level }).run() : chain().setParagraph().run())}>
              <item.icon />{item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Divider />

      <Tool label="Bold (⌘B)" active={state.bold} onClick={() => chain().toggleBold().run()}><Bold /></Tool>
      <Tool label="Italic (⌘I)" active={state.italic} onClick={() => chain().toggleItalic().run()}><Italic /></Tool>
      <Tool label="Underline (⌘U)" active={state.underline} onClick={() => chain().toggleUnderline().run()}><Underline /></Tool>
      <Tool label="Strikethrough" active={state.strike} onClick={() => chain().toggleStrike().run()}><Strikethrough /></Tool>
      <Tool label="Inline code" active={state.code} onClick={() => chain().toggleCode().run()}><Code /></Tool>
      <LinkTool editor={editor} active={state.link} href={state.href} />
      <Divider />

      <Tool label="Bulleted list" active={state.bulletList} onClick={() => chain().toggleBulletList().run()}><List /></Tool>
      <Tool label="Numbered list" active={state.orderedList} onClick={() => chain().toggleOrderedList().run()}><ListOrdered /></Tool>
      <Tool label="Action items" active={state.taskList} onClick={() => chain().toggleTaskList().run()}><ListChecks /></Tool>
      <Tool label="Quote" active={state.blockquote} onClick={() => chain().toggleBlockquote().run()}><Quote /></Tool>
      <Divider />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 rounded-lg px-2 text-[13px] font-medium text-ink dark:text-ink-inverse">
            <Plus />Insert<ChevronDown className="!size-3.5 text-ink-muted" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className={menu}>
          <DropdownMenuLabel className="px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted">Insert</DropdownMenuLabel>
          <DropdownMenuItem className={menuItem} onSelect={() => chain().insertWorkflow().run()}>
            <Workflow className="text-accent dark:text-accent-light" />
            <span className="flex flex-col"><span>Show a workflow</span><span className="text-xs text-ink-muted dark:text-ink-inverse-muted">Connect steps into a visual flow</span></span>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-surface-200 dark:bg-surface-700" />
          <DropdownMenuItem className={menuItem} onSelect={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table />Table</DropdownMenuItem>
          <DropdownMenuItem className={menuItem} onSelect={() => chain().toggleCodeBlock().run()}><CodeSquare />Code block</DropdownMenuItem>
          <DropdownMenuItem className={menuItem} onSelect={() => chain().toggleTaskList().run()}><ListChecks />Action items</DropdownMenuItem>
          <DropdownMenuItem className={menuItem} onSelect={() => chain().toggleBlockquote().run()}><Quote />Quote</DropdownMenuItem>
          <DropdownMenuItem className={menuItem} onSelect={() => chain().setHorizontalRule().run()}><Minus />Divider</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {onAskRon && (
        <Button type="button" variant="ghost" size="sm" onClick={onAskRon} title="Ask Ren to write or draw a workflow"
          className="ml-auto h-8 gap-1.5 rounded-full px-3 text-[13px] font-medium text-accent hover:bg-accent/10 hover:text-accent dark:text-accent-light dark:hover:bg-accent-light/10">
          <RenIcon className="!size-4" />Ask Ren
        </Button>
      )}
    </div>
  )
}

function Tool({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" title={label} aria-label={label} aria-pressed={active} disabled={disabled}
      onMouseDown={(event) => event.preventDefault()} onClick={onClick}
      className={cn('rounded-lg text-ink-secondary dark:text-ink-inverse-secondary',
        active && 'bg-accent/10 text-accent hover:bg-accent/15 hover:text-accent dark:bg-accent-light/10 dark:text-accent-light')}>
      {children}
    </Button>
  )
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px bg-surface-200 dark:bg-surface-700" />
}

function LinkTool({ editor, active, href }: { editor: Editor; active: boolean; href: string }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const apply = () => {
    const url = value.trim()
    if (!url) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href: /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}` }).run()
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setValue(href) }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" title="Link" aria-label="Link" aria-pressed={active}
          className={cn('rounded-lg text-ink-secondary dark:text-ink-inverse-secondary', active && 'bg-accent/10 text-accent dark:bg-accent-light/10 dark:text-accent-light')}>
          <Link2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-[120] w-80 rounded-xl border-surface-200 bg-surface-0 p-3 dark:border-surface-700 dark:bg-surface-850">
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); apply() }}>
          <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted" htmlFor="document-link">Link</label>
          <input id="document-link" autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder="Paste or type a link"
            className="w-full rounded-lg border border-surface-200 bg-surface-0 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 dark:border-surface-700 dark:bg-surface-900 dark:text-ink-inverse" />
          <div className="flex justify-end gap-2">
            {active && <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={() => { setValue(''); editor.chain().focus().extendMarkRange('link').unsetLink().run(); setOpen(false) }}>Remove</Button>}
            <Button type="submit" size="sm" className="rounded-full">Apply</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
