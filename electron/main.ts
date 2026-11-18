import { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, Menu, NativeImage, nativeImage, nativeTheme, session, shell, systemPreferences, WebContentsView } from 'electron'
import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  registerElectronPlaywrightMcp,
  setActiveWebContentsSupplier,
  setTabController,
  setUserTakeover,
  type AutomationTab,
} from 'electron-playwright-mcp'
import { CURSOR_SVG, CURSOR_TIP } from '../src/lib/agent-cursor'
import {
  SINGLE_SPLIT_STATE,
  SPLIT_PANE_GAP_PX,
  SPLIT_PANE_HEADER_HEIGHT,
  SPLIT_SHELL_PADDING_PX,
  SPLIT_VIEWPORT_INSET_PX,
  SPLIT_VIEWPORT_RADIUS_PX,
  applySplitLayout,
  computeSplitLayoutBounds,
  getSlotForTab,
  getSplitTabIds,
  isTabInSplit,
  isTabSplitDetached,
  positionToSplitSlot,
  removeTabFromSplit,
  selectTabInSplit,
  splitTabIntoZone,
  toSplitSummary,
  type SplitDropZone,
  type SplitLayoutPreset,
  type SplitState,
} from '../src/lib/tab-split'
import { ContextSurface, contextSurfaceEntry, type ContextSurfaceSnapshot } from './context-surface'
import { RepairSurface, surfaceEntry, type RepairSurfaceState } from './repair-surface'
import { SplitDropSurface } from './split-drop-surface'
import { applyWindowMaterial } from './window-material'

const __filename = fileURLToPath(import.meta.url)
const __dirname = join(__filename, '..')

const ELECTRON_PORT = Number(process.env.ELECTRON_PLAYWRIGHT_MCP_ELECTRON_PORT) || 3000
const PLAYWRIGHT_PORT = Number(process.env.ELECTRON_PLAYWRIGHT_MCP_PLAYWRIGHT_PORT) || 8931
const CDP_PORT = Number(process.env.ELECTRON_PLAYWRIGHT_MCP_CDP_PORT) || 9222
// Single source of truth for the automation session. The MCP cookie/storage tools resolve
// their session via session.fromPartition(SESSION_PARTITION), so every WebContentsView tab
// MUST be created with this same partition or those tools read the wrong store.
const SESSION_PARTITION = 'persist:default'
const CHROME_HEIGHT = 88
// The navigation drawer was replaced by a left sidebar (2026 redesign). The IPC
// still exists for older renderers; a renderer that never reports it reserves 0.
const COLLAPSED_DRAWER_HEIGHT = 0
let agentPanelWidth = 420
let currentPanelMode: 'narrow' | 'wide' | 'fullscreen' = 'narrow'
let drawerHeight = COLLAPSED_DRAWER_HEIGHT
let chromeHeight = CHROME_HEIGHT
let rightSideInset = 0
let hasExplicitSideInset = false
let isShellMounted = true
// Width (CSS px) of the persistent left sidebar; 0 when it is closed.
let sidebarWidth = 0
let userTakeoverActive = false
let takeoverBreadcrumbs: Array<{ url: string; title: string }> = []

function recordTakeoverBreadcrumb(url: string, title: string) {
  if (!userTakeoverActive || !url || url === 'about:blank') return
  const last = takeoverBreadcrumbs[takeoverBreadcrumbs.length - 1]
  if (last && last.url === url) {
    last.title = title || last.title
    return
  }
  takeoverBreadcrumbs.push({ url, title: title || url })
  if (takeoverBreadcrumbs.length > 20) takeoverBreadcrumbs.shift()
}

type InterestMenuPayload = {
  interests: Array<{ id: string; label: string; category: string }>
  stories: Array<{
    id: string
    title: string
    url?: string
    interestId: string
    interestLabel: string
    category: string
  }>
  agents: Array<{
    id: string
    name: string
    description: string
    interestId: string
    interestLabel: string
    category: string
  }>
}

type InterestAction =
  | { type: 'open-graph' }
  | { type: 'select'; id: string; label: string; category: string }
  | { type: 'story'; interestId: string; interestLabel: string; category: string; url?: string }
  | { type: 'agent'; name: string; description: string; interestLabel: string }

let interestMenu: InterestMenuPayload = { interests: [], stories: [], agents: [] }

function sendInterestAction(action: InterestAction): void {
  mainWindow?.webContents.send('interests:action', action)
}

/** An item the user chose to add to their Ren context from a page's context menu. */
type ContextAddPayload = { kind: 'selection' | 'link' | 'image' | 'video' | 'screenshot'; title: string; url: string; text?: string }

function sendContextAdd(payload: ContextAddPayload): void {
  mainWindow?.webContents.send('context:add', payload)
}

let mainWindow: BrowserWindow | null = null
let currentTheme: 'light' | 'dark' | 'glass' | 'system' = 'light'
let isAgentPanelOpen = false

// Initialize the automation server (this appends the remote-debugging-port command-line switch synchronously)
const mcpPromise = registerElectronPlaywrightMcp({
  electronPort: ELECTRON_PORT,
  playwrightPort: PLAYWRIGHT_PORT,
  remoteDebuggingPort: CDP_PORT,
  sessionPartition: SESSION_PARTITION,
  requireApproval: false
})


function validateIpcSender(frame: Electron.WebFrameMain | null): boolean {
  if (!frame) return false
  const url = new URL(frame.url)
  return url.protocol === 'file:' || url.origin === process.env.ELECTRON_RENDERER_URL
}

async function ensureMacMediaAccess(kind: 'microphone' | 'camera'): Promise<{ status: string; granted: boolean }> {
  if (process.platform !== 'darwin') return { status: 'granted', granted: true }
  let status = systemPreferences.getMediaAccessStatus(kind)
  if (status === 'not-determined') {
    const granted = await systemPreferences.askForMediaAccess(kind)
    status = granted ? 'granted' : systemPreferences.getMediaAccessStatus(kind)
  }
  return { status, granted: status === 'granted' }
}

function getShellZoomFactor(): number {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return 1
  return mainWindow.webContents.getZoomFactor() || 1
}

function calculateWebContentsViewBounds(): { x: number; y: number; width: number; height: number } {
  if (!mainWindow || mainWindow.isDestroyed()) return { x: 0, y: CHROME_HEIGHT + drawerHeight, width: 800, height: 600 }
  const [windowWidth, windowHeight] = mainWindow.getContentSize()
  // The chrome reports its layout in CSS pixels; the WebContentsView is placed in
  // window DIPs. Websites render across 100% of the shell width (zero interestInset column);
  // the Context Widget floats above via ContextSurface.
  const zoom = getShellZoomFactor()
  const effectiveRightCss = hasExplicitSideInset ? rightSideInset : (isAgentPanelOpen ? agentPanelWidth : 0)
  const rightReserve = Math.ceil(Math.max(0, effectiveRightCss) * zoom)
  const left = Math.ceil(sidebarWidth * zoom)
  const top = Math.ceil((chromeHeight + drawerHeight) * zoom)
  return {
    x: left,
    y: top,
    width: Math.max(0, windowWidth - left - rightReserve),
    height: Math.max(0, windowHeight - top),
  }
}

function calculateChromeBounds(): { x: number; y: number; width: number; height: number } {
  if (!mainWindow || mainWindow.isDestroyed()) return { x: 0, y: 0, width: 800, height: CHROME_HEIGHT }
  const [windowWidth] = mainWindow.getContentSize()
  const zoom = getShellZoomFactor()
  const left = Math.ceil(sidebarWidth * zoom)
  const height = Math.ceil((chromeHeight + drawerHeight) * zoom)
  return { x: left, y: 0, width: Math.max(0, windowWidth - left), height }
}

function raiseAllOverlays(): void {
  repairSurface.raise()
  contextSurface.raise()
  splitDropSurface.raise()
}

function updateWebContentsViewBounds(): void {
  tabsManager.updateActiveViewBounds()
  repairSurface.layout()
  contextSurface.syncZoom()
  contextSurface.layout()
  splitDropSurface.syncZoom()
  splitDropSurface.layout()
}

/**
 * Global chrome shortcuts. They must work while a website (a WebContentsView)
 * has keyboard focus, where the renderer never sees the keydown, so they are
 * read from `before-input-event` on the shell and on every tab view:
 *   ⌘/Ctrl+J  Ask Ren (with the page selection when there is one)
 *   ⌘/Ctrl+K  Search (opens the sidebar and focuses its search field)
 *   ⌘/Ctrl+\  Toggle the sidebar
 *   ⌘/Ctrl+L  Focus the address bar
 */
type ChromeShortcut = 'ask-ron' | 'search' | 'toggle-sidebar' | 'focus-url'

function chromeShortcutFor(input: Electron.Input): ChromeShortcut | null {
  if (input.type !== 'keyDown' || input.isAutoRepeat || input.shift || input.alt) return null
  const mod = process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
  if (!mod) return null
  switch (input.key.toLowerCase()) {
    case 'j': return 'ask-ron'
    case 'k': return 'search'
    case '\\': return 'toggle-sidebar'
    case 'l': return 'focus-url'
    default: return null
  }
}

function sendChromeShortcut(shortcut: ChromeShortcut, page?: WebContentsView): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const shell = mainWindow.webContents
  const deliver = (payload: { shortcut: ChromeShortcut; selectionText?: string; sourceUrl?: string }) => {
    if (shell.isDestroyed()) return
    // Toggling the sidebar leaves keyboard focus on the page; the others move it into the chrome.
    if (payload.shortcut !== 'toggle-sidebar') shell.focus()
    shell.send('chrome:shortcut', payload)
  }
  if (shortcut !== 'ask-ron' || !page || page.webContents.isDestroyed()) {
    deliver({ shortcut })
    return
  }
  const sourceUrl = page.webContents.getURL()
  void page.webContents.executeJavaScriptInIsolatedWorld(1001, [{
    code: '(window.getSelection()?.toString() || "").trim().slice(0, 16000)',
  }]).then((selected: unknown) => {
    deliver({ shortcut, selectionText: typeof selected === 'string' ? selected : '', sourceUrl })
  }).catch(() => deliver({ shortcut, sourceUrl }))
}

