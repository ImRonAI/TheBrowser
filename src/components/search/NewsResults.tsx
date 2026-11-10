/**
 * The News panel — Brave news at maximum count as an editorial list: the first
 * story leads (16:9 image, serif headline, two-line dek); the rest are compact rows
 * (56px thumbnail, source · age, a two-line headline, no dek).
 */
import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { sectionItems, type SearchRunState } from '@/lib/search-api'
import type { DiscoverItem } from '@/lib/discover-feed'
import { stripMarkup } from '@/lib/discover-feed'
import { EmptyState, RowSkeleton, ShowMore, SourceErrorNotice } from './primitives'
import { Favicon, rowMotion } from './ResultRow'
import { openResult } from './open-result'

const PAGE = 12

function Meta({ item }: { item: DiscoverItem }) {
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-ink-muted dark:text-ink-inverse-muted">
      <Favicon url={item.url} favicon={item.favicon} size={14} />
      <span className="truncate">{item.source}</span>
      {item.age && <><span aria-hidden>·</span><span className="flex-shrink-0 tabular-nums">{item.age}</span></>}
    </span>
  )
}

function Thumb({ src, className }: { src?: string | null; className: string }) {
  const [broken, setBroken] = useState(false)
  return (
    <span className={`block flex-shrink-0 overflow-hidden bg-surface-100 dark:bg-surface-800 ${className}`}>
      {src && !broken && (
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover transition-transform duration-500 ease-smooth motion-safe:group-hover:scale-[1.03]" />
      )}
    </span>
  )
}

function LeadStory({ item }: { item: DiscoverItem }) {
  return (
    <button
      type="button"
      onClick={() => openResult(item.url)}
      className="group mb-4 grid w-full grid-cols-1 gap-5 rounded-xl p-3 text-left transition-colors hover:bg-surface-50 dark:hover:bg-surface-850 sm:grid-cols-[minmax(0,1fr)_240px]"
    >
      <span className="min-w-0 sm:order-1">
        <Meta item={item} />
        <span className="mt-2 line-clamp-3 block font-display text-[1.5rem] leading-[1.15] tracking-[-0.01em] text-ink decoration-accent/40 underline-offset-4 group-hover:underline dark:text-ink-inverse">
          {stripMarkup(item.title)}
        </span>
        {item.description && (
          <span className="mt-2 line-clamp-2 block text-[13.5px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
            {stripMarkup(item.description)}
          </span>
        )}
      </span>
      {item.thumbnail && <Thumb src={item.thumbnail} className="aspect-video w-full rounded-lg sm:order-2" />}
    </button>
  )
}

function NewsRow({ item, index }: { item: DiscoverItem; index: number }) {
  const reduced = useReducedMotion()
  return (
    <motion.li {...rowMotion(index, reduced)} className="list-none">
      <button
        type="button"
        onClick={() => openResult(item.url)}
        className="group flex w-full items-start gap-3.5 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-50 dark:hover:bg-surface-850"
      >
        <span className="min-w-0 flex-1">
          <Meta item={item} />
          <span className="mt-1 line-clamp-2 block text-[14.5px] font-medium leading-snug text-ink decoration-accent/50 underline-offset-[3px] group-hover:underline dark:text-ink-inverse">
            {stripMarkup(item.title)}
          </span>
        </span>
        {item.thumbnail && <Thumb src={item.thumbnail} className="h-14 w-14 rounded-md" />}
      </button>
    </motion.li>
  )
}

export function NewsResults({ state, onRetry, onOpenWeb }: { state: SearchRunState; onRetry?: () => void; onOpenWeb?: () => void }) {
  const [shown, setShown] = useState(PAGE)
  const section = state.sections.news
  if (!section) return <div className="max-w-[680px]"><RowSkeleton rows={6} /></div>
  if (section.status === 'error') return <div className="max-w-[680px]"><SourceErrorNotice error={{ source: 'brave', ...section.error! }} onRetry={onRetry} /></div>

  const items = sectionItems(state, 'news')
  if (!items.length) {
    return (
      <EmptyState
        title="No news found"
        hint="This topic may be out of the current news cycle"
        action={onOpenWeb ? { label: 'See web results', onClick: onOpenWeb } : undefined}
      />
    )
  }
  const [lead, ...rest] = items
  return (
    <div className="max-w-[720px]">
      <LeadStory item={lead} />
      <ul className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
        {rest.slice(0, shown).map((item, i) => <NewsRow key={item.id} item={item} index={i} />)}
      </ul>
      <ShowMore hidden={rest.length - shown} onClick={() => setShown((n) => n + PAGE * 2)} />
    </div>
  )
}
