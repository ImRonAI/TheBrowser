import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { TaskCard } from './TaskCard'
import { TaskDetailView } from './task-detail'
import type { Task } from '@/pages/types/task'
import { useTaskStore } from '@/stores/taskStore'
import { cn } from '@/utils/cn'

// Sophisticated easing
const EASE = [0.16, 1, 0.3, 1] as const

// Unified Blurple color system - All columns use varying shades of indigo/violet
// This creates visual distinction while maintaining design system cohesion
const columns: {
  id: Task['status']
  title: string
  subtitle: string
  accentColor: string
  dotColor: string
  bgGradient: string
  borderColor: string
  glowColor: string
}[] = [
  { 
    id: 'backlog', 
    title: 'Backlog',
    subtitle: 'Queued work',
    accentColor: 'from-indigo-400/20 to-indigo-500/5',
    dotColor: 'bg-indigo-400',
    bgGradient: 'from-indigo-500/[0.02] to-transparent',
    borderColor: 'border-indigo-500/15',
    glowColor: 'shadow-indigo-500/5',
  },
  { 
    id: 'in-progress', 
    title: 'In Progress',
    subtitle: 'Active work',
    accentColor: 'from-violet-500/20 to-violet-600/5',
    dotColor: 'bg-violet-500',
    bgGradient: 'from-violet-500/[0.03] to-transparent',
    borderColor: 'border-violet-500/20',
    glowColor: 'shadow-violet-500/8',
  },
  { 
    id: 'review', 
    title: 'Review',
    subtitle: 'Pending approval',
    accentColor: 'from-purple-500/20 to-purple-600/5',
    dotColor: 'bg-purple-500',
    bgGradient: 'from-purple-500/[0.03] to-transparent',
    borderColor: 'border-purple-500/20',
    glowColor: 'shadow-purple-500/8',
  },
  { 
    id: 'done', 
    title: 'Done',
    subtitle: 'Completed',
    accentColor: 'from-indigo-600/20 to-violet-600/5',
    dotColor: 'bg-indigo-500',
    bgGradient: 'from-indigo-500/[0.02] to-transparent',
    borderColor: 'border-indigo-500/15',
    glowColor: 'shadow-indigo-500/5',
  },
]

