import { Fragment, useCallback, useMemo, useState, useEffect, type DragEvent } from 'react'
import { ChevronDown, ChevronRight, Plus, ArrowUp, ArrowDown, FilePlus, MessagesSquare } from 'lucide-react'
import { useProjectsStore, projectSelectors, projectUtils } from '@/stores/projectsStore'
import { useNavigationStore } from '@/stores/navigationStore'
import {
  INTERNAL_PROJECT_VIEWS,
  ProjectView,
  Issue,
  IssueStatus,
  IssueTypeKey,
  ProjectTypeKey,
  Project,
  IssuePriority,
  ISSUE_STATUS_CONFIG,
  ISSUE_TYPE_CONFIG,
  PROJECT_TYPE_SCHEMES,
} from '@/types/projects'
import { IssueCard } from '@/components/projects/IssueCard'
import { BLOCKED_BAR, BlockedTag } from '@/components/projects/BlockedTag'
import { useIssueBlocking } from '@/hooks/useIssueBlocking'
import { ProjectDashboard } from '@/components/projects/dashboard/ProjectDashboard'
import { IssueDrawer } from '@/components/projects/IssueDrawer'
import { ProjectCalendar } from '@/components/projects/ProjectCalendar'
import { ProjectConfigurationEditor } from '@/components/projects/ProjectConfigurationEditor'
import { fromLocalDateTime, toLocalDateTime } from '@/lib/project-issue-utils'
import { ProjectsSyncStatus } from '@/components/projects/ProjectsSyncStatus'
import { ProjectTypeBadge, IssueTypeBadge, IssueStatusBadge } from '@/components/projects/badges'
import { CreateIssueDialog } from '@/components/projects/dialogs'
import { Button } from '@/components/ui/button'
import { Dialog as DialogRoot, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { timelineBar } from '@/lib/timeline-bar'
import { ProjectDocuments } from '@/components/projects/documents/ProjectDocuments'
import { PageBackground } from '@/components/shared/PageBackground'
import { cn } from '@/utils/cn'
import { useAgentUi } from '@/context/AgentUiContext'
import { usePanelAgentStore } from '@/stores/panelAgentStore'
import { projectChoices } from '@/lib/panel-agents'
import { ProjectPeople, useProjectMembers } from '@/components/projects/ProjectPeople'

interface ProjectHomePageProps {
  projectKey: string
  /** `ron://project/<id>/docs/<page>`: open the Docs view on this page. */
  documentId?: string
}

export function ProjectHomePage({ projectKey, documentId }: ProjectHomePageProps) {
  const { projects, issues, updateProject, people, isInitialized, isLoading, userId } = useProjectsStore()
  const { setActiveTab } = useNavigationStore()
  const { openPanel } = useAgentUi()
  const project = projectSelectors.getProjectByKey(projects, projectKey)
  const projectPeople = useProjectMembers(project?.id ?? null)
  const [activeView, setActiveView] = useState<ProjectView>(documentId ? 'docs' : 'dashboard')
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)
  const [showCreateIssue, setShowCreateIssue] = useState(false)
  const [newDocumentRequested, setNewDocumentRequested] = useState(false)
  const onDraftStarted = useCallback(() => setNewDocumentRequested(false), [])

  useEffect(() => {
    setActiveTab('execute')
  }, [setActiveTab])

  // Following a page link (e.g. from an issue's Documents) shows that page.
  useEffect(() => {
    if (documentId) { setActiveView('docs'); setSelectedIssueId(null) }
  }, [documentId])

  const projectIssues = useMemo(() => {
    if (!project) return []
    return issues.filter((issue) => issue.projectId === project.id)
  }, [issues, project])

  if (!project) {
    return (
      <div className="min-h-full relative overflow-hidden bg-surface-0 dark:bg-surface-900">
        <PageBackground />
        <div className="relative z-10 px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
          <ProjectsSyncStatus initialize />
          <div className="rounded-3xl border border-surface-200 bg-surface-0 p-5 shadow-soft dark:border-surface-800 dark:bg-surface-900 sm:p-8">
            <h1 className="text-2xl font-display text-ink dark:text-ink-inverse">{isLoading || !isInitialized ? 'Loading project' : 'Project not found'}</h1>
            <p className="mt-2 text-body-sm text-ink-muted dark:text-ink-inverse-muted">
              Double-check the project key and try again.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // The people list names the owner of a shared project or guest workspace; the store knows only this account and Ren.
  const ownerName = projectPeople.members.find((member) => member.role === 'owner')?.name
    ?? people.find((person) => person.id === project.ownerId)?.name ?? '—'

  return (
    <div className="min-h-full relative overflow-hidden bg-surface-0 dark:bg-surface-900">
      <PageBackground />
      <div className="relative z-10 px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-6 lg:space-y-8">
        <ProjectsSyncStatus initialize />
        <div className="rounded-3xl border border-surface-200 bg-surface-0 p-5 shadow-soft dark:border-surface-800 dark:bg-surface-900 sm:p-6 lg:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4 lg:gap-6">
            <div className="min-w-0">
              <ProjectTypeBadge type={project.type} />
              <h1 className="mt-4 text-2xl sm:text-3xl font-display text-ink dark:text-ink-inverse break-words">{project.name}</h1>
              <p className="mt-2 text-body-sm text-ink-secondary dark:text-ink-inverse-secondary max-w-2xl">
                {project.summary || 'Add a project summary to orient the team.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-body-xs text-ink-muted dark:text-ink-inverse-muted">
                <span className="rounded-full border border-surface-200 bg-surface-0 px-3 py-1 dark:border-surface-800 dark:bg-surface-900">
                  Key: {project.key}
                </span>
                <span className="rounded-full border border-surface-200 bg-surface-0 px-3 py-1 dark:border-surface-800 dark:bg-surface-900">
                  Owner: {ownerName}
                </span>
                <span className="rounded-full border border-surface-200 bg-surface-0 px-3 py-1 dark:border-surface-800 dark:bg-surface-900">
                  Type: {PROJECT_TYPE_SCHEMES[project.type].label}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <ProjectPeople project={project} people={projectPeople} />
              <Button type="button" variant="outline" className="rounded-full" title="Discuss this project with its agent in the Agent Panel; it can create and edit issues"
                onClick={() => { usePanelAgentStore.getState().requestAgent(projectChoices([project])[0]); openPanel() }}>
                <MessagesSquare />
                Ask the project agent
              </Button>
              <Button type="button" variant="outline" className="rounded-full" onClick={() => setShowCreateIssue(true)}>
                <Plus />
                New Issue
              </Button>
              <Button type="button" className="rounded-full" onClick={() => { setActiveView('docs'); setNewDocumentRequested(true) }}>
                <FilePlus />
                New Document
              </Button>
            </div>
          </div>
          <div className="mt-6 lg:mt-8 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-thin" role="group" aria-label="Project views">
            {INTERNAL_PROJECT_VIEWS.map((view) => (
              <button
                key={view}
                type="button"
                aria-pressed={activeView === view}
                onClick={() => setActiveView(view)}
                className={cn(
                  'shrink-0 whitespace-nowrap px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-wider transition',
                  activeView === view
                    ? 'bg-accent/20 text-accent dark:text-accent-light'
                    : 'border border-surface-200 bg-surface-0 text-ink-muted dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse-muted'
                )}
              >
                {view}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-6">
        {activeView === 'dashboard' && (
          <ProjectDashboard
            key={`${userId}:${project.id}`}
            project={project}
            issues={projectIssues}
            userId={userId}
            onIssueSelect={setSelectedIssueId}
          />
        )}
        {activeView === 'backlog' && (
          <ProjectBacklogView
            projectId={project.id}
            projectIssues={projectIssues}
            onIssueSelect={setSelectedIssueId}
          />
        )}
        {activeView === 'board' && (
          <ProjectBoardView
            projectId={project.id}
            projectType={project.type}
            projectIssues={projectIssues}
            onIssueSelect={setSelectedIssueId}
          />
        )}
        {activeView === 'list' && (
          <ProjectListView
            projectIssues={projectIssues}
            onIssueSelect={setSelectedIssueId}
          />
        )}
        {activeView === 'calendar' && <ProjectCalendar issues={projectIssues} onIssueSelect={setSelectedIssueId} />}
        {activeView === 'timeline' && (
          <ProjectTimelineView
            projectIssues={projectIssues}
            onIssueSelect={setSelectedIssueId}
          />
        )}
        {activeView === 'docs' && (
          <ProjectDocuments key={`${userId}:${project.id}`} project={project} openDocumentId={documentId}
            startWithDraft={newDocumentRequested} onDraftStarted={onDraftStarted} onIssueSelect={setSelectedIssueId} />
        )}
        {activeView === 'settings' && (
          <ProjectSettingsView
            key={`${userId}:${project.id}`}
            project={project}
            canEdit={project.ownerId === userId}
            onLifecycleChange={async (lifecycle) => { await updateProject(project.id, { lifecycle }) }}
          />
        )}
        </div>

      {selectedIssueId && (
        <IssueDrawer issueId={selectedIssueId} onClose={() => setSelectedIssueId(null)} />
      )}

      <CreateIssueDialog
        isOpen={showCreateIssue}
        onClose={() => setShowCreateIssue(false)}
        projectId={project.id}
        allowParentSelection
      />
      </div>
    </div>
  )
}

function ProjectBacklogView({
  projectId,
  projectIssues,
  onIssueSelect,
}: {
  projectId: string
  projectIssues: Issue[]
  onIssueSelect: (issueId: string) => void
}) {
  const { moveIssueInParent, reparentIssue, swapIssueRank, projects, pendingSaves } = useProjectsStore()
  const definitions = projects.find((project) => project.id === projectId)?.settings.issueTypes
  const hierarchyLevel = (type: IssueTypeKey) => definitions?.find((definition) => definition.key === type)?.level ?? ISSUE_TYPE_CONFIG[type]?.level
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [activeParentId, setActiveParentId] = useState<string | null>(null)
  const [showCreateChild, setShowCreateChild] = useState(false)
  const [showReparent, setShowReparent] = useState<Issue | null>(null)

  const sortedIssues = useMemo(() => [...projectIssues].sort((a, b) => a.rank - b.rank), [projectIssues])

  const childrenMap = useMemo(() => {
    const map = new Map<string | null, Issue[]>()
    sortedIssues.forEach((issue) => {
      const key = issue.parentId || null
      const list = map.get(key) || []
      list.push(issue)
      map.set(key, list)
    })
    return map
  }, [sortedIssues])

  const rollups = useMemo(() => {
    const memo = new Map<string, { total: number; done: number; blocked: number }>()
    const compute = (issueId: string): { total: number; done: number; blocked: number } => {
      if (memo.has(issueId)) return memo.get(issueId)!
      const children = childrenMap.get(issueId) || []
      if (children.length === 0) {
        const base = { total: 0, done: 0, blocked: 0 }
        memo.set(issueId, base)
        return base
      }
      const aggregated = children.reduce(
        (acc, child) => {
          acc.total += 1
          if (child.status === 'done') acc.done += 1
          if (child.status === 'blocked') acc.blocked += 1
          const nested = compute(child.id)
          acc.total += nested.total
          acc.done += nested.done
          acc.blocked += nested.blocked
          return acc
        },
        { total: 0, done: 0, blocked: 0 }
      )
      memo.set(issueId, aggregated)
      return aggregated
    }

    sortedIssues.forEach((issue) => compute(issue.id))
    return memo
  }, [childrenMap, sortedIssues])

  const toggleExpanded = (issueId: string) => {
    setExpanded((prev) => ({ ...prev, [issueId]: !prev[issueId] }))
  }

  const rootIssues = childrenMap.get(null) || []

  const handleDropOnIssue = async (targetId: string, draggedId: string) => {
    if (pendingSaves || targetId === draggedId) return
    const dragged = projectIssues.find((item) => item.id === draggedId)
    const target = projectIssues.find((item) => item.id === targetId)
    if (!dragged || !target) return

    if ((hierarchyLevel(target.type) ?? -2) + 1 === hierarchyLevel(dragged.type)) {
      await reparentIssue(dragged.id, target.id)
      return
    }

    if ((dragged.parentId || null) === (target.parentId || null)) {
      await swapIssueRank(dragged.id, target.id)
    }
  }

  const handleDropToRoot = async (draggedId: string) => {
    if (pendingSaves) return
    const dragged = projectIssues.find((item) => item.id === draggedId)
    if (!dragged) return
    if ((hierarchyLevel(dragged.type) ?? 5) >= 5) return
    await reparentIssue(dragged.id, null)
  }

  return (
    <div
      className="rounded-3xl border border-surface-200 bg-surface-0 p-6 shadow-soft dark:border-surface-800 dark:bg-surface-900"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const draggedId = event.dataTransfer.getData('text/plain')
        if (draggedId) handleDropToRoot(draggedId)
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">Hierarchy</h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-full"
          onClick={() => {
            setActiveParentId(null)
            setShowCreateChild(true)
          }}
        >
          <Plus />
          New root item
        </Button>
      </div>
      <div className="mt-6 space-y-2">
        {rootIssues.length === 0 ? (
          <p className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">No backlog yet.</p>
        ) : (
          rootIssues.map((issue) => (
            <BacklogNode
              key={issue.id}
              issue={issue}
              level={0}
              expanded={expanded}
              onToggle={toggleExpanded}
              childrenMap={childrenMap}
              rollups={rollups}
              onMove={(issueId, direction) => moveIssueInParent(issueId, direction)}
              onSelect={onIssueSelect}
              onAddChild={(id) => {
                setActiveParentId(id)
                setShowCreateChild(true)
              }}
              onReparent={(issue) => setShowReparent(issue)}
              onDropIssue={handleDropOnIssue}
            />
          ))
        )}
      </div>

      <CreateIssueDialog
        isOpen={showCreateChild}
        onClose={() => {
          setShowCreateChild(false)
          setActiveParentId(null)
        }}
        projectId={projectId}
        parentId={activeParentId}
      />

      {showReparent && (
        <ReparentDialog
          issue={showReparent}
          issues={projectIssues}
          onClose={() => setShowReparent(null)}
        />
      )}
    </div>
  )
}

function BacklogNode({
  issue,
  level,
  expanded,
  onToggle,
  childrenMap,
  rollups,
  onMove,
  onSelect,
  onAddChild,
  onReparent,
  onDropIssue,
}: {
  issue: Issue
  level: number
  expanded: Record<string, boolean>
  onToggle: (id: string) => void
  childrenMap: Map<string | null, Issue[]>
  rollups: Map<string, { total: number; done: number; blocked: number }>
  onMove: (issueId: string, direction: 'up' | 'down') => void
  onSelect: (issueId: string) => void
  onAddChild: (issueId: string) => void
  onReparent: (issue: Issue) => void
  onDropIssue: (targetId: string, draggedId: string) => void
}) {
  const children = childrenMap.get(issue.id) || []
  const isExpanded = expanded[issue.id] ?? true
  const rollup = rollups.get(issue.id) || { total: 0, done: 0, blocked: 0 }
  const percentDone = rollup.total > 0 ? Math.round((rollup.done / rollup.total) * 100) : 0
  const { projects } = useProjectsStore()
  const typeLevel = projects.find((project) => project.id === issue.projectId)?.settings.issueTypes
    ?.find((type) => type.key === issue.type)?.level ?? ISSUE_TYPE_CONFIG[issue.type]?.level
  const canHaveChildren = (typeLevel ?? 5) < 5
  const blocking = useIssueBlocking()(issue)

  return (
    <div>
      <div
        className="flex items-center gap-3 rounded-2xl border border-surface-200 bg-surface-0 px-4 py-3 transition-colors hover:border-accent/30 dark:border-surface-800 dark:bg-surface-900 dark:hover:border-accent/30"
        style={{ marginLeft: level * 20 }}
        draggable
        onDragStart={(event) => event.dataTransfer.setData('text/plain', issue.id)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.stopPropagation()
          const draggedId = event.dataTransfer.getData('text/plain')
          if (draggedId) onDropIssue(issue.id, draggedId)
        }}
      >
        {children.length > 0 ? (
          <button
            type="button"
            onClick={() => onToggle(issue.id)}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${issue.title}`}
            title={isExpanded ? 'Collapse' : 'Expand'}
            className="shrink-0 rounded text-ink-muted dark:text-ink-inverse-muted"
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        ) : (
          <span aria-hidden className="h-4 w-4 shrink-0" />
        )}
        <div className="flex-1">
          <button onClick={() => onSelect(issue.id)} className="text-left">
            <div className="flex items-center gap-2">
              <IssueTypeBadge type={issue.type} />
              <IssueStatusBadge status={issue.status} />
              {blocking.blocked && issue.status !== 'blocked' && <BlockedTag label={blocking.label} />}
              <span className="text-body-sm font-semibold text-ink dark:text-ink-inverse">
                {issue.title}
              </span>
            </div>
          </button>
          {rollup.total > 0 && (
            <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-muted dark:text-ink-inverse-muted">
              <span>{percentDone}% done</span>
              <span>{rollup.total} children</span>
              <span>{rollup.blocked} blocked</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onMove(issue.id, 'up')} aria-label={`Move ${issue.title} up`} title={`Move ${issue.title} up`}
            className="p-1 rounded-lg hover:bg-surface-100/60 dark:hover:bg-surface-800/60">
            <ArrowUp className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => onMove(issue.id, 'down')} aria-label={`Move ${issue.title} down`} title={`Move ${issue.title} down`}
            className="p-1 rounded-lg hover:bg-surface-100/60 dark:hover:bg-surface-800/60">
            <ArrowDown className="w-4 h-4" />
          </button>
          {canHaveChildren && (
            <button onClick={() => onAddChild(issue.id)} className="text-body-xs text-accent dark:text-accent-light">
              Add child
            </button>
          )}
          <button onClick={() => onReparent(issue)} className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">
            Reparent
          </button>
        </div>
      </div>
      {isExpanded && children.length > 0 && (
        <div className="mt-2 space-y-2">
          {children.map((child) => (
            <BacklogNode
              key={child.id}
              issue={child}
              level={level + 1}
              expanded={expanded}
              onToggle={onToggle}
              childrenMap={childrenMap}
              rollups={rollups}
              onMove={onMove}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onReparent={onReparent}
              onDropIssue={onDropIssue}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ReparentDialog({
  issue,
  issues,
  onClose,
}: {
  issue: Issue
  issues: Issue[]
  onClose: () => void
}) {
  const { reparentIssue, pendingSaves, projects } = useProjectsStore()
  const [selectedParent, setSelectedParent] = useState(issue.parentId || '')
  const [error, setError] = useState<string | null>(null)
  const definitions = projects.find((project) => project.id === issue.projectId)?.settings.issueTypes
  const level = definitions?.find((type) => type.key === issue.type)?.level ?? ISSUE_TYPE_CONFIG[issue.type]?.level
  const allowNoParent = level !== 5

  const availableParents = issues.filter((candidate) => candidate.projectId === issue.projectId && candidate.id !== issue.id &&
    (definitions?.find((type) => type.key === candidate.type)?.level ?? ISSUE_TYPE_CONFIG[candidate.type]?.level) === (level ?? 0) - 1)

  const handleSubmit = async () => {
    if (pendingSaves || (!allowNoParent && !selectedParent)) return
    setError(null)
    const result = await reparentIssue(issue.id, selectedParent || null)
    if (result.error) setError(result.error)
    else onClose()
  }

  // Radix Dialog: Escape and a click outside close it, focus stays inside and returns to Reparent.
  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent showCloseButton={false}
        overlayClassName="z-[220] bg-surface-900/50 backdrop-blur-sm"
        className="z-[221] w-[calc(100%-2rem)] max-w-lg gap-0 rounded-3xl border border-surface-200 sm:rounded-3xl bg-surface-0 p-6 text-ink shadow-bold dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:shadow-dark-bold">
        <DialogTitle className="text-[14px] font-semibold leading-snug tracking-normal text-ink dark:text-ink-inverse">Reparent Issue</DialogTitle>
        <DialogDescription className="mt-2 text-[12px] text-ink-muted dark:text-ink-inverse-muted">
          Select a parent from the preceding hierarchy level in this project.
        </DialogDescription>
        <select
          aria-label="New parent"
          value={selectedParent}
          onChange={(e) => setSelectedParent(e.target.value)}
          className="mt-4 w-full rounded-xl border border-surface-200 bg-surface-0 px-3 py-2 text-body-sm text-ink dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse"
        >
          {allowNoParent && <option value="">No parent</option>}
          {availableParents.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.title}
            </option>
          ))}
        </select>
        {error && <p role="alert" className="mt-3 text-[12.5px] text-danger">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <Button type="button" variant="outline" className="rounded-full" onClick={onClose}>Cancel</Button>
          <Button type="button" className="rounded-full" disabled={pendingSaves > 0} onClick={() => void handleSubmit()}>Update Parent</Button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}

function ProjectBoardView({
  projectId,
  projectType,
  projectIssues,
  onIssueSelect,
}: {
  projectId: string
  projectType: ProjectTypeKey
  projectIssues: Issue[]
  onIssueSelect: (issueId: string) => void
}) {
  const { moveIssueStatus, projects, pendingSaves, people } = useProjectsStore()
  const project = projects.find((item) => item.id === projectId)
  const scheme = project ? projectUtils.getProjectScheme(project) : PROJECT_TYPE_SCHEMES[projectType]
  const [visibleTypes, setVisibleTypes] = useState<IssueTypeKey[]>(scheme.issueTypes)
  const [createStatus, setCreateStatus] = useState<IssueStatus | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overStatus, setOverStatus] = useState<IssueStatus | null>(null)

  const columns = scheme.statuses

  const boardIssues = projectIssues.filter((issue) => visibleTypes.includes(issue.type))

  // The Execute board's pattern: a drop back on the card's own column saves nothing, and cards
  // cannot be picked up while a save is pending (instead of the drop being ignored).
  const handleDrop = async (event: DragEvent<HTMLElement>, status: IssueStatus) => {
    event.preventDefault()
    const issueId = event.dataTransfer.getData('text/plain')
    setOverStatus(null)
    setDraggingId(null)
    const issue = projectIssues.find((item) => item.id === issueId)
    if (!issue || issue.status === status) return
    if (!pendingSaves) await moveIssueStatus(issueId, status)
  }

  const toggleType = (type: IssueTypeKey) => {
    setVisibleTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-body-xs uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">Show</span>
        {scheme.issueTypes.map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={visibleTypes.includes(type)}
            onClick={() => toggleType(type)}
            className={cn(
              'px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider',
              visibleTypes.includes(type)
                ? 'bg-accent/20 text-accent dark:text-accent-light'
                : 'border border-surface-200 bg-surface-0 text-ink-muted dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse-muted'
            )}
          >
            {project?.settings.issueTypes?.find((definition) => definition.key === type)?.label ?? ISSUE_TYPE_CONFIG[type]?.label ?? type}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Issues by status" className="flex gap-4 overflow-x-auto">
        {columns.map((status) => {
          const items = boardIssues.filter((issue) => issue.status === status)
          const label = ISSUE_STATUS_CONFIG[status].label
          const over = overStatus === status && draggingId !== null && items.every((item) => item.id !== draggingId)
          return (
            <section
              key={status}
              aria-label={`${label}, ${items.length} issues`}
              className={cn(
                'flex w-80 flex-shrink-0 flex-col rounded-3xl border p-4 shadow-soft transition-colors',
                over ? 'border-accent/60 bg-accent/5 dark:border-accent-light/50' : 'border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-900'
              )}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (overStatus !== status) setOverStatus(status) }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverStatus(null) }}
              onDrop={(event) => void handleDrop(event, status)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <IssueStatusBadge status={status} />
                  <span className="rounded-full bg-surface-200/70 px-1.5 text-[11px] font-medium tabular-nums text-ink-muted dark:bg-surface-800 dark:text-ink-inverse-muted">{items.length}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateStatus(status)}
                  aria-label={`New ${label} issue`}
                  title={`New ${label} issue`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-200/70 hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-surface-800 dark:hover:text-ink-inverse"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 flex min-h-[5rem] flex-1 flex-col gap-3.5">
                {items.map((issue) => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    issueKey={project ? `${project.key}-${issue.number}` : undefined}
                    people={people}
                    issues={projectIssues}
                    dragging={draggingId === issue.id}
                    draggable={pendingSaves === 0}
                    aria-roledescription="Draggable issue"
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', issue.id)
                      event.dataTransfer.effectAllowed = 'move'
                      setDraggingId(issue.id)
                    }}
                    onDragEnd={() => { setDraggingId(null); setOverStatus(null) }}
                    onClick={() => onIssueSelect(issue.id)}
                  />
                ))}
                {items.length === 0 && (
                  <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-surface-200 px-3 py-6 text-center text-[12px] text-ink-muted dark:border-surface-800 dark:text-ink-inverse-muted">
                    {draggingId ? 'Drop to move here' : 'No issues'}
                  </p>
                )}
              </div>
            </section>
          )
        })}
      </div>

      <CreateIssueDialog
        isOpen={createStatus !== null}
        onClose={() => setCreateStatus(null)}
        projectId={projectId}
        initialStatus={createStatus || undefined}
      />
    </div>
  )
}

function ProjectListView({
  projectIssues,
  onIssueSelect,
}: {
  projectIssues: Issue[]
  onIssueSelect: (issueId: string) => void
}) {
  const { updateIssue, people } = useProjectsStore()
  const blockingFor = useIssueBlocking()
  // An inline edit on its way to the server: the row's selects show it (and stay disabled) until
  // the store holds the saved issue, instead of snapping back for the whole round trip.
  const [pending, setPending] = useState<Record<string, InlineEdit>>({})
  const [failed, setFailed] = useState<Record<string, string>>({})

  const save = async (issueId: string, updates: InlineEdit) => {
    setPending((current) => ({ ...current, [issueId]: updates }))
    setFailed((current) => omitKey(current, issueId))
    const { error } = await updateIssue(issueId, updates)
    setPending((current) => omitKey(current, issueId))
    if (error) setFailed((current) => ({ ...current, [issueId]: error }))
  }

  return (
    <div className="rounded-3xl border border-surface-200 bg-surface-0 p-6 shadow-soft dark:border-surface-800 dark:bg-surface-900 overflow-x-auto">
      <table className="w-full text-left text-body-xs">
        <thead>
          <tr className="text-ink-muted dark:text-ink-inverse-muted border-b border-surface-200 dark:border-surface-800">
            <th className="pb-3">Issue</th>
            <th className="pb-3">Status</th>
            <th className="pb-3">Priority</th>
            <th className="pb-3">Assignee</th>
            <th className="pb-3">Due</th>
          </tr>
        </thead>
        <tbody>
          {projectIssues.length === 0 && (
            <tr>
              <td colSpan={5} className="py-10 text-center text-body-xs text-ink-muted dark:text-ink-inverse-muted">
                No issues yet. Use New Issue to add the first one.
              </td>
            </tr>
          )}
          {projectIssues.map((issue) => {
            const edit = pending[issue.id]
            const saving = edit !== undefined
            const error = failed[issue.id]
            return (
            <Fragment key={issue.id}>
            <tr className="border-t border-surface-200 dark:border-surface-800">
              <td className="py-3">
                <button type="button" onClick={() => onIssueSelect(issue.id)} className="flex items-center gap-2">
                  <IssueTypeBadge type={issue.type} />
                  <span className="text-body-sm font-semibold text-ink dark:text-ink-inverse">{issue.title}</span>
                  {(() => { const blocking = blockingFor(issue); return blocking.blocked && <BlockedTag label={blocking.label} className="shrink-0" /> })()}
                </button>
              </td>
              <td className="py-3">
                <select
                  aria-label={`Status of ${issue.title}`}
                  value={edit?.status ?? issue.status}
                  disabled={saving}
                  onChange={(e) => void save(issue.id, { status: e.target.value as IssueStatus })}
                  className="rounded-lg border border-surface-200 bg-surface-0 px-2 py-1 disabled:opacity-60 dark:border-surface-800 dark:bg-surface-900"
                >
                  {Object.keys(ISSUE_STATUS_CONFIG).map((status) => (
                    <option key={status} value={status}>
                      {ISSUE_STATUS_CONFIG[status as IssueStatus].label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-3">
                <select
                  aria-label={`Priority of ${issue.title}`}
                  value={edit?.priority ?? issue.priority}
                  disabled={saving}
                  onChange={(e) => void save(issue.id, { priority: e.target.value as IssuePriority })}
                  className="rounded-lg border border-surface-200 bg-surface-0 px-2 py-1 disabled:opacity-60 dark:border-surface-800 dark:bg-surface-900"
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </td>
              <td className="py-3">
                <select
                  aria-label={`Assignee of ${issue.title}`}
                  value={(edit?.assignees ?? issue.assignees)[0] || ''}
                  disabled={saving}
                  onChange={(e) => void save(issue.id, { assignees: e.target.value ? [e.target.value] : [] })}
                  className="rounded-lg border border-surface-200 bg-surface-0 px-2 py-1 disabled:opacity-60 dark:border-surface-800 dark:bg-surface-900"
                >
                  <option value="">Unassigned</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-3">
                <input
                  type="datetime-local"
                  aria-label={`Due time in ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}
                  value={toLocalDateTime(issue.dueDate)}
                  onChange={(e) => {
                    try {
                      const dueDate = fromLocalDateTime(e.target.value)
                      e.target.setCustomValidity('')
                      void updateIssue(issue.id, { dueDate }, issue.version)
                    } catch (error) { e.target.setCustomValidity((error as Error).message); e.target.reportValidity() }
                  }}
                  className="rounded-lg border border-surface-200 bg-surface-0 px-2 py-1 dark:border-surface-800 dark:bg-surface-900"
                />
              </td>
            </tr>
            {error && (
              <tr>
                <td colSpan={5} className="pb-3">
                  <p role="alert" className="text-[12px] text-danger">{`${issue.title}: ${error}`}</p>
                </td>
              </tr>
            )}
            </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** The fields the list view edits inline. */
type InlineEdit = Partial<Pick<Issue, 'status' | 'priority' | 'assignees'>>

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function ProjectTimelineView({
  projectIssues,
  onIssueSelect,
}: {
  projectIssues: Issue[]
  onIssueSelect: (issueId: string) => void
}) {
  const timelineStart = new Date()
  timelineStart.setDate(timelineStart.getDate() - 7)
  const timelineEnd = new Date()
  timelineEnd.setDate(timelineEnd.getDate() + 45)
  const totalMs = timelineEnd.getTime() - timelineStart.getTime()
  // Today is inside the window by construction (7 days back, 45 ahead).
  const todayPct = ((Date.now() - timelineStart.getTime()) / totalMs) * 100

  const items = projectIssues.filter((issue) => issue.startDate || issue.endDate || issue.dueDate)
  const blockingFor = useIssueBlocking()

  return (
    <div className="rounded-3xl border border-surface-200 bg-surface-0 p-6 shadow-soft dark:border-surface-800 dark:bg-surface-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">Timeline</h3>
        <span className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
          <span className="flex items-center gap-1.5"><span aria-hidden className="h-3 w-0.5 rounded-full bg-danger/70" />Today</span>
          <span>{timelineStart.toLocaleDateString()} - {timelineEnd.toLocaleDateString()}</span>
        </span>
      </div>
      <div className="mt-6 space-y-4">
        {items.length === 0 ? (
          <p className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">No scheduled items.</p>
        ) : (
          items.map((issue) => {
            const start = issue.startDate ? new Date(issue.startDate) : issue.dueDate ? new Date(issue.dueDate) : new Date(issue.createdAt)
            const end = issue.endDate ? new Date(issue.endDate) : issue.dueDate ? new Date(issue.dueDate) : new Date(start.getTime() + 1000 * 60 * 60 * 24 * 7)
            const bar = timelineBar(start.getTime(), end.getTime(), timelineStart.getTime(), timelineEnd.getTime())
            const blocking = blockingFor(issue)

            return (
              <div key={issue.id} className="relative">
                <button type="button" onClick={() => onIssueSelect(issue.id)} className="flex items-center gap-2">
                  <IssueTypeBadge type={issue.type} />
                  <span className="text-body-sm font-semibold text-ink dark:text-ink-inverse">{issue.title}</span>
                  {blocking.blocked && <BlockedTag label={blocking.label} keys={blocking.keys} showKeys />}
                </button>
                {bar && bar.placement !== 'inside' ? (
                  <p className={`mt-2 text-[11px] leading-3 text-ink-muted dark:text-ink-inverse-muted ${bar.placement === 'after' ? 'text-right' : ''}`}>
                    {bar.placement === 'before' ? 'Before this window' : 'After this window'}
                  </p>
                ) : (
                  <div className="relative mt-2 h-3 overflow-hidden rounded-full border border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-900">
                    {bar && (
                      <div
                        title={blocking.label || undefined}
                        className={cn('absolute inset-y-0 rounded-full', blocking.blocked ? BLOCKED_BAR : 'bg-accent/60',
                          bar.clippedStart && 'rounded-l-none', bar.clippedEnd && 'rounded-r-none')}
                        style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
                      />
                    )}
                    <span aria-hidden className="absolute inset-y-0 z-10 w-0.5 bg-danger/70" style={{ left: `${todayPct}%` }} />
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function ProjectSettingsView({
  project,
  canEdit,
  onLifecycleChange,
}: {
  project: Project
  canEdit: boolean
  onLifecycleChange: (value: Project['lifecycle']) => Promise<void>
}) {
  const { pendingSaves } = useProjectsStore()
  return (
    <div className="rounded-3xl border border-surface-200 bg-surface-0 p-6 shadow-soft dark:border-surface-800 dark:bg-surface-900">
      <h3 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">Project Settings</h3>
      <div className="mt-4 flex items-center justify-between rounded-2xl border border-surface-200 bg-surface-0 px-4 py-4 dark:border-surface-800 dark:bg-surface-900">
        <div>
          <p className="text-body-sm font-semibold text-ink dark:text-ink-inverse">Project lifecycle</p>
          <p className="mt-1 text-body-xs text-ink-muted dark:text-ink-inverse-muted">
            Hierarchies stay within a project. Use relationships to connect issues across projects.
          </p>
        </div>
        <select
          aria-label="Project lifecycle"
          value={project.lifecycle}
          disabled={!canEdit || pendingSaves > 0}
          onChange={(event) => void onLifecycleChange(event.target.value as Project['lifecycle'])}
          className="rounded-xl bg-surface-0 dark:bg-surface-900 px-3 py-2 text-body-sm disabled:opacity-50"
        >
          {(['active', 'paused', 'completed', 'archived'] as const).map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      <ProjectConfigurationEditor project={project} canEdit={canEdit} />
    </div>
  )
}