function attachChromeShortcuts(
  contents: Electron.WebContents,
  pageOrSupplier?: WebContentsView | (() => WebContentsView | undefined),
): void {
  contents.on('before-input-event', (event, input) => {
    const shortcut = chromeShortcutFor(input)
    if (!shortcut) return
    event.preventDefault()
    const page = typeof pageOrSupplier === 'function' ? pageOrSupplier() : pageOrSupplier
    sendChromeShortcut(shortcut, page)
  })
}

/** Electron `webContents` `context-menu` — same actions as the native-page React menu. */
function attachPageContextMenu(tab: TabRecord): void {
  const view = tab.view
  if (!view) return
  view.webContents.on('before-mouse-event', (_event, mouse) => {
    if (mouse.type !== 'mouseUp' || mouse.button !== 'left' || mouse.clickCount !== 2) return
    const sourceUrl = view.webContents.getURL()
    // Let Chromium finish selecting the word before reading it in an isolated world.
    setImmediate(() => {
      if (!mainWindow?.isFocused() || view.webContents.isDestroyed() || tabsManager.activeTabId !== tab.id) return
      void view.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: `(() => {
        const selection = window.getSelection();
        const node = selection?.anchorNode;
        const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        if (document.activeElement?.matches('input, textarea') || document.activeElement?.isContentEditable ||
            element?.closest('input, textarea') || element?.isContentEditable) return '';
        return (selection?.toString() || '').trim().slice(0, 16000);
      })()` }]).then((selected: unknown) => {
        if (!mainWindow || view.webContents.isDestroyed() || tabsManager.activeTabId !== tab.id ||
            view.webContents.getURL() !== sourceUrl || typeof selected !== 'string' || !selected) return
        const bounds = view.getBounds()
        const x = Math.round(bounds.x + mouse.x)
        const y = Math.round(bounds.y + mouse.y)
        Menu.buildFromTemplate([{
          label: 'Ask Ren about selection',
          click: () => {
            if (view.webContents.isDestroyed() || tabsManager.activeTabId !== tab.id ||
                view.webContents.getURL() !== sourceUrl) return
            mainWindow?.webContents.send('agent:ask-ron', { selectionText: selected, sourceUrl, x, y })
          },
        }]).popup({ window: mainWindow, x, y })
      }).catch(() => { /* Navigation can destroy the frame before selection is read. */ })
    })
  })
  view.webContents.on('context-menu', (_event, params) => {
    if (!mainWindow || view.webContents.isDestroyed()) return
    if (tabsManager.activeTabId !== tab.id && tabsManager.isTabDisplayed(tab.id)) {
      tabsManager.switch(tab.id)
    }
    const selection = params.selectionText.trim()
    const template: Electron.MenuItemConstructorOptions[] = []
    if (selection && params.editFlags.canCopy) {
      template.push({
        label: 'Copy',
        accelerator: 'CmdOrCtrl+C',
        click: () => view.webContents.copy(),
      })
      template.push({
        label: 'Copy as Markdown',
        click: () => clipboard.writeText(`\`${selection}\``),
      })
    }
    if (selection && params.editFlags.canCut) {
      template.push({
        label: 'Cut',
        accelerator: 'CmdOrCtrl+X',
        click: () => view.webContents.cut(),
      })
    }
    if (params.editFlags.canPaste) {
      template.push({
        label: 'Paste',
        accelerator: 'CmdOrCtrl+V',
        click: () => view.webContents.paste(),
      })
    }
    template.push({ type: 'separator' })
    // "Add to Ren context": the shell renderer saves the item (POST /context/items) and tells the Context Agent.
    const pageUrl = tab.url || view.webContents.getURL()
    const pageTitle = tab.title || view.webContents.getTitle()
    const contextItems: Electron.MenuItemConstructorOptions[] = []
    if (selection) contextItems.push({ label: 'Highlighted text', click: () => sendContextAdd({ kind: 'selection', title: pageTitle, text: selection, url: pageUrl }) })
    if (params.linkURL && /^https?:/i.test(params.linkURL)) contextItems.push({ label: 'Link', click: () => sendContextAdd({ kind: 'link', title: params.linkText?.trim() || params.linkURL, url: params.linkURL }) })
    if (params.mediaType === 'image' && /^https?:/i.test(params.srcURL)) contextItems.push({ label: 'Image', click: () => sendContextAdd({ kind: 'image', title: params.titleText?.trim() || params.altText?.trim() || `Image from ${pageTitle}`, url: params.srcURL, text: `Image on ${pageUrl}` }) })
    if (params.mediaType === 'video' && /^https?:/i.test(params.srcURL || pageUrl)) contextItems.push({ label: 'Video', click: () => sendContextAdd({ kind: 'video', title: `Video from ${pageTitle}`, url: /^https?:/i.test(params.srcURL) ? params.srcURL : pageUrl, text: `Video on ${pageUrl}` }) })
    if (/^https?:/i.test(pageUrl)) contextItems.push({ label: 'This page', click: () => sendContextAdd({ kind: 'link', title: pageTitle, url: pageUrl }) })
    contextItems.push({ label: 'Screenshot of this page', click: () => sendContextAdd({ kind: 'screenshot', title: pageTitle, url: pageUrl }) })
    template.push({ label: 'Add to Ren context', submenu: contextItems })
    template.push({
      label: 'Ask Ren',
      click: () => {
        const bounds = view.getBounds()
        mainWindow?.webContents.send('agent:ask-ron', {
          selectionText: selection,
          sourceUrl: tab.url || view.webContents.getURL(),
          x: bounds.x + params.x,
          y: bounds.y + params.y,
        })
      },
    })
    if (interestMenu.interests.length > 0) {
      const stories: Electron.MenuItemConstructorOptions[] = interestMenu.stories.map((story) => ({
        label: story.title.length > 64 ? `${story.title.slice(0, 61)}…` : story.title,
        click: () => sendInterestAction({
          type: 'story',
          interestId: story.interestId,
          interestLabel: story.interestLabel,
          category: story.category,
          url: story.url,
        }),
      }))
      const agents: Electron.MenuItemConstructorOptions[] = interestMenu.agents.map((agent) => ({
        label: agent.name,
        click: () => sendInterestAction({
          type: 'agent',
          name: agent.name,
          description: agent.description,
          interestLabel: agent.interestLabel,
        }),
      }))
      template.push({
        label: 'Your Interests',
        submenu: [
          { label: 'Interest Graph', click: () => sendInterestAction({ type: 'open-graph' }) },
          { type: 'separator' },
          { label: 'Latest Stories', enabled: false },
          ...(stories.length > 0 ? stories : [{ label: 'No stories yet', enabled: false }]),
          { type: 'separator' },
          { label: 'Suggested Agents', enabled: false },
          ...(agents.length > 0 ? agents : [{ label: 'No agents yet', enabled: false }]),
        ],
      })
    }
    const bounds = view.getBounds()
    Menu.buildFromTemplate(template).popup({
      window: mainWindow,
      x: Math.round(bounds.x + params.x),
      y: Math.round(bounds.y + params.y),
    })
  })
}

interface TabRecord {
  id: string
  url: string
  title: string
  favicon?: string
  isExternal: boolean
  view?: WebContentsView
}

function defaultInternalTitle(url: string): string {
  if (url.startsWith('ron://search')) return 'Search'
  if (url.startsWith('ron://research')) return 'Deep Research'
  if (url.startsWith('ron://projects') || url.startsWith('ron://project/')) return 'Projects'
  if (url.startsWith('ron://documents')) return 'Documents'
  if (url.startsWith('ron://execute')) return 'Execute'
  if (url.startsWith('ron://build')) return 'Build'
  if (url.startsWith('ron://home')) return 'Home'
  if (url.startsWith('ron://read')) {
    try { return new URL(url).searchParams.get('title') || 'Article' }
    catch { return 'Article' }
  }
  return 'Ren'
}

class TabsManager {
  private tabs = new Map<string, TabRecord>()
  private order: string[] = []
  private _activeTabId: string | null = null
  private splitState: SplitState = SINGLE_SPLIT_STATE
  private htmlFullscreenTabId: string | null = null
  private programmaticFocusTargetId: string | null = null
  private programmaticFocusTimer: NodeJS.Timeout | null = null

  get activeTabId() { return this._activeTabId }
  get activeTab(): TabRecord | undefined { return this._activeTabId ? this.tabs.get(this._activeTabId) : undefined }
  get split(): SplitState { return this.splitState }

  isTabDisplayed(id: string): boolean {
    if (!isShellMounted || !this.tabs.has(id)) return false
    if (this.htmlFullscreenTabId && this.tabs.get(this.htmlFullscreenTabId)?.isExternal) {
      return id === this.htmlFullscreenTabId
    }
    if (this.splitState.mode === 'single') {
      return id === this._activeTabId
    }
    return isTabInSplit(this.splitState, id)
  }

  list() {
    return this.order.map(id => {
      const t = this.tabs.get(id)!
      const splitPane = getSlotForTab(this.splitState, id)
      return {
        id: t.id,
        url: t.url,
        title: t.title,
        favicon: t.favicon,
        isActive: id === this._activeTabId,
        isDisplayed: this.isTabDisplayed(id),
        isSplitDetached: isTabSplitDetached(this.splitState, id),
        splitPane,
      }
    })
  }

