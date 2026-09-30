import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Play } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { Story } from '@/lib/articles'
import type { StickerHue } from '@/lib/story-animations'

/** Sticker tag palette — tokens from tailwind.config.ts only (design contract). */
const STICKER: Record<StickerHue, string> = {
  amber: 'bg-amber-200 text-amber-950 dark:bg-amber-300',
  rose: 'bg-rose-200 text-rose-950 dark:bg-rose-300',
  emerald: 'bg-emerald-200 text-emerald-950 dark:bg-emerald-300',
  sky: 'bg-sky-200 text-sky-950 dark:bg-sky-300',
  violet: 'bg-violet-200 text-violet-950 dark:bg-violet-300',
}

export interface StoryCardProps {
  story: Story
  featured: boolean
  onRead: () => void
  /** Deterministic resting tilt in degrees; the caller derives it via `cardTilt(story.url)`. */
  tilt: number
  /** Sticker hue; the caller derives it via `stickerHue(story.topic)`. */
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
      style={{ rotate: reduced ? 0 : tilt }}
      whileHover={reduced ? undefined : { rotate: 0, y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      data-tilt={tilt}
      className="h-full"
    >
      <button
        type="button"
        onClick={onRead}
        aria-label={`Read: ${story.title}`}
        className={cn(
          'group relative flex w-full items-stretch gap-4 rounded-2xl border border-surface-200/90 bg-white/85 p-3 text-left shadow-[4px_5px_0_0_rgba(79,70,229,0.10)] transition-shadow duration-300 hover:border-indigo-300 hover:shadow-[6px_8px_0_0_rgba(79,70,229,0.18)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500 dark:border-surface-700 dark:bg-surface-850/85 dark:shadow-[4px_5px_0_0_rgba(129,140,248,0.14)] dark:hover:border-indigo-600',
          featured ? 'h-[268px]' : 'h-[136px]',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute -top-2.5 left-4 z-[1] rotate-[-3deg] rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] shadow-sm',
            STICKER[hue],
          )}
        >
          {story.topic}
        </span>

        <div
          className={cn(
            'relative shrink-0 overflow-hidden rounded-xl bg-surface-100 dark:bg-surface-800',
            featured ? 'w-[44%]' : 'w-[112px]',
          )}
        >
          {showImage ? (
            <img
              src={story.thumbnail}
              alt=""
              loading={featured ? 'eager' : 'lazy'}
              onError={() => setImageBroken(true)}
              className="h-full w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-[1.04]"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-gradient-to-br from-indigo-100 to-surface-100 dark:from-indigo-950 dark:to-surface-800">
              <span className="font-display text-4xl text-indigo-500/60">{story.topic.charAt(0)}</span>
            </div>
          )}
          {story.kind === 'video' && (
            <span className="absolute bottom-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white">
              <Play size={11} fill="currentColor" />
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col py-0.5">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink-muted dark:text-ink-inverse-muted">
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
            {story.age && <span className="shrink-0 normal-case tracking-normal">{story.age}</span>}
          </p>
          <h3
            className={cn(
              'mt-1.5 font-display leading-[1.15] tracking-tight text-ink transition-colors group-hover:text-indigo-600 dark:text-ink-inverse dark:group-hover:text-indigo-300',
              featured ? 'line-clamp-3 text-2xl lg:text-[1.9rem]' : 'line-clamp-2 text-[15px]',
            )}
          >
            {story.title}
          </h3>
          {story.description && (
            <p
              className={cn(
                'mt-1.5 text-xs leading-relaxed text-ink-muted dark:text-ink-inverse-muted',
                featured ? 'line-clamp-3' : 'line-clamp-1',
              )}
            >
              {story.description}
            </p>
          )}
          <span className="mt-auto inline-flex items-center gap-1 pt-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-300">
            Read <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </button>
    </motion.div>
  )
}
