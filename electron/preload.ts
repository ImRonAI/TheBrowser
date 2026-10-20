import { contextBridge, ipcRenderer } from 'electron'

interface StreamRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: string
}

interface ApiError {
  code: string
  message: string
  status: number
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

  agent: {
    startStream: (streamId: string, request: StreamRequest) =>
      ipcRenderer.invoke('agent:start-stream', streamId, request),
    
    abortStream: (streamId: string) =>
      ipcRenderer.invoke('agent:abort-stream', streamId),
    
    abortAllStreams: () =>
      ipcRenderer.invoke('agent:abort-all-streams'),
    
    onStreamEvent: (callback: (streamId: string, event: unknown) => void) => {
      const handler = (_: unknown, streamId: string, event: unknown) => callback(streamId, event)
      ipcRenderer.on('agent:stream-event', handler)
      return () => ipcRenderer.removeListener('agent:stream-event', handler)
    },
    
    onStreamConnected: (callback: (streamId: string) => void) => {
      const handler = (_: unknown, streamId: string) => callback(streamId)
      ipcRenderer.on('agent:stream-connected', handler)
      return () => ipcRenderer.removeListener('agent:stream-connected', handler)
    },
    
    onStreamComplete: (callback: (streamId: string) => void) => {
      const handler = (_: unknown, streamId: string) => callback(streamId)
      ipcRenderer.on('agent:stream-complete', handler)
      return () => ipcRenderer.removeListener('agent:stream-complete', handler)
    },
    
    onStreamError: (callback: (streamId: string, error: ApiError) => void) => {
      const handler = (_: unknown, streamId: string, error: ApiError) => callback(streamId, error)
      ipcRenderer.on('agent:stream-error', handler)
      return () => ipcRenderer.removeListener('agent:stream-error', handler)
    },
    
    onStreamAborted: (callback: (streamId: string) => void) => {
      const handler = (_: unknown, streamId: string) => callback(streamId)
      ipcRenderer.on('agent:stream-aborted', handler)
      return () => ipcRenderer.removeListener('agent:stream-aborted', handler)
    },
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
    setAgentCursor: (point: { x: number; y: number }) => ipcRenderer.invoke('browser:set-agent-cursor', point),
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
      const handler = (_: unknown, data: any) => callback(data)
      ipcRenderer.on('browser:panel-mode-changed', handler)
      return () => ipcRenderer.removeListener('browser:panel-mode-changed', handler)
    },
  },

  tabs: {
    create: (url?: string, clientTabId?: string) => ipcRenderer.invoke('create-tab', url, clientTabId),
    close: (tabId: string) => ipcRenderer.invoke('close-tab', tabId),
    switch: (tabId: string) => ipcRenderer.invoke('switch-tab', tabId),
    list: () => ipcRenderer.invoke('tabs:list'),
    getContext: (tabId: string) => ipcRenderer.invoke('tabs:get-context', tabId) as Promise<{ success: boolean; context?: any; error?: string }>,
    onUpdated: (callback: (tabs: any[]) => void) => {
      const handler = (_: unknown, tabs: any[]) => callback(tabs)
      ipcRenderer.on('tabs:updated', handler)
      return () => ipcRenderer.removeListener('tabs:updated', handler)
    },
  },

  navigation: {
    navigate: (url: string) => ipcRenderer.invoke('navigate', url),
    goBack: () => ipcRenderer.invoke('go-back'),
    goForward: () => ipcRenderer.invoke('go-forward'),
    reload: () => ipcRenderer.invoke('reload'),
  },

  tools: {
    discover: () => ipcRenderer.invoke('tools:discover'),
    refresh: () => ipcRenderer.invoke('tools:refresh'),
    list: () => ipcRenderer.invoke('tools:list'),
    execute: (toolName: string, args: Record<string, unknown> = {}) => 
      ipcRenderer.invoke('tools:execute', toolName, args),
    onInventoryUpdated: (callback: (tools: any[]) => void) => {
      const handler = (_: unknown, tools: any[]) => callback(tools)
      ipcRenderer.on('tools:inventory-updated', handler)
      return () => ipcRenderer.removeListener('tools:inventory-updated', handler)
    },
    getManifest: () => ipcRenderer.invoke('tools:getManifest'),
    getCustomToolsDir: () => ipcRenderer.invoke('tools:getCustomToolsDir'),
    saveCustomTool: (name: string, code: string) => 
      ipcRenderer.invoke('tools:saveCustomTool', name, code),
  },

  sandbox: {
    getRoot: () => ipcRenderer.invoke('sandbox:get-root'),
    shell: (command: string, args: string[] = [], options?: any) =>
      ipcRenderer.invoke('sandbox:shell', command, args, options),
    listFiles: (relativePath?: string) =>
      ipcRenderer.invoke('sandbox:list-files', relativePath),
    readFile: (filePath: string) =>
      ipcRenderer.invoke('sandbox:read-file', filePath),
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke('sandbox:write-file', filePath, content),
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
