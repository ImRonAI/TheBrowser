import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { ArrowUpRight, FolderPlus, Grid2x2, List, Loader2, Plus, RefreshCw, Search, SearchX, Users, X } from 'lucide-react'
import { useProjectsStore } from '@/stores/projectsStore'
import { PROJECT_TYPE_SCHEMES, type Project } from '@/types/projects'
import { ProjectTypeIcon } from '@/components/projects/badges'
import { CreateProjectDialog } from '@/components/projects/dialogs'
import { PageBackground } from '@/components/shared/PageBackground'
import { Button } from '@/components/ui/button'
import { useElementWidth } from '@/hooks/useElementWidth'
import { openInternalUrl } from '@/components/board/task-detail/editor/extensions/blocks/workspace'
import { isGuestUserId, openSignIn } from '@/lib/sign-in'
import { isSharedProject } from '@/lib/project-members'
import {
  LIFECYCLE_FILTERS, LIFECYCLE_LABEL, inLifecycle, isLifecycleFilter, lifecycleCounts, matchesProjectQuery,
  sortByActivity, summarizeProjects, updatedLabel, type LifecycleFilter, type ProjectSummary,
} from '@/lib/project-index'
import { cn } from '@/utils/cn'

type View = 'grid' | 'list'
type Opener = (project: Project, background: boolean) => void

const PREFS_KEY = 'ron-projects-index-v1'

function readPrefs(): { view: View; filter: LifecycleFilter } {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}') as { view?: unknown; filter?: unknown }
    return { view: saved.view === 'list' ? 'list' : 'grid', filter: isLifecycleFilter(saved.filter) ? saved.filter : 'open' }
  } catch {
    return { view: 'grid', filter: 'open' }
  }
}

function writePrefs(prefs: { view: View; filter: LifecycleFilter }) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* storage unavailable (private window): the choice lasts for this visit */
  }
}

/** Wall-clock time for "updated" labels and overdue counts, refreshed every minute. */
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** A project opens in this tab; ⌘/Ctrl-click or a middle click opens it in a background tab. */
const openProject: Opener = (project, background) => {
  const url = `ron://project/${project.id}`
  const electron = window.electron
  if (background && electron?.tabs?.create) {
    void electron.tabs.create(url)
    return
  }
  openInternalUrl(url)
}

/**
 * Projects (`ron://projects`): every project the user can see as a card (or a row), with the same
 * open / blocked / overdue numbers the boards show (src/lib/project-index.ts), a lifecycle filter,
 * search, and real loading, empty, no-match and error states.
 */
