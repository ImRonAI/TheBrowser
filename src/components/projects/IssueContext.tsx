import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, FileText, Layers, Loader2 } from 'lucide-react'
import { Markdown } from '@tiptap/markdown'
import { MessageResponse } from '@/components/ai-elements/response'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { NotionEditor } from '@/components/board/task-detail/editor/NotionEditor'
import { WorkflowBlockExtension } from '@/components/board/task-detail/editor/extensions/WorkflowBlockExtension'
import { attachmentUrl } from '@/lib/context-to-issue'
import { issueContextEntries, kindLabel, pageFromSource, type IssueFileRef } from '@/lib/issue-attachments'
import { getDocument, type ProjectDocument } from '@/lib/project-documents'
import { cn } from '@/lib/utils'
import { projectsRequestFor, useProjectsStore } from '@/stores/projectsStore'

// The page renders as it does in the project's Docs (workflow blocks; the page editor's Markdown extension).
const PAGE_EXTENSIONS = [WorkflowBlockExtension, Markdown]

const MUTED = 'text-ink-muted dark:text-ink-inverse-muted'
const ERROR = 'text-[12px] text-red-700 dark:text-red-400'
/** Volt links: 600 on paper, 400 on ink. */
const LINK = 'text-blurple-600 underline-offset-2 transition-colors duration-150 hover:text-blurple-700 hover:underline dark:text-blurple-400 dark:hover:text-blurple-300'
/** A quiet inset for what an entry carries (Markdown, a live page). */
const INSET = 'rounded-lg bg-surface-100/70 text-ink dark:bg-surface-850 dark:text-ink-inverse'
const MEDIA = 'max-h-96 max-w-full rounded-xl border border-surface-200 dark:border-surface-800'

/** A related project page, read as it is now (the entry itself stores only the link). */
function PagePreview({ documentId, stored }: { documentId: string; stored: string }) {
  const { userId } = useProjectsStore()
  const request = useMemo(() => (userId ? projectsRequestFor(userId) : null), [userId])
  const [page, setPage] = useState<ProjectDocument | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!request) return
    let live = true
    setPage(null); setError('')
    getDocument(request, documentId).then((doc) => { if (live) setPage(doc) })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'The page could not be loaded.') })
    return () => { live = false }
  }, [request, documentId])
  if (error) return <div className="space-y-2">
    <p role="alert" className={ERROR}>{error}</p>
    {stored && <div className={cn(INSET, 'max-h-96 overflow-y-auto px-3.5 py-2.5 text-[13px]')}><MessageResponse>{stored}</MessageResponse></div>}
  </div>
  if (!page) return <p className={cn('flex items-center gap-2 text-[12px]', MUTED)}><Loader2 className="size-3.5 animate-spin" />Loading page…</p>
  if (!page.content.replace(/<[^>]+>/g, '').trim() && !/<(workflow-block|table|img|hr)\b/i.test(page.content)) {
    return <p className={cn(INSET, 'px-3.5 py-2.5 text-[13px] text-ink-secondary dark:text-ink-inverse-secondary')}>This page is empty so far.</p>
  }
  return <div className={cn(INSET, 'max-h-96 overflow-y-auto')} data-testid="issue-context-page">
    <NotionEditor key={`${page.id}:${page.version}`} canonical readOnly preview content={page.content} extensions={PAGE_EXTENSIONS} onChange={() => {}}
      editorClassName="prose prose-sm dark:prose-invert max-w-none focus:outline-none !min-h-0 px-3 py-2" />
  </div>
}

/** A file in the private `issue-attachments` bucket, shown through a short-lived signed URL. */
function AttachedFile({ file }: { file: IssueFileRef }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setUrl(''); setError('')
    attachmentUrl(file).then((signed) => { if (live) setUrl(signed) }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { live = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one signed URL per stored object
  }, [file.bucket, file.path])
  if (error) return <p className={ERROR} role="alert">{file.name}: {error}</p>
  if (!url) return <p className={cn('text-[12px]', MUTED)}>Loading {file.name}…</p>
  return <div className="space-y-1.5" data-testid="issue-context-file">
    {file.mediaType.startsWith('image/') && <img src={url} alt={file.name} loading="lazy" className={cn(MEDIA, 'object-contain')} />}
    {file.mediaType.startsWith('video/') && <video src={url} controls preload="metadata" className={MEDIA} />}
    <a href={url} target="_blank" rel="noopener noreferrer" className={cn('inline-block break-all text-[12px] font-medium', LINK)}>Open {file.name}</a>
  </div>
}

