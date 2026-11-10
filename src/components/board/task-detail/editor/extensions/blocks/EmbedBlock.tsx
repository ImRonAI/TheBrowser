import { useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Check, ExternalLink, Figma, Film, Globe, HardDrive, MapPin, Pencil, Trash2, Video } from 'lucide-react'
import { EMBED_PROVIDERS, clampHeight, normalizeEmbed, safeEmbedSrc, type EmbedProvider, type EmbedTarget } from '@/lib/editor-blocks'
import { placeBlock } from './commands'
import { BlockFrame, BlockHeader, FieldError, IconButton, useResizableHeight } from './ui'
import { openExternalUrl } from './workspace'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embed: {
      /** An iframe embed of an https page (already normalized by `normalizeEmbed`). */
      insertEmbed: (embed: EmbedTarget) => ReturnType
    }
  }
}

/** Generic iframes get exactly these capabilities: no top navigation, no downloads, no modals. */
export const EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-forms allow-presentation'
export const EMBED_ALLOW = 'fullscreen; picture-in-picture; encrypted-media; autoplay'

const PROVIDERS = Object.keys(EMBED_PROVIDERS) as EmbedProvider[]
const provider = (value: unknown): EmbedProvider => (PROVIDERS.includes(value as EmbedProvider) ? value as EmbedProvider : 'web')
const ICONS: Record<EmbedProvider, typeof Globe> = { web: Globe, maps: MapPin, figma: Figma, loom: Video, vimeo: Film, drive: HardDrive }

/**
 * NOT NATIVE (Tiptap has no generic iframe node): any https page in a sandboxed iframe — Google Maps,
 * Figma, Loom, Vimeo and Google Drive links are first rewritten to their embed players. Saved as
 * `<div data-type="embed" data-src data-url data-provider data-title data-height>` with a plain link
 * (no iframe) for readers without the editor; `src` is re-validated as https whenever it is read.
 */
export const EmbedBlock = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: '', parseHTML: (element) => safeEmbedSrc(element.getAttribute('data-src')), renderHTML: (attributes) => ({ 'data-src': safeEmbedSrc(attributes.src) }) },
      url: { default: '', parseHTML: (element) => safeEmbedSrc(element.getAttribute('data-url')), renderHTML: (attributes) => ({ 'data-url': safeEmbedSrc(attributes.url) }) },
      provider: { default: 'web', parseHTML: (element) => provider(element.getAttribute('data-provider')), renderHTML: (attributes) => ({ 'data-provider': provider(attributes.provider) }) },
      title: { default: '', parseHTML: (element) => element.getAttribute('data-title') ?? '', renderHTML: (attributes) => ({ 'data-title': String(attributes.title ?? '') }) },
      height: { default: null, parseHTML: (element) => clampHeight(element.getAttribute('data-height'), EMBED_PROVIDERS[provider(element.getAttribute('data-provider'))].height),
        renderHTML: (attributes) => (attributes.height ? { 'data-height': String(attributes.height) } : {}) },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="embed"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const href = safeEmbedSrc(node.attrs.url) || safeEmbedSrc(node.attrs.src)
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'embed' }), ['a', { href, rel: 'noopener noreferrer' }, node.attrs.title || href]]
  },

  renderMarkdown: (node) => {
    const href = safeEmbedSrc(node.attrs?.url) || safeEmbedSrc(node.attrs?.src)
    const label = EMBED_PROVIDERS[provider(node.attrs?.provider)].label
    return href ? `[${label}: ${node.attrs?.title || href}](${href})` : ''
  },

  addCommands() {
    return {
      insertEmbed: (embed) => placeBlock((schema) => safeEmbedSrc(embed.src)
        ? schema.nodes.embed.create({ ...embed, height: EMBED_PROVIDERS[embed.provider].height })
        : null),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView)
  },
})

function EmbedView({ node, editor, selected, updateAttributes, deleteNode }: NodeViewProps) {
  const kind = provider(node.attrs.provider)
  const src = safeEmbedSrc(node.attrs.src)
  const url = safeEmbedSrc(node.attrs.url) || src
  const title = String(node.attrs.title || EMBED_PROVIDERS[kind].label)
  const editable = editor.isEditable
  const { height, handle } = useResizableHeight(node.attrs.height, EMBED_PROVIDERS[kind].height, (next) => updateAttributes({ height: next }))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(url)
  const [error, setError] = useState('')
  const Icon = ICONS[kind]
  let host = ''
  try { host = url ? new URL(url).hostname.replace(/^www\./, '') : '' } catch { host = '' }

  const save = () => {
    const result = normalizeEmbed(draft, kind)
    if (!result.ok) { setError(result.error); return }
    updateAttributes({ ...result.value })
    setEditing(false)
    setError('')
  }

  return <BlockFrame selected={selected} data-embed-provider={kind}>
    <BlockHeader icon={<Icon className="size-4" />} title={title} subtitle={host || EMBED_PROVIDERS[kind].label}>
      {editable && <IconButton label="Change link" className={editing ? 'bg-surface-100 text-ink dark:bg-surface-850 dark:text-ink-inverse' : undefined}
        onClick={() => { setDraft(url); setError(''); setEditing((open) => !open) }}><Pencil className="size-4" /></IconButton>}
      {url && <IconButton label="Open in new tab" onClick={() => openExternalUrl(url)}><ExternalLink className="size-4" /></IconButton>}
      {editable && <IconButton label="Remove embed" className="enabled:hover:text-red-600 dark:enabled:hover:text-red-400" onClick={() => deleteNode()}><Trash2 className="size-4" /></IconButton>}
    </BlockHeader>
    {editing && <form className="space-y-1.5 border-b border-surface-200 px-3 py-2.5 dark:border-surface-800"
      onSubmit={(event) => { event.preventDefault(); save() }}>
      <div className="flex items-center gap-2">
        <input autoFocus value={draft} onChange={(event) => { setDraft(event.target.value); setError('') }} aria-label="Embed link"
          placeholder={EMBED_PROVIDERS[kind].placeholder} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setEditing(false) } }}
          className="h-9 min-w-0 flex-1 rounded-lg border border-surface-200 bg-surface-0 px-3 text-[13px] text-ink outline-none transition-colors duration-150 placeholder:text-ink-muted focus:border-blurple-500 dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted" />
        <button type="submit" className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-blurple-600 px-3.5 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-blurple-700 active:bg-blurple-800 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300"><Check className="size-4" />Save</button>
      </div>
      <FieldError>{error}</FieldError>
    </form>}
    {src
      ? <iframe src={src} title={title} sandbox={EMBED_SANDBOX} allow={EMBED_ALLOW} allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy" className="block w-full border-0 bg-surface-0 dark:bg-surface-900" style={{ height }} />
      : <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">No valid https link here.{editable ? ' Use Change link to add one.' : ''}</p>}
    {editable && src && handle('Resize embed')}
  </BlockFrame>
}
