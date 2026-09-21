import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { TrashIcon, ChatBubbleLeftIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/button'

const API_BASE_URL = import.meta.env.VITE_SEARCH_API_URL || 'http://localhost:8765'

export interface ChatSessionSummary {
  session_id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
  agent_type: string
}

interface ChatHistoryProps {
  isOpen: boolean
  onClose: () => void
  onSelectSession: (sessionId: string) => void
  currentSessionId: string | null
}

export function ChatHistory({ isOpen, onClose, onSelectSession, currentSessionId }: ChatHistoryProps) {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isOpen) {
      fetchSessions()
    }
  }, [isOpen])

  const fetchSessions = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/chat-sessions`)
      if (res.ok) {
        const data = await res.json()
        setSessions(data)
      }
    } catch (err) {
      console.error('Failed to fetch chat history:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    if (!confirm('Are you sure you want to delete this chat?')) return

    try {
      const res = await fetch(`${API_BASE_URL}/chat-sessions/${sessionId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setSessions(prev => prev.filter(s => s.session_id !== sessionId))
        if (currentSessionId === sessionId) {
          // If deleted current session, maybe notify parent?
          // For now just keep it in UI state until user navigates away or selects another
        }
      }
    } catch (err) {
      console.error('Failed to delete session:', err)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 z-40 bg-black/20 dark:bg-black/50 backdrop-blur-sm"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="absolute top-0 left-0 bottom-0 z-50 w-80 bg-surface-0 dark:bg-surface-900 border-r border-surface-200 dark:border-surface-800 shadow-xl flex flex-col"
          >
            <div className="p-4 border-b border-surface-200 dark:border-surface-800 flex items-center justify-between">
              <h2 className="text-lg font-medium text-ink dark:text-ink-inverse">Chat History</h2>
              <Button variant="ghost" size="sm" onClick={onClose} className="rounded-full h-8 w-8 p-0 text-ink-muted dark:text-ink-inverse-muted">
                <XMarkIcon className="w-5 h-5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {loading ? (
                <div className="text-center py-8 text-ink-muted dark:text-ink-inverse-muted text-sm">
                  Loading history...
                </div>
              ) : sessions.length === 0 ? (
                <div className="text-center py-8 text-ink-muted dark:text-ink-inverse-muted text-sm">
                  No saved chats found.
                </div>
              ) : (
                sessions.map(session => (
                  <div
                    key={session.session_id}
                    onClick={() => {
                      onSelectSession(session.session_id)
                      onClose()
                    }}
                    className={cn(
                      "group flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-colors border",
                      currentSessionId === session.session_id
                        ? "bg-primary/5 dark:bg-primary/10 border-primary/20"
                        : "hover:bg-surface-50 dark:hover:bg-surface-800 border-transparent hover:border-surface-200 dark:hover:border-surface-700"
                    )}
                  >
                    <ChatBubbleLeftIcon className={cn(
                      "w-5 h-5 mt-0.5",
                      currentSessionId === session.session_id ? "text-primary" : "text-ink-muted dark:text-ink-inverse-muted"
                    )} />
                    
                    <div className="flex-1 min-w-0">
                      <h3 className={cn(
                        "text-sm font-medium truncate",
                        currentSessionId === session.session_id ? "text-primary" : "text-ink dark:text-ink-inverse"
                      )}>
                        {session.title || "Untitled Chat"}
                      </h3>
                      <p className="text-xs text-ink-muted dark:text-ink-inverse-muted mt-0.5">
                        {new Date(session.updated_at).toLocaleDateString()} · {session.message_count} messages
                      </p>
                    </div>

                    <button
                      onClick={(e) => handleDelete(e, session.session_id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-ink-muted dark:text-ink-inverse-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                      title="Delete chat"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
