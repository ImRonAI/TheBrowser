import { useMemo, useState } from 'react'
import { ArrowLeft, Check, FilePlus, FileText, Loader2, Search, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DOCUMENT_TITLE_MAX, UNTITLED, type DocumentIssueLink, type ProjectDocumentSummary } from '@/lib/project-documents'
import { cn } from '@/lib/utils'
import { AddButton, PROPERTY_POPOVER } from './IssueProperties'
import type { IssueDocuments } from './useIssueDocuments'

const updated = (timestamp: number) => {
  const minutes = Math.round((Date.now() - timestamp) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * The issue's **Related documents** field. The dropdown searches every page of the issue's project; picking
 * one links it to the issue (`document_issue_links`, listed in the Description tab) and adds it to the
 * issue's Context. **New document** at the bottom asks for a title, creates the page in this project,
 * links it, and opens it in the project's Docs with that title filled in.
 */
export function RelatedDocumentsField({ docs, projectName, disabled, onRelate, onUnrelate, onCreate, onOpen }: {
  docs: IssueDocuments
  projectName: string
  disabled?: boolean
  onRelate: (document: ProjectDocumentSummary) => Promise<void>
  onUnrelate: (link: DocumentIssueLink) => Promise<void>
  /** Creates, links and opens the page; resolves false when it stayed here (the error is shown). */
  onCreate: (title: string) => Promise<boolean>
  onOpen: (document: ProjectDocumentSummary) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [naming, setNaming] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const linkedIds = useMemo(() => new Set(docs.links.map((link) => link.documentId)), [docs.links])
  const words = query.trim().toLowerCase()
  const matches = docs.projectDocuments.filter((doc) => !words || (doc.title || UNTITLED).toLowerCase().includes(words))
  const related = docs.links.map((link) => ({ link, doc: docs.documentFor(link) }))

  const close = () => { setOpen(false); setQuery(''); setNaming(null); setActive(0) }
  const pick = async (doc: ProjectDocumentSummary) => {
    const link = docs.links.find((item) => item.documentId === doc.id)
    if (link) await onUnrelate(link)
    else await onRelate(doc)
  }
  const create = async () => {
    const title = naming?.trim()
    if (!title || creating) return
    setCreating(true)
    try { if (await onCreate(title.slice(0, DOCUMENT_TITLE_MAX))) close() } finally { setCreating(false) }
  }

  return <div className="space-y-0.5">
    {related.map(({ link, doc }) => (
      <div key={link.id} className="group/doc flex min-h-8 items-center gap-2 rounded-lg px-2 py-1 transition-colors duration-150 ease-out hover:bg-surface-100 dark:hover:bg-surface-850">
        <FileText className="size-3.5 shrink-0 text-volt" />
        <button type="button" disabled={!doc} title={doc ? `Open ${doc.title}` : undefined} onClick={() => doc && onOpen(doc)}
          className="min-w-0 flex-1 truncate rounded-sm text-left text-[13px] font-medium text-ink underline-offset-2 hover:underline disabled:cursor-default disabled:font-normal disabled:text-ink-muted disabled:no-underline dark:text-ink-inverse dark:disabled:text-ink-inverse-muted">
          {doc ? doc.title || UNTITLED : 'Page not available'}
        </button>
        <button type="button" aria-label={`Remove ${doc?.title ?? 'document'} from related documents`} disabled={disabled || docs.busy}
          onClick={() => void onUnrelate(link)}
          className="flex size-5 shrink-0 items-center justify-center rounded-md text-ink-muted opacity-0 transition-colors duration-150 hover:bg-red-50 hover:text-red-700 focus:opacity-100 group-hover/doc:opacity-100 disabled:hidden dark:text-ink-inverse-muted dark:hover:bg-red-950/40 dark:hover:text-red-400">
          <X className="size-3" />
        </button>
      </div>
    ))}
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <PopoverTrigger asChild>
        <AddButton aria-label="Add related document" disabled={disabled || docs.loading}>
          {docs.loading ? 'Loading documents…' : related.length ? 'Add document' : 'Add related documents'}
        </AddButton>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className={cn(PROPERTY_POPOVER, 'w-80 overflow-hidden p-0')}
        onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).querySelector('input')?.focus() }}>
        {naming === null ? <>
          <div className="ron-field flex items-center gap-2 border-b border-border px-3">
            <Search className="size-3.5 shrink-0 text-ink-muted dark:text-ink-inverse-muted" />
            <input aria-label="Search documents" value={query} placeholder={`Search ${projectName} documents…`}
              onChange={(event) => { setQuery(event.target.value); setActive(0) }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, matches.length)) }
                if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)) }
                if (event.key === 'Enter') {
                  event.preventDefault(); event.stopPropagation()
                  if (active < matches.length) void pick(matches[active])
                  else setNaming(query.trim())
                }
              }}
              className="h-10 w-full bg-transparent text-[13px] text-ink placeholder:text-ink-muted focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted" />
          </div>
          <ul role="listbox" aria-label={`${projectName} documents`} className="max-h-64 overflow-y-auto p-1">
            {matches.length === 0 && <li className="px-3 py-5 text-center text-[13px] text-ink-muted dark:text-ink-inverse-muted">
              {docs.projectDocuments.length === 0 ? 'This project has no documents yet.' : 'No documents match.'}
            </li>}
            {matches.map((doc, index) => {
              const linked = linkedIds.has(doc.id)
              return <li key={doc.id} role="option" aria-selected={linked}>
                <button type="button" disabled={docs.busy} onMouseEnter={() => setActive(index)} onClick={() => void pick(doc)}
                  className={cn('flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-ink disabled:opacity-60 dark:text-ink-inverse',
                    index === active && 'bg-surface-100 dark:bg-surface-800')}>
                  <FileText className="size-3.5 shrink-0 text-ink-muted dark:text-ink-inverse-muted" />
                  <span className="min-w-0 flex-1 truncate">{doc.title || UNTITLED}</span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">{updated(doc.updatedAt)}</span>
                  <Check className={cn('size-3.5 shrink-0 text-volt', linked ? 'opacity-100' : 'opacity-0')} />
                </button>
              </li>
            })}
          </ul>
          <div className="border-t border-border p-1">
            <button type="button" onMouseEnter={() => setActive(matches.length)} onClick={() => setNaming(query.trim())}
              className={cn('flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-semibold text-blurple-600 dark:text-blurple-400',
                active === matches.length && 'bg-blurple-50 dark:bg-blurple-950/50')}>
              <FilePlus className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{query.trim() ? `New document “${query.trim()}”` : 'New document'}</span>
            </button>
          </div>
        </> : (
          <form className="space-y-3 p-3" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void create() }}>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Back to documents" onClick={() => setNaming(null)}
                className="flex size-6 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-surface-800 dark:hover:text-ink-inverse"><ArrowLeft className="size-3.5" /></button>
              <p className="text-[13px] font-semibold text-ink dark:text-ink-inverse">What should the document be called?</p>
            </div>
            <input aria-label="New document title" autoFocus required maxLength={DOCUMENT_TITLE_MAX} value={naming} placeholder="e.g. Rollout plan"
              onChange={(event) => setNaming(event.target.value)}
              className="h-9 w-full rounded-lg border border-surface-200 bg-surface-0 px-3 text-[13.5px] text-ink placeholder:text-ink-muted transition-colors duration-150 focus:border-blurple-600 focus:outline-none focus:ring-2 focus:ring-blurple-600/20 focus-visible:ring-offset-0 dark:border-surface-700 dark:bg-surface-900 dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted dark:focus:border-blurple-400 dark:focus:ring-blurple-400/25" />
            <p className="text-[12px] leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
              It’s created in {projectName}’s documents, linked to this issue and added to its context. Your changes here are saved first.
            </p>
            {docs.error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-400">{docs.error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setNaming(null)} className="h-8 rounded-lg px-3 text-[13px] font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse">Cancel</button>
              <button type="submit" disabled={!naming.trim() || creating}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blurple-600 px-3.5 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-blurple-700 active:bg-blurple-800 disabled:opacity-40 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300">
                {creating && <Loader2 className="size-3.5 animate-spin" />}Create document
              </button>
            </div>
          </form>
        )}
      </PopoverContent>
    </Popover>
    {docs.error && !open && <p role="alert" className="px-2 text-[12px] text-red-700 dark:text-red-400">{docs.error}</p>}
  </div>
}