export function ProjectsIndexPage() {
  const {
    projects, issues, issueLinks, userId, isInitialized, isLoading, pendingSaves, error, initialize, refreshFromServer,
  } = useProjectsStore()
  const now = useNow()
  const [prefs, setPrefs] = useState(readPrefs)
  const [showCreate, setShowCreate] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const width = useElementWidth(contentRef)

  useEffect(() => {
    if (userId) void initialize()
  }, [userId, initialize])

  const updatePrefs = (next: Partial<{ view: View; filter: LifecycleFilter }>) => {
    setPrefs((current) => {
      const merged = { ...current, ...next }
      writePrefs(merged)
      return merged
    })
  }

  // "/" jumps to search, like the rest of the web, unless the user is typing somewhere or the page is hidden.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      if (!rootRef.current?.getClientRects().length) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const summaries = useMemo(
    () => sortByActivity(summarizeProjects(projects, issues, issueLinks, now)),
    [projects, issues, issueLinks, now],
  )
  const counts = useMemo(() => lifecycleCounts(projects), [projects])
  const query = searchQuery.trim()
  const inFilter = useMemo(() => summaries.filter((summary) => inLifecycle(summary.project, prefs.filter)), [summaries, prefs.filter])
  const visible = useMemo(() => inFilter.filter((summary) => matchesProjectQuery(summary.project, query)), [inFilter, query])
  const matchesElsewhere = useMemo(
    () => (query ? summaries.filter((s) => !inLifecycle(s.project, prefs.filter) && matchesProjectQuery(s.project, query)).length : 0),
    [summaries, prefs.filter, query],
  )
  const totals = useMemo(() => visible.reduce(
    (sum, s) => ({ open: sum.open + s.open, blocked: sum.blocked + s.blocked, overdue: sum.overdue + s.overdue }),
    { open: 0, blocked: 0, overdue: 0 },
  ), [visible])

  const phase = !userId ? (error ? 'failed' : 'opening') : !isInitialized ? (error && !isLoading ? 'failed' : 'loading') : 'ready'
  const guest = Boolean(userId && isGuestUserId(userId))
  const wide = width >= 760
  // One toolbar row needs the filter (~400px), the search (288px) and the layout toggle; below that they stack.
  const roomy = width === 0 || width >= 790
  const filterLabel = LIFECYCLE_FILTERS.find((f) => f.id === prefs.filter)?.label.toLowerCase() ?? ''

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    if (searchQuery) setSearchQuery('')
    else event.currentTarget.blur()
  }

  const content: ReactNode = (() => {
    if (phase === 'opening' || phase === 'loading') {
      return <LoadingProjects view={prefs.view} label={phase === 'opening' ? 'Opening your workspace…' : 'Loading your projects…'} />
    }
    if (phase === 'failed') {
      return (
        <StatePanel title="Couldn’t load your projects" detail={error ?? undefined} tone="error">
          {userId && <Button type="button" className="rounded-xl" onClick={() => void refreshFromServer()}><RefreshCw />Try again</Button>}
        </StatePanel>
      )
    }
    if (projects.length === 0) {
      return (
        <StatePanel
          icon={<FolderPlus className="h-6 w-6" />}
          title="Start your first project"
          detail="Projects hold your issues, boards and docs. Ren can plan, track and work on them with you."
        >
          <Button type="button" className="rounded-xl" onClick={() => setShowCreate(true)}><Plus />New project</Button>
        </StatePanel>
      )
    }
    if (visible.length === 0 && query) {
      return (
        <StatePanel
          icon={<SearchX className="h-6 w-6" />}
          title={`No ${prefs.filter === 'all' ? '' : `${filterLabel} `}projects match “${query}”`}
          detail={matchesElsewhere > 0 ? `${plural(matchesElsewhere, 'match', 'matches')} in your other projects.` : 'Try a project name, key or a word from its summary.'}
        >
          {matchesElsewhere > 0 && (
            <Button type="button" className="rounded-xl" onClick={() => updatePrefs({ filter: 'all' })}>Search all projects</Button>
          )}
          <Button type="button" variant="outline" className="rounded-xl" onClick={() => { setSearchQuery(''); searchRef.current?.focus() }}>Clear search</Button>
        </StatePanel>
      )
    }
    if (visible.length === 0) {
      return (
        <StatePanel
          title={`No ${filterLabel} projects`}
          detail={prefs.filter === 'open' ? 'Everything here is completed or archived. Start something new, or look back at past work.' : undefined}
        >
          {prefs.filter === 'open' && <Button type="button" className="rounded-xl" onClick={() => setShowCreate(true)}><Plus />New project</Button>}
          <Button type="button" variant="outline" className="rounded-xl" onClick={() => updatePrefs({ filter: 'all' })}>Show all projects</Button>
        </StatePanel>
      )
    }
    return prefs.view === 'grid' ? (
      <ul aria-label="Projects" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17.5rem),1fr))] gap-4 sm:gap-5">
        {visible.map((summary) => (
          <li key={summary.project.id} className="flex min-w-0">
            <ProjectCard summary={summary} now={now} shared={isSharedProject(summary.project, userId)} onOpen={openProject} />
          </li>
        ))}
      </ul>
    ) : (
      <div className={cn(SURFACE, 'overflow-hidden')}>
        {wide && (
          <div aria-hidden className="flex items-center gap-4 border-b border-surface-200 px-5 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-muted dark:border-surface-800 dark:text-ink-inverse-muted">
            <span className="flex-1 pl-12">Project</span>
            <span className="w-40">Progress</span>
            <span className="w-14 text-right">Open</span>
            <span className="w-14 text-right">Blocked</span>
            <span className="w-14 text-right">Overdue</span>
            <span className="w-28 text-right">Updated</span>
            <span className="w-4" />
          </div>
        )}
        <ul aria-label="Projects" className="divide-y divide-surface-200 dark:divide-surface-800">
          {visible.map((summary) => (
            <ProjectRow key={summary.project.id} summary={summary} now={now} wide={wide} shared={isSharedProject(summary.project, userId)} onOpen={openProject} />
          ))}
        </ul>
      </div>
    )
  })()

  return (
    <div ref={rootRef} className="relative isolate min-h-full bg-surface-50 dark:bg-surface-900">
      <PageBackground />
      <div ref={contentRef} className="relative mx-auto w-full max-w-[1360px] px-4 pb-16 pt-8 sm:px-6 sm:pt-10 lg:px-10 lg:pt-12">
        <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0">
            <span className="tag-label tag-label-slash">{guest ? 'Guest workspace' : 'Workspace'}</span>
            <h1 className="ren-display mt-3 text-[44px] text-ink dark:text-ink-inverse sm:text-[56px]">
              Projects<span className="text-volt">.</span>
            </h1>
            <p className="mt-3 text-[14px] leading-6 text-ink-secondary dark:text-ink-inverse-secondary" aria-live="polite">
              {phase === 'ready' && projects.length > 0 ? (
                <>
                  <Strong>{plural(visible.length, 'project')}</Strong>
                  {query && ` of ${inFilter.length}`}
                  <Dot /><Strong>{totals.open}</Strong> open {totals.open === 1 ? 'issue' : 'issues'}
                  <Dot /><Strong className={totals.blocked > 0 ? 'text-rose-600 dark:text-rose-400' : undefined}>{totals.blocked}</Strong> blocked
                  <Dot /><Strong className={totals.overdue > 0 ? 'text-danger dark:text-danger' : undefined}>{totals.overdue}</Strong> overdue
                </>
              ) : 'Issues, boards and docs, organized by what you’re working on.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SyncState pendingSaves={pendingSaves} refreshing={isLoading && isInitialized} />
            {userId && (
              <button
                type="button"
                onClick={() => void refreshFromServer()}
                disabled={isLoading || pendingSaves > 0}
                aria-label="Reload projects from the server"
                title="Reload from server"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-muted transition-colors hover:bg-ink/[0.05] hover:text-ink disabled:opacity-40 dark:text-ink-inverse-muted dark:hover:bg-white/[0.06] dark:hover:text-ink-inverse"
              >
                <RefreshCw className={cn('h-4 w-4', isLoading && isInitialized && 'animate-spin')} />
              </button>
            )}
            <Button type="button" className="rounded-xl" onClick={() => setShowCreate(true)} disabled={!userId}>
              <Plus />New project
            </Button>
          </div>
        </header>

        {guest && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-100 px-4 py-2.5 text-[13px] text-ink-secondary dark:bg-surface-800 dark:text-ink-inverse-secondary">
            <span>You’re in a private guest workspace on this device. Sign in to work with your account’s projects.</span>
            <button type="button" onClick={() => openSignIn()} className="font-medium text-ink underline-offset-2 hover:underline dark:text-ink-inverse">Sign in</button>
          </div>
        )}
        {phase === 'ready' && error && (
          <div role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-danger/10 px-4 py-2.5 text-[13px] text-danger">
            <span className="min-w-0">{error}</span>
            <button type="button" onClick={() => void refreshFromServer()} disabled={isLoading} className="font-medium underline-offset-2 hover:underline disabled:opacity-50">Try again</button>
          </div>
        )}

        <div className={cn('mt-8 flex gap-3', roomy ? 'items-center justify-between' : 'flex-col items-stretch')}>
          <div role="group" aria-label="Show projects" className={cn(SEGMENTED, !roomy && 'max-w-full self-start overflow-x-auto')}>
            {LIFECYCLE_FILTERS.map(({ id, label }) => {
              const active = prefs.filter === id
              return (
                <button key={id} type="button" aria-pressed={active} onClick={() => updatePrefs({ filter: id })} className={cn(SEGMENT, 'px-3', active ? SEGMENT_ON : SEGMENT_OFF)}>
                  {label}
                  <span className={cn('tabular-nums text-[11px]', active ? 'text-ink-muted dark:text-ink-inverse-muted' : 'text-ink-muted/70 dark:text-ink-inverse-muted/70')}>
                    {counts[id]}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <label className={cn('relative flex h-9 min-w-0 items-center', roomy ? 'w-72' : 'flex-1')}>
              <span className="sr-only">Search projects</span>
              <Search aria-hidden className="pointer-events-none absolute left-3 h-4 w-4 text-ink-muted dark:text-ink-inverse-muted" />
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={onSearchKey}
                placeholder="Search by name, key or summary"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="search"
                className="h-9 w-full min-w-0 rounded-xl border border-surface-200 bg-surface-0 pl-9 pr-9 text-[13px] text-ink transition-colors placeholder:text-ink-muted focus:border-blurple-400 focus:outline-none focus:ring-2 focus:ring-blurple-500/20 dark:border-surface-800 dark:bg-surface-850 dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted dark:focus:border-blurple-500"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); searchRef.current?.focus() }}
                  aria-label="Clear search"
                  className="absolute right-1.5 flex h-6 w-6 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-ink/[0.06] hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-white/[0.08] dark:hover:text-ink-inverse"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <kbd aria-hidden className="kbd pointer-events-none absolute right-2.5">/</kbd>
              )}
            </label>
            <div role="group" aria-label="Layout" className={SEGMENTED}>
              <button type="button" aria-pressed={prefs.view === 'grid'} aria-label="Grid view" title="Grid view" onClick={() => updatePrefs({ view: 'grid' })}
                className={cn(SEGMENT, 'w-8 justify-center', prefs.view === 'grid' ? SEGMENT_ON : SEGMENT_OFF)}>
                <Grid2x2 className="h-4 w-4" />
              </button>
              <button type="button" aria-pressed={prefs.view === 'list'} aria-label="List view" title="List view" onClick={() => updatePrefs({ view: 'list' })}
                className={cn(SEGMENT, 'w-8 justify-center', prefs.view === 'list' ? SEGMENT_ON : SEGMENT_OFF)}>
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6">{content}</div>

        <CreateProjectDialog isOpen={showCreate} onClose={() => setShowCreate(false)} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------ */

