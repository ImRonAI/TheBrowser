/**
 * The Videos panel — Brave video search as cinematic rows: a 16:9 thumbnail with a
 * frosted duration chip and hover play affordance, then title, creator/publisher,
 * views and age.
 */
import { motion } from 'framer-motion'
import { Play } from 'lucide-react'
import { sectionItems, type SearchRunState } from '@/lib/search-api'
import type { DiscoverItem } from '@/lib/discover-feed'
import { stripMarkup } from '@/lib/discover-feed'
import { EmptyState, RowSkeleton, SourceErrorNotice } from './primitives'
import { openResult } from './open-result'

function formatViews(views: unknown): string | null {
  if (typeof views !== 'number' || !Number.isFinite(views)) return null
  return `${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(views)} views`
}

function VideoRow({ item, index }: { item: DiscoverItem; index: number }) {
  const video = item.video
  const views = formatViews(video?.views)
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 12) * 0.035, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => openResult(item.url)}
      className="group flex w-full items-start gap-4 rounded-2xl px-3 py-3 text-left transition-colors duration-150 hover:bg-surface-50 dark:hover:bg-surface-800/50"
    >
      <span className="relative aspect-video w-40 flex-shrink-0 overflow-hidden rounded-xl bg-surface-100 dark:bg-surface-800 sm:w-48">
        {item.thumbnail && (
          <img src={item.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 ease-smooth group-hover:scale-[1.05]" />
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-300 group-hover:bg-black/25">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100">
            <Play className="ml-0.5 h-3.5 w-3.5 fill-white text-white" />
          </span>
        </span>
        {video?.duration && (
          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white backdrop-blur-sm">
            {video.duration}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 py-0.5">
        <span className="line-clamp-2 text-[15px] font-normal leading-snug text-ink transition-colors group-hover:text-accent-light dark:text-ink-inverse dark:group-hover:text-accent-muted">
          {stripMarkup(item.title)}
        </span>
        <span className="mt-1.5 block truncate text-xs font-light text-ink-secondary dark:text-ink-inverse-secondary">
          {[video?.creator, video?.publisher].filter(Boolean).join(' · ')}
        </span>
        <span className="mt-1 flex items-center gap-2 font-mono text-[10px] text-ink-muted dark:text-ink-inverse-muted">
          {views && <span className="tabular-nums">{views}</span>}
          {item.age && <span>{item.age}</span>}
        </span>
      </span>
    </motion.button>
  )
}

export function VideoResults({ state, onRetry }: { state: SearchRunState; onRetry?: () => void }) {
  const section = state.sections.videos
  if (!section) return <RowSkeleton rows={5} />
  if (section.status === 'error') return <div className="mx-auto max-w-3xl"><SourceErrorNotice error={{ source: 'brave', ...section.error! }} onRetry={onRetry} /></div>

  const items = sectionItems(state, 'videos')
  if (!items.length) return <EmptyState title="No videos found" />
  return (
    <div className="mx-auto max-w-3xl space-y-1">
      {items.map((item, i) => <VideoRow key={item.id} item={item} index={i} />)}
    </div>
  )
}
