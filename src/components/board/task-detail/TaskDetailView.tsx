import { useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/cn'
import type { Task } from '@/pages/types/task'
import { TaskMetadataSidebar } from './TaskMetadataSidebar'
import { DescriptionTab } from './tabs/DescriptionTab'
import { RonTab } from './tabs/RonTab'
import { CommsTab } from './tabs/CommsTab'
import { HistoryTab } from './tabs/HistoryTab'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'

// Sophisticated easing
const EASE = [0.16, 1, 0.3, 1] as const

type ViewMode = 'normal' | 'fullscreen'

type TabId = 'description' | 'ron' | 'comms' | 'history'

interface Tab {
  id: TabId
  label: string
  icon: React.ReactNode
}

const TABS: Tab[] = [
  { id: 'description', label: 'Description', icon: <DocumentIcon /> },
  { id: 'ron', label: 'Ron', icon: <SparklesIcon /> },
  { id: 'comms', label: 'Comms', icon: <MessageIcon /> },
  { id: 'history', label: 'History', icon: <ClockIcon /> },
]

interface TaskDetailViewProps {
  task: Task
  onClose: () => void
  onUpdate?: (task: Task) => void
  onTaskClick?: (taskId: string) => void
}

export function TaskDetailView({ task, onClose, onUpdate, onTaskClick }: TaskDetailViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>('description')
  const [viewMode, setViewMode] = useState<ViewMode>('normal')

  const toggleFullscreen = () => {
    setViewMode(prev => prev === 'fullscreen' ? 'normal' : 'fullscreen')
  }

  const modalContent = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: EASE }}
      className="fixed inset-0 z-[200] flex items-center justify-center p-6"
    >
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-surface-950/60 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal Container */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 20 }}
        transition={{ duration: 0.35, ease: EASE }}
        className={cn(
          "relative z-10",
          "flex flex-col",
          "overflow-hidden",
          viewMode === 'fullscreen'
            ? "w-screen h-screen max-w-none max-h-none rounded-none border-0"
            : [
                "w-full max-w-5xl",
                "max-h-[88vh] min-h-0",
                "rounded-2xl",
                "border border-indigo-200/20 dark:border-indigo-900/40",
                "shadow-2xl shadow-indigo-500/10 dark:shadow-[0_0_80px_rgba(99,102,241,0.12)]",
              ]
        )}
        style={viewMode === 'normal' ? {
          background: 'var(--modal-bg, rgba(255,255,255,0.98))',
        } : undefined}
      >
        {/* Dark mode bg override via CSS class */}
        <div className={cn(
          "absolute inset-0 pointer-events-none",
          "bg-surface-0 dark:bg-[#0f0f14]",
          viewMode === 'fullscreen' ? "" : "rounded-2xl"
        )} />

        {/* Ambient glow overlays */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-indigo-500/5 to-violet-500/5 dark:from-indigo-500/8 dark:to-violet-500/8 blur-3xl" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-violet-500/3 to-transparent dark:from-violet-500/6 blur-2xl" />
        </div>

        {/* Top accent line */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-500/40 dark:via-indigo-400/50 to-transparent pointer-events-none z-10" />

        {/* Header */}
        <TaskDetailHeader
          task={task}
          viewMode={viewMode}
          onClose={onClose}
          onToggleFullscreen={toggleFullscreen}
        />

        {/* Main Content - Two Column Layout */}
        <div className="relative z-[1] flex-1 flex overflow-hidden min-h-0">
          {/* Left Panel - Tabbed Content */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-surface-200 dark:border-white/[0.05]">
            {/* Tab Navigation */}
            <TabNavigation
              tabs={TABS}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />

            {/* Tab Content */}
            <div className="flex-1 overflow-hidden min-h-0">
              <AnimatePresence mode="wait">
                {activeTab === 'description' && (
                  <TabPanel key="description">
                    <DescriptionTab
                      task={task}
                      onUpdate={onUpdate}
                      onTaskClick={onTaskClick}
                    />
                  </TabPanel>
                )}
                {activeTab === 'ron' && (
                  <TabPanel key="ron">
                    <ErrorBoundary componentName="RonTab">
                      <RonTab task={task} />
                    </ErrorBoundary>
                  </TabPanel>
                )}
                {activeTab === 'comms' && (
                  <TabPanel key="comms">
                    <CommsTab task={task} />
                  </TabPanel>
                )}
                {activeTab === 'history' && (
                  <TabPanel key="history">
                    <HistoryTab task={task} />
                  </TabPanel>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Right Panel - Metadata Sidebar */}
          <TaskMetadataSidebar
            task={task}
            onUpdate={onUpdate}
            onTaskClick={onTaskClick}
          />
        </div>
      </motion.div>
    </motion.div>
  )

  return createPortal(modalContent, document.body)
}

// ─────────────────────────────────────────────────────────────────────────────
// HEADER
// ─────────────────────────────────────────────────────────────────────────────

interface TaskDetailHeaderProps {
  task: Task
  viewMode: ViewMode
  onClose: () => void
  onToggleFullscreen: () => void
}

function TaskDetailHeader({ task, viewMode, onClose, onToggleFullscreen }: TaskDetailHeaderProps) {
  return (
    <div className={cn(
      "relative z-[2] flex-shrink-0",
      "px-4 py-1.5",
      "border-b border-surface-200/60 dark:border-white/[0.05]",
      "bg-gradient-to-r from-white/70 via-indigo-50/40 to-white/70",
      "dark:from-surface-900/80 dark:via-indigo-950/30 dark:to-surface-900/80",
      "backdrop-blur-xl",
    )}>
      <div className="flex items-center justify-between gap-4">
        {/* Left: Window Controls */}
        <div className="flex items-center gap-2">
          {/* Close — red dot */}
          <motion.button
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className={cn(
              "group w-3 h-3 rounded-full",
              "bg-[#ff5f57] shadow-[0_0_0_1px_rgba(0,0,0,0.12)]",
              "hover:brightness-110",
              "flex items-center justify-center",
              "transition-all duration-150"
            )}
            aria-label="Close"
          >
            <CloseIcon className="w-2 h-2 text-[#7a1f1a] opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.button>

          {/* Minimize — amber dot */}
          <motion.button
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className={cn(
              "group w-3 h-3 rounded-full",
              "bg-[#febc2e] shadow-[0_0_0_1px_rgba(0,0,0,0.12)]",
              "hover:brightness-110",
              "flex items-center justify-center",
              "transition-all duration-150"
            )}
            aria-label="Minimize"
          >
            <MinimizeIcon className="w-2 h-2 text-[#7a5a00] opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.button>

          {/* Fullscreen — green dot */}
          <motion.button
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.9 }}
            onClick={onToggleFullscreen}
            className={cn(
              "group w-3 h-3 rounded-full",
              "bg-[#28c840] shadow-[0_0_0_1px_rgba(0,0,0,0.12)]",
              "hover:brightness-110",
              "flex items-center justify-center",
              "transition-all duration-150"
            )}
            aria-label={viewMode === 'fullscreen' ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            <ExpandIcon className="w-2 h-2 text-[#0a4a1a] opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.button>
        </div>

        {/* Center: Title & Metadata */}
        <div className="flex-1 min-w-0 flex items-center justify-center gap-2">
          {/* Task Type Icon */}
          {task.type && (
            <span className={cn(
              "flex-shrink-0",
              "w-4 h-4 rounded",
              "bg-indigo-500/10 dark:bg-indigo-500/20",
              "flex items-center justify-center",
              "text-indigo-600 dark:text-indigo-400"
            )}>
              <TaskTypeIcon type={task.type} />
            </span>
          )}

          {/* Task ID */}
          <span className="text-[10px] font-mono uppercase tracking-wider flex-shrink-0 text-ink-muted dark:text-ink-inverse-muted opacity-60">
            {task.id}
          </span>

          {/* Title */}
          <span className="text-[11px] font-normal text-ink-secondary dark:text-ink-inverse-secondary truncate max-w-xs">
            {task.title}
          </span>

          {/* Health Indicator */}
          {task.healthIndicator && (
            <HealthBadge indicator={task.healthIndicator} />
          )}
        </div>

        {/* Right: More Options */}
        <div className="flex items-center gap-1">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className={cn(
              "p-2 rounded-lg",
              "text-ink-muted dark:text-ink-inverse-muted",
              "hover:bg-surface-200/60 dark:hover:bg-surface-800/60",
              "hover:text-ink dark:hover:text-ink-inverse",
              "transition-colors duration-200"
            )}
            aria-label="More options"
          >
            <MoreIcon className="w-4 h-4" />
          </motion.button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────

interface TabNavigationProps {
  tabs: Tab[]
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

function TabNavigation({ tabs, activeTab, onTabChange }: TabNavigationProps) {
  return (
    <div className={cn(
      "relative z-[1] flex-shrink-0",
      "px-4 pt-2",
      "border-b border-surface-200 dark:border-white/[0.05]",
      "bg-surface-50/50 dark:bg-surface-900/30"
    )}>
      <div className="flex items-center gap-0.5">
        {tabs.map((tab) => (
          <motion.button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "relative",
              "flex items-center gap-1.5",
              "px-3 py-2",
              "text-body-sm font-medium",
              "rounded-t-lg",
              "transition-colors duration-200",
              activeTab === tab.id
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-ink-muted dark:text-ink-inverse-muted hover:text-ink dark:hover:text-ink-inverse hover:bg-surface-100/60 dark:hover:bg-surface-800/40'
            )}
          >
            <span className="w-3.5 h-3.5">{tab.icon}</span>
            <span>{tab.label}</span>

            {/* Active Indicator */}
            {activeTab === tab.id && (
              <motion.div
                layoutId="tab-indicator"
                className={cn(
                  "absolute bottom-0 left-0 right-0 h-0.5",
                  "bg-gradient-to-r from-indigo-500 to-violet-500",
                  "shadow-[0_0_8px_rgba(99,102,241,0.5)]"
                )}
                transition={{
                  type: 'spring',
                  stiffness: 400,
                  damping: 30,
                }}
              />
            )}
          </motion.button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB PANEL WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

function TabPanel({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.15, ease: EASE }}
      className="h-full overflow-hidden"
    >
      {children}
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH BADGE
// ─────────────────────────────────────────────────────────────────────────────

function HealthBadge({ indicator }: { indicator: Task['healthIndicator'] }) {
  const config = {
    'on-track': {
      icon: (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12l3 3 5-6" />
        </svg>
      ),
      label: 'On Track',
      color: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
    },
    'at-risk': {
      icon: (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <circle cx="12" cy="16" r="1" fill="currentColor" />
        </svg>
      ),
      label: 'At Risk',
      color: 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
    },
    'critical': {
      icon: (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      ),
      label: 'Critical',
      color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
    },
    'blocked': {
      icon: (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      ),
      label: 'Blocked',
      color: 'bg-surface-200 dark:bg-surface-700 text-ink-muted dark:text-ink-inverse-muted'
    },
  }

  const { icon, label, color } = config[indicator || 'on-track']

  return (
    <span className={cn(
      "inline-flex items-center gap-1.5",
      "px-2 py-0.5 rounded-md",
      "text-[10px] font-semibold uppercase tracking-wider",
      color
    )}>
      {icon}
      <span>{label}</span>
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK TYPE ICON
// ─────────────────────────────────────────────────────────────────────────────

function TaskTypeIcon({ type }: { type: Task['type'] }) {
  const iconClass = "w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400"

  switch (type) {
    case 'feature':
      return <SparklesIcon className={iconClass} />
    case 'bug':
      return <BugIcon className={iconClass} />
    case 'improvement':
      return <LightningIcon className={iconClass} />
    case 'research':
      return <SearchIcon className={iconClass} />
    case 'documentation':
      return <DocumentIcon className={iconClass} />
    case 'support':
      return <MessageIcon className={iconClass} />
    default:
      return <DocumentIcon className={iconClass} />
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ICONS
// ─────────────────────────────────────────────────────────────────────────────

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-3.5 h-3.5"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  )
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-3.5 h-3.5"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" />
    </svg>
  )
}

function MessageIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-3.5 h-3.5"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-3.5 h-3.5"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-2 h-2"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function MinimizeIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-2 h-2"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function ExpandIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-2 h-2"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  )
}

function MoreIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-4 h-4"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  )
}

function BugIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-3.5 h-3.5"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
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
    <svg className={className || "w-3.5 h-3.5"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-3.5 h-3.5"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}
