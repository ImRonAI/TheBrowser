import { AlertTriangle, X, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

/** An empty or unavailable pane: one icon, one line, one sentence. */
export function StudioEmpty({ icon: Icon, title, children, action, className }: {
  icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; className?: string
}) {
  return (
    <div className={cn('flex h-full min-h-[260px] flex-col items-center justify-center px-8 py-10 text-center', className)}>
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-surface-200 bg-surface-0 text-volt shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <Icon aria-hidden className="h-5 w-5" strokeWidth={2} />
      </span>
      <p className="mt-4 font-display text-[17px] font-bold tracking-[-0.02em] text-ink dark:text-ink-inverse">{title}</p>
      {children && <div className="mt-1.5 max-w-[44ch] text-[13px] leading-relaxed text-ink-muted dark:text-ink-inverse-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** A pane's own toolbar row (40px), under the Studio's tab bar. */
export function PaneBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-10 shrink-0 items-center justify-between gap-2 border-b border-surface-200/80 px-3 dark:border-surface-800', className)}>
      {children}
    </div>
  )
}

export const barButton = 'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-ink-secondary transition-colors hover:bg-surface-100 hover:text-ink disabled:pointer-events-none disabled:opacity-40 dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse'
export const barIconButton = 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-100 hover:text-ink disabled:pointer-events-none disabled:opacity-40 dark:text-ink-inverse-muted dark:hover:bg-surface-800 dark:hover:text-ink-inverse'
export const primaryButton = 'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-blurple-600 px-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-blurple-700 disabled:pointer-events-none disabled:opacity-40 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300'
/** An empty state's action (StudioEmpty `action`). */
export const pillButton = 'inline-flex h-8 items-center gap-1.5 rounded-full border border-surface-200 bg-surface-0 px-3.5 text-[12.5px] font-semibold text-ink transition-colors hover:border-blurple-300 hover:bg-blurple-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-surface-200 disabled:hover:bg-surface-0 dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:hover:border-blurple-800 dark:hover:bg-blurple-950/50 dark:disabled:hover:border-surface-800 dark:disabled:hover:bg-surface-900'

/** A one-line warning under a toolbar (a refresh that failed, a message Ren could not take), with its own action. */
export function StudioNotice({ children, action, onDismiss }: { children: ReactNode; action?: ReactNode; onDismiss?: () => void }) {
  return (
    <div role="status" className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
      <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
      {onDismiss && <button type="button" className={barIconButton} onClick={onDismiss} aria-label="Dismiss" title="Dismiss"><X className="h-3.5 w-3.5" /></button>}
    </div>
  )
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
