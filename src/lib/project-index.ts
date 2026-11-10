/**
 * The Projects index (`ron://projects`): one summary per project from the loaded issues and
 * relationships, the lifecycle filter, search and ordering. Pure functions only, so
 * `node --experimental-strip-types` can test them (src/lib/project-index.test.ts).
 *
 * The numbers mean what they mean everywhere else in Ren:
 * - blocked: status Blocked, or an unfinished "blocks" relationship points at the issue (issue-blocking.ts);
 * - overdue: not done and its due date has passed (execute-issues.ts `isOverdue`);
 * - due soon: not done and due within the next 7 days (`isDueSoon`), so overdue work is not counted twice.
 */
import { formatRelative } from './discover-feed.ts'
import { isDueSoon, isOverdue } from './execute-issues.ts'
import { blockersByIssue, blockingOf } from './issue-blocking.ts'
import type { Issue, IssueLink, IssueStatus, Project } from '../types/projects.ts'

export type LifecycleFilter = 'open' | 'completed' | 'archived' | 'all'

export const LIFECYCLE_FILTERS: ReadonlyArray<{ id: LifecycleFilter; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'completed', label: 'Completed' },
  { id: 'archived', label: 'Archived' },
  { id: 'all', label: 'All' },
]

export const LIFECYCLE_LABEL: Record<Project['lifecycle'], string> = {
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  archived: 'Archived',
}

export interface ProjectSummary {
  project: Project
  total: number
  done: number
  open: number
  inProgress: number
  blocked: number
  overdue: number
  dueSoon: number
  /** Issues per status, for the card's progress bar (sums to `total`). */
  byStatus: Record<IssueStatus, number>
  /** Done share of all issues, 0–1 (0 when the project has no issues). */
  progress: number
  /** The latest change to the project or any of its issues (epoch ms). */
  lastActivity: number
}

/** Open = active or paused: what a person is still working on. */
export function inLifecycle(project: Pick<Project, 'lifecycle'>, filter: LifecycleFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'open') return project.lifecycle === 'active' || project.lifecycle === 'paused'
  return project.lifecycle === filter
}

export function summarizeProjects(projects: Project[], issues: Issue[], links: IssueLink[], now: number): ProjectSummary[] {
  const blockers = blockersByIssue(issues, links)
  const byProject = new Map<string, Issue[]>()
  for (const issue of issues) {
    const list = byProject.get(issue.projectId)
    if (list) list.push(issue)
    else byProject.set(issue.projectId, [issue])
  }
  return projects.map((project) => {
    const own = byProject.get(project.id) ?? []
    let done = 0, inProgress = 0, blocked = 0, overdue = 0, dueSoon = 0
    let lastActivity = project.updatedAt || project.createdAt || 0
    const byStatus: Record<IssueStatus, number> = { backlog: 0, 'in-progress': 0, review: 0, blocked: 0, done: 0 }
    for (const issue of own) {
      if (issue.updatedAt > lastActivity) lastActivity = issue.updatedAt
      if (issue.status in byStatus) byStatus[issue.status] += 1
      if (issue.status === 'done') { done += 1; continue }
      if (issue.status === 'in-progress' || issue.status === 'review') inProgress += 1
      if (blockingOf(issue, blockers).blocked) blocked += 1
      if (isOverdue(issue, now)) overdue += 1
      else if (isDueSoon(issue, now)) dueSoon += 1
    }
    const total = own.length
    return { project, total, done, open: total - done, inProgress, blocked, overdue, dueSoon, byStatus, progress: total ? done / total : 0, lastActivity }
  })
}

/** Case-insensitive match on name, key or summary; every word of the query must match. */
export function matchesProjectQuery(project: Pick<Project, 'name' | 'key' | 'summary'>, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = `${project.name}\n${project.key}\n${project.summary ?? ''}`.toLowerCase()
  return words.every((word) => haystack.includes(word))
}

const LIFECYCLE_RANK: Record<Project['lifecycle'], number> = { active: 0, paused: 0, completed: 1, archived: 2 }

/** Open projects first, then completed, then archived; within each, most recently worked on first, ties by name. */
export function sortByActivity(summaries: ProjectSummary[]): ProjectSummary[] {
  return [...summaries].sort((a, b) =>
    LIFECYCLE_RANK[a.project.lifecycle] - LIFECYCLE_RANK[b.project.lifecycle]
    || b.lastActivity - a.lastActivity
    || a.project.name.localeCompare(b.project.name))
}

export function lifecycleCounts(projects: Pick<Project, 'lifecycle'>[]): Record<LifecycleFilter, number> {
  const counts: Record<LifecycleFilter, number> = { open: 0, completed: 0, archived: 0, all: projects.length }
  for (const project of projects) {
    if (inLifecycle(project, 'open')) counts.open += 1
    else if (project.lifecycle === 'completed') counts.completed += 1
    else if (project.lifecycle === 'archived') counts.archived += 1
  }
  return counts
}

/** "just now", "12 min ago", "5 h ago", "3 d ago"; a date after 30 days. */
export function updatedLabel(at: number, now: number): string {
  if (!at) return 'No activity yet'
  if (now - at > 30 * 24 * 60 * 60 * 1000) {
    const date = new Date(at)
    const sameYear = date.getFullYear() === new Date(now).getFullYear()
    return `on ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })}`
  }
  return formatRelative(at, now)
}

export function isLifecycleFilter(value: unknown): value is LifecycleFilter {
  return value === 'open' || value === 'completed' || value === 'archived' || value === 'all'
}