const SURFACE = 'rounded-2xl border border-surface-200 bg-surface-0 shadow-soft dark:border-surface-800 dark:bg-surface-850'
const SEGMENTED = 'inline-flex h-9 shrink-0 items-center gap-0.5 rounded-xl bg-surface-100 p-1 dark:bg-surface-800'
const SEGMENT = 'flex h-7 items-center gap-1.5 rounded-[9px] text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple-500/50'
const SEGMENT_ON = 'bg-surface-0 text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)] dark:bg-surface-850 dark:text-ink-inverse dark:shadow-[0_1px_2px_rgb(0_0_0/0.6)]'
const SEGMENT_OFF = 'text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse'

/** Card click target: a real button stretched over the card, so the name is the accessible name. */
const STRETCHED = "text-left outline-none after:absolute after:inset-0 after:content-['']"

function clickHandlers(project: Project, onOpen: Opener) {
  return {
    onClick: (event: MouseEvent) => onOpen(project, event.metaKey || event.ctrlKey),
    onAuxClick: (event: MouseEvent) => {
      if (event.button !== 1) return
      event.preventDefault()
      onOpen(project, true)
    },
    // A middle press would otherwise start Chromium's autoscroll.
    onMouseDown: (event: MouseEvent) => { if (event.button === 1) event.preventDefault() },
  }
}

