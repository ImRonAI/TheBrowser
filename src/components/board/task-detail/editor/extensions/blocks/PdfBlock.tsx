import { useEffect, useMemo, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Download, ExternalLink, FileText, Trash2 } from 'lucide-react'
import { clampHeight, decodeBase64DataUrl, formatBytes, isPdfBytes, nameFromUrl, pdfSource } from '@/lib/editor-blocks'
import { placeBlock } from './commands'
import { BlockFrame, BlockHeader, IconButton, useResizableHeight } from './ui'
import { openExternalUrl } from './workspace'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pdf: {
      /** A PDF viewer for an https URL or an uploaded file (`data:application/pdf;base64,…`). */
      insertPdf: (pdf: { src: string; name: string; size?: number }) => ReturnType
    }
  }
}

const PDF_HEIGHT = 720

/**
 * NOT NATIVE: a PDF shown inline by Chromium's built-in PDF viewer. The source is an https URL or the
 * file uploaded into the page (stored as a base64 data URL, shown through a `blob:` URL of type
 * `application/pdf`, so the bytes can only ever render as a PDF). The viewer frame has no `sandbox`:
 * Chromium does not load its PDF viewer in sandboxed frames. Saved as
 * `<div data-type="pdf" data-src data-name data-size data-height>`; Markdown is a link (URL) or the file name.
 */
export const PdfBlock = Node.create({
  name: 'pdf',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: '', parseHTML: (element) => pdfSource(element.getAttribute('data-src'))?.src ?? '', renderHTML: (attributes) => ({ 'data-src': pdfSource(attributes.src)?.src ?? '' }) },
      name: { default: 'Document.pdf', parseHTML: (element) => element.getAttribute('data-name') || 'Document.pdf', renderHTML: (attributes) => ({ 'data-name': String(attributes.name || 'Document.pdf') }) },
      size: { default: null, parseHTML: (element) => Number(element.getAttribute('data-size')) || null, renderHTML: (attributes) => (attributes.size ? { 'data-size': String(attributes.size) } : {}) },
      height: { default: null, parseHTML: (element) => clampHeight(element.getAttribute('data-height'), PDF_HEIGHT), renderHTML: (attributes) => (attributes.height ? { 'data-height': String(attributes.height) } : {}) },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="pdf"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const source = pdfSource(node.attrs.src)
    const label = `PDF: ${node.attrs.name}`
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'pdf' }),
      source?.kind === 'url' ? ['a', { href: source.src, rel: 'noopener noreferrer' }, label] : ['span', {}, label]]
  },

  renderMarkdown: (node) => {
    const source = pdfSource(node.attrs?.src)
    const name = String(node.attrs?.name || 'Document.pdf')
    if (!source) return ''
    return source.kind === 'url' ? `[PDF: ${name}](${source.src})` : `PDF: ${name} (uploaded into this page${node.attrs?.size ? `, ${formatBytes(Number(node.attrs.size))}` : ''})`
  },

  addCommands() {
    return {
      insertPdf: (pdf) => placeBlock((schema) => pdfSource(pdf.src)
        ? schema.nodes.pdf.create({ src: pdf.src, name: pdf.name || nameFromUrl(pdf.src), size: pdf.size ?? null, height: PDF_HEIGHT })
        : null),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(PdfView)
  },
})

/** The uploaded file as a `blob:` URL of type application/pdf, revoked when the block goes away. */
function useUploadedPdf(src: string, upload: boolean): { url: string; error: string } {
  const decoded = useMemo(() => (upload ? decodeBase64DataUrl(src) : null), [src, upload])
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!decoded || !isPdfBytes(decoded.bytes)) { setUrl(''); return }
    const next = URL.createObjectURL(new Blob([decoded.bytes as BlobPart], { type: 'application/pdf' }))
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [decoded])
  return { url, error: upload && (!decoded || !isPdfBytes(decoded.bytes)) ? 'This file is not a readable PDF.' : '' }
}

function PdfView({ node, editor, selected, updateAttributes, deleteNode }: NodeViewProps) {
  const source = pdfSource(node.attrs.src)
  const name = String(node.attrs.name || 'Document.pdf')
  const upload = source?.kind === 'upload'
  const uploaded = useUploadedPdf(source?.src ?? '', upload)
  const viewer = upload ? uploaded.url : source?.src ?? ''
  const { height, handle } = useResizableHeight(node.attrs.height, PDF_HEIGHT, (next) => updateAttributes({ height: next }))
  const editable = editor.isEditable
  let host = ''
  if (source?.kind === 'url') { try { host = new URL(source.src).hostname.replace(/^www\./, '') } catch { host = '' } }
  const subtitle = upload ? `PDF${node.attrs.size ? ` · ${formatBytes(Number(node.attrs.size))}` : ''} · stored in this page` : `PDF · ${host}`

  return <BlockFrame selected={selected} data-pdf-kind={source?.kind ?? 'invalid'}>
    <BlockHeader icon={<FileText className="size-4" />} title={name} subtitle={subtitle}>
      {source?.kind === 'url' && <IconButton label="Open in new tab" onClick={() => openExternalUrl(source.src)}><ExternalLink className="size-4" /></IconButton>}
      {upload && uploaded.url && <a href={uploaded.url} download={name} title="Download" aria-label={`Download ${name}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary transition-colors duration-150 hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-850 dark:hover:text-ink-inverse">
        <Download className="size-4" /></a>}
      {editable && <IconButton label="Remove PDF" className="enabled:hover:text-red-600 dark:enabled:hover:text-red-400" onClick={() => deleteNode()}><Trash2 className="size-4" /></IconButton>}
    </BlockHeader>
    {viewer
      ? <iframe src={viewer} title={name} className="block w-full border-0 bg-surface-100 dark:bg-surface-900" style={{ height }} />
      : <p role="alert" className="px-3 py-6 text-center text-[13px] text-red-600 dark:text-red-400">{uploaded.error || 'This PDF has no valid source.'}</p>}
    {editable && viewer && handle('Resize PDF')}
  </BlockFrame>
}
