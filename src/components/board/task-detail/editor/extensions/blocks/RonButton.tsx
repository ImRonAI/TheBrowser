import { useState, type KeyboardEvent } from 'react'
import { RenIcon } from '@/components/brand'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Check, Pencil, Trash2 } from 'lucide-react'
import { useAgentUi } from '@/context/AgentUiContext'
import { BlockFrame, FieldError, IconButton } from './ui'
import { placeBlock } from './commands'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    ronButton: {
      /** A button that sends a saved prompt to Ron in the Agent Panel. */
      insertRonButton: (button: { label: string; prompt: string }) => ReturnType
    }
  }
}

export const RON_BUTTON_LIMITS = { label: 80, prompt: 4000 }

/**
 * NOT NATIVE (Notion's "Button" block, wired to Ron): pressing it sends its saved prompt to the Agent
 * Panel, the same path as "Ask Ron" elsewhere in the app. Saved as
 * `<div data-type="ron-button" data-label data-prompt>`; Markdown shows the label and the prompt.
 */
export const RonButton = Node.create({
  name: 'ronButton',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      label: { default: 'Ask Ren', parseHTML: (element) => element.getAttribute('data-label') || 'Ask Ren', renderHTML: (attributes) => ({ 'data-label': attributes.label }) },
      prompt: { default: '', parseHTML: (element) => element.getAttribute('data-prompt') ?? '', renderHTML: (attributes) => ({ 'data-prompt': attributes.prompt }) },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="ron-button"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'ron-button' }), `Button "${node.attrs.label}": ${node.attrs.prompt}`]
  },

  renderMarkdown: (node) => `Button "${node.attrs?.label ?? 'Ask Ren'}" (asks Ren: ${String(node.attrs?.prompt ?? '').replace(/\s+/g, ' ').trim()})`,

  addCommands() {
    return {
      insertRonButton: (button) => placeBlock((schema) => button.prompt.trim()
        ? schema.nodes.ronButton.create({ label: button.label.trim().slice(0, RON_BUTTON_LIMITS.label) || 'Ask Ren', prompt: button.prompt.trim().slice(0, RON_BUTTON_LIMITS.prompt) })
        : null),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(RonButtonView)
  },
})

/** The label + prompt form shared by the "/" step and the block's own edit mode. */
export function RonButtonForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial: { label: string; prompt: string }
  submitLabel: string
  onSubmit: (value: { label: string; prompt: string }) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState(initial.label)
  const [prompt, setPrompt] = useState(initial.prompt)
  const [error, setError] = useState('')
  const submit = () => {
    if (!prompt.trim()) { setError('Write what Ren should do when the button is pressed.'); return }
    onSubmit({ label: label.trim() || 'Ask Ren', prompt: prompt.trim() })
  }
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() } }
  const field = 'mt-1 block w-full rounded-md border border-surface-200 bg-surface-0 px-2 py-1.5 text-[13px] normal-case tracking-normal text-ink outline-none focus:border-accent dark:border-surface-700 dark:bg-surface-850 dark:text-ink-inverse'
  return <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); submit() }}>
    <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted dark:text-ink-inverse-muted">Button label
      <input autoFocus value={label} maxLength={RON_BUTTON_LIMITS.label} onChange={(event) => setLabel(event.target.value)} onKeyDown={escape}
        placeholder="e.g. Summarize this page" aria-label="Button label" className={field} />
    </label>
    <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted dark:text-ink-inverse-muted">Prompt Ren receives
      <textarea value={prompt} rows={3} maxLength={RON_BUTTON_LIMITS.prompt} aria-label="Prompt"
        onChange={(event) => { setPrompt(event.target.value); setError('') }}
        onKeyDown={(event) => { escape(event); if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit() } }}
        placeholder="e.g. Summarize the open issues in this project and list what is blocked." className={`${field} resize-y`} />
    </label>
    <FieldError>{error}</FieldError>
    <div className="flex items-center justify-between gap-2">
      <p className="text-[11px] text-ink-muted dark:text-ink-inverse-muted">Ctrl/⌘+Enter to save · Esc to cancel</p>
      <button type="submit" className="flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white hover:opacity-90"><Check className="size-3.5" />{submitLabel}</button>
    </div>
  </form>
}

function RonButtonView({ node, editor, selected, updateAttributes, deleteNode }: NodeViewProps) {
  const { sendToAgentPanel } = useAgentUi()
  const [editing, setEditing] = useState(false)
  const label = String(node.attrs.label || 'Ask Ren')
  const prompt = String(node.attrs.prompt || '')
  return <BlockFrame selected={selected} className="group/button border-dashed bg-transparent dark:bg-transparent">
    {editing
      ? <div className="p-3"><RonButtonForm initial={{ label, prompt }} submitLabel="Save"
          onSubmit={(value) => { updateAttributes(value); setEditing(false) }} onCancel={() => setEditing(false)} /></div>
      : <div className="flex items-center gap-2 px-3 py-2.5">
          <button type="button" disabled={!prompt} onClick={() => sendToAgentPanel(prompt)} title={prompt ? `Ask Ren: ${prompt}` : 'This button has no prompt'}
            className="inline-flex min-w-0 items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-40">
            <RenIcon className="size-3.5 shrink-0" /><span className="truncate">{label}</span>
          </button>
          <p className="min-w-0 flex-1 truncate text-[12px] text-ink-muted dark:text-ink-inverse-muted" title={prompt}>{prompt}</p>
          {editor.isEditable && <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/button:opacity-100">
            <IconButton label="Edit button" onClick={() => setEditing(true)}><Pencil className="size-3.5" /></IconButton>
            <IconButton label="Remove button" className="hover:text-danger" onClick={() => deleteNode()}><Trash2 className="size-3.5" /></IconButton>
          </div>}
        </div>}
  </BlockFrame>
}