function ProjectCard({ summary, now, shared, onOpen }: { summary: ProjectSummary; now: number; shared: boolean; onOpen: Opener }) {
  const { project } = summary
  const nameId = `project-card-${project.id}`
  const typeLabel = PROJECT_TYPE_SCHEMES[project.type]?.label ?? project.type
  const description = project.summary?.trim()
  return (
    <article
      aria-labelledby={nameId}
      className={cn(
        SURFACE,
        'group relative flex w-full min-w-0 flex-col p-5 transition-[border-color,box-shadow,transform,opacity] duration-200',
        'hover:border-blurple-600/30 hover:shadow-[0_22px_44px_-26px_rgb(11_12_23/0.38)] motion-safe:hover:-translate-y-0.5',
        'dark:hover:border-blurple-400/30 dark:hover:shadow-[0_22px_44px_-22px_rgb(0_0_0/0.9)]',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blurple-600/50 dark:has-[:focus-visible]:ring-blurple-400/50',
        project.lifecycle === 'archived' && 'opacity-70 hover:opacity-100 has-[:focus-visible]:opacity-100',
      )}
    >
      <div className="flex items-start gap-3">
        <TypeTile project={project} />
        <div className="min-w-0 flex-1 pt-0.5">
          <span className="block truncate font-mono text-[10.5px] font-medium uppercase leading-4 tracking-[0.12em] text-ink-muted dark:text-ink-inverse-muted">
            {project.key}<span aria-hidden className="mx-1.5 text-surface-300 dark:text-surface-700">/</span>{typeLabel}
          </span>
          <h3 id={nameId} className="mt-1 line-clamp-2 font-display text-[18px] font-bold leading-6 tracking-[-0.015em] text-ink dark:text-ink-inverse">
            <button type="button" className={cn(STRETCHED, 'after:rounded-2xl')} {...clickHandlers(project, onOpen)}>{project.name}</button>
          </h3>
        </div>
        {(shared || project.lifecycle !== 'active') && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            {project.lifecycle !== 'active' && <LifecycleChip lifecycle={project.lifecycle} />}
            {shared && <SharedChip />}
          </div>
        )}
      </div>

      <span className={cn('mt-3 line-clamp-2 min-h-10 text-[13px] leading-5', description ? 'text-ink-secondary dark:text-ink-inverse-secondary' : 'text-ink-muted dark:text-ink-inverse-muted')}>
        {description || 'No summary yet.'}
      </span>

      <Progress summary={summary} className="mt-5" />

      <dl className="mt-4 grid grid-cols-3 divide-x divide-surface-200 rounded-xl bg-surface-50 py-3 dark:divide-surface-800 dark:bg-surface-900">
        <Stat label="Open" value={summary.open} />
        <Stat label="Blocked" value={summary.blocked} alert="text-rose-600 dark:text-rose-400" />
        <Stat label="Overdue" value={summary.overdue} alert="text-danger" />
      </dl>

      <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-[12px] leading-4 text-ink-muted dark:text-ink-inverse-muted">
        <span className="min-w-0 truncate">
          <Updated at={summary.lastActivity} now={now} />
          {summary.dueSoon > 0 && <> · <span className="text-ink-secondary dark:text-ink-inverse-secondary">{summary.dueSoon} due this week</span></>}
        </span>
        <ArrowUpRight aria-hidden className="h-4 w-4 shrink-0 transition duration-200 group-hover:text-volt motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:translate-x-0.5" />
      </div>
    </article>
  )
}

