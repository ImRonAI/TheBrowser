import { Node, createBlockMarkdownSpec, mergeAttributes } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { AlertTriangle, CheckCircle2, Info, Lightbulb, Trash2 } from 'lucide-react'
import { CALLOUT_VARIANTS, calloutVariant, type CalloutVariant } from '@/lib/editor-blocks'
import { cn } from '@/lib/utils'
import { placeBlock } from './commands'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    ronLayout: {
      /** Wrap the current block in a callout (info, warning, success or tip). */
      setCallout: (variant?: CalloutVariant) => ReturnType
      /** A card with an editable title and body, where the cursor's block is. */
      insertCard: () => ReturnType
      /** Side-by-side columns (2–4), each holding its own blocks. */
      insertColumns: (count: number) => ReturnType
    }
  }
}

/** Each variant is a tint with a solid icon tile: info is volt, warning signal yellow, tip ink. */
const CALLOUT_STYLE: Record<CalloutVariant, { label: string; icon: typeof Info; box: string; tile: string }> = {
  info: {
    label: 'Info', icon: Info,
    box: 'border-blurple-200 bg-blurple-50/70 dark:border-blurple-900 dark:bg-blurple-950/40',
    tile: 'bg-blurple-600 text-white dark:bg-blurple-400 dark:text-ink',
  },
  warning: {
    label: 'Warning', icon: AlertTriangle,
    box: 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/40',
    tile: 'bg-amber-400 text-ink',
  },
  success: {
    label: 'Success', icon: CheckCircle2,
    box: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/40',
    tile: 'bg-emerald-600 text-white dark:bg-emerald-400 dark:text-ink',
  },
  tip: {
    label: 'Tip', icon: Lightbulb,
    box: 'border-surface-200 bg-surface-50/70 dark:border-surface-800 dark:bg-surface-850/60',
    tile: 'bg-ink text-white dark:bg-ink-inverse dark:text-ink',
  },
}

/**
 * NOT NATIVE (Tiptap has no open-source callout): a block container (`content: block+`) with a variant.
 * Saved as `<div data-type="callout" data-variant="warning">…</div>`; Markdown is the core
 * `createBlockMarkdownSpec` directive (`:::callout {variant="warning"}` … `:::`), so Ron reads and writes it.
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'info',
        parseHTML: (element) => calloutVariant(element.getAttribute('data-variant')),
        renderHTML: (attributes) => ({ 'data-variant': calloutVariant(attributes.variant) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0]
  },

  ...createBlockMarkdownSpec({ nodeName: 'callout', allowedAttributes: ['variant'] }),

  addCommands() {
    return {
      setCallout: (variant = 'info') => ({ commands }) => commands.wrapIn(this.name, { variant: calloutVariant(variant) }),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  },
})

function CalloutView({ node, editor, updateAttributes }: NodeViewProps) {
  const variant = calloutVariant(node.attrs.variant)
  const style = CALLOUT_STYLE[variant]
  const next = CALLOUT_VARIANTS[(CALLOUT_VARIANTS.indexOf(variant) + 1) % CALLOUT_VARIANTS.length]
  const Icon = style.icon
  return <NodeViewWrapper data-type="callout" data-variant={variant}
    className={cn('ron-callout my-4 flex gap-3 rounded-xl border px-4 py-3', style.box)}>
    <button type="button" contentEditable={false} disabled={!editor.isEditable}
      title={editor.isEditable ? `${style.label} callout — click for ${CALLOUT_STYLE[next].label}` : style.label}
      aria-label={`${style.label} callout${editor.isEditable ? `, change to ${CALLOUT_STYLE[next].label}` : ''}`}
      onClick={() => updateAttributes({ variant: next })}
      className={cn('mt-[0.2em] flex size-6 shrink-0 items-center justify-center rounded-md transition-opacity duration-150 enabled:hover:opacity-90 disabled:cursor-default', style.tile)}>
      <Icon className="size-3.5" strokeWidth={2.25} />
    </button>
    <NodeViewContent className="ron-callout-content min-w-0 flex-1" />
  </NodeViewWrapper>
}

/** The first line of a card: its title (inline text, any marks). */
export const CardTitle = Node.create({
  name: 'cardTitle',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-card-title]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-card-title': '' }), 0]
  },

  renderMarkdown: (node, helpers) => {
    const text = helpers.renderChildren(node.content ?? []).trim()
    return text ? `**${text}**` : ''
  },
})

