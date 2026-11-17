import type { HTMLAttributes, ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { ISSUE_STATUS_CONFIG, type IssueStatus } from '@/types/projects'
import { cn } from '@/utils/cn'
import { STATUS_RULE } from './issueTone'

interface IssueColumnProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  status: IssueStatus
  count: number
  /** A card is being dragged over this column. */
  over?: boolean
  /** A card is being dragged anywhere on the board. */
  dragging?: boolean
  onCreate?: () => void
  children: ReactNode
}

/**
 * A board column set like a section of a printed index: the status in the display face with its count,
 * a heavy rule beneath (volt for work in motion, rose for what is stuck), then entries separated by hairlines.
 */
export function IssueColumn({ status, count, over = false, dragging = false, onCreate, children, className, ...props }: IssueColumnProps) {
  const label = ISSUE_STATUS_CONFIG[status].label
  return (
    <section aria-label={`${label}, ${count} issues`} className={cn('flex shrink-0 flex-col', className)} {...props}>
      <header className="flex items-end justify-between gap-3 px-3 pb-3">
        <h3 className="truncate font-display text-[19px] font-bold leading-none tracking-[-0.035em] text-ink dark:text-ink-inverse">
          {label}
        </h3>
        <div className="flex shrink-0 items-end gap-1.5">
          <span className="font-display text-[19px] font-light leading-none tabular-nums tracking-[-0.03em] text-ink-muted dark:text-ink-inverse-muted">
            {count}
          </span>
          {onCreate && (
            <button type="button" onClick={onCreate} aria-label={`New ${label} issue`} title={`New ${label} issue`}
              className="-mb-1 flex h-6 w-6 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-ink/[0.05] hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-ink-inverse/[0.08] dark:hover:text-ink-inverse">
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          )}
        </div>
      </header>
      <div aria-hidden className={cn('mx-3 h-[2px] rounded-full', STATUS_RULE[status])} />
      <div className={cn(
        'flex min-h-[7rem] flex-1 flex-col gap-2.5 rounded-b-xl pt-3 transition-colors duration-200',
        over && 'bg-[rgb(var(--ren-volt)/0.05)] ring-1 ring-inset ring-[rgb(var(--ren-volt)/0.25)]',
      )}>
        {children}
        {count === 0 && (
          <p className="px-3 pt-4 font-display text-[14px] font-medium tracking-[-0.01em] text-ink-muted/80 dark:text-ink-inverse-muted/80">
            {dragging ? 'Drop it here.' : 'All clear.'}
          </p>
        )}
      </div>
    </section>
  )
}