  /** Rule 6: `visible` = true iff the tab's external WebContentsView is attached to `mainWindow.contentView`. */
  isVisible(id: string): boolean {
    const t = this.tabs.get(id)
    if (!t || !t.isExternal || !this.isTabDisplayed(id)) return false
    return Boolean(t.view && mainWindow && !mainWindow.isDestroyed() && mainWindow.contentView.children.includes(t.view))
  }

  focusActiveSurface(): void {
    const tab = this.activeTab
    if (tab) this.focusVisibleSurface(tab)
  }

  create(clientTabId?: string, url = 'ron://home'): TabRecord {
    const id = clientTabId || `tab-${Date.now()}`
    const isExternal = !url.startsWith('ron://') && url !== 'about:blank'
    const record: TabRecord = {
      id,
      url,
      title: isExternal ? 'New Tab' : defaultInternalTitle(url),
      isExternal,
    }
    this.tabs.set(id, record)
    this.order.push(id)

    if (record.isExternal) {
      this.ensureView(record)
      record.view!.webContents.loadURL(url)
    }

    if (!this._activeTabId) this.switch(id)
    this.emitTabsUpdated()
    return record
  }

  private clearAgentCursorFrom(tabId: string | null): void {
    if (!tabId) return
    const prev = this.tabs.get(tabId)
    if (prev?.view && !prev.view.webContents.isDestroyed()) {
      void prev.view.webContents
        .executeJavaScript('document.getElementById("ron-agent-cursor")?.remove()')
        .catch(() => undefined)
    }
  }

  syncVisibleViews(options?: { focusActive?: boolean }): void {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const contentView = mainWindow.contentView

    let visibleIds: Set<string>
    if (!isShellMounted) {
      visibleIds = new Set()
    } else if (this.htmlFullscreenTabId && this.tabs.get(this.htmlFullscreenTabId)?.isExternal) {
      visibleIds = new Set([this.htmlFullscreenTabId])
    } else if (this.splitState.mode === 'single') {
      visibleIds = this._activeTabId ? new Set([this._activeTabId]) : new Set()
    } else {
      visibleIds = new Set(getSplitTabIds(this.splitState))
    }

    for (const existing of this.tabs.values()) {
      const shouldAttach = visibleIds.has(existing.id) && existing.isExternal
      if (existing.view && !shouldAttach) {
        if (!existing.view.webContents.isDestroyed()) {
          existing.view.webContents.setBackgroundThrottling(true)
        }
        if (contentView.children.includes(existing.view)) {
          contentView.removeChildView(existing.view)
        }
      }
    }

    const contentArea = calculateWebContentsViewBounds()
    const zoom = getShellZoomFactor()

    if (isShellMounted) {
      if (this.htmlFullscreenTabId && visibleIds.has(this.htmlFullscreenTabId)) {
        const fsTab = this.tabs.get(this.htmlFullscreenTabId)
        if (fsTab?.isExternal) {
          this.ensureView(fsTab)
          const [windowWidth, windowHeight] = mainWindow.getContentSize()
          if (!fsTab.view!.webContents.isDestroyed()) {
            fsTab.view!.webContents.setBackgroundThrottling(false)
            fsTab.view!.setBorderRadius(0)
            fsTab.view!.setBounds({ x: 0, y: 0, width: windowWidth, height: windowHeight })
          }
          if (!contentView.children.includes(fsTab.view!)) {
            contentView.addChildView(fsTab.view!)
          }
        }
      } else if (this.splitState.mode === 'single') {
        const tab = this.activeTab
        if (tab?.isExternal) {
          this.ensureView(tab)
          if (!tab.view!.webContents.isDestroyed()) {
            tab.view!.webContents.setBackgroundThrottling(false)
            tab.view!.setBorderRadius(0)
            tab.view!.setBounds(contentArea)
          }
          if (!contentView.children.includes(tab.view!)) {
            contentView.addChildView(tab.view!)
          }
        }
      } else {
        const paneHeaderDip = Math.round(SPLIT_PANE_HEADER_HEIGHT * zoom)
        const gapDip = Math.max(1, Math.round(SPLIT_PANE_GAP_PX * zoom))
        const shellPaddingDip = Math.round(SPLIT_SHELL_PADDING_PX * zoom)
        const viewportInsetDip = Math.round(SPLIT_VIEWPORT_INSET_PX * zoom)
        const viewportRadiusDip = Math.max(0, Math.round(SPLIT_VIEWPORT_RADIUS_PX * zoom))
        const panes = computeSplitLayoutBounds(contentArea, this.splitState, paneHeaderDip, gapDip, {
          shellPaddingDip,
          viewportInsetDip,
        })
        for (const pane of panes) {
          const tab = this.tabs.get(pane.tabId)
          if (!tab?.isExternal) continue
          this.ensureView(tab)
          if (!tab.view!.webContents.isDestroyed()) {
            tab.view!.webContents.setBackgroundThrottling(false)
            tab.view!.setBorderRadius(viewportRadiusDip)
            tab.view!.setBounds(pane.webContentsBounds)
          }
          if (!contentView.children.includes(tab.view!)) {
            contentView.addChildView(tab.view!)
          }
        }
      }
    }

    raiseAllOverlays()
    syncWindowMaterial()

    const externalSingleMode = this.splitState.mode === 'single' && Boolean(this.activeTab?.isExternal)
    if (!mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('browser:external-mode', externalSingleMode)
    }

    if (options?.focusActive && this.activeTab && isShellMounted) {
      this.focusVisibleSurface(this.activeTab)
    }
  }

  switch(id: string): boolean {
    const tab = this.tabs.get(id)
    if (!mainWindow || !tab) return false

    if (this._activeTabId && this._activeTabId !== id) {
      this.clearAgentCursorFrom(this._activeTabId)
    }

    this.splitState = selectTabInSplit(this.splitState, id)
    this._activeTabId = id
    this.syncVisibleViews({ focusActive: true })

    mainWindow.webContents.send('browser:url-changed', tab.url)
    this.emitTabsUpdated()
    this.emitSplitUpdated()
    return true
  }

  splitTab(tabId: string, zone: SplitDropZone, source: 'strip' | 'pane' = 'strip') {
    if (!this.tabs.has(tabId)) return { success: false, split: this.splitState }
    const prevActive = this._activeTabId
    const res = splitTabIntoZone(this.splitState, tabId, zone, this.order, this._activeTabId, source)
    this.splitState = res.state
    if (res.activeTabId && this.tabs.has(res.activeTabId)) {
      if (prevActive && prevActive !== res.activeTabId) this.clearAgentCursorFrom(prevActive)
      this._activeTabId = res.activeTabId
    }
    this.syncVisibleViews({ focusActive: true })
    if (this.activeTab) {
      mainWindow?.webContents.send('browser:url-changed', this.activeTab.url)
    }
    this.emitTabsUpdated()
    this.emitSplitUpdated()
    return { success: true, split: this.splitState }
  }

  applySplit(options: { layout: SplitLayoutPreset; tabIds?: string[] }): SplitState {
    const prevActive = this._activeTabId
    const res = applySplitLayout(this.splitState, {
      layout: options.layout,
      tabIds: options.tabIds,
      activeTabId: this._activeTabId,
      orderedTabIds: this.order,
    })
    this.splitState = res.state
    if (res.activeTabId && this.tabs.has(res.activeTabId)) {
      if (prevActive && prevActive !== res.activeTabId) this.clearAgentCursorFrom(prevActive)
      this._activeTabId = res.activeTabId
    }
    this.syncVisibleViews({ focusActive: true })
    if (this.activeTab) {
      mainWindow?.webContents.send('browser:url-changed', this.activeTab.url)
    }
    this.emitTabsUpdated()
    this.emitSplitUpdated()
    return this.splitState
  }

  unsplitTab(tabId?: string, all = false) {
    const prevActive = this._activeTabId
    if (all || !tabId) {
      this.splitState = SINGLE_SPLIT_STATE
    } else {
      const removed = removeTabFromSplit(this.splitState, tabId)
      this.splitState = removed.state
      if (
        this._activeTabId === tabId &&
        removed.survivingActiveTabId &&
        this.tabs.has(removed.survivingActiveTabId)
      ) {
        this.clearAgentCursorFrom(prevActive)
        this._activeTabId = removed.survivingActiveTabId
      }
    }
    this.syncVisibleViews({ focusActive: true })
    if (this.activeTab) {
      mainWindow?.webContents.send('browser:url-changed', this.activeTab.url)
    }
    this.emitTabsUpdated()
    this.emitSplitUpdated()
    return { success: true, split: this.splitState }
  }

  close(id: string): boolean {
    const idx = this.order.indexOf(id)
    const tab = this.tabs.get(id)
    if (idx === -1 || !tab) return false

    if (this.htmlFullscreenTabId === id) {
      this.htmlFullscreenTabId = null
    }

    if (tab.view && !tab.view.webContents.isDestroyed()) {
      try { tab.view.webContents.close() } catch {}
    }

    if (mainWindow && tab.view && mainWindow.contentView.children.includes(tab.view)) {
      mainWindow.contentView.removeChildView(tab.view)
    }

    this.tabs.delete(id)
    this.order.splice(idx, 1)

    const removed = removeTabFromSplit(this.splitState, id)
    this.splitState = removed.state

    if (this._activeTabId === id) {
      const nextId =
        (removed.survivingActiveTabId && this.tabs.has(removed.survivingActiveTabId)
          ? removed.survivingActiveTabId
          : null) ||
        this.order[idx] ||
        this.order[idx - 1] ||
        null
      this._activeTabId = null
      if (nextId) {
        this.switch(nextId)
        return true
      }
      this.syncVisibleViews()
    } else {
      this.syncVisibleViews()
    }

    this.emitTabsUpdated()
    this.emitSplitUpdated()
    return true
  }

