/**
 * Context Picker - Nested Context Selection
 * 
 * A sophisticated nested listbox for adding context to prompts.
 * Features sub-menus, search, badges, and multi-select.
 * 
 * UPDATED: Uses React Portal to avoid z-index clipping in scrolling containers.
 * UPDATED: Uses correct electronAPI for tab data.
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  // PlusIcon, -> Removed unused import 
  DocumentIcon, 
  GlobeAltIcon, 
  ChatBubbleLeftRightIcon, 
  CodeBracketIcon, 
  SparklesIcon, 
  ClipboardDocumentListIcon,
  ArrowUpTrayIcon,
  FolderIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  CheckIcon,
  LinkIcon,
} from '@heroicons/react/24/outline'
import { cn } from '@/utils/cn'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ContextItem {
  id: string
  type: 'file' | 'tab' | 'conversation' | 'project' | 'interest' | 'task'
  name: string
  description?: string
  icon?: React.ComponentType<{ className?: string }>
  meta?: string // e.g., "2 hours ago", "3 files"
  color?: string
  favicon?: string // URL to favicon image (for tabs)
  url?: string // Complete URL for tabs
  title?: string // Complete title for tabs
}

interface ContextCategory {
  id: string
  name: string
  icon: React.ComponentType<{ className?: string }>
  description: string
  items: ContextItem[]
  actions?: { id: string; name: string; icon: React.ComponentType<{ className?: string }> }[]
}

interface ContextPickerProps {
  selectedContexts: ContextItem[]
  onContextsChange: (contexts: ContextItem[]) => void
  className?: string
  /** Where the dropdown anchors relative to button. 'top' opens upward, 'bottom' opens downward */
  anchor?: 'top' | 'bottom'
}

// ─────────────────────────────────────────────────────────────────────────────
// SAMPLE DATA - In production, this would come from stores/APIs
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_TABS: ContextItem[] = [
  { id: 'tab-1', type: 'tab', name: 'GitHub - ronbrowser', description: 'github.com', meta: 'Active', color: 'bg-emerald-500' },
  { id: 'tab-2', type: 'tab', name: 'Stack Overflow - React Hooks', description: 'stackoverflow.com', meta: '5m ago' },
  { id: 'tab-3', type: 'tab', name: 'MDN Web Docs', description: 'developer.mozilla.org', meta: '12m ago' },
  { id: 'tab-4', type: 'tab', name: 'Tailwind CSS Documentation', description: 'tailwindcss.com', meta: '1h ago' },
]

const SAMPLE_CONVERSATIONS: ContextItem[] = [
  { id: 'conv-1', type: 'conversation', name: 'API Integration Help', description: 'Discussed REST endpoints', meta: 'Today' },
  { id: 'conv-2', type: 'conversation', name: 'CSS Layout Issues', description: 'Fixed flexbox problems', meta: 'Yesterday' },
  { id: 'conv-3', type: 'conversation', name: 'Database Schema', description: 'Designed user tables', meta: '2 days ago' },
  { id: 'conv-4', type: 'conversation', name: 'Auth Flow Design', description: 'OAuth implementation', meta: '3 days ago' },
  { id: 'conv-5', type: 'conversation', name: 'Performance Tuning', description: 'Optimized queries', meta: '1 week ago' },
  { id: 'conv-6', type: 'conversation', name: 'Mobile Responsiveness', description: 'Breakpoint adjustments', meta: '1 week ago' },
]

const SAMPLE_PROJECTS: ContextItem[] = [
  { id: 'proj-1', type: 'project', name: 'ronbrowser', description: 'Electron + React', meta: '142 files', color: 'bg-violet-500' },
  { id: 'proj-2', type: 'project', name: 'api-server', description: 'Node.js + Express', meta: '67 files', color: 'bg-blue-500' },
  { id: 'proj-3', type: 'project', name: 'mobile-app', description: 'React Native', meta: '89 files', color: 'bg-pink-500' },
]

