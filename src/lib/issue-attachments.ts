/**
 * Context → an issue's **Context** section. Each context item the user sends to an issue becomes one
 * entry in the issue's `context` column (supabase/migrations/020_issue_context.sql; rendered by
 * `IssueContext` in the issue's Context tab and read by the issue agent through `read_issue`): the
 * item's Markdown as `content`, its source, HTTPS images by URL, and any captured file (screenshot,
 * screen recording, uploaded image/video/file) as an object in the private Supabase Storage bucket
 * `issue-attachments` at `<project_id>/<issue_id>/<file>` (019: access follows the project).
 *
 * Pure (relative imports only) so node:test can run it.
 */
import type { ContextItem } from './context-api.ts'

export const ISSUE_ATTACHMENTS_BUCKET = 'issue-attachments'

export interface IssueFileRef { bucket: string; path: string; name: string; mediaType: string; size: number }

export interface IssueContextEntry {
  /** The context item's id: one entry per item per issue. */
  id: string
  kind: string
  title: string
  /** Markdown. */
  content: string
  /** The item's source as collected (https URL, ron:// page, chat session…). */
  source: string
  /** `source` when it is an https URL, else ''. */
  url: string
  images: { url: string }[]
  files: IssueFileRef[]
  /** When the item was collected. */
  added: string
  /** When it was sent to this issue. */
  attachedAt: string
}

const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'file'

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/webm': 'webm', 'video/mp4': 'mp4',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/markdown': 'md',
}

/** Object path for an item's file; the first segment must be the project id (storage RLS). */
export function attachmentPath(projectId: string, issueId: string, item: Pick<ContextItem, 'id' | 'file'>): string {
  const name = item.file?.name || item.id
  const hasExtension = /\.[A-Za-z0-9]{1,8}$/.test(name)
  const extension = item.file && !hasExtension && EXTENSIONS[item.file.media_type] ? `.${EXTENSIONS[item.file.media_type]}` : ''
  return `${projectId}/${issueId}/${item.id}-${safeName(name)}${extension}`
}

const httpsUrl = (value: unknown) => {
  if (typeof value !== 'string') return ''
  try { return new URL(value).protocol === 'https:' ? value : '' } catch { return '' }
}

/** Strip the item's own metadata heading block so the entry reads as content. */
export function markdownBody(markdown: string): string {
  const lines = markdown.split('\n')
  let index = lines[0]?.startsWith('# ') ? 1 : 0
  while (index < lines.length && (lines[index].trim() === '' || /^- (kind|title|added|source|file): /.test(lines[index]))) index++
  return lines.slice(index).join('\n').trim()
}

export function issueContextEntry(item: ContextItem, markdown: string, file?: IssueFileRef, attachedAt = new Date().toISOString()): IssueContextEntry {
  const body = markdownBody(markdown)
  const url = httpsUrl(item.source)
  const imageUrl = item.kind === 'image' && url && !item.file ? url : ''
  return {
    id: item.id,
    kind: item.kind,
    title: (item.title || item.source || item.id).slice(0, 500),
    content: (body || (file ? '' : item.source)).slice(0, 500_000),
    source: item.source,
    url,
    images: imageUrl ? [{ url: imageUrl }] : [],
    files: file ? [file] : [],
    added: item.added,
    attachedAt,
  }
}

/** Append entries; an item already on the issue is replaced in place (sending it again refreshes it). */
export function mergeIssueContext(existing: Record<string, unknown>[], entries: IssueContextEntry[]): Record<string, unknown>[] {
  const incoming = new Map(entries.map((entry) => [entry.id, entry]))
  const merged = existing.map((value) => {
    const id = typeof value.id === 'string' ? value.id : ''
    const replacement = incoming.get(id)
    if (!replacement) return value
    incoming.delete(id)
    return { ...replacement }
  })
  return [...merged, ...[...incoming.values()].map((entry) => ({ ...entry }))]
}

