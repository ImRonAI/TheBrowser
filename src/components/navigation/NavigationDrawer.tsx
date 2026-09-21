/**
 * Navigation Drawer - Persistent Collapsible Navigation
 * 
 * A sophisticated accordion drawer containing:
 * - Compact search input with context picker
 * - Minimal horizontal tab navigation
 * - Collapse/expand animation
 */
import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { useNavigationStore, type HomeTab } from '@/stores/navigationStore'
import { useSearchStore } from '@/stores/searchStore'
import { ContextPicker, type ContextItem } from '@/components/agent-panel/ContextPicker'
import { TextAttachmentCard } from '@/components/ai-elements/text-attachment-card'
import { fileToDataUrl, makePastedTextFilename } from '@/utils/file-utils'
import type { TextAttachment } from '@/components/ai-elements/types'
import { cn } from '@/utils/cn'

const EASE = [0.16, 1, 0.3, 1] as const
const LARGE_PASTE_THRESHOLD_CHARS = 2000

// ─────────────────────────────────────────────────────────────────────────────
// TAB CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const TAB_CONFIG: { id: HomeTab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'discover',
    label: 'Discover',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
      </svg>
    ),
  },
  {
    id: 'execute',
    label: 'Execute',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="5" height="18" rx="1" />
        <rect x="9.5" y="6" width="5" height="15" rx="1" />
        <rect x="16" y="9" width="5" height="12" rx="1" />
      </svg>
    ),
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    id: 'vibe',
    label: 'Vibe',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    ),
  },
  {
    id: 'build',
    label: 'Build',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function NavigationDrawer() {
  const { isDrawerExpanded, toggleDrawer, activeTab, setActiveTab } = useNavigationStore()
  const { search } = useSearchStore()
  
  // Input state
  const [query, setQuery] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [selectedContexts, setSelectedContexts] = useState<ContextItem[]>([])
  const [textAttachments, setTextAttachments] = useState<TextAttachment[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  
  // Notify Electron of drawer height changes so WebContentsView can adjust bounds
  useEffect(() => {
    const updateDrawerHeight = () => {
      if (drawerRef.current && typeof window !== 'undefined' && window.electron?.browser?.setDrawerHeight) {
        const height = drawerRef.current.offsetHeight
        window.electron.browser.setDrawerHeight(height)
      }
    }
    
    // Update after animation completes
    const timeout = setTimeout(updateDrawerHeight, 350) // slightly longer than animation duration (300ms)
    
    return () => clearTimeout(timeout)
  }, [isDrawerExpanded])

  // Handle search submission
  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const trimmed = query.trim()
    if (!trimmed && textAttachments.length === 0) return

    // Trigger search
    search(trimmed)

    if (typeof window !== 'undefined' && window.electron?.browser?.search) {
      try {
        await window.electron.browser.search(trimmed)
      } catch (error) {
        console.error('Search error:', error)
      }
    }

    setQuery('')
    setTextAttachments([])
    setSelectedContexts([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSearch()
    }
  }

  // Handle large paste → attachment
  const handlePaste = async (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text/plain')
    if (text && text.length >= LARGE_PASTE_THRESHOLD_CHARS) {
      e.preventDefault()
      const file = new File([text], makePastedTextFilename(), {
        type: 'text/plain',
      })
      const dataUrl = await fileToDataUrl(file)
      const newAttachment: TextAttachment = {
        id: Math.random().toString(36).substr(2, 9),
        file,
        dataUrl,
        preview: dataUrl,
      }
      setTextAttachments(prev => [...prev, newAttachment])
    }
  }

  const handleTextAttachmentRemove = (id: string) => {
    setTextAttachments(prev => prev.filter(att => att.id !== id))
  }

  const handleTextAttachmentUpdate = (
    id: string,
    next: Pick<TextAttachment, 'file' | 'dataUrl' | 'preview'>
  ) => {
    setTextAttachments(prev => prev.map(att =>
      att.id === id ? { ...att, ...next } : att
    ))
  }

  const navigateInternal = (url: string) => {
    if (typeof window !== 'undefined' && window.electron?.browser?.navigate) {
      window.electron.browser.navigate(url)
    }
  }

  const handleTabClick = (tabId: HomeTab) => {
    setActiveTab(tabId)
    if (tabId === 'execute') {
      navigateInternal('ron://execute')
      return
    }
    if (tabId === 'build') {
      navigateInternal('ron://build')
      return
    }
    navigateInternal('ron://home')
  }

  return (
    <div ref={drawerRef} className="relative z-[90] flex-shrink-0">
      <AnimatePresence mode="wait" initial={false}>
        {isDrawerExpanded ? (
          <motion.div
            key="expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <div className={cn(
              "px-6 py-3",
              "bg-surface-0/95 dark:bg-surface-900/95",
              "backdrop-blur-xl",
              "border-b border-surface-200/50 dark:border-surface-700/50",
            )}>
              {/* Search Input Row */}
              <div className="max-w-2xl mx-auto mb-3">
                {/* Text Attachments */}
                {textAttachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {textAttachments.map(attachment => (
                      <TextAttachmentCard
                        key={attachment.id}
                        attachment={attachment}
                        onRemove={handleTextAttachmentRemove}
                        onUpdate={handleTextAttachmentUpdate}
                      />
                    ))}
                  </div>
                )}

                {/* Selected Context Chips */}
                {selectedContexts.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {selectedContexts.map(context => (
                      <span
                        key={context.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                      >
                        {context.name}
                        <button
                          onClick={() => setSelectedContexts(prev => prev.filter(c => c.id !== context.id))}
                          className="ml-0.5 hover:text-indigo-900 dark:hover:text-indigo-100"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Compact Search Input */}
                <form onSubmit={handleSearch}>
                  <div className={cn(
                    "relative flex items-center gap-2",
                    "h-10 px-3",
                    "rounded-xl",
                    "bg-surface-50 dark:bg-surface-800",
                    "border transition-all duration-200",
                    isFocused
                      ? "border-indigo-400/50 dark:border-indigo-500/50 shadow-sm ring-1 ring-indigo-400/20"
                      : "border-surface-200 dark:border-surface-700",
                  )}>
                    {/* Context Picker - opens downward */}
                    <ContextPicker
                      selectedContexts={selectedContexts}
                      onContextsChange={setSelectedContexts}
                      anchor="bottom"
                      className="flex-shrink-0"
                    />

                    {/* Search Icon */}
                    <svg 
                      className={cn(
                        "w-4 h-4 flex-shrink-0 transition-colors",
                        isFocused ? "text-indigo-500" : "text-ink-muted dark:text-ink-inverse-muted"
                      )}
                      viewBox="0 0 24 24" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="2" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>

                    {/* Input */}
                    <input
                      ref={inputRef}
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onFocus={() => setIsFocused(true)}
                      onBlur={() => setIsFocused(false)}
                      onKeyDown={handleKeyDown}
                      onPaste={handlePaste}
                      id="nav-search-bar"
                      data-testid="nav-search-input"
                      placeholder="Ask anything..."
                      className={cn(
                        "flex-1 bg-transparent outline-none",
                        "text-body-sm text-ink dark:text-ink-inverse",
                        "placeholder:text-ink-muted/60 dark:placeholder:text-ink-inverse-muted/60",
                      )}
                      autoComplete="off"
                    />

                    {/* Submit Button */}
                    <motion.button
                      type="submit"
                      disabled={!query.trim() && textAttachments.length === 0}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className={cn(
                        "flex-shrink-0 w-7 h-7 rounded-lg",
                        "flex items-center justify-center",
                        "transition-all duration-200",
                        (query.trim() || textAttachments.length > 0)
                          ? "bg-indigo-600 text-white"
                          : "bg-surface-200 dark:bg-surface-700 text-ink-muted/50 dark:text-ink-inverse-muted/50"
                      )}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="19" x2="12" y2="5" />
                        <polyline points="5 12 12 5 19 12" />
                      </svg>
                    </motion.button>
                  </div>
                </form>
              </div>

              {/* Tab Navigation - Premium Frosted Glass */}
              <div className="flex justify-center">
                <div className="
                  relative flex items-center justify-center gap-2 px-3 py-2
                  rounded-2xl
                  bg-white/70 dark:bg-surface-800/60
                  backdrop-blur-xl
                  border border-indigo-300/30 dark:border-surface-700/50
                  shadow-[0_4px_32px_rgba(79,70,229,0.12)] dark:shadow-dark-soft
                ">
                  {TAB_CONFIG.map((tab) => {
                    const isActive = activeTab === tab.id
                    return (
                      <motion.button
                        key={tab.id}
                        onClick={() => handleTabClick(tab.id)}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className={`
                          group relative flex items-center justify-center gap-2.5
                          px-5 py-2.5 rounded-xl
                          text-body-sm font-medium
                          transition-all duration-300 ease-out
                          ${isActive
                            ? 'bg-gradient-to-r from-indigo-600 to-indigo-800 text-white shadow-lg shadow-indigo-700/30'
                            : 'bg-white/50 dark:bg-surface-800/50 text-ink-secondary dark:text-ink-inverse-secondary hover:text-ink dark:hover:text-ink-inverse hover:bg-white/80 dark:hover:bg-surface-700/80 border border-transparent hover:border-indigo-300/30 dark:hover:border-surface-600'
                          }
                        `}
                      >
                        <span 
                          className={`
                            w-4 h-4 flex-shrink-0
                            transition-all duration-300
                            group-hover:animate-[spin-slow_0.6s_ease-in-out]
                            ${isActive ? 'text-white' : 'text-indigo-600 dark:text-indigo-400'}
                          `}
                        >
                          {tab.icon}
                        </span>
                        <span>{tab.label}</span>
                      </motion.button>
                    )
                  })}
                </div>
              </div>

              {/* Collapse Handle */}
              <div className="flex justify-center mt-2">
                <motion.button
                  onClick={toggleDrawer}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  className="p-1 rounded-md text-ink-muted/40 dark:text-ink-inverse-muted/40 hover:text-ink-muted dark:hover:text-ink-inverse-muted transition-colors"
                  aria-label="Collapse navigation"
                >
                  <ChevronUp className="w-4 h-4" />
                </motion.button>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="collapsed"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <motion.button
              onClick={toggleDrawer}
              whileHover={{ backgroundColor: 'rgba(99, 102, 241, 0.1)' }}
              className={cn(
                "w-full flex items-center justify-center gap-2",
                "h-8 px-4",
                "bg-surface-0/95 dark:bg-surface-900/95",
                "backdrop-blur-xl",
                "border-b border-surface-200/50 dark:border-surface-700/50",
                "text-ink-muted/60 dark:text-ink-inverse-muted/60",
                "hover:text-ink-muted dark:hover:text-ink-inverse-muted",
                "transition-colors",
              )}
            >
              <span className="text-[10px] font-medium uppercase tracking-wider">Navigation</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default NavigationDrawer
