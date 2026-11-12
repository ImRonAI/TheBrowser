import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Bug, CircleAlert, CircleCheck, CircleMinus, CircleX, Clock, FileText, Layers, Maximize2, MessageSquare, Minimize2, Search, X, Zap } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { Task } from '@/pages/types/task'
import { RenMark, RenIcon } from '@/components/brand'
import { TaskMetadataSidebar } from './TaskMetadataSidebar'
import { DescriptionTab } from './tabs/DescriptionTab'
import { RonTab } from './tabs/RonTab'
import { CommsTab } from './tabs/CommsTab'
import { HistoryTab } from './tabs/HistoryTab'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'

const EASE = [0.16, 1, 0.3, 1] as const

type ViewMode = 'normal' | 'fullscreen'

type TabId = 'description' | 'context' | 'ron' | 'comments' | 'comms' | 'history'

interface Tab {
  id: TabId
  label: string
  icon: ReactNode
  count?: number
}

const TABS: Tab[] = [
  { id: 'description', label: 'Description', icon: <FileText className="h-4 w-4" /> },
  { id: 'ron', label: 'Ren', icon: <RenMark className="h-4 w-4" /> },
  { id: 'comms', label: 'Comms', icon: <MessageSquare className="h-4 w-4" /> },
  { id: 'history', label: 'History', icon: <Clock className="h-4 w-4" /> },
]

/** Canonical issues add Context and replace legacy Comms with real Comments; the legacy Task model keeps CommsTab. */
function workspaceTabs(commentsCount?: number): Tab[] {
  return [
    TABS[0],
    { id: 'context', label: 'Context', icon: <Layers className="h-4 w-4" /> },
    TABS[1],
    { id: 'comments', label: 'Comments', icon: <MessageSquare className="h-4 w-4" />, count: commentsCount },
    TABS[3],
  ]
}

/** Ghost icon button: the sheet's window controls. */
const ICON_BUTTON = [
  'inline-flex h-8 w-8 items-center justify-center rounded-lg',
  'text-ink-secondary transition-colors duration-150 hover:bg-surface-100 hover:text-ink',
  'dark:text-ink-inverse-secondary dark:hover:bg-surface-850 dark:hover:text-ink-inverse',
].join(' ')

interface TaskDetailViewProps {
  task: Task
  onClose: () => void
  onUpdate?: (task: Task) => void
  onTaskClick?: (taskId: string) => void
  /** Canonical callers explicitly provide every pane; legacy stores are never mounted. */
  workspace?: {
    banner: ReactNode
    sidebar: ReactNode
    description: ReactNode
    context: ReactNode
    ron: ReactNode
    comments: ReactNode
    commentsCount?: number
    history: ReactNode
  }
}

