/**
 * Renderer entry for Electron's isolated `ContextSurface` WebContentsViews
 * (`context-surface.html?surface=widget` and `context-surface.html?surface=discovery`).
 *
 * Mirrors theme classes and Zustand store slices from `mainWindow.webContents` and forwards
 * all mutations/actions back over `window.contextSurface` (`connect-src 'none'`).
 */
import React, { useCallback, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter/opsz.css'
import '@fontsource-variable/bricolage-grotesque/standard.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './index.css'
import { SurfaceAgentUiProvider } from './context/AgentUiContext'
import { InterestDiscoveryPanel } from './components/interests/InterestDiscoveryPanel'
import { InterestsWidgetSurface } from './components/interests/InterestsWidget'
import type { ContextSurfaceRelayedAction } from './components/interests/ContextSurfaceBridge'
import type { ContextItem } from './lib/context-api'
import { useAuthStore } from './stores/authStore'
import { useContextAgentStore } from './stores/contextAgentStore'
import { useInterestDiscoveryStore } from './stores/interestDiscoveryStore'
import { useInterestsStore } from './stores/interestsStore'
import { usePanelAgentStore } from './stores/panelAgentStore'
import { projectsStoreApi } from './stores/projectsStore'
import { useUserPreferencesStore } from './stores/userPreferencesStore'

interface ContextSurfacePreload {
  onState: (callback: (state: unknown) => void) => () => void
  dispatch: (action: ContextSurfaceRelayedAction) => Promise<unknown>
}

function getPreload(): ContextSurfacePreload | undefined {
  return (window as unknown as { contextSurface?: ContextSurfacePreload }).contextSurface
}

function sendAction(action: ContextSurfaceRelayedAction): Promise<unknown> {
  return getPreload()?.dispatch(action) ?? Promise.resolve(null)
}

function installStoreActionForwarders() {
  useInterestsStore.setState({
    toggleExpanded: () => {
      const next = !useInterestsStore.getState().isExpanded
      useInterestsStore.setState({ isExpanded: next })
      void sendAction({ type: 'interests:set-expanded', expanded: next })
    },
    setExpanded: (expanded) => {
      useInterestsStore.setState({ isExpanded: expanded })
      void sendAction({ type: 'interests:set-expanded', expanded })
    },
    initializeFromOnboarding: () => {
      void sendAction({ type: 'interests:init-onboarding' })
    },
  })

  useInterestDiscoveryStore.setState({
    selectInterest: (id, label, category) => {
      useInterestDiscoveryStore.setState({
        selectedInterestId: id,
        selectedInterestLabel: label,
        selectedInterestCategory: category,
        isLoading: true,
      })
      void sendAction({ type: 'discovery:select', id, label, category })
    },
    clearSelection: () => {
      useInterestDiscoveryStore.setState({
        selectedInterestId: null,
        selectedInterestLabel: null,
        selectedInterestCategory: null,
        content: null,
        error: null,
        isLoading: false,
      })
      void sendAction({ type: 'discovery:clear' })
    },
    fetchDiscoveryContent: async () => {},
  })

  useContextAgentStore.setState({
    setTab: (tab) => {
      useContextAgentStore.setState({ tab, ...(tab === 'agents' ? { unseen: false } : {}) })
      void sendAction({ type: 'context:set-tab', tab })
    },
    setPinned: (pinned) => {
      useContextAgentStore.setState({ pinned })
      void sendAction({ type: 'context:set-pinned', pinned })
    },
    setWatchBrowsing: (watch) => {
      useContextAgentStore.setState({ watchBrowsing: watch })
      void sendAction({ type: 'context:set-watch-browsing', watch })
    },
    clearMessages: () => {
      useContextAgentStore.setState({ error: '', notice: '' })
      void sendAction({ type: 'context:clear-messages' })
    },
    yieldToPanel: () => {
      if (!useContextAgentStore.getState().pinned) {
        useInterestsStore.setState({ isExpanded: false })
      }
      void sendAction({ type: 'context:yield-to-panel' })
    },
    flushBrowsing: async (force) => {
      await sendAction({ type: 'context:flush-browsing', force })
    },
    refreshItems: async () => {
      await sendAction({ type: 'context:refresh-items' })
    },
    refreshAgents: async () => {
      await sendAction({ type: 'context:refresh-agents' })
    },
    refreshRuns: async () => {
      await sendAction({ type: 'context:refresh-runs' })
    },
    addContext: async (item) => {
      const res = await sendAction({ type: 'context:add', item })
      return (res as ContextItem | null) ?? null
    },
    removeContext: async (id) => {
      await sendAction({ type: 'context:remove', id })
    },
    captureScreenshot: async (source) => {
      const res = await sendAction({ type: 'context:capture-screenshot', source })
      return (res as ContextItem | null) ?? null
    },
    stopRecording: async () => {
      await sendAction({ type: 'context:stop-recording' })
    },
    approve: async (recommendation) => {
      await sendAction({ type: 'context:approve', recommendation })
    },
    dismiss: (id) => {
      void sendAction({ type: 'context:dismiss', id })
    },
    saveSchedule: async (agent, cadence, task) => {
      await sendAction({ type: 'context:save-schedule', agent, cadence, task })
    },
    runNow: async (agent) => {
      await sendAction({ type: 'context:run-now', agent })
    },
    markRunSeen: async (runId) => {
      await sendAction({ type: 'context:mark-run-seen', runId })
    },
    ask: async (question) => {
      await sendAction({ type: 'context:ask', question })
    },
    cancel: async () => {
      await sendAction({ type: 'context:cancel' })
    },
  })

  projectsStoreApi.setState({
    initialize: async () => {
      await sendAction({ type: 'projects:init' })
    },
  })

  usePanelAgentStore.setState({
    requestAgent: (agent) => {
      void sendAction({ type: 'panel:request-agent', agent })
    },
    requestThread: (sessionId) => {
      void sendAction({ type: 'panel:request-thread', sessionId })
    },
  })
}

installStoreActionForwarders()

function applyMirroredState(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const snap = raw as {
    htmlClassName?: string
    theme?: 'light' | 'dark' | 'glass' | 'system'
    interests?: Record<string, unknown>
    contextAgent?: Record<string, unknown>
    discovery?: Record<string, unknown>
    projects?: Record<string, unknown>
    auth?: Record<string, unknown>
  }

  if (typeof snap.htmlClassName === 'string') {
    document.documentElement.className = snap.htmlClassName
  }
  if (snap.theme) {
    useUserPreferencesStore.setState({ theme: snap.theme })
  }
  if (snap.interests) {
    useInterestsStore.setState(snap.interests as Partial<ReturnType<typeof useInterestsStore.getState>>)
  }
  if (snap.contextAgent) {
    useContextAgentStore.setState(snap.contextAgent as Partial<ReturnType<typeof useContextAgentStore.getState>>)
  }
  if (snap.discovery) {
    useInterestDiscoveryStore.setState(
      snap.discovery as Partial<ReturnType<typeof useInterestDiscoveryStore.getState>>,
    )
  }
  if (snap.projects) {
    projectsStoreApi.setState(snap.projects as Partial<ReturnType<typeof projectsStoreApi.getState>>)
  }
  if (snap.auth) {
    useAuthStore.setState(snap.auth as Partial<ReturnType<typeof useAuthStore.getState>>)
  }
  return true
}

const SURFACE_KIND =
  new URLSearchParams(window.location.search).get('surface') === 'discovery'
    ? 'discovery'
    : 'widget'

function ContextSurfaceApp() {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const preload = getPreload()
    if (!preload) return
    return preload.onState((state) => {
      if (applyMirroredState(state)) {
        setHydrated(true)
      }
    })
  }, [])

  const onOpenPanel = useCallback(() => {
    void sendAction({ type: 'panel:open' })
  }, [])

  const onSendToAgentPanel = useCallback((prompt: string) => {
    void sendAction({ type: 'panel:send', prompt })
  }, [])

  if (!hydrated) return null

  return (
    <SurfaceAgentUiProvider onOpenPanel={onOpenPanel} onSendToAgentPanel={onSendToAgentPanel}>
      <div className="text-ink dark:text-ink-inverse">
        {SURFACE_KIND === 'discovery' ? <InterestDiscoveryPanel /> : <InterestsWidgetSurface />}
      </div>
    </SurfaceAgentUiProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ContextSurfaceApp />
  </React.StrictMode>,
)