  navigateTab(tabId: string, url: string, focusIfActive = false) {
    const tab = this.tabs.get(tabId)
    if (!tab) return { success: false, isExternal: false, url }
    const isActive = this._activeTabId === tab.id
    tab.url = url
    tab.isExternal = !url.startsWith('ron://') && url !== 'about:blank'

    if (tab.isExternal) {
      this.ensureView(tab)
      this.syncVisibleViews({ focusActive: focusIfActive && isActive })
      tab.view!.webContents.loadURL(url)
      this.emitTabsUpdated()
      if (isActive) mainWindow?.webContents.send('browser:url-changed', tab.url)
      return { success: true, isExternal: true, url }
    } else {
      if (this.htmlFullscreenTabId === tab.id) {
        this.htmlFullscreenTabId = null
      }
      if (mainWindow && tab.view && mainWindow.contentView.children.includes(tab.view)) {
        mainWindow.contentView.removeChildView(tab.view)
      }
      // Internal pages are rendered by the shell, not the previous website.
      // Discard that hidden target so MCP cannot report/click it behind Home.
      if (tab.view) {
        if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
        tab.view = undefined
      }
      tab.title = defaultInternalTitle(url)
      this.syncVisibleViews({ focusActive: focusIfActive && isActive })
      this.emitTabsUpdated()
      if (isActive) mainWindow?.webContents.send('browser:url-changed', tab.url)
      return { success: true, isExternal: false, url }
    }
  }

  navigateActive(url: string) {
    if (!this._activeTabId) {
      const created = this.create(undefined, url)
      return { success: true, isExternal: created.isExternal, url: created.url }
    }
    return this.navigateTab(this._activeTabId, url, true)
  }

  goBackActive() {
    const tab = this.activeTab
    if (tab?.view?.webContents.navigationHistory.canGoBack()) { tab.view.webContents.navigationHistory.goBack(); return true }
    return false
  }

  goForwardActive() {
    const tab = this.activeTab
    if (tab?.view?.webContents.navigationHistory.canGoForward()) { tab.view.webContents.navigationHistory.goForward(); return true }
    return false
  }

  canGoBackActive() {
    const tab = this.activeTab
    if (tab?.view && !tab.view.webContents.isDestroyed()) {
      return tab.view.webContents.navigationHistory.canGoBack()
    }
    return false
  }

  canGoForwardActive() {
    const tab = this.activeTab
    if (tab?.view && !tab.view.webContents.isDestroyed()) {
      return tab.view.webContents.navigationHistory.canGoForward()
    }
    return false
  }

  reloadActive() {
    const tab = this.activeTab
    if (tab?.view) { tab.view.webContents.reload(); return true }
    return false
  }

  private ensureView(tab: TabRecord) {
    if (tab.view) return
    tab.view = new WebContentsView({
      webPreferences: {
        partition: SESSION_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false
      }
    })

    const syncNavigation = (url: string) => {
      tab.url = url
      const external = !url.startsWith('ron://') && url !== 'about:blank'
      if (external && !tab.isExternal) {
        tab.isExternal = true
        tab.title = 'New Tab'
        this.syncVisibleViews({ focusActive: this._activeTabId === tab.id })
      }
      recordTakeoverBreadcrumb(url, tab.title)
      this.emitTabsUpdated()
      if (this._activeTabId === tab.id) mainWindow?.webContents.send('browser:url-changed', url)
    }
    tab.view.webContents.on('did-navigate', (_, url) => syncNavigation(url))
    tab.view.webContents.on('did-navigate-in-page', (_, url, isMainFrame) => {
      if (isMainFrame) syncNavigation(url)
    })
    tab.view.webContents.on('did-finish-load', () => {
      if (this._activeTabId === tab.id) {
        mainWindow?.webContents.send('browser:navigation-complete', tab.url)
      }
    })
    tab.view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // Ignore ERR_ABORTED (-3) triggered by rapid navigation redirects.
      if (isMainFrame && errorCode !== -3 && this._activeTabId === tab.id) {
        mainWindow?.webContents.send('browser:navigation-error', {
          errorCode,
          errorDescription,
          url: validatedURL || tab.url,
        })
      }
    })
    tab.view.webContents.on('render-process-gone', (_event, details) => {
      if (details.reason !== 'clean-exit' && this._activeTabId === tab.id) {
        mainWindow?.webContents.send('browser:navigation-error', {
          errorCode: details.exitCode || -1,
          errorDescription: `Tab renderer exited (${details.reason})`,
          url: tab.url,
        })
      }
    })
    tab.view.webContents.on('enter-html-full-screen', () => {
      this.htmlFullscreenTabId = tab.id
      this.syncVisibleViews()
    })
    tab.view.webContents.on('leave-html-full-screen', () => {
      if (this.htmlFullscreenTabId === tab.id) {
        this.htmlFullscreenTabId = null
        this.syncVisibleViews()
      }
    })

    // window.open / target=_blank from page or automation: open as a real app
    // tab (chrome-managed), never a detached BrowserWindow.
    tab.view.webContents.setWindowOpenHandler(({ url }) => {
      const created = this.create(undefined, url)
      this.switch(created.id)
      return { action: 'deny' }
    })
    // Electron webContents `focus` fires when user focus moves between attached split
    // WebContentsViews in this window. Ignore late async focus ACKs from detached background
    // views or superseded programmatic switches so they never hijack `_activeTabId`.
    tab.view.webContents.on('focus', () => {
      if (
        !isShellMounted ||
        !this.isTabDisplayed(tab.id) ||
        !mainWindow ||
        mainWindow.isDestroyed() ||
        !tab.view ||
        !mainWindow.contentView.children.includes(tab.view)
      ) {
        return
      }
      if (this.programmaticFocusTargetId && this.programmaticFocusTargetId !== tab.id) {
        return
      }
      if (this._activeTabId !== tab.id) this.switch(tab.id)
    })
    tab.view.webContents.on('page-title-updated', (_, title) => {
      tab.title = title
      recordTakeoverBreadcrumb(tab.url, title)
      this.emitTabsUpdated()
    })
    tab.view.webContents.on('page-favicon-updated', (_, favs) => {
      tab.favicon = Array.isArray(favs) ? favs[0] : undefined
      this.emitTabsUpdated()
    })
    attachPageContextMenu(tab)
    attachChromeShortcuts(tab.view.webContents, tab.view)
  }

  /** Create (if needed) and return the WebContentsView for a tab -- used by the
   *  automation supplier so MCP navigation always targets tab content, never
   *  the app shell. The view stays detached until a real URL loads; the
   *  did-navigate handler in ensureView attaches it under the chrome. */
  materializeView(id: string): WebContentsView | undefined {
    const tab = this.tabs.get(id)
    if (!tab) return undefined
    this.ensureView(tab)
    if (tab.view && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.setBackgroundThrottling(false)
    }
    // A never-loaded WebContentsView has no renderer or DevTools target; CDP calls against it hang. Give automation a real about:blank document to attach to.
    if (tab.view && tab.view.webContents.getURL() === '') { void tab.view.webContents.loadURL('about:blank') }
    return tab.view
  }

  updateActiveViewBounds() {
    this.syncVisibleViews()
  }

  activeInternalPaneBounds(): { x: number; y: number; width: number; height: number } | null {
    const active = this.activeTab
    if (!active || active.isExternal || this.splitState.mode === 'single') return null
    const zoom = getShellZoomFactor()
    const panes = computeSplitLayoutBounds(
      calculateWebContentsViewBounds(),
      this.splitState,
      Math.round(SPLIT_PANE_HEADER_HEIGHT * zoom),
      Math.max(1, Math.round(SPLIT_PANE_GAP_PX * zoom)),
      {
        shellPaddingDip: Math.round(SPLIT_SHELL_PADDING_PX * zoom),
        viewportInsetDip: Math.round(SPLIT_VIEWPORT_INSET_PX * zoom),
      },
    )
    return panes.find((p) => p.tabId === active.id)?.cellBounds ?? null
  }

  emitTabsUpdated() {
    mainWindow?.webContents.send('tabs:updated', this.list())
  }

  emitSplitUpdated() {
    mainWindow?.webContents.send('tabs:split-updated', this.splitState)
  }

  /** Tab views belong to the main window. When it closes (macOS keeps the app
   *  alive), drop them so a dock reopen starts clean, exactly like a launch. */
  reset() {
    for (const tab of this.tabs.values()) {
      if (tab.view && !tab.view.webContents.isDestroyed()) {
        try { tab.view.webContents.close() } catch {}
      }
    }
    this.tabs.clear()
    this.order = []
    this._activeTabId = null
    this.splitState = SINGLE_SPLIT_STATE
    this.htmlFullscreenTabId = null
    this.programmaticFocusTargetId = null
    if (this.programmaticFocusTimer) {
      clearTimeout(this.programmaticFocusTimer)
      this.programmaticFocusTimer = null
    }
  }

  private focusVisibleSurface(tab: TabRecord) {
    if (!mainWindow || mainWindow.isDestroyed()) return
    this.programmaticFocusTargetId = tab.id
    if (this.programmaticFocusTimer) clearTimeout(this.programmaticFocusTimer)
    this.programmaticFocusTimer = setTimeout(() => {
      if (this.programmaticFocusTargetId === tab.id) {
        this.programmaticFocusTargetId = null
      }
      this.programmaticFocusTimer = null
    }, 80)
    if (tab.isExternal && tab.view && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.focus()
    } else if (!mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.focus()
    }
  }
}

const tabsManager = new TabsManager()

interface PendingContextBridgeCall {
  resolve: (value: unknown) => void
  timer: NodeJS.Timeout
}
const pendingContextBridgeCalls = new Map<string, PendingContextBridgeCall>()
let contextBridgeCallSeq = 0

