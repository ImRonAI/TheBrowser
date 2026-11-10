/**
 * Search header: a toolbar row (back · "// SEARCH" tag label · re-run), the query echoed in
 * the display face, then one quiet meta line — depth chip · model · elapsed time (shimmer
 * "Searching" while sources stream, a check when done).
 */
import { useEffect, useState } from 'react'
import { ArrowLeft, Check, RefreshCw } from 'lucide-react'
import { levelLabel } from '@/lib/search-api'
import { cn } from '@/utils/cn'
import { LiveText } from './primitives'

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
  'text-ink-secondary hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-850 dark:hover:text-ink-inverse',
  'disabled:pointer-events-none disabled:opacity-40',
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
      <div className="mx-auto max-w-6xl px-6 pt-6 sm:px-10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <button type="button" onClick={onBack} aria-label="Back to home" title="Back to home" className={cn(iconButton, '-ml-2')}>
              <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <span className="tag-label tag-label-slash">Search</span>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={isRunning}
            aria-label="Run this search again"
            title="Run again"
            className={cn(iconButton, '-mr-2')}
          >
            <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <h1
          title={query}
          className="mt-4 line-clamp-2 font-display text-display-md font-extrabold tracking-[-0.035em] text-ink [overflow-wrap:anywhere] dark:text-ink-inverse md:text-display-lg"
        >
          {query}
        </h1>

        <p className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px] text-ink-muted dark:text-ink-inverse-muted">
          <span className="inline-flex h-6 items-center rounded-full bg-surface-100 px-2.5 text-[12px] font-medium text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary">
            {levelLabel(level)}
          </span>
          {model && <span className="font-mono text-[11px]">{model}</span>}
          {timing && (
            <>
              {model && <span aria-hidden>·</span>}
              {/* The ticking timer is visual only; the status region below announces transitions. */}
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums" aria-hidden>
                {isRunning
                  ? <LiveText className="font-mono text-[11px]">Searching</LiveText>
                  : <Check className="h-3.5 w-3.5 text-success" strokeWidth={2.5} />}
                {timing}
              </span>
            </>
          )}
        </p>
        <span className="sr-only" role="status">
          {isRunning ? 'Searching' : durationMs !== null ? `Search finished in ${formatElapsed(durationMs)}` : ''}
        </span>
      </div>
    </header>
  )
}
