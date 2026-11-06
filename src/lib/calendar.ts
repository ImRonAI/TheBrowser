import { calendarDay, issueOnDay, toLocalDateTime } from './project-issue-utils.ts'
import type { Issue } from '../types/projects.ts'

/** Calendar date math and issue placement. Weeks start on Sunday; all dates are local wall-clock days. */

export type CalendarMode = 'day' | 'week' | 'month' | 'quarter'
export const CALENDAR_MODES: readonly CalendarMode[] = ['day', 'week', 'month', 'quarter']
export const CALENDAR_MODE_LABELS: Record<CalendarMode, string> = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter' }

export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
/** Calendar-day arithmetic through the Date constructor, so DST transitions never shift the day. */
export const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
export const startOfWeek = (date: Date) => addDays(startOfDay(date), -date.getDay())
export const weekDays = (date: Date) => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date), i))
export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
export const quarterOf = (date: Date) => Math.floor(date.getMonth() / 3)
export const quarterStart = (date: Date) => new Date(date.getFullYear(), quarterOf(date) * 3, 1)
export const quarterMonths = (date: Date) =>
  [0, 1, 2].map((offset) => new Date(quarterStart(date).getFullYear(), quarterStart(date).getMonth() + offset, 1))
const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate()

/** The Sunday-start weeks that cover a month: 4, 5 or 6 rows, never a trailing empty week. */
export function monthWeeks(date: Date): Date[][] {
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  const weeks: Date[][] = []
  for (let week = startOfWeek(new Date(date.getFullYear(), date.getMonth(), 1)); week <= last; week = addDays(week, 7))
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(week, i)))
  return weeks
}

/** Move one period. Month and quarter steps keep the day of month, clamped (Jan 31 → Feb 28). */
export function stepDate(date: Date, mode: CalendarMode, direction: 1 | -1): Date {
  if (mode === 'day') return addDays(date, direction)
  if (mode === 'week') return addDays(date, 7 * direction)
  const months = (mode === 'month' ? 1 : 3) * direction
  const year = date.getFullYear()
  const month = date.getMonth() + months
  return new Date(year, month, Math.min(date.getDate(), daysInMonth(year, month)))
}

export function isCurrentPeriod(date: Date, mode: CalendarMode, now = new Date()): boolean {
  if (mode === 'day') return sameDay(date, now)
  if (mode === 'week') return sameDay(startOfWeek(date), startOfWeek(now))
  if (mode === 'month') return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
  return date.getFullYear() === now.getFullYear() && quarterOf(date) === quarterOf(now)
}

/** First and last visible day of the period (inclusive). */
export function periodRange(date: Date, mode: CalendarMode): { start: Date; end: Date } {
  if (mode === 'day') return { start: startOfDay(date), end: startOfDay(date) }
  if (mode === 'week') return { start: startOfWeek(date), end: addDays(startOfWeek(date), 6) }
  if (mode === 'month') return { start: new Date(date.getFullYear(), date.getMonth(), 1), end: new Date(date.getFullYear(), date.getMonth() + 1, 0) }
  const start = quarterStart(date)
  return { start, end: new Date(start.getFullYear(), start.getMonth() + 3, 0) }
}

export function periodLabel(date: Date, mode: CalendarMode, locale?: string): string {
  if (mode === 'day') return date.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  if (mode === 'month') return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const { start, end } = periodRange(date, mode)
  if (mode === 'week') return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).formatRange(start, end)
  const months = new Intl.DateTimeFormat(locale, { month: 'short' }).formatRange(start, end)
  return `Q${quarterOf(date) + 1} ${date.getFullYear()} · ${months}`
}

export function formatMinutes(minutes: number, locale?: string): string {
  const date = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)
  return date.toLocaleTimeString(locale, { hour: 'numeric', minute: minutes % 60 ? '2-digit' : undefined })
}

// ─── Issue placement ─────────────────────────────────────────────────────────

const localDayKey = (value?: string) => (value ? toLocalDateTime(value).slice(0, 10) : '')
const localMinutes = (value: string) => {
  const local = new Date(value)
  return local.getHours() * 60 + local.getMinutes()
}
const MIN_BLOCK_MINUTES = 30

export type TimedKind = 'span' | 'start' | 'end' | 'due'
export interface TimedPlacement {
  issue: Issue
  kind: TimedKind
  startMinutes: number
  endMinutes: number
}
export interface PositionedBlock extends TimedPlacement {
  column: number
  columns: number
}

