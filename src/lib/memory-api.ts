/**
 * Renderer client for the user's long-term memory (`agent/api/endpoints/memory.py`): list the
 * stores, read a store's entries, add, edit and delete. The owner is the signed-in Supabase user
 * (bearer token); guests cannot use memory. No React, no `@/` imports (node-testable).
 */

export type MemoryCategory = 'facts' | 'remember' | 'feedback' | 'tasks'

export const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  facts: 'Facts',
  remember: 'Remembered',
  feedback: 'Feedback',
  tasks: 'Tasks',
}

export interface MemoryStoreSummary { name: string; description: string; count: number }
export interface MemoryEntry { store: string; key: string; content: string }

type Session = { user: { id: string }; access_token: string } | null

export const SIGN_IN_MESSAGE = 'Sign in to Ren to see and edit what it remembers.'

export function memoryHeaders(userId: string, session: Session): Record<string, string> {
  if (!session || session.user.id !== userId) throw new Error(SIGN_IN_MESSAGE)
  return { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
}

export type MemoryRequest = <T>(path: string, method?: string, body?: unknown) => Promise<T>

export function createMemoryRequest(baseUrl: string, getSession: () => Promise<Session>, userId: string,
                                    fetcher: typeof fetch = fetch): MemoryRequest {
  return async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    const headers = memoryHeaders(userId, await getSession())
    let response: Response
    try {
      response = await fetcher(`${baseUrl.replace(/\/$/, '')}/memory${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
      })
    } catch {
      throw new Error('Cannot reach the memory backend.')
    }
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = typeof data === 'object' && data !== null ? (data as { detail?: unknown }).detail : undefined
      throw new Error(typeof detail === 'string' ? detail : `Memory request failed (${response.status})`)
    }
    return data as T
  }
}

const query = (params: Record<string, string>) => `?${new URLSearchParams(params).toString()}`

export const memoryStores = (request: MemoryRequest) => request<{ stores: MemoryStoreSummary[] }>('/stores')
export const memoryEntries = (request: MemoryRequest, store: string) =>
  request<{ store: string; entries: MemoryEntry[] }>(`/entries${query({ store })}`)
export const memoryAdd = (request: MemoryRequest, store: string, content: string) =>
  request<{ store: string; key: string }>('/entries', 'POST', { store, content })
export const memoryUpdate = (request: MemoryRequest, store: string, key: string, content: string) =>
  request<{ store: string; key: string }>('/entries', 'PUT', { store, key, content })
export const memoryDelete = (request: MemoryRequest, store: string, key: string) =>
  request<{ deleted: boolean }>(`/entries${query({ store, key })}`, 'DELETE')

/** The store's native first-line heading (`# Subject`), or the file name without `.md`. */
export function entryTitle(entry: MemoryEntry): string {
  const first = entry.content.split('\n', 1)[0]?.trim() ?? ''
  return first.startsWith('#') ? first.replace(/^#+\s*/, '') : entry.key.replace(/\.md$/, '')
}

/** Everything below the heading line. */
export function entryBody(entry: MemoryEntry): string {
  const lines = entry.content.split('\n')
  return (lines[0]?.trim().startsWith('#') ? lines.slice(1) : lines).join('\n').trim()
}

/** New-entry content in the store's native shape: a `# Subject` heading, then the facts. */
export function composeEntry(subject: string, body: string): string {
  const heading = subject.trim()
  if (!heading) throw new Error('Give the memory a subject.')
  const text = body.trim()
  if (!text) throw new Error('Write what Ren should remember.')
  return `# ${heading}\n${text}`
}
