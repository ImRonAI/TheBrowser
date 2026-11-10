import { useEffect, useMemo, useRef, useState } from 'react'
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import katex from 'katex'
import { Check, Trash2 } from 'lucide-react'

/** Official KaTeX block equation (`$$…$$` in Markdown). Bad LaTeX renders as red source instead of throwing. */
export const RonBlockMath = BlockMath.configure({ katexOptions: { throwOnError: false, displayMode: true } })

/**
 * Official inline equation with a stricter Markdown tokenizer (Pandoc's rule: `$` + non-space … non-space
 * + `$`, not followed by a digit), so Ron's Markdown with prices ("$5 and $10") stays text. Only the
 * tokenizer is overridden, through Tiptap's own `extend`.
 */
export const RonInlineMath = InlineMath.extend({
  markdownTokenizer: {
    name: 'inlineMath',
    level: 'inline',
    start: (src: string) => src.indexOf('$'),
    tokenize: (src: string) => {
      const match = src.match(/^\$(?=\S)([^$\n]*?\S)\$(?!\d)/)
      return match ? { type: 'inlineMath', raw: match[0], latex: match[1].trim() } : undefined
    },
  },
}).configure({ katexOptions: { throwOnError: false } })

/** KaTeX HTML for a preview (KaTeX's default `trust: false` keeps \href/\url and raw HTML out). */
export function renderLatex(latex: string, displayMode: boolean): { html: string; error: string } {
  if (!latex.trim()) return { html: '', error: '' }
  try {
    return { html: katex.renderToString(latex, { displayMode, throwOnError: true }), error: '' }
  } catch (cause) {
    return { html: '', error: cause instanceof Error ? cause.message.replace(/^KaTeX parse error: /, '') : String(cause) }
  }
}

/** LaTeX source + live preview; used by the "/" step that inserts an equation and by the click-to-edit popover. */
export function MathField({ initial, displayMode, submitLabel, onSubmit, onCancel, onDelete }: {
  initial: string
  displayMode: boolean
  submitLabel: string
  onSubmit: (latex: string) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const [latex, setLatex] = useState(initial)
  const area = useRef<HTMLTextAreaElement>(null)
  const preview = useMemo(() => renderLatex(latex, displayMode), [latex, displayMode])
  useEffect(() => { area.current?.focus(); area.current?.select() }, [])
  return <form className="w-[min(26rem,calc(100vw-2rem))] space-y-2 p-2" onSubmit={(event) => { event.preventDefault(); if (latex.trim()) onSubmit(latex.trim()) }}>
    <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted dark:text-ink-inverse-muted">
      {displayMode ? 'Block equation' : 'Inline equation'} (LaTeX)
      <textarea ref={area} value={latex} rows={displayMode ? 3 : 2} spellCheck={false} aria-label="LaTeX"
        onChange={(event) => setLatex(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() }
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (latex.trim()) onSubmit(latex.trim()) }
        }}
        placeholder={displayMode ? 'e.g. \\int_0^1 x^2\\,dx = \\tfrac13' : 'e.g. E = mc^2'}
        className="mt-1 block w-full resize-y rounded-md border border-surface-200 bg-surface-0 px-2 py-1.5 font-mono text-[12.5px] normal-case tracking-normal text-ink outline-none focus:border-accent dark:border-surface-700 dark:bg-surface-850 dark:text-ink-inverse" />
    </label>
    <div aria-live="polite" className="min-h-[2.25rem] overflow-x-auto rounded-md bg-surface-50 px-2 py-1.5 text-ink dark:bg-surface-900 dark:text-ink-inverse">
      {preview.error ? <p className="text-[12px] text-rose-600 dark:text-rose-400">{preview.error}</p>
        : preview.html ? <div data-math-preview="" dangerouslySetInnerHTML={{ __html: preview.html }} />
          : <p className="text-[12px] text-ink-muted">The preview appears here.</p>}
    </div>
    <div className="flex items-center justify-between gap-2">
      <p className="text-[11px] text-ink-muted dark:text-ink-inverse-muted">Enter to {submitLabel.toLowerCase()} · Shift+Enter for a new line · Esc to cancel</p>
      <div className="flex items-center gap-1">
        {onDelete && <button type="button" onClick={onDelete} aria-label="Delete equation"
          className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-ink-muted hover:bg-surface-100 hover:text-danger dark:hover:bg-surface-800"><Trash2 className="size-3.5" />Delete</button>}
        <button type="submit" disabled={!latex.trim()}
          className="flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-40"><Check className="size-3.5" />{submitLabel}</button>
      </div>
    </div>
  </form>
}

