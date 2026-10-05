/**
 * Loading + error primitives shared by every panel. Skeletons are shaped like the
 * content they stand in for (rows, cards, masonry) and shimmer with the app's
 * existing keyframe. Error notices are quiet: a tinted surface, the stable error
 * code as a chip, the message, and an optional retry.
 */
import { motion } from 'framer-motion'
import { AlertCircle, RotateCw } from 'lucide-react'
import type { SourceError } from '@/lib/search-api'
import { cn } from '@/utils/cn'

function Bar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-md bg-surface-100 dark:bg-surface-800',
        'bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.35),transparent)] dark:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)]',
        'bg-[length:200%_100%] animate-shimmer',
        className,
      )}
    />
  )
}

export function RowSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-5" aria-label="Loading results">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-start gap-3" style={{ opacity: Math.max(0.35, 1 - i * 0.12) }}>
          <Bar className="h-8 w-8 flex-shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Bar className="h-2.5 w-24" />
            <Bar className="h-4 w-3/4" />
            <Bar className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-label="Loading">
      {Array.from({ length: cards }, (_, i) => (
        <Bar key={i} className="h-44 rounded-2xl" />
      ))}
    </div>
  )
}

export function MasonrySkeleton({ tiles = 10 }: { tiles?: number }) {
  return (
    <div className="columns-2 gap-3 sm:columns-3 lg:columns-4" aria-label="Loading images">
      {Array.from({ length: tiles }, (_, i) => (
        <Bar key={i} className={cn('mb-3 w-full rounded-xl', i % 3 === 0 ? 'h-52' : i % 3 === 1 ? 'h-36' : 'h-64')} />
      ))}
    </div>
  )
}

export function AnswerSkeleton() {
  return (
    <div className="space-y-3" aria-label="Waiting for the agent">
      <Bar className="h-4 w-11/12" />
      <Bar className="h-4 w-full" />
      <Bar className="h-4 w-4/5" />
      <Bar className="h-4 w-full" />
      <Bar className="h-4 w-2/3" />
    </div>
  )
}

export function SourceErrorNotice({ error, onRetry }: { error: SourceError; onRetry?: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/5 px-4 py-3 dark:border-warning/20 dark:bg-warning/10"
      role="status"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-warning/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-warning">
            {error.code}
          </span>
          {typeof error.status === 'number' && error.status > 0 && (
            <span className="font-mono text-[10px] text-ink-muted dark:text-ink-inverse-muted">HTTP {error.status}</span>
          )}
        </div>
        <p className="mt-1 text-body-xs font-normal text-ink-secondary dark:text-ink-inverse-secondary">{error.message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-secondary transition-colors hover:text-ink dark:text-ink-inverse-secondary dark:hover:text-ink-inverse"
        >
          <RotateCw className="h-3 w-3" />
          Retry
        </button>
      )}
    </motion.div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="h-px w-10 bg-surface-200 dark:bg-surface-700" />
      <p className="mt-5 text-sm font-light text-ink-muted dark:text-ink-inverse-muted">{title}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted/70 dark:text-ink-inverse-muted/70">{hint}</p>}
    </div>
  )
}
