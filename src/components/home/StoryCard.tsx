import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Play } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { Story } from '@/lib/articles'
import type { StickerHue } from '@/lib/story-animations'

/**
 * Topic kicker tint. The 2026 redesign is editorial: one neutral kicker for every
 * topic, with a hairline swatch keyed to the topic so slots stay distinguishable
 * without a rainbow.
 */
const KICKER_SWATCH: Record<StickerHue, string> = {
  amber: 'bg-[#B98A4E]',
  rose: 'bg-[#A86A62]',
  emerald: 'bg-[#6F8A73]',
  sky: 'bg-[#6C8296]',
  violet: 'bg-[#86768F]',
}

export interface StoryCardProps {
  story: Story
  featured: boolean
  onRead: () => void
  /** Deterministic resting tilt in degrees; the caller derives it via `cardTilt(story.url)`. Kept as data; cards rest level. */
  tilt: number
  /** Kicker hue; the caller derives it via `stickerHue(story.topic)`. */
  hue: StickerHue
}

export function StoryCard({ story, featured, onRead, tilt, hue }: StoryCardProps) {
  const reduced = useReducedMotion() ?? false
  const [imageBroken, setImageBroken] = useState(false)
  const [faviconBroken, setFaviconBroken] = useState(false)
  const showImage = Boolean(story.thumbnail) && !imageBroken
  const showFavicon = Boolean(story.favicon) && !faviconBroken

  return (
    <motion.div
      whileHover={reduced ? undefined : { y: -2 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      data-tilt={tilt}
      className="h-full"
    >
      <button
        type="button"
        onClick={onRead}
        aria-label={`Read: ${story.title}`}
        className={cn(
          'group relative flex w-full items-stretch gap-4 rounded-xl border p-3 text-left transition-[border-color,box-shadow] duration-300',
          'border-surface-200/80 bg-surface-0 hover:border-surface-300 hover:shadow-[0_10px_28px_-14px_rgb(26_25_23/0.22)]',
          'dark:border-surface-800 dark:bg-surface-900 dark:hover:border-surface-700 dark:hover:shadow-[0_10px_28px_-14px_rgb(0_0_0/0.6)]',
          featured ? 'h-[268px]' : 'h-[136px]',
        )}
      >
        <div
          className={cn(
            'relative shrink-0 overflow-hidden rounded-lg bg-surface-100 dark:bg-surface-800',
            featured ? 'w-[46%]' : 'w-[112px]',
          )}
        >
          {showImage ? (
            <img
              src={story.thumbnail}
              alt=""
              loading={featured ? 'eager' : 'lazy'}
              onError={() => setImageBroken(true)}
              className="h-full w-full object-cover transition-transform duration-700 ease-smooth motion-safe:group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-gradient-to-br from-surface-50 to-surface-200 dark:from-surface-850 dark:to-surface-800">
              <span className="font-display text-4xl italic text-ink-muted/70 dark:text-ink-inverse-muted/70">{story.topic.charAt(0)}</span>
            </div>
          )}
          {story.kind === 'video' && (
            <span className="absolute bottom-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white">
              <Play size={11} fill="currentColor" />
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col py-0.5">
          <p className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-muted dark:text-ink-inverse-muted">
            <span aria-hidden className={cn('h-2.5 w-[3px] flex-shrink-0 rounded-full', KICKER_SWATCH[hue])} />
            <span className="truncate">{story.topic}</span>
          </p>
          <h3
            className={cn(
              'mt-1.5 font-display font-normal leading-[1.14] tracking-[-0.01em] text-ink dark:text-ink-inverse',
              featured ? 'line-clamp-3 text-[1.75rem] lg:text-[1.95rem]' : 'line-clamp-2 text-[16.5px]',
            )}
          >
            {story.title}
          </h3>
          {story.description && (
            <p
              className={cn(
                'mt-1.5 text-[12.5px] leading-relaxed text-ink-muted dark:text-ink-inverse-muted',
                featured ? 'line-clamp-3' : 'line-clamp-1',
              )}
            >
              {story.description}
            </p>
          )}
          <span className="mt-auto flex items-center gap-1.5 pt-1.5 text-[11.5px] text-ink-muted dark:text-ink-inverse-muted">
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
            <span className="ml-auto inline-flex flex-shrink-0 items-center gap-1 font-medium text-ink-secondary transition-colors group-hover:text-accent dark:text-ink-inverse-secondary dark:group-hover:text-accent-light">
              {featured && 'Read'} <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
            </span>
          </span>
        </div>
      </button>
    </motion.div>
  )
}