let openEditor: (() => void) | null = null

/** A small popover over an equation (fixed to the viewport, follows scroll) to change or delete it. */
function editEquation(editor: Editor, pos: number) {
  openEditor?.()
  const node = editor.state.doc.nodeAt(pos)
  const dom = editor.view.nodeDOM(pos)
  if (!node || !(dom instanceof HTMLElement)) return
  const anchor: HTMLElement = dom
  const block = node.type.name === 'blockMath'
  const sameNode = () => editor.state.doc.nodeAt(pos)?.type === node.type
  const close = () => {
    window.removeEventListener('scroll', place, true)
    window.removeEventListener('resize', place)
    document.removeEventListener('pointerdown', outside, true)
    renderer.destroy()
    renderer.element.remove()
    if (openEditor === close) openEditor = null
  }
  const save = (latex: string) => {
    if (sameNode()) {
      editor.chain().focus().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex }); return true }).run()
    }
    close()
  }
  const remove = () => {
    if (sameNode()) editor.chain().focus().command(({ tr }) => { tr.delete(pos, pos + node.nodeSize); return true }).run()
    close()
  }
  const renderer = new ReactRenderer(MathField, {
    editor,
    props: { initial: String(node.attrs.latex ?? ''), displayMode: block, submitLabel: 'Save', onSubmit: save, onCancel: () => { close(); editor.commands.focus() }, onDelete: remove },
  })
  const element = renderer.element as HTMLElement
  element.className = 'ron-floating fixed z-[400] rounded-xl border border-surface-200 bg-surface-0 shadow-xl dark:border-surface-700 dark:bg-surface-850'
  element.setAttribute('role', 'dialog')
  element.setAttribute('aria-label', 'Edit equation')
  function place() {
    if (!anchor.isConnected) { close(); return }
    const rect = anchor.getBoundingClientRect()
    const height = element.offsetHeight || 220
    const width = element.offsetWidth || 416
    const below = rect.bottom + 6 + height <= window.innerHeight - 8
    element.style.top = `${Math.max(8, below ? rect.bottom + 6 : rect.top - 6 - height)}px`
    element.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)}px`
  }
  function outside(event: PointerEvent) {
    if (event.target instanceof globalThis.Node && (element.contains(event.target) || anchor.contains(event.target))) return
    close()
  }
  document.body.appendChild(element)
  requestAnimationFrame(place)
  window.addEventListener('scroll', place, true)
  window.addEventListener('resize', place)
  document.addEventListener('pointerdown', outside, true)
  openEditor = close
}

/**
 * Click an equation to edit it. NOT NATIVE: the official math nodes only offer an `onClick(node, pos)`
 * callback without the editor, so this uses ProseMirror's own `handleClickOn` prop to open the editor.
 */
export const MathEditing = Extension.create({
  name: 'mathEditing',

  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin({
      key: new PluginKey('mathEditing'),
      props: {
        handleClickOn: (_view, _pos, node, nodePos) => {
          if (!editor.isEditable || (node.type.name !== 'blockMath' && node.type.name !== 'inlineMath')) return false
          editEquation(editor, nodePos)
          return true
        },
      },
    })]
  },
})
