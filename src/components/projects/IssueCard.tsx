import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { BookOpen, Bug, CalendarDays, Check, CornerDownRight, Flag, FolderClosed, Layers, SquareCheck } from 'lucide-react'
import { ISSUE_PRIORITY_CONFIG, ISSUE_TYPE_CONFIG, RON_ASSIGNEE, type Issue, type IssuePriority, type Person } from '@/types/projects'
import { BRAND } from '@/lib/brand'
import { cn } from '@/utils/cn'
import { useIssueBlocking } from '@/hooks/useIssueBlocking'
import { BlockedTag } from './BlockedTag'
import { IssueStatusBadge } from './badges'

interface IssueCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  issue: Issue
  /** `KEY-12`, set in mono beside the type mark. */
  issueKey?: string
  /** Resolves assignee ids to names and initials. */
  people?: Person[]
  /** All loaded issues: this issue's children are its subtasks. */
  issues?: Issue[]
  /** Lists mixing statuses show the status; board columns already do. */
  showStatus?: boolean
  /** Cross-project lists name the project. */
  projectName?: string
  /** True while this card is being dragged. */
  dragging?: boolean
}

const icon = 'h-3 w-3'
const TYPE_ICON: Record<string, ReactNode> = {
  initiative: <Flag className={icon} strokeWidth={2.25} />,
  epic: <Layers className={icon} strokeWidth={2.25} />,
  story: <BookOpen className={icon} strokeWidth={2.25} />,
  task: <SquareCheck className={icon} strokeWidth={2.25} />,
  bug: <Bug className={icon} strokeWidth={2.25} />,
  subtask: <CornerDownRight className={icon} strokeWidth={2.25} />,
}

const PRIORITY_LEVEL: Record<IssuePriority, number> = { low: 1, medium: 2, high: 3, critical: 4 }
const DAY = 86_400_000

/** Plain text of a stored HTML description, for a two-line excerpt. */
function excerpt(html: string | undefined): string {
  if (!html) return ''
  return html.replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    // Markdown left in the text: list/quote/heading markers, emphasis, links; a bare URL reads as its host.
    .replace(/(^|\s)(?:[-*+]|\d+\.|>|#{1,6})\s+/g, '$1').replace(/[*_`]{1,3}([^*_`]+)[*_`]{1,3}/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s*\(https?:\/\/[^)\s]*\)/g, '')
    .replace(/https?:\/\/(?:www\.)?([^/\s)]+)[^\s)]*/g, '$1')
    .replace(/\s+/g, ' ').trim()
}

function PriorityBars({ priority }: { priority: IssuePriority }) {
  const level = PRIORITY_LEVEL[priority] ?? 2
  const label = `${ISSUE_PRIORITY_CONFIG[priority]?.label ?? priority} priority`
  return (
    <span className="flex h-3 shrink-0 items-end gap-[2px]" title={label} aria-label={label} role="img">
      {[5, 8, 11].map((height, index) => (
        <span key={height} style={{ height }} className={cn('w-[3px] rounded-[1px]',
          index >= Math.min(level, 3) ? 'bg-surface-200 dark:bg-surface-700'
            : level >= 4 ? 'bg-danger'
              : level === 3 ? 'bg-blurple-600 dark:bg-blurple-400'
                : 'bg-surface-500 dark:bg-surface-400')} />
      ))}
    </span>
  )
}

type Due = { label: string; title: string; tone: 'overdue' | 'soon' | 'plain' }

