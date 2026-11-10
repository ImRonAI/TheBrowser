import { useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { useInterestsStore } from '@/stores/interestsStore'

const FLUSH_CHECK_MS = 20_000

/**
 * Feeds the Context Agent: the active tab's page visits (title + URL, never page content), the page
 * context menu's "Add to Ron context" entries, and a timer that sends batched browsing turns.
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
    const timer = window.setInterval(() => { void useContextAgentStore.getState().flushBrowsing() }, FLUSH_CHECK_MS)
    return () => window.clearInterval(timer)
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
