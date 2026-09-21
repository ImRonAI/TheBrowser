import { motion } from 'framer-motion'
import { Task } from '@/pages/types/task'
import { cn } from '@/utils/cn'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

const EASE = [0.16, 1, 0.3, 1] as const

interface TaskCardProps {
  task: Task
  index?: number
  onClick?: () => void
  columnColor?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function TaskCard({ task, index = 0, onClick, columnColor = 'bg-indigo-500' }: TaskCardProps) {
  const subtasks = task.subtasks || []
  const totalSubtasks = subtasks.length
  const completedSubtasks = subtasks.filter(s => s.completed).length
  
  const progress = totalSubtasks > 0 
    ? Math.round((completedSubtasks / totalSubtasks) * 100) 
    : 0

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date()
  const isDueSoon = task.dueDate && !isOverdue && 
    new Date(task.dueDate).getTime() - Date.now() < 24 * 60 * 60 * 1000
  const isDone = task.status === 'done'

  const contacts = task.assignees || []
  const interest = task.labels && task.labels.length > 0 ? task.labels[0] : null

  // Priority-based styling - using only indigo/violet/blurple spectrum
  const getPriorityStyles = (priority?: string) => {
    switch (priority) {
      case 'critical':
        return 'bg-gradient-to-br from-violet-600 to-indigo-700 shadow-lg shadow-violet-500/25'
      case 'high':
        return 'bg-gradient-to-br from-indigo-500 to-violet-600 shadow-md shadow-indigo-500/20'
      case 'medium':
        return 'bg-gradient-to-br from-indigo-400 to-indigo-500'
      case 'low':
        return 'bg-surface-300 dark:bg-surface-600'
      default:
        return 'bg-surface-300 dark:bg-surface-600'
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.35, delay: index * 0.04, ease: EASE }}
      whileHover={{ y: -3, scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="group relative cursor-pointer"
    >
      {/* Card Container - Premium glass morphism */}
      <div className={cn(
        "relative p-4 rounded-xl",
        "bg-gradient-to-br from-white/80 to-white/40",
        "dark:from-surface-800/80 dark:to-surface-850/40",
        "backdrop-blur-xl",
        "border border-white/20 dark:border-white/10",
        "shadow-soft",
        "hover:shadow-medium hover:border-indigo-300/30 dark:hover:border-indigo-500/20",
        "transition-all duration-400",
        "overflow-hidden"
      )}>
        
        {/* Subtle gradient overlay on hover */}
        <div className={cn(
          "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500",
          "bg-gradient-to-br from-indigo-500/5 via-transparent to-violet-500/5",
          "pointer-events-none"
        )} />

        {/* Top accent line - column color indicator */}
        <div className={cn(
          "absolute top-0 left-4 right-4 h-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300",
          columnColor
        )} />

        {/* Priority indicator dot - top right */}
        {task.priority && task.priority !== 'low' && (
          <div className="absolute top-3 right-3">
            <div className={cn(
              "w-2 h-2 rounded-full",
              getPriorityStyles(task.priority)
            )} />
          </div>
        )}

        {/* Top Meta Row - Type & Due Date */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {/* Task Type Icon */}
            <TaskTypeBadge type={task.type} />
            
            {/* Due Date */}
            {task.dueDate && (
              <div className={cn(
                "flex items-center gap-1.5 px-2 py-0.5 rounded-md",
                "text-[10px] font-medium",
                isOverdue 
                  ? 'text-rose-500 bg-rose-500/10' 
                  : isDueSoon 
                    ? 'text-amber-500 bg-amber-500/10'
                    : 'text-ink-muted dark:text-ink-inverse-muted bg-surface-100 dark:bg-surface-800'
              )}>
                <CalendarIcon className="w-3 h-3" />
                {formatDueDate(task.dueDate)}
              </div>
            )}
          </div>
          
          {/* Notification indicator */}
          {task.hasNotification && (
            <div className={cn(
              "w-5 h-5 rounded-full",
              "bg-indigo-500/10 dark:bg-indigo-500/20",
              "flex items-center justify-center"
            )}>
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
            </div>
          )}
        </div>

        {/* Title - Main content */}
        <h4 className={cn(
          "text-xs font-medium leading-snug mb-2 pr-4",
          "text-ink dark:text-ink-inverse",
          "group-hover:text-indigo-600 dark:group-hover:text-indigo-400",
          "transition-colors duration-300",
          isDone && 'line-through opacity-50'
        )}>
          {task.title}
        </h4>

        {/* Bottom Row - Metadata */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Label Tag */}
            {interest && (
              <span className={cn(
                "px-2 py-0.5 rounded-md",
                "text-[9px] font-semibold uppercase tracking-wider",
                "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
              )}>
                {interest.label}
              </span>
            )}
            
            {/* Avatars */}
            {contacts.length > 0 && (
              <div className="flex -space-x-1.5">
                {contacts.slice(0, 2).map((contact, i) => (
                  <div
                    key={contact.id}
                    className={cn(
                      "w-5 h-5 rounded-full",
                      "bg-gradient-to-br from-indigo-500 to-violet-600",
                      "border-2 border-white dark:border-surface-800",
                      "flex items-center justify-center",
                      "text-[8px] font-bold text-white"
                    )}
                    style={{ zIndex: contacts.length - i }}
                  >
                    {contact.initials}
                  </div>
                ))}
                {contacts.length > 2 && (
                  <div className={cn(
                    "w-5 h-5 rounded-full",
                    "bg-surface-200 dark:bg-surface-700",
                    "border-2 border-white dark:border-surface-800",
                    "flex items-center justify-center",
                    "text-[8px] font-bold text-ink-muted"
                  )}>
                    +{contacts.length - 2}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Progress indicator */}
          {totalSubtasks > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-12 h-1 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden">
                <div 
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    progress === 100 
                      ? 'bg-gradient-to-r from-indigo-500 to-violet-500' 
                      : 'bg-indigo-500'
                  )}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-[9px] font-medium text-ink-muted dark:text-ink-inverse-muted">
                {Math.round(progress)}%
              </span>
            </div>
          )}
        </div>

        {/* Subtask count indicator */}
        {totalSubtasks > 0 && (
          <div className="absolute bottom-3 right-3 flex items-center gap-1 text-[9px] text-ink-muted dark:text-ink-inverse-muted">
            <ChecklistIcon className="w-3 h-3" />
            <span>{completedSubtasks}/{totalSubtasks}</span>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK TYPE BADGE
// ─────────────────────────────────────────────────────────────────────────────

function TaskTypeBadge({ type }: { type?: Task['type'] }) {
  const getIcon = () => {
    switch (type) {
      case 'feature':
        return <SparklesIcon className="w-3 h-3" />
      case 'bug':
        return <BugIcon className="w-3 h-3" />
      case 'improvement':
        return <LightningIcon className="w-3 h-3" />
      case 'research':
        return <SearchIcon className="w-3 h-3" />
      case 'documentation':
        return <DocumentIcon className="w-3 h-3" />
      case 'support':
        return <MessageIcon className="w-3 h-3" />
      default:
        return <DocumentIcon className="w-3 h-3" />
    }
  }

  return (
    <div className={cn(
      "w-5 h-5 rounded-md",
      "bg-indigo-500/10 dark:bg-indigo-500/20",
      "flex items-center justify-center",
      "text-indigo-600 dark:text-indigo-400"
    )}>
      {getIcon()}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function formatDueDate(date: Date | number): string {
  const now = new Date()
  const dueDate = new Date(date)
  const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays < 7) return `${diffDays}d`
  
  return dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─────────────────────────────────────────────────────────────────────────────
// ICONS
// ─────────────────────────────────────────────────────────────────────────────

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function ChecklistIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  )
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z" />
    </svg>
  )
}

function BugIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="8" y="6" width="8" height="14" rx="4" />
      <path d="M19 8l-3 1.5" />
      <path d="M5 8l3 1.5" />
      <path d="M19 16l-3-1.5" />
      <path d="M5 16l3-1.5" />
      <path d="M12 6V2" />
      <path d="M19 12h3" />
      <path d="M2 12h3" />
    </svg>
  )
}

function LightningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  )
}

function MessageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  )
}