export function KanbanBoard() {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const { tasks, updateTask } = useTaskStore()

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task)
  }
  
  const handleUpdateTask = (updatedTask: Task) => {
      updateTask(updatedTask.id, updatedTask)
      setSelectedTask(updatedTask)
  }

  function getTasksForColumn(columnId: Task['status']): Task[] {
    return tasks.filter(task => {
        if (task.parentTaskId) return false
        
        if (columnId === 'in-progress' && task.status === 'blocked') return true
        if (columnId === 'review' && task.status === 'testing') return true
        return task.status === columnId
    })
  }

  const handleCloseDetail = () => {
    setSelectedTask(null)
  }
  
  const handleSubtaskClick = (subtaskId: string) => {
    if (!selectedTask) return
    
    const subtask = selectedTask.subtasks.find(s => s.id === subtaskId)
    if (!subtask) return
    
    const promotedTask: Task = {
      ...selectedTask,
      id: subtask.id,
      title: subtask.title,
      description: '', 
      type: 'feature',
      subtasks: [],
      priority: subtask.priority || selectedTask.priority,
      status: subtask.status || 'in-progress',
      assignees: subtask.assignee ? [subtask.assignee] : [],
      projectId: selectedTask.projectId,
      projectName: selectedTask.projectName,
    }
    
    setSelectedTask(promotedTask)
  }

  return (
    <>
      <div className="h-full overflow-x-auto overflow-y-hidden scrollbar-thin">
        <div className="h-full flex gap-5 pb-4 pt-1 px-2 min-w-max">
          {columns.map((column, index) => (
            <KanbanColumn
              key={column.id}
              column={column}
              index={index}
              tasks={getTasksForColumn(column.id)}
              onTaskClick={handleTaskClick}
            />
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selectedTask && (
          <TaskDetailView
            task={selectedTask}
            onClose={handleCloseDetail}
            onUpdate={handleUpdateTask}
            onTaskClick={handleSubtaskClick}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// KANBAN COLUMN
// ─────────────────────────────────────────────────────────────────────────────

interface KanbanColumnProps {
  column: typeof columns[number]
  index: number
  tasks: Task[]
  onTaskClick?: (task: Task) => void
}

function KanbanColumn({ column, index, tasks, onTaskClick }: KanbanColumnProps) {
  const taskCount = tasks.length

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: index * 0.06,
        ease: EASE,
      }}
      className="flex-shrink-0 w-80 h-full flex flex-col group/column"
    >
      {/* Column Header - Minimal & Elegant */}
      <div className="flex-shrink-0 mb-3 px-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {/* Status dot with subtle glow */}
            <div className="relative">
              <motion.div 
                className={cn(
                  "w-2 h-2 rounded-full",
                  column.dotColor
                )}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: index * 0.06 + 0.2, type: 'spring', stiffness: 500, damping: 20 }}
              />
              {/* Subtle glow ring */}
              <div className={cn(
                "absolute inset-0 rounded-full blur-sm opacity-50",
                column.dotColor
              )} />
            </div>
            
            <div className="flex flex-col">
              <h3 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">
                {column.title}
              </h3>
              <span className="text-[10px] text-ink-muted dark:text-ink-inverse-muted">
                {column.subtitle}
              </span>
            </div>
          </div>
          
          {/* Task count badge */}
          <motion.div 
            className={cn(
              "flex items-center justify-center",
              "min-w-[24px] h-5 px-1.5",
              "rounded-full",
              "bg-surface-100 dark:bg-surface-800",
              "border border-surface-200 dark:border-surface-700"
            )}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.06 + 0.3 }}
          >
            <span className="text-[11px] font-medium text-ink-muted dark:text-ink-inverse-muted">
              {taskCount}
            </span>
          </motion.div>
        </div>
      </div>

      {/* Column Body - Glass morphism with subtle gradient */}
      <div 
        className={cn(
          "flex-1 min-h-0 overflow-y-auto overflow-x-hidden",
          "rounded-2xl",
          "bg-gradient-to-b",
          column.bgGradient,
          "border",
          column.borderColor,
          column.glowColor,
          "scrollbar-thin",
          "transition-all duration-300",
          "group-hover/column:border-opacity-30"
        )}
      >
        <div className="p-3 space-y-3">
          <AnimatePresence mode="popLayout">
            {tasks.length > 0 ? (
              tasks.map((task, taskIndex) => (
                <TaskCard 
                  key={task.id} 
                  task={task}
                  index={taskIndex} 
                  onClick={() => onTaskClick?.(task)}
                  columnColor={column.dotColor}
                />
              ))
            ) : (
              <EmptyColumnState key="empty" index={index} />
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Add Task Button - Minimal */}
      <div className="flex-shrink-0 mt-3">
        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          className={cn(
            "w-full py-2.5 px-4",
            "flex items-center justify-center gap-2",
            "rounded-xl",
            "text-body-xs font-medium",
            "text-ink-muted dark:text-ink-inverse-muted",
            "hover:text-indigo-500 dark:hover:text-indigo-400",
            "bg-surface-50/50 dark:bg-surface-850/50",
            "hover:bg-indigo-500/5 dark:hover:bg-indigo-500/10",
            "border border-dashed border-surface-200 dark:border-surface-700",
            "hover:border-indigo-300 dark:hover:border-indigo-700",
            "transition-all duration-300",
            "group"
          )}
        >
          <motion.span
            className="transition-transform duration-300 group-hover:rotate-90"
          >
            <PlusIcon className="w-3.5 h-3.5" />
          </motion.span>
          <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-[11px]">
            Add task
          </span>
        </motion.button>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EMPTY STATE
// ─────────────────────────────────────────────────────────────────────────────

function EmptyColumnState({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.06 + 0.4, duration: 0.3 }}
      className={cn(
        "h-28 flex flex-col items-center justify-center gap-2.5",
        "rounded-xl",
        "bg-surface-50/30 dark:bg-surface-800/20",
        "border border-dashed border-surface-200 dark:border-surface-700"
      )}
    >
      <div className="w-9 h-9 rounded-xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center">
        <EmptyIcon className="w-4 h-4 text-ink-muted dark:text-ink-inverse-muted" />
      </div>
      <p className="text-[11px] text-ink-muted dark:text-ink-inverse-muted">
        No tasks
      </p>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ICONS
// ─────────────────────────────────────────────────────────────────────────────

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function EmptyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <line x1="9" y1="9" x2="15" y2="9" />
      <line x1="9" y1="13" x2="13" y2="13" />
    </svg>
  )
}