function ProjectRow({ summary, now, wide, shared, onOpen }: { summary: ProjectSummary; now: number; wide: boolean; shared: boolean; onOpen: Opener }) {
  const { project } = summary
  const typeLabel = PROJECT_TYPE_SCHEMES[project.type]?.label ?? project.type
  const description = project.summary?.trim()
  return (
    <li
      className={cn(
        'group relative flex items-center gap-4 px-4 py-3.5 transition-colors sm:px-5',
        'hover:bg-ink/[0.025] has-[:focus-visible]:bg-ink/[0.025] dark:hover:bg-white/[0.03] dark:has-[:focus-visible]:bg-white/[0.03]',
        project.lifecycle === 'archived' && 'opacity-70 hover:opacity-100 has-[:focus-visible]:opacity-100',
      )}
    >
      <TypeTile project={project} small />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[14px] font-semibold leading-5 text-ink dark:text-ink-inverse">
            <button type="button" className={cn(STRETCHED, 'underline-offset-2 focus-visible:underline')} {...clickHandlers(project, onOpen)}>{project.name}</button>
          </h3>
          {project.lifecycle !== 'active' && <LifecycleChip lifecycle={project.lifecycle} />}
          {shared && <SharedChip />}
        </div>
        <span className="mt-0.5 block truncate text-[12px] leading-4 text-ink-muted dark:text-ink-inverse-muted">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em]">{project.key} / {typeLabel}</span>
          {description && <> · {description}</>}
          {!wide && <> · {summary.open} open{summary.blocked > 0 && `, ${summary.blocked} blocked`}{summary.overdue > 0 && `, ${summary.overdue} overdue`}</>}
        </span>
      </div>
      {wide && (
        <>
          <Progress summary={summary} compact className="w-40 shrink-0" />
          <RowStat value={summary.open} label="open" />
          <RowStat value={summary.blocked} label="blocked" alert="text-rose-600 dark:text-rose-400" />
          <RowStat value={summary.overdue} label="overdue" alert="text-danger" />
          <span className="w-28 shrink-0 truncate text-right text-[12px] text-ink-muted dark:text-ink-inverse-muted">
            <Updated at={summary.lastActivity} now={now} bare />
          </span>
        </>
      )}
      <ArrowUpRight aria-hidden className="h-4 w-4 shrink-0 text-ink-muted transition duration-200 group-hover:text-volt dark:text-ink-inverse-muted" />
    </li>
  )
}

