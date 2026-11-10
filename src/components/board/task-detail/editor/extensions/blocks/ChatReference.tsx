import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Cloud, MessageSquareText, Mic, Trash2 } from 'lucide-react'
import { relativeTime } from '@/lib/threads-api'
import { isGuestUserId } from '@/lib/sign-in'
import { useAgentUi } from '@/context/AgentUiContext'
import { useAuthStore } from '@/stores/authStore'
import { usePanelAgentStore } from '@/stores/panelAgentStore'
import { placeBlock } from './commands'
import { BlockFrame, IconButton } from './ui'
import { useThreads } from './workspace'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    chatReference: {
      /** A card for one of the user's Agent Panel threads that reopens it in the panel. */
      insertChatReference: (chat: { sessionId: string; ownerId: string; title: string; messageCount: number; updatedAt: string }) => ReturnType
    }
  }
}

/**
 * NOT NATIVE: a reference to an earlier Agent Panel chat (a thread, `GET /sessions`). The card shows the
 * thread's current title, message count and last activity and opens it in the Agent Panel. Threads are
 * private, so only the account that referenced it (`ownerId`) can open it. Saved as
 * `<div data-type="chat-reference" data-session-id data-owner-id data-title data-message-count data-updated-at>`.
 */
export const ChatReference = Node.create({
  name: 'chatReference',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      sessionId: { default: '', parseHTML: (element) => element.getAttribute('data-session-id') ?? '', renderHTML: (attributes) => ({ 'data-session-id': attributes.sessionId }) },
      ownerId: { default: '', parseHTML: (element) => element.getAttribute('data-owner-id') ?? '', renderHTML: (attributes) => ({ 'data-owner-id': attributes.ownerId }) },
      title: { default: '', parseHTML: (element) => element.getAttribute('data-title') ?? '', renderHTML: (attributes) => ({ 'data-title': attributes.title }) },
      messageCount: { default: 0, parseHTML: (element) => Number(element.getAttribute('data-message-count')) || 0, renderHTML: (attributes) => ({ 'data-message-count': String(attributes.messageCount ?? 0) }) },
      updatedAt: { default: '', parseHTML: (element) => element.getAttribute('data-updated-at') ?? '', renderHTML: (attributes) => ({ 'data-updated-at': attributes.updatedAt }) },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="chat-reference"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'chat-reference' }), `Chat: ${node.attrs.title || 'Untitled thread'}`]
  },

  renderMarkdown: (node) => `Agent Panel chat: "${node.attrs?.title || 'Untitled thread'}" (${node.attrs?.messageCount ?? 0} messages, thread ${node.attrs?.sessionId})`,

  addCommands() {
    return {
      insertChatReference: (chat) => placeBlock((schema) => chat.sessionId ? schema.nodes.chatReference.create(chat) : null),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChatReferenceView)
  },
})

function ChatReferenceView({ node, editor, selected, deleteNode }: NodeViewProps) {
  const userId = useAuthStore((state) => state.user?.id || 'default')
  const { openPanel } = useAgentUi()
  const owner = String(node.attrs.ownerId || '')
  const mine = !isGuestUserId(userId) && owner === userId
  const list = useThreads(mine ? userId : null)
  const thread = list.data.threads.find((item) => item.session_id === node.attrs.sessionId)
  const missing = mine && list.status === 'ready' && !thread
  const title = thread?.title || String(node.attrs.title || 'Untitled thread')
  const count = thread?.message_count ?? Number(node.attrs.messageCount || 0)
  const updatedAt = thread?.updated_at ?? String(node.attrs.updatedAt || '')
  const note = !mine ? (isGuestUserId(userId) ? 'Sign in with the account that wrote this chat to open it.' : 'This chat belongs to another account.')
    : missing ? 'This chat was deleted.' : ''
  const open = () => {
    usePanelAgentStore.getState().requestThread(String(node.attrs.sessionId))
    openPanel()
  }

  return <BlockFrame selected={selected} className="group/chat" data-chat-state={note ? 'unavailable' : thread ? 'live' : 'loading'}>
    <div className="flex items-stretch">
      <button type="button" disabled={!!note} onClick={open} title={note || 'Open this chat in the Agent Panel'}
        className="flex min-w-0 flex-1 items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-surface-800/60">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent dark:text-accent-light">
          {thread?.last_agent === 'live' ? <Mic className="size-3.5" aria-label="Last written by Live" /> : <MessageSquareText className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block truncate text-[14px] font-medium text-ink dark:text-ink-inverse">{title}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-[12px] text-ink-muted dark:text-ink-inverse-muted">
            <span>Agent Panel chat</span>
            <span aria-hidden="true">·</span>
            <span>{count} {count === 1 ? 'message' : 'messages'}</span>
            {updatedAt && <><span aria-hidden="true">·</span><time dateTime={updatedAt} title={new Date(updatedAt).toLocaleString()}>Last active {relativeTime(updatedAt)}</time></>}
            {thread?.browser === 'cloud' && <span className="inline-flex items-center gap-1 text-amber-600"><Cloud className="size-3" />Cloud browser</span>}
          </span>
          {note && <span className="block text-[12px] text-ink-muted dark:text-ink-inverse-muted">{note}</span>}
        </span>
      </button>
      {editor.isEditable && <div className="flex items-start px-1.5 py-2.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/chat:opacity-100">
        <IconButton label="Remove chat reference" className="hover:text-danger" onClick={() => deleteNode()}><Trash2 className="size-3.5" /></IconButton>
      </div>}
    </div>
  </BlockFrame>
}
