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
      "w-72 flex-shrink-0",
      "bg-surface-50/80 dark:bg-surface-850/80",
      "border-l border-surface-200 dark:border-surface-800",
      "overflow-y-auto scrollbar-thin"
    )}>
      <div className="p-5 space-y-6">
        {/* Parent Task Navigation */}
        {task.parentTaskId && (
          <MetadataSection title="Parent Task">
            <button 
              onClick={() => onTaskClick?.(task.parentTaskId!)}
              className={cn(
                "flex items-center gap-2 p-3 w-full text-left rounded-xl",
                "bg-indigo-500/5 hover:bg-indigo-500/10",
                "border border-indigo-500/10",
                "transition-colors group"
              )}
            >
              <ArrowUpLeftIcon className="w-4 h-4 text-indigo-500 shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  Return to Parent
                </div>
                <div className="text-sm text-ink dark:text-ink-inverse truncate">
                  {parentTask?.title || task.parentTaskId}
                </div>
              </div>
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
        <MetadataSection title="Due Date">
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
          <MetadataSection title="Estimated Effort">
            <EffortBadge effort={task.estimatedEffort} />
          </MetadataSection>
        )}

        {/* Time Spent */}
        {task.actualTimeSpent && (
          <MetadataSection title="Time Spent">
            <TimeDisplay minutes={task.actualTimeSpent} />
          </MetadataSection>
        )}

        {/* AI Insights */}
        {(task.complexityScore || task.riskScore || task.completionConfidence) && (
          <MetadataSection title="AI Insights">
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
// METADATA SECTION
// ─────────────────────────────────────────────────────────────────────────────

interface MetadataSectionProps {
  title: string
  children: React.ReactNode
}

function MetadataSection({ title, children }: MetadataSectionProps) {
  return (
    <div className="space-y-2.5">
      <h4 className={cn(
        "text-[10px] font-bold uppercase tracking-wider",
        "text-ink-muted dark:text-ink-inverse-muted"
      )}>
        {title}
      </h4>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS SELECT - Blurple palette only
// ─────────────────────────────────────────────────────────────────────────────

function StatusSelect({ value }: { value: TaskStatus }) {
  const config = TASK_STATUS_CONFIG[value]
  
  return (
    <motion.button
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      className={cn(
        "w-full",
        "flex items-center gap-3",
        "px-3 py-2.5 rounded-xl",
        "bg-surface-0 dark:bg-surface-900",
        "border border-surface-200 dark:border-surface-800",
        "hover:border-indigo-300 dark:hover:border-indigo-700",
        "transition-all duration-200"
      )}
    >
      <span className={cn(
        "w-2 h-2 rounded-full",
        config.color.replace('text-', 'bg-')
      )} />
      <span className="text-body-sm font-medium text-ink dark:text-ink-inverse">
        {config.label}
      </span>
    </motion.button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIORITY SELECT - Blurple palette only
// ─────────────────────────────────────────────────────────────────────────────

function PrioritySelect({ value }: { value?: TaskPriority }) {
  if (!value) {
    return (
      <span className="text-body-sm text-ink-muted dark:text-ink-inverse-muted italic">
        Not set
      </span>
    )
  }
  
  const config = TASK_PRIORITY_CONFIG[value]
  
  return (
    <motion.button
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      className={cn(
        "w-full",
        "flex items-center gap-3",
        "px-3 py-2.5 rounded-xl",
        "bg-surface-0 dark:bg-surface-900",
        "border border-surface-200 dark:border-surface-800",
        "hover:border-indigo-300 dark:hover:border-indigo-700",
        "transition-all duration-200"
      )}
    >
      <PriorityIcon priority={value} />
      <span className="text-body-sm font-medium text-ink dark:text-ink-inverse">
        {config.label}
      </span>
    </motion.button>
  )
}

function PriorityIcon({ priority }: { priority: TaskPriority }) {
  const colors = {
    critical: 'text-violet-500',
    high: 'text-indigo-500',
    medium: 'text-indigo-400',
    low: 'text-surface-400',
  }
  
  return (
    <svg className={cn("w-4 h-4", colors[priority])} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
      <motion.button
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        className={cn(
          "w-full",
          "flex items-center justify-center gap-2",
          "px-3 py-2 rounded-xl",
          "border border-dashed border-surface-300 dark:border-surface-700",
          "text-ink-muted dark:text-ink-inverse-muted",
          "hover:border-indigo-400 dark:hover:border-indigo-600",
          "hover:text-indigo-600 dark:hover:text-indigo-400",
          "transition-all duration-200"
        )}
      >
        <PlusIcon className="w-4 h-4" />
        <span className="text-body-sm">Add assignee</span>
      </motion.button>
    )
  }

  return (
    <div className="space-y-2">
      {assignees.map((assignee) => (
        <motion.div
          key={assignee.id}
          whileHover={{ x: 2 }}
          className={cn(
            "flex items-center gap-3",
            "px-3 py-2 rounded-xl",
            "bg-surface-0 dark:bg-surface-900",
            "border border-surface-200 dark:border-surface-800",
            "cursor-pointer",
            "hover:border-indigo-300 dark:hover:border-indigo-700",
            "transition-colors duration-200"
          )}
        >
          <div className={cn(
            "w-7 h-7 rounded-full",
            "bg-gradient-to-br from-indigo-500 to-violet-600",
            "flex items-center justify-center",
            "text-[10px] font-bold text-white"
          )}>
            {assignee.initials}
          </div>
          <span className="text-body-sm text-ink dark:text-ink-inverse font-medium">
            {assignee.name}
          </span>
        </motion.div>
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
      <motion.button
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        className={cn(
          "w-full",
          "flex items-center justify-center gap-2",
          "px-3 py-2 rounded-xl",
          "border border-dashed border-surface-300 dark:border-surface-700",
          "text-ink-muted dark:text-ink-inverse-muted",
          "hover:border-indigo-400 dark:hover:border-indigo-600",
          "hover:text-indigo-600 dark:hover:text-indigo-400",
          "transition-all duration-200"
        )}
      >
        <CalendarIcon className="w-4 h-4" />
        <span className="text-body-sm">Set due date</span>
      </motion.button>
    )
  }

  const dateObj = new Date(date)
  const isOverdue = dateObj < new Date()
  const isDueSoon = !isOverdue && (dateObj.getTime() - Date.now()) < 24 * 60 * 60 * 1000

  return (
    <motion.button
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      className={cn(
        "w-full",
        "flex items-center gap-3",
        "px-3 py-2 rounded-xl",
        "border transition-all duration-200",
        isOverdue 
          ? 'bg-rose-500/5 border-rose-500/20 text-rose-600 dark:text-rose-400' 
          : isDueSoon 
            ? 'bg-amber-500/5 border-amber-500/20 text-amber-600 dark:text-amber-400'
            : 'bg-surface-0 dark:bg-surface-900 border-surface-200 dark:border-surface-800 text-ink dark:text-ink-inverse hover:border-indigo-300'
      )}
    >
      <CalendarIcon className="w-4 h-4" />
      <span className="text-body-sm font-medium">
        {formatDate(dateObj)}
      </span>
      {isOverdue && (
        <span className="text-[9px] font-bold uppercase tracking-wider ml-auto opacity-70">
          Overdue
        </span>
      )}
    </motion.button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LABEL LIST - Blurple palette only
// ─────────────────────────────────────────────────────────────────────────────

function LabelList({ labels }: { labels: TaskLabel[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {labels.map((label) => (
        <span
          key={label.id}
          className={cn(
            "inline-flex items-center",
            "px-2.5 py-1 rounded-lg",
            "text-[10px] font-semibold uppercase tracking-wider",
            "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
            "border border-indigo-500/20"
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
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">
          {completed} of {total}
        </span>
        <span className={cn(
          "text-body-xs font-medium",
          percentage === 100 && "text-indigo-600 dark:text-indigo-400"
        )}>
          {percentage}%
        </span>
      </div>
      <div className="h-2 rounded-full bg-surface-200 dark:bg-surface-800 overflow-hidden">
        <motion.div
          className={cn(
            "h-full rounded-full",
            percentage === 100 
              ? 'bg-gradient-to-r from-indigo-500 to-violet-500' 
              : 'bg-indigo-500'
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
      "inline-flex items-center",
      "px-3 py-1.5 rounded-xl",
      "bg-surface-0 dark:bg-surface-900",
      "border border-surface-200 dark:border-surface-800",
      "text-body-sm font-medium",
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
      "text-body-sm font-mono",
      "text-ink dark:text-ink-inverse",
      "bg-surface-0 dark:bg-surface-900",
      "px-3 py-1.5 rounded-xl",
      "border border-surface-200 dark:border-surface-800"
    )}>
      {hours > 0 ? `${hours}h ` : ''}{mins}m
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AI INSIGHTS - Blurple palette only
// ─────────────────────────────────────────────────────────────────────────────

function AIInsights({ task }: { task: Task }) {
  return (
    <div className={cn(
      "space-y-3 p-4 rounded-xl",
      "bg-surface-0 dark:bg-surface-900",
      "border border-surface-200 dark:border-surface-800"
    )}>
      {task.complexityScore && (
        <InsightRow 
          label="Complexity" 
          value={task.complexityScore}
          max={10}
          color="bg-violet-500"
        />
      )}
      {task.riskScore && (
        <InsightRow 
          label="Risk" 
          value={task.riskScore}
          max={10}
          color={task.riskScore > 7 ? 'bg-violet-600' : task.riskScore > 4 ? 'bg-indigo-500' : 'bg-indigo-400'}
        />
      )}
      {task.completionConfidence && (
        <InsightRow 
          label="Confidence" 
          value={task.completionConfidence}
          max={100}
          color="bg-indigo-500"
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
        <span className="text-[10px] font-medium text-ink-muted dark:text-ink-inverse-muted uppercase">
          {label}
        </span>
        <span className="text-[10px] font-bold text-ink dark:text-ink-inverse">
          {value}{suffix}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-200 dark:bg-surface-800 overflow-hidden">
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
// DEPENDENCY LIST - Blurple palette only
// ─────────────────────────────────────────────────────────────────────────────

function DependencyList({ dependencies }: { dependencies: Task['dependencies'] }) {
  if (!dependencies || dependencies.length === 0) return null
  
  return (
    <div className="space-y-2">
      {dependencies.map((dep) => (
        <div
          key={dep.id}
          className={cn(
            "flex items-center gap-2",
            "px-3 py-2 rounded-xl",
            "bg-surface-0 dark:bg-surface-900",
            "border border-surface-200 dark:border-surface-800"
          )}
        >
          <span className={cn(
            "text-[9px] font-bold uppercase",
            "px-1.5 py-0.5 rounded",
            dep.type === 'blocks' 
              ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400' 
              : dep.type === 'blocked-by' 
                ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' 
                : 'bg-surface-200 dark:bg-surface-800 text-ink-muted'
          )}>
            {dep.type}
          </span>
          <span className="text-body-sm text-ink dark:text-ink-inverse truncate">
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
      <span className="text-body-sm text-ink-muted dark:text-ink-inverse-muted italic px-2">
        No links attached
      </span>
    )
  }
  
  return (
    <div className="space-y-2">
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
    email: <MailIcon className="w-4 h-4" />,
    meeting: <VideoIcon className="w-4 h-4" />,
    document: <DocumentIcon className="w-4 h-4" />,
  }
  
  return (
    <motion.a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      whileHover={url ? { x: 2 } : undefined}
      className={cn(
        "flex items-center gap-2",
        "px-3 py-2 rounded-xl",
        "bg-surface-0 dark:bg-surface-900",
        "border border-surface-200 dark:border-surface-800",
        "text-ink dark:text-ink-inverse",
        url && "hover:border-indigo-300 dark:hover:border-indigo-700 cursor-pointer group",
        "transition-colors duration-200"
      )}
    >
      <span className="text-ink-muted dark:text-ink-inverse-muted group-hover:text-indigo-500 transition-colors">
        {icons[type]}
      </span>
      <span className="text-body-sm truncate">{label}</span>
      {url && (
        <ExternalLinkIcon className="w-3 h-3 ml-auto text-ink-muted opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </motion.a>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TIMESTAMPS LIST
// ─────────────────────────────────────────────────────────────────────────────

function TimestampsList({ task }: { task: Task }) {
  return (
    <div className={cn(
      "space-y-2 text-[11px] text-ink-muted dark:text-ink-inverse-muted",
      "bg-surface-0 dark:bg-surface-900",
      "p-3 rounded-xl",
      "border border-surface-200 dark:border-surface-800"
    )}>
      <div className="flex justify-between">
        <span>Created</span>
        <span className="font-mono">{formatFullDate(new Date(task.createdAt))}</span>
      </div>
      <div className="flex justify-between">
        <span>Updated</span>
        <span className="font-mono">{formatFullDate(new Date(task.updatedAt))}</span>
      </div>
      {task.completedAt && (
        <div className="flex justify-between">
          <span>Completed</span>
          <span className="font-mono">{formatFullDate(new Date(task.completedAt))}</span>
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
