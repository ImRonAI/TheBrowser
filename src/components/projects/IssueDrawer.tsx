import { useState } from 'react'
import { useProjectsStore } from '@/stores/projectsStore'
import { CanonicalIssueWorkspace } from './CanonicalIssueWorkspace'

/** Compatibility entry point for every canonical Projects view. No legacy writes. */
export function IssueDrawer({ issueId, onClose }: { issueId: string; onClose: () => void }) {
  const { userId } = useProjectsStore()
  return <IssueSelection key={`${userId}:${issueId}`} issueId={issueId} onClose={onClose} />
}

function IssueSelection({ issueId, onClose }: { issueId: string; onClose: () => void }) {
  const { issues, projects } = useProjectsStore()
  const [selectedId, setSelectedId] = useState(issueId)
  const issue = issues.find((item) => item.id === selectedId)
  const project = projects.find((item) => item.id === issue?.projectId)
  if (!issue || !project) return null
  return <CanonicalIssueWorkspace key={issue.id} issue={issue} project={project} onClose={onClose} onNavigate={setSelectedId} />
}