import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Clapperboard, ExternalLink, Music, Trash2 } from 'lucide-react'
import { nameFromUrl, safeEmbedSrc } from '@/lib/editor-blocks'
import { placeBlock } from './commands'
import { BlockFrame, BlockHeader, IconButton } from './ui'
import { openExternalUrl } from './workspace'

export type MediaKind = 'video' | 'audio'
const kindOf = (value: unknown): MediaKind => (value === 'audio' ? 'audio' : 'video')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    media: {
      /** A video or audio file played from an https URL with the browser's own player. */
      insertMedia: (media: { kind: MediaKind; src: string; title?: string }) => ReturnType
    }
  }
}

/**
 * NOT NATIVE (Tiptap has no audio/video file node): a video or audio file at an https URL, played by
 * Chromium's `<video>`/`<audio controls>`. Saved as `<div data-type="media" data-kind data-src data-title>`
 * with a plain link inside; Markdown is `[Video: title](url)`.
 */
export const MediaBlock = Node.create({
  name: 'media',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      kind: { default: 'video', parseHTML: (element) => kindOf(element.getAttribute('data-kind')), renderHTML: (attributes) => ({ 'data-kind': kindOf(attributes.kind) }) },
      src: { default: '', parseHTML: (element) => safeEmbedSrc(element.getAttribute('data-src')), renderHTML: (attributes) => ({ 'data-src': safeEmbedSrc(attributes.src) }) },
      title: { default: '', parseHTML: (element) => element.getAttribute('data-title') ?? '', renderHTML: (attributes) => ({ 'data-title': String(attributes.title ?? '') }) },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="media"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const src = safeEmbedSrc(node.attrs.src)
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'media' }), ['a', { href: src, rel: 'noopener noreferrer' }, node.attrs.title || src]]
  },

  renderMarkdown: (node) => {
    const src = safeEmbedSrc(node.attrs?.src)
    const label = kindOf(node.attrs?.kind) === 'audio' ? 'Audio' : 'Video'
    return src ? `[${label}: ${node.attrs?.title || nameFromUrl(src)}](${src})` : ''
  },

  addCommands() {
    return {
      insertMedia: (media) => placeBlock((schema) => safeEmbedSrc(media.src)
        ? schema.nodes.media.create({ kind: kindOf(media.kind), src: media.src, title: media.title || nameFromUrl(media.src) })
        : null),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(MediaView)
  },
})

function MediaView({ node, editor, selected, deleteNode }: NodeViewProps) {
  const kind = kindOf(node.attrs.kind)
  const src = safeEmbedSrc(node.attrs.src)
  const title = String(node.attrs.title || (src ? nameFromUrl(src) : kind === 'audio' ? 'Audio' : 'Video'))
  let host = ''
  try { host = src ? new URL(src).hostname.replace(/^www\./, '') : '' } catch { host = '' }
  const Icon = kind === 'audio' ? Music : Clapperboard
  return <BlockFrame selected={selected} data-media-kind={kind}>
    <BlockHeader icon={<Icon className="size-4" />} title={title} subtitle={`${kind === 'audio' ? 'Audio' : 'Video'}${host ? ` · ${host}` : ''}`}>
      {src && <IconButton label="Open in new tab" onClick={() => openExternalUrl(src)}><ExternalLink className="size-4" /></IconButton>}
      {editor.isEditable && <IconButton label={`Remove ${kind}`} className="enabled:hover:text-red-600 dark:enabled:hover:text-red-400" onClick={() => deleteNode()}><Trash2 className="size-4" /></IconButton>}
    </BlockHeader>
    {!src
      ? <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">This {kind} has no valid https link.</p>
      : kind === 'audio'
        ? <div className="px-3 py-3"><audio controls preload="metadata" src={src} className="w-full" aria-label={title} /></div>
        : <video controls preload="metadata" src={src} className="block max-h-[640px] w-full bg-surface-950" aria-label={title} />}
  </BlockFrame>
}
