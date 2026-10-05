/**
 * Electron Types
 * TypeScript types for Electron API exposed to renderer process
 */

import type { InterestAction, InterestMenuPayload } from '@/lib/interest-menu'

// ============================================
// Browser API Types
// ============================================

export interface BrowserAPI {
  navigate: (url: string) => Promise<{ success: boolean; url?: string; isExternal?: boolean }>
  search: (query: string, level?: string) => Promise<{ success: boolean; url?: string }>
  goBack: () => Promise<{ success: boolean }>
  goForward: () => Promise<{ success: boolean }>
  reload: () => Promise<{ success: boolean }>
  getUrl: () => Promise<string>
  screenshot: () => Promise<string>
  canGoBack: () => Promise<boolean>
  canGoForward: () => Promise<boolean>
  setPanelOpen: (isOpen: boolean) => Promise<{ success: boolean }>
  setAgentCursor: (point: { x: number; y: number }) => Promise<void>
  setDrawerHeight: (height: number) => Promise<{ success: boolean }>
  setChromeHeight: (height: number) => Promise<{ success: boolean }>
  setInterestMenu: (payload: InterestMenuPayload) => Promise<{ success: boolean }>
  setInterestInset: (width: number) => Promise<{ success: boolean }>
  onInterestAction: (callback: (action: InterestAction) => void) => () => void
  getPanelContext: () => Promise<any>
  setPanelMode: (mode: 'narrow' | 'wide' | 'fullscreen') => Promise<void>
  onPanelModeChanged: (callback: (data: { mode: 'narrow' | 'wide' | 'fullscreen'; width: number }) => void) => () => void
  
  // Event listeners for browser state
  onUrlChanged: (callback: (url: string) => void) => () => void
  onNavigationComplete: (callback: (url: string) => void) => () => void
  onNavigationError: (callback: (error: { errorCode: number; errorDescription: string; url: string }) => void) => () => void
  onExternalMode: (callback: (isExternal: boolean) => void) => () => void
  onAskRon: (callback: (data: { selectionText: string; sourceUrl: string; x?: number; y?: number }) => void) => () => void
}

  // ============================================
  // Electron Window Interface
  // ============================================

export type TabSummary = { id: string; url: string; title: string; favicon?: string; isActive: boolean }
export type TabContext = {
  id: string
  url: string
  title: string
  favicon?: string
  isExternal: boolean
  dom?: { html: string; text: string; metas: Array<{ name: string; content: string }>; localStorage: Record<string, string | null>; sessionStorage: Record<string, string | null> }
  cookies?: Array<{ name: string; value: string; domain?: string; path?: string }>
  screenshot?: string // base64 PNG
}

export interface ElectronWindow {
  electron: {
    // Window Controls
    minimizeWindow: () => void
    maximizeWindow: () => void
    closeWindow: () => void

    // Theme Management
    getTheme: () => Promise<'light' | 'dark' | 'glass' | 'system'>
    setTheme: (theme: 'light' | 'dark' | 'glass' | 'system') => Promise<void>

    // Deep Links
    onDeepLink: (callback: (url: string) => void) => () => void

    // Agent Streaming
    agent: {
      startStream: (streamId: string, request: {
        url: string
        method: string
        headers: Record<string, string>
        body: string
      }) => Promise<{ success: boolean }>
      abortStream: (streamId: string) => Promise<{ success: boolean }>
      abortAllStreams: () => Promise<{ success: boolean }>

      // Event listeners
      onStreamEvent: (callback: (streamId: string, event: unknown) => void) => () => void
      onStreamConnected: (callback: (streamId: string) => void) => () => void
      onStreamComplete: (callback: (streamId: string) => void) => () => void
      onStreamError: (callback: (streamId: string, error: {
        code: string
        message: string
        status: number
      }) => void) => () => void
      onStreamAborted: (callback: (streamId: string) => void) => () => void
    }

    // Browser Navigation
    browser: BrowserAPI

    // Event listeners for browser state
    onUrlChanged: (callback: (url: string) => void) => () => void
    onNavigationComplete: (callback: (url: string) => void) => () => void
    onNavigationError: (callback: (error: { errorCode: number; errorDescription: string; url: string }) => void) => () => void

    // Tab Management
    tabs: {
      create: (url?: string, clientTabId?: string) => Promise<{ tabId: string; url: string }>
      close: (tabId: string) => Promise<{ success: boolean }>
      switch: (tabId: string) => Promise<{ success: boolean }>
      list: () => Promise<TabSummary[]>
      getContext: (tabId: string) => Promise<{ success: boolean; context?: TabContext; error?: string }>
      onUpdated: (callback: (tabs: TabSummary[]) => void) => () => void
    }

    // Navigation (Future)
    navigation: {
      navigate: (url: string) => Promise<{ success: boolean }>
      goBack: () => Promise<{ success: boolean }>
      goForward: () => Promise<{ success: boolean }>
      reload: () => Promise<{ success: boolean }>
    }
  }
}

declare global {
  interface Window {
    electron: ElectronWindow['electron']
  }
}
