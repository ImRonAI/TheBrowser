import { useEffect, useMemo, useState } from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { projectsRequestFor, useProjectsStore } from '@/stores/projectsStore'
import type { Issue } from '@/types/projects'
import {
  linkDocumentToIssue, listAllDocuments, listDocumentLinks, unlinkDocument, type DocumentIssueLink, type ProjectDocumentSummary,
} from '@/lib/project-documents'
import { projectInputClass } from './ProjectFieldInput'

const failure = (cause: unknown) => (cause instanceof Error ? cause.message : 'Documents could not be loaded.')

/**
 * The project pages this issue relates to (`document_issue_links`), from any project. Open goes to
 * the page (`ron://project/<id>/docs/<page>`); a page from any project the user can access can be linked.
 */
export function IssueDocuments({ issue, disabled, onOpenDocument }: {
  issue: Issue
  disabled?: boolean
  onOpenDocument: (document: ProjectDocumentSummary) => void
}) {
  const { userId, projects } = useProjectsStore()
  const request = useMemo(() => (userId ? projectsRequestFor(userId) : null), [userId])
  const [links, setLinks] = useState<DocumentIssueLink[]>([])
  const [documents, setDocuments] = useState<ProjectDocumentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!request) return
    let live = true
    setLoading(true); setError(null)
    Promise.all([listDocumentLinks(request, { issueId: issue.id }), listAllDocuments(request)])
      .then(([rows, pages]) => { if (live) { setLinks(rows); setDocuments(pages) } })
      .catch((cause) => { if (live) setError(failure(cause)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [request, issue.id])

  const projectKey = (projectId: string) => projects.find((project) => project.id === projectId)?.key ?? '?'
  const linked = new Set(links.map((link) => link.documentId))
  const words = query.trim().toLowerCase()
  const candidates = documents.filter((doc) => !linked.has(doc.id) && (!words || `${projectKey(doc.projectId)} ${doc.title}`.toLowerCase().includes(words)))

  const add = async () => {
    if (!request || !target || busy) return
    setBusy(true)
    try {
      const link = await linkDocumentToIssue(request, target, issue.id)
      setLinks((current) => [...current, link]); setTarget(''); setQuery(''); setError(null)
    } catch (cause) { setError(failure(cause)) } finally { setBusy(false) }
  }
  const remove = async (link: DocumentIssueLink) => {
    if (!request || busy) return
    setBusy(true)
    try {
      await unlinkDocument(request, link.id)
      setLinks((current) => current.filter((item) => item.id !== link.id)); setError(null)
    } catch (cause) { setError(failure(cause)) } finally { setBusy(false) }
  }

  return <section aria-label="Documents" className="space-y-3">
    <h3 className="font-semibold">Documents</h3>
    {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    {loading && <p className="text-sm text-ink-muted">Loading documents…</p>}
    {!loading && links.length === 0 && <p className="text-sm text-ink-muted">No linked documents.</p>}
    {links.map((link) => {
      const doc = documents.find((item) => item.id === link.documentId)
      return <div key={link.id} className="flex items-center gap-3 rounded-xl border border-surface-200 p-3 dark:border-surface-800">
        <FileText className="size-4 shrink-0 text-ink-muted" />
        <Button type="button" variant="link" className="h-auto min-w-0 flex-1 justify-start whitespace-normal p-0 text-left text-sm text-indigo-500"
          disabled={!doc} onClick={() => doc && onOpenDocument(doc)}>
          {doc ? `${projectKey(doc.projectId)} · ${doc.title}` : 'Page not available'}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="text-rose-500" disabled={busy || disabled} onClick={() => void remove(link)}>Remove</Button>
      </div>
    })}
    <fieldset disabled={busy || disabled || loading} className="space-y-2">
      <input aria-label="Search documents to link" className={projectInputClass} placeholder="Search pages by project or title" value={query} onChange={(event) => setQuery(event.target.value)} />
      <select aria-label="Document to link" className={projectInputClass} value={target} onChange={(event) => setTarget(event.target.value)}>
        <option value="">Choose a page</option>
        {candidates.slice(0, 100).map((doc) => <option key={doc.id} value={doc.id}>{`${projectKey(doc.projectId)} · ${doc.title}`}</option>)}
      </select>
      <Button type="button" variant="outline" disabled={!target} onClick={() => void add()}>Link document</Button>
    </fieldset>
  </section>
}
