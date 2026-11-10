/**
 * Execute (`ron://execute`): the cross-project operational hub over the user's canonical issues
 * (`useProjectsStore`). Pure functions only, so `node --experimental-strip-types` can test them.
 */
import { addDays, startOfDay, startOfWeek } from './calendar.ts'
import { stripMarkup } from './discover-feed.ts'
import {
  ISSUE_PRIORITY_CONFIG, ISSUE_STATUS_CONFIG, ISSUE_TYPE_CONFIG, PROJECT_TYPE_SCHEMES,
  type Issue, type IssuePriority, type IssueStatus, type Person, type Project,
} from '../types/projects.ts'

const DAY_MS = 24 * 60 * 60 * 1000

export const ISSUE_STATUSES = Object.keys(ISSUE_STATUS_CONFIG) as IssueStatus[]
export const ISSUE_PRIORITIES = Object.keys(ISSUE_PRIORITY_CONFIG) as IssuePriority[]

export type DueFilter = 'all' | 'overdue' | 'next7' | 'none'
export interface ExecuteFilters {
  /** `all` = every project that is not archived; an archived project shows only when picked. */
  projectId: string
  status: IssueStatus | 'all'
  priority: IssuePriority | 'all'
  type: string
  /** `all`, `me` (the projects store `userId`), `unassigned`, or a person id. */
  assignee: string
  due: DueFilter
  query: string
}
export const DEFAULT_FILTERS: ExecuteFilters = { projectId: 'all', status: 'all', priority: 'all', type: 'all', assignee: 'all', due: 'all', query: '' }

export interface Option { value: string; label: string }

const projectMap = (projects: Project[]) => new Map(projects.map((project) => [project.id, project]))

/** `<projectKey>-<number>`, the same key the issue calendar shows. */
export function issueKey(issue: Pick<Issue, 'projectId' | 'number'>, projects: Project[] | Map<string, Project>): string {
  const byId = projects instanceof Map ? projects : projectMap(projects)
  return `${byId.get(issue.projectId)?.key ?? 'ISSUE'}-${issue.number}`
}

