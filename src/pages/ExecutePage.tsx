import { useMemo, useState, useEffect } from 'react'
import { Plus, FolderKanban, Filter, X, Search, ChevronDown } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { useTaskStore } from '@/stores/taskStore'
import { KanbanBoard, CalendarView } from '@/components/board'
import { TaskDetailView } from '@/components/board/task-detail'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import {
  Task,
  TaskPriority,
  TaskStatus,
  TaskType,
  TASK_PRIORITY_CONFIG,
  TASK_STATUS_CONFIG,
} from '@/pages/types/task'
import { CreateIssueDialog, CreateProjectDialog } from '@/components/projects/dialogs'
import { PageBackground } from '@/components/shared/PageBackground'
import { cn } from '@/utils/cn'
import { motion, AnimatePresence } from 'framer-motion'

export function ExecutePage() {
  const { user } = useAuthStore()
  const { setActiveTab } = useNavigationStore()
  const { tasks, updateTask } = useTaskStore()
  const [activeView, setActiveView] = useState<'kanban' | 'calendar' | 'gantt' | 'list'>('kanban')
  const [calendarMode, setCalendarMode] = useState<'day' | 'week' | 'month' | 'quarter'>('week')
  
  // Filter states
  const [projectFilter, setProjectFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all')
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<TaskType | 'all'>('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [dueFilter, setDueFilter] = useState<'all' | 'overdue' | 'due-soon' | 'none'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  
  const [showIssueDialog, setShowIssueDialog] = useState(false)
  const [showProjectDialog, setShowProjectDialog] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  
  const currentUserName = (user as unknown as { user_metadata?: { full_name?: string } })?.user_metadata?.full_name || user?.email || ''

  useEffect(() => {
    setActiveTab('execute')
  }, [setActiveTab])

  const projectOptions = useMemo(() => {
    const map = new Map<string, string>()
    let hasPersonal = false
    tasks.forEach((task) => {
      if (task.projectId || task.projectName) {
        const key = task.projectId || task.projectName!
        map.set(key, task.projectName || task.projectId!)
      } else {
        hasPersonal = true
      }
    })
    const options = Array.from(map.entries()).map(([value, label]) => ({ value, label }))
    if (hasPersonal) options.unshift({ value: 'personal', label: 'Personal' })
    return options
  }, [tasks])

  const assigneeOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    tasks.forEach((task) => {
      task.assignees.forEach((assignee) => {
        map.set(assignee.id, { id: assignee.id, name: assignee.name })
      })
    })
    return Array.from(map.values())
  }, [tasks])

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const matchesTitle = task.title.toLowerCase().includes(query)
        const matchesId = task.id.toLowerCase().includes(query)
        const matchesDesc = task.description?.toLowerCase().includes(query)
        if (!matchesTitle && !matchesId && !matchesDesc) return false
      }
      
      const projectKey = task.projectId || task.projectName || 'personal'
      if (projectFilter !== 'all' && projectKey !== projectFilter) return false
      if (statusFilter !== 'all' && task.status !== statusFilter) return false
      const taskPriority = task.priority || 'medium'
      if (priorityFilter !== 'all' && taskPriority !== priorityFilter) return false
      const taskType = task.type || 'other'
      if (typeFilter !== 'all' && taskType !== typeFilter) return false
      if (dueFilter !== 'all') {
        const due = task.dueDate ?? null
        if (dueFilter === 'none' && due) return false
        if (dueFilter === 'overdue') {
          if (!due || due > Date.now()) return false
        }
        if (dueFilter === 'due-soon') {
          if (!due || due > Date.now() + 1000 * 60 * 60 * 24 * 7) return false
        }
      }
      if (assigneeFilter === 'me') {
        if (!currentUserName) return true
        const lower = currentUserName.toLowerCase()
        return task.assignees.some((assignee) => assignee.name.toLowerCase() === lower)
      }
      if (assigneeFilter !== 'all') {
        return task.assignees.some((assignee) => assignee.id === assigneeFilter)
      }
      return true
    })
  }, [
    tasks,
    projectFilter,
    statusFilter,
    priorityFilter,
    typeFilter,
    assigneeFilter,
    dueFilter,
    searchQuery,
    currentUserName,
  ])

  // Count active filters
  const activeFilterCount = [
    projectFilter !== 'all',
    statusFilter !== 'all',
    priorityFilter !== 'all',
    typeFilter !== 'all',
    assigneeFilter !== 'all',
    dueFilter !== 'all',
  ].filter(Boolean).length

  const clearFilters = () => {
    setProjectFilter('all')
    setStatusFilter('all')
    setPriorityFilter('all')
    setTypeFilter('all')
    setAssigneeFilter('all')
    setDueFilter('all')
    setSearchQuery('')
  }

  const navigateInternal = (url: string) => {
    if (typeof window !== 'undefined' && window.electron?.browser) {
      window.electron.browser.navigate(url)
    }
  }

  return (
    <div className="min-h-full relative overflow-hidden bg-surface-0 dark:bg-surface-900">
      <PageBackground />
      <div className="relative z-10 px-6 py-6 space-y-6">
        
        {/* Header Section - Unified and sophisticated */}
        <div className={cn(
          "rounded-2xl border border-surface-200 dark:border-surface-800",
          "bg-surface-0 dark:bg-surface-900",
          "shadow-soft",
          "overflow-hidden"
        )}>
          {/* Top Bar */}
          <div className="px-6 py-5 border-b border-surface-200 dark:border-surface-800">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className={cn(
                  "w-10 h-10 rounded-xl",
                  "bg-gradient-to-br from-indigo-500 to-violet-600",
                  "flex items-center justify-center",
                  "text-white"
                )}>
                  <FolderKanban className="w-5 h-5" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-ink dark:text-ink-inverse">
                    Operational Hub
                  </h1>
                  <p className="text-body-sm text-ink-muted dark:text-ink-inverse-muted">
                    {filteredTasks.length} tasks • {activeFilterCount > 0 ? `${activeFilterCount} filters active` : 'All tasks'}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <ActionButton variant="ghost" onClick={() => setShowProjectDialog(true)}>
                  New Project
                </ActionButton>
                <ActionButton variant="primary" onClick={() => setShowIssueDialog(true)}>
                  <Plus className="w-4 h-4" />
                  New Issue
                </ActionButton>
              </div>
            </div>
          </div>

          {/* Filter Bar - More sophisticated layout */}
          <div className="px-6 py-4 bg-surface-50/50 dark:bg-surface-850/50">
            <div className="flex flex-wrap items-center gap-3">
              {/* Search Input - Prominent */}
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search tasks..."
                  className={cn(
                    "w-full pl-10 pr-4 py-2.5 rounded-xl",
                    "bg-surface-0 dark:bg-surface-900",
                    "border border-surface-200 dark:border-surface-800",
                    "text-body-sm text-ink dark:text-ink-inverse",
                    "placeholder:text-ink-muted/50",
                    "focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-600",
                    "transition-colors"
                  )}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Filter Toggle Button */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={cn(
                  "flex items-center gap-2",
                  "px-4 py-2.5 rounded-xl",
                  "text-body-sm font-medium",
                  "border transition-all duration-200",
                  showFilters || activeFilterCount > 0
                    ? 'border-indigo-400 dark:border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-indigo-500/5'
                    : 'border-surface-200 dark:border-surface-800 text-ink-muted dark:text-ink-inverse-muted hover:border-indigo-300'
                )}
              >
                <Filter className="w-4 h-4" />
                <span>Filters</span>
                {activeFilterCount > 0 && (
                  <span className={cn(
                    "ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold",
                    "bg-indigo-500 text-white"
                  )}>
                    {activeFilterCount}
                  </span>
                )}
                <ChevronDown className={cn(
                  "w-4 h-4 transition-transform duration-200",
                  showFilters && "rotate-180"
                )} />
              </button>

              {/* View Switcher - Integrated */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-200/50 dark:bg-surface-800/50">
                {EXECUTE_VIEWS.map((view) => (
                  <button
                    key={view.id}
                    onClick={() => setActiveView(view.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-body-sm font-medium transition-all duration-200",
                      activeView === view.id
                        ? 'bg-surface-0 dark:bg-surface-700 text-ink dark:text-ink-inverse shadow-sm'
                        : 'text-ink-muted dark:text-ink-inverse-muted hover:text-ink dark:hover:text-ink-inverse'
                    )}
                  >
                    {view.label}
                  </button>
                ))}
              </div>

              {/* Projects Link */}
              <button
                onClick={() => navigateInternal('ron://projects')}
                className={cn(
                  "flex items-center gap-2",
                  "px-4 py-2.5 rounded-xl",
                  "text-body-sm font-medium",
                  "text-ink-muted dark:text-ink-inverse-muted",
                  "hover:text-indigo-600 dark:hover:text-indigo-400",
                  "hover:bg-indigo-500/5",
                  "transition-colors"
                )}
              >
                <FolderKanban className="w-4 h-4" />
                <span>Projects</span>
              </button>
            </div>

            {/* Expandable Filter Panel */}
            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="pt-4 mt-4 border-t border-surface-200 dark:border-surface-800">
                    <div className="flex flex-wrap items-start gap-4">
                      {/* Filter Groups */}
                      <FilterGroup label="Project">
                        <FilterSelect value={projectFilter} onChange={setProjectFilter}>
                          <option value="all">All Projects</option>
                          {projectOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </FilterSelect>
                      </FilterGroup>

                      <FilterGroup label="Status">
                        <FilterSelect 
                          value={statusFilter} 
                          onChange={(value) => setStatusFilter(value as TaskStatus | 'all')}
                        >
                          <option value="all">All Statuses</option>
                          <option value="backlog">Backlog</option>
                          <option value="in-progress">In Progress</option>
                          <option value="review">Review</option>
                          <option value="blocked">Blocked</option>
                          <option value="done">Done</option>
                        </FilterSelect>
                      </FilterGroup>

                      <FilterGroup label="Priority">
                        <FilterSelect 
                          value={priorityFilter} 
                          onChange={(value) => setPriorityFilter(value as TaskPriority | 'all')}
                        >
                          <option value="all">All Priorities</option>
                          {Object.entries(TASK_PRIORITY_CONFIG).map(([key, config]) => (
                            <option key={key} value={key}>{config.label}</option>
                          ))}
                        </FilterSelect>
                      </FilterGroup>

                      <FilterGroup label="Type">
                        <FilterSelect 
                          value={typeFilter} 
                          onChange={(value) => setTypeFilter(value as TaskType | 'all')}
                        >
                          <option value="all">All Types</option>
                          <option value="feature">Feature</option>
                          <option value="bug">Bug</option>
                          <option value="improvement">Improvement</option>
                          <option value="research">Research</option>
                          <option value="documentation">Documentation</option>
                          <option value="support">Support</option>
                          <option value="other">Other</option>
                        </FilterSelect>
                      </FilterGroup>

                      <FilterGroup label="Assignee">
                        <FilterSelect value={assigneeFilter} onChange={setAssigneeFilter}>
                          <option value="all">All assignees</option>
                          {currentUserName && <option value="me">Assigned to me</option>}
                          {assigneeOptions.map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.name}
                            </option>
                          ))}
                        </FilterSelect>
                      </FilterGroup>

                      <FilterGroup label="Due Date">
                        <FilterSelect value={dueFilter} onChange={(value) => setDueFilter(value as any)}>
                          <option value="all">Any time</option>
                          <option value="due-soon">Due in 7 days</option>
                          <option value="overdue">Overdue</option>
                          <option value="none">No due date</option>
                        </FilterSelect>
                      </FilterGroup>

                      {/* Clear Filters */}
                      {activeFilterCount > 0 && (
                        <div className="flex items-end">
                          <button
                            onClick={clearFilters}
                            className={cn(
                              "px-4 py-2.5 rounded-xl",
                              "text-body-sm font-medium",
                              "text-ink-muted dark:text-ink-inverse-muted",
                              "hover:text-rose-500",
                              "hover:bg-rose-500/5",
                              "transition-colors"
                            )}
                          >
                            Clear all
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Content Area */}
        {activeView === 'kanban' && (
          <div className={cn(
            "rounded-2xl border border-surface-200 dark:border-surface-800",
            "bg-surface-0 dark:bg-surface-900",
            "shadow-soft",
            "p-4"
          )}>
            <ErrorBoundary componentName="KanbanBoard">
              <KanbanBoard />
            </ErrorBoundary>
          </div>
        )}

        {activeView === 'calendar' && (
          <CalendarView mode={calendarMode} onModeChange={setCalendarMode} />
        )}

        {activeView === 'gantt' && (
          <ExecuteGanttView tasks={filteredTasks} onTaskClick={setSelectedTask} />
        )}

        {activeView === 'list' && (
          <ExecuteListView
            tasks={filteredTasks}
            onTaskClick={setSelectedTask}
          />
        )}

        <CreateIssueDialog isOpen={showIssueDialog} onClose={() => setShowIssueDialog(false)} />
        <CreateProjectDialog isOpen={showProjectDialog} onClose={() => setShowProjectDialog(false)} />
        {selectedTask && (
          <TaskDetailPortal task={selectedTask} onClose={() => setSelectedTask(null)} onUpdate={updateTask} />
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FILTER COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
        {label}
      </label>
      {children}
    </div>
  )
}

function FilterSelect({
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'min-w-[140px] px-3 py-2 rounded-lg',
        'bg-surface-0 dark:bg-surface-900',
        'border border-surface-200 dark:border-surface-800',
        'text-body-sm text-ink dark:text-ink-inverse',
        'focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-600',
        'transition-colors cursor-pointer'
      )}
    >
      {children}
    </select>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION BUTTON
// ─────────────────────────────────────────────────────────────────────────────

function ActionButton({
  variant,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant: 'primary' | 'ghost' }) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center gap-2 h-10 px-4 rounded-xl text-body-sm font-medium transition-colors',
        variant === 'primary'
          ? 'bg-indigo-500 text-white hover:bg-indigo-600 shadow-sm shadow-indigo-500/20'
          : 'text-ink-muted dark:text-ink-inverse-muted hover:text-ink dark:hover:text-ink-inverse hover:bg-surface-100 dark:hover:bg-surface-800',
        className
      )}
    >
      {children}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEW CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const EXECUTE_VIEWS: { id: 'kanban' | 'calendar' | 'gantt' | 'list'; label: string }[] = [
  { id: 'kanban', label: 'Kanban' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'gantt', label: 'Gantt' },
  { id: 'list', label: 'List' },
]

