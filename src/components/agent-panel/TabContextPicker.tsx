/**
 * Tab Context Picker
 * 
 * Multiselect listbox for selecting tabs to provide as context to the agent.
 * Each item shows favicon, site title/URL, and a checkbox.
 * Selections are sent as attachments to the agent.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/cn'
import type { TabSummary } from '@/pages/types/electron'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface TabContextPickerProps {
  selectedTabIds: string[]
  onSelectionChange: (tabIds: string[]) => void
  className?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// TabContextPicker
// ─────────────────────────────────────────────────────────────────────────────

export function TabContextPicker({ selectedTabIds, onSelectionChange, className }: TabContextPickerProps) {
  const [tabs, setTabs] = useState<TabSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Load tabs on mount
  useEffect(() => {
    const loadTabs = async () => {
      try {
        const list = await window.electron?.tabs.list?.()
        if (Array.isArray(list)) setTabs(list)
      } catch (e) {
        console.error('Failed to load tabs', e)
      } finally {
        setIsLoading(false)
      }
    }
    loadTabs()
  }, [])

  const toggleTab = (id: string) => {
    if (selectedTabIds.includes(id)) {
      onSelectionChange(selectedTabIds.filter(x => x !== id))
    } else {
      onSelectionChange([...selectedTabIds, id])
    }
  }

  const selectAll = () => onSelectionChange(tabs.map(t => t.id))
  const clearAll = () => onSelectionChange([])

  if (isLoading) {
    return (
      <div className={cn('p-6 text-center', className)}>
        <LoaderIcon className="w-5 h-5 text-ink-muted dark:text-ink-inverse-muted animate-spin mx-auto" />
        <p className="text-body-sm text-ink-muted dark:text-ink-inverse-muted mt-2">Loading tabs...</p>
      </div>
    )
  }

  if (tabs.length === 0) {
    return (
      <div className={cn('p-6 text-center', className)}>
        <p className="text-body-sm text-ink-muted dark:text-ink-inverse-muted">No tabs open</p>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header with select/clear all */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-surface-200 dark:border-surface-700">
        <p className="text-body-sm font-medium text-ink dark:text-ink-inverse">
          Select tabs to provide context
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={selectAll}
            className="text-body-xs text-accent dark:text-accent-light hover:underline"
          >
            Select all
          </button>
          <span className="text-ink-muted dark:text-ink-inverse-muted">·</span>
          <button
            onClick={clearAll}
            className="text-body-xs text-ink-muted dark:text-ink-inverse-muted hover:text-ink dark:hover:text-ink-inverse"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Tab list */}
      <div className="flex-1 overflow-y-auto max-h-[400px] scrollbar-thin">
        <AnimatePresence>
          {tabs.map((tab) => {
            const isSelected = selectedTabIds.includes(tab.id)
            return (
              <TabContextItem
                key={tab.id}
                tab={tab}
                isSelected={isSelected}
                onToggle={() => toggleTab(tab.id)}
              />
            )
          })}
        </AnimatePresence>
      </div>

      {/* Footer with selection count */}
      {selectedTabIds.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-4 py-2 border-t border-surface-200 dark:border-surface-700 bg-accent/5 dark:bg-accent-light/5"
        >
          <p className="text-body-xs text-accent dark:text-accent-light">
            {selectedTabIds.length} tab{selectedTabIds.length !== 1 ? 's' : ''} selected
          </p>
        </motion.div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TabContextItem
// ─────────────────────────────────────────────────────────────────────────────

interface TabContextItemProps {
  tab: TabSummary
  isSelected: boolean
  onToggle: () => void
}

function TabContextItem({ tab, isSelected, onToggle }: TabContextItemProps) {
  return (
    <motion.button
      onClick={onToggle}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3',
        'hover:bg-surface-50 dark:hover:bg-surface-800',
        'transition-colors duration-200',
        'text-left group',
        isSelected && 'bg-accent/5 dark:bg-accent-light/5'
      )}
    >
      {/* Checkbox */}
      <div
        className={cn(
          'flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center',
          'transition-all duration-200',
          isSelected
            ? 'bg-accent dark:bg-accent-light border-accent dark:border-accent-light'
            : 'border-surface-300 dark:border-surface-600 group-hover:border-surface-400 dark:group-hover:border-surface-500'
        )}
      >
        {isSelected && <CheckIcon className="w-3 h-3 text-white" />}
      </div>

      {/* Favicon */}
      {tab.favicon ? (
        <img src={tab.favicon} alt="" className="w-4 h-4 rounded flex-shrink-0" />
      ) : (
        <GlobeIcon className="w-4 h-4 text-ink-muted dark:text-ink-inverse-muted flex-shrink-0" />
      )}

      {/* Title + URL */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            'text-body-sm font-medium truncate',
            isSelected
              ? 'text-accent dark:text-accent-light'
              : 'text-ink dark:text-ink-inverse group-hover:text-accent dark:group-hover:text-accent-light'
          )}
        >
          {tab.title || 'Untitled'}
        </p>
        <p className="text-body-xs text-ink-muted dark:text-ink-inverse-muted truncate">
          {tab.url}
        </p>
      </div>

      {/* Active badge */}
      {tab.isActive && (
        <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold">
          Active
        </span>
      )}
    </motion.button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

function LoaderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </svg>
  )
}
