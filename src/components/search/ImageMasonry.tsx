/**
 * The Images panel — a masonry stream merging Brave image search (at maximum count)
 * with the Agent API's own image_search_results. Agent finds carry a thin hue ring.
 * Hovering lifts the tile and reveals its caption (title + dimensions); clicking
 * opens the source page in a new tab.
 */
import { motion } from 'framer-motion'
import { mergedImages, type MergedImage, type SearchRunState } from '@/lib/search-api'
import { EmptyState, MasonrySkeleton, SourceErrorNotice } from './primitives'
import { hueWash } from './tabs-meta'
import { openResult } from './open-result'

function Tile({ image, index, hue }: { image: MergedImage; index: number; hue: string }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index, 16) * 0.025, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => openResult(image.pageUrl || image.url)}
      className="group relative mb-3 block w-full break-inside-avoid overflow-hidden rounded-xl bg-surface-100 text-left dark:bg-surface-800"
      style={image.origin === 'agent' ? { boxShadow: `0 0 0 1.5px ${hueWash(hue, 0.55)}` } : undefined}
      aria-label={image.title || 'Open image source'}
    >
      <img
        src={image.url}
        alt={image.title}
        loading="lazy"
        className="w-full object-cover transition-transform duration-500 ease-smooth group-hover:scale-[1.04]"
      />
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-black/0 to-black/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-1 items-center justify-between gap-2 px-3 pb-2.5 pt-6 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
        <span className="truncate text-[11px] font-light text-white">{image.title || 'View source'}</span>
        {(image.width || image.height) && (
          <span className="flex-shrink-0 font-mono text-[9px] tabular-nums text-white/70">
            {image.width}×{image.height}
          </span>
        )}
      </span>
    </motion.button>
  )
}

export function ImageMasonry({ state, hue, onRetry }: { state: SearchRunState; hue: string; onRetry?: () => void }) {
  const section = state.sections.images
  const hasAgentImages = state.agent.images.length > 0

  if (!section && !hasAgentImages) return <MasonrySkeleton />

  const images = mergedImages(state)
  return (
    <div className="mx-auto max-w-5xl">
      {section?.status === 'error' && <div className="mb-4"><SourceErrorNotice error={{ source: 'brave', ...section.error! }} onRetry={onRetry} /></div>}
      {images.length === 0 && section?.status === 'ok' ? (
        <EmptyState title="No images found" />
      ) : (
        <div className="columns-2 gap-3 sm:columns-3 lg:columns-4">
          {images.map((image, i) => <Tile key={image.url} image={image} index={i} hue={hue} />)}
        </div>
      )}
    </div>
  )
}
