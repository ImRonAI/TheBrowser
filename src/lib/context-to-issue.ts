/**
 * Send context items to an issue's **Context** section (`issues.context`, migration 020): each item becomes
 * one entry (its Markdown, source and any captured file). Files go to the private Supabase Storage bucket
 * `issue-attachments` (migration 019) under `<project_id>/<issue_id>/`, which only signed-in members of the
 * project can read; guest workspaces keep the text and are told files need sign-in.
 */
import { supabase } from '@/api/supabase'
import type { Issue } from '@/types/projects'
import { createContextClient, type ContextItem } from './context-api'
import { attachmentPath, issueContextEntry, ISSUE_ATTACHMENTS_BUCKET, mergeIssueContext, type IssueContextEntry, type IssueFileRef } from './issue-attachments'

export interface SendToIssueResult { added: number; filesSkipped: number }

export async function sendContextToIssue(options: {
  apiBase: string
  userId: string
  signedIn: boolean
  items: ContextItem[]
  issue: Issue
  updateIssue: (id: string, updates: Partial<Issue>, expectedVersion?: number) => Promise<{ issue?: Issue; error?: string }>
}): Promise<SendToIssueResult> {
  const { apiBase, userId, signedIn, items, issue, updateIssue } = options
  const client = createContextClient(apiBase, userId)
  const entries: IssueContextEntry[] = []
  let filesSkipped = 0
  for (const item of items) {
    const markdown = await client.markdown(item.id)
    let file: IssueFileRef | undefined
    if (item.file && signedIn) {
      const blob = await client.fileBlob(item.id)
      const path = attachmentPath(issue.projectId, issue.id, item)
      // Context items are immutable and the path is per item, so an object already there is this file.
      const { error } = await supabase.storage.from(ISSUE_ATTACHMENTS_BUCKET).upload(path, blob, { contentType: item.file.media_type, upsert: false })
      if (error && (error as { statusCode?: string }).statusCode !== '409') throw new Error(`Could not upload ${item.file.name}: ${error.message}`)
      file = { bucket: ISSUE_ATTACHMENTS_BUCKET, path, name: item.file.name, mediaType: item.file.media_type, size: item.file.size }
    } else if (item.file) {
      filesSkipped += 1
    }
    entries.push(issueContextEntry(item, markdown, file))
  }
  const result = await updateIssue(issue.id, { context: mergeIssueContext(issue.context, entries) }, issue.version)
  if (result.error) throw new Error(result.error)
  return { added: entries.length, filesSkipped }
}

/** A short-lived link to an attachment (the bucket is private). */
export async function attachmentUrl(file: IssueFileRef, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(file.bucket).createSignedUrl(file.path, expiresIn)
  if (error || !data?.signedUrl) throw new Error(error?.message || 'No link for this attachment.')
  return data.signedUrl
}
