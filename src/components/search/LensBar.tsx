/**
 * The Lens Bar — the search page's tab control. One floating frosted pill; the
 * active lens is marked by a sliding, hue-tinted indicator. Every tab carries a
 * live result count that ticks upward as its source streams in, plus a status pip
 * (pulsing = streaming, solid = done, red = failed) so the whole fan-out is visible
 * at a glance.
 */
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { SEARCH_TABS, hueWash, type SearchTab } from './tabs-meta'
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

function Pip({ status, hue }: { status: LensStatus; hue: string }) {
  if (status === 'pending') {
    return <span className="h-1.5 w-1.5 rounded-full bg-surface-300 dark:bg-surface-600" />
  }
  if (status === 'error') {
    return <span className="h-1.5 w-1.5 rounded-full bg-danger" />
  }
  return (
    <span className="relative flex h-1.5 w-1.5">
      {status === 'streaming' && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ backgroundColor: hue }}
          animate={{ scale: [1, 2.2], opacity: [0.7, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: hue }} />
    </span>
  )
}

export function LensBar({ active, onChange, lenses }: LensBarProps) {
  return (
    <div className="sticky top-3 z-20 mx-auto mt-5 w-fit max-w-[calc(100vw-2rem)]">
      <LayoutGroup id="search-lenses">
        <div className="glass-bold flex items-center gap-0.5 overflow-x-auto rounded-full p-1 scrollbar-none">
          {SEARCH_TABS.map((tab) => {
            const isActive = active === tab.id
            const lens = lenses[tab.id]
            return (
              <motion.button
                key={tab.id}
                onClick={() => onChange(tab.id)}
                whileTap={{ scale: 0.96 }}
                role="tab"
                aria-selected={isActive}
                className={cn(
                  'relative flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-light transition-colors duration-200',
                  isActive
                    ? 'text-ink dark:text-ink-inverse'
                    : 'text-ink-secondary hover:text-ink dark:text-ink-inverse-secondary dark:hover:text-ink-inverse',
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="lens-active"
                    className="absolute inset-0 rounded-full border"
                    style={{ backgroundColor: hueWash(tab.hue, 0.16), borderColor: hueWash(tab.hue, 0.35) }}
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative">{tab.label}</span>
                <AnimatePresence mode="popLayout">
                  {lens.count !== null && (
                    <motion.span
                      key={lens.count}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="relative font-mono text-[10px] tabular-nums text-ink-muted dark:text-ink-inverse-muted"
                    >
                      {lens.count}
                    </motion.span>
                  )}
                </AnimatePresence>
                <span className="relative">
                  <Pip status={lens.status} hue={tab.hue} />
                </span>
              </motion.button>
            )
          })}
        </div>
      </LayoutGroup>
    </div>
  )
}
