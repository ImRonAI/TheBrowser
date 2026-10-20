/**
 * Loading + error primitives shared by every panel. Skeletons are shaped like the
 * compact rows they stand in for and shimmer with the app's keyframe (static under
 * reduced motion). Error notices are quiet: a hairline, the stable error code as a
 * chip, the message, and an optional retry.
 */
import { AlertCircle, RotateCw } from 'lucide-react'
import type { SourceError } from '@/lib/search-api'
import { cn } from '@/utils/cn'

export function Bar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded bg-surface-100 dark:bg-surface-800',
        'bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.5),transparent)] dark:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.04),transparent)]',
        'bg-[length:200%_100%] motion-safe:animate-shimmer',
        className,
      )}
    />
  )
}

export function RowSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-1" aria-label="Loading results" role="status">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-start gap-3 px-3 py-3" style={{ opacity: Math.max(0.3, 1 - i * 0.12) }}>
          <Bar className="mt-0.5 h-4 w-4 flex-shrink-0 rounded" />
          <div className="flex-1 space-y-2">
            <Bar className="h-2.5 w-28" />
            <Bar className="h-3.5 w-4/5" />
            <Bar className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Loading" role="status">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="flex gap-3 rounded-xl border border-surface-200/70 p-3 dark:border-surface-800">
          <Bar className="h-16 w-16 flex-shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2 py-1">
            <Bar className="h-3.5 w-2/3" />
            <Bar className="h-3 w-1/2" />
            <Bar className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function MasonrySkeleton({ tiles = 12 }: { tiles?: number }) {
  return (
    <div className="columns-2 gap-2 sm:columns-3 lg:columns-4" aria-label="Loading images" role="status">
      {Array.from({ length: tiles }, (_, i) => (
        <Bar key={i} className={cn('mb-2 w-full rounded-md', i % 3 === 0 ? 'h-48' : i % 3 === 1 ? 'h-32' : 'h-60')} />
      ))}
    </div>
  )
}

export function AnswerSkeleton() {
  return (
    <div className="space-y-3" aria-label="Waiting for the answer" role="status">
      <Bar className="h-3.5 w-11/12" />
      <Bar className="h-3.5 w-full" />
      <Bar className="h-3.5 w-4/5" />
      <Bar className="h-3.5 w-full" />
      <Bar className="h-3.5 w-2/3" />
    </div>
  )
}

export function SourceErrorNotice({ error, onRetry }: { error: SourceError; onRetry?: () => void }) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/[0.04] px-3.5 py-2.5 dark:border-warning/25 dark:bg-warning/[0.06]"
      role="status"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-warning/10 px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-warning">
            {error.code}
          </span>
          {typeof error.status === 'number' && error.status > 0 && (
            <span className="font-mono text-[10px] text-ink-muted dark:text-ink-inverse-muted">HTTP {error.status}</span>
          )}
        </div>
        <p className="mt-1 text-[13px] text-ink-secondary dark:text-ink-inverse-secondary">{error.message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse"
        >
          <RotateCw className="h-3 w-3" />
          Retry
        </button>
      )}
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="font-display text-xl text-ink dark:text-ink-inverse">{title}</p>
      {hint && <p className="mt-1.5 text-[13px] text-ink-muted dark:text-ink-inverse-muted">{hint}</p>}
    </div>
  )
}

/** Small section label: "Consensus · 4 ————" */
export function GroupLabel({ label, count, id }: { label: string; count?: number; id?: string }) {
  return (
    <div className="mb-1 flex items-center gap-2.5 px-3" id={id}>
      <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted dark:text-ink-inverse-muted">{label}</span>
      {typeof count === 'number' && (
        <span className="font-mono text-[10px] tabular-nums text-ink-muted/80 dark:text-ink-inverse-muted/80">{count}</span>
      )}
      <div className="h-px flex-1 bg-surface-200/80 dark:bg-surface-800" />
    </div>
  )
}

/** A quiet text button that reveals more items of a list. */
export function ShowMore({ hidden, onClick }: { hidden: number; onClick: () => void }) {
  if (hidden <= 0) return null
  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-3 mt-2 rounded-md px-2 py-1.5 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse"
    >
      Show {hidden} more
    </button>
  )
}
