import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X as XIcon, Plus as PlusIcon } from 'lucide-react'
import { TaskPriority } from '@/pages/types/task'
import { cn } from '@/utils/cn'

const EASE = [0.16, 1, 0.3, 1] as const

interface SubtaskCreationModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (title: string, priority?: TaskPriority) => void
}

export function SubtaskCreationModal({ isOpen, onClose, onCreate }: SubtaskCreationModalProps) {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setTitle('')
      setPriority('medium')
    }
  }, [isOpen])

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!title.trim()) return
    onCreate(title, priority)
    onClose()
  }

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[300] bg-surface-950/60 backdrop-blur-md"
          />

          {/* Modal */}
          <div className="fixed inset-0 z-[301] flex items-center justify-center pointer-events-none p-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.3, ease: EASE }}
              className={cn(
                "pointer-events-auto",
                "relative w-full max-w-lg",
                "rounded-2xl overflow-hidden",
                "border border-indigo-200/20 dark:border-indigo-900/40",
                "shadow-2xl shadow-indigo-500/10 dark:shadow-[0_0_60px_rgba(99,102,241,0.15)]",
                "bg-surface-0 dark:bg-[#0f0f14]",
              )}
            >
              {/* Ambient glow */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
                <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-br from-indigo-500/5 to-violet-500/5 dark:from-indigo-500/10 dark:to-violet-500/10 blur-3xl" />
              </div>

              {/* Top accent line */}
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-500/50 dark:via-indigo-400/60 to-transparent pointer-events-none z-10" />

              <form onSubmit={handleSubmit} className="relative flex flex-col">
                {/* Header */}
                <div className={cn(
                  "px-5 py-4 flex items-center justify-between",
                  "border-b border-surface-200/60 dark:border-white/[0.05]",
                  "bg-gradient-to-r from-white/70 via-indigo-50/40 to-white/70",
                  "dark:from-surface-900/80 dark:via-indigo-950/30 dark:to-surface-900/80",
                  "backdrop-blur-xl",
                )}>
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-indigo-500/10 dark:bg-indigo-500/20 flex items-center justify-center">
                      <PlusIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <h3 className="text-sm font-semibold text-ink dark:text-ink-inverse">
                      Create Subtask
                    </h3>
                  </div>
                  <motion.button
                    type="button"
                    onClick={onClose}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    aria-label="Close"
                    className="p-1.5 rounded-lg hover:bg-surface-200/60 dark:hover:bg-surface-800/60 transition-colors text-ink-muted dark:text-ink-inverse-muted"
                  >
                    <XIcon className="w-4 h-4" />
                  </motion.button>
                </div>

                {/* Body */}
                <div className="p-5 space-y-5">
                  {/* Title Input */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
                      Subtask Title
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="What needs to be done?"
                      autoFocus
                      className={cn(
                        "w-full px-4 py-2.5 rounded-xl",
                        "bg-surface-50 dark:bg-surface-900/60",
                        "border border-surface-200 dark:border-surface-700",
                        "text-sm text-ink dark:text-ink-inverse",
                        "placeholder:text-ink-muted/50 dark:placeholder:text-ink-inverse-muted/50",
                        "focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:focus:ring-indigo-400/30",
                        "focus:border-indigo-300 dark:focus:border-indigo-700",
                        "transition-all duration-200"
                      )}
                    />
                  </div>

                  {/* Priority Selection */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
                      Priority
                    </label>
                    <div className="flex gap-2">
                      {(['low', 'medium', 'high', 'critical'] as TaskPriority[]).map((p) => (
                        <motion.button
                          key={p}
                          type="button"
                          onClick={() => setPriority(p)}
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.97 }}
                          className={cn(
                            "flex-1 px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all duration-200 border",
                            priority === p
                              ? getPriorityClasses(p)
                              : "border-surface-200 dark:border-surface-700 text-ink-muted dark:text-ink-inverse-muted hover:bg-surface-100 dark:hover:bg-surface-800"
                          )}
                        >
                          {p}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className={cn(
                  "px-5 py-4 flex justify-end gap-3",
                  "border-t border-surface-200/60 dark:border-white/[0.05]",
                  "bg-surface-50/50 dark:bg-surface-900/30"
                )}>
                  <motion.button
                    type="button"
                    onClick={onClose}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      "px-4 py-2 rounded-xl",
                      "text-sm font-medium",
                      "text-ink-muted dark:text-ink-inverse-muted",
                      "hover:bg-surface-100 dark:hover:bg-surface-800",
                      "border border-surface-200 dark:border-surface-700",
                      "transition-colors"
                    )}
                  >
                    Cancel
                  </motion.button>
                  <motion.button
                    type="submit"
                    disabled={!title.trim()}
                    whileHover={{ scale: title.trim() ? 1.02 : 1 }}
                    whileTap={{ scale: title.trim() ? 0.98 : 1 }}
                    className={cn(
                      "px-4 py-2 rounded-xl",
                      "text-sm font-semibold text-white",
                      "bg-gradient-to-r from-indigo-500 to-violet-600",
                      "shadow-lg shadow-indigo-500/25",
                      "hover:shadow-indigo-500/40",
                      "transition-all duration-200",
                      "disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none",
                      "flex items-center gap-2"
                    )}
                  >
                    <PlusIcon className="w-4 h-4" />
                    Create Subtask
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )

  return createPortal(modalContent, document.body)
}

function getPriorityClasses(priority: TaskPriority) {
  switch (priority) {
    case 'critical':
      return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30 ring-1 ring-purple-500/20"
    case 'high':
      return "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30 ring-1 ring-indigo-500/20"
    case 'medium':
      return "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30 ring-1 ring-violet-500/20"
    case 'low':
      return "bg-surface-200/50 text-ink-muted dark:bg-surface-700/50 dark:text-ink-inverse-muted border-surface-300 dark:border-surface-600"
  }
}
