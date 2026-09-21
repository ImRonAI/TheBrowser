/**
 * GanttView — Timeline-based task visualization with SuperAgent glow aesthetic
 *
 * Features:
 * - Left panel: task names with status indicators
 * - Right panel: horizontal timeline with indigo→violet gradient bars
 * - Today marker with pulsing glow
 * - Hover glow effects matching SuperAgent design
 */

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/utils/cn'
import { useTaskStore } from '@/stores/taskStore'

const EASE = [0.16, 1, 0.3, 1] as const

// How many days to show in the viewport
const VISIBLE_DAYS = 28

const STATUS_DOT: Record<string, string> = {
  'in-progress': 'bg-indigo-500',
  'todo': 'bg-violet-400',
  'backlog': 'bg-surface-400',
  'review': 'bg-purple-500',
  'done': 'bg-emerald-500',
  'blocked': 'bg-rose-500',
}

export function GanttView() {
  const { tasks } = useTaskStore()


  // Determine timeline range
  const { startDate, days, today, todayOffset } = useMemo(() => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)

    // Start one week before today
    const s = new Date(now)
    s.setDate(s.getDate() - 7)

    const d: Date[] = []
    for (let i = 0; i < VISIBLE_DAYS; i++) {
      const day = new Date(s)
      day.setDate(day.getDate() + i)
      d.push(day)
    }

    const offset = Math.floor((now.getTime() - s.getTime()) / (1000 * 60 * 60 * 24))

    return { startDate: s, days: d, today: now, todayOffset: offset }
  }, [])

  // Calculate bar position for each task
  const taskBars = useMemo(() => {
    return tasks.map(task => {
      if (!task.dueDate) {
        return { task, left: -1, width: 0 }
      }
      const due = new Date(task.dueDate)
      due.setHours(0, 0, 0, 0)

      // Estimate start as 7 days before due (or created date if available)
      const taskStart = new Date(due)
      taskStart.setDate(taskStart.getDate() - 7)

      const leftDay = Math.floor((taskStart.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
      const rightDay = Math.floor((due.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))

      return {
        task,
        left: Math.max(0, leftDay),
        width: Math.max(1, rightDay - Math.max(0, leftDay) + 1),
      }
    })
  }, [tasks, startDate])

  const dayWidth = 40 // px per day

  return (
    <motion.div
      className="h-full flex flex-col rounded-xl overflow-hidden bg-surface-0 dark:bg-surface-850 border border-surface-200 dark:border-surface-700 shadow-soft dark:shadow-dark-soft"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Panel — Task list */}
        <div className="flex-shrink-0 w-56 border-r border-surface-200 dark:border-surface-700 flex flex-col">
          {/* Header */}
          <div className="flex-shrink-0 h-12 px-4 flex items-center border-b border-surface-200 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-900/50">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
              Tasks
            </span>
          </div>

          {/* Task rows */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {taskBars.map(({ task }, i) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.015, duration: 0.3, ease: EASE }}
                className={cn(
                  'flex items-center gap-2 px-4 h-10',
                  'border-b border-surface-100 dark:border-surface-800/50',
                  'hover:bg-indigo-500/[0.03] dark:hover:bg-indigo-500/[0.04]',
                  'transition-colors duration-200'
                )}
              >
                <div className={cn(
                  'w-2 h-2 rounded-full flex-shrink-0',
                  STATUS_DOT[task.status] || 'bg-surface-400'
                )} />
                <span className={cn(
                  'text-xs font-medium text-ink dark:text-ink-inverse truncate',
                  task.status === 'done' && 'line-through opacity-50'
                )}>
                  {task.title}
                </span>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Right Panel — Timeline */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Date headers */}
          <div className="flex-shrink-0 h-12 border-b border-surface-200 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-900/50 overflow-x-auto scrollbar-none">
            <div className="flex" style={{ width: `${days.length * dayWidth}px` }}>
              {days.map((day, i) => {
                const isToday = day.toDateString() === today.toDateString()
                const isWeekend = day.getDay() === 0 || day.getDay() === 6
                const isFirstOfMonth = day.getDate() === 1
                const isMonday = day.getDay() === 1

                return (
                  <div
                    key={i}
                    className={cn(
                      'flex-shrink-0 flex flex-col items-center justify-center',
                      isToday && 'bg-indigo-500/5 dark:bg-indigo-500/10',
                      isWeekend && !isToday && 'bg-surface-50/50 dark:bg-surface-800/20'
                    )}
                    style={{ width: `${dayWidth}px` }}
                  >
                    {(isFirstOfMonth || isMonday || i === 0) && (
                      <span className="text-[9px] uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
                        {day.toLocaleDateString('en-US', { month: 'short' })}
                      </span>
                    )}
                    <span className={cn(
                      'text-xs',
                      isToday
                        ? 'font-bold text-indigo-500 dark:text-indigo-400'
                        : isWeekend
                          ? 'text-ink-muted/50 dark:text-ink-inverse-muted/50'
                          : 'text-ink-muted dark:text-ink-inverse-muted'
                    )}>
                      {day.getDate()}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Timeline bars */}
          <div className="flex-1 overflow-auto scrollbar-thin relative">
            {/* Today line */}
            <motion.div
              className="absolute top-0 bottom-0 w-0.5 z-10"
              style={{ left: `${todayOffset * dayWidth + dayWidth / 2}px` }}
              initial={{ opacity: 0, scaleY: 0 }}
              animate={{ opacity: 1, scaleY: 1 }}
              transition={{ delay: 0.3, duration: 0.5, ease: EASE }}
            >
              <div className="w-full h-full bg-gradient-to-b from-indigo-500 to-violet-500 shadow-[0_0_8px_rgba(99,102,241,0.4)]" />
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.6)] animate-pulse" />
            </motion.div>

            {/* Weekend stripes */}
            {days.map((day, i) => {
              if (day.getDay() !== 0 && day.getDay() !== 6) return null
              return (
                <div
                  key={`weekend-${i}`}
                  className="absolute top-0 bottom-0 bg-surface-50/30 dark:bg-surface-800/10"
                  style={{ left: `${i * dayWidth}px`, width: `${dayWidth}px` }}
                />
              )
            })}

            {/* Task bars */}
            <div style={{ width: `${days.length * dayWidth}px` }}>
              {taskBars.map(({ task, left, width }, i) => (
                <div
                  key={task.id}
                  className="h-10 flex items-center border-b border-surface-100/50 dark:border-surface-800/30 relative"
                >
                  {left >= 0 && width > 0 && (
                    <motion.div
                      initial={{ scaleX: 0, opacity: 0 }}
                      animate={{ scaleX: 1, opacity: 1 }}
                      transition={{
                        delay: 0.1 + i * 0.03,
                        duration: 0.4,
                        ease: EASE,
                      }}
                      className={cn(
                        'absolute h-6 rounded-md',
                        'bg-gradient-to-r from-indigo-500 to-violet-500',
                        'hover:from-indigo-400 hover:to-violet-400',
                        'hover:shadow-[0_0_16px_rgba(99,102,241,0.3)]',
                        'transition-shadow duration-300',
                        'cursor-pointer',
                        task.status === 'done' && 'opacity-40',
                        task.status === 'blocked' && 'from-rose-400 to-rose-500 hover:from-rose-300 hover:to-rose-400'
                      )}
                      style={{
                        left: `${left * dayWidth + 2}px`,
                        width: `${width * dayWidth - 4}px`,
                        transformOrigin: 'left center',
                      }}
                    >
                      <span className="absolute inset-0 flex items-center px-2 text-[10px] font-medium text-white truncate">
                        {task.title}
                      </span>
                    </motion.div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
