import { useEffect, useState } from 'react'
import { CloudIcon, MessageSquareIcon, MicIcon } from 'lucide-react'
import { API_BASE_URL } from '@/lib/api-base'
import { listThreads, relativeTime, type ThreadSummary } from '@/lib/threads-api'
import { isGuestUserId, openSignIn } from '@/lib/sign-in'
import { Button } from '@/components/ui/button'
import { cn } from '@/utils/cn'
import { useContextAgentStore } from '@/stores/contextAgentStore'

/**
 * The user's threads (native Strands sessions, read from Supabase). Picking one opens it in the
 * current agent view: Chat restores it through `GET /sessions/{id}` + the SDK snapshot; Live opens
 * the same `session_id` and its BidiAgent restores the same snapshot. A thread continued on the
 * cloud browser after a takeover is marked so the user knows it is not driving this window.
 */
export function ThreadsList({ userId, destination, currentId, onOpen, onClose }: {
  userId: string
  destination: string
  currentId: string
  onOpen: (sessionId: string) => void
  onClose: () => void
}) {
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const signedIn = !isGuestUserId(userId)
  const addContext = useContextAgentStore((state) => state.addContext)

  useEffect(() => {
    if (!signedIn) { setLoading(false); return }
    let live = true
    listThreads(API_BASE_URL, userId, destination)
      .then((result) => { if (live) setThreads(result.threads) })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Could not load threads.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [userId, destination, signedIn])

  return <section aria-label="Threads" className="mx-4 mb-3 rounded-xl border border-surface-200 bg-white/70 p-2 text-xs dark:border-surface-700 dark:bg-surface-850/70">
    <div className="mb-2 flex items-center justify-between px-1">
      <p className="font-semibold">Threads</p>
      <Button type="button" size="sm" variant="ghost" onClick={onClose}>Close</Button>
    </div>
    {!signedIn && <p className="flex flex-wrap items-center gap-2 px-1 text-ink-muted dark:text-ink-inverse-muted">
      <span>Sign in to keep threads across devices and pick them up later.</span>
      <Button type="button" size="sm" variant="outline" onClick={() => openSignIn()}>Sign in</Button>
    </p>}
    {loading && signedIn && <p className="px-1 text-ink-muted dark:text-ink-inverse-muted">Loading…</p>}
    {error && <p role="alert" className="px-1 text-red-700 dark:text-red-300">{error}</p>}
    {signedIn && !loading && !threads.length && !error && <p className="px-1 text-ink-muted dark:text-ink-inverse-muted">No threads yet.</p>}
    <ul className="max-h-64 space-y-1 overflow-y-auto scrollbar-thin">
      {threads.map((thread) => <li key={thread.id} className="group flex items-center gap-1">
        <button type="button" onClick={() => onOpen(thread.session_id)} aria-current={thread.session_id === currentId ? 'true' : undefined}
          className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-indigo-50 dark:hover:bg-surface-800',
            thread.session_id === currentId && 'bg-indigo-50 dark:bg-surface-800')}>
          {thread.last_agent === 'live' ? <MicIcon className="size-3.5 shrink-0 text-indigo-500" aria-label="Last written by Live" />
            : <MessageSquareIcon className="size-3.5 shrink-0 text-ink-muted dark:text-ink-inverse-muted" aria-label="Last written by Chat" />}
          <span className="min-w-0 flex-1 truncate">{thread.title || 'Untitled thread'}</span>
          {thread.browser === 'cloud' && <CloudIcon className="size-3.5 shrink-0 text-amber-600" aria-label="Continued on the cloud browser" />}
          <span className="shrink-0 tabular-nums text-ink-muted dark:text-ink-inverse-muted">{thread.message_count} · {relativeTime(thread.updated_at)}</span>
        </button>
        <button type="button" title="Add this thread to Ren context" aria-label={`Add ${thread.title || 'thread'} to Ren context`}
          onClick={() => void addContext({ kind: 'thread', sessionId: thread.session_id, title: thread.title || 'Chat thread' })}
          className="shrink-0 rounded-md px-1.5 py-1 text-[11px] text-ink-muted opacity-0 hover:bg-indigo-50 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 dark:text-ink-inverse-muted dark:hover:bg-surface-800">+ Context</button>
      </li>)}
    </ul>
  </section>
}
