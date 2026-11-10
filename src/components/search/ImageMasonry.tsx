/**
 * The Images panel — a tight masonry stream merging Brave image search with the
 * Agent API's own image_search_results. Agent finds carry a small ember dot.
 * Hover reveals the caption (title + dimensions); clicking opens the source page.
 */
import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { mergedImages, type MergedImage, type SearchRunState } from '@/lib/search-api'
import { EmptyState, MasonrySkeleton, SourceErrorNotice } from './primitives'
import { openResult } from './open-result'

function Tile({ image, index }: { image: MergedImage; index: number }) {
  const reduced = useReducedMotion()
  const [broken, setBroken] = useState(false)
  // Hotlink-blocked or expired third-party images drop out instead of showing a broken box.
  if (broken) return null
  // Known dimensions reserve the tile's box before the lazy image loads, so the columns do not reflow.
  const sized = Boolean(image.width && image.height && image.width > 0 && image.height > 0)
  return (
    <motion.button
      type="button"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay: reduced ? 0 : Math.min(index, 16) * 0.015 }}
      onClick={() => openResult(image.pageUrl || image.url)}
      className="group relative mb-2 block w-full break-inside-avoid overflow-hidden rounded-md bg-surface-100 text-left dark:bg-surface-800"
      aria-label={image.title || 'Open image source'}
    >
      <img
        src={image.url}
        alt={image.title || ''}
        loading="lazy"
        width={sized ? image.width! : undefined}
        height={sized ? image.height! : undefined}
        onError={() => setBroken(true)}
        className="h-auto w-full object-cover transition-transform duration-500 ease-smooth motion-safe:group-hover:scale-[1.03]"
      />
      {image.origin === 'agent' && (
        <span className="absolute left-2 top-2 h-2 w-2 rounded-full bg-accent ring-2 ring-white/80 dark:bg-accent-light dark:ring-black/40" title="Agent find" aria-label="Agent find" role="img" />
      )}
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100" />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-2.5 pb-2 pt-6 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
        <span className="truncate text-[11px] text-white">{image.title || 'View source'}</span>
        {(image.width || image.height) && (
          <span className="flex-shrink-0 font-mono text-[9px] tabular-nums text-white/70">
            {image.width}×{image.height}
          </span>
        )}
      </span>
    </motion.button>
  )
}

export function ImageMasonry({ state, onRetry }: { state: SearchRunState; hue?: string; onRetry?: () => void }) {
  const section = state.sections.images
  const hasAgentImages = state.agent.images.length > 0

  if (!section && !hasAgentImages) return <MasonrySkeleton />

  const images = mergedImages(state)
  return (
    <div>
      {section?.status === 'error' && <div className="mb-4 max-w-[680px]"><SourceErrorNotice error={{ source: 'brave', ...section.error! }} onRetry={onRetry} /></div>}
      {images.length === 0 && section?.status === 'ok' ? (
        <EmptyState title="No images found" />
      ) : (
        <div className="columns-2 gap-2 sm:columns-3 lg:columns-4 xl:columns-5">
          {images.map((image, i) => <Tile key={image.url} image={image} index={i} />)}
        </div>
      )}
    </div>
  )
}
