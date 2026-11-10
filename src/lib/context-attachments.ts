import type { ContextItem } from '@/lib/chat-context'
import {
  documentContent, eventContent, interestContent, issueContent, projectContent, threadContent,
} from '@/lib/chat-context'
import { API_BASE_URL } from '@/lib/api-base'
import { readThread } from '@/lib/threads-api'
import { createContextClient } from '@/lib/context-api'
import { getDocument } from '@/lib/project-documents'
import { clipWithNote, contextAttachment, tabAttachmentText, type PromptAttachment, type TabContext } from '@/lib/prompt-attachments'
import { getProjectsState, projectsRequestFor } from '@/stores/projectsStore'
import { useInterestsStore } from '@/stores/interestsStore'

const SAVED_CONTEXT_MAX = 12000

/**
 * The text the agent reads for one item picked in the context menu (or with `@`), read now so it sees the record
 * as it is (an issue edited since it was picked, a chat that kept going, the page a tab shows now). A source that
 * cannot be read says so rather than sending the label alone as if it were the content.
 */
export async function contextText(item: ContextItem, userId: string): Promise<string> {
  const ref = item.ref ?? {}
  try {
    if (item.type === 'tab') {
      const result = await window.electron?.tabs?.getContext?.(item.id)
      if (!result?.success || !result.context) return `Could not read this tab${result?.error ? `: ${result.error}` : ''}.`
      return tabAttachmentText(result.context as TabContext)
    }
    const { projects, issues, userId: projectsUser } = getProjectsState()
    if ((item.type === 'issue' || item.type === 'task') && ref.issueId) {
      const issue = issues.find((candidate) => candidate.id === ref.issueId)
      return issue ? issueContent(issue, projects, issues) : 'This issue is no longer available.'
    }
    if (item.type === 'project' && ref.projectId) {
      const project = projects.find((candidate) => candidate.id === ref.projectId)
      return project ? projectContent(project, issues) : 'This project is no longer available.'
    }
    if (item.type === 'event') {
      const issue = ref.issueId ? issues.find((candidate) => candidate.id === ref.issueId) : undefined
      return eventContent(item, issue, projects, issues)
    }
    if (item.type === 'interest' && ref.interestId) {
      const node = useInterestsStore.getState().nodes.find((candidate) => candidate.id === ref.interestId)
      return node ? interestContent(node) : `Interest: ${item.name}`
    }
    if (item.type === 'conversation' && ref.sessionId) {
      return threadContent(await readThread(API_BASE_URL, userId, ref.sessionId))
    }
    if (item.type === 'document' && ref.documentId && projectsUser) {
      const page = await getDocument(projectsRequestFor(projectsUser), ref.documentId)
      return documentContent(page.title, page.content, projects.find((project) => project.id === page.projectId)?.name)
    }
    if (item.type === 'file' && ref.contextItemId) {
      return clipWithNote(await createContextClient(API_BASE_URL, userId).markdown(ref.contextItemId), SAVED_CONTEXT_MAX)
    }
  } catch (error) {
    return `Could not load this ${item.type}: ${error instanceof Error ? error.message : String(error)}`
  }
  return [item.name, item.description].filter(Boolean).join('\n')
}

/** The attachment one picked item becomes: its text as edited in the preview, or as it reads now. */
export async function contextItemAttachment(item: ContextItem, userId: string, edited?: string): Promise<PromptAttachment> {
  const url = item.type === 'tab' ? item.url : undefined
  return contextAttachment({ id: item.id, type: item.type, name: item.name, description: item.description, meta: item.meta, url },
    edited ?? await contextText(item, userId))
}