const SAMPLE_INTERESTS: ContextItem[] = [
  { id: 'int-1', type: 'interest', name: 'Technology', color: 'bg-blue-500' },
  { id: 'int-2', type: 'interest', name: 'Design', color: 'bg-pink-500' },
  { id: 'int-3', type: 'interest', name: 'Privacy', color: 'bg-emerald-500' },
  { id: 'int-4', type: 'interest', name: 'Research', color: 'bg-amber-500' },
  { id: 'int-5', type: 'interest', name: 'Learning', color: 'bg-cyan-500' },
]

const SAMPLE_TASKS: ContextItem[] = [
  { id: 'task-1', type: 'task', name: 'Implement auth flow', description: 'In Progress', meta: 'High', color: 'bg-blue-500' },
  { id: 'task-2', type: 'task', name: 'Design system updates', description: 'Review', meta: 'Medium', color: 'bg-amber-500' },
  { id: 'task-3', type: 'task', name: 'API documentation', description: 'Backlog', meta: 'Low', color: 'bg-slate-500' },
  { id: 'task-4', type: 'task', name: 'Performance audit', description: 'In Progress', meta: 'High', color: 'bg-blue-500' },
  { id: 'task-5', type: 'task', name: 'Mobile testing', description: 'Backlog', meta: 'Medium', color: 'bg-amber-500' },
  { id: 'task-6', type: 'task', name: 'Security review', description: 'Scheduled', meta: 'High', color: 'bg-red-500' },
]

