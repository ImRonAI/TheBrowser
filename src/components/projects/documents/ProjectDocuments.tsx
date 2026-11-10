import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, FilePlus, FileText, LayoutTemplate, Loader2, Plus, RotateCcw, Save, Trash2,
} from 'lucide-react'
import { NotionEditor } from '@/components/board/task-detail/editor/NotionEditor'
import { WorkflowBlockExtension } from '@/components/board/task-detail/editor/extensions/WorkflowBlockExtension'
import { Markdown } from '@tiptap/markdown'
import { RonWriter } from '@/components/projects/RonWriter'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { projectsRequestFor, useProjectsStore } from '@/stores/projectsStore'
import {
  UNTITLED, createDocument, deleteDocument, documentAncestors, documentSubtree, documentTree, getDocument, isConflict,
  listDocuments, updateDocument, type ProjectDocumentSummary,
} from '@/lib/project-documents'
import type { Project } from '@/types/projects'
import { cn } from '@/lib/utils'
import { DocumentToolbar } from './DocumentToolbar'
import { DocumentIssueLinks } from './DocumentIssueLinks'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { instantiateTemplate, isSkillDocument, type DocumentTemplate } from '@/lib/document-templates'
import { TemplateGallery } from './TemplateGallery'
import { SkillPublishBar } from './SkillPublishBar'

const AUTOSAVE_MS = 1000
// Workflow blocks, and the official Markdown extension (Ron writes Markdown; the page is read back as Markdown for context).
const DOCUMENT_EXTENSIONS = [WorkflowBlockExtension, Markdown]

/** The page open in the editor. `key` names this editing session (a draft keeps it once saved). */
interface OpenPage { key: string; id: string | null; parentId: string | null; title: string; content: string }
/** What the server last confirmed for an editing session. */
interface SavedState { id: string | null; version: number; title: string; content: string }
type Status = 'idle' | 'loading' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'

const isBlank = (html: string) => !/<(workflow-block|table|hr|img)\b/i.test(html) && html.replace(/<[^>]+>/g, '').trim() === ''
let sessionCounter = 0
const nextKey = () => `page-${(sessionCounter += 1)}`

