import { useMemo, useState, type DragEvent } from 'react'
import { useProjectsStore } from '@/stores/projectsStore'
import type { Issue, IssueStatus, Person, Project } from '@/types/projects'
import { ISSUE_STATUSES, groupByStatus, issueKey } from '@/lib/execute-issues'
import { IssueCard } from '@/components/projects/IssueCard'
import { IssueColumn } from '@/components/projects/IssueColumn'

interface ExecuteKanbanProps {
  issues: Issue[]
  projects: Project[]
  people: Person[]
  now: number
  onOpen: (issueId: string) => void
  /** Opens New Issue with this status; omitted when there is no project to put it in. */
  onCreate?: ((status: IssueStatus) => void) | undefined
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
    <div className="flex gap-6 overflow-x-auto overscroll-x-contain pb-2 pt-1 lg:gap-8" aria-label="Issues by status">
      {ISSUE_STATUSES.map((status) => {
        const items = columns[status]
        const over = overStatus === status && draggingId !== null && items.every((item) => item.id !== draggingId)
        return (
          <IssueColumn
            key={status}
            status={status}
            count={items.length}
            over={over}
            dragging={draggingId !== null}
            onCreate={onCreate ? () => onCreate(status) : undefined}
            className="w-[min(19rem,82vw)] lg:w-auto lg:min-w-[15rem] lg:flex-1"
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (overStatus !== status) setOverStatus(status) }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverStatus(null) }}
            onDrop={(event) => void handleDrop(event, status)}
          >
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
          </IssueColumn>
        )
      })}
    </div>
  )
}
