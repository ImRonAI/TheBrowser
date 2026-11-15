import { useEffect, useState } from 'react'
import { useProjectsStore } from '@/stores/projectsStore'
import { IssueCalendar } from '@/components/calendar/IssueCalendar'
import { IssueDrawer } from '@/components/projects/IssueDrawer'
import { Marker } from '@/components/brand'
import { PageBackground } from '@/components/shared/PageBackground'

/** The Calendar destination: every project's scheduled issues on one calendar. */
export function CalendarPage() {
  const { issues, userId, initialize, isLoading, error } = useProjectsStore()
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)

  useEffect(() => {
    if (userId) void initialize()
  }, [userId, initialize])

  return (
    <div className="relative isolate flex h-full min-h-[680px] flex-col bg-surface-50 dark:bg-surface-900">
      <PageBackground />
      <div className="relative mx-auto flex min-h-0 w-full max-w-[1360px] flex-1 flex-col gap-4 px-4 pb-8 pt-8 sm:px-6 sm:pt-10 lg:px-10">
      <header className="relative mb-2 min-w-0">
        <div aria-hidden className="halftone pointer-events-none absolute -left-16 -top-12 h-44 w-[26rem] opacity-70 dark:opacity-50" />
        <span className="tag-label tag-label-slash relative">Calendar</span>
        <h1 className="ren-display relative mt-3 text-[40px] text-ink dark:text-ink-inverse sm:text-[52px]">
          Make time{' '}<span className="spray-halo inline-block"><Marker>behave.</Marker></span>
        </h1>
        <p className="relative mt-3 max-w-2xl text-[14px] leading-6 text-ink-secondary dark:text-ink-inverse-secondary">
          Every project’s dates on one calendar, so nothing sneaks up on you.
        </p>
      </header>
      {(isLoading || error) && (
        <p
          role={error ? 'alert' : 'status'}
          className={error ? 'text-body-sm text-danger' : 'text-body-sm text-ink-muted dark:text-ink-inverse-muted'}
        >
          {error || 'Loading your projects…'}
        </p>
      )}
      <IssueCalendar issues={issues} onIssueSelect={setSelectedIssueId} className="min-h-0 flex-1" />
      </div>
      {selectedIssueId && <IssueDrawer issueId={selectedIssueId} onClose={() => setSelectedIssueId(null)} />}
    </div>
  )
}