function invokeShellContextBridge(channel: 'context-surface:action' | 'context-surface:send-to-issue', payload: unknown): Promise<unknown> {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return Promise.resolve(null)
  }
  const requestId = `ctx-${++contextBridgeCallSeq}`
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingContextBridgeCalls.delete(requestId)
      resolve(null)
    }, 30_000)
    pendingContextBridgeCalls.set(requestId, { resolve, timer })
    mainWindow?.webContents.send(channel, { requestId, payload })
  })
}

function clearPendingContextBridgeCalls(): void {
  for (const [, entry] of pendingContextBridgeCalls) {
    clearTimeout(entry.timer)
    entry.resolve(null)
  }
  pendingContextBridgeCalls.clear()
}

// Native repair surface (electron/repair-surface.ts): drawn above the tab views, fed by the shell
// renderer (`repair-surface:update`), its decisions relayed back to the shell (`repair-surface:action`).
const repairSurface = new RepairSurface({
  window: () => mainWindow,
  contentBounds: () => calculateWebContentsViewBounds(),
  onAction: (action) => mainWindow?.webContents.send('repair-surface:action', action),
  entry: () => surfaceEntry(process.env['ELECTRON_RENDERER_URL'], __dirname),
  preload: join(__dirname, 'repair-surface-preload.js'),
})

const contextSurface = new ContextSurface({
  window: () => mainWindow,
  contentBounds: () => calculateWebContentsViewBounds(),
  leftSidebarDip: () => Math.ceil(sidebarWidth * getShellZoomFactor()),
  zoomFactor: () => getShellZoomFactor(),
  isShellMounted: () => isShellMounted,
  entry: () => contextSurfaceEntry(process.env['ELECTRON_RENDERER_URL'], __dirname),
  preload: join(__dirname, 'context-surface-preload.js'),
  attachShortcuts: (wc) => attachChromeShortcuts(wc, () => tabsManager.activeTab?.view),
  openExternalTab: (url) => {
    tabsManager.switch(tabsManager.create(undefined, url).id)
  },
  focusActiveBrowserSurface: () => tabsManager.focusActiveSurface(),
  onOrbClearanceChanged: (clearanceDip) => repairSurface.setOrbClearance(clearanceDip),
  onAction: (action) => invokeShellContextBridge('context-surface:action', action),
  onSendToIssue: async (payload) => {
    const res = await invokeShellContextBridge('context-surface:send-to-issue', payload)
    if (res && typeof res === 'object') return res as { message?: string; error?: string }
    return { error: 'Context bridge did not respond.' }
  },
  onOpenSignIn: () => {
    mainWindow?.webContents.send('context-surface:open-sign-in')
  },
})

const splitDropSurface = new SplitDropSurface({
  window: () => mainWindow,
  contentBounds: () => calculateWebContentsViewBounds(),
  chromeBounds: () => calculateChromeBounds(),
  leftSidebarDip: () => Math.ceil(sidebarWidth * getShellZoomFactor()),
  zoomFactor: () => getShellZoomFactor(),
  splitMode: () => tabsManager.split.mode,
  isDark: () =>
    currentTheme === 'dark' ||
    ((currentTheme === 'system' || currentTheme === 'glass') && nativeTheme.shouldUseDarkColors),
})

// Registered after `tabsManager` is initialized. The supplier is invoked lazily on every
// automation call, so it always resolves the *current* active tab: all playwright_* tools
// therefore act on the real WebContentsView the user is looking at.
//
// The app shell (mainWindow.webContents) is NEVER returned: navigating it would
// replace the entire React chrome -- header, toolbar, and agent panel -- with
// the target page. When the active tab is internal (ron://home has no view
// yet), a tab view is materialized on demand so automation navigates *content*
// exactly like a user navigation, with the chrome persisting above it.
setActiveWebContentsSupplier(() => {
  const activeTab = tabsManager.activeTab
  if (activeTab?.view && !activeTab.view.webContents.isDestroyed()) {
    return activeTab.view.webContents
  }
  if (activeTab) {
    const view = tabsManager.materializeView(activeTab.id)
    if (view) return view.webContents
  }
  // No tab at all: create one (browser behavior -- automation opens a tab).
  const created = tabsManager.create(undefined, 'about:blank')
  const view = tabsManager.materializeView(created.id)
  if (view) return view.webContents
  throw new Error('No active WebContents available for automation')
})

function automationTabs(): AutomationTab[] {
  return tabsManager.list().map((tab, index) => ({
    id: tab.id,
    index,
    url: tab.url,
    title: tab.title,
    active: tab.isActive,
    visible: tabsManager.isVisible(tab.id),
    inSplit: Boolean(tab.splitPane),
    pane: tab.splitPane ?? null,
  }))
}

function tabByIndexOrId(index?: number, id?: string, fallbackActive = false): AutomationTab {
  const listed = automationTabs()
  if (id) {
    const match = listed.find((tab) => tab.id === id)
    if (!match) throw new Error(`No tab with id ${id}`)
    return match
  }
  if (typeof index === 'number') {
    const match = listed[index]
    if (!match) throw new Error(`No tab at index ${index}`)
    return match
  }
  if (fallbackActive) {
    const match = listed.find((tab) => tab.active)
    if (!match) throw new Error('No active tab')
    return match
  }
  throw new Error('Provide index or id')
}

// Every playwright tab/page action goes through TabsManager — the chrome strip.
setTabController({
  list: () => automationTabs(),
  create: (url) => {
    const record = tabsManager.create(undefined, url || 'about:blank')
    tabsManager.switch(record.id)
    const created = automationTabs().find((tab) => tab.id === record.id)
    if (!created) throw new Error('Failed to create tab')
    return created
  },
  select: ({ index, id }) => {
    const tab = tabByIndexOrId(index, id)
    if (!tabsManager.switch(tab.id)) throw new Error('Failed to switch tab')
    const selected = automationTabs().find((entry) => entry.id === tab.id)
    if (!selected) throw new Error('Failed to switch tab')
    return selected
  },
  close: ({ index, id }) => {
    const tab = tabByIndexOrId(index, id, true)
    if (!tabsManager.close(tab.id)) throw new Error('Failed to close tab')
    return { tabs: automationTabs() }
  },
  navigate: ({ url, direction }) => {
    if (url) {
      tabsManager.navigateActive(url)
    } else if (direction === 'back') {
      if (!tabsManager.goBackActive()) throw new Error('Cannot go back')
    } else if (direction === 'forward') {
      if (!tabsManager.goForwardActive()) throw new Error('Cannot go forward')
    } else if (direction === 'reload') {
      if (!tabsManager.reloadActive()) throw new Error('Cannot reload')
    } else {
      throw new Error('Provide url or direction')
    }
    const active = automationTabs().find((tab) => tab.active)
    if (!active) throw new Error('No active tab after navigate')
    return active
  },
  getSplit: () => toSplitSummary(tabsManager.split),
  split: ({ index, id, position, layout, tabIds }) => {
    if (layout) {
      tabsManager.applySplit({ layout, tabIds })
    } else {
      const listed = automationTabs()
      if (listed.length < 2) {
        throw new Error('Cannot split tabs: at least 2 open tabs are required.')
      }
      const target =
        id !== undefined || index !== undefined
          ? tabByIndexOrId(index, id)
          : listed.find((t) => !t.active) || listed[0]
      const slot = positionToSplitSlot(position ?? 'right')
      tabsManager.splitTab(target.id, slot, 'strip')
    }
    return {
      split: toSplitSummary(tabsManager.split),
      tabs: automationTabs(),
    }
  },
  unsplit: ({ index, id, all }) => {
    if (all || (id === undefined && index === undefined)) {
      tabsManager.unsplitTab(undefined, true)
    } else {
      const target = tabByIndexOrId(index, id)
      tabsManager.unsplitTab(target.id, false)
    }
    return {
      split: toSplitSummary(tabsManager.split),
      tabs: automationTabs(),
    }
  },
})

// Browser behavior for "new tab": anything that materializes as a detached
// BrowserWindow (CDP /json/new from cdp_Open_a_new_tab, window.open escapes
// from automation contexts) is adopted as a real app tab -- the stray window
// is destroyed and its URL reopens inside TabsManager, under the chrome,
// with the agent panel untouched.
// `browser-window-created` fires synchronously inside the BrowserWindow
// constructor, i.e. before `mainWindow` is reassigned. Without this flag a
// reopened main window is mistaken for a stray popup, hidden, destroyed, and
// "adopted" as a tab -- which then sizes itself against a destroyed window.
let creatingMainWindow = false

app.on('browser-window-created', (_event, win) => {
  if (creatingMainWindow || !mainWindow || win === mainWindow) return
  const wc = win.webContents
  if ((wc.getType() as string) === 'devtools') return

  let adopted = false
  const adopt = (url: string) => {
    if (adopted) return
    adopted = true
    if (!win.isDestroyed()) win.destroy()
    if (!mainWindow || mainWindow.isDestroyed()) return
    const created = tabsManager.create(undefined, url || 'about:blank')
    tabsManager.switch(created.id)
  }
  // Hide immediately so the stray window never flashes over the app.
  try { win.hide() } catch {}
  wc.once('did-finish-load', () => adopt(wc.getURL()))
  wc.once('did-fail-load', () => adopt(wc.getURL()))
})

