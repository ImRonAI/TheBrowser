import { contextBridge, ipcRenderer } from 'electron'

export interface TakeoverBreadcrumb {
  url: string
  title: string
  at: number
}

export interface TakeoverStatePayload {
  success?: boolean
  active: boolean
  url: string
  title: string
  breadcrumbs: TakeoverBreadcrumb[]
}

const electronAPI = {
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),

  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (theme: 'light' | 'dark' | 'glass' | 'system') =>
    ipcRenderer.invoke('set-theme', theme),

  onDeepLink: (callback: (url: string) => void) => {
    const handler = (_: unknown, url: string) => callback(url)
    ipcRenderer.on('deep-link', handler)
    return () => ipcRenderer.removeListener('deep-link', handler)
  },

  // Supabase OAuth: a loopback redirect URL for signInWithOAuth. The provider page opens as a Ron tab.
  auth: {
    oauthRedirect: (): Promise<string> => ipcRenderer.invoke('auth:oauth-redirect'),
  },

  media: {
    ensureAccess: (kind: 'microphone' | 'camera'): Promise<{ status: string; granted: boolean }> =>
      ipcRenderer.invoke('media:ensure-access', kind),
    openSettings: (kind: 'microphone' | 'camera'): Promise<boolean> =>
      ipcRenderer.invoke('media:open-settings', kind),
  },

  browser: {
    navigate: (url: string) => ipcRenderer.invoke('browser:navigate', url),
    search: (query: string, level?: string) => ipcRenderer.invoke('browser:search', query, level),
    goBack: () => ipcRenderer.invoke('browser:go-back'),
    goForward: () => ipcRenderer.invoke('browser:go-forward'),
    reload: () => ipcRenderer.invoke('browser:reload'),
    getUrl: () => ipcRenderer.invoke('browser:get-url'),
    screenshot: () => ipcRenderer.invoke('browser:screenshot'),
    canGoBack: () => ipcRenderer.invoke('browser:can-go-back'),
    canGoForward: () => ipcRenderer.invoke('browser:can-go-forward'),
    setPanelOpen: (isOpen: boolean) => ipcRenderer.invoke('browser:set-panel-open', isOpen),
    setAgentCursor: (point: { x: number; y: number } | null) => ipcRenderer.invoke('browser:set-agent-cursor', point),
    setTakeover: (active: boolean): Promise<TakeoverStatePayload> =>
      ipcRenderer.invoke('browser:set-takeover', active),
    getTakeover: (): Promise<TakeoverStatePayload> =>
      ipcRenderer.invoke('browser:get-takeover'),
    onTakeoverChanged: (callback: (state: TakeoverStatePayload) => void) => {
      const handler = (_: unknown, state: TakeoverStatePayload) => callback(state)
      ipcRenderer.on('browser:takeover-changed', handler)
      return () => ipcRenderer.removeListener('browser:takeover-changed', handler)
    },
    setDrawerHeight: (height: number) => ipcRenderer.invoke('browser:set-drawer-height', height),
    setChromeHeight: (height: number) => ipcRenderer.invoke('browser:set-chrome-height', height),
    setSidebarWidth: (width: number) => ipcRenderer.invoke('browser:set-sidebar-width', width),
    onChromeShortcut: (callback: (data: { shortcut: 'ask-ron' | 'search' | 'toggle-sidebar' | 'focus-url'; selectionText?: string; sourceUrl?: string }) => void) => {
      const handler = (_: unknown, data: { shortcut: 'ask-ron' | 'search' | 'toggle-sidebar' | 'focus-url'; selectionText?: string; sourceUrl?: string }) => callback(data)
      ipcRenderer.on('chrome:shortcut', handler)
      return () => ipcRenderer.removeListener('chrome:shortcut', handler)
    },
    setInterestMenu: (payload: unknown) => ipcRenderer.invoke('interests:set-menu', payload),
    setInterestInset: (width: number) => ipcRenderer.invoke('interests:set-inset', width),
    onInterestAction: (callback: (action: unknown) => void) => {
      const handler = (_: unknown, action: unknown) => callback(action)
      ipcRenderer.on('interests:action', handler)
      return () => ipcRenderer.removeListener('interests:action', handler)
    },
    // "Add to Ron context" from a page's context menu (selection, link, image, video, page, screenshot).
    onContextAdd: (callback: (payload: unknown) => void) => {
      const handler = (_: unknown, payload: unknown) => callback(payload)
      ipcRenderer.on('context:add', handler)
      return () => ipcRenderer.removeListener('context:add', handler)
    },
    // Native repair surface (electron/repair-surface.ts): the shell mirrors the current
    // investigation in; the surface's decisions come back here and the shell calls the API.
    setRepairSurface: (state: unknown) => ipcRenderer.invoke('repair-surface:update', state),
    onRepairAction: (callback: (action: unknown) => void) => {
      const handler = (_: unknown, action: unknown) => callback(action)
      ipcRenderer.on('repair-surface:action', handler)
      return () => ipcRenderer.removeListener('repair-surface:action', handler)
    },

    onUrlChanged: (callback: (url: string) => void) => {
      const handler = (_: unknown, url: string) => callback(url)
      ipcRenderer.on('browser:url-changed', handler)
      return () => ipcRenderer.removeListener('browser:url-changed', handler)
    },

    onNavigationComplete: (callback: (url: string) => void) => {
      const handler = (_: unknown, url: string) => callback(url)
      ipcRenderer.on('browser:navigation-complete', handler)
      return () => ipcRenderer.removeListener('browser:navigation-complete', handler)
    },

    onNavigationError: (callback: (error: { errorCode: number; errorDescription: string; url: string }) => void) => {
      const handler = (_: unknown, error: { errorCode: number; errorDescription: string; url: string }) => callback(error)
      ipcRenderer.on('browser:navigation-error', handler)
      return () => ipcRenderer.removeListener('browser:navigation-error', handler)
    },

    onExternalMode: (callback: (isExternal: boolean) => void) => {
      const handler = (_: unknown, isExternal: boolean) => callback(isExternal)
      ipcRenderer.on('browser:external-mode', handler)
      return () => ipcRenderer.removeListener('browser:external-mode', handler)
    },

    onAskRon: (callback: (data: { selectionText: string; sourceUrl: string; x?: number; y?: number }) => void) => {
      const handler = (_: unknown, data: { selectionText: string; sourceUrl: string; x?: number; y?: number }) => callback(data)
      ipcRenderer.on('agent:ask-ron', handler)
      return () => ipcRenderer.removeListener('agent:ask-ron', handler)
    },
    getPanelContext: () => ipcRenderer.invoke('browser:get-panel-context'),
    setPanelMode: (mode: 'narrow' | 'wide' | 'fullscreen') => ipcRenderer.invoke('browser:set-panel-mode', mode),
    onPanelModeChanged: (callback: (data: { mode: 'narrow' | 'wide' | 'fullscreen'; width: number }) => void) => {
      const handler = (_: unknown, data: { mode: 'narrow' | 'wide' | 'fullscreen'; width: number }) => callback(data)
      ipcRenderer.on('browser:panel-mode-changed', handler)
      return () => ipcRenderer.removeListener('browser:panel-mode-changed', handler)
    },
  },

  onUrlChanged: (callback: (url: string) => void) => {
    const handler = (_: unknown, url: string) => callback(url)
    ipcRenderer.on('browser:url-changed', handler)
    return () => ipcRenderer.removeListener('browser:url-changed', handler)
  },
  onNavigationComplete: (callback: (url: string) => void) => {
    const handler = (_: unknown, url: string) => callback(url)
    ipcRenderer.on('browser:navigation-complete', handler)
    return () => ipcRenderer.removeListener('browser:navigation-complete', handler)
  },
  onNavigationError: (callback: (error: { errorCode: number; errorDescription: string; url: string }) => void) => {
    const handler = (_: unknown, error: { errorCode: number; errorDescription: string; url: string }) => callback(error)
    ipcRenderer.on('browser:navigation-error', handler)
    return () => ipcRenderer.removeListener('browser:navigation-error', handler)
  },

  tabs: {
    create: (url?: string, clientTabId?: string) => ipcRenderer.invoke('create-tab', url, clientTabId),
    close: (tabId: string) => ipcRenderer.invoke('close-tab', tabId),
    switch: (tabId: string) => ipcRenderer.invoke('switch-tab', tabId),
    list: () => ipcRenderer.invoke('tabs:list'),
    getContext: (tabId: string) => ipcRenderer.invoke('tabs:get-context', tabId) as Promise<{ success: boolean; context?: unknown; error?: string }>,
    onUpdated: (callback: (tabs: unknown[]) => void) => {
      const handler = (_: unknown, tabs: unknown[]) => callback(tabs)
      ipcRenderer.on('tabs:updated', handler)
      return () => ipcRenderer.removeListener('tabs:updated', handler)
    },
  },

  navigation: {
    navigate: (url: string) => ipcRenderer.invoke('browser:navigate', url),
    goBack: () => ipcRenderer.invoke('browser:go-back'),
    goForward: () => ipcRenderer.invoke('browser:go-forward'),
    reload: () => ipcRenderer.invoke('browser:reload'),
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
}

export type ElectronAPI = typeof electronAPI