const when = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** The issue's Context tab: everything sent here from the Context widget, as Markdown plus captured files. */
export function IssueContext({ entries, disabled, onRemove }: {
  entries: Record<string, unknown>[]
  disabled: boolean
  onRemove: (id: string) => void
}) {
  const items = issueContextEntries(entries)
  return <section aria-label="Issue context" className="h-full overflow-y-auto px-8 py-7 text-ink dark:text-ink-inverse">
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h3 className="font-display text-lg font-bold leading-tight tracking-tight text-ink dark:text-ink-inverse">Context</h3>
        {items.length > 0 && <span className={cn('text-[12px]', MUTED)}><span className="font-mono tabular-nums">{items.length}</span> item{items.length === 1 ? '' : 's'} · Ren reads these with the issue</span>}
      </div>
      {!items.length && <div className="mt-5 flex flex-col items-center justify-center rounded-2xl border border-dashed border-surface-300 px-6 py-14 text-center dark:border-surface-700">
        <span className="flex size-11 items-center justify-center rounded-xl bg-surface-100 text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary">
          <Layers className="size-5" strokeWidth={1.75} aria-hidden />
        </span>
        <p className="mt-4 font-display text-base font-bold leading-tight tracking-tight text-ink dark:text-ink-inverse">No context yet</p>
        <p className={cn('mt-1.5 max-w-sm text-[13px] leading-relaxed', MUTED)}>Collect links, searches, highlights, chat threads, pages, screenshots or recordings with the Ren orb, then choose <span className="font-medium text-ink-secondary dark:text-ink-inverse-secondary">Send to issue</span>.</p>
      </div>}
      {items.length > 0 && <Accordion type="multiple" className="mt-5 space-y-2">
        {items.map((entry) => {
          const internal = entry.source.startsWith('ron://')
          const page = entry.kind === 'document' ? pageFromSource(entry.source) : null
          const addedAt = when(entry.attachedAt || entry.added)
          const collectedAt = entry.attachedAt && entry.added ? when(entry.added) : ''
          return <AccordionItem key={entry.id} value={entry.id} data-testid="issue-context-entry"
            className="rounded-xl border border-surface-200 px-4 transition-colors duration-150 hover:border-surface-300 data-[state=open]:border-surface-300 dark:border-surface-800 dark:hover:border-surface-700 dark:data-[state=open]:border-surface-700">
            <AccordionTrigger className="gap-3 py-3 font-sans hover:no-underline">
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md bg-surface-100 px-1.5 font-mono text-[11px] font-medium text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary">
                  {page && <FileText className="size-3 text-volt" />}{kindLabel(entry.kind)}
                </span>
                {addedAt && <time dateTime={entry.attachedAt || entry.added} className={cn('shrink-0 font-mono text-[11px] font-normal tabular-nums', MUTED)}>{addedAt}</time>}
                <span className="min-w-0 truncate text-[13.5px] font-semibold text-ink dark:text-ink-inverse">{entry.title}</span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  {entry.url && <a href={entry.url} target="_blank" rel="noopener noreferrer" className={cn('block truncate text-[12px]', LINK)}>{entry.url}</a>}
                  {page && <button type="button" className={cn('inline-flex items-center gap-1 rounded-sm text-[12px] font-medium', LINK)}
                    onClick={() => void window.electron?.browser?.navigate(entry.source)}>Open page<ArrowUpRight className="size-3" /></button>}
                  {internal && !page && <button type="button" className={cn('block max-w-full truncate rounded-sm text-left font-mono text-[11.5px]', LINK)}
                    onClick={() => void window.electron?.browser?.navigate(entry.source)}>{entry.source}</button>}
                  {collectedAt && collectedAt !== addedAt && <p className={cn('text-[12px]', MUTED)}>Collected <span className="font-mono tabular-nums">{collectedAt}</span></p>}
                </div>
                <button type="button" disabled={disabled}
                  className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-ink-muted transition-colors duration-150 hover:bg-red-50 hover:text-red-700 disabled:pointer-events-none disabled:opacity-50 dark:text-ink-inverse-muted dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  aria-label={`Remove ${entry.title} from context`} onClick={() => onRemove(entry.id)}>Remove</button>
              </div>
              {entry.files.map((file) => <AttachedFile key={file.path} file={file} />)}
              {entry.images.map((image) => <img key={image.url} src={image.url} alt={entry.title} loading="lazy" referrerPolicy="no-referrer"
                className={cn(MEDIA, 'object-contain')} />)}
              {page && <PagePreview documentId={page.documentId} stored={entry.content} />}
              {!page && entry.content && <div className={cn(INSET, 'max-h-96 overflow-y-auto px-3.5 py-2.5 text-[13px]')}>
                <MessageResponse>{entry.content}</MessageResponse>
              </div>}
            </AccordionContent>
          </AccordionItem>
        })}
      </Accordion>}
    </div>
  </section>
}
