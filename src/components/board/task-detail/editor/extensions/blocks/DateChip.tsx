import { useRef } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { CalendarDays } from 'lucide-react'
import { daysFrom, formatLongDate, parseIsoDate, relativeDayLabel, toIsoDate } from '@/lib/editor-blocks'
import { cn } from '@/lib/utils'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    dateChip: {
      /** An inline date (YYYY-MM-DD) at the cursor. */
      insertDate: (date: string) => ReturnType
    }
  }
}

const iso = (value: unknown) => {
  const date = parseIsoDate(value)
  return date ? toIsoDate(date) : null
}

/**
 * NOT NATIVE (Notion's "@date"): an inline date saved as `<time data-type="date" datetime="2026-11-07">`.
 * The chip shows "Today", "in 3 days", "2 days ago" with the full date beside it; clicking it opens
 * Chromium's own date picker. Markdown: `@Sat, Nov 7, 2026`.
 */
export const DateChip = Node.create({
  name: 'dateChip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      date: { default: null, parseHTML: (element) => iso(element.getAttribute('datetime')), renderHTML: (attributes) => (attributes.date ? { datetime: attributes.date } : {}) },
    }
  },

  parseHTML() {
    return [{ tag: 'time[data-type="date"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['time', mergeAttributes(HTMLAttributes, { 'data-type': 'date' }), node.attrs.date ? formatLongDate(node.attrs.date) : 'No date']
  },

  renderMarkdown: (node) => (node.attrs?.date ? `@${formatLongDate(node.attrs.date)}` : ''),

  addCommands() {
    return {
      insertDate: (date) => ({ chain }) => {
        const value = iso(date)
        return !!value && chain().insertContent([{ type: this.name, attrs: { date: value } }, { type: 'text', text: ' ' }]).run()
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(DateView, { as: 'span' })
  },
})

function DateView({ node, editor, selected, updateAttributes }: NodeViewProps) {
  const input = useRef<HTMLInputElement>(null)
  const date = iso(node.attrs.date)
  const days = date ? daysFrom(date) : null
  const editable = editor.isEditable
  const open = () => {
    const field = input.current
    if (!field) return
    try { field.showPicker() } catch { field.focus() }
  }
  return <NodeViewWrapper as="span" data-type="date" className="relative">
    <button type="button" contentEditable={false} disabled={!editable} onClick={open}
      title={date ? formatLongDate(date) : 'Pick a date'} aria-label={date ? `Date ${formatLongDate(date)}${editable ? ', change date' : ''}` : 'Pick a date'}
      className={cn('ron-date mx-px inline-flex items-baseline gap-1 rounded-md px-1 py-px align-baseline text-[0.92em] font-medium transition-colors disabled:cursor-text',
        days !== null && days < 0 ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300' : days === 0 ? 'bg-accent/10 text-accent dark:text-accent-light' : 'bg-surface-100 text-ink-secondary dark:bg-surface-800 dark:text-ink-inverse-secondary',
        editable && 'hover:bg-surface-200 dark:hover:bg-surface-700', selected && 'ring-2 ring-accent/40')}>
      <CalendarDays className="size-[0.85em] self-center" aria-hidden="true" />
      {date ? <>{relativeDayLabel(date)}<span className="font-normal opacity-70">{formatLongDate(date)}</span></> : 'No date'}
    </button>
    {editable && <input ref={input} type="date" tabIndex={-1} aria-hidden="true" value={date ?? ''}
      onChange={(event) => { const next = iso(event.target.value); if (next) updateAttributes({ date: next }) }}
      className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 bg-transparent opacity-0" />}
  </NodeViewWrapper>
}
