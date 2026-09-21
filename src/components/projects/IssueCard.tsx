import { Issue } from '@/types/projects'
import { IssuePriorityBadge, IssueStatusBadge, IssueTypeBadge } from './badges'
import { cn } from '@/utils/cn'

interface IssueCardProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  issue: Issue
  compact?: boolean
}

export function IssueCard({ issue, compact = false, className, ...props }: IssueCardProps) {
  return (
    <button
      className={cn(
        'w-full text-left rounded-2xl p-4 transition relative overflow-hidden',
        'glass-card border border-white/15 dark:border-white/10',
        'hover:border-accent/30 dark:hover:border-accent-light/30 hover:shadow-soft',
        compact && 'p-3',
        className
      )}
      {...props}
    >
      <div className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-500 bg-gradient-to-tr from-accent/5 via-transparent to-accent-light/5 pointer-events-none" />
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <IssueTypeBadge type={issue.type} />
          <IssueStatusBadge status={issue.status} />
          <IssuePriorityBadge priority={issue.priority} />
        </div>
        {issue.dueDate && (
          <span className="text-[11px] uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
            Due {new Date(issue.dueDate).toLocaleDateString()}
          </span>
        )}
      </div>
      <div className="mt-3">
        <h4 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">
          {issue.title}
        </h4>
        {issue.description && !compact && (
          <p className="mt-2 text-body-xs text-ink-secondary dark:text-ink-inverse-secondary line-clamp-2">
            {issue.description}
          </p>
        )}
      </div>
    </button>
  )
}
