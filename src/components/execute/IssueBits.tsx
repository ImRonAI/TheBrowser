import type { Issue, IssueStatus, Person } from '@/types/projects'
import { isOverdue, personFor } from '@/lib/execute-issues'
import { cn } from '@/utils/cn'

/** Status colours shared with the issue calendar's dots. */
export const STATUS_FILL: Record<IssueStatus, string> = {
  backlog: 'bg-surface-400',
  'in-progress': 'bg-accent dark:bg-accent-light',
  review: 'bg-info',
  blocked: 'bg-danger',
  done: 'bg-success',
}

export const SURFACE = 'rounded-2xl border border-surface-200 bg-surface-0 shadow-soft dark:border-surface-800 dark:bg-surface-900'

/** Short local date; the year only when it is not the current one. */
export function shortDate(value: string | number, now: number): string {
  const date = new Date(value)
  return date.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}),
  })
}

export function DueLabel({ issue, now, className }: { issue: Pick<Issue, 'dueDate' | 'status'>; now: number; className?: string }) {
  if (!issue.dueDate) return <span className={cn('text-ink-muted dark:text-ink-inverse-muted', className)}>No due date</span>
  const overdue = isOverdue(issue, now)
  return (
    <time dateTime={issue.dueDate} title={new Date(issue.dueDate).toLocaleString()}
      className={cn('tabular-nums', overdue ? 'font-semibold text-danger' : 'text-ink-secondary dark:text-ink-inverse-secondary', className)}>
      {overdue ? 'Overdue · ' : 'Due '}{shortDate(issue.dueDate, now)}
    </time>
  )
}

export function AssigneeStack({ ids, people, max = 3, showEmpty = false }: { ids: string[]; people: Person[]; max?: number; showEmpty?: boolean }) {
  if (!ids.length) return showEmpty ? <span className="text-ink-muted dark:text-ink-inverse-muted">Unassigned</span> : null
  const shown = ids.slice(0, max).map((id) => personFor(id, people))
  const names = ids.map((id) => personFor(id, people).name).join(', ')
  return (
    <span className="flex shrink-0 -space-x-1.5" title={names} aria-label={`Assigned to ${names}`}>
      {shown.map((person) => (
        <span key={person.id} aria-hidden
          className={cn('flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface-0 text-[9px] font-bold dark:border-surface-900',
            person.known ? 'bg-ink text-surface-0 dark:bg-ink-inverse dark:text-surface-900' : 'bg-surface-200 text-ink-muted dark:bg-surface-700 dark:text-ink-inverse-muted')}>
          {person.initials}
        </span>
      ))}
      {ids.length > max && (
        <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface-0 bg-surface-100 text-[9px] font-semibold text-ink-muted dark:border-surface-900 dark:bg-surface-800">
          +{ids.length - max}
        </span>
      )}
    </span>
  )
}
