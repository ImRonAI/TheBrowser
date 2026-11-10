import { useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { nanoid } from 'nanoid'
import { useRonRun } from '@/hooks/useRonRun'
import { documentRetryMessage, documentRonMessage, type RonWritingTarget } from '@/lib/document-ron'
import { latestAssistant, ronSessionId } from '@/lib/ron-run'
import type { DraftTurn } from '@/lib/ron-draft'
import type { ProjectsRequest } from '@/lib/projects-api'
import { createDocumentConversation, touchDocumentConversation, type DocumentConversation } from '@/lib/project-documents'
import { RonDraftChat, type DraftAgent } from './RonDraftChat'

const SUGGESTIONS = ['Draft this page from its title', 'Add a workflow of the process', 'Summarize this page', 'Turn this into action items']

const failure = (cause: unknown) => (cause instanceof Error ? cause.message : 'Ren could not be reached.')

/** Where the Document Agent's conversation is saved: with its page (`document_conversations`). */
export interface PageConversations {
  request: ProjectsRequest
  /** Null until the page is first saved. */
  documentId: string | null
  /** Saves a page that was never saved, so the conversation has a page to belong to. */
  ensureDocumentId: () => Promise<string | null>
}

/**
 * The Document Agent (its own agent on the server runtime, `destination: "document"`) behind the
 * writing chat. One chat is one conversation: its first request creates it on the page, Try again
 * continues it, and the messages are the runtime's native session.
 */
function useDocumentAgent(editor: Editor | null, target: () => RonWritingTarget, conversations?: PageConversations): DraftAgent {
  const ron = useRonRun('document')
  const [done, setDone] = useState<DraftTurn[]>([])
  const [current, setCurrent] = useState<Pick<DraftTurn, 'id' | 'kind' | 'ask'> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const session = useRef<{ sessionId: string; conversation: DocumentConversation | null } | null>(null)

  const send: DraftAgent['send'] = async (ask, kind, goal) => {
    if (current || !editor) return
    setError(null)
    try {
      if (kind === 'request' || !session.current) {
        let conversation: DocumentConversation | null = null
        if (conversations) {
          const pageId = conversations.documentId ?? await conversations.ensureDocumentId()
          if (!pageId) throw new Error('This page could not be saved, so Ren’s conversation could not be saved with it.')
          conversation = await createDocumentConversation(conversations.request, pageId, ask, goal)
        }
        session.current = { sessionId: conversation?.sessionId ?? ronSessionId('doc', nanoid(12)), conversation }
      } else if (conversations && session.current.conversation) {
        session.current = { ...session.current, conversation: await touchDocumentConversation(conversations.request, session.current.conversation) }
      }
    } catch (cause) {
      setError(failure(cause))
      return
    }
    const turn = { id: nanoid(8), kind, ask }
    setCurrent(turn)
    const message = kind === 'request'
      ? documentRonMessage({ target: target(), intent: ask, currentMarkdown: editor.getMarkdown() })
      : documentRetryMessage(ask)
    const final = await ron.start({ sessionId: session.current.sessionId, message, goal: kind === 'request' && goal ? ask : undefined })
    setDone((turns) => [...turns, {
      ...turn, message: final ? latestAssistant(final) ?? null : null,
      status: final?.status ?? 'error', error: final?.error,
    }])
    setCurrent(null)
  }

  const live: DraftTurn[] = current
    ? [{ ...current, message: ron.state ? latestAssistant(ron.state) ?? null : null, status: ron.state?.status === 'running' || !ron.state ? 'running' : ron.state.status }]
    : []
  return { turns: [...done, ...live], running: current !== null, error: error ?? ron.error, send, stop: ron.stop }
}

/**
 * Ask Ron inside a project page: a temporary chat (the panel's components) that ends when the user
 * inserts Ron's draft or overwrites the page with it. The conversation stays saved with the page.
 */
export function RonWriter({ editor, target, goal = false, onClose, disabled, conversations }: {
  editor: Editor | null
  /** Read when the request is sent, so the newest title and facts are used. */
  target: () => RonWritingTarget
  goal?: boolean
  onClose: () => void
  disabled?: boolean
  conversations?: PageConversations
}) {
  const agent = useDocumentAgent(editor, target, conversations)
  return (
    <RonDraftChat agent={agent} editor={editor} noun="page" suggestions={SUGGESTIONS} initialGoal={goal}
      onApplied={onClose} onClose={onClose} disabled={disabled} />
  )
}