// ─────────────────────────────────────────────────────────────────────────────
// LIST VIEW
// ─────────────────────────────────────────────────────────────────────────────

function ExecuteListView({
  tasks,
  onTaskClick,
}: {
  tasks: Task[]
  onTaskClick: (task: Task) => void
}) {
  return (
    <div className={cn(
      "rounded-2xl border border-surface-200 dark:border-surface-800",
      "bg-surface-0 dark:bg-surface-900",
      "shadow-soft",
      "overflow-hidden"
    )}>
      <table className="w-full text-left text-body-sm">
        <thead>
          <tr className="text-ink-muted dark:text-ink-inverse-muted border-b border-surface-200 dark:border-surface-800 bg-surface-50/50 dark:bg-surface-850/50">
            <th className="py-3 px-4 font-medium">Task</th>
            <th className="py-3 px-4 font-medium">Status</th>
            <th className="py-3 px-4 font-medium">Priority</th>
            <th className="py-3 px-4 font-medium">Assignees</th>
            <th className="py-3 px-4 font-medium">Due</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr 
              key={task.id} 
              className="border-b border-surface-200 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-850/50 transition-colors"
            >
              <td className="py-3 px-4">
                <button 
                  onClick={() => onTaskClick(task)} 
                  className="font-medium text-ink dark:text-ink-inverse hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  {task.title}
                </button>
                <span className="ml-2 text-[10px] text-ink-muted uppercase">{task.id}</span>
              </td>
              <td className="py-3 px-4">
                <StatusBadge status={task.status} />
              </td>
              <td className="py-3 px-4">
                <PriorityBadge priority={task.priority || 'medium'} />
              </td>
              <td className="py-3 px-4">
                <div className="flex -space-x-1.5">
                  {task.assignees.slice(0, 3).map((assignee) => (
                    <div
                      key={assignee.id}
                      className={cn(
                        "w-6 h-6 rounded-full",
                        "bg-gradient-to-br from-indigo-500 to-violet-600",
                        "border-2 border-surface-0 dark:border-surface-900",
                        "flex items-center justify-center",
                        "text-[8px] font-bold text-white"
                      )}
                    >
                      {assignee.initials}
                    </div>
                  ))}
                </div>
              </td>
              <td className="py-3 px-4 text-ink-muted dark:text-ink-inverse-muted">
                {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const config = TASK_STATUS_CONFIG[status]
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-md",
      "text-[10px] font-semibold uppercase tracking-wider",
      config.color.replace('text-', 'bg-').replace('600', '500') + '/10',
      config.color
    )}>
      {config.label}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const config = TASK_PRIORITY_CONFIG[priority]
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-md",
      "text-[10px] font-semibold uppercase tracking-wider",
      config.color.replace('text-', 'bg-').replace('600', '500') + '/10',
      config.color
    )}>
      {config.label}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GANTT VIEW
