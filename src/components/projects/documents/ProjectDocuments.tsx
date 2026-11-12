import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  AlertTriangle, Check, ChevronRight, FilePlus, FileText, LayoutTemplate, Loader2, Lock, Plus, RotateCcw, Save, Trash2,
} from 'lucide-react'
import { NotionEditor } from '@/components/board/task-detail/editor/NotionEditor'
import { WorkflowBlockExtension } from '@/components/board/task-detail/editor/extensions/WorkflowBlockExtension'
import { openInternalUrl } from '@/components/board/task-detail/editor/extensions/blocks/workspace'
import { Markdown } from '@tiptap/markdown'
import { RonWriter } from '@/components/projects/RonWriter'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { projectsRequestFor, useProjectsStore } from '@/stores/projectsStore'
import {
  UNTITLED, createDocument, deleteDocument, documentAncestors, documentErrorMessage, documentSource, documentSubtree, documentTitle,
  documentTree, getDocument, isConflict, listAllDocuments, listDocuments, moveDocument, updateDocument, withMovedDocument,
  type ProjectDocumentSummary,
} from '@/lib/project-documents'
import type { RonWritingTarget } from '@/lib/document-ron'
import type { Project } from '@/types/projects'
import { cn } from '@/lib/utils'
import { DocumentToolbar } from './DocumentToolbar'
import { DocumentIssueLinks } from './DocumentIssueLinks'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { instantiateTemplate, isSkillDocument, type DocumentTemplate } from '@/lib/document-templates'
import { TemplateGallery } from './TemplateGallery'
import { SkillPublishBar } from './SkillPublishBar'
import { PageTree } from '@/components/documents/PageTree'
import { LibraryPages, type NewPageTarget } from '@/components/documents/LibraryPages'
import { LibraryPageActions } from '@/components/documents/LibraryPageActions'

const AUTOSAVE_MS = 1000
// Workflow blocks, and the official Markdown extension (Ron writes Markdown; the page is read back as Markdown for context).
const DOCUMENT_EXTENSIONS = [WorkflowBlockExtension, Markdown]

/**
 * Which pages the workspace edits: one project's Docs (its project page), or the Documents library
 * (`ron://documents`: the user's personal pages and every project's pages).
 */
export type DocumentScope = { kind: 'project'; project: Project } | { kind: 'library' }

/**
 * The page open in the editor. `key` names this editing session (a draft keeps it once saved). `projectId` is the
 * page's project (null: a personal page); a draft is created there.
 */
interface OpenPage { key: string; id: string | null; projectId: string | null; parentId: string | null; title: string; content: string }
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

/** A project's Docs view (ProjectHomePage): the document workspace over that project's pages. */
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
  return (
    <DocumentWorkspace scope={{ kind: 'project', project }} startWithDraft={startWithDraft} onDraftStarted={onDraftStarted}
      openDocumentId={openDocumentId} onIssueSelect={onIssueSelect} />
  )
}

/**
 * Pages and the page editor (autosave with version checks, templates, Ask Ren, linked issues, publish as skill) for
 * one project's Docs or for the Documents library. The library adds My documents and a section per project, moving a
 * page into a project, and Create project with Ren; `onPageChange` lets its URL follow the open page.
 */
