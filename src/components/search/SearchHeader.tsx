/**
 * Search header: the query set in the editorial serif, then one quiet meta line —
 * depth · model · elapsed time (a live dot while sources stream, a check when done).
 * Back and re-run sit as small icon buttons on either side.
 */
import { useEffect, useState } from 'react'
import { ArrowLeft, Check, RefreshCw } from 'lucide-react'
import { levelLabel } from '@/lib/search-api'
import { cn } from '@/utils/cn'

function formatElapsed(ms: number): string {
  const seconds = ms / 1000
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
}

export interface SearchHeaderProps {
  query: string
  level: string
  model: string | null
  hue?: string
  isRunning: boolean
  startedAt: number | null
  durationMs: number | null
  onBack: () => void
  onRefresh: () => void
}

const iconButton = cn(
  'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors duration-150',
  'text-ink-secondary hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse',
  'disabled:pointer-events-none disabled:opacity-35',
)

export function SearchHeader({ query, level, model, isRunning, startedAt, durationMs, onBack, onRefresh }: SearchHeaderProps) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isRunning || startedAt === null) return
    const timer = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(timer)
  }, [isRunning, startedAt])

  const timing = durationMs !== null
    ? formatElapsed(durationMs)
    : isRunning && startedAt !== null
      ? formatElapsed(now - startedAt)
      : null

  return (
    <header className="relative z-10">
      <div className="mx-auto max-w-6xl px-6 pb-1 pt-7 sm:px-10">
        <div className="flex items-start gap-3">
          <button type="button" onClick={onBack} aria-label="Back to home" title="Back to home" className={cn(iconButton, 'mt-1 -ml-2')}>
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="line-clamp-2 font-display text-[2rem] font-normal leading-[1.1] tracking-[-0.015em] text-ink dark:text-ink-inverse md:text-[2.4rem]">
              {query}
            </h1>
            <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-muted dark:text-ink-inverse-muted">
              <span className="font-medium text-ink-secondary dark:text-ink-inverse-secondary">{levelLabel(level)}</span>
              {model && <><span aria-hidden>·</span><span className="font-mono text-[11px]">{model}</span></>}
              {timing && (
                <>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums" role="status" aria-live="polite">
                    {isRunning
                      ? <span className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse dark:bg-accent-light" aria-hidden />
                      : <Check className="h-3 w-3 text-success" strokeWidth={2.5} aria-hidden />}
                    {timing}
                    <span className="sr-only">{isRunning ? 'searching' : 'complete'}</span>
                  </span>
                </>
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={isRunning}
            aria-label="Run this search again"
            title="Run again"
            className={cn(iconButton, 'mt-1 -mr-2')}
          >
            <RefreshCw className={cn('h-4 w-4', isRunning && 'motion-safe:animate-spin')} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </header>
  )
}
