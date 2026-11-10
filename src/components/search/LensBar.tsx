/**
 * The Lens Bar — the search page's tab control. A sticky row of text tabs: the active lens
 * carries a sliding 2px volt underline; every tab shows its live result count in mono
 * tabular figures, a volt dot while its source streams and a red dot on failure. Pending
 * tabs sit in muted ink. Arrow keys move between tabs (WAI-ARIA tabs pattern).
 */
import { useRef, type KeyboardEvent } from 'react'
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { SEARCH_TABS, type SearchTab } from './tabs-meta'
import { cn } from '@/utils/cn'

export type LensStatus = 'pending' | 'streaming' | 'done' | 'error'

export interface LensState {
  status: LensStatus
  count: number | null
}

export interface LensBarProps {
  active: SearchTab
  onChange: (tab: SearchTab) => void
  lenses: Record<SearchTab, LensState>
}

export const lensPanelId = (tab: SearchTab) => `search-panel-${tab}`
export const lensTabId = (tab: SearchTab) => `search-tab-${tab}`

export function LensBar({ active, onChange, lenses }: LensBarProps) {
  const reduced = useReducedMotion()
  const refs = useRef<Partial<Record<SearchTab, HTMLButtonElement | null>>>({})

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = SEARCH_TABS.findIndex((tab) => tab.id === active)
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % SEARCH_TABS.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + SEARCH_TABS.length) % SEARCH_TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = SEARCH_TABS.length - 1
    else return
    event.preventDefault()
    const id = SEARCH_TABS[next].id
    onChange(id)
    refs.current[id]?.focus()
  }

  return (
    <div className="sticky top-0 z-20 mt-6 border-b border-surface-200 bg-surface-0 backdrop-blur-md dark:border-surface-800 dark:bg-surface-900">
      <LayoutGroup id="search-lenses">
        <div
          role="tablist"
          aria-label="Search results"
          onKeyDown={onKeyDown}
          className="mx-auto flex max-w-6xl items-stretch gap-1 overflow-x-auto px-4 scrollbar-none sm:gap-2 sm:px-8"
        >
          {SEARCH_TABS.map((tab) => {
            const isActive = active === tab.id
            const lens = lenses[tab.id]
            return (
              <button
                key={tab.id}
                ref={(node) => { refs.current[tab.id] = node }}
                type="button"
                role="tab"
                id={lensTabId(tab.id)}
                aria-selected={isActive}
                aria-controls={lensPanelId(tab.id)}
                tabIndex={isActive ? 0 : -1}
                onClick={() => onChange(tab.id)}
                className={cn(
                  'relative flex h-11 flex-shrink-0 items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors duration-150',
                  'focus-visible:ring-inset focus-visible:ring-offset-0',
                  isActive
                    ? 'text-ink dark:text-ink-inverse'
                    : lens.status === 'pending'
                      ? 'text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse'
                      : 'text-ink-secondary hover:text-ink dark:text-ink-inverse-secondary dark:hover:text-ink-inverse',
                )}
              >
                <span>{tab.label}</span>
                {lens.count !== null && (
                  <span
                    className={cn(
                      'font-mono text-[11px] tabular-nums',
                      isActive ? 'text-ink-secondary dark:text-ink-inverse-secondary' : 'text-ink-muted dark:text-ink-inverse-muted',
                    )}
                  >
                    {lens.count}
                  </span>
                )}
                {lens.status === 'streaming' && (
                  <>
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-blurple-600 dark:bg-blurple-400" />
                    <span className="sr-only">, loading</span>
                  </>
                )}
                {lens.status === 'error' && (
                  <>
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-danger" />
                    <span className="sr-only">, failed</span>
                  </>
                )}
                {isActive && (
                  <motion.span
                    layoutId="lens-underline"
                    className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-blurple-600 dark:bg-blurple-400"
                    transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40 }}
                  />
                )}
              </button>
            )
          })}
        </div>
      </LayoutGroup>
    </div>
  )
}
