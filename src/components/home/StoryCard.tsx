import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Play, Plus } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { Story } from '@/lib/articles'
import type { StickerHue } from '@/lib/story-animations'

/**
 * Topic accents. Ren is ink and volt, so every topic hue resolves to a shade of volt (no rainbow,
 * no orange): a small swatch beside the kicker keeps slots distinguishable, and the same shade
 * paints the typographic poster a story shows when it has no image.
 */
const HUE_SWATCH: Record<StickerHue, string> = {
  amber: 'bg-blurple-300',
  rose: 'bg-blurple-400',
  emerald: 'bg-blurple-500',
  sky: 'bg-blurple-600 dark:bg-blurple-400',
  violet: 'bg-blurple-800 dark:bg-blurple-200',
}

const HUE_POSTER: Record<StickerHue, string> = {
  amber: 'bg-blurple-100 text-blurple-700 dark:bg-blurple-950 dark:text-blurple-300',
  rose: 'bg-blurple-200 text-blurple-800 dark:bg-blurple-900 dark:text-blurple-200',
  emerald: 'bg-blurple-500 text-white',
  sky: 'bg-blurple-600 text-white dark:bg-blurple-400 dark:text-ink',
  violet: 'bg-blurple-900 text-blurple-200 dark:bg-blurple-200 dark:text-blurple-900',
}

/**
 * `featured`: the wide hero (image left, big headline). `compact`: the standard 136px row card.
 * `companion`: the slot that shares the hero's grid row at `xl` — compact below `xl`, and a
 * 268px portrait card (image on top) from `xl` up so the two cards finish on the same line.
 */
export type StoryCardSize = 'featured' | 'companion' | 'compact'

/** Slot-wrapper heights; StoryCard mirrors them so the swap animation and the card agree. */
export const STORY_CARD_HEIGHT: Record<StoryCardSize, string> = {
  featured: 'h-[268px]',
  companion: 'h-[136px] xl:h-[268px]',
  compact: 'h-[136px]',
}

export interface StoryCardProps {
  story: Story
  featured: boolean
  /** Defaults to `featured ? 'featured' : 'compact'`. */
  size?: StoryCardSize
  onRead: () => void
  /** Save the story to the user's Ren context (Context widget). */
  onAddContext?: () => void
  /** Set while an add to context is in flight (e.g. "Adding to your context…"): the Context button waits. */
  addContextBusy?: string | null
  /** Deterministic resting tilt in degrees; the caller derives it via `cardTilt(story.url)`. Kept as data; cards rest level. */
  tilt: number
  /** Kicker hue; the caller derives it via `stickerHue(story.topic)`. */
  hue: StickerHue
}

/**
 * An editorial tile: the image bleeds to the card's edge, a mono kicker and byline frame a heavy
 * display headline. Hover lifts the card a pixel, scales the image and underlines the headline.
 */
