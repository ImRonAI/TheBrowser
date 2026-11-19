import { useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { CHAT_SENT } from '@/lib/context-api'
import { useInterestsStore } from '@/stores/interestsStore'

const FLUSH_CHECK_MS = 20_000
const RUNS_CHECK_MS = 30_000

/**
 * Feeds the Context Agent: the active tab's page visits (title + URL, never page content) and searches, what the user
 * says to Ren's agents in chats, the page context menu's "Add to Ron context" entries, and a timer that sends batched
 * browsing turns and, twice a day, asks for a review. Also keeps the
 * specialists' runs fresh (every 30 s and when the window regains focus), so a finished scheduled run shows as a
 * notification on the orb, as does a dream that filed new memories.
 */
export function ContextBridge() {
  const userId = useAuthStore((state) => state.user?.id || 'default')
  const setUser = useContextAgentStore((state) => state.setUser)

  useEffect(() => { setUser(userId) }, [userId, setUser])

  useEffect(() => {
    const tabs = window.electron?.tabs
    if (!tabs?.onUpdated) return
    return tabs.onUpdated((list) => {
      const active = list.find((tab) => tab.isActive)
      if (active) useContextAgentStore.getState().observeVisit(active.url, active.title)
    })
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void useContextAgentStore.getState().flushBrowsing().then(() => useContextAgentStore.getState().reviewIfDue())
    }, FLUSH_CHECK_MS)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const said = (event: Event) => { if (event instanceof CustomEvent && typeof event.detail === 'string') useContextAgentStore.getState().observeChat(event.detail) }
    window.addEventListener(CHAT_SENT, said)
    return () => window.removeEventListener(CHAT_SENT, said)
  }, [])

  useEffect(() => {
    const refresh = () => {
      void useContextAgentStore.getState().refreshRuns()
      void useContextAgentStore.getState().refreshDream()
    }
    const timer = window.setInterval(refresh, RUNS_CHECK_MS)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [])

  useEffect(() => {
    const browser = window.electron?.browser
    if (!browser?.onContextAdd) return
    return browser.onContextAdd((payload) => {
      const store = useContextAgentStore.getState()
      useInterestsStore.getState().setExpanded(true)
      store.setTab('context')
      if (payload.kind === 'screenshot') {
        void store.captureScreenshot({ url: payload.url, title: payload.title })
        return
      }
      void store.addContext({ kind: payload.kind, title: payload.title, url: payload.url, text: payload.text ?? '' })
    })
  }, [])

  return null
}
