import { Ban } from 'lucide-react'
import { cn } from '@/utils/cn'

/** The BLOCKED tag: rose, with the blocking issues' keys when they are known. */
export function BlockedTag({ label, keys = [], showKeys = false, className }: {
  /** Full sentence for the tooltip and screen readers, e.g. "Blocked by CALQA-1". */
  label: string
  keys?: string[]
  /** Print "by KEY" beside the tag (cards); tables keep it in the tooltip. */
  showKeys?: boolean
  className?: string
}) {
  return (
    <span title={label} aria-label={label} className={cn('inline-flex min-w-0 max-w-full items-center gap-1.5', className)}>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-[5px] bg-rose-500/10 px-1.5 py-px font-mono text-[10px] font-semibold uppercase leading-4 tracking-[0.08em] text-rose-700 ring-1 ring-inset ring-rose-500/25 dark:bg-rose-400/10 dark:text-rose-300 dark:ring-rose-400/25">
        <Ban className="h-2.5 w-2.5" strokeWidth={2.75} aria-hidden />
        Blocked
      </span>
      {showKeys && keys.length > 0 && (
        <span className="truncate text-[11px] text-rose-700 dark:text-rose-300">
          by <span className="font-mono text-[10.5px] tabular-nums tracking-[0.02em]">{keys.join(', ')}</span>
        </span>
      )}
    </span>
  )
}

/**
 * Timeline bars for blocked issues: a rose base with solid rose hazard stripes drawn in
 * `currentColor`, so a blocked span reads at a glance in light, dark and glass.
 */
export const BLOCKED_BAR = 'text-rose-500 bg-rose-500/45 bg-[repeating-linear-gradient(135deg,currentColor_0_5px,transparent_5px_10px)] ring-1 ring-rose-500/35 dark:text-rose-400 dark:bg-rose-400/35 dark:ring-rose-400/35'
