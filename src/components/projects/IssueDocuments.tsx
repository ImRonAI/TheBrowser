import { ArrowUpRight, FileText, X } from 'lucide-react'
import { useProjectsStore } from '@/stores/projectsStore'
import { UNTITLED, type DocumentIssueLink, type ProjectDocumentSummary } from '@/lib/project-documents'
import type { IssueDocuments as IssueDocumentsState } from './useIssueDocuments'

const updated = (timestamp: number) => {
  const minutes = Math.round((Date.now() - timestamp) / 60000)
  if (minutes < 1) return 'Updated just now'
  if (minutes < 60) return `Updated ${minutes} min ago`
  if (minutes < 60 * 24) return `Updated ${Math.round(minutes / 60)} h ago`
  return `Updated ${new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

/**
 * The pages related to this issue (`document_issue_links`), shown in the Description tab. Pages are added
 * from the sidebar's Related documents field; a page from another project linked from the page side shows
 * here too. Open goes to the page (`ron://project/<id>/docs/<page>`).
 */
export function IssueDocuments({ docs, disabled, onOpenDocument, onUnrelate }: {
  docs: IssueDocumentsState
  disabled?: boolean
  onOpenDocument: (document: ProjectDocumentSummary) => void
  onUnrelate: (link: DocumentIssueLink) => void
}) {
  const { projects } = useProjectsStore()
  const projectKey = (projectId: string) => projects.find((project) => project.id === projectId)?.key ?? '?'

  return <section aria-label="Related documents" className="space-y-3">
    <div className="flex items-baseline gap-2">
      <h3 className="font-display text-lg font-bold leading-tight tracking-tight text-ink dark:text-ink-inverse">Related documents</h3>
      {docs.links.length > 0 && <span className="font-mono text-[11px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">{docs.links.length}</span>}
    </div>
    {docs.loading && <div className="h-16 rounded-xl bg-surface-100 motion-safe:animate-pulse dark:bg-surface-850" />}
    {!docs.loading && docs.links.length === 0 && (
      <p className="rounded-xl border border-dashed border-surface-300 px-4 py-3.5 text-[13px] text-ink-muted dark:border-surface-700 dark:text-ink-inverse-muted">
        No related documents yet. Add one with <span className="font-medium text-ink-secondary dark:text-ink-inverse-secondary">Related documents</span> in the sidebar.
      </p>
    )}
    {docs.links.length > 0 && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {docs.links.map((link) => {
        const doc = docs.documentFor(link)
        return <div key={link.id} className="group relative flex items-center gap-3 rounded-xl border border-surface-200 bg-surface-0 p-3 transition-colors duration-150 ease-out hover:border-blurple-300 hover:bg-surface-50 dark:border-surface-800 dark:bg-surface-900 dark:hover:border-blurple-800 dark:hover:bg-surface-850">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-100 text-ink-secondary transition-colors duration-150 group-hover:bg-blurple-50 group-hover:text-blurple-600 dark:bg-surface-850 dark:text-ink-inverse-secondary dark:group-hover:bg-blurple-950/60 dark:group-hover:text-blurple-300"><FileText className="size-4" /></span>
          <button type="button" disabled={!doc} onClick={() => doc && onOpenDocument(doc)} className="min-w-0 flex-1 rounded-sm text-left after:absolute after:inset-0 after:rounded-xl after:content-[''] disabled:cursor-default">
            <span className="block truncate text-[13.5px] font-semibold text-ink dark:text-ink-inverse">{doc ? doc.title || UNTITLED : 'Page not available'}</span>
            <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted dark:text-ink-inverse-muted">{doc ? <><span className="font-mono font-medium tracking-[0.02em]">{projectKey(doc.projectId)}</span> · {updated(doc.updatedAt)}</> : 'Deleted, or not shared with you'}</span>
          </button>
          {doc && <ArrowUpRight className="size-4 shrink-0 text-ink-muted transition-[color,transform] duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-blurple-600 dark:text-ink-inverse-muted dark:group-hover:text-blurple-400" />}
          <button type="button" aria-label={`Remove ${doc?.title ?? 'document'} from related documents`} disabled={disabled || docs.busy} onClick={() => onUnrelate(link)}
            className="relative z-[1] -mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted opacity-0 transition-colors duration-150 hover:bg-red-50 hover:text-red-700 focus:opacity-100 group-hover:opacity-100 disabled:hidden dark:text-ink-inverse-muted dark:hover:bg-red-950/40 dark:hover:text-red-400">
            <X className="size-3.5" />
          </button>
        </div>
      })}
    </div>}
  </section>
}