export function DocumentWorkspace({ scope, startWithDraft = false, onDraftStarted, openDocumentId, onIssueSelect, onPageChange, stacked = false }: {
  scope: DocumentScope
  /** Set by a New Document button outside the workspace: opens the template gallery for a new page. */
  startWithDraft?: boolean
  onDraftStarted?: () => void
  /** A deep link opens this page. */
  openDocumentId?: string
  /** Opens a linked issue (from any project). */
  onIssueSelect: (issueId: string) => void
  /** The open page changed: its id, or null for a draft that has none yet. */
  onPageChange?: (documentId: string | null) => void
  /** Little room (a narrow window, the agent panel open): the page list sits above the page instead of beside it. */
  stacked?: boolean
}) {
  const { userId, people, projects, refreshFromServer } = useProjectsStore()
  const request = useMemo(() => (userId ? projectsRequestFor(userId) : null), [userId])
  const library = scope.kind === 'library'
  const scopeProject = scope.kind === 'project' ? scope.project : null
  const scopeProjectId = scopeProject?.id ?? null
  /** The library's project sections and move targets: projects the user can access that are not archived, by name. */
  const libraryProjects = useMemo(() => projects.filter((project) => project.lifecycle !== 'archived')
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })), [projects])
  const archivedIds = useMemo(() => new Set(projects.filter((project) => project.lifecycle === 'archived').map((project) => project.id)), [projects])
  const projectOf = (id: string | null) => (!id ? null : scopeProject?.id === id ? scopeProject : projects.find((project) => project.id === id) ?? null)
  const [documents, setDocuments] = useState<ProjectDocumentSummary[]>([])
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [listError, setListError] = useState('')
  const [listSignedOut, setListSignedOut] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
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
  /** The template gallery: for a new page (at `target`), or to fill the empty page that is open. */
  const [gallery, setGallery] = useState<{ mode: 'new'; target: NewPageTarget } | { mode: 'apply' } | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  const pageRef = useRef<OpenPage | null>(null)
  const savedRef = useRef(new Map<string, SavedState>())
  const blockedRef = useRef(new Set<string>())
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const timerRef = useRef<number | null>(null)
  /** Bumped by every open and new page: an open that finishes after a newer one is dropped. */
  const loadRef = useRef(0)
  /** Bumped by every list load: only the newest one lands. */
  const listRef = useRef(0)
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
        : await createDocument(request, { projectId: snapshot.projectId, parentId: snapshot.parentId, title: snapshot.title, content: snapshot.content })
      savedRef.current.set(snapshot.key, { id: saved.id, version: saved.version, title: snapshot.title, content: snapshot.content })
      upsertSummary(saved)
      if (current()) {
        // Where the page lives comes from the server too (it may have been moved since it opened).
        setPage((open) => (open && open.key === snapshot.key ? { ...open, id: saved.id, projectId: saved.projectId, parentId: saved.parentId } : open))
        const open = pageRef.current!
        setStatus(open.title === snapshot.title && open.content === snapshot.content ? 'saved' : 'dirty')
        setSavedAt(Date.now())
        setMessage('')
      }
    } catch (error) {
      if (isConflict(error)) blockedRef.current.add(snapshot.key)
      if (current()) {
        setStatus(isConflict(error) ? 'conflict' : 'error')
        setMessage(documentErrorMessage(error, 'The page could not be saved.'))
      }
    }
  }, [request, upsertSummary])

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

  /** Saves pending edits of the open page; true when everything it holds is saved. */
  const flushOpenPage = useCallback(async () => {
    const open = pageRef.current
    if (!open) return false
    await queueSave(open)
    const saved = savedRef.current.get(open.key)
    const now = pageRef.current
    return !!saved?.id && !blockedRef.current.has(open.key) && !!now && saved.title === now.title && saved.content === now.content
  }, [queueSave])

  /** Runs `task` in the save queue: after the saves queued before it and before any queued after it. */
  const runExclusive = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queueRef.current.then(task)
    queueRef.current = run.then(() => undefined, () => undefined)
    return run
  }, [])

  /** Loads the page list: the project's pages, or (library) every page the user can access. */
  const loadList = useCallback(async (quiet = false) => {
    if (!request) return
    const token = (listRef.current += 1)
    if (!quiet) setListState('loading')
    try {
      const rows = scopeProjectId ? await listDocuments(request, scopeProjectId) : await listAllDocuments(request)
      if (listRef.current !== token) return
      setDocuments(rows); setListState('ready'); setListError(''); setListSignedOut(false)
    } catch (error) {
      if (listRef.current !== token) return
      setListState('error')
      setListSignedOut((error as { status?: number } | null)?.status === 401)
      setListError(`Pages could not be loaded. ${documentErrorMessage(error, '')}`.trim())
    }
  }, [request, scopeProjectId])

  // Load the page list for this scope and account.
  useEffect(() => {
    void loadList()
    return () => { listRef.current += 1 }
  }, [loadList])

  // Leaving the docs view saves what is pending.
  useEffect(() => () => { void queueSave() }, [queueSave])

  /** A new page at `target`, blank or with a template's title and content (saved at once so it exists there). */
  const startDraft = useCallback((target: NewPageTarget, initial: { title: string; content: string } = { title: '', content: '' }) => {
    void queueSave()
    loadRef.current += 1
    const key = nextKey()
    savedRef.current.set(key, { id: null, version: 0, title: '', content: '' })
    const next: OpenPage = { key, id: null, projectId: target.projectId, parentId: target.parentId, ...initial }
    pageRef.current = next
    setPage(next)
    setStatus('idle'); setMessage(''); setSavedAt(null)
    const parentId = target.parentId
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
      startDraft(gallery.target, { title, content })
      focusTitleIfOpen(title)
      return
    }
    const keepTitle = pageRef.current?.title.trim() ? pageRef.current.title : title
    edit({ title: keepTitle, content })
    focusTitleIfOpen(keepTitle)
  }

  const openDocument = useCallback(async (id: string) => {
    if (!request || pageRef.current?.id === id) return
    void queueSave()
    const token = (loadRef.current += 1)
    const key = nextKey()
    pageRef.current = null
    setPage(null); setStatus('loading'); setMessage('')
    try {
      const doc = await getDocument(request, id)
      if (loadRef.current !== token) return
      savedRef.current.set(key, { id: doc.id, version: doc.version, title: doc.title, content: doc.content })
      upsertSummary(doc)
      const next: OpenPage = { key, id: doc.id, projectId: doc.projectId, parentId: doc.parentId, title: doc.title, content: doc.content }
      pageRef.current = next
      setPage(next)
      setStatus('idle'); setSavedAt(doc.updatedAt)
    } catch (error) {
      if (loadRef.current !== token) return
      setStatus('error'); setMessage(documentErrorMessage(error, 'The page could not be opened.'))
    }
  }, [request, queueSave, upsertSummary])

  // A New Document button outside the workspace (the project header) opens the template gallery.
  useEffect(() => {
    if (startWithDraft && request) { setGallery({ mode: 'new', target: { parentId: null, projectId: scopeProjectId } }); onDraftStarted?.() }
  }, [startWithDraft, request, onDraftStarted, scopeProjectId])

  useEffect(() => {
    if (openDocumentId && request) void openDocument(openDocumentId)
  }, [openDocumentId, request, openDocument])

  /** The page a workspace opens by itself: the project's first page, or the library's most recently edited one. */
  const firstPage = (rows: ProjectDocumentSummary[]) => (library
    ? rows.filter((doc) => !doc.projectId || !archivedIds.has(doc.projectId))
      .reduce<ProjectDocumentSummary | undefined>((latest, doc) => (!latest || doc.updatedAt > latest.updatedAt ? doc : latest), undefined)
    : documentTree(rows)[0]?.document)

  // Otherwise open a page once the list arrives.
  useEffect(() => {
    if (listState !== 'ready' || pageRef.current || startWithDraft || openDocumentId || status !== 'idle') return
    const first = firstPage(documents)
    if (first) void openDocument(first.id)
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
      const key = page.key
      setPage((open) => (open && open.key === key ? { ...open, projectId: latest.projectId, parentId: latest.parentId } : open))
      await queueSave(pageRef.current)
    } catch (error) {
      setStatus('error'); setMessage(documentErrorMessage(error, 'The page could not be saved.'))
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
        // Nothing of the deleted page is saved on the way out.
        pageRef.current = null
        setPage(null); setStatus('idle'); setMessage('')
        const next = firstPage(remaining)
        if (next) void openDocument(next.id)
        else onPageChange?.(null)
      }
    } catch (error) {
      setMessage(documentErrorMessage(error, 'The page could not be deleted.'))
      setStatus('error')
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  /**
   * Add to project / Move to project (library): saves the page, then moves it with the pages under it. The move is
   * one more version of the page, which this session continues from unless the page changed elsewhere first.
   */
  const moveOpenPage = async (projectId: string) => {
    const open = pageRef.current
    if (!request || !open) return
    // The id comes from the save itself: the page state holding it may not have rendered yet.
    const id = await ensurePageId()
    if (!id || pageRef.current?.key !== open.key) throw new Error('The page could not be saved, so it was not moved.')
    if (!(await flushOpenPage())) throw new Error('Save the page first: it has changes that could not be saved.')
    const moved = await runExclusive(async () => {
      const result = await moveDocument(request, id, projectId)
      const saved = savedRef.current.get(open.key)
      if (saved?.id === id) {
        if (result.version === saved.version + 1) savedRef.current.set(open.key, { ...saved, version: result.version })
        else blockedRef.current.add(open.key)
      }
      return result
    })
    setDocuments((current) => withMovedDocument(current, id, projectId))
    upsertSummary(moved)
    setPage((current) => (current && current.key === open.key ? { ...current, projectId: moved.projectId, parentId: moved.parentId } : current))
    if (blockedRef.current.has(open.key) && pageRef.current?.key === open.key) {
      setStatus('conflict')
      setMessage('This page was changed somewhere else before it moved. Load their version, or keep yours.')
    }
  }

  /** Create project with Ren: saves the open page (a draft is created): its id and saved title, or null. */
  const savePage = async () => {
    const open = pageRef.current
    if (!open) return null
    const id = await ensurePageId()
    if (!id || pageRef.current?.key !== open.key || !(await flushOpenPage())) return null
    return { id, title: documentTitle(pageRef.current?.title ?? open.title) }
  }

  /** Open in project: the page in its project's Docs once it is saved (a blank draft: the project itself). */
  const openInProject = async () => {
    const open = pageRef.current
    if (!open?.projectId) return
    if (!open.id && !open.title.trim() && isBlank(open.content)) { openInternalUrl(`ron://project/${open.projectId}`); return }
    const id = await ensurePageId()
    if (!id || pageRef.current?.key !== open.key || !(await flushOpenPage())) return
    openInternalUrl(documentSource({ id, projectId: pageRef.current?.projectId ?? open.projectId }))
  }

  /**
   * Reload documents (library): the projects and the page list, and the open page when it changed elsewhere and holds
   * nothing unsaved here. A page Ren added to a new project keeps its text: this session continues in that project.
   */
  const refresh = async () => {
    if (!request || refreshing) return
    setRefreshing(true)
    try {
      void refreshFromServer()
      await loadList(true)
      const open = pageRef.current
      if (!open?.id) return
      const id = open.id
      await runExclusive(async () => {
        const saved = savedRef.current.get(open.key)
        if (!saved || saved.id !== id || blockedRef.current.has(open.key) || pageRef.current?.key !== open.key) return
        const latest = await getDocument(request, id)
        if (latest.version === saved.version || pageRef.current?.key !== open.key) return
        upsertSummary(latest)
        if (latest.title === documentTitle(saved.title) && latest.content === saved.content) {
          savedRef.current.set(open.key, { ...saved, version: latest.version })
          setPage((current) => (current && current.key === open.key ? { ...current, projectId: latest.projectId, parentId: latest.parentId } : current))
          return
        }
        const now = pageRef.current
        if (!now || now.title !== saved.title || now.content !== saved.content) return
        // Changed elsewhere, nothing unsaved here: show the page as it is now.
        loadRef.current += 1
        const key = nextKey()
        savedRef.current.set(key, { id: latest.id, version: latest.version, title: latest.title, content: latest.content })
        const next: OpenPage = { key, id: latest.id, projectId: latest.projectId, parentId: latest.parentId, title: latest.title, content: latest.content }
        pageRef.current = next
        setPage(next); setStatus('idle'); setMessage(''); setSavedAt(latest.updatedAt)
      })
    } catch (error) {
      setStatus('error'); setMessage(documentErrorMessage(error, 'The page could not be reloaded.'))
    } finally {
      setRefreshing(false)
    }
  }

  // The library's URL follows the open page (a draft has no id until it is saved).
  const openKey = page?.key ?? null
  const openId = page?.id ?? null
  useEffect(() => {
    if (openKey) onPageChange?.(openId)
  }, [openKey, openId, onPageChange])

  // Opening a page opens the branches above it (a deep link, a search result, a link from another page).
  const revealedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!openId || revealedRef.current === openId || !documents.some((doc) => doc.id === openId)) return
    revealedRef.current = openId
    const above = new Set(documentAncestors(documents, openId).map((doc) => doc.id))
    setCollapsed((current) => ([...current].some((id) => above.has(id)) ? new Set([...current].filter((id) => !above.has(id))) : current))
  }, [openId, documents])

  const toggleCollapsed = useCallback((id: string) => setCollapsed((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }), [])
  const openFromList = useCallback((id: string) => { void openDocument(id) }, [openDocument])
  const newPage = (target: NewPageTarget) => setGallery({ mode: 'new', target })

  const ancestors = page?.id ? documentAncestors(documents, page.id)
    : page?.parentId ? [...documentAncestors(documents, page.parentId), ...documents.filter((doc) => doc.id === page.parentId)] : []
  const openSummary = page?.id ? documents.find((doc) => doc.id === page.id) : undefined
  const author = openSummary?.createdBy ? people.find((person) => person.id === openSummary.createdBy)?.name : undefined
  const deleteCount = confirmDelete ? documentSubtree(documents, confirmDelete.id).length - 1 : 0
  const pageProject = page ? projectOf(page.projectId) : null
  const pageIsBlank = !!page && !page.title.trim() && isBlank(page.content)
  /** What Ask Ren is writing: the page in its project, or a personal page. */
  const writingTarget = (): RonWritingTarget => {
    const open = pageRef.current
    const title = open?.title ?? ''
    const owner = projectOf(open?.projectId ?? null)
    if (owner) return { kind: 'page', title, projectName: owner.name, projectKey: owner.key }
    return open?.projectId
      ? { kind: 'page', title, projectName: 'Documents', projectKey: 'shared', facts: 'This page is in one of the user’s projects.' }
      : { kind: 'page', title, projectName: 'My documents', projectKey: 'private',
        facts: 'This is a personal page in the user’s Documents library: it is in no project and only they can see it.' }
  }

  if (!request) return null

  return (
    <div className={cn('flex gap-0 rounded-3xl glass-card border border-white/10 shadow-soft', stacked ? 'flex-col' : 'min-h-[760px]')}>
      {library ? (
        <aside aria-label="Document library" className={cn('flex shrink-0 flex-col border-surface-200/70 p-4 dark:border-surface-700/70',
          stacked ? 'max-h-[420px] border-b' : 'w-80 border-r')}>
          <LibraryPages documents={documents} projects={libraryProjects} listState={listState} listError={listError} signedOut={listSignedOut}
            onRetry={() => void loadList()} refreshing={refreshing} onRefresh={() => void refresh()} page={page} collapsed={collapsed}
            onToggle={toggleCollapsed} onOpen={openFromList} onNewPage={newPage} />
        </aside>
      ) : (
        <aside aria-label="Pages" className="flex w-72 shrink-0 flex-col border-r border-surface-200/70 p-4 dark:border-surface-700/70">
          <div className="mb-3 flex items-center justify-between px-1">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted dark:text-ink-inverse-muted">{scopeProject?.key} space</p>
              <h3 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">Pages</h3>
            </div>
            <Button type="button" size="icon-sm" variant="ghost" className="rounded-full" title="New page" aria-label="New page"
              onClick={() => newPage({ parentId: null, projectId: scopeProjectId })}>
              <Plus />
            </Button>
          </div>
          <nav aria-label="Page tree" aria-busy={listState === 'loading'} className="-mx-1 flex-1 overflow-y-auto">
            {listState === 'loading' && <p className="flex items-center gap-2 px-3 py-2 text-body-xs text-ink-muted dark:text-ink-inverse-muted"><Loader2 className="size-3.5 animate-spin" />Loading pages…</p>}
            {listState === 'error' && (
              <div role="alert" className="px-3 py-2 text-body-xs text-danger">
                <p>{listError}</p>
                <button type="button" className="mt-1 font-medium underline-offset-2 hover:underline" onClick={() => void loadList()}>Try again</button>
              </div>
            )}
            {listState === 'ready' && documents.length === 0 && !page && <p className="px-3 py-2 text-body-xs text-ink-muted dark:text-ink-inverse-muted">No pages yet.</p>}
            <PageTree documents={documents} page={page} showDraft collapsed={collapsed} onToggle={toggleCollapsed} onOpen={openFromList}
              onAddChild={(parent) => newPage({ parentId: parent.id, projectId: parent.projectId })} />
          </nav>
        </aside>
      )}

      {/* Page */}
      <section aria-label="Page" className="min-w-0 flex-1">
        {page ? (
          <div className={cn('mx-auto max-w-[860px] pb-16 pt-6', stacked ? 'px-4' : 'px-8')}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-body-xs text-ink-muted dark:text-ink-inverse-muted">
                {!page.projectId && <Lock aria-hidden className="size-3 shrink-0" />}
                <span className="max-w-[220px] truncate">{page.projectId ? pageProject?.name ?? 'Project' : 'My documents'}</span>
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
                      kind: 'document', title: pageProject ? `${pageProject.key} · ${page.title || UNTITLED}` : page.title || UNTITLED,
                      text: editor.getMarkdown(), url: page.id ? documentSource({ id: page.id, projectId: page.projectId }) : '',
                    })}>
                    + Context
                  </Button>
                )}
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 rounded-full"
                  disabled={status === 'saving' || status === 'conflict' || (!page.id && pageIsBlank)}
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

            {library && (
              <LibraryPageActions key={page.key} page={page} project={pageProject} subpages={page.id ? documentSubtree(documents, page.id).length - 1 : 0}
                projects={libraryProjects.filter((candidate) => candidate.id !== page.projectId)} blank={pageIsBlank}
                disabled={status === 'conflict'} onMove={moveOpenPage} onOpenInProject={() => void openInProject()} savePage={savePage} />
            )}

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
                ? <>Created{author ? ` by ${author}` : ''} · Updated {relativeTime(openSummary.updatedAt)}{!page.projectId && ' · Only you can see it'}</>
                : !page.projectId ? 'Draft · saved to My documents as soon as you start writing. Only you can see it.'
                  : library ? `Draft · saved to ${pageProject?.name ?? 'its project'} as soon as you start writing`
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
                  target={writingTarget} />
              </div>
            )}

            <div className="mt-2">
              <NotionEditor key={page.key} canonical content={page.content} extensions={DOCUMENT_EXTENSIONS} onAskRon={openRon}
                onEditor={setEditor} onChange={(content) => edit({ content })} onSave={() => void queueSave()}
                placeholder="Write, or type / for headings, tables, a workflow, Ask Ren…"
                editorClassName="prose prose-base dark:prose-invert max-w-none focus:outline-none min-h-[420px] px-1 py-6" />
            </div>
          </div>
        ) : status === 'loading' || (listState === 'loading' && status !== 'error') ? (
          <div role="status" className={cn('flex h-full items-center justify-center gap-2 text-body-sm text-ink-muted dark:text-ink-inverse-muted', stacked ? 'min-h-[240px]' : 'min-h-[480px]')}>
            <Loader2 className="size-4 animate-spin" />{status === 'loading' ? 'Opening page…' : 'Loading pages…'}
          </div>
        ) : (
          <div className={cn('flex h-full items-center justify-center p-10', stacked ? 'min-h-[320px]' : 'min-h-[560px]')}>
            <div className="max-w-sm text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent/10 text-accent dark:bg-accent-light/10 dark:text-accent-light"><FileText className="size-5" /></div>
              <h3 className="mt-4 font-display text-xl text-ink dark:text-ink-inverse">
                {status === 'error' ? 'This page could not be opened' : library ? 'Your documents' : 'Write it down'}
              </h3>
              <p className="mt-2 text-body-sm text-ink-muted dark:text-ink-inverse-muted">
                {status === 'error' ? message
                  : library ? 'Write in My documents, where only you can see a page, then add it to a project when it’s ready, or have Ren build a project from it.'
                    : 'Specs, decisions, meeting notes and runbooks live beside this project’s issues. Add a workflow to show how the work flows.'}
              </p>
              <Button type="button" className="mt-5 gap-2 rounded-full" onClick={() => newPage({ parentId: null, projectId: scopeProjectId })}>
                <FilePlus />{library ? 'New document' : 'New Document'}
              </Button>
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
