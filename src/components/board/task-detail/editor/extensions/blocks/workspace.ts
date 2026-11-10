import { useEffect, useSyncExternalStore } from 'react'
import { API_BASE_URL } from '@/lib/api-base'
import { listThreads, type ThreadSummary } from '@/lib/threads-api'
import { listAllDocuments, type ProjectDocumentSummary } from '@/lib/project-documents'
import { projectsRequestFor } from '@/stores/projectsStore'
import { useTabStore } from '@/stores/tabStore'

/**
 * The workspace data the "/" blocks show: every project page the user can open (`GET /projects/documents`)
 * and the user's Agent Panel threads (`GET /sessions`). One request per user is shared by every block and
 * picker on screen; pickers refresh it when they open so a page or chat made a moment ago is listed.
 */
interface Entry<T> { status: 'loading' | 'ready' | 'error'; data: T; error: string; promise?: Promise<void> }

function createCache<T>(load: (userId: string) => Promise<T>, empty: T) {
  const entries = new Map<string, Entry<T>>()
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((listener) => listener())
  const fetch = (userId: string) => {
    const previous = entries.get(userId)
    const entry: Entry<T> = { status: 'loading', data: previous?.data ?? empty, error: '' }
    entry.promise = load(userId)
      .then((data) => { entries.set(userId, { status: 'ready', data, error: '' }) })
      .catch((cause) => { entries.set(userId, { status: 'error', data: previous?.data ?? empty, error: cause instanceof Error ? cause.message : String(cause) }) })
      .finally(emit)
    entries.set(userId, entry)
    emit()
  }
  const idle: Entry<T> = { status: 'loading', data: empty, error: '' }
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    get: (userId: string | null) => (userId ? entries.get(userId) ?? idle : idle),
    ensure: (userId: string | null) => { if (userId && !entries.has(userId)) fetch(userId) },
    refresh: (userId: string | null) => { if (userId && entries.get(userId)?.status !== 'loading') fetch(userId) },
  }
}

export type ThreadList = { threads: ThreadSummary[]; signInRequired: boolean }

const documents = createCache<ProjectDocumentSummary[]>((userId) => listAllDocuments(projectsRequestFor(userId)), [])
const threads = createCache<ThreadList>(async (userId) => {
  const result = await listThreads(API_BASE_URL, userId, 'panel')
  return { threads: result.threads, signInRequired: result.sign_in_required }
}, { threads: [], signInRequired: false })

function useCached<T>(cache: ReturnType<typeof createCache<T>>, userId: string | null, fresh: boolean) {
  const entry = useSyncExternalStore(cache.subscribe, () => cache.get(userId))
  useEffect(() => {
    if (fresh) cache.refresh(userId)
    else cache.ensure(userId)
  }, [cache, userId, fresh])
  return entry
}

/** Every page the user can access (across projects). `fresh` refetches once on mount (pickers). */
export const useProjectPages = (userId: string | null, fresh = false) => useCached(documents, userId, fresh)
/** The user's Agent Panel threads. Guests get `signInRequired`. */
export const useThreads = (userId: string | null, fresh = false) => useCached(threads, userId, fresh)

/** Open a `ron://` page in the current tab: Electron navigates the tab; the renderer alone updates its tab store. */
export function openInternalUrl(url: string) {
  const navigate = window.electron?.browser?.navigate
  if (navigate) { void navigate(url); return }
  const tabs = useTabStore.getState()
  if (tabs.activeTabId) tabs.updateTab(tabs.activeTabId, { url, title: url })
  else tabs.createTab(url, true)
}

/** Open an https link in a new tab (Electron turns `window.open` from the chrome into an app tab). */
export function openExternalUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}
