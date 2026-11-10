import { useMemo, useState, type DragEvent } from 'react'
import { Plus } from 'lucide-react'
import { useProjectsStore } from '@/stores/projectsStore'
import { ISSUE_STATUS_CONFIG, type Issue, type IssueStatus, type Person, type Project } from '@/types/projects'
import { ISSUE_STATUSES, groupByStatus, issueKey } from '@/lib/execute-issues'
import { IssueCard } from '@/components/projects/IssueCard'
import { STATUS_FILL } from './IssueBits'
import { cn } from '@/utils/cn'

interface ExecuteKanbanProps {
  issues: Issue[]
  projects: Project[]
  people: Person[]
  now: number
  onOpen: (issueId: string) => void
  /** Opens New Issue with this status; omitted when there is no project to put it in. */
  onCreate?: (status: IssueStatus) => void
}

/**
 * One column per status. Dropping a card on a column calls the store's `moveIssueStatus`
 * (ignored while a save is pending, like the project board).
 */
export function ExecuteKanban({ issues, projects, people, onOpen, onCreate }: ExecuteKanbanProps) {
  const { moveIssueStatus, pendingSaves, issues: allIssues } = useProjectsStore()
  const columns = useMemo(() => groupByStatus(issues), [issues])
  const byId = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overStatus, setOverStatus] = useState<IssueStatus | null>(null)

  const handleDrop = async (event: DragEvent<HTMLElement>, status: IssueStatus) => {
    event.preventDefault()
    const issueId = event.dataTransfer.getData('text/plain')
    setOverStatus(null)
    setDraggingId(null)
    const issue = issues.find((item) => item.id === issueId)
    if (!issue || issue.status === status) return
    if (!pendingSaves) await moveIssueStatus(issueId, status)
  }

  return (
    <div className="flex gap-3 overflow-x-auto overscroll-x-contain pb-2" aria-label="Issues by status">
      {ISSUE_STATUSES.map((status) => {
        const items = columns[status]
        const over = overStatus === status && draggingId !== null && items.every((item) => item.id !== draggingId)
        return (
          <section
            key={status}
            aria-label={`${ISSUE_STATUS_CONFIG[status].label}, ${items.length} issues`}
            className={cn(
              'flex w-[min(18rem,80vw)] shrink-0 flex-col rounded-2xl border bg-surface-50/70 p-2.5 transition-colors lg:w-auto lg:min-w-[15rem] lg:flex-1 dark:bg-surface-850/40',
              over ? 'border-accent/60 bg-accent/5 dark:border-accent-light/50' : 'border-surface-200 dark:border-surface-800',
            )}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (overStatus !== status) setOverStatus(status) }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverStatus(null) }}
            onDrop={(event) => void handleDrop(event, status)}
          >
            <header className="flex items-center justify-between gap-2 px-1 pb-2.5 pt-0.5">
              <h3 className="flex min-w-0 items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink dark:text-ink-inverse">
                <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_FILL[status])} />
                <span className="truncate">{ISSUE_STATUS_CONFIG[status].label}</span>
                <span className="rounded-full bg-surface-200/70 px-1.5 text-[11px] font-medium tabular-nums text-ink-muted dark:bg-surface-800 dark:text-ink-inverse-muted">{items.length}</span>
              </h3>
              {onCreate && (
                <button type="button" onClick={() => onCreate(status)} aria-label={`New ${ISSUE_STATUS_CONFIG[status].label} issue`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-200/70 hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-surface-800 dark:hover:text-ink-inverse">
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </header>
            <div className="flex min-h-[5rem] flex-1 flex-col gap-3.5">
              {items.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  issueKey={issueKey(issue, byId)}
                  people={people}
                  issues={allIssues}
                  dragging={draggingId === issue.id}
                  draggable={pendingSaves === 0}
                  aria-roledescription="Draggable issue"
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/plain', issue.id)
                    event.dataTransfer.effectAllowed = 'move'
                    setDraggingId(issue.id)
                  }}
                  onDragEnd={() => { setDraggingId(null); setOverStatus(null) }}
                  onClick={() => onOpen(issue.id)}
                />
              ))}
              {items.length === 0 && (
                <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-surface-200 px-3 py-6 text-center text-[12px] text-ink-muted dark:border-surface-800 dark:text-ink-inverse-muted">
                  {draggingId ? 'Drop to move here' : 'No issues'}
                </p>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
