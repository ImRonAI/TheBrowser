import { motion } from 'framer-motion'
import type { Task, TaskPriority, TaskStatus, TaskLabel } from '@/pages/types/task'
import { TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG } from '@/pages/types/task'
import { useTaskStore } from '@/stores/taskStore'
import { RelationshipManager } from './RelationshipManager'
import { RelationshipSummary } from './RelationshipSummary'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import {
    Plus as PlusIcon,
    Calendar as CalendarIcon,
    FileText as DocumentIcon,
    Mail as MailIcon,
    Video as VideoIcon,
    ExternalLink as ExternalLinkIcon,
    ArrowUpLeft as ArrowUpLeftIcon
} from 'lucide-react'
import { cn } from '@/utils/cn'

/** A select-like value field: paper surface, hairline border. */
const FIELD = cn(
  'flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left',
  'border border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-900',
  'text-[13px] font-medium text-ink dark:text-ink-inverse',
  'transition-colors duration-150 hover:border-surface-300 dark:hover:border-surface-700'
)

/** A dashed "add" affordance that warms to volt on hover. */
const ADD_FIELD = cn(
  'flex h-9 w-full items-center justify-center gap-2 rounded-lg',
  'border border-dashed border-surface-300 dark:border-surface-700',
  'text-[13px] font-medium text-ink-muted dark:text-ink-inverse-muted',
  'transition-colors duration-150',
  'hover:border-blurple-500 hover:text-blurple-700 dark:hover:border-blurple-400 dark:hover:text-blurple-300'
)

/** A bordered paper card for grouped read-outs. */
const CARD = 'rounded-xl border border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-900'

interface TaskMetadataSidebarProps {
  task: Task
  onUpdate?: (task: Task) => void
  onTaskClick?: (taskId: string) => void
}

