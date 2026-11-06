import { useEffect, useState } from 'react'
import { useProjectsStore } from '@/stores/projectsStore'
import { IssueCalendar } from '@/components/calendar/IssueCalendar'
import { IssueDrawer } from '@/components/projects/IssueDrawer'

/** The Calendar destination: every project's scheduled issues on one calendar. */
export function CalendarPage() {
  const { issues, userId, initialize, isLoading, error } = useProjectsStore()
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)

  useEffect(() => {
    if (userId) void initialize()
  }, [userId, initialize])

  return (
    <div className="flex h-full min-h-[640px] flex-col gap-3 p-6">
      {(isLoading || error) && (
        <p
          role={error ? 'alert' : 'status'}
          className={error ? 'text-body-sm text-danger' : 'text-body-sm text-ink-muted dark:text-ink-inverse-muted'}
        >
          {error || 'Loading your projects…'}
        </p>
      )}
      <IssueCalendar issues={issues} onIssueSelect={setSelectedIssueId} className="min-h-0 flex-1" />
      {selectedIssueId && <IssueDrawer issueId={selectedIssueId} onClose={() => setSelectedIssueId(null)} />}
    </div>
  )
}
