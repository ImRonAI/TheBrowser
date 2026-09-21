import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Task, ContextLink } from '@/pages/types/task'
import { Plus, Link as LinkIcon, Image as ImageIcon, FileText, MessageSquare, TrendingUp, X } from 'lucide-react'
import { cn } from '@/utils/cn'

interface ContextTabProps {
  task: Task
  onUpdate?: (task: Task) => void
}

type ContextType = NonNullable<ContextLink['type']>

const CONTEXT_SECTIONS: { type: ContextType; label: string; icon: React.ReactNode; helper: string }[] = [
  { type: 'spec', label: 'Specs', icon: <FileText className="w-4 h-4" />, helper: 'Requirements, specs, PRDs, and briefs.' },
  { type: 'screenshot', label: 'Screenshots', icon: <ImageIcon className="w-4 h-4" />, helper: 'UI references, captures, or visual proofs.' },
  { type: 'feedback', label: 'Feedback', icon: <MessageSquare className="w-4 h-4" />, helper: 'Stakeholder notes and user feedback.' },
  { type: 'competitive', label: 'Competitive Analysis', icon: <TrendingUp className="w-4 h-4" />, helper: 'Comparative links, intel, and insights.' },
  { type: 'comment', label: 'Comments', icon: <MessageSquare className="w-4 h-4" />, helper: 'Quick contextual notes.' },
]

export function ContextTab({ task, onUpdate }: ContextTabProps) {
  const contextLinks = task.contextLinks || []

  const counts = useMemo(() => {
    return CONTEXT_SECTIONS.reduce<Record<string, number>>((acc, section) => {
      acc[section.type] = contextLinks.filter((link) => link.type === section.type).length
      return acc
    }, {})
  }, [contextLinks])

  const updateLinks = (nextLinks: ContextLink[]) => {
    if (!onUpdate) return
    onUpdate({ ...task, contextLinks: nextLinks })
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-6 pt-4 pb-3 border-b border-surface-200/50 dark:border-surface-700/50 glass-subtle">
        <h3 className="text-body-lg font-semibold text-ink dark:text-ink-inverse">Context</h3>
        <p className="mt-1 text-body-xs text-ink-muted dark:text-ink-inverse-muted">
          Capture specs, screenshots, feedback, and competitive context in one place.
        </p>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          {CONTEXT_SECTIONS.map((section) => (
            <div key={section.type} className="rounded-xl border border-surface-200/60 dark:border-surface-700/60 bg-surface-0/60 dark:bg-surface-900/40 px-3 py-3">
              <div className="flex items-center gap-2 text-ink-muted dark:text-ink-inverse-muted">
                {section.icon}
                <span className="text-[10px] uppercase tracking-wider">{section.label}</span>
              </div>
              <p className="mt-2 text-lg font-semibold text-ink dark:text-ink-inverse">
                {counts[section.type] || 0}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-6">
        {CONTEXT_SECTIONS.map((section) => (
          <ContextSection
            key={section.type}
            section={section}
            items={contextLinks.filter((link) => link.type === section.type)}
            onAdd={(item) => updateLinks([item, ...contextLinks])}
            onRemove={(id) => updateLinks(contextLinks.filter((link) => link.id !== id))}
          />
        ))}
      </div>
    </div>
  )
}

function ContextSection({
  section,
  items,
  onAdd,
  onRemove,
}: {
  section: { type: ContextType; label: string; icon: React.ReactNode; helper: string }
  items: ContextLink[]
  onAdd: (item: ContextLink) => void
  onRemove: (id: string) => void
}) {
  const [isAdding, setIsAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')

  const handleAdd = () => {
    if (!title.trim()) return
    onAdd({
      id: crypto.randomUUID(),
      title: title.trim(),
      url: url.trim(),
      type: section.type,
      addedBy: 'user',
    })
    setTitle('')
    setUrl('')
    setIsAdding(false)
  }

  return (
    <div className="rounded-3xl border border-surface-200/60 dark:border-surface-700/60 bg-surface-0/70 dark:bg-surface-900/40 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl glass-subtle flex items-center justify-center text-accent dark:text-accent-light">
            {section.icon}
          </div>
          <div>
            <h4 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">{section.label}</h4>
            <p className="text-[11px] text-ink-muted dark:text-ink-inverse-muted">{section.helper}</p>
          </div>
        </div>
        <button
          onClick={() => setIsAdding((prev) => !prev)}
          className={cn(
            'inline-flex items-center gap-2 px-3 py-2 rounded-full text-[11px] font-semibold uppercase tracking-wider border',
            isAdding
              ? 'border-accent/50 text-accent dark:text-accent-light'
              : 'border-surface-200 dark:border-surface-700 text-ink-muted dark:text-ink-inverse-muted'
          )}
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      </div>

      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 grid gap-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                className="w-full rounded-xl border border-surface-200 dark:border-surface-700 bg-transparent px-3 py-2 text-body-sm"
              />
              <div className="flex items-center gap-2 rounded-xl border border-surface-200 dark:border-surface-700 bg-transparent px-3 py-2">
                <LinkIcon className="w-4 h-4 text-ink-muted dark:text-ink-inverse-muted" />
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Optional link"
                  className="w-full bg-transparent text-body-sm focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setIsAdding(false)}
                  className="px-3 py-2 rounded-full text-[11px] font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdd}
                  className="px-3 py-2 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-accent/10 text-accent dark:text-accent-light"
                >
                  Save
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <p className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">No items yet.</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="group flex items-center justify-between rounded-2xl border border-surface-200 dark:border-surface-700 px-4 py-3">
              <div>
                <p className="text-body-sm font-medium text-ink dark:text-ink-inverse">{item.title}</p>
                {item.url && (
                  <a
                    href={item.url}
                    className="text-body-xs text-accent dark:text-accent-light"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {item.url}
                  </a>
                )}
              </div>
              <button
                onClick={() => onRemove(item.id)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-rose-500/10 text-rose-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
