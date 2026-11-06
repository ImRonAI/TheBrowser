import { useEffect, useRef, useState } from 'react'
import { Link2, Loader2, Plus, X } from 'lucide-react'
import { useProjectsStore } from '@/stores/projectsStore'
import type { Issue, IssueStatus } from '@/types/projects'
import { linkDocumentToIssue, listDocumentLinks, unlinkDocument, type DocumentIssueLink } from '@/lib/project-documents'
import type { ProjectsRequest } from '@/lib/projects-api'
import { cn } from '@/lib/utils'

export const ISSUE_STATUS_DOT: Record<IssueStatus, string> = {
  backlog: 'bg-surface-400', 'in-progress': 'bg-accent', review: 'bg-info', blocked: 'bg-danger', done: 'bg-success',
}

const failure = (cause: unknown) => (cause instanceof Error ? cause.message : 'The link could not be saved.')

/**
 * The issues a page relates to (`document_issue_links`), from this project or any other. Chips open
 * the issue; × unlinks; "Link issue" searches every issue the user can access.
 */
export function DocumentIssueLinks({ request, documentId, onOpenIssue }: {
  request: ProjectsRequest
  documentId: string
  onOpenIssue: (issueId: string) => void
}) {
  const { issues, projects } = useProjectsStore()
  const [links, setLinks] = useState<DocumentIssueLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    setLoading(true); setLinks([]); setError(null); setPicking(false)
    listDocumentLinks(request, { documentId })
      .then((rows) => { if (live) setLinks(rows) })
      .catch((cause) => { if (live) setError(failure(cause)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [request, documentId])
  useEffect(() => { if (picking) inputRef.current?.focus() }, [picking])

  const key = (issue: Issue) => `${projects.find((project) => project.id === issue.projectId)?.key ?? '?'}-${issue.number}`
  const linked = new Set(links.map((link) => link.issueId))
  const words = query.trim().toLowerCase()
  const matches = issues.filter((issue) => !linked.has(issue.id) && (!words || `${key(issue)} ${issue.title}`.toLowerCase().includes(words))).slice(0, 8)

  const add = async (issueId: string) => {
    if (busy) return
    setBusy(true)
    try {
      const link = await linkDocumentToIssue(request, documentId, issueId)
      setLinks((current) => [...current, link]); setQuery(''); setPicking(false); setError(null)
    } catch (cause) { setError(failure(cause)) } finally { setBusy(false) }
  }
  const remove = async (link: DocumentIssueLink) => {
    if (busy) return
    setBusy(true)
    try {
      await unlinkDocument(request, link.id)
      setLinks((current) => current.filter((item) => item.id !== link.id)); setError(null)
    } catch (cause) { setError(failure(cause)) } finally { setBusy(false) }
  }

  return (
    <section aria-label="Linked issues" className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-body-xs font-medium text-ink-muted dark:text-ink-inverse-muted"><Link2 className="size-3.5" />Linked issues</span>
        {loading && <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-label="Loading linked issues" />}
        {links.map((link) => {
          const issue = issues.find((item) => item.id === link.issueId)
          return (
            <span key={link.id} className="inline-flex max-w-[320px] items-center gap-1.5 rounded-full border border-surface-200 bg-surface-0 py-0.5 pl-2.5 pr-1 text-body-xs dark:border-surface-700 dark:bg-surface-850">
              <span className={cn('size-1.5 shrink-0 rounded-full', issue ? ISSUE_STATUS_DOT[issue.status] : 'bg-surface-300')} />
              <button type="button" disabled={!issue} title={issue?.title} onClick={() => issue && onOpenIssue(issue.id)}
                className="min-w-0 truncate text-ink hover:underline disabled:cursor-default disabled:text-ink-muted disabled:no-underline dark:text-ink-inverse">
                {issue ? <><span className="font-medium">{key(issue)}</span> · {issue.title}</> : 'Issue not available'}
              </button>
              <button type="button" aria-label={`Unlink ${issue ? key(issue) : 'issue'}`} disabled={busy} onClick={() => void remove(link)}
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-100 hover:text-danger dark:hover:bg-surface-800"><X className="size-3" /></button>
            </span>
          )
        })}
        {!loading && !picking && (
          <button type="button" onClick={() => setPicking(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-surface-300 px-2.5 py-0.5 text-body-xs text-ink-secondary hover:border-accent/50 hover:text-ink dark:border-surface-600 dark:text-ink-inverse-secondary dark:hover:text-ink-inverse">
            <Plus className="size-3" />Link issue
          </button>
        )}
      </div>
      {picking && (
        <div className="relative mt-2 max-w-md">
          <input ref={inputRef} aria-label="Find an issue to link" value={query} placeholder="Search issues in any project by key or title"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { setPicking(false); setQuery('') }
              if (event.key === 'Enter' && matches[0]) { event.preventDefault(); void add(matches[0].id) }
            }}
            className="w-full rounded-xl border border-surface-200 bg-surface-0 px-3 py-2 text-body-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 dark:border-surface-700 dark:bg-surface-850 dark:text-ink-inverse" />
          <ul role="listbox" aria-label="Issues to link" className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-surface-200 bg-surface-0 p-1 shadow-lg dark:border-surface-700 dark:bg-surface-850">
            {matches.length === 0 && <li className="px-3 py-2 text-body-xs text-ink-muted">No matching issues</li>}
            {matches.map((issue) => (
              <li key={issue.id} role="option" aria-selected={false}>
                <button type="button" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => void add(issue.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-body-sm text-ink hover:bg-surface-100 dark:text-ink-inverse dark:hover:bg-surface-800">
                  <span className={cn('size-1.5 shrink-0 rounded-full', ISSUE_STATUS_DOT[issue.status])} />
                  <span className="shrink-0 font-medium">{key(issue)}</span>
                  <span className="min-w-0 truncate text-ink-secondary dark:text-ink-inverse-secondary">{issue.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-body-xs text-danger">{error}</p>}
    </section>
  )
}
