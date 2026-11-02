/**
 * Threads client: the Supabase read model of the user's native Strands sessions
 * (`GET /sessions`, `GET /sessions/{id}/thread`; `agent/api/core/threads.py`). A thread is one
 * `session_id` shared by the Chat `Agent` and the Live `BidiAgent`; `last_agent` says who wrote
 * last and `browser` which browser the current run drives (`cloud` after a takeover). Pure (no
 * `@/` imports) so `node --experimental-strip-types` can run the colocated test.
 */

export type ThreadAgent = 'chat' | 'live'

export interface ThreadSummary {
  id: string
  session_id: string
  destination: 'panel' | 'search' | 'build'
  title: string
  last_agent: ThreadAgent
  browser: 'user' | 'cloud'
  message_count: number
  created_at: string
  updated_at: string
}

export type ThreadMessageKind = 'user_prompt' | 'assistant_output' | 'reasoning' | 'tool_call' | 'tool_result'

export interface ThreadMessage {
  seq: number
  role: 'user' | 'assistant'
  kind: ThreadMessageKind
  agent: ThreadAgent
  content: Record<string, unknown>[]
  created_at: string
}

export interface Thread extends ThreadSummary { messages: ThreadMessage[] }

export async function listThreads(baseUrl: string, userId: string, destination?: string, fetcher: typeof fetch = fetch):
  Promise<{ threads: ThreadSummary[]; sign_in_required: boolean }> {
  const query = new URLSearchParams({ user_id: userId })
  if (destination) query.set('destination', destination)
  const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/sessions?${query}`, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`Threads request failed (${response.status})`)
  return response.json()
}

export async function readThread(baseUrl: string, userId: string, sessionId: string, fetcher: typeof fetch = fetch): Promise<Thread> {
  const response = await fetcher(
    `${baseUrl.replace(/\/$/, '')}/sessions/${encodeURIComponent(sessionId)}/thread?user_id=${encodeURIComponent(userId)}`,
    { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`Thread request failed (${response.status})`)
  return response.json()
}

/** Relative "2m ago" style label for the list. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
