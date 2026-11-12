/**
 * Documents (Confluence-style pages): `public.project_documents` through the Projects API.
 * A page belongs to one project (its Docs tab) or, with no project, to the person who wrote it
 * ("My documents" in the Documents library, `ron://documents`). A page body is the same Tiptap HTML
 * the issue description editor writes. Lists carry no body; one page is read on open. Saves are
 * version-checked: a stale version answers 409.
 * Pure (relative imports) so node:test can run it.
 */
import { allProjectPages, type ProjectsRequest } from './projects-api.ts'

type Row = Record<string, any>

export interface ProjectDocumentSummary {
  id: string
  /** The page's project, or null for a personal page (only its author sees it). */
  projectId: string | null
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
  id: row.id, projectId: row.project_id ?? null, parentId: row.parent_id ?? null, title: row.title,
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

/** A new page in `projectId`, or a personal page when `projectId` is null. A child page shares its parent's project. */
export const createDocument = async (request: ProjectsRequest,
  input: { projectId: string | null; parentId?: string | null; title: string; content: string }) =>
  mapDocument(await request<Row>('/documents', 'POST', {
    project_id: input.projectId, parent_id: input.parentId ?? null, title: documentTitle(input.title), content: input.content,
  }))

/**
 * Moves a page, with every page under it, into a project (`POST /projects/documents/{id}/move`): a personal
 * page is added to the project, a project page moves to another project. The page leaves its parent; its
 * issue links and conversations stay. Answers the moved page.
 */
export const moveDocument = async (request: ProjectsRequest, id: string, projectId: string) =>
  mapDocument(await request<Row>(`/documents/${encodeURIComponent(id)}/move`, 'POST', { project_id: projectId }))

/** The Documents library (`ron://documents`), optionally opened on one page. */
export const documentsLibraryUrl = (documentId?: string | null) =>
  documentId ? `ron://documents/${documentId}` : 'ron://documents'

/** Where a page opens: its project's Docs (`ron://project/<id>/docs/<page>`), or the library for a personal page. */
export const documentSource = (document: Pick<ProjectDocumentSummary, 'id' | 'projectId'>) =>
  document.projectId ? `ron://project/${document.projectId}/docs/${document.id}` : documentsLibraryUrl(document.id)

/** Reads a library URL: the page it opens (`documentId` null for the library itself), or null for any other URL. */
export function parseDocumentsLibraryUrl(url: string | null | undefined): { documentId: string | null } | null {
  const match = url?.match(/^ron:\/\/documents(?:\/([^/?#]+))?\/?$/)
  return match ? { documentId: match[1] ?? null } : null
}

/** The page list after `moveDocument`: the page and every page under it are in `projectId`, the page a root there. */
export function withMovedDocument(documents: ProjectDocumentSummary[], id: string, projectId: string): ProjectDocumentSummary[] {
  const moved = new Set(documentSubtree(documents, id))
  return documents.map((doc) => (moved.has(doc.id) ? { ...doc, projectId, parentId: doc.id === id ? null : doc.parentId } : doc))
}

/**
 * Library search: the pages whose title holds every word of `query` (any case), and `shown`, those pages plus
 * their ancestors, so each match keeps its place in its tree. A blank query matches nothing.
 */
export function searchDocuments(documents: ProjectDocumentSummary[], query: string): { matches: Set<string>; shown: ProjectDocumentSummary[] } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = new Set(words.length === 0 ? [] : documents
    .filter((doc) => words.every((word) => (doc.title || UNTITLED).toLowerCase().includes(word))).map((doc) => doc.id))
  const byId = new Map(documents.map((doc) => [doc.id, doc]))
  const shown = new Set<string>()
  for (const id of matches) {
    for (let current: string | null = id; current && byId.has(current) && !shown.has(current); current = byId.get(current)!.parentId) shown.add(current)
  }
  return { matches, shown: documents.filter((doc) => shown.has(doc.id)) }
}

/**
 * What "Create project with Ren" sends Ren in a new chat: read the page, create a project and its issues from it,
 * then add the page to that project, with the workspace tools that do each step.
 */
export function createProjectFromDocumentPrompt(document: { id: string; title: string }, currentProject?: { name: string; key: string } | null): string {
  const moves = currentProject ? ` It is in the ${currentProject.name} (${currentProject.key}) project now; adding it moves it, with the pages under it, into the new project.` : ''
  return [
    `Create a project from my page "${document.title.trim() || UNTITLED}" (document id ${document.id}).`,
    '1. Read the page with read_document.',
    '2. Create a project that fits it with create_project: a clear name, a short key and the project type that matches the work.',
    '3. Create its issues with create_issue, top-down, following the new project\'s issue types, so the work the page describes becomes the backlog.',
    `4. Add the page to the new project with add_document_to_project.${moves}`,
    'Then tell me the project key and what you created.',
  ].join('\n')
}

/** A failed Projects request as the page says it: a lost sign-in reads as one instead of a bare status. */
export function documentErrorMessage(error: unknown, fallback: string): string {
  if ((error as { status?: number } | null)?.status === 401) return 'You’re signed out. Sign in again to open and save documents.'
  const message = error instanceof Error ? error.message : ''
  if (message === 'Session changed; reload Projects.') return 'You signed in or out. Reload Documents to continue as this account.'
  return message || fallback
}

export const updateDocument = async (request: ProjectsRequest, id: string, version: number,
  patch: { title?: string; content?: string }) =>
  mapDocument(await request<Row>(`/documents/${id}`, 'PATCH', {
    version,
    ...(patch.title !== undefined ? { title: documentTitle(patch.title) } : {}),
    ...(patch.content !== undefined ? { content: patch.content } : {}),
  }))

export const deleteDocument = (request: ProjectsRequest, id: string) =>
  request<{ deleted: boolean }>(`/documents/${id}`, 'DELETE')

/** Every page the user can access, across projects plus their personal pages (newest first). */
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

/**
 * The agent skill a page was published as (`POST /projects/documents/{id}/skill`, `core/document_skills.py`):
 * stored with the agent's taught skills, so `GET /teaching/skills` lists it and `use_skill` runs it.
 */
export interface DocumentSkill {
  id: string
  name: string
  description: string
  agentId: string
  files: string[]
  createdAt: number
  updatedAt: number
  /** The page version the skill was published from. */
  publishedVersion: number | null
  /** Whether the page is unchanged since then. */
  current: boolean
  steps: number
  /** Registered in the agent's learned-skills memory (what `list_learned_skills` finds). */
  listed: boolean
}

export const mapDocumentSkill = (row: Row): DocumentSkill => ({
  id: row.id, name: row.name, description: row.description, agentId: row.agent_id, files: row.files ?? [],
  createdAt: Date.parse(row.created_at), updatedAt: Date.parse(row.updated_at),
  publishedVersion: row.published_version ?? null, current: row.current === true, steps: row.steps ?? 0, listed: row.listed === true,
})

const skillScope = (userId: string, agentId: string) => new URLSearchParams({ user_id: userId, agent_id: agentId }).toString()

/** The skill this page was published as for `userId`'s agent, or null. */
export const getDocumentSkill = async (request: ProjectsRequest, documentId: string, userId: string, agentId = 'panel') => {
  const body = await request<{ skill: Row | null }>(`/documents/${encodeURIComponent(documentId)}/skill?${skillScope(userId, agentId)}`)
  return body.skill ? mapDocumentSkill(body.skill) : null
}

/** Publish (or republish) the saved page as a skill. A 422 lists what the page must fix. */
export const publishDocumentSkill = async (request: ProjectsRequest, documentId: string, userId: string, agentId = 'panel') => {
  const body = await request<{ status: 'published' | 'updated'; skill: Row }>(`/documents/${encodeURIComponent(documentId)}/skill`, 'POST',
    { user_id: userId, agent_id: agentId })
  return { status: body.status, skill: mapDocumentSkill(body.skill) }
}

/** A publish failure split into the separate problems it names (references are listed with "; "). */
export function skillProblems(message: string): string[] {
  const prefix = 'Unknown or unusable references: '
  if (!message.startsWith(prefix)) return [message]
  return message.slice(prefix.length).replace(/\.$/, '').split('; ').map((part) => part.trim()).filter(Boolean)
}

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
