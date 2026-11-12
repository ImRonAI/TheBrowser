/**
 * RelationshipManager - task relationship UI
 *
 * Link a task, pick the relationship type, and see existing links as quiet cards.
 * Ink and paper surfaces with volt only on the active choice.
 */

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Task, TaskRelationship } from '@/pages/types/task'
import { useTaskStore } from '@/stores/taskStore'
import { cn } from '@/utils/cn'
import {
  Link2 as LinkIcon,
  Plus as PlusIcon,
  X as XIcon,
  Search as SearchIcon,
  ArrowRight as ArrowIcon,
  GitCommit as CommitIcon,
  Layers as LayersIcon,
  ChevronDown as ChevronIcon
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type RelationshipType = 'parent' | 'child' | 'blocks' | 'blocked-by' | 'relates-to' | 'implements'

interface RelationshipConfig {
  value: RelationshipType
  label: string
  description: string
  icon: React.ReactNode
}

const RELATIONSHIP_TYPES: RelationshipConfig[] = [
  {
    value: 'parent',
    label: 'Parent',
    description: 'This task is a parent of',
    icon: <LayersIcon className="w-3.5 h-3.5" />
  },
  {
    value: 'child',
    label: 'Child',
    description: 'This task is a child of',
    icon: <CommitIcon className="w-3.5 h-3.5" />
  },
  {
    value: 'blocks',
    label: 'Blocks',
    description: 'This task blocks',
    icon: <ArrowIcon className="w-3.5 h-3.5" />
  },
  {
    value: 'blocked-by',
    label: 'Blocked by',
    description: 'This task is blocked by',
    icon: <ArrowIcon className="w-3.5 h-3.5 rotate-180" />
  },
  {
    value: 'relates-to',
    label: 'Related',
    description: 'This task relates to',
    icon: <LinkIcon className="w-3.5 h-3.5" />
  },
  {
    value: 'implements',
    label: 'Implements',
    description: 'This task implements',
    icon: <CommitIcon className="w-3.5 h-3.5" />
  },
]

/** Bordered text field inside the picker card (transparent so the card's paper shows). */
const FIELD = cn(
  'ron-field h-9 w-full rounded-lg border border-surface-200 bg-transparent text-[13px] text-ink',
  'dark:border-surface-800 dark:text-ink-inverse',
  'transition-colors duration-150'
)

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface RelationshipManagerProps {
  task: Task
  onRelationshipAdd?: (type: string, targetId: string, relType?: string) => void
  onRelationshipRemove?: (relationshipId: string) => void
}

export function RelationshipManager({ task, onRelationshipAdd, onRelationshipRemove }: RelationshipManagerProps) {
  const [isAdding, setIsAdding] = useState(false)

  // Filter out excessive "Parent Of" items
  const relationships = (task.relationships || []).filter(r => r.type !== 'parent')

  return (
    <div className="space-y-2">
      {/* Add Relationship Button */}
      <button
        type="button"
        onClick={() => setIsAdding(!isAdding)}
        className={cn(
          "flex h-9 w-full items-center justify-center gap-2 rounded-lg",
          "border border-dashed",
          "text-[13px] font-medium",
          "transition-colors duration-150",
          isAdding
            ? "border-blurple-500 bg-blurple-600/5 text-blurple-700 dark:border-blurple-400 dark:bg-blurple-400/10 dark:text-blurple-300"
            : cn(
                "border-surface-300 text-ink-muted dark:border-surface-700 dark:text-ink-inverse-muted",
                "hover:border-blurple-500 hover:text-blurple-700 dark:hover:border-blurple-400 dark:hover:text-blurple-300"
              )
        )}
      >
        <PlusIcon className={cn("h-4 w-4 transition-transform duration-200", isAdding && "rotate-45")} />
        <span>
          {isAdding ? 'Cancel' : 'Link task'}
        </span>
      </button>

      {/* Inline Add Interface */}
      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <RelationshipPicker
              task={task}
              onAdd={(targetId, relType) => {
                onRelationshipAdd?.('task', targetId, relType)
                setIsAdding(false)
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Existing Relationships List */}
      <AnimatePresence mode="popLayout">
        {relationships.length > 0 && (
          <div className="space-y-1.5">
            {relationships.map(rel => (
              <RelationshipCard
                key={rel.id}
                relationship={rel}
                onRemove={() => onRelationshipRemove?.(rel.id)}
              />
            ))}
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// RELATIONSHIP CARD
// ─────────────────────────────────────────────────────────────────────────────

function RelationshipCard({
  relationship,
  onRemove
}: {
  relationship: TaskRelationship
  onRemove: () => void
}) {
  const relConfig = RELATIONSHIP_TYPES.find(r => r.value === relationship.type)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className={cn(
        "group relative flex items-center gap-2.5",
        "rounded-xl p-2.5",
        "border border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-900",
        "hover:border-surface-300 dark:hover:border-surface-700",
        "transition-colors duration-150"
      )}
    >
      {/* Icon */}
      <span className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
        "bg-blurple-600/10 text-blurple-700 dark:bg-blurple-400/15 dark:text-blurple-300"
      )}>
        {relConfig?.icon || <LinkIcon className="w-3.5 h-3.5" />}
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <span className="block font-mono text-[10.5px] font-medium uppercase leading-4 tracking-[0.08em] text-blurple-700 dark:text-blurple-300">
          {relConfig?.label || relationship.type}
        </span>
        <p className="truncate text-[13px] font-medium leading-5 text-ink dark:text-ink-inverse">
          {relationship.targetTaskTitle}
        </p>
      </div>

      {/* Remove button */}
      <button
        type="button"
        onClick={onRemove}
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-lg",
          "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          "text-ink-muted dark:text-ink-inverse-muted",
          "hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-300",
          "transition-[opacity,background-color,color] duration-150"
        )}
        aria-label="Remove relationship"
        title="Remove relationship"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// RELATIONSHIP PICKER — type menu, search, results
// ─────────────────────────────────────────────────────────────────────────────

interface RelationshipPickerProps {
  task: Task
  onAdd: (targetId: string, relType: string) => void
}

function RelationshipPicker({ task, onAdd }: RelationshipPickerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedType, setSelectedType] = useState<RelationshipType>('relates-to')
  const [showTypeSelector, setShowTypeSelector] = useState(false)

  const tasks = useTaskStore(state => state.tasks)

  // Filter tasks excluding current
  const filteredTasks = useMemo(() => {
    return tasks
      .filter(t =>
        t.id !== task.id &&
        (t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
         t.id.toLowerCase().includes(searchQuery.toLowerCase()))
      )
      .slice(0, 6)
  }, [tasks, task.id, searchQuery])

  const selectedTypeConfig = RELATIONSHIP_TYPES.find(r => r.value === selectedType)

  return (
    <div className={cn(
      "space-y-2 rounded-xl p-2.5",
      "border border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-900"
    )}>
      {/* Type Selector - Compact dropdown */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowTypeSelector(!showTypeSelector)}
          className={cn(
            FIELD,
            "flex items-center justify-between gap-2 px-3 text-left",
            "hover:border-surface-300 dark:hover:border-surface-700"
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-blurple-600 dark:text-blurple-400">
              {selectedTypeConfig?.icon}
            </span>
            <span className="truncate">
              {selectedTypeConfig?.description}
            </span>
          </span>
          <ChevronIcon className={cn(
            "h-4 w-4 shrink-0 text-ink-muted transition-transform duration-200 dark:text-ink-inverse-muted",
            showTypeSelector && "rotate-180"
          )} />
        </button>

        {/* Type Dropdown */}
        <AnimatePresence>
          {showTypeSelector && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className={cn(
                "absolute left-0 right-0 top-full z-10 mt-1",
                "rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-float"
              )}
            >
              {RELATIONSHIP_TYPES.map(type => (
                <button
                  type="button"
                  key={type.value}
                  onClick={() => {
                    setSelectedType(type.value)
                    setShowTypeSelector(false)
                  }}
                  className={cn(
                    "flex h-8 w-full items-center gap-2 rounded-lg px-2.5",
                    "text-[13px] transition-colors duration-150",
                    selectedType === type.value
                      ? "bg-blurple-600/10 font-medium text-blurple-700 dark:bg-blurple-400/15 dark:text-blurple-300"
                      : "text-ink hover:bg-muted dark:text-ink-inverse"
                  )}
                >
                  <span className="text-blurple-600 dark:text-blurple-400">{type.icon}</span>
                  <span>{type.label}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Search Input */}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted dark:text-ink-inverse-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search tasks…"
          aria-label="Search tasks"
          autoFocus
          className={cn(
            FIELD,
            "pl-9 pr-3",
            "placeholder:text-ink-muted dark:placeholder:text-ink-inverse-muted",
            "focus:border-blurple-500 focus:outline-none dark:focus:border-blurple-400",
            "focus-visible:ring-2 focus-visible:ring-blurple-600/20 focus-visible:ring-offset-0 dark:focus-visible:ring-blurple-400/25"
          )}
        />
      </div>

      {/* Results */}
      <div className="max-h-48 space-y-0.5 overflow-y-auto scrollbar-thin">
        {filteredTasks.length > 0 ? (
          filteredTasks.map(t => (
            <button
              type="button"
              key={t.id}
              onClick={() => onAdd(t.id, selectedType)}
              className={cn(
                "group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left",
                "hover:bg-surface-100 dark:hover:bg-surface-850",
                "transition-colors duration-150"
              )}
            >
              <span className={cn(
                "grid h-7 w-7 shrink-0 place-items-center rounded-md",
                "border border-surface-200 text-ink-muted dark:border-surface-800 dark:text-ink-inverse-muted"
              )}>
                <LayersIcon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium leading-5 text-ink dark:text-ink-inverse">
                  {t.title}
                </p>
                <p className="truncate font-mono text-[11px] uppercase leading-4 tracking-[0.06em] text-ink-muted dark:text-ink-inverse-muted">
                  {t.id}
                </p>
              </span>
              <ArrowIcon className="h-4 w-4 shrink-0 text-ink-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:text-ink-inverse-muted" />
            </button>
          ))
        ) : searchQuery ? (
          <div className="py-5 text-center text-ink-muted dark:text-ink-inverse-muted">
            <SearchIcon className="mx-auto mb-2 h-5 w-5 text-ink-ghost dark:text-surface-600" />
            <p className="text-[13px] text-ink-muted dark:text-ink-inverse-muted">No tasks match that search</p>
          </div>
        ) : (
          <div className="py-5 text-center text-ink-muted dark:text-ink-inverse-muted">
            <LayersIcon className="mx-auto mb-2 h-5 w-5 text-ink-ghost dark:text-surface-600" />
            <p className="text-[13px] text-ink-muted dark:text-ink-inverse-muted">Type to find a task</p>
          </div>
        )}
      </div>
    </div>
  )
}