async function createWindow() {
  // Start MCP servers without blocking initial window creation & first paint.
  void mcpPromise?.catch((err) => console.error('MCP server startup error:', err))

  let win: BrowserWindow
  creatingMainWindow = true
  try {
    win = new BrowserWindow({
      title: 'Ren',
      width: 1400,
      height: 900,
      minWidth: 800,
      minHeight: 600,
      show: false,
      frame: false, // Frameless UI
      titleBarStyle: 'hidden', // Hidden native title bar
      // Traffic lights centred in the 44px top chrome row.
      trafficLightPosition: { x: 16, y: 15 },
      transparent: true,
      backgroundColor: '#00000000',
      // No `vibrancy` here: the renderer's `set-theme` call picks the material once the
      // page has loaded (Glass: setVibrancy, see electron/window-material.ts). Keep the
      // material active when the window loses focus, or the glass turns into an opaque
      // grey every time another app is in front.
      visualEffectState: 'active',
      webPreferences: {
        preload: join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // Chromium's built-in PDF viewer is an internal plugin; without this a PDF embed block renders blank.
        plugins: true
      }
    })
  } finally {
    creatingMainWindow = false
  }
  mainWindow = win
  attachChromeShortcuts(win.webContents)
  // window.open / target=_blank from the browser chrome itself (links in project pages, issue
  // descriptions, citations): a new app tab, never a detached BrowserWindow. Only web pages open.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) tabsManager.switch(tabsManager.create(undefined, url).id)
    return { action: 'deny' }
  })
  // Electron security checklist §13 (limit navigation): the chrome window only ever shows the app. A frame in
  // it that tries to take over the window (an unsandboxed PDF viewer frame whose link serves a page, a
  // `target=_top` link) is refused; a web link opens as an app tab instead, as window.open does above.
  win.webContents.on('will-navigate', (event) => {
    let url: URL
    try { url = new URL(event.url) } catch { event.preventDefault(); return }
    if (url.protocol === 'file:' || url.origin === process.env.ELECTRON_RENDERER_URL) return
    event.preventDefault()
    if (url.protocol === 'https:' || url.protocol === 'http:') tabsManager.switch(tabsManager.create(undefined, url.href).id)
  })

  const allowedPermissions = new Set([
    'media',
    'audioCapture',
    'videoCapture',
    'display-capture',
    'mediaKeySystem',
    'clipboard-read',
    'clipboard-sanitized-write',
    'fullscreen',
  ])

  win.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (!webContents || webContents.id !== win.webContents.id) return false
    try {
      const url = new URL(requestingOrigin)
      if (url.protocol !== 'file:' && url.origin !== process.env.ELECTRON_RENDERER_URL) return false
    } catch {
      return false
    }
    return allowedPermissions.has(permission)
  })

  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (webContents.id !== win.webContents.id || !allowedPermissions.has(permission)) {
      callback(false)
      return
    }
    if (details.requestingUrl) {
      try {
        const url = new URL(details.requestingUrl)
        if (url.protocol !== 'file:' && url.origin !== process.env.ELECTRON_RENDERER_URL) {
          callback(false)
          return
        }
      } catch {
        callback(false)
        return
      }
    }
    if (permission === 'media' && process.platform === 'darwin') {
      const mediaTypes = 'mediaTypes' in details && Array.isArray(details.mediaTypes) ? details.mediaTypes : ['audio', 'video']
      void (async () => {
        if (mediaTypes.includes('audio')) await ensureMacMediaAccess('microphone')
        if (mediaTypes.includes('video')) await ensureMacMediaAccess('camera')
        callback(true)
      })()
      return
    }
    callback(true)
  })

  // Ensure embedded YouTube iframes inside the reader (`ron://read`) always send a valid HTTPS
  // Referer even when the packaged app loads from `file://` (avoids YouTube player Error 153).
  win.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['*://www.youtube-nocookie.com/embed/*', '*://www.youtube.com/embed/*'] },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders }
      const existing = requestHeaders.Referer || requestHeaders.referer || ''
      if (!existing || existing.startsWith('file:')) {
        delete requestHeaders.referer
        requestHeaders.Referer = 'https://ren.local/'
      }
      callback({ requestHeaders })
    },
  )

  // Lock down permissions on the untrusted web tab partition (`persist:ron-browser`)
  // so external sites cannot auto-grant camera, microphone, geolocation, MIDI, HID, or USB.
  const tabSession = session.fromPartition(SESSION_PARTITION)
  const cleanUa = tabSession.getUserAgent()
    .replace(/\s+Electron\/[^\s]+/g, '')
    .replace(/\s+ronbrowser-rebuilt\/[^\s]+/gi, '')
  tabSession.setUserAgent(cleanUa)
  try {
    tabSession.setCodeCachePath(join(app.getPath('userData'), 'code-cache'))
  } catch {}
  const allowedTabPermissions = new Set(['fullscreen', 'clipboard-sanitized-write'])
  tabSession.setPermissionCheckHandler((_webContents, permission) => {
    return allowedTabPermissions.has(permission)
  })
  tabSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowedTabPermissions.has(permission))
  })

  win.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    const deny = () => {
      try { callback({}) } catch { /* Electron 39 rejects the renderer promise and may throw synchronously here. */ }
    }
    if (!request.userGesture || !validateIpcSender(request.frame) || request.frame !== win.webContents.mainFrame) {
      deny()
      return
    }
    void (async () => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
        if (!sources.length || win.isDestroyed()) { deny(); return }
        const choice = await dialog.showMessageBox(win, {
          type: 'question', title: 'Share your screen with Ren',
          message: 'Choose what to share with Ren',
          detail: 'Ren sees the selected screen or window only while you share it (a live session, a lesson or a screen recording).',
          buttons: ['Cancel', ...sources.map((source) => source.name)],
          cancelId: 0, defaultId: 0, noLink: true,
        })
        const source = sources[choice.response - 1]
        if (source) callback({ video: source })
        else deny()
      } catch (error) {
        console.error('Screen sharing could not start:', error)
        deny()
      }
    })()
  })

  win.on('closed', () => {
    // Never keep a handle to a destroyed window: every `mainWindow?.` call
    // would otherwise throw "Object has been destroyed".
    if (mainWindow === win) {
      clearPendingContextBridgeCalls()
      repairSurface.update({ repair: null })
      contextSurface.reset()
      splitDropSurface.reset()
      mainWindow = null
      isAgentPanelOpen = false
      rightSideInset = 0
      hasExplicitSideInset = false
      sidebarWidth = 0
      chromeHeight = CHROME_HEIGHT
      drawerHeight = COLLAPSED_DRAWER_HEIGHT
      currentPanelMode = 'narrow'
      agentPanelWidth = 420
      isShellMounted = true
      tabsManager.reset()
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('blur', () => {
    splitDropSurface.preview(null)
  })

  mainWindow.on('resize', () => {
    if (mainWindow && !mainWindow.isDestroyed() && currentPanelMode !== 'narrow') {
      const [windowWidth] = mainWindow.getSize()
      const nextWidth = currentPanelMode === 'wide' ? Math.min(800, Math.floor(windowWidth * 0.5)) : windowWidth
      if (nextWidth !== agentPanelWidth) {
        agentPanelWidth = nextWidth
        if (!mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('browser:panel-mode-changed', { mode: currentPanelMode, width: agentPanelWidth })
        }
      }
    }
    updateWebContentsViewBounds()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// createWindow must complete before any tab work: TabsManager.attachIfActive/updateViewBounds/emitTabsUpdated
// all no-op when mainWindow is still null, which would leave the initial tab detached and invisible.
let openingMainWindow: Promise<void> | null = null
function openMainWindow(): Promise<void> {
  if (!openingMainWindow) {
    openingMainWindow = (async () => {
      await createWindow()
      tabsManager.create('tab-initial', 'ron://home')
      tabsManager.switch('tab-initial')
    })().finally(() => { openingMainWindow = null })
  }
  return openingMainWindow
}

/** The Ren mark in the macOS Dock: dev and `npm run start` run the stock Electron bundle, whose icon is Electron's. */
function setDockIcon() {
  if (process.platform !== 'darwin' || !app.dock) return
  const file = [join(app.getAppPath(), 'public', 'ren-app-icon.png'), join(__dirname, '../renderer/ren-app-icon.png')]
    .find((candidate) => existsSync(candidate))
  if (file) app.dock.setIcon(nativeImage.createFromPath(file))
}

app.whenReady().then(() => {
  setDockIcon()
  return openMainWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) void openMainWindow()
})

// Supabase OAuth (PKCE): the provider page loads in a Ron tab. Supabase then redirects to this
// one-shot loopback listener (RFC 8252 §7.3). A ron:// deep link cannot reach Ron on macOS unless
// a packaged Info.plist declares the scheme. The callback URL goes to the renderer, which holds
// the PKCE verifier and calls exchangeCodeForSession. Google and GitHub never see this loopback
// URL; they see https://<project>.supabase.co/auth/v1/callback, which must be registered on
// those OAuth apps.
let oauthServer: Server | null = null

ipcMain.handle('auth:oauth-redirect', async (event) => {
  if (!validateIpcSender(event.senderFrame)) throw new Error('Untrusted sender')
  oauthServer?.close()
  const server = createServer((request, response) => {
    const callback = new URL(request.url ?? '/', `http://${request.headers.host}`)
    if (callback.pathname !== '/auth/callback') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end('<!doctype html><meta charset="utf-8"><title>Ren</title><p style="font:16px system-ui;margin:3rem">Sign-in finished. Returning to Ren.</p>')
    server.close()
    if (oauthServer === server) oauthServer = null
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('deep-link', callback.toString())
      mainWindow.show()
      mainWindow.focus()
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  oauthServer = server
  setTimeout(() => { if (oauthServer === server) { server.close(); oauthServer = null } }, 10 * 60_000).unref()
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('OAuth listener has no port')
  return `http://127.0.0.1:${address.port}/auth/callback`
})

// IPC window controls
ipcMain.on('window-minimize', (event) => {
  if (!validateIpcSender(event.senderFrame)) return
  mainWindow?.minimize()
})

ipcMain.on('window-maximize', (event) => {
  if (!validateIpcSender(event.senderFrame)) return
  if (mainWindow?.isMaximized()) mainWindow?.unmaximize()
  else mainWindow?.maximize()
})

ipcMain.on('window-close', (event) => {
  if (!validateIpcSender(event.senderFrame)) return
  mainWindow?.close()
})

// Theme controls
ipcMain.handle('get-theme', (event) => {
  if (!validateIpcSender(event.senderFrame)) return 'light'
  return currentTheme
})

function syncWindowMaterial(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const dark = currentTheme === 'dark' || (currentTheme === 'system' && nativeTheme.shouldUseDarkColors)
  if (process.platform === 'darwin') {
    nativeTheme.themeSource = currentTheme === 'system' ? 'system' : dark ? 'dark' : 'light'
  }
  const clearSplitShell = isShellMounted && tabsManager.split.mode !== 'single'
  void applyWindowMaterial(mainWindow, currentTheme, dark, clearSplitShell).catch((error) => {
    console.warn('[glass] could not apply window material:', error)
  })
}

ipcMain.handle('set-theme', (event, theme: 'light' | 'dark' | 'glass' | 'system') => {
  if (!validateIpcSender(event.senderFrame)) return currentTheme
  currentTheme = theme
  if (!mainWindow) return theme

  syncWindowMaterial()
  return theme
})

// Navigation controls
ipcMain.handle('browser:navigate', (event, url: string) => {
  if (!validateIpcSender(event.senderFrame)) return
  return tabsManager.navigateActive(url)
})

ipcMain.handle('browser:search', (event, query: string, level?: string) => {
  if (!validateIpcSender(event.senderFrame)) return
  const trimmed = (query || '').trim()
  if (!trimmed) return { success: false }
  const suffix = level ? `&level=${encodeURIComponent(level)}` : ''
  return tabsManager.navigateActive(`ron://search?q=${encodeURIComponent(trimmed)}${suffix}`)
})

ipcMain.handle('browser:go-back', (event) => {
  if (!validateIpcSender(event.senderFrame)) return false
  return tabsManager.goBackActive()
})

ipcMain.handle('browser:go-forward', (event) => {
  if (!validateIpcSender(event.senderFrame)) return false
  return tabsManager.goForwardActive()
})

ipcMain.handle('browser:can-go-back', (event) => {
  if (!validateIpcSender(event.senderFrame)) return false
  return tabsManager.canGoBackActive()
})

ipcMain.handle('browser:can-go-forward', (event) => {
  if (!validateIpcSender(event.senderFrame)) return false
  return tabsManager.canGoForwardActive()
})

ipcMain.handle('browser:reload', (event) => {
  if (!validateIpcSender(event.senderFrame)) return false
  return tabsManager.reloadActive()
})

ipcMain.handle('browser:get-url', (event) => {
  if (!validateIpcSender(event.senderFrame)) return ''
  return tabsManager.activeTab?.url ?? ''
})

ipcMain.handle('browser:set-panel-open', (event, isOpen: boolean) => {
  if (!validateIpcSender(event.senderFrame)) return { success: false }
  isAgentPanelOpen = Boolean(isOpen)
  updateWebContentsViewBounds()
  return { success: true }
})

ipcMain.handle('browser:set-side-inset', (event, width: number) => {
  if (!validateIpcSender(event.senderFrame)) return { success: false }
  hasExplicitSideInset = true
  rightSideInset = Number.isFinite(width) && width > 0 ? width : 0
  isAgentPanelOpen = rightSideInset > 0
  updateWebContentsViewBounds()
  return { success: true }
})

ipcMain.handle('browser:set-shell-mounted', (event, mounted: boolean) => {
  if (!validateIpcSender(event.senderFrame)) return { success: false }
  const next = Boolean(mounted)
  if (isShellMounted === next) return { success: true }
  isShellMounted = next
  if (!next) splitDropSurface.preview(null)
  repairSurface.setShellMounted(next)
  contextSurface.onShellMountedChanged(next)
  tabsManager.updateActiveViewBounds()
  tabsManager.emitTabsUpdated()
  return { success: true }
})

ipcMain.handle('browser:set-agent-cursor', (event, point: { x?: number; y?: number } | null) => {
  if (!validateIpcSender(event.senderFrame)) return
  const view = tabsManager.activeTab?.view
  if (!view || view.webContents.isDestroyed()) return
  const x = !userTakeoverActive && typeof point?.x === 'number' && Number.isFinite(point.x) ? point.x : null
  const y = !userTakeoverActive && typeof point?.y === 'number' && Number.isFinite(point.y) ? point.y : null
  const script = `(() => {
    const existing = document.getElementById('ron-agent-cursor');
    if (${x == null || y == null}) { existing?.remove(); return; }
    let node = existing;
    if (!node || !node.isConnected) {
      node?.remove();
      node = document.createElement('div');
      node.id = 'ron-agent-cursor';
      node.setAttribute('aria-hidden', 'true');
      node.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;';
      node.innerHTML = ${JSON.stringify(CURSOR_SVG)};
      document.documentElement.append(node);
    }
    if (!document.getElementById('ron-agent-cursor-style')) {
      const style = document.createElement('style');
      style.id = 'ron-agent-cursor-style';
      style.textContent = '@keyframes ron-cursor-breathe{0%,100%{opacity:.78}50%{opacity:1}}';
      document.documentElement.append(style);
    }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.style.transition = reduce ? 'none' : 'transform 450ms cubic-bezier(0.16, 1, 0.3, 1)';
    node.style.animation = reduce ? 'none' : 'ron-cursor-breathe 5.5s ease-in-out infinite';
    node.style.transform = ${JSON.stringify(x != null && y != null ? `translate(${x - CURSOR_TIP}px, ${y - CURSOR_TIP}px)` : '')};
  })()`
  void view.webContents.executeJavaScript(script).catch(() => undefined)
})

ipcMain.handle('browser:set-takeover', (event, active: boolean) => {
  if (!validateIpcSender(event.senderFrame)) return { success: false, active: userTakeoverActive }
  userTakeoverActive = Boolean(active)
  setUserTakeover(userTakeoverActive)
  const activeTab = tabsManager.activeTab
  if (userTakeoverActive) {
    takeoverBreadcrumbs = []
    if (activeTab?.url) {
      recordTakeoverBreadcrumb(activeTab.url, activeTab.title)
    }
    if (activeTab?.view && !activeTab.view.webContents.isDestroyed()) {
      void activeTab.view.webContents
        .executeJavaScript('document.getElementById("ron-agent-cursor")?.remove()')
        .catch(() => undefined)
    }
    tabsManager.focusActiveSurface()
  }
  const payload = {
    active: userTakeoverActive,
    url: activeTab?.url ?? '',
    title: activeTab?.title ?? '',
    breadcrumbs: [...takeoverBreadcrumbs],
  }
  mainWindow?.webContents.send('browser:takeover-changed', payload)
  return { success: true, ...payload }
})

ipcMain.handle('browser:get-takeover', (event) => {
  if (!validateIpcSender(event.senderFrame)) return { active: false, url: '', title: '', breadcrumbs: [] }
  const activeTab = tabsManager.activeTab
  return {
    active: userTakeoverActive,
    url: activeTab?.url ?? '',
    title: activeTab?.title ?? '',
    breadcrumbs: [...takeoverBreadcrumbs],
  }
})

ipcMain.handle('browser:set-drawer-height', (event, height: number) => {
  if (!validateIpcSender(event.senderFrame)) return
  drawerHeight = Number.isFinite(height) && height >= 0 ? height : COLLAPSED_DRAWER_HEIGHT
  updateWebContentsViewBounds()
  return { success: true }
})

// Measured header (toolbar + tab strip) height in CSS px. Also sent on every
// renderer resize, which is how shell zoom changes reach the view bounds.
ipcMain.handle('browser:set-chrome-height', (event, height: number) => {
  if (!validateIpcSender(event.senderFrame)) return { success: false }
  chromeHeight = Number.isFinite(height) && height > 0 ? height : CHROME_HEIGHT
  updateWebContentsViewBounds()
  return { success: true }
})

// Measured width of the persistent left sidebar in CSS px (0 = closed).
ipcMain.handle('browser:set-sidebar-width', (event, width: number) => {
  if (!validateIpcSender(event.senderFrame)) return { success: false }
  sidebarWidth = Number.isFinite(width) && width > 0 ? width : 0
  updateWebContentsViewBounds()
  return { success: true }
})

ipcMain.handle('interests:set-menu', (event, payload: InterestMenuPayload) => {
  if (!validateIpcSender(event.senderFrame)) return { success: false }
  if (!payload || !Array.isArray(payload.interests)) return { success: false }
  interestMenu = {
    interests: payload.interests,
    stories: Array.isArray(payload.stories) ? payload.stories : [],
    agents: Array.isArray(payload.agents) ? payload.agents : [],
  }
  return { success: true }
})

ipcMain.handle('interests:set-inset', (event, _width: number) => {
  if (!validateIpcSender(event.senderFrame)) return { success: false }
  // Full-shell rendering: websites never reserve a blank column for the Context Widget.
  return { success: true }
})

ipcMain.handle('context-surface:update', (event, state: ContextSurfaceSnapshot) => {
  if (!validateIpcSender(event.senderFrame) || !mainWindow || event.senderFrame !== mainWindow.webContents.mainFrame) {
    return { success: false }
  }
  if (!state || typeof state !== 'object' || !('layout' in state)) return { success: false }
  contextSurface.update(state)
  return { success: true }
})

ipcMain.on('context-surface:action-result', (event, reply: unknown) => {
  if (!validateIpcSender(event.senderFrame) || !mainWindow || event.senderFrame !== mainWindow.webContents.mainFrame) {
    return
  }
  if (!reply || typeof reply !== 'object') return
  const { requestId, result } = reply as { requestId?: unknown; result?: unknown }
  if (typeof requestId !== 'string') return
  const pending = pendingContextBridgeCalls.get(requestId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingContextBridgeCalls.delete(requestId)
  pending.resolve(result)
})

// Only the shell's main frame may drive the repair surface (never a page or an iframe).
ipcMain.handle('repair-surface:update', (event, state: RepairSurfaceState) => {
  if (!validateIpcSender(event.senderFrame) || !mainWindow || event.senderFrame !== mainWindow.webContents.mainFrame) return { success: false }
  if (!state || typeof state !== 'object' || !('repair' in state)) return { success: false }
  repairSurface.update(state)
  return { success: true }
})

// Tabs IPC
ipcMain.handle('create-tab', (event, url?: string, clientTabId?: string) => {
  if (!validateIpcSender(event.senderFrame)) return { success: false }
  // The record owns a WebContentsView. Returning it makes Electron try to clone that view's Session.
  const created = tabsManager.create(clientTabId, url)
  return { success: true, id: created.id, url: created.url, title: created.title, isExternal: created.isExternal }
})

ipcMain.handle('close-tab', (event, tabId: string) => {
  if (!validateIpcSender(event.senderFrame)) return
  return tabsManager.close(tabId)
})

ipcMain.handle('switch-tab', (event, tabId: string) => {
  if (!validateIpcSender(event.senderFrame)) return
  return tabsManager.switch(tabId)
})

ipcMain.handle('tabs:list', (event) => {
  if (!validateIpcSender(event.senderFrame)) return []
  return tabsManager.list()
})

ipcMain.handle('tabs:get-split', (event) => {
  if (!validateIpcSender(event.senderFrame)) return SINGLE_SPLIT_STATE
  return tabsManager.split
})

ipcMain.handle('tabs:split', (event, tabId: string, zone: SplitDropZone, source?: 'strip' | 'pane') => {
  if (!validateIpcSender(event.senderFrame)) return { success: false, split: SINGLE_SPLIT_STATE }
  splitDropSurface.preview(null)
  return tabsManager.splitTab(tabId, zone, source ?? 'strip')
})

ipcMain.handle('tabs:unsplit', (event, tabId?: string, all?: boolean) => {
  if (!validateIpcSender(event.senderFrame)) return { success: false, split: SINGLE_SPLIT_STATE }
  splitDropSurface.preview(null)
  return tabsManager.unsplitTab(tabId, Boolean(all))
})

ipcMain.handle('tabs:navigate', (event, tabId: string, url: string) => {
  if (!validateIpcSender(event.senderFrame)) return { success: false }
  return tabsManager.navigateTab(tabId, url, false)
})

ipcMain.handle('tabs:preview-split-drop', (event, zone: SplitDropZone | null) => {
  if (!validateIpcSender(event.senderFrame)) return { success: false }
  const validZones = new Set<string>(['regroup', 'left', 'right', 'topLeft', 'bottomLeft', 'topRight', 'bottomRight'])
  splitDropSurface.preview(typeof zone === 'string' && validZones.has(zone) ? zone : null)
  return { success: true }
})

ipcMain.handle('tabs:get-context', async (event, tabId: string) => {
  if (!validateIpcSender(event.senderFrame)) return { success: false, error: 'Unauthorized' }
  const tab = tabsManager.list().find((entry) => entry.id === tabId)
  if (!tab) return { success: false, error: 'Unknown tab' }

  const record = tabsManager.materializeView(tabId)
  const webContents = record?.webContents
  if (!webContents || webContents.isDestroyed()) {
    return {
      success: true,
      context: {
        id: tab.id,
        url: tab.url,
        title: tab.title,
        favicon: tab.favicon,
        isExternal: !tab.url.startsWith('ron://') && tab.url !== 'about:blank',
      },
    }
  }

  let pageText = ''
  let pageHtml = ''
  let metas: Array<{ name: string; content: string }> = []
  try {
    pageText = await webContents.executeJavaScript('document.body?.innerText ?? ""')
  } catch { /* Detached or restricted document. */ }
  try {
    pageHtml = await webContents.executeJavaScript('document.documentElement?.outerHTML ?? ""')
  } catch { /* Detached or restricted document. */ }
  try {
    metas = await webContents.executeJavaScript(`Array.from(document.querySelectorAll('meta[name], meta[property]')).map((node) => ({
      name: node.getAttribute('name') || node.getAttribute('property') || '',
      content: node.getAttribute('content') || '',
    })).filter((entry) => entry.name && entry.content)`)
  } catch { /* Optional metadata. */ }

  return {
    success: true,
    context: {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      isExternal: !tab.url.startsWith('ron://') && tab.url !== 'about:blank',
      dom: { html: pageHtml, text: pageText, metas, localStorage: {}, sessionStorage: {} },
    },
  }
})

ipcMain.handle('browser:get-panel-context', async (event) => {
  if (!validateIpcSender(event.senderFrame)) return null
  
  let selectedText = ''
  let pageText = ''
  let pageHtml = ''
  
  const activeTab = tabsManager.activeTab
  if (activeTab?.view && !activeTab.view.webContents.isDestroyed()) {
    const webContents = activeTab.view.webContents
    try {
      selectedText = await webContents.executeJavaScript('window.getSelection().toString()')
    } catch {}
    try {
      pageText = await webContents.executeJavaScript('document.body.innerText')
    } catch {}
    try {
      pageHtml = await webContents.executeJavaScript('document.documentElement.outerHTML')
    } catch {}
  }

  const [, windowHeight] = mainWindow ? mainWindow.getSize() : [800, 600]

  return {
    url: activeTab?.url ?? '',
    title: activeTab?.title ?? '',
    selected_text: selectedText,
    text: pageText,
    html: pageHtml,
    tabs: tabsManager.list(),
    theme: currentTheme,
    width: agentPanelWidth,
    height: windowHeight,
  }
})

ipcMain.handle('browser:get-html', async (event) => {
  if (!validateIpcSender(event.senderFrame)) return ''
  const activeTab = tabsManager.activeTab
  if (activeTab?.view && !activeTab.view.webContents.isDestroyed()) {
    try {
      return await activeTab.view.webContents.executeJavaScript('document.documentElement.outerHTML')
    } catch {}
  }
  return ''
})

ipcMain.handle('browser:get-text', async (event) => {
  if (!validateIpcSender(event.senderFrame)) return ''
  const activeTab = tabsManager.activeTab
  if (activeTab?.view && !activeTab.view.webContents.isDestroyed()) {
    try {
      return await activeTab.view.webContents.executeJavaScript('document.body.innerText')
    } catch {}
  }
  return ''
})

const jpegDataUrl = (image: NativeImage) => image.isEmpty() ? '' : `data:image/jpeg;base64,${image.toJPEG(70).toString('base64')}`

ipcMain.handle('browser:screenshot', async (event) => {
  if (!validateIpcSender(event.senderFrame)) return ''
  const activeTab = tabsManager.activeTab
  if (activeTab?.view && !activeTab.view.webContents.isDestroyed()) {
    try {
      const page = jpegDataUrl(await activeTab.view.webContents.capturePage(undefined, { stayHidden: true }))
      if (page) return page
    } catch {}
  }
  // Internal tabs (ron://) have no page view. Capture the active split pane cell if split,
  // otherwise capture the window to the left of the side panel.
  if (!mainWindow || mainWindow.isDestroyed()) return ''
  try {
    const paneCell = tabsManager.activeInternalPaneBounds()
    if (paneCell && paneCell.width > 0 && paneCell.height > 0) {
      const image = await mainWindow.webContents.capturePage({
        x: paneCell.x,
        y: paneCell.y,
        width: Math.max(1, paneCell.width),
        height: Math.max(1, paneCell.height),
      })
      return jpegDataUrl(image)
    }
    const [width, height] = mainWindow.getContentSize()
    const zoom = getShellZoomFactor()
    const left = Math.min(Math.ceil(sidebarWidth * zoom), Math.max(0, width - 1))
    const effectiveRightCss = hasExplicitSideInset ? rightSideInset : (isAgentPanelOpen ? agentPanelWidth : 0)
    const panel = Math.min(Math.ceil(effectiveRightCss * zoom), Math.max(0, width - left - 1))
    const image = await mainWindow.webContents.capturePage({ x: left, y: 0, width: Math.max(1, width - left - panel), height: Math.max(1, height) })
    return jpegDataUrl(image)
  } catch {
    return ''
  }
})

ipcMain.handle('browser:set-panel-mode', (event, mode: 'narrow' | 'wide' | 'fullscreen') => {
  if (!validateIpcSender(event.senderFrame)) return
  if (!mainWindow) return

  currentPanelMode = mode
  const [windowWidth] = mainWindow.getSize()
  if (mode === 'narrow') {
    agentPanelWidth = 420
  } else if (mode === 'wide') {
    agentPanelWidth = Math.min(800, Math.floor(windowWidth * 0.5))
  } else if (mode === 'fullscreen') {
    agentPanelWidth = windowWidth
  }

  updateWebContentsViewBounds()
  mainWindow.webContents.send('browser:panel-mode-changed', { mode, width: agentPanelWidth })
})

ipcMain.handle('media:ensure-access', async (event, kind: 'microphone' | 'camera') => {
  if (!validateIpcSender(event.senderFrame) || (kind !== 'microphone' && kind !== 'camera')) {
    return { status: 'denied', granted: false }
  }
  return ensureMacMediaAccess(kind)
})

ipcMain.handle('media:open-settings', async (event, kind: 'microphone' | 'camera') => {
  if (!validateIpcSender(event.senderFrame)) return false
  if (process.platform === 'darwin') {
    const pane = kind === 'camera' ? 'Privacy_Camera' : 'Privacy_Microphone'
    await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`)
    return true
  }
  return false
})