export function StoryCard({ story, featured, size = featured ? 'featured' : 'compact', onRead, onAddContext, addContextBusy, tilt, hue }: StoryCardProps) {
  const reduced = useReducedMotion() ?? false
  const [imageBroken, setImageBroken] = useState(false)
  const [faviconBroken, setFaviconBroken] = useState(false)
  const showImage = Boolean(story.thumbnail) && !imageBroken
  const showFavicon = Boolean(story.favicon) && !faviconBroken
  const companion = size === 'companion'

  return (
    <motion.div
      whileHover={reduced ? undefined : { y: -1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      data-tilt={tilt}
      className="group/card relative h-full"
    >
      {onAddContext && (
        <button
          type="button"
          onClick={onAddContext}
          disabled={Boolean(addContextBusy)}
          aria-label={`Add to Ren context: ${story.title}`}
          title={addContextBusy || 'Add to Ren context'}
          className={cn(
            'absolute left-2 top-2 z-10 inline-flex h-7 items-center gap-1 rounded-full bg-ink/80 pl-2 pr-2.5 text-[12px] font-semibold text-white opacity-0 backdrop-blur-sm transition-[opacity,background-color] duration-150 ease-out hover:bg-ink focus-visible:opacity-100 group-hover/card:opacity-100',
            addContextBusy && 'cursor-wait bg-ink/50 hover:bg-ink/50',
          )}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          Context
        </button>
      )}
      <button
        type="button"
        onClick={onRead}
        aria-label={`Read: ${story.title}`}
        className={cn(
          'group relative flex w-full items-stretch overflow-hidden rounded-xl border text-left transition-colors duration-200 ease-out',
          'border-surface-200 bg-surface-0 hover:border-surface-300',
          'dark:border-surface-800 dark:bg-surface-900 dark:hover:border-surface-700',
          STORY_CARD_HEIGHT[size],
          companion && 'xl:flex-col',
        )}
      >
        <div
          className={cn(
            'relative shrink-0 overflow-hidden bg-surface-100 dark:bg-surface-850',
            featured ? 'w-[46%]' : 'w-[112px]',
            companion && 'xl:h-[112px] xl:w-full',
          )}
        >
          {showImage ? (
            <img
              src={story.thumbnail}
              alt=""
              loading={featured ? 'eager' : 'lazy'}
              onError={() => setImageBroken(true)}
              className="h-full w-full object-cover transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.02]"
            />
          ) : (
            <div className={cn('flex h-full items-end p-3', HUE_POSTER[hue])}>
              <span className={cn('font-display font-extrabold leading-[0.8] tracking-[-0.05em]', featured ? 'text-[5.5rem]' : 'text-5xl')}>
                {story.topic.charAt(0)}
              </span>
            </div>
          )}
          {story.kind === 'video' && (
            <span className="absolute bottom-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink/80 text-white backdrop-blur-sm">
              <Play className="h-3 w-3 translate-x-px" fill="currentColor" />
            </span>
          )}
        </div>

        <div className={cn('flex min-w-0 flex-1 flex-col', featured ? 'p-5' : 'px-4 py-3', companion && 'xl:py-3.5')}>
          <p className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase leading-4 tracking-[0.08em] text-ink-secondary dark:text-ink-inverse-secondary">
            <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-[2px]', HUE_SWATCH[hue])} />
            <span className="truncate">{story.topic}</span>
          </p>
          <h3
            className={cn(
              'font-display font-bold tracking-[-0.02em] text-ink decoration-blurple-600 decoration-2 underline-offset-[0.18em] group-hover:underline dark:text-ink-inverse dark:decoration-blurple-400',
              featured ? 'mt-3 line-clamp-3 text-[1.625rem] leading-[1.06] lg:text-[1.875rem]' : 'mt-1.5 line-clamp-2 text-[16px] leading-[1.18]',
              companion && 'xl:text-[17px]',
            )}
          >
            {story.title}
          </h3>
          {story.description && (
            <p
              className={cn(
                'text-[13px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary',
                featured ? 'mt-3 line-clamp-3' : 'mt-1 line-clamp-1',
                companion && 'xl:line-clamp-1',
              )}
            >
              {story.description}
            </p>
          )}
          <span className="mt-auto flex items-center gap-1.5 pt-2 font-mono text-[11px] uppercase leading-4 tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted">
            {showFavicon && (
              <img
                src={story.favicon}
                alt=""
                className="h-3.5 w-3.5 rounded-sm"
                onError={() => setFaviconBroken(true)}
              />
            )}
            <span className="truncate">{story.source}</span>
            {story.age && <span aria-hidden>·</span>}
            {story.age && <span className="shrink-0">{story.age}</span>}
            <span className="ml-auto inline-flex flex-shrink-0 items-center gap-1 font-sans text-[12px] font-semibold normal-case tracking-normal text-ink transition-colors duration-150 group-hover:text-blurple-600 dark:text-ink-inverse dark:group-hover:text-blurple-400">
              {featured && 'Read'} <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-0.5" />
            </span>
          </span>
        </div>
      </button>
    </motion.div>
  )
}
