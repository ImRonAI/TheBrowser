import { useEffect, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Filter, FolderKanban, Loader2, Plus, RefreshCw, Search, X } from 'lucide-react'
import { useNavigationStore } from '@/stores/navigationStore'
import { useProjectsStore } from '@/stores/projectsStore'
import { IssueCalendar } from '@/components/calendar/IssueCalendar'
import { IssueDrawer } from '@/components/projects/IssueDrawer'
import { CreateIssueDialog, CreateProjectDialog } from '@/components/projects/dialogs'
import { ExecuteKanban } from '@/components/execute/ExecuteKanban'
import { ExecuteTimeline } from '@/components/execute/ExecuteTimeline'
import { ExecuteList } from '@/components/execute/ExecuteList'
import { SURFACE } from '@/components/execute/IssueBits'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { PageBackground } from '@/components/shared/PageBackground'
import { ISSUE_PRIORITY_CONFIG, ISSUE_STATUS_CONFIG, type IssuePriority, type IssueStatus } from '@/types/projects'
import {
  DEFAULT_FILTERS, ISSUE_PRIORITIES, ISSUE_STATUSES, activeFilterCount, assigneeOptions, filterIssues, projectOptions, summarize, typeOptions,
  type DueFilter, type ExecuteFilters,
} from '@/lib/execute-issues'
import { openInternalUrl } from '@/components/board/task-detail/editor/extensions/blocks/workspace'
import { isGuestUserId, openSignIn } from '@/lib/sign-in'
import { cn } from '@/utils/cn'

type ExecuteView = 'kanban' | 'calendar' | 'timeline' | 'list'
const EXECUTE_VIEWS: { id: ExecuteView; label: string }[] = [
  { id: 'kanban', label: 'Kanban' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'list', label: 'List' },
]
const DUE_OPTIONS: { value: DueFilter; label: string }[] = [
  { value: 'all', label: 'Any time' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'next7', label: 'Due in next 7 days' },
  { value: 'none', label: 'No due date' },
]

/** Wall-clock time for overdue / due-soon, refreshed every minute. */
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

/**
 * Execute (`ron://execute`): every canonical issue the user can see, across projects, from the Projects
 * store. Kanban moves call `moveIssueStatus`; any issue opens the real issue workspace (`IssueDrawer`).
 */