export function TaskDetailView({ task, onClose, onUpdate, onTaskClick, workspace }: TaskDetailViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>('description')
  const [viewMode, setViewMode] = useState<ViewMode>('normal')
  const sheetRef = useRef<HTMLDivElement>(null)
  // Callers pass a new onClose on every render; the Escape handler always calls the latest one.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const tabsId = useId()

  // Focus moves into the sheet when it opens and back to what opened it (e.g. the issue card) when it closes.
  // Escape closes it. The listener is on the document in the bubble phase, so layers inside that handle
  // Escape themselves (Radix popovers and dialogs, editor menus, text assist, the Ask Ren composer) mark the
  // event defaultPrevented first and keep the sheet open.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    sheetRef.current?.focus({ preventScroll: true })
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  const toggleFullscreen = () => {
    setViewMode(prev => prev === 'fullscreen' ? 'normal' : 'fullscreen')
  }
  const tabId = (id: TabId) => `${tabsId}-tab-${id}`
  const panelId = (id: TabId) => `${tabsId}-panel-${id}`
  const panel = (id: TabId) => ({ role: 'tabpanel', id: panelId(id), 'aria-labelledby': tabId(id) }) as const

  const modalContent = (
    // The sheet renders in a portal, outside the browser's content area: `ron-content` gives it the Glass
    // theme's content tint (surfaces inside stack on the frosted `ron-glass-panel` sheet).
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: EASE }}
      className="ron-content fixed inset-0 z-[200] flex items-center justify-center p-6"
    >
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm dark:bg-black/60"
        onClick={onClose}
      />

      {/* Sheet */}
      <motion.div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 8 }}
        transition={{ duration: 0.22, ease: EASE }}
        className={cn(
          'ron-glass-panel relative z-10 flex flex-col overflow-hidden focus:outline-none',
          'bg-surface-0 text-ink dark:bg-surface-900 dark:text-ink-inverse',
          viewMode === 'fullscreen'
            ? 'h-screen w-screen max-h-none max-w-none rounded-none border-0'
            : [
                workspace ? 'w-full max-w-6xl' : 'w-full max-w-5xl',
                'h-[88dvh] max-h-[88dvh] min-h-0',
                'rounded-2xl border border-surface-200 shadow-float dark:border-surface-800',
              ]
        )}
      >
        <TaskDetailHeader
          task={task}
          viewMode={viewMode}
          onClose={onClose}
          onToggleFullscreen={toggleFullscreen}
        />
        {workspace && <div className="relative z-[2]">{workspace.banner}</div>}

        {/* Main content: tabbed pane + metadata sidebar */}
        <div className={cn('relative z-[1] flex min-h-0 flex-1', workspace ? 'flex-col overflow-y-auto lg:flex-row lg:overflow-hidden' : 'overflow-hidden')}>
          <div className={cn(
            'flex min-w-0 flex-1 flex-col border-surface-200 dark:border-surface-800',
            // Workspace sidebars bring their own top hairline when they stack under the tabs.
            workspace ? 'min-h-[400px] lg:min-h-0 lg:border-r' : 'border-r'
          )}>
            <TabNavigation
              tabs={workspace ? workspaceTabs(workspace.commentsCount) : TABS}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              tabId={tabId}
              panelId={panelId}
            />

            <div className="min-h-0 flex-1 overflow-hidden">
              {workspace ? <>
                <div {...panel('description')} hidden={activeTab !== 'description'} className="h-full">{workspace.description}</div>
                <div {...panel('context')} hidden={activeTab !== 'context'} className="h-full">{workspace.context}</div>
                <div {...panel('ron')} hidden={activeTab !== 'ron'} className="h-full"><ErrorBoundary componentName="RonTab">{workspace.ron}</ErrorBoundary></div>
                <div {...panel('comments')} hidden={activeTab !== 'comments'} className="h-full"><ErrorBoundary componentName="IssueComments">{workspace.comments}</ErrorBoundary></div>
                <div {...panel('history')} hidden={activeTab !== 'history'} className="h-full">{workspace.history}</div>
              </> : (
              <AnimatePresence mode="wait">
                {activeTab === 'description' && (
                  <TabPanel key="description" {...panel('description')}>
                    <DescriptionTab
                      task={task}
                      onUpdate={onUpdate}
                      onTaskClick={onTaskClick}
                    />
                  </TabPanel>
                )}
                {activeTab === 'ron' && (
                  <TabPanel key="ron" {...panel('ron')}>
                    <ErrorBoundary componentName="RonTab">
                      <RonTab task={task} />
                    </ErrorBoundary>
                  </TabPanel>
                )}
                {activeTab === 'comms' && (
                  <TabPanel key="comms" {...panel('comms')}>
                    <CommsTab task={task} />
                  </TabPanel>
                )}
                {activeTab === 'history' && (
                  <TabPanel key="history" {...panel('history')}>
                    <HistoryTab task={task} />
                  </TabPanel>
                )}
              </AnimatePresence>
              )}
            </div>
          </div>

          {workspace ? workspace.sidebar : <TaskMetadataSidebar
            task={task}
            onUpdate={onUpdate}
            onTaskClick={onTaskClick}
          />}
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
  const fullscreen = viewMode === 'fullscreen'
  return (
    <div className="relative z-[2] flex h-12 flex-shrink-0 items-center gap-3 border-b border-surface-200 pl-4 pr-2 dark:border-surface-800">
      {/* Identity: type, key, title, health */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {task.type && (
          <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-md bg-blurple-600/10 text-blurple-700 dark:bg-blurple-400/15 dark:text-blurple-300">
            <TaskTypeIcon type={task.type} />
          </span>
        )}

        <span className="flex-shrink-0 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted">
          {task.id}
        </span>

        <span aria-hidden className="h-3.5 w-px flex-shrink-0 bg-surface-200 dark:bg-surface-800" />

        <span className="min-w-0 truncate text-[13px] font-medium text-ink dark:text-ink-inverse">
          {task.title}
        </span>

        {task.healthIndicator && (
          <HealthBadge indicator={task.healthIndicator} />
        )}
      </div>

      {/* Window controls */}
      <div className="flex flex-shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={onToggleFullscreen}
          className={ICON_BUTTON}
          aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'}
          title={fullscreen ? 'Exit full screen' : 'Full screen'}
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>

        <button type="button" onClick={onClose} className={ICON_BUTTON} aria-label="Close" title="Close (Esc)">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB NAVIGATION — text tabs, 2px volt underline on the active tab
// ─────────────────────────────────────────────────────────────────────────────

interface TabNavigationProps {
  tabs: Tab[]
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  /** Element ids that pair each tab with its panel. */
  tabId: (tab: TabId) => string
  panelId: (tab: TabId) => string
}

function TabNavigation({ tabs, activeTab, onTabChange, tabId, panelId }: TabNavigationProps) {
  // WAI-ARIA tabs: only the active tab is in the Tab order; arrows, Home and End move between tabs.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.findIndex((tab) => tab.id === activeTab)
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
    if (next < 0) return
    event.preventDefault()
    onTabChange(tabs[next].id)
    document.getElementById(tabId(tabs[next].id))?.focus()
  }
  return (
    <div className="relative z-[1] flex-shrink-0 border-b border-surface-200 dark:border-surface-800">
      <div role="tablist" aria-label="Issue sections" className="flex items-center gap-6 overflow-x-auto px-5 scrollbar-none">
        {tabs.map((tab) => {
          const active = activeTab === tab.id
          return (
            <motion.button
              key={tab.id}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              aria-selected={active}
              aria-controls={panelId(tab.id)}
              tabIndex={active ? 0 : -1}
              onKeyDown={onKeyDown}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'relative flex h-11 flex-shrink-0 items-center gap-2 rounded-sm',
                'text-[13px] font-medium transition-colors duration-150',
                active
                  ? 'text-ink dark:text-ink-inverse'
                  : 'text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse'
              )}
            >
              <span className={cn('flex h-4 w-4 items-center justify-center', active && 'text-volt')}>{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.count !== undefined && tab.count > 0 && (
                <span className={cn(
                  'rounded-full px-1.5 py-0.5 font-mono text-[11px] font-medium leading-none tabular-nums',
                  active
                    ? 'bg-blurple-600/10 text-blurple-700 dark:bg-blurple-400/15 dark:text-blurple-300'
                    : 'bg-surface-100 text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary'
                )}>
                  {tab.count}
                </span>
              )}

              {active && (
                <motion.span
                  layoutId="tab-indicator"
                  className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-volt"
                  transition={{ duration: 0.2, ease: EASE }}
                />
              )}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB PANEL WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

function TabPanel({ children, ...attributes }: { children: ReactNode; role: 'tabpanel'; id: string; 'aria-labelledby': string }) {
  return (
    <motion.div
      {...attributes}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15, ease: EASE }}
      className="h-full overflow-hidden"
    >
      {children}
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH BADGE — semantic status tints
// ─────────────────────────────────────────────────────────────────────────────

function HealthBadge({ indicator }: { indicator: Task['healthIndicator'] }) {
  const config = {
    'on-track': {
      icon: <CircleCheck className="h-3.5 w-3.5" />,
      label: 'On track',
      color: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
    },
    'at-risk': {
      icon: <CircleAlert className="h-3.5 w-3.5" />,
      label: 'At risk',
      color: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
    },
    'critical': {
      icon: <CircleX className="h-3.5 w-3.5" />,
      label: 'Critical',
      color: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
    },
    'blocked': {
      icon: <CircleMinus className="h-3.5 w-3.5" />,
      label: 'Blocked',
      color: 'bg-surface-100 text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary'
    },
  }

  const { icon, label, color } = config[indicator || 'on-track']

  return (
    <span className={cn(
      'inline-flex h-6 flex-shrink-0 items-center gap-1 rounded-full px-2.5',
      'text-[12px] font-medium',
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
  const iconClass = 'h-3.5 w-3.5'

  switch (type) {
    case 'feature':
      return <RenIcon className={iconClass} />
    case 'bug':
      return <Bug className={iconClass} />
    case 'improvement':
      return <Zap className={iconClass} />
    case 'research':
      return <Search className={iconClass} />
    case 'documentation':
      return <FileText className={iconClass} />
    case 'support':
      return <MessageSquare className={iconClass} />
    default:
      return <FileText className={iconClass} />
  }
}
