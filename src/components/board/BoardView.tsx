import { useState } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import { KanbanBoard } from './KanbanBoard'
import { CalendarView } from './CalendarView'
import { ListView } from './ListView'
import { GanttView } from './GanttView'

type ViewMode = 'kanban' | 'calendar' | 'list' | 'gantt'
type CalendarMode = 'quarter' | 'month' | 'week' | 'day'

// Sophisticated easing
const EASE = [0.16, 1, 0.3, 1] as const

export function BoardView() {
  const [viewMode, setViewMode] = useState<ViewMode>('kanban')
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('week')

  return (
    <div className="h-full flex flex-col">
      {/* View Controls */}
      <motion.div 
        className="flex-shrink-0 px-8 py-5"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        <div className="flex items-center justify-between">
          {/* Primary View Toggle */}
          <ViewToggle viewMode={viewMode} onViewChange={setViewMode} />

          {/* Calendar Sub-Controls */}
          <AnimatePresence mode="wait">
            {viewMode === 'calendar' && (
              <motion.div
                initial={{ opacity: 0, x: 24, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24, scale: 0.95 }}
                transition={{ duration: 0.4, ease: EASE }}
              >
                <CalendarModeToggle mode={calendarMode} onModeChange={setCalendarMode} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* View Content */}
      <div className="flex-1 min-h-0 overflow-hidden px-8 pb-8">
        <LayoutGroup>
          <AnimatePresence mode="wait">
            {viewMode === 'kanban' && (
              <motion.div
                key="kanban"
                className="h-full"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                transition={{ duration: 0.5, ease: EASE }}
              >
                <KanbanBoard />
              </motion.div>
            )}
            {viewMode === 'calendar' && (
              <motion.div
                key="calendar"
                className="h-full"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                transition={{ duration: 0.5, ease: EASE }}
              >
                <CalendarView mode={calendarMode} />
              </motion.div>
            )}
            {viewMode === 'list' && (
              <motion.div
                key="list"
                className="h-full"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                transition={{ duration: 0.5, ease: EASE }}
              >
                <ListView />
              </motion.div>
            )}
            {viewMode === 'gantt' && (
              <motion.div
                key="gantt"
                className="h-full"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                transition={{ duration: 0.5, ease: EASE }}
              >
                <GanttView />
              </motion.div>
            )}
          </AnimatePresence>
        </LayoutGroup>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEW TOGGLE - 4 view modes
// ─────────────────────────────────────────────────────────────────────────────

interface ViewToggleProps {
  viewMode: ViewMode
  onViewChange: (mode: ViewMode) => void
}

const VIEW_OPTIONS: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  { id: 'kanban', label: 'Board', icon: <KanbanIcon /> },
  { id: 'calendar', label: 'Calendar', icon: <CalendarIcon /> },
  { id: 'list', label: 'List', icon: <ListIcon /> },
  { id: 'gantt', label: 'Gantt', icon: <GanttIcon /> },
]

function ViewToggle({ viewMode, onViewChange }: ViewToggleProps) {
  const activeIdx = VIEW_OPTIONS.findIndex(v => v.id === viewMode)

  return (
    <div className="relative flex items-center p-1.5 rounded-xl glass-subtle border border-white/10 dark:border-white/5">
      {/* Sliding indicator */}
      <motion.div
        className="absolute top-1.5 bottom-1.5 rounded-lg bg-white/50 dark:bg-white/10 shadow-sm"
        layoutId="view-indicator"
        initial={false}
        style={{
          width: `calc(${100 / VIEW_OPTIONS.length}% - 6px)`,
          left: `calc(${activeIdx * (100 / VIEW_OPTIONS.length)}% + 6px)`,
        }}
        transition={{
          type: 'spring',
          stiffness: 400,
          damping: 35,
        }}
      />

      {VIEW_OPTIONS.map((opt) => (
        <ToggleButton
          key={opt.id}
          active={viewMode === opt.id}
          onClick={() => onViewChange(opt.id)}
          icon={opt.icon}
          label={opt.label}
        />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR MODE TOGGLE — now with Quarter
// ─────────────────────────────────────────────────────────────────────────────

interface CalendarModeToggleProps {
  mode: CalendarMode
  onModeChange: (mode: CalendarMode) => void
}

function CalendarModeToggle({ mode, onModeChange }: CalendarModeToggleProps) {
  const modes: CalendarMode[] = ['quarter', 'month', 'week', 'day']
  const activeIndex = modes.indexOf(mode)
  
  return (
    <div className="relative flex items-center p-1 rounded-lg glass-subtle border border-white/10 dark:border-white/5">
      {/* Sliding indicator */}
      <motion.div
        className="absolute top-1 bottom-1 rounded-md bg-white/50 dark:bg-white/10 shadow-sm"
        layoutId="calendar-mode-indicator"
        initial={false}
        style={{
          width: `calc(${100 / modes.length}% - 4px)`,
          left: `calc(${activeIndex * (100 / modes.length)}% + 4px)`,
        }}
        transition={{
          type: 'spring',
          stiffness: 400,
          damping: 35,
        }}
      />
      
      {modes.map((m) => (
        <motion.button
          key={m}
          onClick={() => onModeChange(m)}
          whileTap={{ scale: 0.95 }}
          className={`
            relative z-10 px-4 py-1.5
            text-label uppercase tracking-wider
            transition-colors duration-300
            ${mode === m 
              ? 'text-ink dark:text-ink-inverse' 
              : 'text-ink-muted dark:text-ink-inverse-muted hover:text-ink-secondary dark:hover:text-ink-inverse-secondary'
            }
          `}
        >
          {m}
        </motion.button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TOGGLE BUTTON
// ─────────────────────────────────────────────────────────────────────────────

interface ToggleButtonProps {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}

function ToggleButton({ active, onClick, icon, label }: ToggleButtonProps) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      className={`
        relative z-10 flex items-center gap-2.5 px-5 py-2.5
        text-body-sm font-medium
        transition-colors duration-300
        ${active 
          ? 'text-ink dark:text-ink-inverse' 
          : 'text-ink-muted dark:text-ink-inverse-muted hover:text-ink-secondary dark:hover:text-ink-inverse-secondary'
        }
      `}
    >
      <motion.span 
        className="w-4 h-4"
        animate={{ 
          scale: active ? 1 : 0.9,
          opacity: active ? 1 : 0.6 
        }}
        transition={{ duration: 0.2 }}
      >
        {icon}
      </motion.span>
      <span>{label}</span>
    </motion.button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ICONS
// ─────────────────────────────────────────────────────────────────────────────

function KanbanIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="5" height="18" rx="1.5" />
      <rect x="9.5" y="3" width="5" height="11" rx="1.5" />
      <rect x="16" y="3" width="5" height="14" rx="1.5" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}

function GanttIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="10" height="4" rx="1" />
      <rect x="5" y="10" width="12" height="4" rx="1" />
      <rect x="7" y="16" width="8" height="4" rx="1" />
    </svg>
  )
}