export function ExecutePage() {
  const { setActiveTab } = useNavigationStore()
  const { projects, issues, people, userId, isInitialized, isLoading, pendingSaves, error, initialize, refreshFromServer } = useProjectsStore()
  const now = useNow()
  const [activeView, setActiveView] = useState<ExecuteView>('kanban')
  const [filters, setFilters] = useState<ExecuteFilters>(DEFAULT_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)
  const [newIssue, setNewIssue] = useState<{ status?: IssueStatus } | null>(null)
  const [showProjectDialog, setShowProjectDialog] = useState(false)

  useEffect(() => {
    setActiveTab('execute')
  }, [setActiveTab])

  // Same contract as <ProjectsSyncStatus initialize />: load once the workspace identity exists.
  useEffect(() => {
    if (userId) void initialize()
  }, [userId, initialize])

  // A different account or workspace: its projects, people and issues are unrelated to the old filters.
  useEffect(() => {
    setFilters(DEFAULT_FILTERS)
    setSelectedIssueId(null)
  }, [userId])

  const setFilter = <K extends keyof ExecuteFilters>(key: K, value: ExecuteFilters[K]) => setFilters((current) => ({ ...current, [key]: value }))
  const filtered = useMemo(() => filterIssues(issues, projects, filters, { userId, now }), [issues, projects, filters, userId, now])
  const summary = useMemo(() => summarize(filtered, now), [filtered, now])
  const projectChoices = useMemo(() => projectOptions(projects), [projects])
  const typeChoices = useMemo(() => typeOptions(issues, projects), [issues, projects])
  const assigneeChoices = useMemo(() => assigneeOptions(issues, people, userId), [issues, people, userId])
  const archivedHidden = useMemo(() => {
    if (filters.projectId !== 'all') return 0
    const archived = new Set(projects.filter((project) => project.lifecycle === 'archived').map((project) => project.id))
    return issues.filter((issue) => archived.has(issue.projectId)).length
  }, [filters.projectId, projects, issues])
  const filterCount = activeFilterCount(filters)
  const filtering = filterCount > 0 || filters.query.trim() !== ''
  // New issues go to the filtered project, else the first project that is not archived.
  const defaultProjectId = filters.projectId !== 'all' ? filters.projectId : projects.find((project) => project.lifecycle !== 'archived')?.id
  const guest = Boolean(userId && isGuestUserId(userId))
  const phase = !userId ? (error ? 'failed' : 'opening') : !isInitialized ? (error && !isLoading ? 'failed' : 'loading') : 'ready'

  const clearFilters = () => setFilters(DEFAULT_FILTERS)

  const body = (() => {
    if (phase === 'opening') return <StatusPanel busy title="Opening your workspace…" />
    if (phase === 'loading') return <StatusPanel busy title="Loading your issues…" />
    if (phase === 'failed') return (
      <StatusPanel title="Couldn’t load your issues" detail={error ?? undefined}>
        {userId && <ActionButton variant="primary" onClick={() => void refreshFromServer()}>Try again</ActionButton>}
      </StatusPanel>
    )
    if (projects.length === 0) return (
      <StatusPanel title="No projects yet" detail="Issues live in projects. Create a project, then add its first issue — it will show up here.">
        <ActionButton variant="primary" onClick={() => setShowProjectDialog(true)}><Plus className="h-4 w-4" />New Project</ActionButton>
      </StatusPanel>
    )
    if (issues.length === 0) return (
      <StatusPanel title="No issues yet" detail="Create an issue in one of your projects and it will appear on this board.">
        {defaultProjectId && <ActionButton variant="primary" onClick={() => setNewIssue({})}><Plus className="h-4 w-4" />New Issue</ActionButton>}
        <ActionButton variant="ghost" onClick={() => setShowProjectDialog(true)}>New Project</ActionButton>
      </StatusPanel>
    )
    if (filtered.length === 0) return (
      <StatusPanel title="No issues match" detail={archivedHidden > 0 && !filtering
        ? `${archivedHidden === 1 ? 'Your only issue is' : `All ${archivedHidden} of your issues are`} in archived projects. Pick an archived project under Filters → Project to see ${archivedHidden === 1 ? 'it' : 'them'}.`
        : 'Nothing matches these filters and search.'}>
        {filtering && <ActionButton variant="ghost" onClick={clearFilters}>Clear filters</ActionButton>}
      </StatusPanel>
    )
    if (activeView === 'kanban') return (
      <ErrorBoundary componentName="ExecuteKanban">
        <ExecuteKanban issues={filtered} projects={projects} people={people} now={now} onOpen={setSelectedIssueId}
          onCreate={defaultProjectId ? (status) => setNewIssue({ status }) : undefined} />
      </ErrorBoundary>
    )
    if (activeView === 'calendar') return <IssueCalendar issues={filtered} onIssueSelect={setSelectedIssueId} className="h-[640px] sm:h-[780px]" />
    if (activeView === 'timeline') return (
      <ErrorBoundary componentName="ExecuteTimeline">
        <ExecuteTimeline issues={filtered} projects={projects} now={now} onOpen={setSelectedIssueId} />
      </ErrorBoundary>
    )
    return (
      <ErrorBoundary componentName="ExecuteList">
        <ExecuteList issues={filtered} projects={projects} people={people} now={now} onOpen={setSelectedIssueId} />
      </ErrorBoundary>
    )
  })()

  return (
    <div className="relative min-h-full overflow-hidden bg-surface-0 dark:bg-surface-900">
      <PageBackground />
      <div className="relative z-10 space-y-4 px-4 py-4 sm:space-y-6 sm:px-6 sm:py-6">
        <div className={cn(SURFACE, 'overflow-hidden')}>
          {/* Title, counts, actions */}
          <div className="border-b border-surface-200 px-4 py-4 sm:px-6 sm:py-5 dark:border-surface-800">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
                  <FolderKanban className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold text-ink dark:text-ink-inverse">Operational Hub</h1>
                  <p className="text-body-sm text-ink-muted dark:text-ink-inverse-muted" aria-live="polite">
                    {phase === 'ready' ? (
                      <>
                        <span className="font-medium text-ink-secondary dark:text-ink-inverse-secondary">{summary.total} {summary.total === 1 ? 'issue' : 'issues'}</span>
                        {filtering && ` of ${issues.length}`}
                        {' · '}{summary.open} open
                        {' · '}<span className={cn(summary.overdue > 0 && 'font-medium text-danger')}>{summary.overdue} overdue</span>
                        {' · '}{summary.blocked} blocked
                        {archivedHidden > 0 && ` · ${archivedHidden} in archived projects hidden`}
                      </>
                    ) : 'Every issue across your projects'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <SyncState pendingSaves={pendingSaves} refreshing={isLoading && isInitialized} />
                {userId && (
                  <button type="button" onClick={() => void refreshFromServer()} disabled={isLoading || pendingSaves > 0} aria-label="Reload issues from the server" title="Reload from server"
                    className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-muted transition-colors hover:bg-surface-100 hover:text-ink disabled:opacity-40 dark:text-ink-inverse-muted dark:hover:bg-surface-800 dark:hover:text-ink-inverse">
                    <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
                  </button>
                )}
                <ActionButton variant="ghost" onClick={() => setShowProjectDialog(true)} disabled={!userId}>New Project</ActionButton>
                <ActionButton variant="primary" onClick={() => setNewIssue({})} disabled={!defaultProjectId}
                  title={defaultProjectId ? undefined : 'Create a project first'}>
                  <Plus className="h-4 w-4" />
                  New Issue
                </ActionButton>
              </div>
            </div>
            {phase === 'ready' && error && (
              <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-body-sm text-danger">{error}</p>
            )}
            {guest && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-100 px-3 py-2 text-body-sm text-ink-secondary dark:bg-surface-800 dark:text-ink-inverse-secondary">
                <span>You’re in a private guest workspace on this device. Sign in to work with your account’s projects.</span>
                <button type="button" onClick={() => openSignIn()} className="font-medium text-ink underline-offset-2 hover:underline dark:text-ink-inverse">Sign in</button>
              </div>
            )}
          </div>

          {/* Search, filters, views */}
          <div className="bg-surface-50/50 px-4 py-4 sm:px-6 dark:bg-surface-850/50">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-full sm:w-auto sm:min-w-[220px] sm:max-w-md sm:flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                <input
                  type="search"
                  value={filters.query}
                  onChange={(event) => setFilter('query', event.target.value)}
                  placeholder="Search title, key or description…"
                  aria-label="Search issues"
                  className="w-full rounded-xl border border-surface-200 bg-surface-0 py-2.5 pl-10 pr-10 text-body-sm text-ink transition-colors placeholder:text-ink-muted/60 focus:border-indigo-400 focus:outline-none dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:focus:border-indigo-600 [&::-webkit-search-cancel-button]:hidden"
                />
                {filters.query && (
                  <button type="button" onClick={() => setFilter('query', '')} aria-label="Clear search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink dark:hover:text-ink-inverse">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowFilters((value) => !value)}
                aria-expanded={showFilters}
                aria-controls="execute-filters"
                className={cn(
                  'flex items-center gap-2 rounded-xl border px-4 py-2.5 text-body-sm font-medium transition-colors',
                  showFilters || filterCount > 0
                    ? 'border-indigo-400 bg-indigo-500/5 text-indigo-600 dark:border-indigo-600 dark:text-indigo-400'
                    : 'border-surface-200 text-ink-muted hover:border-indigo-300 dark:border-surface-800 dark:text-ink-inverse-muted',
                )}
              >
                <Filter className="h-4 w-4" />
                <span>Filters</span>
                {filterCount > 0 && <span className="ml-1 rounded-full bg-indigo-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{filterCount}</span>}
                <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', showFilters && 'rotate-180')} />
              </button>

              <div role="group" aria-label="View" className="grid w-full grid-cols-4 gap-1 rounded-xl bg-surface-200/50 p-1 sm:inline-flex sm:w-auto dark:bg-surface-800/50">
                {EXECUTE_VIEWS.map((view) => (
                  <button
                    key={view.id}
                    type="button"
                    aria-pressed={activeView === view.id}
                    onClick={() => setActiveView(view.id)}
                    className={cn(
                      'rounded-lg px-2 py-1.5 text-body-sm font-medium transition-colors sm:px-3',
                      activeView === view.id
                        ? 'bg-surface-0 text-ink shadow-sm dark:bg-surface-700 dark:text-ink-inverse'
                        : 'text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse',
                    )}
                  >
                    {view.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => openInternalUrl('ron://projects')}
                className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-body-sm font-medium text-ink-muted transition-colors hover:bg-indigo-500/5 hover:text-indigo-600 dark:text-ink-inverse-muted dark:hover:text-indigo-400"
              >
                <FolderKanban className="h-4 w-4" />
                <span>Projects</span>
              </button>
            </div>

            <AnimatePresence initial={false}>
              {showFilters && (
                <motion.div
                  id="execute-filters"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mt-4 grid grid-cols-1 gap-3 border-t border-surface-200 pt-4 min-[420px]:grid-cols-2 md:grid-cols-3 xl:flex xl:flex-wrap xl:items-end dark:border-surface-800">
                    <FilterGroup label="Project">
                      <FilterSelect value={filters.projectId} onChange={(value) => setFilter('projectId', value)}>
                        <option value="all">All projects</option>
                        {projectChoices.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </FilterSelect>
                    </FilterGroup>
                    <FilterGroup label="Status">
                      <FilterSelect value={filters.status} onChange={(value) => setFilter('status', value as IssueStatus | 'all')}>
                        <option value="all">All statuses</option>
                        {ISSUE_STATUSES.map((status) => <option key={status} value={status}>{ISSUE_STATUS_CONFIG[status].label}</option>)}
                      </FilterSelect>
                    </FilterGroup>
                    <FilterGroup label="Priority">
                      <FilterSelect value={filters.priority} onChange={(value) => setFilter('priority', value as IssuePriority | 'all')}>
                        <option value="all">All priorities</option>
                        {ISSUE_PRIORITIES.map((priority) => <option key={priority} value={priority}>{ISSUE_PRIORITY_CONFIG[priority].label}</option>)}
                      </FilterSelect>
                    </FilterGroup>
                    <FilterGroup label="Type">
                      <FilterSelect value={filters.type} onChange={(value) => setFilter('type', value)}>
                        <option value="all">All types</option>
                        {typeChoices.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </FilterSelect>
                    </FilterGroup>
                    <FilterGroup label="Assignee">
                      <FilterSelect value={filters.assignee} onChange={(value) => setFilter('assignee', value)}>
                        <option value="all">Anyone</option>
                        {assigneeChoices.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </FilterSelect>
                    </FilterGroup>
                    <FilterGroup label="Due date">
                      <FilterSelect value={filters.due} onChange={(value) => setFilter('due', value as DueFilter)}>
                        {DUE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </FilterSelect>
                    </FilterGroup>
                    {filtering && (
                      <button type="button" onClick={clearFilters}
                        className="justify-self-start rounded-xl px-4 py-2.5 text-body-sm font-medium text-ink-muted transition-colors hover:bg-rose-500/5 hover:text-rose-500 dark:text-ink-inverse-muted">
                        Clear all
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="min-w-0">{body}</div>

        {selectedIssueId && <IssueDrawer issueId={selectedIssueId} onClose={() => setSelectedIssueId(null)} />}
        <CreateIssueDialog isOpen={newIssue !== null} onClose={() => setNewIssue(null)} projectId={defaultProjectId}
          initialStatus={newIssue?.status} allowParentSelection />
        <CreateProjectDialog isOpen={showProjectDialog} onClose={() => setShowProjectDialog(false)} />
      </div>
    </div>
  )
}

function SyncState({ pendingSaves, refreshing }: { pendingSaves: number; refreshing: boolean }) {
  if (!pendingSaves && !refreshing) return null
  return (
    <span role="status" className="flex items-center gap-1.5 text-[12px] text-ink-muted dark:text-ink-inverse-muted">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {pendingSaves > 0 ? 'Saving…' : 'Refreshing…'}
    </span>
  )
}

function StatusPanel({ title, detail, busy = false, children }: { title: string; detail?: string; busy?: boolean; children?: ReactNode }) {
  return (
    <div className={cn(SURFACE, 'flex flex-col items-center px-6 py-14 text-center')} role={busy ? 'status' : undefined}>
      {busy && <Loader2 className="mb-3 h-5 w-5 animate-spin text-ink-muted dark:text-ink-inverse-muted" />}
      <h2 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">{title}</h2>
      {detail && <p className="mt-1.5 max-w-md text-body-sm text-ink-muted dark:text-ink-inverse-muted">{detail}</p>}
      {children && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">{label}</span>
      {children}
    </label>
  )
}

function FilterSelect({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full min-w-0 cursor-pointer rounded-lg border border-surface-200 bg-surface-0 px-3 py-2 text-body-sm text-ink transition-colors focus:border-indigo-400 focus:outline-none xl:w-auto xl:min-w-[150px] xl:max-w-[16rem] dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:focus:border-indigo-600"
    >
      {children}
    </select>
  )
}

function ActionButton({ variant, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant: 'primary' | 'ghost' }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex h-10 items-center gap-2 rounded-xl px-4 text-body-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary'
          ? 'bg-indigo-500 text-white shadow-sm shadow-indigo-500/20 hover:bg-indigo-600'
          : 'text-ink-muted hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-surface-800 dark:hover:text-ink-inverse',
        className,
      )}
    >
      {children}
    </button>
  )
}