function block(issue: Issue, kind: TimedKind, startMinutes: number, endMinutes = startMinutes): TimedPlacement {
  const start = Math.min(startMinutes, 24 * 60 - MIN_BLOCK_MINUTES)
  return { issue, kind, startMinutes: start, endMinutes: Math.min(24 * 60, Math.max(endMinutes, start + MIN_BLOCK_MINUTES)) }
}

/**
 * Split a day's issues into time-grid blocks and all-day items:
 * a start/end span inside this one day, a lone start, a lone end or a due time become blocks at their
 * real times; a span that crosses midnight covers the whole day.
 */
export function placeIssuesOnDay(issues: Issue[], day: Date): { timed: TimedPlacement[]; allDay: Issue[] } {
  const key = calendarDay(day)
  const timed: TimedPlacement[] = []
  const allDay: Issue[] = []
  for (const issue of issues) {
    if (!issueOnDay(issue, day)) continue
    const start = localDayKey(issue.startDate)
    const end = localDayKey(issue.endDate)
    if (issue.startDate && issue.endDate && start === key && end === key) {
      timed.push(block(issue, 'span', localMinutes(issue.startDate), localMinutes(issue.endDate)))
    } else if (issue.startDate && issue.endDate && start <= key && end >= key) {
      allDay.push(issue)
    } else if (issue.startDate && !issue.endDate && start === key) {
      timed.push(block(issue, 'start', localMinutes(issue.startDate)))
    } else if (issue.endDate && !issue.startDate && end === key) {
      timed.push(block(issue, 'end', localMinutes(issue.endDate)))
    } else if (issue.dueDate && localDayKey(issue.dueDate) === key) {
      timed.push(block(issue, 'due', localMinutes(issue.dueDate)))
    }
  }
  timed.sort((a, b) => a.startMinutes - b.startMinutes)
  return { timed, allDay }
}

/** Side-by-side columns for overlapping blocks; each overlap cluster shares one column count. */
export function layoutOverlaps(blocks: TimedPlacement[]): PositionedBlock[] {
  const sorted = [...blocks].sort((a, b) =>
    a.startMinutes - b.startMinutes || (b.endMinutes - b.startMinutes) - (a.endMinutes - a.startMinutes))
  const out: PositionedBlock[] = []
  let cluster: Omit<PositionedBlock, 'columns'>[] = []
  let columnEnds: number[] = []
  let clusterEnd = -1
  const flush = () => {
    for (const item of cluster) out.push({ ...item, columns: columnEnds.length })
    cluster = []
    columnEnds = []
  }
  for (const item of sorted) {
    if (cluster.length && item.startMinutes >= clusterEnd) flush()
    let column = columnEnds.findIndex((end) => end <= item.startMinutes)
    if (column === -1) {
      column = columnEnds.length
      columnEnds.push(item.endMinutes)
    } else {
      columnEnds[column] = item.endMinutes
    }
    clusterEnd = cluster.length ? Math.max(clusterEnd, item.endMinutes) : item.endMinutes
    cluster.push({ ...item, column })
  }
  flush()
  return out
}

/** Earliest local day the issue touches, for ordering. */
export function issueSortKey(issue: Issue): string {
  return [issue.startDate, issue.endDate, issue.dueDate].filter(Boolean).map((value) => toLocalDateTime(value)).sort()[0] ?? ''
}

export const issuesOnDay = (issues: Issue[], day: Date) =>
  issues.filter((issue) => issueOnDay(issue, day)).sort((a, b) => issueSortKey(a).localeCompare(issueSortKey(b)))

/** Issues with any span or due date inside [start, end] (inclusive local days), in date order. */
export function issuesInRange(issues: Issue[], start: Date, end: Date): Issue[] {
  const from = calendarDay(start)
  const to = calendarDay(end)
  return issues.filter((issue) => {
    const s = localDayKey(issue.startDate)
    const e = localDayKey(issue.endDate) || s
    const due = localDayKey(issue.dueDate)
    const spanStart = s || e
    return Boolean((spanStart && spanStart <= to && e >= from) || (due && due >= from && due <= to))
  }).sort((a, b) => issueSortKey(a).localeCompare(issueSortKey(b)))
}

export const unscheduledIssues = (issues: Issue[]) => issues.filter((issue) => !issue.startDate && !issue.endDate && !issue.dueDate)
