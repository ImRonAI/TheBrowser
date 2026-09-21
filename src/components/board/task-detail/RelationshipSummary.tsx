import * as HoverCard from '@radix-ui/react-hover-card'
import { motion } from 'framer-motion'
import { cn } from '@/utils/cn'
import type { Task, Subtask, TaskRelationship } from '@/pages/types/task'
import { Link, ArrowRight, Layers } from 'lucide-react'

interface RelationshipSummaryProps {
  task: Task
  onTaskClick?: (taskId: string) => void
}

export function RelationshipSummary({ task, onTaskClick }: RelationshipSummaryProps) {
  const subtasks = task.subtasks || []
  const relationships = task.relationships || []
  
  console.log('[RelationshipSummary] Render', { subtasks: subtasks.length, relationships: relationships.length })
  
  if (subtasks.length === 0 && relationships.length === 0) return null

  return (
    <div className="space-y-2 mb-4">
      {/* Parent Relationship Summary */}
      {subtasks.length > 0 && (
        <RelationshipHoverCard
          triggerText={`Is the parent of ${subtasks.length} issues`}
          count={subtasks.length}
          icon={<Layers size={14} />}
        >
          <SubtaskList subtasks={subtasks} onTaskClick={null} /> 
        </RelationshipHoverCard>
      )}

      {/* Other Relationships Summary */}
      {relationships.length > 0 && (
        <RelationshipHoverCard
          triggerText={`Has relationships with ${relationships.length} issues`}
          count={relationships.length}
          icon={<Link size={14} />}
        >
          <GroupedRelationships 
            relationships={relationships} 
            onTaskClick={onTaskClick}
          />
        </RelationshipHoverCard>
      )}
    </div>
  )
}

function RelationshipHoverCard({ 
  triggerText, 
  icon,
  children 
}: { 
  triggerText: string
  count: number
  icon: React.ReactNode
  children: React.ReactNode 
}) {
  return (
    <HoverCard.Root openDelay={200} closeDelay={300}>
      <HoverCard.Trigger asChild>
        <button 
          className="
            flex items-center gap-2 
            text-sm text-accent dark:text-accent-light 
            hover:underline hover:text-accent-hover
            transition-colors text-left
          "
        >
          {icon}
          <span>{triggerText}</span>
        </button>
      </HoverCard.Trigger>
      
      <HoverCard.Portal>
        <HoverCard.Content 
          className="z-[70]" 
          sideOffset={5}
          side="left"
          align="start"
        >
          <motion.div
            initial={{ opacity: 0, x: 10, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="
              w-72 max-h-[320px] overflow-y-auto
              bg-surface-0 dark:bg-surface-800 
              border border-surface-200 dark:border-surface-700
              shadow-xl rounded-xl
              p-3
              scrollbar-thin
            "
          >
            {children}
          </motion.div>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  )
}

function SubtaskList({ subtasks, onTaskClick: _onTaskClick }: { subtasks: Subtask[], onTaskClick?: ((id: string) => void) | null }) {
  return (
    <div className="space-y-2">
      <h4 className="text-[10px] font-bold uppercase text-ink-muted dark:text-ink-inverse-muted mb-2 px-1">
        Subtasks
      </h4>
      {subtasks.map((st) => (
        <div 
          key={st.id}
          className="
            flex items-start gap-2 p-2 rounded-lg 
            hover:bg-surface-100 dark:hover:bg-surface-700
            transition-colors
          "
        >
          <div className={cn(
            "mt-0.5 w-3 h-3 rounded-full border",
            st.completed 
              ? "bg-success border-success" 
              : "border-ink-muted/50"
          )} />
          <span className={cn(
            "text-xs text-ink dark:text-ink-inverse line-clamp-2",
            st.completed && "line-through text-ink-muted"
          )}>
            {st.title}
          </span>
        </div>
      ))}
    </div>
  )
}

function GroupedRelationships({ 
  relationships, 
  onTaskClick 
}: { 
  relationships: TaskRelationship[]
  onTaskClick?: (id: string) => void
}) {
  // Group by type
  const grouped = relationships.reduce((acc, rel) => {
    const type = rel.type
    if (!acc[type]) acc[type] = []
    acc[type].push(rel)
    return acc
  }, {} as Record<string, TaskRelationship[]>)

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([type, rels]) => (
        <div key={type} className="space-y-1">
          <h4 className="
            text-[10px] font-bold uppercase 
            text-ink-muted dark:text-ink-inverse-muted 
            px-1 border-b border-surface-100 dark:border-surface-700/50 pb-1 mb-1
          ">
            {type.replace('-', ' ')}
          </h4>
          <div className="space-y-0.5">
            {rels.map(rel => (
              <button
                key={rel.id}
                onClick={() => onTaskClick?.(rel.targetTaskId)}
                className="
                  w-full text-left
                  group flex items-center gap-2 p-2 rounded-lg
                  hover:bg-accent/10 
                  transition-colors
                "
              >
                <Link size={12} className="text-ink-muted group-hover:text-accent" />
                <span className="text-xs text-ink dark:text-ink-inverse font-medium truncate group-hover:text-accent">
                  {rel.targetTaskTitle}
                </span>
                <ArrowRight size={10} className="ml-auto opacity-0 group-hover:opacity-100 text-accent" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