const time = (value?: string) => {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** Past its due time and not done. A done issue is never overdue. */
export function isOverdue(issue: Pick<Issue, 'dueDate' | 'status'>, now: number): boolean {
  const due = time(issue.dueDate)
  return due !== null && due < now && issue.status !== 'done'
}

/** Due between now and seven days from now. */
export function isDueSoon(issue: Pick<Issue, 'dueDate'>, now: number): boolean {
  const due = time(issue.dueDate)
  return due !== null && due >= now && due <= now + 7 * DAY_MS
}

export function activeFilterCount(filters: ExecuteFilters): number {
  return (['projectId', 'status', 'priority', 'type', 'assignee', 'due'] as const).filter((key) => filters[key] !== 'all').length
}

/** Search matches the title, the `KEY-number` and the description text (stored as HTML). */
export function matchesQuery(issue: Issue, key: string, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return issue.title.toLowerCase().includes(needle) || key.toLowerCase().includes(needle) ||
    stripMarkup(issue.description ?? '').toLowerCase().includes(needle)
}

export function filterIssues(issues: Issue[], projects: Project[], filters: ExecuteFilters, context: { userId: string | null; now: number }): Issue[] {
  const byId = projectMap(projects)
  return issues.filter((issue) => {
    const project = byId.get(issue.projectId)
    if (filters.projectId === 'all') { if (project?.lifecycle === 'archived') return false }
    else if (issue.projectId !== filters.projectId) return false
    if (filters.status !== 'all' && issue.status !== filters.status) return false
    if (filters.priority !== 'all' && issue.priority !== filters.priority) return false
    if (filters.type !== 'all' && issue.type !== filters.type) return false
    if (filters.assignee === 'me' && !(context.userId && issue.assignees.includes(context.userId))) return false
    if (filters.assignee === 'unassigned' && issue.assignees.length > 0) return false
    if (!['all', 'me', 'unassigned'].includes(filters.assignee) && !issue.assignees.includes(filters.assignee)) return false
    if (filters.due === 'overdue' && !isOverdue(issue, context.now)) return false
    if (filters.due === 'next7' && !isDueSoon(issue, context.now)) return false
    if (filters.due === 'none' && issue.dueDate) return false
    return matchesQuery(issue, issueKey(issue, byId), filters.query)
  })
}

export function projectOptions(projects: Project[]): Option[] {
  return [...projects].sort((a, b) => Number(a.lifecycle === 'archived') - Number(b.lifecycle === 'archived') || a.key.localeCompare(b.key))
    .map((project) => ({ value: project.id, label: `${project.key} · ${project.name}${project.lifecycle === 'archived' ? ' (archived)' : ''}` }))
}

/** A type's label: the first project that configures it, then the built-in config, then the key itself. */
export function typeLabel(type: string, projects: Project[]): string {
  for (const project of projects) {
    const label = project.settings.issueTypes?.find((definition) => definition.key === type)?.label
    if (label) return label
  }
  return ISSUE_TYPE_CONFIG[type]?.label ?? type
}

/** Types present in the issues plus every type the projects' schemes configure. */
export function typeOptions(issues: Issue[], projects: Project[]): Option[] {
  const types = new Set(issues.map((issue) => issue.type))
  for (const project of projects) {
    const configured = project.settings.issueTypes?.map((definition) => definition.key) ??
      (PROJECT_TYPE_SCHEMES[project.type] ?? PROJECT_TYPE_SCHEMES['software-development']).issueTypes
    configured.forEach((type) => types.add(type))
  }
  const level = (type: string) => ISSUE_TYPE_CONFIG[type]?.level ??
    projects.flatMap((project) => project.settings.issueTypes ?? []).find((definition) => definition.key === type)?.level ?? 99
  return [...types].sort((a, b) => level(a) - level(b) || a.localeCompare(b)).map((type) => ({ value: type, label: typeLabel(type, projects) }))
}

/** A person id as shown on a card: the store's `people`, otherwise an honest unknown. */
export function personFor(id: string, people: Person[]): { id: string; name: string; initials: string; known: boolean } {
  const person = people.find((candidate) => candidate.id === id)
  return person ? { id, name: person.name, initials: person.initials, known: true } : { id, name: `Unknown user (${id.slice(0, 8)})`, initials: '?', known: false }
}

/** `me` only when the signed-in user is assignable (guests can assign only Ron); then everyone else known or present. */
export function assigneeOptions(issues: Issue[], people: Person[], userId: string | null): Option[] {
  const meAssignable = Boolean(userId && people.some((person) => person.id === userId))
  const ids = new Set(people.map((person) => person.id))
  issues.forEach((issue) => issue.assignees.forEach((id) => ids.add(id)))
  if (meAssignable && userId) ids.delete(userId)
  return [
    ...(meAssignable ? [{ value: 'me', label: 'Assigned to me' }] : []),
    { value: 'unassigned', label: 'Unassigned' },
    ...[...ids].map((id) => ({ value: id, label: personFor(id, people).name })),
  ]
}

const PRIORITY_RANK: Record<IssuePriority, number> = { critical: 0, high: 1, medium: 2, low: 3 }

/** Board order inside a column: priority, then soonest due (undated last), then most recently updated. */
function boardOrder(a: Issue, b: Issue): number {
  const dueA = time(a.dueDate) ?? Infinity
  const dueB = time(b.dueDate) ?? Infinity
  return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || (dueA === dueB ? 0 : dueA < dueB ? -1 : 1) || b.updatedAt - a.updatedAt
}

export function groupByStatus(issues: Issue[]): Record<IssueStatus, Issue[]> {
  const columns = Object.fromEntries(ISSUE_STATUSES.map((status) => [status, [] as Issue[]])) as Record<IssueStatus, Issue[]>
  issues.forEach((issue) => columns[issue.status]?.push(issue))
  ISSUE_STATUSES.forEach((status) => columns[status].sort(boardOrder))
  return columns
}

export type SortKey = 'key' | 'title' | 'project' | 'status' | 'priority' | 'assignee' | 'due'
export interface SortState { key: SortKey; direction: 'asc' | 'desc' }
export const SORT_LABELS: Record<SortKey, string> = { key: 'Key', title: 'Title', project: 'Project', status: 'Status', priority: 'Priority', assignee: 'Assignee', due: 'Due' }

/** Sorted copy. Missing values (no due date, unassigned) always sort last, in either direction. */
export function sortIssues(issues: Issue[], sort: SortState, context: { projects: Project[]; people: Person[] }): Issue[] {
  const byId = projectMap(context.projects)
  const sign = sort.direction === 'asc' ? 1 : -1
  const text = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  const assignee = (issue: Issue) => issue.assignees[0] ? personFor(issue.assignees[0], context.people).name : null
  const compare = (a: Issue, b: Issue): number => {
    switch (sort.key) {
      case 'key': return sign * (text(byId.get(a.projectId)?.key ?? '', byId.get(b.projectId)?.key ?? '') || a.number - b.number)
      case 'title': return sign * text(a.title, b.title)
      case 'project': return sign * text(byId.get(a.projectId)?.name ?? '', byId.get(b.projectId)?.name ?? '')
      case 'status': return sign * (ISSUE_STATUSES.indexOf(a.status) - ISSUE_STATUSES.indexOf(b.status))
      case 'priority': return sign * ((PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9))
      case 'assignee': {
        const [x, y] = [assignee(a), assignee(b)]
        if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
        return sign * text(x, y)
      }
      case 'due': {
        const [x, y] = [time(a.dueDate), time(b.dueDate)]
        if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
        return sign * (x - y)
      }
    }
  }
  return [...issues].sort((a, b) => compare(a, b) || text(issueKey(a, byId), issueKey(b, byId)))
}

export interface ExecuteSummary { total: number; open: number; overdue: number; blocked: number; dueSoon: number }
export function summarize(issues: Issue[], now: number): ExecuteSummary {
  return {
    total: issues.length,
    open: issues.filter((issue) => issue.status !== 'done').length,
    overdue: issues.filter((issue) => isOverdue(issue, now)).length,
    blocked: issues.filter((issue) => issue.status === 'blocked').length,
    dueSoon: issues.filter((issue) => issue.status !== 'done' && isDueSoon(issue, now)).length,
  }
}

// ── Timeline ────────────────────────────────────────────────────────────────

export interface IssueSpan { start: number; end: number; milestone: boolean }

/**
 * An issue's real span: start = startDate (else endDate, else dueDate); end = endDate (else dueDate, else start).
 * A single date is a milestone. Issues with no dates have no span.
 */
export function issueSpan(issue: Pick<Issue, 'startDate' | 'endDate' | 'dueDate'>): IssueSpan | null {
  const start = time(issue.startDate) ?? time(issue.endDate) ?? time(issue.dueDate)
  if (start === null) return null
  const end = time(issue.endDate) ?? time(issue.dueDate) ?? start
  return { start: Math.min(start, end), end: Math.max(start, end), milestone: start === end }
}

export type TimelineRange = 'fit' | 'six-weeks' | 'quarter'
export const TIMELINE_RANGE_LABELS: Record<TimelineRange, string> = { fit: 'Fit all', 'six-weeks': '6 weeks', quarter: 'Quarter' }
const RANGE_DAYS: Record<Exclude<TimelineRange, 'fit'>, number> = { 'six-weeks': 42, quarter: 91 }

export interface TimelineWindow { start: number; end: number }

/** The window a fixed range starts at by default: the Sunday a week before today's week. */
export const defaultTimelineCursor = (now: Date) => addDays(startOfWeek(now), -7)

/** Step a fixed range by its own length. */
export const stepTimelineCursor = (cursor: Date, range: Exclude<TimelineRange, 'fit'>, direction: 1 | -1) =>
  addDays(cursor, direction * RANGE_DAYS[range])

/** `fit` spans every scheduled issue and today, padded by a day; the fixed ranges start at `cursor` (local days). */
export function timelineWindow(issues: Issue[], range: TimelineRange, cursor: Date, now: Date): TimelineWindow {
  if (range !== 'fit') {
    const start = startOfDay(cursor)
    return { start: start.getTime(), end: addDays(start, RANGE_DAYS[range]).getTime() }
  }
  const spans = issues.map(issueSpan).filter((span): span is IssueSpan => span !== null)
  if (!spans.length) {
    const start = defaultTimelineCursor(now)
    return { start: start.getTime(), end: addDays(start, RANGE_DAYS['six-weeks']).getTime() }
  }
  const first = Math.min(now.getTime(), ...spans.map((span) => span.start))
  const last = Math.max(now.getTime(), ...spans.map((span) => span.end))
  return { start: addDays(startOfDay(new Date(first)), -1).getTime(), end: addDays(startOfDay(new Date(last)), 2).getTime() }
}

/** Axis ticks: weekly (Sundays) up to ~9 weeks, monthly up to ~13 months, else quarterly. */
export function timelineTicks(window: TimelineWindow): { at: number; pct: number; unit: 'week' | 'month' | 'quarter' }[] {
  const total = window.end - window.start
  if (total <= 0) return []
  const days = total / DAY_MS
  const unit = days <= 63 ? 'week' : days <= 400 ? 'month' : 'quarter'
  const ticks: { at: number; pct: number; unit: typeof unit }[] = []
  const first = new Date(window.start)
  let cursor = unit === 'week' ? startOfWeek(first)
    : new Date(first.getFullYear(), unit === 'month' ? first.getMonth() : Math.floor(first.getMonth() / 3) * 3, 1)
  while (cursor.getTime() < window.end) {
    if (cursor.getTime() >= window.start) ticks.push({ at: cursor.getTime(), pct: ((cursor.getTime() - window.start) / total) * 100, unit })
    cursor = unit === 'week' ? addDays(cursor, 7) : new Date(cursor.getFullYear(), cursor.getMonth() + (unit === 'month' ? 1 : 3), 1)
  }
  return ticks
}

export interface TimelineRow {
  issue: Issue
  span: IssueSpan
  leftPct: number
  widthPct: number
  /** The span continues before / after the window. */
  clippedStart: boolean
  clippedEnd: boolean
}
export interface TimelineGroup { projectId: string; project?: Project; rows: TimelineRow[] }
export interface TimelineLayout { groups: TimelineGroup[]; outside: number; unscheduled: number }

/** Scheduled issues inside the window, grouped by project (by key), each group ordered by start, end, number. */
export function layoutTimeline(issues: Issue[], projects: Project[], window: TimelineWindow): TimelineLayout {
  const byId = projectMap(projects)
  const total = window.end - window.start
  const groups = new Map<string, TimelineRow[]>()
  let outside = 0
  let unscheduled = 0
  for (const issue of issues) {
    const span = issueSpan(issue)
    if (!span) { unscheduled++; continue }
    const visible = span.milestone ? span.start >= window.start && span.start < window.end : span.end > window.start && span.start < window.end
    if (!visible || total <= 0) { outside++; continue }
    const left = Math.max(span.start, window.start)
    const right = Math.min(span.end, window.end)
    const row: TimelineRow = {
      issue, span, leftPct: ((left - window.start) / total) * 100, widthPct: ((right - left) / total) * 100,
      clippedStart: span.start < window.start, clippedEnd: span.end > window.end,
    }
    groups.set(issue.projectId, [...(groups.get(issue.projectId) ?? []), row])
  }
  return {
    groups: [...groups.entries()]
      .map(([projectId, rows]) => ({ projectId, project: byId.get(projectId), rows: rows.sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end || a.issue.number - b.issue.number) }))
      .sort((a, b) => (a.project?.key ?? '￿').localeCompare(b.project?.key ?? '￿')),
    outside, unscheduled,
  }
}