function dueOf(dueDate: string | undefined, done: boolean): Due | null {
  const due = dueDate ? Date.parse(dueDate) : NaN
  if (!Number.isFinite(due)) return null
  const days = Math.round((new Date(due).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / DAY)
  const date = new Date(due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (done) return { label: date, title: `Was due ${date}`, tone: 'plain' }
  if (days < 0) return { label: date, title: `Overdue by ${-days} day${days === -1 ? '' : 's'}`, tone: 'overdue' }
  if (days === 0) return { label: 'Today', title: `Due today, ${date}`, tone: 'soon' }
  if (days === 1) return { label: 'Tomorrow', title: `Due tomorrow, ${date}`, tone: 'soon' }
  if (days === 2) return { label: date, title: 'Due in 2 days', tone: 'soon' }
  return { label: date, title: `Due ${date}`, tone: 'plain' }
}

const DUE_TONE: Record<Due['tone'], string> = {
  overdue: 'rounded-full bg-red-50 px-2 py-0.5 text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900',
  soon: 'rounded-full bg-amber-50 px-2 py-0.5 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900',
  plain: 'text-ink-muted dark:text-ink-inverse-muted',
}

/** People read the agent assignee by the product's name; everyone else by their own. */
const displayName = (person: Person) => person.id === RON_ASSIGNEE.id ? `${BRAND.name} (agent)` : person.name

/** The issue card: a hairline card on the surface scale. The title carries it; the border answers hover. */
export function IssueCard({ issue, issueKey, people = [], issues = [], showStatus = false, projectName, dragging = false, className, ...props }: IssueCardProps) {
  const done = issue.status === 'done'
  const blocking = useIssueBlocking()(issue)
  const typeLabel = ISSUE_TYPE_CONFIG[issue.type]?.label ?? issue.type
  const children = issues.filter((child) => child.parentId === issue.id)
  const childrenDone = children.filter((child) => child.status === 'done').length
  const due = dueOf(issue.dueDate, done)
  const summary = excerpt(issue.description)
  const assignees = issue.assignees
    .map((id) => people.find((person) => person.id === id) ?? (id === RON_ASSIGNEE.id ? RON_ASSIGNEE : null))
    .filter((person): person is Person => !!person)
  const labels = issue.labels.filter(Boolean)
  const hasFooter = !!due || children.length > 0 || labels.length > 0 || assignees.length > 0 || !!projectName

  return (
    <button
      type="button"
      className={cn(
        'group relative block w-full overflow-hidden rounded-xl text-left',
        'border border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-900',
        'transition-[transform,border-color] duration-200 ease-out motion-reduce:transition-none',
        'hover:-translate-y-px hover:border-surface-300 dark:hover:border-surface-700',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple-600/70 dark:focus-visible:ring-blurple-400/70',
        blocking.blocked && 'border-rose-300 hover:border-rose-400 dark:border-rose-400/30 dark:hover:border-rose-400/50',
        dragging && 'opacity-40',
        className
      )}
      {...props}
    >
      <div className="px-3.5 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <span title={typeLabel} aria-label={typeLabel} role="img" className={cn(
            'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]',
            issue.type === 'bug' ? 'bg-rose-500/10 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300'
              : 'bg-surface-100 text-ink-secondary dark:bg-surface-800 dark:text-ink-inverse-secondary'
          )}>
            {TYPE_ICON[issue.type] ?? TYPE_ICON.task}
          </span>
          {issueKey && <span className="truncate font-mono text-[10.5px] tabular-nums tracking-[0.04em] text-ink-muted dark:text-ink-inverse-muted">{issueKey}</span>}
          {done && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} aria-label="Done" />}
          <span className="ml-auto flex shrink-0 items-center gap-2.5">
            {showStatus && <IssueStatusBadge status={issue.status} className="gap-1 px-2 py-0.5 text-[10.5px]" />}
            <PriorityBars priority={issue.priority} />
          </span>
        </div>

        <p className={cn(
          'mt-2 text-[13.5px] font-medium leading-[1.4] tracking-[-0.005em] line-clamp-3',
          done ? 'text-ink-muted dark:text-ink-inverse-muted' : 'text-ink dark:text-ink-inverse'
        )}>
          {issue.title}
        </p>
        {blocking.blocked && <BlockedTag label={blocking.label} keys={blocking.keys} showKeys className="mt-2" />}
        {summary && (
          <p className="mt-1 text-[12.5px] leading-[1.5] text-ink-muted line-clamp-2 dark:text-ink-inverse-muted">{summary}</p>
        )}

        {hasFooter && (
          <div className="mt-3 flex items-center gap-3 border-t border-surface-100 pt-2.5 dark:border-surface-800">
            <div className="flex min-w-0 flex-1 items-center gap-2.5 text-[11.5px]">
              {due && (
                <span className={cn('flex shrink-0 items-center gap-1 font-medium tabular-nums', DUE_TONE[due.tone])} title={due.title}>
                  <CalendarDays className="h-3 w-3" strokeWidth={2} />
                  {due.label}
                </span>
              )}
              {children.length > 0 && (
                <span className="flex shrink-0 items-center gap-1.5 font-mono tabular-nums text-ink-muted dark:text-ink-inverse-muted"
                  title={`${childrenDone} of ${children.length} child issues done`}>
                  <span className="relative h-1 w-7 overflow-hidden rounded-full bg-surface-200 dark:bg-surface-800">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-blurple-600 dark:bg-blurple-400"
                      style={{ width: `${Math.round((childrenDone / children.length) * 100)}%` }} />
                  </span>
                  {childrenDone}/{children.length}
                </span>
              )}
              {labels.slice(0, 2).map((label) => (
                <span key={label} className="min-w-0 truncate rounded-md px-1.5 py-px text-[10.5px] text-ink-secondary ring-1 ring-inset ring-surface-200 dark:text-ink-inverse-secondary dark:ring-surface-700">
                  {label}
                </span>
              ))}
              {labels.length > 2 && <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">+{labels.length - 2}</span>}
              {projectName && (
                <span className="flex min-w-0 items-center gap-1 text-ink-muted dark:text-ink-inverse-muted" title={projectName}>
                  <FolderClosed className="h-3 w-3 shrink-0" strokeWidth={2} />
                  <span className="truncate">{projectName}</span>
                </span>
              )}
            </div>
            {assignees.length > 0 && (
              <div className="flex shrink-0 -space-x-0.5" aria-label={`Assigned to ${assignees.map(displayName).join(', ')}`}>
                {assignees.slice(0, 3).map((person) => person.avatar
                  ? <img key={person.id} src={person.avatar} alt="" title={displayName(person)}
                      className="h-[22px] w-[22px] rounded-full object-cover ring-2 ring-surface-0 dark:ring-surface-900" />
                  : <span key={person.id} title={displayName(person)}
                      className={cn('flex h-[22px] w-[22px] items-center justify-center rounded-full text-[9px] font-semibold tracking-wide ring-2 ring-surface-0 dark:ring-surface-900',
                        person.id === RON_ASSIGNEE.id ? 'bg-blurple-600 text-white dark:bg-blurple-400 dark:text-ink' : 'bg-ink text-white dark:bg-ink-inverse dark:text-ink')}>
                      {person.initials || person.name.slice(0, 1).toUpperCase()}
                    </span>)}
                {assignees.length > 3 && (
                  <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-surface-200 font-mono text-[9px] font-semibold tabular-nums text-ink-secondary ring-2 ring-surface-0 dark:bg-surface-800 dark:text-ink-inverse-secondary dark:ring-surface-900">
                    +{assignees.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </button>
  )
}
