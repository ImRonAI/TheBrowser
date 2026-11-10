import type { Issue } from '../types/projects.ts'

const editable = ['title', 'description', 'type', 'parentId', 'status', 'priority', 'estimate', 'assignees', 'labels', 'startDate', 'endDate', 'dueDate', 'customFields', 'context'] as const
export function issueDraftPatch(base: Issue, draft: Issue): Partial<Issue> {
  const patch: Record<string, unknown> = {}
  for (const key of editable) {
    if (JSON.stringify(base[key]) !== JSON.stringify(draft[key])) patch[key] = draft[key]
  }
  return patch
}

/** Rebase only after an explicit review. Remote-only edits remain intact. */
export function rebaseIssueDraft(base: Issue, draft: Issue, remote: Issue) {
  if (base.id !== remote.id || draft.id !== remote.id) throw new Error('Cannot move drafts between issues')
  const patch = issueDraftPatch(base, draft)
  if (patch.customFields) {
    const fields = { ...remote.customFields }
    for (const key of new Set([...Object.keys(base.customFields), ...Object.keys(draft.customFields)])) {
      if (JSON.stringify(base.customFields[key]) === JSON.stringify(draft.customFields[key])) continue
      if (Object.hasOwn(draft.customFields, key)) fields[key] = draft.customFields[key]
      else delete fields[key]
    }
    patch.customFields = fields
  }
  return { ...remote, ...patch }
}