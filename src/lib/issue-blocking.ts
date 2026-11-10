import type { Issue, IssueLink } from '../types/projects.ts'

/**
 * Blocking relationships as the views show them. `A blocks B` is one `issue_links` row
 * (`source_id` = A, `target_id` = B, `type` = 'blocks'). The server moves B to Blocked while A is
 * unfinished; the views mark an issue blocked when its status is Blocked or an unfinished blocker
 * still points at it (so an issue dragged out of Blocked by hand still shows what holds it).
 */
export interface Blocking {
  blocked: boolean
  /** Unfinished issues blocking this one, in relationship order. */
  blockers: Issue[]
}

const NOT_BLOCKED: Blocking = { blocked: false, blockers: [] }

/** Unfinished blockers of every issue that has one, keyed by the blocked issue's id. */
export function blockersByIssue(issues: Issue[], links: IssueLink[]): Map<string, Issue[]> {
  const byId = new Map(issues.map((issue) => [issue.id, issue]))
  const result = new Map<string, Issue[]>()
  for (const link of links) {
    if (link.type !== 'blocks') continue
    const blocker = byId.get(link.sourceId)
    if (!blocker || blocker.status === 'done') continue
    const list = result.get(link.targetId) ?? []
    if (!list.some((issue) => issue.id === blocker.id)) result.set(link.targetId, [...list, blocker])
  }
  return result
}

export function blockingOf(issue: Pick<Issue, 'id' | 'status'>, blockers: Map<string, Issue[]>): Blocking {
  const by = blockers.get(issue.id) ?? []
  if (issue.status !== 'blocked' && by.length === 0) return NOT_BLOCKED
  return { blocked: true, blockers: by }
}

/** "Blocked by CALQA-1, CALQA-4", or "Blocked" when no unfinished blocker is known. */
export function blockedLabel(blocking: Blocking, keyFor: (issue: Issue) => string): string {
  if (!blocking.blocked) return ''
  return blocking.blockers.length ? `Blocked by ${blocking.blockers.map(keyFor).join(', ')}` : 'Blocked'
}