// ─────────────────────────────────────────────────────────────────────────────

function ExecuteGanttView({
  tasks,
  onTaskClick,
}: {
  tasks: Task[]
  onTaskClick: (task: Task) => void
}) {
  const windowStart = useMemo(() => {
    const start = new Date()
    start.setDate(start.getDate() - 7)
    return start
  }, [])
  const windowEnd = useMemo(() => {
    const end = new Date()
    end.setDate(end.getDate() + 28)
    return end
  }, [])
  const totalMs = windowEnd.getTime() - windowStart.getTime()

  const items = tasks.map((task) => {
    const start = task.startDate ? new Date(task.startDate) : new Date(task.createdAt)
    const end = task.dueDate ? new Date(task.dueDate) : new Date(start.getTime() + 1000 * 60 * 60 * 24 * 7)
    return { task, start, end }
  })

  return (
    <div className={cn(
      "rounded-2xl border border-surface-200 dark:border-surface-800",
      "bg-surface-0 dark:bg-surface-900",
      "shadow-soft",
      "p-6"
    )}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">Timeline</h2>
        <span className="text-[11px] uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
          {windowStart.toLocaleDateString()} – {windowEnd.toLocaleDateString()}
        </span>
      </div>
      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="text-body-sm text-ink-muted dark:text-ink-inverse-muted">No scheduled tasks.</p>
        ) : (
          items.map(({ task, start, end }) => {
            const left = Math.max(0, ((start.getTime() - windowStart.getTime()) / totalMs) * 100)
            const width = Math.min(100 - left, ((end.getTime() - start.getTime()) / totalMs) * 100)
            return (
              <div key={task.id} className="space-y-2">
                <button 
                  onClick={() => onTaskClick(task)} 
                  className="text-body-sm font-medium text-ink dark:text-ink-inverse hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  {task.title}
                </button>
                <div className="h-2 rounded-full bg-surface-200 dark:bg-surface-800 relative overflow-hidden">
                  <div
                    className="absolute h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                    style={{ left: `${left}%`, width: `${Math.max(width, 2)}%` }}
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

// ─────────────────────────────────────────────────────────────────────────────
// TASK DETAIL PORTAL
// ─────────────────────────────────────────────────────────────────────────────

function TaskDetailPortal({
  task,
  onClose,
  onUpdate,
}: {
  task: Task
  onClose: () => void
  onUpdate: (taskId: string, updates: Partial<Task>) => void
}) {
  return (
    <ErrorBoundary componentName="TaskDetailView">
      <div className="fixed inset-0 z-[100]">
        <TaskDetailView
          task={task}
          onClose={onClose}
          onUpdate={(updated: Task) => onUpdate(updated.id, updated)}
        />
      </div>
    </ErrorBoundary>
  )
}
