import { useCallback, useEffect, useMemo, useState } from 'react'
import { projectsRequestFor, useProjectsStore } from '@/stores/projectsStore'
import type { Issue } from '@/types/projects'
import {
  createDocument, linkDocumentToIssue, listAllDocuments, listDocumentLinks, unlinkDocument,
  type DocumentIssueLink, type ProjectDocumentSummary,
} from '@/lib/project-documents'

const failure = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback)

export interface IssueDocuments {
  /** The issue's page links (`document_issue_links`), oldest first. */
  links: DocumentIssueLink[]
  /** Every page the user can access; a link from another project is named from here. */
  documents: ProjectDocumentSummary[]
  /** Pages of the issue's own project: what the Related documents field searches. */
  projectDocuments: ProjectDocumentSummary[]
  loading: boolean
  busy: boolean
  error: string | null
  documentFor: (link: DocumentIssueLink) => ProjectDocumentSummary | undefined
  link: (documentId: string) => Promise<DocumentIssueLink | null>
  unlink: (link: DocumentIssueLink) => Promise<boolean>
  /** Creates a page in the issue's project with this title and links it to the issue. */
  create: (title: string) => Promise<ProjectDocumentSummary | null>
}

/** One issue's related pages, shared by the Related documents field and the Description tab's list. */
export function useIssueDocuments(issue: Pick<Issue, 'id' | 'projectId'>): IssueDocuments {
  const { userId } = useProjectsStore()
  const request = useMemo(() => (userId ? projectsRequestFor(userId) : null), [userId])
  const [links, setLinks] = useState<DocumentIssueLink[]>([])
  const [documents, setDocuments] = useState<ProjectDocumentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!request) return
    let live = true
    setLoading(true); setError(null)
    Promise.all([listDocumentLinks(request, { issueId: issue.id }), listAllDocuments(request)])
      .then(([rows, pages]) => { if (live) { setLinks(rows); setDocuments(pages) } })
      .catch((cause) => { if (live) setError(failure(cause, 'Documents could not be loaded.')) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [request, issue.id])

  const link = useCallback(async (documentId: string) => {
    if (!request) return null
    setBusy(true)
    try {
      const created = await linkDocumentToIssue(request, documentId, issue.id)
      setLinks((current) => [...current.filter((item) => item.documentId !== documentId), created]); setError(null)
      return created
    } catch (cause) { setError(failure(cause, 'The document could not be linked.')); return null } finally { setBusy(false) }
  }, [request, issue.id])

  const unlink = useCallback(async (target: DocumentIssueLink) => {
    if (!request) return false
    setBusy(true)
    try {
      await unlinkDocument(request, target.id)
      setLinks((current) => current.filter((item) => item.id !== target.id)); setError(null)
      return true
    } catch (cause) { setError(failure(cause, 'The document could not be removed.')); return false } finally { setBusy(false) }
  }, [request])

  const create = useCallback(async (title: string) => {
    if (!request) return null
    setBusy(true)
    try {
      const page = await createDocument(request, { projectId: issue.projectId, title, content: '' })
      setDocuments((current) => [page, ...current])
      const created = await linkDocumentToIssue(request, page.id, issue.id)
      setLinks((current) => [...current, created]); setError(null)
      return page
    } catch (cause) { setError(failure(cause, 'The document could not be created.')); return null } finally { setBusy(false) }
  }, [request, issue.id, issue.projectId])

  const byId = useMemo(() => new Map(documents.map((doc) => [doc.id, doc])), [documents])
  const projectDocuments = useMemo(() => documents.filter((doc) => doc.projectId === issue.projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt), [documents, issue.projectId])
  const documentFor = useCallback((item: DocumentIssueLink) => byId.get(item.documentId), [byId])

  return { links, documents, projectDocuments, loading, busy, error, documentFor, link, unlink, create }
}
