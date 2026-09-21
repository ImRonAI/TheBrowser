import {
  ISSUE_PRIORITY_CONFIG,
  ISSUE_STATUS_CONFIG,
  ISSUE_TYPE_CONFIG,
  PROJECT_TYPE_SCHEMES,
  IssuePriority,
  IssueStatus,
  IssueTypeKey,
  ProjectTypeKey,
} from '@/types/projects'
import { cn } from '@/utils/cn'

export function ProjectTypeBadge({ type, className }: { type: ProjectTypeKey; className?: string }) {
  const label = PROJECT_TYPE_SCHEMES[type]?.label || type
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider',
        'bg-surface-100 text-ink dark:bg-surface-800 dark:text-ink-inverse',
        className
      )}
    >
      {label}
    </span>
  )
}

export function IssueTypeBadge({ type, className }: { type: IssueTypeKey; className?: string }) {
  const config = ISSUE_TYPE_CONFIG[type]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide',
        config?.color,
        className
      )}
    >
      {config?.label ?? type}
    </span>
  )
}

export function IssueStatusBadge({ status, className }: { status: IssueStatus; className?: string }) {
  const config = ISSUE_STATUS_CONFIG[status]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide',
        config?.color,
        className
      )}
    >
      {config?.label ?? status}
    </span>
  )
}

export function IssuePriorityBadge({ priority, className }: { priority: IssuePriority; className?: string }) {
  const config = ISSUE_PRIORITY_CONFIG[priority]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide',
        config?.color,
        className
      )}
    >
      {config?.label ?? priority}
    </span>
  )
}
