import { useMemo, useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, Plus, ArrowUp, ArrowDown } from 'lucide-react'
import { useProjectsStore, projectSelectors } from '@/stores/projectsStore'
import { useNavigationStore } from '@/stores/navigationStore'
import {
  INTERNAL_PROJECT_VIEWS,
  ProjectView,
  Issue,
  IssueStatus,
  IssueTypeKey,
  ProjectTypeKey,
  IssuePriority,
  ISSUE_STATUS_CONFIG,
  ISSUE_TYPE_CONFIG,
  PROJECT_TYPE_SCHEMES,
  STANDARD_HIERARCHY,
} from '@/types/projects'
import { IssueCard } from '@/components/projects/IssueCard'
import { IssueDrawer } from '@/components/projects/IssueDrawer'
import { ProjectTypeBadge, IssueTypeBadge, IssueStatusBadge } from '@/components/projects/badges'
import { CreateIssueDialog } from '@/components/projects/dialogs'
import { Button } from '@catalyst/button'
import { PageBackground } from '@/components/shared/PageBackground'
import { cn } from '@/utils/cn'

interface ProjectHomePageProps {
  projectKey: string
}

export function ProjectHomePage({ projectKey }: ProjectHomePageProps) {
  const { projects, issues, activity, updateProject, people } = useProjectsStore()
  const { setActiveTab } = useNavigationStore()
  const project = projectSelectors.getProjectByKey(projects, projectKey)
  const [activeView, setActiveView] = useState<ProjectView>('backlog')
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)
  const [showCreateIssue, setShowCreateIssue] = useState(false)

  useEffect(() => {
    setActiveTab('execute')
  }, [setActiveTab])

  const projectIssues = useMemo(() => {
    if (!project) return []
    return issues.filter((issue) => issue.projectId === project.id)
  }, [issues, project])

  if (!project) {
    return (
      <div className="min-h-full relative overflow-hidden bg-surface-0 dark:bg-surface-900">
        <PageBackground />
        <div className="relative z-10 px-10 py-8">
          <div className="rounded-3xl glass-card border border-white/10 p-8 shadow-soft">
            <h1 className="text-2xl font-display text-ink dark:text-ink-inverse">Project not found</h1>
            <p className="mt-2 text-body-sm text-ink-muted dark:text-ink-inverse-muted">
              Double-check the project key and try again.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const ownerName = people.find((person) => person.id === project.ownerId)?.name || 'Unassigned'

  return (
    <div className="min-h-full relative overflow-hidden bg-surface-0 dark:bg-surface-900">
      <PageBackground />
      <div className="relative z-10 px-10 py-8 space-y-8">
        <div className="rounded-3xl glass-card border border-white/10 p-8 shadow-soft">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <ProjectTypeBadge type={project.type} />
              <h1 className="mt-4 text-3xl font-display text-ink dark:text-ink-inverse">{project.name}</h1>
              <p className="mt-2 text-body-sm text-ink-secondary dark:text-ink-inverse-secondary max-w-2xl">
                {project.summary || 'Add a project summary to orient the team.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-body-xs text-ink-muted dark:text-ink-inverse-muted">
                <span className="rounded-full glass-subtle border border-white/10 dark:border-white/10 px-3 py-1">
                  Key: {project.key}
                </span>
                <span className="rounded-full glass-subtle border border-white/10 dark:border-white/10 px-3 py-1">
                  Owner: {ownerName}
                </span>
                <span className="rounded-full glass-subtle border border-white/10 dark:border-white/10 px-3 py-1">
                  Type: {PROJECT_TYPE_SCHEMES[project.type].label}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button outline onClick={() => setShowCreateIssue(true)}>
                New Issue
              </Button>
              <Button color="indigo" onClick={() => setActiveView('backlog')}>
                Backlog
              </Button>
            </div>
          </div>
          <div className="mt-8 flex flex-wrap gap-2">
            {INTERNAL_PROJECT_VIEWS.map((view) => (
              <button
                key={view}
                onClick={() => setActiveView(view)}
                className={cn(
                  'px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-wider transition',
                  activeView === view
                    ? 'bg-accent/20 text-accent dark:text-accent-light'
                    : 'glass-subtle border border-white/10 dark:border-white/10 text-ink-muted dark:text-ink-inverse-muted'
                )}
              >
                {view}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-6">
        {activeView === 'dashboard' && (
          <ProjectDashboardView
            projectIssues={projectIssues}
            activity={activity.filter((entry) => entry.projectId === project.id)}
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
        {activeView === 'timeline' && (
          <ProjectTimelineView
            projectIssues={projectIssues}
            onIssueSelect={setSelectedIssueId}
          />
        )}
        {activeView === 'docs' && (
          <div className="rounded-3xl glass-card border border-white/10 p-8 text-body-sm text-ink-muted dark:text-ink-inverse-muted">
            Docs shell. Link project docs here.
          </div>
        )}
        {activeView === 'settings' && (
          <ProjectSettingsView
            allowCrossProjectParents={project.settings.allowCrossProjectParents}
            onToggle={(value) => updateProject(project.id, { settings: { allowCrossProjectParents: value } })}
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

function ProjectDashboardView({
  projectIssues,
  activity,
  onIssueSelect,
}: {
  projectIssues: Issue[]
  activity: { id: string; action: string; timestamp: number; issueId?: string; actorName?: string }[]
  onIssueSelect: (issueId: string) => void
}) {
  const statusCounts = useMemo(() => {
    return projectIssues.reduce<Record<string, number>>((acc, issue) => {
      acc[issue.status] = (acc[issue.status] || 0) + 1
      return acc
    }, {})
  }, [projectIssues])

  const typeCounts = useMemo(() => {
    return projectIssues.reduce<Record<string, number>>((acc, issue) => {
      acc[issue.type] = (acc[issue.type] || 0) + 1
      return acc
    }, {})
  }, [projectIssues])

  const blockedIssues = projectIssues.filter((issue) => issue.status === 'blocked').slice(0, 3)
  const dueSoonIssues = projectIssues
    .filter((issue) => issue.dueDate && new Date(issue.dueDate).getTime() < Date.now() + 1000 * 60 * 60 * 24 * 7)
    .slice(0, 3)
  const recentActivity = activity.slice(0, 5)

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div className="xl:col-span-2 space-y-6">
        <div className="rounded-3xl glass-card border border-white/10 p-6 shadow-soft">
          <h3 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">Status Distribution</h3>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
            {Object.keys(ISSUE_STATUS_CONFIG).map((status) => (
              <div key={status} className="rounded-2xl glass-subtle border border-white/10 dark:border-white/10 px-4 py-3">
                <p className="text-xs font-semibold text-ink dark:text-ink-inverse">
                  {ISSUE_STATUS_CONFIG[status as IssueStatus].label}
                </p>
                <p className="mt-2 text-lg font-semibold text-ink dark:text-ink-inverse">
                  {statusCounts[status] || 0}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl glass-card border border-white/10 p-6 shadow-soft">
          <h3 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">Hierarchy Counts</h3>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
            {Object.keys(ISSUE_TYPE_CONFIG).map((type) => (
              <div key={type} className="rounded-2xl glass-subtle border border-white/10 dark:border-white/10 px-4 py-3">
                <p className="text-xs font-semibold text-ink dark:text-ink-inverse">
                  {ISSUE_TYPE_CONFIG[type as IssueTypeKey].label}
                </p>
                <p className="mt-2 text-lg font-semibold text-ink dark:text-ink-inverse">
                  {typeCounts[type] || 0}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <DashboardList
          title="Blocked"
          issues={blockedIssues}
          onIssueSelect={onIssueSelect}
          emptyLabel="No blocked items."
        />
        <DashboardList
          title="Due Soon"
          issues={dueSoonIssues}
          onIssueSelect={onIssueSelect}
          emptyLabel="No due dates in the next 7 days."
        />
        <div className="rounded-3xl glass-card border border-white/10 p-6 shadow-soft">
          <h3 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">Recent Activity</h3>
          <div className="mt-4 space-y-3">
            {recentActivity.length === 0 ? (
              <p className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">No activity yet.</p>
            ) : (
              recentActivity.map((entry) => (
                <div key={entry.id} className="rounded-xl glass-subtle border border-white/10 dark:border-white/10 px-3 py-3">
                  <p className="text-body-xs font-semibold text-ink dark:text-ink-inverse">
                    {entry.actorName || 'System'} · {entry.action}
                  </p>
                  <p className="mt-2 text-[11px] uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
                    {new Date(entry.timestamp).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function DashboardList({
  title,
  issues,
  onIssueSelect,
  emptyLabel,
}: {
  title: string
  issues: Issue[]
  onIssueSelect: (issueId: string) => void
  emptyLabel: string
}) {
  return (
    <div className="rounded-3xl glass-card border border-white/10 p-6 shadow-soft">
      <h3 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">{title}</h3>
      <div className="mt-4 space-y-3">
        {issues.length === 0 ? (
          <p className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">{emptyLabel}</p>
        ) : (
          issues.map((issue) => (
            <IssueCard key={issue.id} issue={issue} compact onClick={() => onIssueSelect(issue.id)} />
          ))
        )}
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
  const { moveIssueInParent, reparentIssue, swapIssueRank } = useProjectsStore()
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

  const handleDropOnIssue = (targetId: string, draggedId: string) => {
    if (targetId === draggedId) return
    const dragged = projectIssues.find((item) => item.id === draggedId)
    const target = projectIssues.find((item) => item.id === targetId)
    if (!dragged || !target) return

    if (STANDARD_HIERARCHY[target.type] === dragged.type) {
      reparentIssue(dragged.id, target.id)
      return
    }

    if ((dragged.parentId || null) === (target.parentId || null)) {
      swapIssueRank(dragged.id, target.id)
    }
  }

  const handleDropToRoot = (draggedId: string) => {
    const dragged = projectIssues.find((item) => item.id === draggedId)
    if (!dragged) return
    if (!projectSelectors.isRootTypeAllowed(dragged.type)) return
    reparentIssue(dragged.id, null)
  }

  return (
    <div
      className="rounded-3xl glass-card border border-white/10 p-6 shadow-soft"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const draggedId = event.dataTransfer.getData('text/plain')
        if (draggedId) handleDropToRoot(draggedId)
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">Hierarchy</h3>
        <Button
          outline
          onClick={() => {
            setActiveParentId(null)
            setShowCreateChild(true)
          }}
        >
          <Plus data-slot="icon" />
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
  const canHaveChildren = STANDARD_HIERARCHY[issue.type] !== null

  return (
    <div>
      <div
        className="flex items-center gap-3 rounded-2xl glass-subtle border border-white/10 dark:border-white/10 px-4 py-3 hover:border-accent/30 transition-colors"
        style={{ marginLeft: level * 20 }}
        draggable
        onDragStart={(event) => event.dataTransfer.setData('text/plain', issue.id)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          const draggedId = event.dataTransfer.getData('text/plain')
          if (draggedId) onDropIssue(issue.id, draggedId)
        }}
      >
        <button
          onClick={() => onToggle(issue.id)}
          className="text-ink-muted dark:text-ink-inverse-muted"
        >
          {children.length > 0 ? (
            isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
          ) : (
            <span className="w-4 h-4 inline-block" />
          )}
        </button>
        <div className="flex-1">
          <button onClick={() => onSelect(issue.id)} className="text-left">
            <div className="flex items-center gap-2">
              <IssueTypeBadge type={issue.type} />
              <IssueStatusBadge status={issue.status} />
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
          <button onClick={() => onMove(issue.id, 'up')} className="p-1 rounded-lg hover:bg-surface-100/60 dark:hover:bg-surface-800/60">
            <ArrowUp className="w-4 h-4" />
          </button>
          <button onClick={() => onMove(issue.id, 'down')} className="p-1 rounded-lg hover:bg-surface-100/60 dark:hover:bg-surface-800/60">
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
  const { reparentIssue } = useProjectsStore()
  const [selectedParent, setSelectedParent] = useState(issue.parentId || '')
  const requiredParentType = REQUIRED_PARENT_BY_CHILD[issue.type]
  const allowNoParent = requiredParentType === null

  const availableParents = requiredParentType
    ? issues.filter((candidate) => candidate.type === requiredParentType && candidate.id !== issue.id)
    : []

  const handleSubmit = () => {
    if (!allowNoParent && !selectedParent) return
    reparentIssue(issue.id, selectedParent || null)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-3xl glass-card border border-white/10 p-6 shadow-2xl">
        <h3 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">Reparent Issue</h3>
        <p className="mt-2 text-body-xs text-ink-muted dark:text-ink-inverse-muted">
          Select a valid parent ({requiredParentType || 'none'}).
        </p>
        <select
          value={selectedParent}
          onChange={(e) => setSelectedParent(e.target.value)}
          className="mt-4 w-full rounded-xl glass-subtle border border-white/10 dark:border-white/10 px-3 py-2 text-body-sm"
        >
          {allowNoParent && <option value="">No parent</option>}
          {availableParents.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.title}
            </option>
          ))}
        </select>
        <div className="mt-6 flex justify-end gap-3">
          <Button outline onClick={onClose}>Cancel</Button>
          <Button color="indigo" onClick={handleSubmit}>Update Parent</Button>
        </div>
      </div>
    </div>
  )
}

const REQUIRED_PARENT_BY_CHILD: Record<IssueTypeKey, IssueTypeKey | null> = {
  initiative: null,
  epic: 'initiative',
  story: 'epic',
  task: 'story',
  subtask: 'task',
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
  const { moveIssueStatus } = useProjectsStore()
  const scheme = PROJECT_TYPE_SCHEMES[projectType as keyof typeof PROJECT_TYPE_SCHEMES]
  const [visibleTypes, setVisibleTypes] = useState<IssueTypeKey[]>(scheme.boardIssueTypes)
  const [createStatus, setCreateStatus] = useState<IssueStatus | null>(null)

  const columns = scheme.statuses

  const boardIssues = projectIssues.filter((issue) => visibleTypes.includes(issue.type))

  const handleDrop = (status: IssueStatus, issueId: string) => {
    moveIssueStatus(issueId, status)
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
            onClick={() => toggleType(type)}
            className={cn(
              'px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider',
              visibleTypes.includes(type)
                ? 'bg-accent/20 text-accent dark:text-accent-light'
                : 'glass-subtle border border-white/10 dark:border-white/10 text-ink-muted dark:text-ink-inverse-muted'
            )}
          >
            {ISSUE_TYPE_CONFIG[type].label}
          </button>
        ))}
      </div>
      <div className="flex gap-4 overflow-x-auto">
        {columns.map((status) => (
          <div
            key={status}
            className="w-80 flex-shrink-0 rounded-3xl glass-card border border-white/10 p-4 shadow-soft"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const issueId = event.dataTransfer.getData('text/plain')
              if (issueId) handleDrop(status, issueId)
            }}
          >
            <div className="flex items-center justify-between">
              <IssueStatusBadge status={status} />
              <button
                onClick={() => setCreateStatus(status)}
                className="text-body-xs text-accent dark:text-accent-light rounded-full px-2 py-1 glass-subtle border border-white/10 dark:border-white/10"
              >
                +
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {boardIssues.filter((issue) => issue.status === status).map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  compact
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', issue.id)}
                  onClick={() => onIssueSelect(issue.id)}
                />
              ))}
            </div>
          </div>
        ))}
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

  return (
    <div className="rounded-3xl glass-card border border-white/10 p-6 shadow-soft">
      <table className="w-full text-left text-body-xs">
        <thead>
          <tr className="text-ink-muted dark:text-ink-inverse-muted border-b border-white/10">
            <th className="pb-3">Issue</th>
            <th className="pb-3">Status</th>
            <th className="pb-3">Priority</th>
            <th className="pb-3">Assignee</th>
            <th className="pb-3">Due</th>
          </tr>
        </thead>
        <tbody>
          {projectIssues.map((issue) => (
            <tr key={issue.id} className="border-t border-white/10">
              <td className="py-3">
                <button onClick={() => onIssueSelect(issue.id)} className="flex items-center gap-2">
                  <IssueTypeBadge type={issue.type} />
                  <span className="text-body-sm font-semibold text-ink dark:text-ink-inverse">{issue.title}</span>
                </button>
              </td>
              <td className="py-3">
                <select
                  value={issue.status}
                  onChange={(e) => updateIssue(issue.id, { status: e.target.value as IssueStatus })}
                  className="rounded-lg glass-subtle border border-white/10 dark:border-white/10 px-2 py-1"
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
                  value={issue.priority}
                  onChange={(e) => updateIssue(issue.id, { priority: e.target.value as IssuePriority })}
                  className="rounded-lg glass-subtle border border-white/10 dark:border-white/10 px-2 py-1"
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </td>
              <td className="py-3">
                <select
                  value={issue.assignees[0] || ''}
                  onChange={(e) => updateIssue(issue.id, { assignees: e.target.value ? [e.target.value] : [] })}
                  className="rounded-lg glass-subtle border border-white/10 dark:border-white/10 px-2 py-1"
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
                  type="date"
                  value={issue.dueDate ? issue.dueDate.slice(0, 10) : ''}
                  onChange={(e) => updateIssue(issue.id, { dueDate: e.target.value || undefined })}
                  className="rounded-lg glass-subtle border border-white/10 dark:border-white/10 px-2 py-1"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
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

  const items = projectIssues.filter((issue) => issue.startDate || issue.endDate || issue.dueDate)

  return (
    <div className="rounded-3xl glass-card border border-white/10 p-6 shadow-soft">
      <div className="flex items-center justify-between">
        <h3 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">Timeline</h3>
        <span className="text-[11px] uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
          {timelineStart.toLocaleDateString()} - {timelineEnd.toLocaleDateString()}
        </span>
      </div>
      <div className="mt-6 space-y-4">
        {items.length === 0 ? (
          <p className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">No scheduled items.</p>
        ) : (
          items.map((issue) => {
            const start = issue.startDate ? new Date(issue.startDate) : issue.dueDate ? new Date(issue.dueDate) : new Date(issue.createdAt)
            const end = issue.endDate ? new Date(issue.endDate) : issue.dueDate ? new Date(issue.dueDate) : new Date(start.getTime() + 1000 * 60 * 60 * 24 * 7)
            const left = Math.max(0, ((start.getTime() - timelineStart.getTime()) / totalMs) * 100)
            const width = Math.min(100 - left, ((end.getTime() - start.getTime()) / totalMs) * 100)

            return (
              <div key={issue.id} className="relative">
                <button onClick={() => onIssueSelect(issue.id)} className="flex items-center gap-2">
                  <IssueTypeBadge type={issue.type} />
                  <span className="text-body-sm font-semibold text-ink dark:text-ink-inverse">{issue.title}</span>
                </button>
                <div className="mt-2 h-3 rounded-full glass-subtle border border-white/10 dark:border-white/10 relative">
                  <div
                    className="absolute h-3 rounded-full bg-accent/60"
                    style={{ left: `${left}%`, width: `${Math.max(width, 4)}%` }}
                  />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function ProjectSettingsView({
  allowCrossProjectParents,
  onToggle,
}: {
  allowCrossProjectParents: boolean
  onToggle: (value: boolean) => void
}) {
  return (
    <div className="rounded-3xl glass-card border border-white/10 p-6 shadow-soft">
      <h3 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">Project Settings</h3>
      <div className="mt-4 flex items-center justify-between rounded-2xl glass-subtle border border-white/10 dark:border-white/10 px-4 py-4">
        <div>
          <p className="text-body-sm font-semibold text-ink dark:text-ink-inverse">Allow cross-project parenting</p>
          <p className="mt-1 text-body-xs text-ink-muted dark:text-ink-inverse-muted">
            Disabled by default to keep hierarchy clean.
          </p>
        </div>
        <button
          onClick={() => onToggle(!allowCrossProjectParents)}
          className={cn(
            'px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-wider',
            allowCrossProjectParents
              ? 'bg-accent/20 text-accent dark:text-accent-light'
              : 'glass-subtle border border-white/10 dark:border-white/10 text-ink-muted dark:text-ink-inverse-muted'
          )}
        >
          {allowCrossProjectParents ? 'Enabled' : 'Disabled'}
        </button>
      </div>
    </div>
  )
}
