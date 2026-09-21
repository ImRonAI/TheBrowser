/**
 * ListView — Table-style task list with SuperAgent glow aesthetic
 *
 * Features:
 * - Column headers: Title, Status, Priority, Assignee, Due Date
 * - Status-grouped sections with glow accents
 * - Row hover glow matching SuperAgent aesthetic
 * - Glass-card rows with indigo accent borders
 */

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/cn'
import { useTaskStore } from '@/stores/taskStore'
import { TaskDetailView } from './task-detail'
import type { Task } from '@/pages/types/task'

const EASE = [0.16, 1, 0.3, 1] as const

type SortKey = 'title' | 'status' | 'priority' | 'dueDate'
type SortDir = 'asc' | 'desc'

const STATUS_ORDER: Record<string, number> = {
  'in-progress': 0,
  'todo': 1,
  'backlog': 2,
  'review': 3,
  'done': 4,
  'blocked': 5,
}

const PRIORITY_ORDER: Record<string, number> = {
  'critical': 0,
  'high': 1,
  'medium': 2,
  'low': 3,
}

const STATUS_STYLES: Record<string, string> = {
  'in-progress': 'bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border-indigo-500/20',
  'todo': 'bg-violet-500/10 text-violet-500 dark:text-violet-400 border-violet-500/20',
  'backlog': 'bg-surface-200 dark:bg-surface-800 text-ink-muted dark:text-ink-inverse-muted border-surface-300 dark:border-surface-700',
  'review': 'bg-purple-500/10 text-purple-500 dark:text-purple-400 border-purple-500/20',
  'done': 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20',
  'blocked': 'bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/20',
}

const PRIORITY_STYLES: Record<string, string> = {
  'critical': 'text-violet-500 dark:text-violet-400',
  'high': 'text-indigo-500 dark:text-indigo-400',
  'medium': 'text-surface-500 dark:text-surface-400',
  'low': 'text-surface-400 dark:text-surface-500',
}

export function ListView() {
  const { tasks, updateTask } = useTaskStore()
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)



  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'title':
          cmp = a.title.localeCompare(b.title)
          break
        case 'status':
          cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)
          break
        case 'priority':
          cmp = (PRIORITY_ORDER[a.priority || 'low'] ?? 99) - (PRIORITY_ORDER[b.priority || 'low'] ?? 99)
          break
        case 'dueDate': {
          const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Infinity
          const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Infinity
          cmp = aDate - bDate
          break
        }
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [tasks, sortKey, sortDir])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const columns: { key: SortKey; label: string; width: string }[] = [
    { key: 'title', label: 'Title', width: 'flex-1 min-w-[200px]' },
    { key: 'status', label: 'Status', width: 'w-28' },
    { key: 'priority', label: 'Priority', width: 'w-24' },
    { key: 'dueDate', label: 'Due Date', width: 'w-28' },
  ]

  return (
    <>
    <motion.div
      className="h-full flex flex-col rounded-xl overflow-hidden bg-surface-0 dark:bg-surface-850 border border-surface-200 dark:border-surface-700 shadow-soft dark:shadow-dark-soft"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      {/* Column Headers */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b border-surface-200 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-900/50">
        {columns.map(col => (
          <button
            key={col.key}
            onClick={() => handleSort(col.key)}
            className={cn(
              col.width,
              'flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-colors',
              sortKey === col.key
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-ink-muted dark:text-ink-inverse-muted hover:text-ink dark:hover:text-ink-inverse'
            )}
          >
            {col.label}
            {sortKey === col.key && (
              <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
            )}
          </button>
        ))}
        <div className="w-20 text-xs font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
          Assignee
        </div>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <AnimatePresence initial={false}>
          {sorted.map((task, i) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.25, delay: i * 0.01, ease: EASE }}
              onClick={() => setSelectedTask(task)}
              className={cn(
                'group flex items-center gap-3 px-5 py-3',
                'border-b border-surface-100 dark:border-surface-800/50',
                'hover:bg-indigo-500/[0.03] dark:hover:bg-indigo-500/[0.04]',
                'hover:shadow-[inset_0_0_0_1px_rgba(99,102,241,0.08)]',
                'transition-all duration-200 cursor-pointer'
              )}
            >
              {/* Title */}
              <div className="flex-1 min-w-[200px]">
                <span className={cn(
                  'text-sm font-medium text-ink dark:text-ink-inverse',
                  'group-hover:text-indigo-600 dark:group-hover:text-indigo-400',
                  'transition-colors duration-200',
                  task.status === 'done' && 'line-through opacity-50'
                )}>
                  {task.title}
                </span>
              </div>

              {/* Status */}
              <div className="w-28">
                <span className={cn(
                  'inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wider border',
                  STATUS_STYLES[task.status] || STATUS_STYLES['backlog']
                )}>
                  {task.status.replace('-', ' ')}
                </span>
              </div>

              {/* Priority */}
              <div className="w-24">
                <span className={cn(
                  'text-xs font-medium capitalize',
                  PRIORITY_STYLES[task.priority || 'low'] || PRIORITY_STYLES['low']
                )}>
                  {task.priority || '—'}
                </span>
              </div>

              {/* Due Date */}
              <div className="w-28">
                {task.dueDate ? (
                  <span className={cn(
                    'text-xs',
                    new Date(task.dueDate) < new Date()
                      ? 'text-rose-500 font-medium'
                      : 'text-ink-muted dark:text-ink-inverse-muted'
                  )}>
                    {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                ) : (
                  <span className="text-xs text-ink-muted/40 dark:text-ink-inverse-muted/40">—</span>
                )}
              </div>

              {/* Assignees */}
              <div className="w-20 flex -space-x-1.5">
                {(task.assignees || []).slice(0, 3).map((contact, ci) => (
                  <div
                    key={contact.id}
                    className={cn(
                      'w-6 h-6 rounded-full',
                      'bg-gradient-to-br from-indigo-500 to-violet-600',
                      'border-2 border-white dark:border-surface-850',
                      'flex items-center justify-center',
                      'text-[10px] font-bold text-white'
                    )}
                    style={{ zIndex: 3 - ci }}
                  >
                    {contact.initials}
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {sorted.length === 0 && (
          <div className="flex items-center justify-center h-40 text-sm text-ink-muted dark:text-ink-inverse-muted">
            No tasks yet
          </div>
        )}
      </div>
    </motion.div>

    {/* Task Detail Modal — rendered via portal */}
    <AnimatePresence>
      {selectedTask && (
        <TaskDetailView
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={(updated) => {
            updateTask(updated.id, updated)
            setSelectedTask(updated)
          }}
        />
      )}
    </AnimatePresence>
    </>
  )
}