export function TaskMetadataSidebar({ task, onUpdate: _onUpdate, onTaskClick }: TaskMetadataSidebarProps) {
  const tasks = useTaskStore(state => state.tasks)
  const parentTask = task.parentTaskId ? tasks.find(t => t.id === task.parentTaskId) : null

  return (
    <div className={cn(
      // Transparent: the sheet's paper shows through, and the tab pane's hairline separates the two.
      "w-72 flex-shrink-0",
      "text-ink dark:text-ink-inverse",
      "overflow-y-auto scrollbar-thin"
    )}>
      <div className="space-y-6 px-3 py-5">
        {/* Parent Task Navigation */}
        {task.parentTaskId && (
          <MetadataSection title="Parent task">
            <button
              type="button"
              onClick={() => onTaskClick?.(task.parentTaskId!)}
              className={cn(
                "group flex w-full items-center gap-2.5 px-3 py-2.5 text-left",
                CARD,
                "transition-colors duration-150 hover:border-surface-300 dark:hover:border-surface-700"
              )}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-blurple-600/10 text-blurple-700 dark:bg-blurple-400/15 dark:text-blurple-300">
                <ArrowUpLeftIcon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-blurple-700 dark:text-blurple-300">
                  Return to parent
                </span>
                <span className="block truncate text-[13px] font-medium text-ink dark:text-ink-inverse">
                  {parentTask?.title || task.parentTaskId}
                </span>
              </span>
            </button>
          </MetadataSection>
        )}

        {/* Relationships */}
        <MetadataSection title="Relationships">
          <ErrorBoundary componentName="RelationshipSummary">
            <RelationshipSummary task={task} onTaskClick={onTaskClick} />
          </ErrorBoundary>

          <RelationshipManager
            task={task}
            onRelationshipAdd={(_category, targetId, relType) => {
              useTaskStore.getState().addRelationship(
                task.id,
                targetId,
                (relType as any) || 'relates-to'
              )
            }}
            onRelationshipRemove={(relId) => {
              useTaskStore.getState().removeRelationship(task.id, relId)
            }}
          />
        </MetadataSection>

        {/* Status */}
        <MetadataSection title="Status">
          <StatusSelect value={task.status} />
        </MetadataSection>

        {/* Priority */}
        <MetadataSection title="Priority">
          <PrioritySelect value={task.priority} />
        </MetadataSection>

        {/* Assignees */}
        <MetadataSection title="Assignees">
          <AssigneeList assignees={task.assignees} />
        </MetadataSection>

        {/* Due Date */}
        <MetadataSection title="Due date">
          <DateDisplay date={task.dueDate} />
        </MetadataSection>

        {/* Labels */}
        {task.labels.length > 0 && (
          <MetadataSection title="Labels">
            <LabelList labels={task.labels} />
          </MetadataSection>
        )}

        {/* Progress */}
        {task.subtasks.length > 0 && (
          <MetadataSection title="Progress">
            <ProgressIndicator
              completed={task.subtasks.filter(s => s.completed).length}
              total={task.subtasks.length}
            />
          </MetadataSection>
        )}

        {/* Estimated Effort */}
        {task.estimatedEffort && (
          <MetadataSection title="Estimated effort">
            <EffortBadge effort={task.estimatedEffort} />
          </MetadataSection>
        )}

        {/* Time Spent */}
        {task.actualTimeSpent && (
          <MetadataSection title="Time spent">
            <TimeDisplay minutes={task.actualTimeSpent} />
          </MetadataSection>
        )}

        {/* AI Insights */}
        {(task.complexityScore || task.riskScore || task.completionConfidence) && (
          <MetadataSection title="AI insights">
            <AIInsights task={task} />
          </MetadataSection>
        )}

        {/* Dependencies */}
        {task.dependencies && task.dependencies.length > 0 && (
          <MetadataSection title="Dependencies">
            <DependencyList dependencies={task.dependencies} />
          </MetadataSection>
        )}

        {/* Links & Integrations */}
        <MetadataSection title="Links">
          <LinksList task={task} />
        </MetadataSection>

        {/* Timestamps */}
        <MetadataSection title="History">
          <TimestampsList task={task} />
        </MetadataSection>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// METADATA SECTION — mono micro-label, then the value
// ─────────────────────────────────────────────────────────────────────────────

interface MetadataSectionProps {
  title: string
  children: React.ReactNode
}

function MetadataSection({ title, children }: MetadataSectionProps) {
  return (
    <div className="space-y-2">
      <h4 className={cn(
        "px-1 font-mono text-[11px] font-medium uppercase leading-none tracking-[0.08em]",
        "text-ink-muted dark:text-ink-inverse-muted"
      )}>
        {title}
      </h4>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS SELECT
// ─────────────────────────────────────────────────────────────────────────────

function StatusSelect({ value }: { value: TaskStatus }) {
  const config = TASK_STATUS_CONFIG[value]

  return (
    <button type="button" className={FIELD}>
      <span className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        config.color.replace('text-', 'bg-')
      )} />
      <span>
        {config.label}
      </span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIORITY SELECT
// ─────────────────────────────────────────────────────────────────────────────

function PrioritySelect({ value }: { value?: TaskPriority }) {
  if (!value) {
    return (
      <span className="block px-1 text-[13px] text-ink-muted dark:text-ink-inverse-muted">
        Not set
      </span>
    )
  }

  const config = TASK_PRIORITY_CONFIG[value]

  return (
    <button type="button" className={FIELD}>
      <PriorityIcon priority={value} />
      <span>
        {config.label}
      </span>
    </button>
  )
}

function PriorityIcon({ priority }: { priority: TaskPriority }) {
  const colors = {
    critical: 'text-danger',
    high: 'text-blurple-600 dark:text-blurple-400',
    medium: 'text-blurple-500 dark:text-blurple-300',
    low: 'text-surface-400 dark:text-surface-500',
  }

  return (
    <svg className={cn("h-4 w-4 shrink-0", colors[priority])} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {priority === 'critical' && (
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      )}
      {priority === 'high' && (
        <>
          <polyline points="17 11 12 6 7 11" />
          <polyline points="17 18 12 13 7 18" />
        </>
      )}
      {priority === 'medium' && (
        <line x1="5" y1="12" x2="19" y2="12" />
      )}
      {priority === 'low' && (
        <>
          <polyline points="7 13 12 18 17 13" />
          <polyline points="7 6 12 11 17 6" />
        </>
      )}
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSIGNEE LIST
// ─────────────────────────────────────────────────────────────────────────────

function AssigneeList({ assignees }: { assignees: Task['assignees'] }) {
  if (assignees.length === 0) {
    return (
      <button type="button" className={ADD_FIELD}>
        <PlusIcon className="h-4 w-4" />
        <span>Add assignee</span>
      </button>
    )
  }

  return (
    <div className="space-y-1.5">
      {assignees.map((assignee) => (
        <div
          key={assignee.id}
          className={cn(
            "flex h-10 items-center gap-2.5 px-2.5",
            CARD,
            "cursor-pointer transition-colors duration-150",
            "hover:border-surface-300 dark:hover:border-surface-700"
          )}
        >
          <span className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-full",
            "bg-blurple-100 text-blurple-800 dark:bg-blurple-900 dark:text-blurple-200",
            "text-[10px] font-semibold"
          )}>
            {assignee.initials}
          </span>
          <span className="truncate text-[13px] font-medium text-ink dark:text-ink-inverse">
            {assignee.name}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DATE DISPLAY
// ─────────────────────────────────────────────────────────────────────────────

function DateDisplay({ date }: { date?: number | null }) {
  if (!date) {
    return (
      <button type="button" className={ADD_FIELD}>
        <CalendarIcon className="h-4 w-4" />
        <span>Set due date</span>
      </button>
    )
  }

  const dateObj = new Date(date)
  const isOverdue = dateObj < new Date()
  const isDueSoon = !isOverdue && (dateObj.getTime() - Date.now()) < 24 * 60 * 60 * 1000

  return (
    <button
      type="button"
      className={cn(
        "flex h-9 w-full items-center gap-2.5 rounded-lg border px-3 text-left",
        "text-[13px] font-medium transition-colors duration-150",
        isOverdue
          ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
          : isDueSoon
            ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
            : 'border-surface-200 bg-surface-0 text-ink hover:border-surface-300 dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:hover:border-surface-700'
      )}
    >
      <CalendarIcon className="h-4 w-4 shrink-0" />
      <span className="truncate">
        {formatDate(dateObj)}
      </span>
      {isOverdue && (
        <span className="ml-auto font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]">
          Overdue
        </span>
      )}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LABEL LIST — neutral chips
// ─────────────────────────────────────────────────────────────────────────────

function LabelList({ labels }: { labels: TaskLabel[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <span
          key={label.id}
          className={cn(
            "inline-flex h-6 items-center rounded-full px-2.5",
            "text-[12px] font-medium",
            "bg-surface-100 text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary"
          )}
        >
          {label.label}
        </span>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PROGRESS INDICATOR
// ─────────────────────────────────────────────────────────────────────────────

function ProgressIndicator({ completed, total }: { completed: number; total: number }) {
  const percentage = Math.round((completed / total) * 100)

  return (
    <div className="space-y-2 px-1">
      <div className="flex items-center justify-between font-mono text-[12px] tabular-nums">
        <span className="text-ink-muted dark:text-ink-inverse-muted">
          {completed} of {total}
        </span>
        <span className={cn(
          "font-medium",
          percentage === 100 ? "text-emerald-700 dark:text-emerald-300" : "text-ink dark:text-ink-inverse"
        )}>
          {percentage}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-100 dark:bg-surface-800">
        <motion.div
          className={cn(
            "h-full rounded-full",
            percentage === 100
              ? 'bg-success'
              : 'bg-volt'
          )}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EFFORT BADGE
// ─────────────────────────────────────────────────────────────────────────────

function EffortBadge({ effort }: { effort: Task['estimatedEffort'] }) {
  const label = typeof effort === 'string'
    ? effort.toUpperCase()
    : `${effort} points`

  return (
    <span className={cn(
      "inline-flex h-7 items-center rounded-lg px-2.5",
      "border border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-900",
      "font-mono text-[12px] font-medium tabular-nums",
      "text-ink dark:text-ink-inverse"
    )}>
      {label}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TIME DISPLAY
// ─────────────────────────────────────────────────────────────────────────────

function TimeDisplay({ minutes }: { minutes: number }) {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60

  return (
    <span className={cn(
      "inline-flex h-7 items-center rounded-lg px-2.5",
      "border border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-900",
      "font-mono text-[12px] font-medium tabular-nums",
      "text-ink dark:text-ink-inverse"
    )}>
      {hours > 0 ? `${hours}h ` : ''}{mins}m
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AI INSIGHTS
// ─────────────────────────────────────────────────────────────────────────────

function AIInsights({ task }: { task: Task }) {
  return (
    <div className={cn("space-y-3 p-3.5", CARD)}>
      {task.complexityScore && (
        <InsightRow
          label="Complexity"
          value={task.complexityScore}
          max={10}
          color="bg-volt"
        />
      )}
      {task.riskScore && (
        <InsightRow
          label="Risk"
          value={task.riskScore}
          max={10}
          color={task.riskScore > 7 ? 'bg-danger' : task.riskScore > 4 ? 'bg-amber-400' : 'bg-success'}
        />
      )}
      {task.completionConfidence && (
        <InsightRow
          label="Confidence"
          value={task.completionConfidence}
          max={100}
          color="bg-volt"
          suffix="%"
        />
      )}
    </div>
  )
}

function InsightRow({
  label,
  value,
  max,
  color,
  suffix = ''
}: {
  label: string
  value: number
  max: number
  color: string
  suffix?: string
}) {
  const percentage = (value / max) * 100

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-ink-secondary dark:text-ink-inverse-secondary">
          {label}
        </span>
        <span className="font-mono text-[12px] font-medium tabular-nums text-ink dark:text-ink-inverse">
          {value}{suffix}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-100 dark:bg-surface-800">
        <motion.div
          className={cn("h-full rounded-full", color)}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DEPENDENCY LIST
// ─────────────────────────────────────────────────────────────────────────────

function DependencyList({ dependencies }: { dependencies: Task['dependencies'] }) {
  if (!dependencies || dependencies.length === 0) return null

  return (
    <div className="space-y-1.5">
      {dependencies.map((dep) => (
        <div
          key={dep.id}
          className={cn(
            "flex h-9 items-center gap-2 px-2.5",
            CARD
          )}
        >
          <span className={cn(
            "inline-flex h-5 shrink-0 items-center rounded-md px-1.5",
            "font-mono text-[10.5px] font-medium uppercase tracking-[0.06em]",
            dep.type === 'blocks'
              ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
              : dep.type === 'blocked-by'
                ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                : 'bg-surface-100 text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary'
          )}>
            {dep.type}
          </span>
          <span className="truncate text-[13px] text-ink dark:text-ink-inverse">
            {dep.taskTitle}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LINKS LIST
// ─────────────────────────────────────────────────────────────────────────────

function LinksList({ task }: { task: Task }) {
  const hasLinks = task.emailThreadRef?.length || task.meetingLinks?.length || task.documentLinks?.length

  if (!hasLinks) {
    return (
      <span className="block px-1 text-[13px] text-ink-muted dark:text-ink-inverse-muted">
        No links attached
      </span>
    )
  }

  return (
    <div className="space-y-1.5">
      {task.emailThreadRef?.map((ref, i) => (
        <LinkItem key={`email-${i}`} type="email" label={ref || `Email Thread ${i + 1}`} />
      ))}
      {task.meetingLinks?.map((link, i) => (
        <LinkItem key={`meeting-${i}`} type="meeting" label={`Meeting ${i + 1}`} url={link} />
      ))}
      {task.documentLinks?.map((doc) => (
        <LinkItem key={doc.id} type="document" label={doc.name} url={doc.url} />
      ))}
    </div>
  )
}

function LinkItem({ type, label, url }: { type: 'email' | 'meeting' | 'document'; label: string; url?: string }) {
  const icons = {
    email: <MailIcon className="h-4 w-4" />,
    meeting: <VideoIcon className="h-4 w-4" />,
    document: <DocumentIcon className="h-4 w-4" />,
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex h-9 items-center gap-2 px-2.5",
        CARD,
        "text-ink dark:text-ink-inverse",
        url && "group cursor-pointer hover:border-surface-300 dark:hover:border-surface-700",
        "transition-colors duration-150"
      )}
    >
      <span className="shrink-0 text-ink-muted transition-colors duration-150 group-hover:text-blurple-600 dark:text-ink-inverse-muted dark:group-hover:text-blurple-400">
        {icons[type]}
      </span>
      <span className="truncate text-[13px]">{label}</span>
      {url && (
        <ExternalLinkIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:text-ink-inverse-muted" />
      )}
    </a>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TIMESTAMPS LIST
// ─────────────────────────────────────────────────────────────────────────────

function TimestampsList({ task }: { task: Task }) {
  return (
    <div className={cn(
      "space-y-1.5 p-3 text-[12px]",
      CARD
    )}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-ink-muted dark:text-ink-inverse-muted">Created</span>
        <span className="font-mono tabular-nums text-ink-secondary dark:text-ink-inverse-secondary">{formatFullDate(new Date(task.createdAt))}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-ink-muted dark:text-ink-inverse-muted">Updated</span>
        <span className="font-mono tabular-nums text-ink-secondary dark:text-ink-inverse-secondary">{formatFullDate(new Date(task.updatedAt))}</span>
      </div>
      {task.completedAt && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink-muted dark:text-ink-inverse-muted">Completed</span>
          <span className="font-mono tabular-nums text-ink-secondary dark:text-ink-inverse-secondary">{formatFullDate(new Date(task.completedAt))}</span>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  const now = new Date()
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return `${Math.abs(diffDays)} days ago`
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays < 7) return `In ${diffDays} days`

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatFullDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}
