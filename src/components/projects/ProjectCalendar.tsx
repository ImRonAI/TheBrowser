import type { Issue } from '@/types/projects'
import { IssueCalendar } from '@/components/calendar/IssueCalendar'

export function ProjectCalendar({ issues, onIssueSelect }: { issues: Issue[]; onIssueSelect: (id: string) => void }) {
  return <IssueCalendar issues={issues} onIssueSelect={onIssueSelect} className="h-[780px]" />
}