const SAMPLE_DOCUMENTS: ContextItem[] = [
  { id: 'doc-1', type: 'file', name: 'Project Brief.pdf', description: 'Saved document', meta: '2.4 MB' },
  { id: 'doc-2', type: 'file', name: 'API Specs.md', description: 'Saved document', meta: '156 KB' },
  { id: 'doc-3', type: 'file', name: 'Design Guidelines.figma', description: 'Saved document', meta: '8.2 MB' },
]

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function ContextPicker({ selectedContexts, onContextsChange, className, anchor = 'top' }: ContextPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [openTabs, setOpenTabs] = useState<ContextItem[]>([])
  
  // Refs for positioning
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [coords, setCoords] = useState({ bottom: 0, left: 0 })

  // Calculate position and open - done synchronously to avoid render flash
  const handleOpen = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      if (anchor === 'bottom') {
        // Position menu BELOW button (for search bar at top of page)
        setCoords({
          bottom: -(rect.bottom + 8), // Negative = use top instead
          left: rect.left
        })
      } else {
        // Position menu ABOVE button (default - for panels at bottom)
        setCoords({
          bottom: window.innerHeight - rect.top + 8,
          left: rect.left
        })
      }
    }
    setIsOpen(true)
  }

  // Load real active tab and all tabs when the picker opens
  useEffect(() => {
    const loadTabs = async () => {
      try {
        if (typeof window !== 'undefined' && window.electron?.tabs) {
          // Use the Electron tabs API exposed on window.electron.
          const list = await window.electron.tabs.list()
          
          if (Array.isArray(list)) {
            const items: ContextItem[] = list.map(t => ({
              id: t.id,
              type: 'tab',
              name: t.title || t.url || 'New Tab',
              description: t.url,
              meta: t.isActive ? 'Active' : undefined,
              favicon: t.favicon,
              url: t.url,
              title: t.title
            }))
            // Sort active to top
            items.sort((a, _b) => (a.meta === 'Active' ? -1 : 1))
            setOpenTabs(items)
          }
        }
      } catch (e) {
        console.error('Failed to load tabs from electronAPI', e)
        // Fallback silently to sample tabs
      }
    }
    if (isOpen) loadTabs()
  }, [isOpen])

  const categories: ContextCategory[] = [
    {
      id: 'file',
      name: 'File',
      icon: DocumentIcon,
      description: 'Add a file for context',
      items: SAMPLE_DOCUMENTS,
      actions: [
        { id: 'upload', name: 'Upload file', icon: ArrowUpTrayIcon },
        { id: 'saved', name: 'Saved documents', icon: FolderIcon },
      ],
    },
    {
      id: 'tabs',
      name: 'Open Tabs',
      icon: GlobeAltIcon,
      description: `${(openTabs?.length ?? 0) || SAMPLE_TABS.length} tabs open`,
      items: openTabs.length ? openTabs : SAMPLE_TABS,
    },
    {
      id: 'conversations',
      name: 'Prior Conversations',
      icon: ChatBubbleLeftRightIcon,
      description: 'Reference past chats',
      items: SAMPLE_CONVERSATIONS,
    },
    {
      id: 'project',
      name: 'Coding Project',
      icon: CodeBracketIcon,
      description: 'Add project context',
      items: SAMPLE_PROJECTS,
    },
    {
      id: 'interest',
      name: 'Interest',
      icon: SparklesIcon,
      description: 'Add from your interests',
      items: SAMPLE_INTERESTS,
    },
    {
      id: 'task',
      name: 'Task',
      icon: ClipboardDocumentListIcon,
      description: 'Reference a task',
      items: SAMPLE_TASKS,
    },
  ]

  const activeItems = useMemo(() => {
    const category = categories.find(c => c.id === activeCategory)
    if (!category) return []
    
    if (!searchQuery) return category.items.slice(0, 5)
    
    return category.items.filter(item => 
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description?.toLowerCase().includes(searchQuery.toLowerCase())
    ).slice(0, 5)
  }, [activeCategory, searchQuery, categories])

  const toggleContext = (item: ContextItem) => {
    const exists = selectedContexts.find(c => c.id === item.id)
    if (exists) {
      onContextsChange(selectedContexts.filter(c => c.id !== item.id))
    } else {
      onContextsChange([...selectedContexts, item])
    }
  }

  const isSelected = (id: string) => selectedContexts.some(c => c.id === id)

  const handleBack = () => {
    setActiveCategory(null)
    setSearchQuery('')
  }

  const handleClose = () => {
    setIsOpen(false)
    setActiveCategory(null)
    setSearchQuery('')
  }

  return (
    <div className={cn("relative", className)}>
      {/* Trigger Button */}
      <button
        ref={buttonRef}
        onClick={() => isOpen ? handleClose() : handleOpen()}
        aria-label="Add Context"
        className={cn(
          "flex items-center justify-center",
          "w-8 h-8 rounded-lg",
          "text-ink-muted dark:text-ink-inverse-muted",
          "hover:bg-surface-100 dark:hover:bg-surface-800",
          "hover:text-ink dark:hover:text-ink-inverse",
          "transition-all duration-200",
          selectedContexts.length > 0 && "text-accent dark:text-accent-light"
        )}
      >
        <LinkIcon className="w-5 h-5" />
      </button>

      {/* Portal Dropdown - Portal wraps AnimatePresence for proper exit animations */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {isOpen && (
            <>
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[9998]"
                onClick={handleClose}
              />

              {/* Menu */}
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                style={{
                  position: 'fixed',
                  ...(anchor === 'bottom' 
                    ? { top: -coords.bottom } 
                    : { bottom: coords.bottom }),
                  left: coords.left
                }}
                className={cn(
                  "z-[9999]", // High z-index in Portal
                  "w-72 py-2",
                  "bg-surface-0 dark:bg-surface-800",
                  "rounded-xl border border-surface-200 dark:border-surface-700",
                  "shadow-bold dark:shadow-dark-bold",
                  "overflow-hidden"
                )}
              >
              {/* Header */}
              <div className="px-3 py-2 border-b border-surface-100 dark:border-surface-700 flex items-center gap-2">
                {activeCategory ? (
                  <>
                    <button
                      onClick={handleBack}
                      aria-label="Back to categories"
                      className="p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-ink-muted dark:text-ink-inverse-muted"
                    >
                      <ChevronLeftIcon className="w-4 h-4" />
                    </button>
                    <p className="text-body-sm font-medium text-ink dark:text-ink-inverse">
                      {categories.find(c => c.id === activeCategory)?.name}
                    </p>
                  </>
                ) : (
                  <p className="text-label text-ink-muted dark:text-ink-inverse-muted">Add Context</p>
                )}
              </div>

              {/* Search (only in subcategory) */}
              {activeCategory && (
                <div className="px-3 py-2 border-b border-surface-100 dark:border-surface-700">
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-50 dark:bg-surface-850 border border-surface-200 dark:border-surface-700">
                    <MagnifyingGlassIcon className="w-4 h-4 text-ink-muted dark:text-ink-inverse-muted" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search..."
                      className="flex-1 bg-transparent text-body-sm text-ink dark:text-ink-inverse placeholder:text-ink-muted/50 outline-none"
                      autoFocus
                    />
                    {searchQuery && (
                      <button onClick={() => setSearchQuery('')} aria-label="Clear search" className="text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse">
                        <XMarkIcon className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Content */}
              <div className="max-h-64 overflow-y-auto scrollbar-thin">
                <AnimatePresence mode="wait">
                  {!activeCategory ? (
                    // Category List
                    <motion.div
                      key="categories"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      transition={{ duration: 0.15 }}
                      className="py-1"
                    >
                      {categories.map((category) => {
                        const selectedCount = selectedContexts.filter(c => c.type === category.id || 
                          (category.id === 'file' && c.type === 'file') ||
                          (category.id === 'tabs' && c.type === 'tab') ||
                          (category.id === 'conversations' && c.type === 'conversation') ||
                          (category.id === 'project' && c.type === 'project') ||
                          (category.id === 'interest' && c.type === 'interest') ||
                          (category.id === 'task' && c.type === 'task')
                        ).length

                        return (
                          <button
                            key={category.id}
                            onClick={() => setActiveCategory(category.id)}
                            className={cn(
                              "w-full flex items-center gap-3 px-3 py-2.5 mx-1 rounded-lg",
                              "hover:bg-surface-100 dark:hover:bg-surface-700",
                              "transition-colors duration-150",
                              "text-left group"
                            )}
                          >
                            <div className={cn(
                              "flex items-center justify-center w-8 h-8 rounded-lg",
                              "bg-surface-100 dark:bg-surface-700",
                              selectedCount > 0 && "bg-accent/10 dark:bg-accent-light/10"
                            )}>
                              <category.icon className={cn(
                                "w-4 h-4",
                                selectedCount > 0 
                                  ? "text-accent dark:text-accent-light" 
                                  : "text-ink-muted dark:text-ink-inverse-muted"
                              )} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-body-sm font-medium text-ink dark:text-ink-inverse">
                                  {category.name}
                                </p>
                                {selectedCount > 0 && (
                                  <span className="px-1.5 py-0.5 rounded-full bg-accent/10 dark:bg-accent-light/10 text-accent dark:text-accent-light text-[10px] font-semibold">
                                    {selectedCount}
                                  </span>
                                )}
                              </div>
                              <p className="text-body-xs text-ink-muted dark:text-ink-inverse-muted truncate">
                                {category.description}
                              </p>
                            </div>
                            <ChevronRightIcon className="w-4 h-4 text-ink-muted dark:text-ink-inverse-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                        )
                      })}
                    </motion.div>
                  ) : (
                    // Item List
                    <motion.div
                      key="items"
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      transition={{ duration: 0.15 }}
                      className="py-1"
                    >
                      {/* Actions (e.g., Upload for Files) */}
                      {categories.find(c => c.id === activeCategory)?.actions?.map((action) => (
                        <button
                          key={action.id}
                          onClick={() => {
                            // Handle action (upload, etc.)
                            console.log('Action:', action.id)
                          }}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 mx-1 rounded-lg",
                            "hover:bg-surface-100 dark:hover:bg-surface-700",
                            "transition-colors duration-150",
                            "text-left border-b border-surface-100 dark:border-surface-700 mb-1"
                          )}
                        >
                          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/10 dark:bg-accent-light/10">
                            <action.icon className="w-4 h-4 text-accent dark:text-accent-light" />
                          </div>
                          <p className="text-body-sm font-medium text-accent dark:text-accent-light">
                            {action.name}
                          </p>
                        </button>
                      ))}

                      {/* Items */}
                      {activeItems.length === 0 ? (
                        <div className="px-4 py-8 text-center">
                          <p className="text-body-sm text-ink-muted dark:text-ink-inverse-muted">
                            {searchQuery ? 'No results found' : 'No items available'}
                          </p>
                        </div>
                      ) : (
                        activeItems.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => toggleContext(item)}
                            className={cn(
                              "w-full flex items-center gap-3 px-3 py-2 mx-1 rounded-lg",
                              "hover:bg-surface-100 dark:hover:bg-surface-700",
                              "transition-colors duration-150",
                              "text-left",
                              isSelected(item.id) && "bg-accent/5 dark:bg-accent-light/5"
                            )}
                          >
                            {/* Favicon for tabs, color dot for others */}
                            {item.favicon ? (
                              <img src={item.favicon} alt="" className="w-4 h-4 rounded flex-shrink-0" />
                            ) : item.color ? (
                              <div className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", item.color)} />
                            ) : item.type === 'tab' ? (
                              <GlobeAltIcon className="w-4 h-4 text-ink-muted dark:text-ink-inverse-muted flex-shrink-0" />
                            ) : (
                              <div className="w-4" />
                            )}
                            
                            <div className="flex-1 min-w-0">
                              <p className={cn(
                                "text-body-sm font-medium truncate",
                                isSelected(item.id) 
                                  ? "text-accent dark:text-accent-light" 
                                  : "text-ink dark:text-ink-inverse"
                              )}>
                                {item.name}
                              </p>
                              {item.description && (
                                <p className="text-body-xs text-ink-muted dark:text-ink-inverse-muted truncate">
                                  {item.description}
                                </p>
                              )}
                            </div>
                            
                            {/* Meta badge */}
                            {item.meta && (
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0",
                                item.meta === 'Active' 
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : item.meta === 'High'
                                  ? "bg-red-500/10 text-red-600 dark:text-red-400"
                                  : item.meta === 'Medium'
                                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                  : "bg-surface-200 dark:bg-surface-700 text-ink-muted dark:text-ink-inverse-muted"
                              )}>
                                {item.meta}
                              </span>
                            )}
                            
                            {/* Check */}
                            {isSelected(item.id) && (
                              <CheckIcon className="w-4 h-4 text-accent dark:text-accent-light flex-shrink-0" />
                            )}
                          </button>
                        ))
                      )}

                      {/* Show more indicator */}
                      {!searchQuery && categories.find(c => c.id === activeCategory)!.items.length > 5 && (
                        <div className="px-4 py-2 text-center border-t border-surface-100 dark:border-surface-700 mt-1">
                          <p className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">
                            {categories.find(c => c.id === activeCategory)!.items.length - 5} more · Use search to find
                          </p>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECTED CONTEXT CHIPS
// ─────────────────────────────────────────────────────────────────────────────

interface SelectedContextsProps {
  contexts: ContextItem[]
  onRemove: (id: string) => void
  className?: string
}

export function SelectedContexts({ contexts, onRemove, className }: SelectedContextsProps) {
  if (contexts.length === 0) return null

  const getIcon = (type: ContextItem['type']) => {
    switch (type) {
      case 'file': return DocumentIcon
      case 'tab': return GlobeAltIcon
      case 'conversation': return ChatBubbleLeftRightIcon
      case 'project': return CodeBracketIcon
      case 'interest': return SparklesIcon
      case 'task': return ClipboardDocumentListIcon
      default: return DocumentIcon
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className={cn("flex flex-wrap gap-1.5", className)}
    >
      {contexts.map((context) => {
        const Icon = getIcon(context.type)
        return (
          <motion.span
            key={context.id}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            className={cn(
              "inline-flex items-center gap-1.5 px-2 py-1 rounded-full",
              "bg-accent/10 dark:bg-accent-light/10",
              "text-accent dark:text-accent-light text-body-xs"
            )}
          >
            <Icon className="w-3 h-3" />
            <span className="max-w-[100px] truncate">{context.name}</span>
            <button
              onClick={() => onRemove(context.id)}
              aria-label={`Remove ${context.name}`}
              className="ml-0.5 hover:text-accent-light dark:hover:text-accent transition-colors"
            >
              <XMarkIcon className="w-3 h-3" />
            </button>
          </motion.span>
        )
      })}
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ICONS
// ─────────────────────────────────────────────────────────────────────────────

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}
