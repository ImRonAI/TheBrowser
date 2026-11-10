/**
 * Electron Types
 * TypeScript types for Electron API exposed to renderer process
 */

import type { InterestAction, InterestMenuPayload } from '@/lib/interest-menu'

// ============================================
// Browser API Types
// ============================================

export type ChromeShortcut = 'ask-ron' | 'search' | 'toggle-sidebar' | 'focus-url'
export interface ChromeShortcutEvent { shortcut: ChromeShortcut; selectionText?: string; sourceUrl?: string }

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
  setAgentCursor: (point: { x: number; y: number } | null) => Promise<void>
  setTakeover: (active: boolean) => Promise<TakeoverStatePayload>
  getTakeover: () => Promise<TakeoverStatePayload>
  onTakeoverChanged: (callback: (state: TakeoverStatePayload) => void) => () => void
  setDrawerHeight: (height: number) => Promise<{ success: boolean }>
  setChromeHeight: (height: number) => Promise<{ success: boolean }>
  setSidebarWidth: (width: number) => Promise<{ success: boolean }>
  /** ⌘J Ask Ron, ⌘K Search, ⌘\\ sidebar, ⌘L address bar — delivered even while a website has focus. */
  onChromeShortcut: (callback: (data: ChromeShortcutEvent) => void) => () => void
  setInterestMenu: (payload: InterestMenuPayload) => Promise<{ success: boolean }>
  setInterestInset: (width: number) => Promise<{ success: boolean }>
  onInterestAction: (callback: (action: InterestAction) => void) => () => void
  /** "Add to Ron context" chosen in a page's context menu. */
  onContextAdd?: (callback: (payload: ContextAddPayload) => void) => () => void
  /** Native repair surface: mirror the current investigation (`null` hides it). */
  setRepairSurface: (state: { repair: unknown; notification?: { title: string; body: string } | null }) => Promise<{ success: boolean }>
  /** Decisions the user took on the native surface; the shell performs them against the API. */
  onRepairAction: (callback: (action: { type: 'approve' | 'decline' | 'cancel' | 'rollback' | 'open' | 'dismiss'; rev: string }) => void) => () => void
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

    // Supabase OAuth (loopback redirect; the provider page opens as a Ron tab)
    auth: {
      oauthRedirect: () => Promise<string>
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

    // Navigation
    navigation: {
      navigate: (url: string) => Promise<{ success: boolean }>
      goBack: () => Promise<{ success: boolean }>
      goForward: () => Promise<{ success: boolean }>
      reload: () => Promise<{ success: boolean }>
    }

    media?: {
      ensureAccess: (kind: 'microphone' | 'camera') => Promise<{ status: string; granted: boolean }>
      openSettings: (kind: 'microphone' | 'camera') => Promise<boolean>
    }
  }
}

declare global {
  interface Window {
    electron: ElectronWindow['electron']
  }
}

/** Payload of the page context menu's "Add to Ron context" (electron/main.ts `sendContextAdd`). */
export interface ContextAddPayload {
  kind: 'selection' | 'link' | 'image' | 'video' | 'screenshot'
  title: string
  url: string
  text?: string
}
