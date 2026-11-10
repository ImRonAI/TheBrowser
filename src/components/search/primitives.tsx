/**
 * Loading, status and error primitives shared by every panel. Skeletons are shaped like the
 * rows they stand in for and shimmer with the app's keyframe (static under reduced motion).
 * Agent activity is shimmer text (`LiveText`), never a pulsing dot. Source errors are
 * signal-yellow notices: the stable error code as a mono chip, the message, an optional retry.
 */
import type { ReactNode } from 'react'
import { useReducedMotion } from 'framer-motion'
import { AlertTriangle, ChevronDown, RotateCw } from 'lucide-react'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { RenMark } from '@/components/brand'
import type { SourceError } from '@/lib/search-api'
import { cn } from '@/utils/cn'

export function Bar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-md bg-surface-100 dark:bg-surface-800',
        'bg-[linear-gradient(90deg,transparent,rgb(var(--ren-paper)/0.7),transparent)] dark:bg-[linear-gradient(90deg,transparent,rgb(var(--ren-ink)/0.06),transparent)]',
        'bg-[length:200%_100%] motion-safe:animate-shimmer',
        className,
      )}
    />
  )
}

/**
 * Agent activity as shimmer text (docs/brand.md § Shape and depth). The AI Elements Shimmer
 * paints with the shadcn v4 colour variables, so they are mapped onto Ren's tokens here: volt
 * for the agent, muted ink for secondary status. Plain text under reduced motion.
 */
export function LiveText({ children, tone = 'volt', className }: {
  children: string
  tone?: 'volt' | 'muted'
  className?: string
}) {
  const reduced = useReducedMotion()
  if (reduced) {
    return (
      <span className={cn(tone === 'volt' ? 'text-volt' : 'text-ink-muted dark:text-ink-inverse-muted', className)}>
        {children}
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex [--color-background:hsl(var(--background))]',
        tone === 'volt'
          ? '[--color-muted-foreground:rgb(var(--ren-volt))]'
          : '[--color-muted-foreground:hsl(var(--muted-foreground))]',
      )}
    >
      <Shimmer as="span" duration={1.6} className={className}>{children}</Shimmer>
    </span>
  )
}

export function RowSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-1" aria-label="Loading results" role="status">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-start gap-3 px-3 py-3" style={{ opacity: Math.max(0.3, 1 - i * 0.12) }}>
          <Bar className="mt-0.5 h-4 w-4 flex-shrink-0 rounded" />
          <div className="flex-1 space-y-2.5">
            <Bar className="h-2.5 w-28" />
            <Bar className="h-4 w-4/5" />
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
        <div key={i} className="flex gap-3 rounded-xl border border-surface-200 p-3 dark:border-surface-800">
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
    <div className="columns-2 gap-3 sm:columns-3 lg:columns-4" aria-label="Loading images" role="status">
      {Array.from({ length: tiles }, (_, i) => (
        <Bar key={i} className={cn('mb-3 w-full rounded-lg', i % 3 === 0 ? 'h-48' : i % 3 === 1 ? 'h-32' : 'h-60')} />
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
      className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 dark:border-amber-900 dark:bg-amber-950/40"
      role="status"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700 dark:text-amber-300" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-amber-100 px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
            {error.code}
          </span>
          {typeof error.status === 'number' && error.status > 0 && (
            <span className="font-mono text-[10px] tabular-nums text-amber-800 dark:text-amber-300">HTTP {error.status}</span>
          )}
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-amber-800 dark:text-amber-300">{error.message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-amber-800 transition-colors duration-150 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden />
          Retry
        </button>
      )}
    </div>
  )
}

/**
 * Nothing to show. `action` is the one step that gets the person further (search a level
 * deeper, look at another tab); `children` holds a richer control such as a form.
 */
export function EmptyState({ title, hint, action, children }: {
  title: string
  hint?: string
  action?: { label: string; onClick: () => void }
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <RenMark className="h-10 w-10" />
      <p className="mt-4 font-display text-xl font-bold tracking-[-0.02em] text-ink dark:text-ink-inverse">{title}</p>
      {hint && <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">{hint}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 inline-flex h-8 items-center rounded-lg bg-surface-100 px-3 text-[13px] font-medium text-ink transition-colors duration-150 hover:bg-surface-200 dark:bg-surface-850 dark:text-ink-inverse dark:hover:bg-surface-800"
        >
          {action.label}
        </button>
      )}
      {children}
    </div>
  )
}

/** Section label in the mono micro grammar: "CONSENSUS 4 ————" */
export function GroupLabel({ label, count, id }: { label: string; count?: number; id?: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-2.5 px-3" id={id}>
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted">{label}</span>
      {typeof count === 'number' && (
        <span className="font-mono text-[11px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">{count}</span>
      )}
      <div className="h-px flex-1 bg-surface-200 dark:bg-surface-800" />
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
      className="mx-3 mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-850 dark:hover:text-ink-inverse"
    >
      Show <span className="font-mono tabular-nums">{hidden}</span> more
      <ChevronDown className="h-4 w-4" aria-hidden />
    </button>
  )
}
