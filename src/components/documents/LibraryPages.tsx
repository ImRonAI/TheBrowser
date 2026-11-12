import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, FilePlus, FolderOpen, Loader2, Lock, Plus, RefreshCw, Search, SearchX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useProjectsStore } from '@/stores/projectsStore'
import { searchDocuments, type ProjectDocumentSummary } from '@/lib/project-documents'
import { openInternalUrl } from '@/components/board/task-detail/editor/extensions/blocks/workspace'
import { openSignIn } from '@/lib/sign-in'
import type { Project } from '@/types/projects'
import { cn } from '@/lib/utils'
import { PageTree, type TreePage } from './PageTree'

/** Where a new page goes: under `parentId`, in `projectId` (null: My documents). */
export interface NewPageTarget { parentId: string | null; projectId: string | null }

/** The section id of My documents (project sections use the project id). */
const PERSONAL = 'personal'

interface Section { id: string; projectId: string | null; label: string; projectKey: string; documents: ProjectDocumentSummary[] }

const plural = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`

/**
 * The Documents library's left pane: search, New document (a personal page), My documents, then one collapsible
 * section per project with its page tree. The section holding the open page opens by itself; a section the user has
 * not touched starts open when it has pages.
 */
export function LibraryPages({ documents, projects, listState, listError, signedOut, onRetry, refreshing, onRefresh, page, collapsed, onToggle, onOpen, onNewPage }: {
  documents: ProjectDocumentSummary[]
  /** The project sections, in order: projects the user can access that are not archived. */
  projects: Project[]
  listState: 'loading' | 'ready' | 'error'
  listError: string
  /** The list failed because the sign-in is gone: offer Sign in beside Try again. */
  signedOut: boolean
  onRetry: () => void
  refreshing: boolean
  onRefresh: () => void
  page: TreePage | null
  collapsed: ReadonlySet<string>
  onToggle: (id: string) => void
  onOpen: (id: string) => void
  onNewPage: (target: NewPageTarget) => void
}) {
  const { userId, isInitialized, isLoading, error: projectsError, refreshFromServer } = useProjectsStore()
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  const search = useMemo(() => (query.trim() ? searchDocuments(documents, query) : null), [documents, query])

  const sections = useMemo<Section[]>(() => [
    { id: PERSONAL, projectId: null, label: 'My documents', projectKey: '', documents: documents.filter((doc) => !doc.projectId) },
    ...projects.map((project) => ({
      id: project.id, projectId: project.id, label: project.name, projectKey: project.key,
      documents: documents.filter((doc) => doc.projectId === project.id),
    })),
  ], [documents, projects])

  // The open page's section opens (a deep link, a draft started there, a page just moved there).
  const activeSection = page ? page.projectId ?? PERSONAL : null
  useEffect(() => {
    if (activeSection) setOpened((current) => (current[activeSection] ? current : { ...current, [activeSection]: true }))
  }, [activeSection])

  const isOpen = (section: Section) => opened[section.id] ?? (section.id === PERSONAL || section.documents.length > 0)
  const toggleSection = (section: Section) => setOpened((current) => ({ ...current, [section.id]: !isOpen(section) }))
  const hasDraftIn = (section: Section) => !!page && !page.id && (page.projectId ?? PERSONAL) === section.id

  const tree = (section: Section, documentsShown: ProjectDocumentSummary[]) => (
    <PageTree documents={documentsShown} page={page} showDraft={!search && hasDraftIn(section)} collapsed={collapsed} onToggle={onToggle}
      onOpen={onOpen} onAddChild={(parent) => onNewPage({ parentId: parent.id, projectId: parent.projectId })} matches={search?.matches} />
  )

  const sectionBlock = (section: Section) => {
    const open = isOpen(section)
    const bodyId = `documents-section-${section.id}`
    const count = section.documents.length
    return (
      <section key={section.id} aria-label={section.label} className="mt-1">
        <div className="group/section flex items-center gap-0.5 pr-1">
          <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => toggleSection(section)}
            aria-label={`${section.label}${section.projectKey ? ` (${section.projectKey})` : ''}, ${plural(count, 'page')}`}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left text-ink transition-colors hover:bg-surface-100 dark:text-ink-inverse dark:hover:bg-surface-800">
            <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-ink-muted transition-transform duration-150 dark:text-ink-inverse-muted', open && 'rotate-90')} />
            {section.id === PERSONAL && <Lock aria-hidden className="size-3.5 shrink-0 text-ink-muted dark:text-ink-inverse-muted" />}
            <span className="truncate text-[13px] font-semibold">{section.label}</span>
            {section.projectKey && <span className="shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted">{section.projectKey}</span>}
            <span aria-hidden className="ml-auto shrink-0 pl-2 text-[11px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">{count}</span>
          </button>
          <button type="button" aria-label={`New page in ${section.label}`} title={`New page in ${section.label}`}
            onClick={() => onNewPage({ parentId: null, projectId: section.projectId })}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted opacity-0 transition-opacity hover:bg-surface-200/60 focus:opacity-100 group-hover/section:opacity-100 dark:text-ink-inverse-muted dark:hover:bg-surface-700/60">
            <Plus className="size-3.5" />
          </button>
        </div>
        {open && (
          <div id={bodyId} className="pb-1">
            {count > 0 || hasDraftIn(section) ? tree(section, section.documents) : (
              <p className="py-1.5 pl-7 pr-2 text-body-xs text-ink-muted dark:text-ink-inverse-muted">
                {section.id === PERSONAL ? 'Pages only you can see. Start one with New document.' : 'No pages yet.'}
              </p>
            )}
          </div>
        )}
      </section>
    )
  }

  const projectsNote = (() => {
    if (!userId || (!isInitialized && isLoading)) {
      return <p className="flex items-center gap-2 px-2 py-1.5 text-body-xs text-ink-muted dark:text-ink-inverse-muted"><Loader2 className="size-3.5 animate-spin" />Loading projects…</p>
    }
    if (!isInitialized && projectsError) {
      return (
        <div role="alert" className="px-2 py-1.5 text-body-xs text-danger">
          <p>Projects could not be loaded. {projectsError}</p>
          <button type="button" className="mt-1 font-medium underline-offset-2 hover:underline" onClick={() => void refreshFromServer()}>Try again</button>
        </div>
      )
    }
    if (projects.length === 0) {
      return (
        <div className="px-2 py-1.5 text-body-xs text-ink-muted dark:text-ink-inverse-muted">
          <p>No projects yet. Add a page to a project, or ask Ren to create one from it.</p>
          <button type="button" className="mt-1 inline-flex items-center gap-1 font-medium text-ink underline-offset-2 hover:underline dark:text-ink-inverse"
            onClick={() => openInternalUrl('ron://projects')}><FolderOpen className="size-3.5" />Open Projects</button>
        </div>
      )
    }
    return null
  })()

  const results = (() => {
    if (!search) return null
    const found = sections
      .map((section) => ({ section, shown: search.shown.filter((doc) => (doc.projectId ?? PERSONAL) === section.id) }))
      .filter((entry) => entry.shown.length > 0)
    if (found.length === 0) {
      return (
        <div className="flex flex-col items-center px-4 py-8 text-center">
          <SearchX aria-hidden className="size-5 text-ink-muted dark:text-ink-inverse-muted" />
          <p className="mt-2 text-body-sm text-ink dark:text-ink-inverse">No pages match “{query.trim()}”</p>
          <button type="button" className="mt-1 text-body-xs font-medium text-ink-secondary underline-offset-2 hover:underline dark:text-ink-inverse-secondary" onClick={() => setQuery('')}>Clear search</button>
        </div>
      )
    }
    return found.map(({ section, shown }) => (
      <section key={section.id} aria-label={`${section.label} results`} className="mt-1">
        <p className="flex items-center gap-1.5 px-2 py-1.5 text-[12px] font-semibold text-ink dark:text-ink-inverse">
          {section.id === PERSONAL && <Lock aria-hidden className="size-3.5 text-ink-muted dark:text-ink-inverse-muted" />}
          <span className="truncate">{section.label}</span>
          {section.projectKey && <span className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted">{section.projectKey}</span>}
        </p>
        {tree(section, shown)}
      </section>
    ))
  })()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 pb-3">
        <label className="ron-field relative flex h-9 items-center rounded-xl border border-surface-200 bg-surface-0 transition-colors focus-within:border-blurple-400 focus-within:ring-2 focus-within:ring-blurple-500/20 dark:border-surface-800 dark:bg-surface-850 dark:focus-within:border-blurple-500">
          <span className="sr-only">Search documents</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 size-4 text-ink-muted dark:text-ink-inverse-muted" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pages" autoComplete="off" spellCheck={false} enterKeyHint="search"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              if (query) setQuery('')
              else event.currentTarget.blur()
            }}
            className="h-full w-full min-w-0 appearance-none bg-transparent pl-9 pr-8 text-[13px] text-ink placeholder:text-ink-muted focus:outline-none dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted [&::-webkit-search-cancel-button]:hidden" />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')}
              className="absolute right-1.5 flex size-6 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-ink/[0.06] hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-white/[0.08] dark:hover:text-ink-inverse">
              <X className="size-3.5" />
            </button>
          )}
        </label>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" className="h-9 flex-1 justify-start gap-2 rounded-xl" onClick={() => onNewPage({ parentId: null, projectId: null })}>
            <FilePlus />New document
          </Button>
          <Button type="button" variant="ghost" size="icon" className="rounded-xl text-ink-muted dark:text-ink-inverse-muted" aria-label="Reload documents" title="Reload documents"
            disabled={refreshing || listState === 'loading'} onClick={onRefresh}>
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
          </Button>
        </div>
      </div>

      <nav aria-label="Pages" aria-busy={listState === 'loading'} className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {search && listState === 'ready' && (
          <p role="status" className="px-2 pb-1 text-body-xs text-ink-muted dark:text-ink-inverse-muted">{plural(search.matches.size, 'page')} found</p>
        )}
        {listState === 'loading' && (
          <p className="flex items-center gap-2 px-2 py-2 text-body-xs text-ink-muted dark:text-ink-inverse-muted"><Loader2 className="size-3.5 animate-spin" />Loading documents…</p>
        )}
        {listState === 'error' && (
          <div role="alert" className="mx-1 rounded-xl bg-danger/10 px-3 py-2.5 text-body-xs text-danger">
            <p>{listError}</p>
            <div className="mt-1.5 flex gap-3 font-medium">
              <button type="button" className="underline-offset-2 hover:underline" onClick={onRetry}>Try again</button>
              {signedOut && <button type="button" className="underline-offset-2 hover:underline" onClick={() => openSignIn()}>Sign in</button>}
            </div>
          </div>
        )}
        {listState === 'ready' && (search ? results : (
          <>
            {sectionBlock(sections[0])}
            <p className="px-2 pb-1 pt-4 font-mono text-[11px] font-medium uppercase leading-none tracking-[0.08em] text-ink-secondary dark:text-ink-inverse-muted">Projects</p>
            {projectsNote}
            {sections.slice(1).map(sectionBlock)}
          </>
        ))}
      </nav>
    </div>
  )
}