function TypeTile({ project, small = false }: { project: Project; small?: boolean }) {
  return (
    <span
      title={PROJECT_TYPE_SCHEMES[project.type]?.label}
      className={cn(
        'flex shrink-0 items-center justify-center bg-surface-100 text-ink-secondary transition-colors dark:bg-surface-800 dark:text-ink-inverse-secondary',
        'group-hover:bg-blurple-600/10 group-hover:text-blurple-600 dark:group-hover:bg-blurple-400/15 dark:group-hover:text-blurple-300',
        small ? 'h-8 w-8 rounded-lg' : 'h-10 w-10 rounded-xl',
      )}
    >
      <ProjectTypeIcon type={project.type} className={small ? 'h-4 w-4' : 'h-[18px] w-[18px]'} />
    </span>
  )
}

const LIFECYCLE_TONE: Record<Exclude<Project['lifecycle'], 'active'>, string> = {
  paused: 'text-ink-secondary ring-surface-300 dark:text-ink-inverse-secondary dark:ring-surface-700',
  completed: 'text-success ring-success/35',
  archived: 'text-ink-muted ring-surface-200 dark:text-ink-inverse-muted dark:ring-surface-800',
}

function LifecycleChip({ lifecycle }: { lifecycle: Exclude<Project['lifecycle'], 'active'> }) {
  return (
    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ring-1 ring-inset', LIFECYCLE_TONE[lifecycle])}>
      {LIFECYCLE_LABEL[lifecycle]}
    </span>
  )
}

/** A project someone else owns that the user was invited to (src/lib/project-members.ts `isSharedProject`). */
function SharedChip() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 text-blurple-600 ring-1 ring-inset ring-blurple-600/30 dark:text-blurple-300 dark:ring-blurple-400/35">
      <Users aria-hidden className="h-3 w-3" />Shared
    </span>
  )
}

/** Done share as a segmented bar: done (volt), in progress or review (volt, light), blocked (rose); the rest is to do. */
function Progress({ summary, compact = false, className }: { summary: ProjectSummary; compact?: boolean; className?: string }) {
  const { total, done, byStatus } = summary
  const inFlight = byStatus['in-progress'] + byStatus.review
  const percent = Math.round(summary.progress * 100)
  const segments = [
    { key: 'done', value: done, tone: 'bg-blurple-600 dark:bg-blurple-400' },
    { key: 'flight', value: inFlight, tone: 'bg-blurple-600/25 dark:bg-blurple-400/30' },
    { key: 'blocked', value: byStatus.blocked, tone: 'bg-rose-500 dark:bg-rose-400' },
  ].filter((segment) => segment.value > 0)
  const breakdown = total
    ? `${done} done, ${inFlight} in progress, ${byStatus.blocked} blocked, ${byStatus.backlog} to do`
    : 'No issues yet'
  const bar = (
    <div role="img" aria-label={`Progress: ${total ? `${percent}% — ${breakdown}` : breakdown}`} className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-surface-200/70 dark:bg-surface-800">
      {segments.map((segment) => (
        <span key={segment.key} className={segment.tone} style={{ width: `${(segment.value / total) * 100}%` }} />
      ))}
    </div>
  )
  if (compact) {
    return (
      <div className={cn('flex items-center gap-3', className)}>
        {bar}
        <span className="w-9 shrink-0 text-right text-[12px] font-medium tabular-nums text-ink-secondary dark:text-ink-inverse-secondary">
          {total ? `${percent}%` : '—'}
        </span>
      </div>
    )
  }
  return (
    <div className={className}>
      <div className="mb-2 flex items-baseline justify-between gap-2 text-[12px] leading-4">
        <span className="text-ink-muted dark:text-ink-inverse-muted">
          {total ? (
            <>
              <span className="font-medium tabular-nums text-ink-secondary dark:text-ink-inverse-secondary">{done}</span> of <span className="tabular-nums">{total}</span> done
              {inFlight > 0 && <> · <span className="tabular-nums">{inFlight}</span> in progress</>}
            </>
          ) : 'No issues yet'}
        </span>
        {total > 0 && <span className="font-semibold tabular-nums text-ink dark:text-ink-inverse">{percent}%</span>}
      </div>
      {bar}
    </div>
  )
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center px-2">
      <dt className="order-2 mt-1.5 max-w-full truncate text-[11px] leading-none text-ink-muted dark:text-ink-inverse-muted">{label}</dt>
      <dd className={cn(
        'order-1 text-[20px] font-semibold leading-none tabular-nums',
        value === 0 ? 'text-ink-muted/60 dark:text-ink-inverse-muted/60' : alert ?? 'text-ink dark:text-ink-inverse',
      )}>
        {value}
      </dd>
    </div>
  )
}