function relativeTime(timestamp: number) {
  const minutes = Math.round((Date.now() - timestamp) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  return new Date(timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function ProjectDocuments({ project, startWithDraft, onDraftStarted, openDocumentId, onIssueSelect }: {
  project: Project
  /** Set by the project header's New Document button. */
  startWithDraft: boolean
  onDraftStarted: () => void
  /** A deep link (`ron://project/<id>/docs/<page>`) opens this page. */
  openDocumentId?: string
  /** Opens a linked issue (from this project or another). */
  onIssueSelect: (issueId: string) => void
}) {
  const { userId, people } = useProjectsStore()
  const request = useMemo(() => (userId ? projectsRequestFor(userId) : null), [userId])
  const [documents, setDocuments] = useState<ProjectDocumentSummary[]>([])
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [listError, setListError] = useState('')
  const [page, setPage] = useState<OpenPage | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<ProjectDocumentSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [ron, setRon] = useState<{ goal: boolean } | null>(null)
  const openRon = useCallback((goal: boolean) => setRon({ goal }), [])
  /** The template gallery: for a new page (under `parentId`), or to fill the empty page that is open. */
  const [gallery, setGallery] = useState<{ mode: 'new'; parentId: string | null } | { mode: 'apply' } | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  const pageRef = useRef<OpenPage | null>(null)
  const savedRef = useRef(new Map<string, SavedState>())
  const blockedRef = useRef(new Set<string>())
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const timerRef = useRef<number | null>(null)
  pageRef.current = page

  const upsertSummary = useCallback((summary: ProjectDocumentSummary) => {
    setDocuments((current) => current.some((doc) => doc.id === summary.id)
      ? current.map((doc) => (doc.id === summary.id ? summary : doc)) : [...current, summary])
  }, [])

  /** Save one editing session's snapshot. Saves run one at a time so each uses the version the last one returned. */
  const persist = useCallback(async (snapshot: OpenPage) => {
    if (!request || blockedRef.current.has(snapshot.key)) return
    const last = savedRef.current.get(snapshot.key) ?? { id: null, version: 0, title: '', content: '' }
    const titleChanged = snapshot.title !== last.title
    const contentChanged = snapshot.content !== last.content
    if (!titleChanged && !contentChanged) return
    if (!last.id && !snapshot.title.trim() && isBlank(snapshot.content)) return
    const current = () => pageRef.current?.key === snapshot.key
    if (current()) setStatus('saving')
    try {
      const saved = last.id
        ? await updateDocument(request, last.id, last.version, { ...(titleChanged ? { title: snapshot.title } : {}), ...(contentChanged ? { content: snapshot.content } : {}) })
        : await createDocument(request, { projectId: project.id, parentId: snapshot.parentId, title: snapshot.title, content: snapshot.content })
      savedRef.current.set(snapshot.key, { id: saved.id, version: saved.version, title: snapshot.title, content: snapshot.content })
      upsertSummary(saved)
      if (current()) {
        setPage((open) => (open && open.key === snapshot.key ? { ...open, id: saved.id } : open))
        const open = pageRef.current!
        setStatus(open.title === snapshot.title && open.content === snapshot.content ? 'saved' : 'dirty')
        setSavedAt(Date.now())
        setMessage('')
      }
    } catch (error) {
      if (isConflict(error)) blockedRef.current.add(snapshot.key)
      if (current()) {
        setStatus(isConflict(error) ? 'conflict' : 'error')
        setMessage(error instanceof Error ? error.message : 'The page could not be saved.')
      }
    }
  }, [request, project.id, upsertSummary])

  const queueSave = useCallback((snapshot: OpenPage | null = pageRef.current) => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null }
    if (!snapshot) return queueRef.current
    queueRef.current = queueRef.current.then(() => persist(snapshot))
    return queueRef.current
  }, [persist])

  /**
   * Ask Ron on a page that was never saved: save it now so its conversation is saved with it. A blank
   * page is created as "Untitled" (the table requires a title), which the title field then shows.
   */
  const ensurePageId = useCallback(async (): Promise<string | null> => {
    const open = pageRef.current
    if (!open) return null
    if (open.id) return open.id
    const snapshot = !open.title.trim() && isBlank(open.content) ? { ...open, title: 'Untitled' } : open
    if (snapshot !== open) { pageRef.current = snapshot; setPage(snapshot) }
    await queueSave(snapshot)
    return savedRef.current.get(open.key)?.id ?? null
  }, [queueSave])

  // Load the page list for this project and account.
  useEffect(() => {
    if (!request) return
    let cancelled = false
    setListState('loading')
    listDocuments(request, project.id)
      .then((rows) => { if (!cancelled) { setDocuments(rows); setListState('ready') } })
      .catch((error) => { if (!cancelled) { setListState('error'); setListError(`Pages could not be loaded. ${error instanceof Error ? error.message : ''}`.trim()) } })
    return () => { cancelled = true }
  }, [request, project.id])

  // Leaving the docs view saves what is pending.
  useEffect(() => () => { void queueSave() }, [queueSave])

  /** A new page, blank or with a template's title and content (saved at once so it exists in the project). */
  const startDraft = useCallback((parentId: string | null = null, initial: { title: string; content: string } = { title: '', content: '' }) => {
    void queueSave()
    const key = nextKey()
    savedRef.current.set(key, { id: null, version: 0, title: '', content: '' })
    const next = { key, id: null, parentId, ...initial }
    pageRef.current = next
    setPage(next)
    setStatus('idle'); setMessage(''); setSavedAt(null)
    if (parentId) setCollapsed((current) => { const next = new Set(current); next.delete(parentId); return next })
    if (initial.title.trim() || !isBlank(initial.content)) void queueSave(next)
  }, [queueSave])

  /** Where to type first: a template whose title is left to the author ('' or "ADR: ") starts in the title. */
  const focusTitleIfOpen = (title: string) => {
    if (title.trim() && !title.endsWith(': ')) return
    window.requestAnimationFrame(() => { const input = titleRef.current; if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length) } })
  }

  const chooseTemplate = (template: DocumentTemplate) => {
    if (!gallery) return
    const { title, content } = template.id === 'blank' ? { title: '', content: '' } : instantiateTemplate(template)
    if (gallery.mode === 'new') {
      startDraft(gallery.parentId, { title, content })
      focusTitleIfOpen(title)
      return
    }
    const keepTitle = pageRef.current?.title.trim() ? pageRef.current.title : title
    edit({ title: keepTitle, content })
    focusTitleIfOpen(keepTitle)
  }

  /** Saves pending edits of the open page; true when everything it holds is saved. */
  const flushOpenPage = useCallback(async () => {
    const open = pageRef.current
    if (!open) return false
    await queueSave(open)
    const saved = savedRef.current.get(open.key)
    const now = pageRef.current
    return !!saved?.id && !blockedRef.current.has(open.key) && !!now && saved.title === now.title && saved.content === now.content
  }, [queueSave])

  const openDocument = useCallback(async (id: string) => {
    if (!request || pageRef.current?.id === id) return
    void queueSave()
    const key = nextKey()
    setPage(null); setStatus('loading'); setMessage('')
    try {
      const doc = await getDocument(request, id)
      savedRef.current.set(key, { id: doc.id, version: doc.version, title: doc.title, content: doc.content })
      upsertSummary(doc)
      setPage({ key, id: doc.id, parentId: doc.parentId, title: doc.title, content: doc.content })
      setStatus('idle'); setSavedAt(doc.updatedAt)
    } catch (error) {
      setStatus('error'); setMessage(error instanceof Error ? error.message : 'The page could not be opened.')
    }
  }, [request, queueSave, upsertSummary])

  // New Document from the project header opens the template gallery.
  useEffect(() => {
    if (startWithDraft && request) { setGallery({ mode: 'new', parentId: null }); onDraftStarted() }
  }, [startWithDraft, request, onDraftStarted])

  useEffect(() => {
    if (openDocumentId && request) void openDocument(openDocumentId)
  }, [openDocumentId, request, openDocument])

  // Otherwise open the first page once the list arrives.
  useEffect(() => {
    if (listState === 'ready' && !pageRef.current && !startWithDraft && !openDocumentId && documents.length > 0 && status === 'idle') {
      void openDocument(documentTree(documents)[0].document.id)
    }
  }, [listState, documents, startWithDraft, openDocumentId, status, openDocument])

  const edit = (patch: Partial<Pick<OpenPage, 'title' | 'content'>>) => {
    setPage((open) => {
      if (!open) return open
      const next = { ...open, ...patch }
      pageRef.current = next
      return next
    })
    if (!pageRef.current || blockedRef.current.has(pageRef.current.key)) return
    setStatus('dirty')
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => { timerRef.current = null; void queueSave() }, AUTOSAVE_MS)
  }

  /** Conflict: load the version saved elsewhere, discarding this session's unsaved edits. */
  const reloadFromServer = async () => {
    if (!page?.id) return
    const id = page.id
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null }
    // The conflicted session stays blocked, so nothing of it is saved on the way out.
    pageRef.current = null
    setPage(null)
    await openDocument(id)
  }

  /** Conflict: keep this session's text and save it over the newer version. */
  const overwriteServer = async () => {
    if (!request || !page?.id) return
    try {
      const latest = await getDocument(request, page.id)
      savedRef.current.set(page.key, { id: latest.id, version: latest.version, title: latest.title, content: latest.content })
      blockedRef.current.delete(page.key)
      await queueSave(pageRef.current)
    } catch (error) {
      setStatus('error'); setMessage(error instanceof Error ? error.message : 'The page could not be saved.')
    }
  }

  const removeDocument = async () => {
    if (!request || !confirmDelete) return
    setDeleting(true)
    const target = confirmDelete
    try {
      // Let a pending save of this page land first so it cannot recreate or 409 after the delete.
      if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null }
      await queueRef.current
      await deleteDocument(request, target.id)
      const removed = new Set(documentSubtree(documents, target.id))
      const remaining = documents.filter((doc) => !removed.has(doc.id))
      setDocuments(remaining)
      setConfirmDelete(null)
      if (pageRef.current?.id && removed.has(pageRef.current.id)) {
        setPage(null); setStatus('idle'); setMessage('')
        const next = documentTree(remaining)[0]?.document
        if (next) void openDocument(next.id)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The page could not be deleted.')
      setStatus('error')
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const tree = useMemo(() => documentTree(documents), [documents])
  const hidden = useMemo(() => {
    const result = new Set<string>()
    for (const id of collapsed) for (const child of documentSubtree(documents, id).slice(1)) result.add(child)
    return result
  }, [collapsed, documents])
  const ancestors = page?.id ? documentAncestors(documents, page.id)
    : page?.parentId ? [...documentAncestors(documents, page.parentId), ...documents.filter((doc) => doc.id === page.parentId)] : []
  const openSummary = page?.id ? documents.find((doc) => doc.id === page.id) : undefined
  const author = openSummary?.createdBy ? people.find((person) => person.id === openSummary.createdBy)?.name : undefined
  const deleteCount = confirmDelete ? documentSubtree(documents, confirmDelete.id).length - 1 : 0

  if (!request) return null

  return (
    <div className="flex min-h-[760px] gap-0 rounded-3xl glass-card border border-white/10 shadow-soft">
      {/* Page tree */}
      <aside aria-label="Pages" className="flex w-72 shrink-0 flex-col border-r border-surface-200/70 p-4 dark:border-surface-700/70">
        <div className="mb-3 flex items-center justify-between px-1">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted dark:text-ink-inverse-muted">{project.key} space</p>
            <h3 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">Pages</h3>
          </div>
          <Button type="button" size="icon-sm" variant="ghost" className="rounded-full" title="New page" aria-label="New page" onClick={() => setGallery({ mode: 'new', parentId: null })}>
            <Plus />
          </Button>
        </div>
        <nav className="-mx-1 flex-1 space-y-0.5 overflow-y-auto">
          {listState === 'loading' && <p className="flex items-center gap-2 px-3 py-2 text-body-xs text-ink-muted"><Loader2 className="size-3.5 animate-spin" />Loading pages…</p>}
          {listState === 'error' && <p role="alert" className="px-3 py-2 text-body-xs text-danger">{listError}</p>}
          {listState === 'ready' && tree.length === 0 && !page && <p className="px-3 py-2 text-body-xs text-ink-muted dark:text-ink-inverse-muted">No pages yet.</p>}
          {tree.filter((row) => !hidden.has(row.document.id)).map(({ document: doc, depth, childCount }) => {
            const active = page?.id === doc.id
            const isCollapsed = collapsed.has(doc.id)
            return (
              <div key={doc.id} className={cn('group flex items-center gap-1 rounded-xl pr-1 transition-colors',
                active ? 'bg-accent/10 text-accent dark:bg-accent-light/10 dark:text-accent-light' : 'text-ink-secondary hover:bg-surface-100 dark:text-ink-inverse-secondary dark:hover:bg-surface-800')}
                style={{ paddingLeft: 4 + depth * 16 }}>
                <button type="button" aria-label={isCollapsed ? `Expand ${doc.title}` : `Collapse ${doc.title}`} disabled={childCount === 0}
                  className={cn('flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface-200/60 dark:hover:bg-surface-700/60', childCount === 0 && 'invisible')}
                  onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(doc.id)) next.delete(doc.id); else next.add(doc.id); return next })}>
                  {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </button>
                <button type="button" aria-current={active ? 'page' : undefined} onClick={() => void openDocument(doc.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-body-sm">
                  <FileText className="size-4 shrink-0 opacity-70" />
                  <span className="truncate">{(active ? page?.title : doc.title) || UNTITLED}</span>
                </button>
                <button type="button" title="Add child page" aria-label={`Add a page under ${doc.title}`} onClick={() => setGallery({ mode: 'new', parentId: doc.id })}
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted opacity-0 hover:bg-surface-200/60 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-surface-700/60">
                  <Plus className="size-3.5" />
                </button>
              </div>
            )
          })}
          {page && !page.id && (
            <div className="flex items-center gap-2 rounded-xl bg-accent/10 px-3 py-1.5 text-body-sm text-accent dark:bg-accent-light/10 dark:text-accent-light"
              style={{ marginLeft: page.parentId ? 16 * ((tree.find((row) => row.document.id === page.parentId)?.depth ?? 0) + 1) : 0 }}>
              <FilePlus className="size-4 shrink-0" />
              <span className="truncate">{page.title || UNTITLED}</span>
              <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider opacity-70">Draft</span>
            </div>
          )}
        </nav>
      </aside>

      {/* Page */}
      <section className="min-w-0 flex-1">
        {page ? (
          <div className="mx-auto max-w-[860px] px-8 pb-16 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-body-xs text-ink-muted dark:text-ink-inverse-muted">
                <span>{project.name}</span>
                {ancestors.map((doc) => (
                  <span key={doc.id} className="flex items-center gap-1.5">
                    <ChevronRight className="size-3" />
                    <button type="button" className="max-w-[180px] truncate hover:text-ink dark:hover:text-ink-inverse" onClick={() => void openDocument(doc.id)}>{doc.title}</button>
                  </span>
                ))}
              </nav>
              <div className="flex items-center gap-2">
                <SaveState status={status} savedAt={savedAt} isDraft={!page.id} />
                {editor && (
                  <Button type="button" size="sm" variant="ghost" className="h-8 rounded-full text-ink-muted"
                    title="Add this page to Ren context as Markdown" aria-label="Add this page to Ren context"
                    disabled={isBlank(page.content)}
                    onClick={() => void useContextAgentStore.getState().addContext({
                      kind: 'document', title: `${project.key} · ${page.title || UNTITLED}`, text: editor.getMarkdown(),
                      url: page.id ? `ron://project/${project.id}/docs/${page.id}` : '',
                    })}>
                    + Context
                  </Button>
                )}
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 rounded-full"
                  disabled={status === 'saving' || status === 'conflict' || (!page.id && !page.title.trim() && isBlank(page.content))}
                  onClick={() => void queueSave()}>
                  <Save />{page.id ? 'Save' : 'Publish'}
                </Button>
                {page.id && openSummary && (
                  <Button type="button" size="icon-sm" variant="ghost" className="rounded-full text-ink-muted hover:text-danger" title="Delete page" aria-label="Delete page"
                    onClick={() => setConfirmDelete(openSummary)}>
                    <Trash2 />
                  </Button>
                )}
              </div>
            </div>

            {(status === 'conflict' || (status === 'error' && message)) && (
              <div role="alert" className={cn('mt-4 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-body-sm',
                status === 'conflict' ? 'border-warning/40 bg-warning/10 text-ink dark:text-ink-inverse' : 'border-danger/40 bg-danger/10 text-danger')}>
                <AlertTriangle className="size-4 shrink-0" />
                <span className="flex-1">{message}</span>
                {status === 'conflict' && (
                  <>
                    <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 rounded-full" onClick={() => void reloadFromServer()}><RotateCcw />Load their version</Button>
                    <Button type="button" size="sm" className="h-8 rounded-full" onClick={() => void overwriteServer()}>Keep mine</Button>
                  </>
                )}
              </div>
            )}

            <input ref={titleRef} aria-label="Page title" value={page.title} maxLength={300} placeholder="Give this page a title"
              onChange={(event) => edit({ title: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && editor) {
                  event.preventDefault()
                  // Move focus now (Tiptap's focus command waits a frame) so the next keystroke lands in the body.
                  editor.view.focus()
                  editor.commands.focus('start')
                }
                if (event.key === 's' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void queueSave() }
              }}
              className="mt-8 w-full bg-transparent font-display text-4xl leading-tight text-ink placeholder:text-ink-muted/60 focus:outline-none dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted/60" />
            <p className="mt-2 text-body-xs text-ink-muted dark:text-ink-inverse-muted">
              {page.id && openSummary
                ? <>Created{author ? ` by ${author}` : ''} · Updated {relativeTime(openSummary.updatedAt)}</>
                : 'Draft · saved to this project as soon as you start writing'}
            </p>
            {page.id && request && <DocumentIssueLinks request={request} documentId={page.id} onOpenIssue={onIssueSelect} />}
            {isBlank(page.content) && status !== 'conflict' && (
              <Button type="button" size="sm" variant="outline" className="mt-4 h-8 gap-1.5 rounded-full" onClick={() => setGallery({ mode: 'apply' })}>
                <LayoutTemplate />Use a template
              </Button>
            )}
            {page.id && (
              <SkillPublishBar key={page.id} request={request} documentId={page.id} version={openSummary?.version}
                isSkill={isSkillDocument(page.content)} flush={flushOpenPage} />
            )}

            <div className="sticky top-2 z-20 mt-6">
              {editor && <DocumentToolbar editor={editor} onAskRon={() => openRon(false)} />}
            </div>

            {ron && (
              <div className="mt-3">
                <RonWriter key={page.key} editor={editor} goal={ron.goal} onClose={() => setRon(null)}
                  conversations={{ request, documentId: page.id, ensureDocumentId: ensurePageId }}
                  target={() => ({ kind: 'page', title: pageRef.current?.title ?? '', projectName: project.name, projectKey: project.key })} />
              </div>
            )}

            <div className="mt-2">
              <NotionEditor key={page.key} canonical content={page.content} extensions={DOCUMENT_EXTENSIONS} onAskRon={openRon}
                onEditor={setEditor} onChange={(content) => edit({ content })} onSave={() => void queueSave()}
                placeholder="Write, or type / for headings, tables, a workflow, Ask Ren…"
                editorClassName="prose prose-base dark:prose-invert max-w-none focus:outline-none min-h-[420px] px-1 py-6" />
            </div>
          </div>
        ) : status === 'loading' ? (
          <div className="flex h-full min-h-[480px] items-center justify-center gap-2 text-body-sm text-ink-muted"><Loader2 className="size-4 animate-spin" />Opening page…</div>
        ) : (
          <div className="flex h-full min-h-[560px] items-center justify-center p-10">
            <div className="max-w-sm text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent/10 text-accent dark:bg-accent-light/10 dark:text-accent-light"><FileText className="size-5" /></div>
              <h3 className="mt-4 font-display text-xl text-ink dark:text-ink-inverse">{status === 'error' ? 'This page could not be opened' : 'Write it down'}</h3>
              <p className="mt-2 text-body-sm text-ink-muted dark:text-ink-inverse-muted">
                {status === 'error' ? message : 'Specs, decisions, meeting notes and runbooks live beside this project’s issues. Add a workflow to show how the work flows.'}
              </p>
              <Button type="button" className="mt-5 gap-2 rounded-full" onClick={() => setGallery({ mode: 'new', parentId: null })}><FilePlus />New Document</Button>
            </div>
          </div>
        )}
      </section>

      <TemplateGallery open={!!gallery} mode={gallery?.mode ?? 'new'} extensions={DOCUMENT_EXTENSIONS}
        onOpenChange={(next) => { if (!next) setGallery(null) }} onChoose={chooseTemplate} />

      <Dialog open={!!confirmDelete} onOpenChange={(next) => { if (!next && !deleting) setConfirmDelete(null) }}>
        <DialogContent showCloseButton={false} overlayClassName="z-[220] bg-surface-900/50 backdrop-blur-sm"
          className="z-[221] w-[calc(100%-2rem)] max-w-md gap-0 rounded-2xl bg-surface-0 p-6 text-ink dark:bg-surface-900 dark:text-ink-inverse">
          <div className="flex size-10 items-center justify-center rounded-xl bg-danger/10 text-danger"><Trash2 className="size-5" /></div>
          <DialogTitle className="mt-4 font-display text-xl">Delete “{confirmDelete?.title}”?</DialogTitle>
          <DialogDescription className="mt-2 text-body-sm text-ink-secondary dark:text-ink-inverse-secondary">
            {deleteCount > 0
              ? `This permanently deletes the page and the ${deleteCount} ${deleteCount === 1 ? 'page' : 'pages'} under it.`
              : 'This permanently deletes the page.'} This can’t be undone.
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="outline" className="rounded-full" disabled={deleting} onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button type="button" variant="destructive" className="gap-2 rounded-full" disabled={deleting} onClick={() => void removeDocument()}>
              {deleting && <Loader2 className="animate-spin" />}Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SaveState({ status, savedAt, isDraft }: { status: Status; savedAt: number | null; isDraft: boolean }) {
  const base = 'flex items-center gap-1.5 text-body-xs text-ink-muted dark:text-ink-inverse-muted'
  if (status === 'saving') return <span className={base}><Loader2 className="size-3.5 animate-spin" />Saving…</span>
  if (status === 'dirty') return <span className={base}>Unsaved changes</span>
  if (status === 'conflict') return <span className={cn(base, 'text-warning')}>Not saved</span>
  if (status === 'error') return <span className={cn(base, 'text-danger')}>Not saved</span>
  if (isDraft) return <span className={base}>Draft</span>
  if (savedAt) return <span className={base}><Check className="size-3.5 text-success" />Saved {relativeTime(savedAt)}</span>
  return null
}
