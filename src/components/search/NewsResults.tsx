/**
 * The News panel — Brave news at maximum count as a quiet editorial list: square
 * thumbnail, source identity (favicon + name) with the age in tabular mono, headline,
 * and a two-line dek.
 */
import { motion } from 'framer-motion'
import { sectionItems, type SearchRunState } from '@/lib/search-api'
import type { DiscoverItem } from '@/lib/discover-feed'
import { stripMarkup } from '@/lib/discover-feed'
import { EmptyState, RowSkeleton, SourceErrorNotice } from './primitives'
import { domainInitials } from './tabs-meta'
import { openResult } from './open-result'

function NewsRow({ item, index }: { item: DiscoverItem; index: number }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 14) * 0.025, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => openResult(item.url)}
      className="group flex w-full items-start gap-4 border-b border-surface-200/60 px-2 py-4 text-left transition-colors duration-150 last:border-0 hover:bg-surface-50 dark:border-surface-800/70 dark:hover:bg-surface-800/40"
    >
      <span className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl bg-surface-100 dark:bg-surface-800">
        {item.thumbnail ? (
          <img src={item.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 ease-smooth group-hover:scale-[1.05]" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-xs font-semibold text-ink-muted dark:text-ink-inverse-muted">
            {domainInitials(item.url)}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {item.favicon && <img src={item.favicon} alt="" className="h-3.5 w-3.5 rounded-sm" />}
          <span className="truncate text-[11px] font-medium uppercase tracking-wide text-ink-muted dark:text-ink-inverse-muted">
            {item.source}
          </span>
          {item.age && (
            <span className="flex-shrink-0 font-mono text-[10px] tabular-nums text-ink-muted/70 dark:text-ink-inverse-muted/70">
              {item.age}
            </span>
          )}
        </span>
        <span className="mt-1 line-clamp-2 block text-[15px] font-normal leading-snug text-ink transition-colors group-hover:text-accent-light dark:text-ink-inverse dark:group-hover:text-accent-muted">
          {stripMarkup(item.title)}
        </span>
        {item.description && (
          <span className="mt-1 line-clamp-2 block text-[13px] font-light leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
            {stripMarkup(item.description)}
          </span>
        )}
      </span>
    </motion.button>
  )
}

export function NewsResults({ state, onRetry }: { state: SearchRunState; onRetry?: () => void }) {
  const section = state.sections.news
  if (!section) return <RowSkeleton rows={6} />
  if (section.status === 'error') return <div className="mx-auto max-w-2xl"><SourceErrorNotice error={{ source: 'brave', ...section.error! }} onRetry={onRetry} /></div>

  const items = sectionItems(state, 'news')
  if (!items.length) return <EmptyState title="No news found" hint="This topic may be out of the current news cycle" />
  return (
    <div className="mx-auto max-w-2xl">
      {items.map((item, i) => <NewsRow key={item.id} item={item} index={i} />)}
    </div>
  )
}
