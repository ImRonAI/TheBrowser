/**
 * RelationshipManager - Sophisticated Task Relationship UI
 * 
 * A refined, minimal interface for managing task relationships.
 * Uses the Blurple design system with subtle interactions.
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
  Layers as LayersIcon
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
    <div className="space-y-3">
      {/* Add Relationship Button */}
      <motion.button
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        onClick={() => setIsAdding(!isAdding)}
        className={cn(
          "w-full flex items-center justify-center gap-2",
          "px-4 py-2.5 rounded-xl",
          "border border-dashed border-surface-300 dark:border-surface-600",
          "text-ink-muted dark:text-ink-inverse-muted",
          "hover:border-indigo-400 dark:hover:border-indigo-600",
          "hover:text-indigo-600 dark:hover:text-indigo-400",
          "hover:bg-indigo-500/5",
          "transition-all duration-200",
          isAdding && "border-indigo-400 dark:border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-indigo-500/5"
        )}
      >
        <PlusIcon className={cn("w-4 h-4 transition-transform duration-200", isAdding && "rotate-45")} />
        <span className="text-body-sm font-medium">
          {isAdding ? 'Cancel' : 'Link task'}
        </span>
      </motion.button>

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
          <div className="space-y-2">
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
// RELATIONSHIP CARD - Clean, minimal design
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
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn(
        "group relative flex items-center gap-3",
        "p-3 rounded-xl",
        "bg-surface-0 dark:bg-surface-900",
        "border border-surface-200 dark:border-surface-800",
        "hover:border-indigo-300 dark:hover:border-indigo-700",
        "hover:shadow-sm",
        "transition-all duration-200"
      )}
    >
      {/* Icon */}
      <div className={cn(
        "w-8 h-8 rounded-lg",
        "bg-indigo-500/10 dark:bg-indigo-500/20",
        "flex items-center justify-center",
        "text-indigo-600 dark:text-indigo-400"
      )}>
        {relConfig?.icon || <LinkIcon className="w-3.5 h-3.5" />}
      </div>
      
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-[10px] font-semibold uppercase tracking-wider",
            "px-1.5 py-0.5 rounded",
            "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
          )}>
            {relConfig?.label || relationship.type}
          </span>
        </div>
        <p className="text-sm font-medium text-ink dark:text-ink-inverse truncate mt-0.5">
          {relationship.targetTaskTitle}
        </p>
      </div>

      {/* Remove button */}
      <button
        onClick={onRemove}
        className={cn(
          "p-1.5 rounded-md",
          "opacity-0 group-hover:opacity-100",
          "text-ink-muted hover:text-rose-500",
          "hover:bg-rose-500/10",
          "transition-all duration-150"
        )}
        aria-label="Remove relationship"
      >
        <XIcon className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// RELATIONSHIP PICKER - Sophisticated inline search & select
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
      "p-4 rounded-xl",
      "bg-surface-0 dark:bg-surface-900",
      "border border-surface-200 dark:border-surface-800"
    )}>
      {/* Type Selector - Compact dropdown */}
      <div className="relative mb-3">
        <button
          onClick={() => setShowTypeSelector(!showTypeSelector)}
          className={cn(
            "w-full flex items-center justify-between",
            "px-3 py-2 rounded-lg",
            "bg-surface-50 dark:bg-surface-850",
            "border border-surface-200 dark:border-surface-800",
            "hover:border-indigo-400 dark:hover:border-indigo-600",
            "transition-colors"
          )}
        >
          <div className="flex items-center gap-2">
            <span className="text-indigo-600 dark:text-indigo-400">
              {selectedTypeConfig?.icon}
            </span>
            <span className="text-body-sm text-ink dark:text-ink-inverse">
              {selectedTypeConfig?.description}
            </span>
          </div>
          <ChevronIcon className={cn(
            "w-4 h-4 text-ink-muted transition-transform duration-200",
            showTypeSelector && "rotate-180"
          )} />
        </button>

        {/* Type Dropdown */}
        <AnimatePresence>
          {showTypeSelector && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className={cn(
                "absolute top-full left-0 right-0 mt-1 z-10",
                "p-1.5 rounded-lg",
                "bg-surface-0 dark:bg-surface-900",
                "border border-surface-200 dark:border-surface-800",
                "shadow-lg"
              )}
            >
              {RELATIONSHIP_TYPES.map(type => (
                <button
                  key={type.value}
                  onClick={() => {
                    setSelectedType(type.value)
                    setShowTypeSelector(false)
                  }}
                  className={cn(
                    "w-full flex items-center gap-2",
                    "px-3 py-2 rounded-md",
                    "text-body-sm text-ink dark:text-ink-inverse",
                    "hover:bg-indigo-500/10",
                    selectedType === type.value && "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                  )}
                >
                  <span className="text-indigo-600 dark:text-indigo-400">{type.icon}</span>
                  <span>{type.label}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Search Input */}
      <div className="relative mb-3">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search tasks..."
          autoFocus
          className={cn(
            "w-full pl-10 pr-4 py-2.5 rounded-lg",
            "bg-surface-50 dark:bg-surface-850",
            "border border-surface-200 dark:border-surface-800",
            "text-body-sm text-ink dark:text-ink-inverse",
            "placeholder:text-ink-muted/50",
            "focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-600",
            "transition-colors"
          )}
        />
      </div>

      {/* Results */}
      <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-thin">
        {filteredTasks.length > 0 ? (
          filteredTasks.map(t => (
            <motion.button
              key={t.id}
              whileHover={{ x: 2 }}
              onClick={() => onAdd(t.id, selectedType)}
              className={cn(
                "w-full flex items-center gap-3",
                "p-2.5 rounded-lg",
                "text-left",
                "hover:bg-indigo-500/5",
                "transition-colors duration-150"
              )}
            >
              <div className={cn(
                "w-7 h-7 rounded-md",
                "bg-surface-100 dark:bg-surface-800",
                "flex items-center justify-center",
                "text-ink-muted"
              )}>
                <LayersIcon className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink dark:text-ink-inverse truncate">
                  {t.title}
                </p>
                <p className="text-[10px] text-ink-muted dark:text-ink-inverse-muted uppercase tracking-wider">
                  {t.id}
                </p>
              </div>
              <ArrowIcon className="w-4 h-4 text-ink-muted opacity-0 group-hover:opacity-100" />
            </motion.button>
          ))
        ) : searchQuery ? (
          <div className="text-center py-6 text-ink-muted dark:text-ink-inverse-muted">
            <SearchIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-body-sm">No tasks found</p>
          </div>
        ) : (
          <div className="text-center py-6 text-ink-muted dark:text-ink-inverse-muted">
            <LayersIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-body-sm">Type to search tasks</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ICONS
// ─────────────────────────────────────────────────────────────────────────────

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
