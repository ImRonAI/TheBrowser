import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { useInterestsStore } from '@/stores/interestsStore'

const FLUSH_CHECK_MS = 20_000
const RUNS_CHECK_MS = 30_000

/**
 * Feeds the Context Agent: displayed tabs' page visits (title + URL, never page content,
 * deduplicated per tab so clicking between split panes never re-queues duplicate turns),
 * the page context menu's "Add to Ren context" entries, and periodic run, dream, and review polling.
 */
export function ContextBridge() {
  const userId = useAuthStore((state) => state.user?.id || 'default')
  const setUser = useContextAgentStore((state) => state.setUser)
  const observedByTabRef = useRef<Map<string, string>>(new Map())

  useEffect(() => { setUser(userId) }, [userId, setUser])

  useEffect(() => {
    if (useContextAgentStore.getState().pinned) {
      useInterestsStore.getState().setExpanded(true)
    }
  }, [])

  useEffect(() => {
    const tabs = window.electron?.tabs
    if (!tabs?.onUpdated) return
    return tabs.onUpdated((list) => {
      const seen = observedByTabRef.current
      const liveIds = new Set(list.map((tab) => tab.id))
      for (const id of seen.keys()) {
        if (!liveIds.has(id)) seen.delete(id)
      }
      for (const tab of list) {
        const displayed = tab.isDisplayed ?? tab.isActive
        if (!displayed) continue
        const sig = `${tab.url}\n${tab.title}`
        if (seen.get(tab.id) === sig) continue
        seen.set(tab.id, sig)
        useContextAgentStore.getState().observeVisit(tab.url, tab.title)
      }
    })
  }, [])

  useEffect(() => {
    const tick = () => {
      void useContextAgentStore.getState().flushBrowsing()
      void useContextAgentStore.getState().flushReview()
    }
    const timer = window.setInterval(tick, FLUSH_CHECK_MS)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const refresh = () => {
      void useContextAgentStore.getState().refreshRuns()
      void useContextAgentStore.getState().refreshDream()
      void useContextAgentStore.getState().flushReview()
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
