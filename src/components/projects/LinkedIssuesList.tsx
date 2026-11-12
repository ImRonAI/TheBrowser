import { useId, useMemo } from 'react'
import { useProjectsStore } from '@/stores/projectsStore'
import { useIssueBlocking } from '@/hooks/useIssueBlocking'
import { issueKey } from '@/lib/execute-issues'
import { issueDefinitions } from '@/lib/project-issue-utils'
import { isActiveBlock, relationGroups } from '@/lib/issue-relationships'
import { ISSUE_STATUS_CONFIG, ISSUE_TYPE_CONFIG, type Issue } from '@/types/projects'
import { cn } from '@/lib/utils'
import { BlockedTag } from './BlockedTag'
import { StatusIcon, TypeChip } from './IssueProperties'
import { RelationIcon } from './IssueRelationshipsField'

const MUTED = 'text-ink-muted dark:text-ink-inverse-muted'

/**
 * The issue's relationships other than its children, read-only below Child issues: the same groups as the
 * sidebar's Relationships field (where they are added and removed). A row opens the other issue. Renders
 * nothing when the issue has none.
 */
export function LinkedIssuesList({ issue, disabled, onOpen }: {
  issue: Issue
  disabled?: boolean
  /** Opens a related issue in this workspace (the workspace saves the draft first). */
  onOpen: (issueId: string) => void
}) {
  const { issues, projects, issueLinks } = useProjectsStore()
  const blockingOf = useIssueBlocking()
  const id = useId()
  const groups = useMemo(() => relationGroups(issue.id, issueLinks, issues), [issue.id, issueLinks, issues])
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const count = groups.reduce((total, group) => total + group.relations.length, 0)
  if (!count) return null
  const typeLabel = (item: Issue) => {
    const project = projectsById.get(item.projectId)
    return (project && issueDefinitions(project).find((definition) => definition.key === item.type)?.label) || ISSUE_TYPE_CONFIG[item.type]?.label || item.type
  }

  return <section aria-labelledby={`${id}-title`} className="space-y-3">
    <div className="flex items-baseline gap-2">
      <h3 id={`${id}-title`} className="font-display text-lg font-bold leading-tight tracking-tight text-ink dark:text-ink-inverse">Related issues</h3>
      <span className={cn('font-mono text-[11px] tabular-nums', MUTED)}>{count}</span>
    </div>
    <div className="space-y-4">
      {groups.map((group) => {
        const held = group.kind === 'blocked-by' && group.relations.some((relation) => isActiveBlock(relation, issue))
        return <div key={group.kind} className="space-y-1.5">
          <h4 id={`${id}-${group.kind}`} className={cn('flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em]',
            held ? 'text-rose-700 dark:text-rose-300' : MUTED)}>
            <RelationIcon kind={group.kind} className="size-3" />{group.label}<span className="tabular-nums">{group.relations.length}</span>
          </h4>
          <ul aria-labelledby={`${id}-${group.kind}`} className="divide-y divide-surface-200 overflow-hidden rounded-xl border border-surface-200 dark:divide-surface-800 dark:border-surface-800">
            {group.relations.map(({ link, other }) => {
              if (!other) return <li key={link.id} className={cn('px-3 py-2.5 text-[13px]', MUTED)}>Issue not available: deleted, or not shared with you</li>
              const key = issueKey(other, projectsById)
              const elsewhere = other.projectId !== issue.projectId ? projectsById.get(other.projectId) : undefined
              const blocking = blockingOf(other)
              return <li key={link.id}>
                <button type="button" disabled={disabled} onClick={() => onOpen(other.id)} title={`Open ${key}${elsewhere ? ` in ${elsewhere.name}` : ''}`}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-[13px] transition-colors duration-150 hover:bg-surface-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blurple-600/70 disabled:opacity-60 dark:hover:bg-surface-850 dark:focus-visible:ring-blurple-400/70">
                  <StatusIcon status={other.status} />
                  <span className={cn('shrink-0 font-mono text-[11.5px] tabular-nums', MUTED)}>{key}</span>
                  <span className="min-w-0 flex-1 truncate text-ink dark:text-ink-inverse">{other.title || 'Untitled issue'}</span>
                  <span className="sr-only">, {ISSUE_STATUS_CONFIG[other.status]?.label ?? other.status}</span>
                  {elsewhere && <span className={cn('max-w-[10rem] shrink-0 truncate text-[12px]', MUTED)}>{elsewhere.name}</span>}
                  {blocking.blocked && <BlockedTag label={blocking.label} className="shrink-0" />}
                  <TypeChip type={other.type} label={typeLabel(other)} />
                </button>
              </li>
            })}
          </ul>
        </div>
      })}
    </div>
  </section>
}
