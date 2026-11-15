import type { ButtonHTMLAttributes } from 'react'
import { ISSUE_PRIORITY_CONFIG, ISSUE_STATUS_CONFIG, ISSUE_TYPE_CONFIG, RON_ASSIGNEE, type Issue, type IssuePriority, type Person } from '@/types/projects'
import { BRAND } from '@/lib/brand'
import { cn } from '@/utils/cn'
import { useIssueBlocking } from '@/hooks/useIssueBlocking'
import { STATUS_MARK } from './issueTone'

interface IssueCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  issue: Issue
  /** `KEY-12`, set in mono at the head of the dateline. */
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

const DAY = 86_400_000

/** Plain text of a stored HTML description, for a one-line standfirst. */
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
  overdue: 'text-rose-600 dark:text-rose-400',
  soon: 'text-ink dark:text-ink-inverse',
  plain: 'text-ink-muted dark:text-ink-inverse-muted',
}

/** Only high and critical earn a word; low and medium stay silent. */
const PRIORITY_WORD: Partial<Record<IssuePriority, { label: string; className: string }>> = {
  high: { label: 'High priority', className: 'text-ink dark:text-ink-inverse' },
  critical: { label: 'Critical', className: 'text-rose-600 dark:text-rose-400' },
}

/** People read the agent assignee by the product's name; everyone else by their own. */
const displayName = (person: Person) => person.id === RON_ASSIGNEE.id ? `${BRAND.name} (agent)` : person.name

/**
 * The issue entry, set like an index line rather than a boxed card: a mono dateline, the title in the display
 * face, one quiet standfirst and a footnote of facts. Entries are separated by hairlines; the title answers hover.
 */
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
  const priority = PRIORITY_WORD[issue.priority]
  const hasFootnote = children.length > 0 || labels.length > 0 || !!projectName || !!priority || assignees.length > 0

  return (
    <button
      type="button"
      className={cn(
        'group relative block w-full text-left',
        'border-b border-ink/[0.08] px-3 pb-4 pt-3.5 dark:border-ink-inverse/[0.08]',
        'transition-colors duration-200 ease-out hover:bg-ink/[0.018] dark:hover:bg-ink-inverse/[0.025]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--ren-volt)/0.6)]',
        dragging && 'opacity-35',
        className
      )}
      {...props}
    >
      {blocking.blocked && <span aria-hidden className="absolute bottom-4 left-0 top-4 w-[2px] rounded-full bg-rose-500 dark:bg-rose-400" />}

      {/* Dateline */}
      <div className="flex items-baseline gap-2.5 text-[11px] leading-none">
        {issueKey && (
          <span className="font-mono text-[10.5px] font-medium tabular-nums tracking-[0.04em] text-ink-secondary transition-colors group-hover:text-volt dark:text-ink-inverse-secondary">
            {issueKey}
          </span>
        )}
        <span className="text-ink-muted dark:text-ink-inverse-muted">{typeLabel}</span>
        {showStatus && (
          <span className="flex items-center gap-1.5 text-ink-muted dark:text-ink-inverse-muted">
            <span aria-hidden className={cn('h-[5px] w-[5px] translate-y-[-1px] rounded-full', STATUS_MARK[issue.status])} />
            {ISSUE_STATUS_CONFIG[issue.status]?.label ?? issue.status}
          </span>
        )}
        {due && (
          <time dateTime={issue.dueDate} title={due.title}
            className={cn('ml-auto shrink-0 tabular-nums', due.tone !== 'plain' && 'font-medium', DUE_TONE[due.tone])}>
            {due.tone === 'overdue' ? `Overdue, ${due.label}` : due.label}
          </time>
        )}
      </div>

      {/* Headline */}
      <h4 className={cn(
        'mt-2.5 font-display text-[16px] font-semibold leading-[1.24] tracking-[-0.022em] [text-wrap:pretty] line-clamp-3',
        done ? 'text-ink-muted dark:text-ink-inverse-muted' : 'text-ink dark:text-ink-inverse'
      )}>
        {issue.title}
      </h4>

      {/* Standfirst, or what it is waiting on */}
      {blocking.blocked ? (
        <p title={blocking.label} className="mt-1.5 truncate text-[12.5px] text-rose-700 dark:text-rose-300">
          {blocking.keys.length
            ? <>Waiting on <span className="font-mono text-[11.5px] font-medium tracking-[0.02em]">{blocking.keys.join(', ')}</span></>
            : blocking.label || 'Blocked'}
        </p>
      ) : summary ? (
        <p className="mt-1.5 truncate text-[12.5px] leading-[1.5] text-ink-muted dark:text-ink-inverse-muted">{summary}</p>
      ) : null}

      {/* Footnote */}
      {hasFootnote && (
        <div className="mt-3.5 flex items-center gap-4 text-[11.5px] text-ink-muted dark:text-ink-inverse-muted">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            {priority && <span className={cn('shrink-0 font-medium', priority.className)} title={ISSUE_PRIORITY_CONFIG[issue.priority]?.label}>{priority.label}</span>}
            {children.length > 0 && (
              <span className="flex shrink-0 items-center gap-2 tabular-nums" title={`${childrenDone} of ${children.length} child issues done`}>
                <span className="relative h-[2px] w-8 overflow-hidden rounded-full bg-ink/10 dark:bg-ink-inverse/15">
                  <span className={cn('absolute inset-y-0 left-0 rounded-full', childrenDone === children.length ? 'bg-ink/60 dark:bg-ink-inverse/60' : 'bg-volt')}
                    style={{ width: `${Math.round((childrenDone / children.length) * 100)}%` }} />
                </span>
                {childrenDone} of {children.length}
              </span>
            )}
            {labels.length > 0 && (
              <span className="min-w-0 truncate" title={labels.join(', ')}>
                {labels.slice(0, 2).join(', ')}{labels.length > 2 ? `, +${labels.length - 2}` : ''}
              </span>
            )}
            {projectName && <span className="min-w-0 truncate" title={projectName}>{projectName}</span>}
          </div>
          {assignees.length > 0 && (
            <div className="flex shrink-0 -space-x-1" aria-label={`Assigned to ${assignees.map(displayName).join(', ')}`}>
              {assignees.slice(0, 3).map((person) => person.avatar
                ? <img key={person.id} src={person.avatar} alt="" title={displayName(person)}
                    className="h-5 w-5 rounded-full object-cover ring-2 ring-surface-0 dark:ring-surface-900" />
                : <span key={person.id} title={displayName(person)}
                    className={cn('flex h-5 w-5 items-center justify-center rounded-full font-display text-[9px] font-bold ring-2 ring-surface-0 dark:ring-surface-900',
                      person.id === RON_ASSIGNEE.id ? 'bg-volt text-white dark:text-ink' : 'bg-ink/[0.07] text-ink-secondary dark:bg-ink-inverse/[0.12] dark:text-ink-inverse-secondary')}>
                    {person.initials || person.name.slice(0, 1).toUpperCase()}
                  </span>)}
              {assignees.length > 3 && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink/[0.05] text-[8.5px] font-semibold tabular-nums text-ink-muted ring-2 ring-surface-0 dark:bg-ink-inverse/[0.08] dark:text-ink-inverse-muted dark:ring-surface-900">
                  +{assignees.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </button>
  )
}