/** A project page's address in Ron: what a page's Context entry stores as `source`. */
export const pageSource = (projectId: string, documentId: string) => `ron://project/${projectId}/docs/${documentId}`

/** The project and page a `ron://project/<id>/docs/<page>` source points to, or null for any other source. */
export function pageFromSource(source: string): { projectId: string; documentId: string } | null {
  const match = /^ron:\/\/project\/([^/?#]+)\/docs\/([^/?#]+)\/?$/.exec(source)
  return match ? { projectId: match[1], documentId: match[2] } : null
}

/**
 * A related project page as a Context entry. `content` stays empty: the page is read as it is now (the
 * Context tab previews it live, and the issue agent's `read_issue` fills in its current Markdown).
 */
export function documentContextEntry(document: { id: string; projectId: string; title: string }, attachedAt = new Date().toISOString()): IssueContextEntry {
  return {
    id: `document:${document.id}`, kind: 'document', title: document.title.slice(0, 500), content: '',
    source: pageSource(document.projectId, document.id), url: '', images: [], files: [], added: attachedAt, attachedAt,
  }
}

const isPageEntry = (value: Record<string, unknown>, documentId: string) =>
  value.kind === 'document' && typeof value.source === 'string' && pageFromSource(value.source)?.documentId === documentId

/** Add a related page to the Context; a page already there (from this field or the Context widget) is left as it is. */
export function withDocumentContext(existing: Record<string, unknown>[], document: { id: string; projectId: string; title: string }, attachedAt?: string): Record<string, unknown>[] {
  return existing.some((value) => isPageEntry(value, document.id)) ? existing : [...existing, { ...documentContextEntry(document, attachedAt) }]
}

/** Remove every Context entry for a page that is no longer related. */
export function withoutDocumentContext(existing: Record<string, unknown>[], documentId: string): Record<string, unknown>[] {
  return existing.filter((value) => !isPageEntry(value, documentId))
}

export function kindLabel(kind: string): string {
  return ({
    search: 'Search', article: 'Article', link: 'Link', image: 'Image', video: 'Video', selection: 'Highlight',
    thread: 'Chat thread', document: 'Document', screenshot: 'Screenshot', recording: 'Screen recording', file: 'File', note: 'Note',
  } as Record<string, string>)[kind] ?? 'Context'
}

/** File references on an entry (validated: only the attachments bucket). */
export function entryFiles(entry: Record<string, unknown>): IssueFileRef[] {
  if (!Array.isArray(entry.files)) return []
  return entry.files.flatMap((value) => {
    const file = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    if (file.bucket !== ISSUE_ATTACHMENTS_BUCKET || typeof file.path !== 'string' || !file.path) return []
    return [{ bucket: ISSUE_ATTACHMENTS_BUCKET, path: file.path, name: typeof file.name === 'string' ? file.name : file.path,
      mediaType: typeof file.mediaType === 'string' ? file.mediaType : 'application/octet-stream',
      size: typeof file.size === 'number' ? file.size : 0 }]
  })
}

/** Read stored entries for display; anything malformed is dropped rather than rendered raw. */
export function issueContextEntries(values: Record<string, unknown>[]): IssueContextEntry[] {
  const text = (value: unknown) => typeof value === 'string' ? value : ''
  return values.flatMap((value) => {
    if (!value || typeof value !== 'object' || !text(value.id)) return []
    const images = Array.isArray(value.images) ? value.images.flatMap((image) => {
      const url = httpsUrl(image && typeof image === 'object' ? (image as Record<string, unknown>).url : image)
      return url ? [{ url }] : []
    }) : []
    return [{ id: text(value.id), kind: text(value.kind) || 'note', title: text(value.title) || text(value.id), content: text(value.content),
      source: text(value.source), url: httpsUrl(value.url), images, files: entryFiles(value), added: text(value.added), attachedAt: text(value.attachedAt) }]
  })
}