function RowStat({ value, label, alert }: { value: number; label: string; alert?: string }) {
  return (
    <span
      className={cn(
        'w-14 shrink-0 text-right text-[14px] font-semibold tabular-nums',
        value === 0 ? 'text-ink-muted/60 dark:text-ink-inverse-muted/60' : alert ?? 'text-ink dark:text-ink-inverse',
      )}
    >
      {value}<span className="sr-only"> {label}</span>
    </span>
  )
}

function Updated({ at, now, bare = false }: { at: number; now: number; bare?: boolean }) {
  const label = updatedLabel(at, now)
  if (!at) return <>{label}</>
  return (
    <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>
      {bare ? label.replace(/^on /, '') : `Updated ${label}`}
    </time>
  )
}

function Strong({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-semibold tabular-nums text-ink dark:text-ink-inverse', className)}>{children}</span>
}

function Dot() {
  return <span aria-hidden className="mx-2 text-ink-muted/60 dark:text-ink-inverse-muted/60">·</span>
}

function SyncState({ pendingSaves, refreshing }: { pendingSaves: number; refreshing: boolean }) {
  if (pendingSaves === 0 && !refreshing) return null
  return (
    <span role="status" className="flex items-center gap-1.5 px-1 text-[12px] text-ink-muted dark:text-ink-inverse-muted">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {pendingSaves > 0 ? 'Saving…' : 'Refreshing…'}
    </span>
  )
}

function StatePanel({ title, detail, icon, tone = 'neutral', children }: {
  title: string
  detail?: string
  icon?: ReactNode
  tone?: 'neutral' | 'error'
  children?: ReactNode
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className="flex flex-col items-center rounded-2xl border border-dashed border-surface-300 px-6 py-16 text-center dark:border-surface-700"
    >
      {icon && (
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blurple-600/10 text-blurple-600 dark:bg-blurple-400/15 dark:text-blurple-300">
          {icon}
        </span>
      )}
      <h2 className={cn('font-display text-[20px] font-bold tracking-[-0.015em]', tone === 'error' ? 'text-danger' : 'text-ink dark:text-ink-inverse')}>{title}</h2>
      {detail && <span className="mt-2 block max-w-md text-[14px] leading-6 text-ink-secondary dark:text-ink-inverse-secondary">{detail}</span>}
      {children && <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  )
}

function LoadingProjects({ view, label }: { view: View; label: string }) {
  const bone = 'rounded-md bg-surface-100 dark:bg-surface-800'
  return (
    <div role="status">
      <span className="sr-only">{label}</span>
      {view === 'grid' ? (
        <ul aria-hidden className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17.5rem),1fr))] gap-4 motion-safe:animate-pulse sm:gap-5">
          {Array.from({ length: 6 }, (_, index) => (
            <li key={index} className={cn(SURFACE, 'p-5')}>
              <div className="flex items-start gap-3">
                <span className={cn(bone, 'h-10 w-10 rounded-xl')} />
                <div className="flex-1 space-y-2 pt-1">
                  <div className={cn(bone, 'h-2.5 w-24')} />
                  <div className={cn(bone, 'h-4 w-3/4')} />
                </div>
              </div>
              <div className={cn(bone, 'mt-4 h-3 w-full')} />
              <div className={cn(bone, 'mt-2 h-3 w-2/3')} />
              <div className={cn(bone, 'mt-6 h-1.5 w-full rounded-full')} />
              <div className={cn(bone, 'mt-4 h-[62px] w-full rounded-xl')} />
              <div className={cn(bone, 'mt-4 h-3 w-1/3')} />
            </li>
          ))}
        </ul>
      ) : (
        <div aria-hidden className={cn(SURFACE, 'divide-y divide-surface-200 motion-safe:animate-pulse dark:divide-surface-800')}>
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex items-center gap-4 px-5 py-4">
              <span className={cn(bone, 'h-8 w-8 rounded-lg')} />
              <div className="flex-1 space-y-2">
                <div className={cn(bone, 'h-3.5 w-1/3')} />
                <div className={cn(bone, 'h-2.5 w-1/2')} />
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-4 flex items-center justify-center gap-2 text-[13px] text-ink-muted dark:text-ink-inverse-muted">
        <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />{label}
      </p>
    </div>
  )
}
