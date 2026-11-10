import { useMemo } from 'react'
import { useProjectsStore } from '@/stores/projectsStore'
import type { Issue } from '@/types/projects'
import { blockedLabel, blockersByIssue, blockingOf, type Blocking } from '@/lib/issue-blocking'

export type IssueBlocking = Blocking & { label: string; keys: string[] }

/** `(issue) => blocking` from the loaded issues and relationships, for every issue view. */
export function useIssueBlocking(): (issue: Issue) => IssueBlocking {
  const { issues, issueLinks, projects } = useProjectsStore()
  return useMemo(() => {
    const map = blockersByIssue(issues, issueLinks)
    const keys = new Map(projects.map((project) => [project.id, project.key]))
    const keyFor = (issue: Issue) => `${keys.get(issue.projectId) ?? 'ISSUE'}-${issue.number}`
    return (issue: Issue) => {
      const blocking = blockingOf(issue, map)
      return { ...blocking, label: blockedLabel(blocking, keyFor), keys: blocking.blockers.map(keyFor) }
    }
  }, [issues, issueLinks, projects])
}
