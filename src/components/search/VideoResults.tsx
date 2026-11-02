/**
 * The Videos panel — Brave video search as a responsive grid: a 16:9 thumbnail
 * with a duration chip and a hover play glyph, then a two-line title and one
 * truncated meta line (creator · views · age).
 */
import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Play } from 'lucide-react'
import { sectionItems, type SearchRunState } from '@/lib/search-api'
import type { DiscoverItem } from '@/lib/discover-feed'
import { stripMarkup } from '@/lib/discover-feed'
import { EmptyState, MasonrySkeleton, SourceErrorNotice } from './primitives'
import { rowMotion } from './ResultRow'
import { openResult } from './open-result'

function formatViews(views: unknown): string | null {
  if (typeof views !== 'number' || !Number.isFinite(views)) return null
  return `${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(views)} views`
}

function VideoTile({ item, index }: { item: DiscoverItem; index: number }) {
  const reduced = useReducedMotion()
  const [broken, setBroken] = useState(false)
  const video = item.video
  const meta = [video?.creator || video?.publisher, formatViews(video?.views), item.age].filter(Boolean).join(' · ')
  return (
    <motion.li {...rowMotion(index, reduced)} className="list-none">
      <button type="button" onClick={() => openResult(item.url)} className="group block w-full rounded-lg text-left">
        <span className="relative block aspect-video w-full overflow-hidden rounded-lg bg-surface-100 dark:bg-surface-800">
          {item.thumbnail && !broken && (
            <img src={item.thumbnail} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover transition-transform duration-500 ease-smooth motion-safe:group-hover:scale-[1.03]" />
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-300 group-hover:bg-black/20">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
              <Play className="ml-0.5 h-4 w-4 fill-white text-white" />
            </span>
          </span>
          {video?.duration && (
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-px font-mono text-[10px] tabular-nums text-white">
              {video.duration}
            </span>
          )}
        </span>
        <span className="mt-2 line-clamp-2 block px-0.5 text-[13.5px] font-medium leading-snug text-ink decoration-accent/50 underline-offset-[3px] group-hover:underline dark:text-ink-inverse">
          {stripMarkup(item.title)}
        </span>
        {meta && <span className="mt-0.5 block truncate px-0.5 text-[12px] text-ink-muted dark:text-ink-inverse-muted">{meta}</span>}
      </button>
    </motion.li>
  )
}

export function VideoResults({ state, onRetry }: { state: SearchRunState; onRetry?: () => void }) {
  const section = state.sections.videos
  if (!section) return <MasonrySkeleton tiles={9} />
  if (section.status === 'error') return <div className="max-w-[680px]"><SourceErrorNotice error={{ source: 'brave', ...section.error! }} onRetry={onRetry} /></div>

  const items = sectionItems(state, 'videos')
  if (!items.length) return <EmptyState title="No videos found" />
  return (
    <ul className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item, i) => <VideoTile key={item.id} item={item} index={i} />)}
    </ul>
  )
}
