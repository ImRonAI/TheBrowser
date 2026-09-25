import { ISSUE_TYPE_CONFIG, type Issue, type Project } from '../types/projects.ts'

export function issueDefinitions(project: Project) {
  return project.settings.issueTypes ?? Object.entries(ISSUE_TYPE_CONFIG).map(([key, value]) => ({ key, label: value.label, level: value.level }))
}

export function canPlaceIssue(project: Project, type: string, parent?: Issue | null) {
  const definitions = issueDefinitions(project)
  const level = definitions.find((entry) => entry.key === type)?.level
  if (level === undefined) return false
  if (!parent) return level < 5
  return parent.projectId === project.id && definitions.find((entry) => entry.key === parent.type)?.level === level - 1
}

/** datetime-local values are wall-clock times in the browser's displayed timezone. */
export function toLocalDateTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const part = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`
}

export function fromLocalDateTime(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || toLocalDateTime(date.toISOString()) !== value)
    throw new Error('This local time does not exist. Choose a valid date and time.')
  return date.toISOString()
}

export function calendarDay(value: Date) {
  return toLocalDateTime(value.toISOString()).slice(0, 10)
}

export function issueOnDay(issue: Issue, day: Date) {
  const key = calendarDay(day)
  const localDay = (value?: string) => value ? toLocalDateTime(value).slice(0, 10) : ''
  const start = localDay(issue.startDate)
  const end = localDay(issue.endDate) || start
  return localDay(issue.dueDate) === key || localDay(issue.endDate) === key || Boolean(start && start <= key && end >= key)
}

export function validateIssueDates(values: Pick<Issue, 'startDate' | 'endDate'>) {
  if (values.startDate && values.endDate && Date.parse(values.endDate) < Date.parse(values.startDate))
    throw new Error('End must be on or after start.')
}