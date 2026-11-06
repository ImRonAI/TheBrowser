/**
 * Project documents (Confluence-style pages): `public.project_documents` through the Projects API.
 * A page body is the same Tiptap HTML the issue description editor writes. Lists carry no body;
 * one page is read on open. Saves are version-checked: a stale version answers 409.
 * Pure (relative imports) so node:test can run it.
 */
import { allProjectPages, type ProjectsRequest } from './projects-api.ts'

type Row = Record<string, any>

export interface ProjectDocumentSummary {
  id: string
  projectId: string
  parentId: string | null
  title: string
  version: number
  createdBy: string | null
  createdAt: number
  updatedAt: number
}
export interface ProjectDocument extends ProjectDocumentSummary { content: string }

export const DOCUMENT_TITLE_MAX = 300
export const UNTITLED = 'Untitled'

export const mapDocumentSummary = (row: Row): ProjectDocumentSummary => ({
  id: row.id, projectId: row.project_id, parentId: row.parent_id ?? null, title: row.title,
  version: row.version, createdBy: row.created_by ?? null,
  createdAt: Date.parse(row.created_at), updatedAt: Date.parse(row.updated_at),
})
export const mapDocument = (row: Row): ProjectDocument => ({ ...mapDocumentSummary(row), content: row.content ?? '' })

/** The title the database will accept: trimmed, never blank, at most 300 characters. */
export const documentTitle = (value: string) => value.trim().slice(0, DOCUMENT_TITLE_MAX) || UNTITLED

export const listDocuments = async (request: ProjectsRequest, projectId: string) =>
  (await allProjectPages<Row>(request, `/${projectId}/documents`)).map(mapDocumentSummary)

export const getDocument = async (request: ProjectsRequest, id: string) =>
  mapDocument(await request<Row>(`/documents/${id}`))

export const createDocument = async (request: ProjectsRequest,
  input: { projectId: string; parentId?: string | null; title: string; content: string }) =>
  mapDocument(await request<Row>('/documents', 'POST', {
    project_id: input.projectId, parent_id: input.parentId ?? null, title: documentTitle(input.title), content: input.content,
  }))

export const updateDocument = async (request: ProjectsRequest, id: string, version: number,
  patch: { title?: string; content?: string }) =>
  mapDocument(await request<Row>(`/documents/${id}`, 'PATCH', {
    version,
    ...(patch.title !== undefined ? { title: documentTitle(patch.title) } : {}),
    ...(patch.content !== undefined ? { content: patch.content } : {}),
  }))

export const deleteDocument = (request: ProjectsRequest, id: string) =>
  request<{ deleted: boolean }>(`/documents/${id}`, 'DELETE')

/** Every page the user can access, across projects (newest first): what a page can be picked from. */
export const listAllDocuments = async (request: ProjectsRequest) =>
  (await allProjectPages<Row>(request, '/documents')).map(mapDocumentSummary)

/** A page related to an issue (`public.document_issue_links`); either end may be in another project. */
export interface DocumentIssueLink { id: string; documentId: string; issueId: string; createdAt: number }

export const mapDocumentLink = (row: Row): DocumentIssueLink =>
  ({ id: row.id, documentId: row.document_id, issueId: row.issue_id, createdAt: Date.parse(row.created_at) })

/** The links of one page, or of one issue. */
export const listDocumentLinks = async (request: ProjectsRequest, of: { documentId: string } | { issueId: string }) =>
  (await allProjectPages<Row>(request, 'documentId' in of
    ? `/document-links?document_id=${encodeURIComponent(of.documentId)}`
    : `/document-links?issue_id=${encodeURIComponent(of.issueId)}`)).map(mapDocumentLink)

export const linkDocumentToIssue = async (request: ProjectsRequest, documentId: string, issueId: string) =>
  mapDocumentLink(await request<Row>('/document-links', 'POST', { document_id: documentId, issue_id: issueId }))

export const unlinkDocument = (request: ProjectsRequest, linkId: string) =>
  request<{ deleted: boolean }>(`/document-links/${linkId}`, 'DELETE')

/**
 * One saved Ask Ron conversation on a page (`document_conversations`): private to the user, deleted
 * with the page. Its messages are the native session `sessionId`; this is only the page's index.
 */
export interface DocumentConversation {
  id: string
  documentId: string
  sessionId: string
  title: string
  goal: boolean
  createdAt: number
  updatedAt: number
}

export const mapDocumentConversation = (row: Row): DocumentConversation => ({
  id: row.id, documentId: row.document_id, sessionId: row.session_id, title: row.title, goal: row.goal === true,
  createdAt: Date.parse(row.created_at), updatedAt: Date.parse(row.updated_at),
})

/** A conversation's title: the user's first request, trimmed to what the table accepts. */
export const conversationTitle = (request: string) => {
  const text = request.replace(/\s+/g, ' ').trim()
  return text.length > 200 ? `${text.slice(0, 199).trimEnd()}…` : text
}

export const createDocumentConversation = async (request: ProjectsRequest, documentId: string, title: string, goal: boolean) =>
  mapDocumentConversation(await request<Row>(`/documents/${encodeURIComponent(documentId)}/conversations`, 'POST',
    { title: conversationTitle(title), goal }))

/** Marks a conversation as used now (Try again continues it). */
export const touchDocumentConversation = async (request: ProjectsRequest, conversation: DocumentConversation) =>
  mapDocumentConversation(await request<Row>(`/document-conversations/${conversation.id}`, 'PATCH', { title: conversation.title }))

/** A 409 from a version-checked save: someone else saved first (or access was removed). */
export const isConflict = (error: unknown) => (error as { status?: number } | null)?.status === 409

export interface DocumentTreeRow { document: ProjectDocumentSummary; depth: number; childCount: number }

/** Depth-first page tree in creation order. Orphans (parent not visible) are shown at the root. */
export function documentTree(documents: ProjectDocumentSummary[]): DocumentTreeRow[] {
  const ids = new Set(documents.map((doc) => doc.id))
  const children = new Map<string | null, ProjectDocumentSummary[]>()
  for (const doc of [...documents].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
    const parent = doc.parentId && ids.has(doc.parentId) ? doc.parentId : null
    children.set(parent, [...(children.get(parent) ?? []), doc])
  }
  const rows: DocumentTreeRow[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null, depth: number) => {
    for (const doc of children.get(parent) ?? []) {
      if (seen.has(doc.id)) continue
      seen.add(doc.id)
      rows.push({ document: doc, depth, childCount: children.get(doc.id)?.length ?? 0 })
      walk(doc.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}

/** The page and every page under it: what a delete removes (the database cascades). */
export function documentSubtree(documents: ProjectDocumentSummary[], id: string): string[] {
  const result = [id]
  for (let index = 0; index < result.length; index += 1) {
    for (const doc of documents) if (doc.parentId === result[index] && !result.includes(doc.id)) result.push(doc.id)
  }
  return result
}

/** Ancestors from the root down to (not including) the page. */
export function documentAncestors(documents: ProjectDocumentSummary[], id: string): ProjectDocumentSummary[] {
  const byId = new Map(documents.map((doc) => [doc.id, doc]))
  const path: ProjectDocumentSummary[] = []
  const seen = new Set([id])
  let parent = byId.get(id)?.parentId ?? null
  while (parent && byId.has(parent) && !seen.has(parent)) {
    seen.add(parent)
    path.unshift(byId.get(parent)!)
    parent = byId.get(parent)!.parentId
  }
  return path
}
