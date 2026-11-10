import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { Issue, Person, Project } from '@/types/projects'
import { SORT_LABELS, issueKey, sortIssues, type SortKey, type SortState } from '@/lib/execute-issues'
import { IssuePriorityBadge, IssueStatusBadge, IssueTypeBadge } from '@/components/projects/badges'
import { IssueCard } from '@/components/projects/IssueCard'
import { BlockedTag } from '@/components/projects/BlockedTag'
import { useIssueBlocking } from '@/hooks/useIssueBlocking'
import { useProjectsStore } from '@/stores/projectsStore'
import { AssigneeStack, DueLabel, SURFACE } from './IssueBits'
import { cn } from '@/utils/cn'

interface ExecuteListProps {
  issues: Issue[]
  projects: Project[]
  people: Person[]
  now: number
  onOpen: (issueId: string) => void
}

const COLUMNS: { key: SortKey; className?: string }[] = [
  { key: 'key', className: 'w-28' },
  { key: 'title' },
  { key: 'project', className: 'w-44' },
  { key: 'status', className: 'w-32' },
  { key: 'priority', className: 'w-28' },
  { key: 'assignee', className: 'w-28' },
  { key: 'due', className: 'w-40' },
]
const BADGE = 'px-2 py-0.5 text-[10px]'

/** Sortable table from lg up; stacked cards (with their own sort control) below. */
export function ExecuteList({ issues, projects, people, now, onOpen }: ExecuteListProps) {
  const [sort, setSort] = useState<SortState>({ key: 'due', direction: 'asc' })
  const { issues: allIssues } = useProjectsStore()
  const blockingFor = useIssueBlocking()
  const byId = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const sorted = useMemo(() => sortIssues(issues, sort, { projects, people }), [issues, sort, projects, people])
  const toggle = (key: SortKey) => setSort((current) => current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' })

  return (
    <section aria-label="Issue list" className="min-w-0">
      {/* Small screens: sort control + stacked cards. */}
      <div className="lg:hidden">
        <div className="mb-3 flex items-center gap-2">
          <label htmlFor="execute-sort" className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">Sort</label>
          <select id="execute-sort" value={sort.key} onChange={(event) => setSort({ key: event.target.value as SortKey, direction: 'asc' })}
            className="h-9 min-w-0 flex-1 rounded-lg border border-surface-200 bg-surface-0 px-2 text-body-sm text-ink dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse">
            {COLUMNS.map((column) => <option key={column.key} value={column.key}>{SORT_LABELS[column.key]}</option>)}
          </select>
          <button type="button" onClick={() => toggle(sort.key)} aria-label={sort.direction === 'asc' ? 'Ascending; switch to descending' : 'Descending; switch to ascending'}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-surface-200 text-ink-secondary dark:border-surface-800 dark:text-ink-inverse-secondary">
            {sort.direction === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
          </button>
        </div>
        <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {sorted.map((issue) => (
            <li key={issue.id} className="min-w-0">
              <IssueCard issue={issue} issueKey={issueKey(issue, byId)} projectName={byId.get(issue.projectId)?.name} people={people}
                issues={allIssues} showStatus onClick={() => onOpen(issue.id)} />
            </li>
          ))}
        </ul>
      </div>

      {/* lg and up: the table. */}
      <div className={cn(SURFACE, 'hidden overflow-x-auto lg:block')}>
        <table className="w-full min-w-[56rem] table-fixed text-left text-body-sm">
          <thead>
            <tr className="border-b border-surface-200 bg-surface-50/60 text-ink-muted dark:border-surface-800 dark:bg-surface-850/50 dark:text-ink-inverse-muted">
              {COLUMNS.map((column) => {
                const active = sort.key === column.key
                return (
                  <th key={column.key} scope="col" className={cn('px-4 py-2.5 font-medium', column.className)}
                    aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" onClick={() => toggle(column.key)}
                      className={cn('inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider hover:text-ink dark:hover:text-ink-inverse', active && 'text-ink dark:text-ink-inverse')}>
                      {SORT_LABELS[column.key]}
                      {active ? (sort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((issue) => (
              <tr key={issue.id} onClick={() => onOpen(issue.id)}
                className="cursor-pointer border-b border-surface-200 transition-colors last:border-b-0 hover:bg-surface-50 dark:border-surface-800 dark:hover:bg-surface-850/60">
                <td className="px-4 py-2.5 font-mono text-[12px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">{issueKey(issue, byId)}</td>
                <td className="px-4 py-2.5">
                  <button type="button" className="flex min-w-0 max-w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded">
                    <IssueTypeBadge type={issue.type} className={cn(BADGE, 'shrink-0')} />
                    <span className="truncate font-medium text-ink dark:text-ink-inverse">{issue.title}</span>
                    {(() => { const blocking = blockingFor(issue); return blocking.blocked && <BlockedTag label={blocking.label} className="shrink-0" /> })()}
                  </button>
                </td>
                <td className="truncate px-4 py-2.5 text-ink-secondary dark:text-ink-inverse-secondary" title={byId.get(issue.projectId)?.name}>{byId.get(issue.projectId)?.name ?? '—'}</td>
                <td className="px-4 py-2.5"><IssueStatusBadge status={issue.status} className={BADGE} /></td>
                <td className="px-4 py-2.5"><IssuePriorityBadge priority={issue.priority} className={BADGE} /></td>
                <td className="px-4 py-2.5 text-[12px]"><AssigneeStack ids={issue.assignees} people={people} showEmpty /></td>
                <td className="px-4 py-2.5 text-[12px]"><DueLabel issue={issue} now={now} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
