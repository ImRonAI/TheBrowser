import {
  BriefcaseBusiness,
  CodeXml,
  Database,
  FlaskConical,
  GraduationCap,
  Lightbulb,
  Rocket,
  Target,
  type LucideIcon,
} from 'lucide-react'
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

const NEUTRAL = 'bg-surface-100 text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary'
const VOLT_TINT = 'bg-blurple-50 text-blurple-700 dark:bg-blurple-400/15 dark:text-blurple-300'
const OUTLINE = 'ring-1 ring-inset ring-surface-200 text-ink-secondary dark:ring-surface-700 dark:text-ink-inverse-secondary'

/** Issue kinds: containers in volt, work items neutral, bugs in rose, subtasks as an outline. */
const TYPE_TONE: Partial<Record<string, string>> = {
  initiative: VOLT_TINT,
  epic: VOLT_TINT,
  story: NEUTRAL,
  task: NEUTRAL,
  bug: 'bg-rose-500/10 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300',
  subtask: OUTLINE,
}

/** Status dots match the board, calendar and timelines: backlog gray, in progress volt, review info, blocked rose, done green. */
const STATUS_DOT: Record<IssueStatus, string> = {
  backlog: 'bg-surface-400',
  'in-progress': 'bg-blurple-600 dark:bg-blurple-400',
  review: 'bg-info',
  blocked: 'bg-rose-500 dark:bg-rose-400',
  done: 'bg-success',
}

const PRIORITY_TONE: Record<IssuePriority, string> = {
  critical: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  high: VOLT_TINT,
  medium: NEUTRAL,
  low: OUTLINE,
}

/** One icon per project type: the type picker, project cards and list rows. */
export const PROJECT_TYPE_ICONS: Record<ProjectTypeKey, LucideIcon> = {
  'software-development': CodeXml,
  'work-operations': BriefcaseBusiness,
  founder: Rocket,
  academic: GraduationCap,
  research: FlaskConical,
  'data-accrual': Database,
  'personal-goals': Target,
  'product-discovery': Lightbulb,
}

export function ProjectTypeIcon({ type, className }: { type: ProjectTypeKey; className?: string }) {
  const Icon = PROJECT_TYPE_ICONS[type] ?? BriefcaseBusiness
  return <Icon aria-hidden className={className} />
}

export function ProjectTypeBadge({ type, className }: { type: ProjectTypeKey; className?: string }) {
  const label = PROJECT_TYPE_SCHEMES[type]?.label || type
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase leading-none tracking-[0.08em]',
        NEUTRAL,
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
        'inline-flex items-center rounded-md px-1.5 py-1 font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.06em]',
        TYPE_TONE[type] ?? NEUTRAL,
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
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium leading-none',
        NEUTRAL,
        className
      )}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[status] ?? 'bg-surface-400')} />
      {config?.label ?? status}
    </span>
  )
}

export function IssuePriorityBadge({ priority, className }: { priority: IssuePriority; className?: string }) {
  const config = ISSUE_PRIORITY_CONFIG[priority]
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium leading-none',
        PRIORITY_TONE[priority] ?? NEUTRAL,
        className
      )}
    >
      {config?.label ?? priority}
    </span>
  )
}
