import { useState } from 'react'
import type { Issue } from '@/types/projects'
import { calendarDay, issueOnDay } from '@/lib/project-issue-utils'

export function ProjectCalendar({ issues, onIssueSelect }: { issues: Issue[]; onIssueSelect: (id: string) => void }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const start = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay())
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  const unscheduled = issues.filter((i) => !i.startDate && !i.endDate && !i.dueDate)
  return <section className="rounded-3xl glass-card border border-white/10 p-6 shadow-soft text-ink dark:text-ink-inverse space-y-4">
    <header className="flex flex-wrap items-center gap-3">
      <h2 className="mr-auto font-semibold">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
      <button aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>←</button>
      <button onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button>
      <button aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>→</button>
    </header>
    <p className="text-xs text-ink-muted">{Intl.DateTimeFormat().resolvedOptions().timeZone} · Start/end spans and due dates. Select an issue to reschedule its exact times. These are not all-day or external calendar events.</p>
    <div className="overflow-x-auto"><div className="grid grid-cols-7 min-w-[700px]">
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div key={day} className="p-2 text-xs font-semibold">{day}</div>)}
      {days.map((day) => <div key={calendarDay(day)} className={`min-h-28 border border-surface-200 dark:border-surface-800 p-2 ${day.getMonth() !== month.getMonth() ? 'bg-surface-100/40 dark:bg-surface-800/30' : ''}`}>
        <time dateTime={calendarDay(day)} className={`text-xs ${calendarDay(day) === calendarDay(new Date()) ? 'text-indigo-500 font-bold' : ''}`}>{day.getDate()}</time>
        <div className="mt-2 space-y-1">{issues.filter((issue) => issueOnDay(issue, day)).map((issue) => <button key={issue.id} className="block w-full rounded-lg bg-indigo-500/10 p-2 text-left text-xs hover:bg-indigo-500/20" onClick={() => onIssueSelect(issue.id)}>
          <span className="font-semibold">#{issue.number} · {issue.title}</span>
          {issue.dueDate && calendarDay(new Date(issue.dueDate)) === calendarDay(day) && <span className="block text-indigo-500">Due {new Date(issue.dueDate).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>}
        </button>)}</div>
      </div>)}
    </div></div>
    <details><summary className="cursor-pointer text-sm">Unscheduled ({unscheduled.length})</summary><div className="mt-3 space-y-2">{unscheduled.map((issue) => <button key={issue.id} className="block text-sm text-indigo-500" onClick={() => onIssueSelect(issue.id)}>#{issue.number} · {issue.title}</button>)}</div></details>
  </section>
}