/**
 * NOT NATIVE: a card — an editable title plus any blocks — for filling in structured notes
 * (`<div data-type="card"><div data-card-title>…</div>…</div>`). Markdown: the bold title, then the body.
 */
export const Card = Node.create({
  name: 'card',
  group: 'block',
  content: 'cardTitle block+',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="card"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'card' }), 0]
  },

  renderMarkdown: (node, helpers) => helpers.renderChildren(node.content ?? [], '\n\n'),

  addCommands() {
    return {
      insertCard: () => placeBlock((schema) => schema.nodes.card.create(null, [
        schema.nodes.cardTitle.create(), schema.nodes.paragraph.create(),
      ])),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(CardView)
  },
})

function CardView({ editor, deleteNode, selected }: NodeViewProps) {
  return <NodeViewWrapper data-type="card"
    className={cn('ron-card group/card relative my-4 rounded-xl border bg-surface-0 px-5 py-4 transition-colors duration-150 dark:bg-surface-900',
      selected
        ? 'border-blurple-600 ring-1 ring-blurple-600 dark:border-blurple-400 dark:ring-blurple-400'
        : 'border-surface-200 hover:border-surface-300 dark:border-surface-800 dark:hover:border-surface-700')}>
    {editor.isEditable && <button type="button" contentEditable={false} aria-label="Remove card" title="Remove card" onClick={() => deleteNode()}
      className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-lg text-ink-secondary opacity-0 transition duration-150 hover:bg-surface-100 hover:text-red-600 focus:opacity-100 group-hover/card:opacity-100 dark:text-ink-inverse-secondary dark:hover:bg-surface-850 dark:hover:text-red-400">
      <Trash2 className="size-4" />
    </button>}
    <NodeViewContent className="ron-card-content" />
  </NodeViewWrapper>
}

/** One column of a `columns` block. `isolating`: Backspace at its start never merges into the next column. */
export const Column = Node.create({
  name: 'column',
  content: 'block+',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column' }), 0]
  },

  renderMarkdown: (node, helpers) => helpers.renderChildren(node.content ?? [], '\n\n'),
})

/**
 * NOT NATIVE (Tiptap's open-source extensions have no columns): 2–4 side-by-side columns
 * (`content: column{2,4}`), laid out as an equal-width CSS grid. Markdown reads the columns in order.
 */
export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,4}',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'columns' }), 0]
  },

  renderMarkdown: (node, helpers) => helpers.renderChildren(node.content ?? [], '\n\n'),

  addCommands() {
    return {
      insertColumns: (count) => placeBlock((schema) => {
        const columns = Math.min(4, Math.max(2, Math.round(count)))
        return schema.nodes.columns.create(null, Array.from({ length: columns }, () =>
          schema.nodes.column.create(null, schema.nodes.paragraph.create())))
      }),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ColumnsView)
  },
})

function ColumnsView({ node, editor, deleteNode, selected }: NodeViewProps) {
  // Joined by hand, not with cn(): tailwind-merge drops `outline` (the solid style) next to `outline-2`.
  return <NodeViewWrapper data-type="columns"
    className={`ron-columns group/columns relative my-4${selected ? ' rounded-xl outline outline-2 outline-offset-4 outline-blurple-600 dark:outline-blurple-400' : ''}`}>
    {editor.isEditable && <button type="button" contentEditable={false} aria-label={`Remove ${node.childCount} columns`} title="Remove columns" onClick={() => deleteNode()}
      className="absolute -right-2 -top-3 z-[1] flex size-7 items-center justify-center rounded-lg border border-border bg-popover text-ink-secondary opacity-0 shadow-float transition duration-150 hover:text-red-600 focus:opacity-100 group-hover/columns:opacity-100 dark:text-ink-inverse-secondary dark:hover:text-red-400">
      <Trash2 className="size-3.5" />
    </button>}
    <NodeViewContent className="ron-columns-grid" />
  </NodeViewWrapper>
}
