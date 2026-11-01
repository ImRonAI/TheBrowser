import { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, Menu, NativeImage, nativeTheme, shell, systemPreferences, WebContentsView } from 'electron'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  registerElectronPlaywrightMcp,
  setActiveWebContentsSupplier,
  setTabController,
  type AutomationTab,
} from 'electron-playwright-mcp'
import { CURSOR_SVG, CURSOR_TIP } from '../src/lib/agent-cursor'
import { RepairSurface, surfaceEntry, type RepairSurfaceState } from './repair-surface'
import { applyWindowMaterial } from './window-material'

const __filename = fileURLToPath(import.meta.url)
const __dirname = join(__filename, '..')

const ELECTRON_PORT = 3000
const PLAYWRIGHT_PORT = 8931
const CDP_PORT = 9222
// Single source of truth for the automation session. The MCP cookie/storage tools resolve
// their session via session.fromPartition(SESSION_PARTITION), so every WebContentsView tab
// MUST be created with this same partition or those tools read the wrong store.
const SESSION_PARTITION = 'persist:default'
const CHROME_HEIGHT = 88
// The navigation drawer was replaced by a left sidebar (2026 redesign). The IPC
// still exists for older renderers; a renderer that never reports it reserves 0.
const COLLAPSED_DRAWER_HEIGHT = 0
let agentPanelWidth = 420
let drawerHeight = COLLAPSED_DRAWER_HEIGHT
let chromeHeight = CHROME_HEIGHT
let interestInset = 0
// Width (CSS px) of the persistent left sidebar; 0 when it is closed.
let sidebarWidth = 0

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

function calculateWebContentsViewBounds(): { x: number; y: number; width: number; height: number } {
  if (!mainWindow || mainWindow.isDestroyed()) return { x: 0, y: CHROME_HEIGHT + drawerHeight, width: 800, height: 600 }
  const [windowWidth, windowHeight] = mainWindow.getContentSize()
  // The chrome reports its layout in CSS pixels; the WebContentsView is placed in
  // window DIPs. When the shell is zoomed (Cmd +/-) those differ, and an unscaled
  // view would cover the navigation drawer and the agent panel.
  const zoom = mainWindow.webContents.isDestroyed() ? 1 : mainWindow.webContents.getZoomFactor() || 1
  const rightReserve = Math.ceil(Math.max(isAgentPanelOpen ? agentPanelWidth : 0, interestInset) * zoom)
  const left = Math.ceil(sidebarWidth * zoom)
  const top = Math.ceil((chromeHeight + drawerHeight) * zoom)
  return {
    x: left,
    y: top,
    width: Math.max(0, windowWidth - left - rightReserve),
    height: Math.max(0, windowHeight - top),
  }
}

function updateWebContentsViewBounds(): void {
  tabsManager.updateActiveViewBounds()
  repairSurface.layout()
}

/**
 * Global chrome shortcuts. They must work while a website (a WebContentsView)
 * has keyboard focus, where the renderer never sees the keydown, so they are
 * read from `before-input-event` on the shell and on every tab view:
 *   ⌘/Ctrl+J  Ask Ron (with the page selection when there is one)
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

function attachChromeShortcuts(contents: Electron.WebContents, page?: WebContentsView): void {
  contents.on('before-input-event', (event, input) => {
    const shortcut = chromeShortcutFor(input)
    if (!shortcut) return
    event.preventDefault()
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
        const bounds = calculateWebContentsViewBounds()
        const x = Math.round(bounds.x + mouse.x)
        const y = Math.round(bounds.y + mouse.y)
        Menu.buildFromTemplate([{
          label: 'Ask Ron about selection',
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
    template.push({
      label: 'Ask Ron?',
      click: () => {
        const bounds = calculateWebContentsViewBounds()
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
    const bounds = calculateWebContentsViewBounds()
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

class TabsManager {
  private tabs = new Map<string, TabRecord>()
  private order: string[] = []
  private _activeTabId: string | null = null

  get activeTabId() { return this._activeTabId }
  get activeTab(): TabRecord | undefined { return this._activeTabId ? this.tabs.get(this._activeTabId) : undefined }

  list() {
    return this.order.map(id => {
      const t = this.tabs.get(id)!
      return { id: t.id, url: t.url, title: t.title, favicon: t.favicon, isActive: id === this._activeTabId }
    })
  }

  create(clientTabId?: string, url = 'ron://home'): TabRecord {
    const id = clientTabId || `tab-${Date.now()}`
    const record: TabRecord = {
      id,
      url,
      title: url.startsWith('ron://') ? 'Home' : 'New Tab',
      isExternal: !url.startsWith('ron://') && url !== 'about:blank'
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

  switch(id: string): boolean {
    const tab = this.tabs.get(id)
    if (!mainWindow || !tab) return false

    const contentView = mainWindow.contentView
    const current = this.activeTab
    if (current?.view && contentView.children.includes(current.view)) {
      contentView.removeChildView(current.view)
    }

    this._activeTabId = id

    if (tab.isExternal) {
      this.ensureView(tab)
      this.updateViewBounds(tab.view!)
      if (!contentView.children.includes(tab.view!)) contentView.addChildView(tab.view!)
      mainWindow.webContents.send('browser:external-mode', true)
    } else {
      mainWindow.webContents.send('browser:external-mode', false)
    }
    // Tab views are appended on top; the repair surface must stay above them.
    repairSurface.raise()

    mainWindow.webContents.send('browser:url-changed', tab.url)
    this.focusVisibleSurface(tab)
    this.emitTabsUpdated()
    return true
  }

  close(id: string): boolean {
    const idx = this.order.indexOf(id)
    const tab = this.tabs.get(id)
    if (idx === -1 || !tab) return false

    if (tab.view && !tab.view.webContents.isDestroyed()) {
      try { tab.view.webContents.close() } catch {}
    }

    if (mainWindow && tab.view && mainWindow.contentView.children.includes(tab.view)) {
      mainWindow.contentView.removeChildView(tab.view)
    }

    this.tabs.delete(id)
    this.order.splice(idx, 1)

    if (this._activeTabId === id) {
      const nextId = this.order[idx] || this.order[idx - 1] || null
      this._activeTabId = null
      if (nextId) this.switch(nextId)
      else {
        mainWindow?.webContents.send('browser:external-mode', false)
      }
    }

    this.emitTabsUpdated()
    return true
  }

  navigateActive(url: string) {
    if (!this._activeTabId) {
      const created = this.create(undefined, url)
      return { success: true, isExternal: created.isExternal, url: created.url }
    }
    const tab = this.tabs.get(this._activeTabId)!
    tab.url = url
    tab.isExternal = !url.startsWith('ron://') && url !== 'about:blank'

    if (tab.isExternal) {
      this.ensureView(tab)
      this.attachIfActive(tab)
      tab.view!.webContents.loadURL(url)
      this.focusVisibleSurface(tab)
      this.emitTabsUpdated()
      return { success: true, isExternal: true, url }
    } else {
      if (mainWindow && tab.view && mainWindow.contentView.children.includes(tab.view)) {
        mainWindow.contentView.removeChildView(tab.view)
      }
      // Internal pages are rendered by the shell, not the previous website.
      // Discard that hidden target so MCP cannot report/click it behind Home.
      if (tab.view) {
        if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
        tab.view = undefined
      }
      if (url.startsWith('ron://search')) tab.title = 'Search'
      else if (url.startsWith('ron://home')) tab.title = 'Home'
      else if (url.startsWith('ron://read')) {
        try { tab.title = new URL(url).searchParams.get('title') || 'Article' }
        catch { tab.title = 'Article' }
      }
      else tab.title = 'Ron'

      this.emitTabsUpdated()
      mainWindow?.webContents.send('browser:external-mode', false)
      mainWindow?.webContents.send('browser:url-changed', tab.url)
      this.focusVisibleSurface(tab)
      return { success: true, isExternal: false, url }
    }
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

    this.updateViewBounds(tab.view)

    const syncNavigation = (url: string) => {
      tab.url = url
      // Automation can navigate a view that was created for an internal tab
      // (ron://home). The moment it lands on a real URL the tab becomes
      // external and its view is attached *below the chrome* -- the header,
      // toolbar, and agent panel persist exactly as they do for user
      // navigation through navigateActive().
      const external = !url.startsWith('ron://') && url !== 'about:blank'
      if (external && !tab.isExternal) {
        tab.isExternal = true
        tab.title = 'New Tab'
        this.attachIfActive(tab)
      }
      this.emitTabsUpdated()
      if (this._activeTabId === tab.id) mainWindow?.webContents.send('browser:url-changed', url)
    }
    tab.view.webContents.on('did-navigate', (_, url) => syncNavigation(url))
    tab.view.webContents.on('did-navigate-in-page', (_, url, isMainFrame) => {
      if (isMainFrame) syncNavigation(url)
    })

    // window.open / target=_blank from page or automation: open as a real app
    // tab (chrome-managed), never a detached BrowserWindow.
    tab.view.webContents.setWindowOpenHandler(({ url }) => {
      const created = this.create(undefined, url)
      this.switch(created.id)
      return { action: 'deny' }
    })
    // Electron webContents `focus` fires when CDP /json/activate or in-page
    // focus moves between WebContents in this window. Follow that tab in the bar.
    tab.view.webContents.on('focus', () => {
      if (this._activeTabId !== tab.id) this.switch(tab.id)
    })
    tab.view.webContents.on('page-title-updated', (_, title) => {
      tab.title = title
      this.emitTabsUpdated()
    })
    tab.view.webContents.on('page-favicon-updated', (_, favs) => {
      tab.favicon = Array.isArray(favs) ? favs[0] : undefined
      this.emitTabsUpdated()
    })
    attachPageContextMenu(tab)
    attachChromeShortcuts(tab.view.webContents, tab.view)
  }

  attachIfActive(tab: TabRecord) {
    if (!mainWindow || this._activeTabId !== tab.id || !tab.view) return
    const contentView = mainWindow.contentView
    if (!contentView.children.includes(tab.view)) contentView.addChildView(tab.view)
    this.updateViewBounds(tab.view)
    repairSurface.raise()
    mainWindow.webContents.send('browser:external-mode', true)
    this.focusVisibleSurface(tab)
  }

  /** Create (if needed) and return the WebContentsView for a tab -- used by the
   *  automation supplier so MCP navigation always targets tab content, never
   *  the app shell. The view stays detached until a real URL loads; the
   *  did-navigate handler in ensureView attaches it under the chrome. */
  materializeView(id: string): WebContentsView | undefined {
    const tab = this.tabs.get(id)
    if (!tab) return undefined
    this.ensureView(tab)
    // A never-loaded WebContentsView has no renderer or DevTools target; CDP calls against it hang. Give automation a real about:blank document to attach to.
    if (tab.view && tab.view.webContents.getURL() === '') { void tab.view.webContents.loadURL('about:blank') }
    return tab.view
  }

  updateViewBounds(view: WebContentsView) {
    if (!mainWindow || mainWindow.isDestroyed() || view.webContents.isDestroyed()) return
    view.setBounds(calculateWebContentsViewBounds())
  }

  updateActiveViewBounds() {
    const v = this.activeTab?.view
    if (v) this.updateViewBounds(v)
  }

  emitTabsUpdated() {
    mainWindow?.webContents.send('tabs:updated', this.list())
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
  }

  private focusVisibleSurface(tab: TabRecord) {
    if (!mainWindow) return
    if (tab.isExternal && tab.view && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.focus()
    } else if (!mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.focus()
    }
  }
}

const tabsManager = new TabsManager()

// Native repair surface (electron/repair-surface.ts): drawn above the tab views, fed by the shell
// renderer (`repair-surface:update`), its decisions relayed back to the shell (`repair-surface:action`).
const repairSurface = new RepairSurface({
  window: () => mainWindow,
  contentBounds: () => calculateWebContentsViewBounds(),
  onAction: (action) => mainWindow?.webContents.send('repair-surface:action', action),
  entry: () => surfaceEntry(process.env['ELECTRON_RENDERER_URL'], __dirname),
  preload: join(__dirname, 'repair-surface-preload.js'),
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
  // Await the MCP server initialization
  await mcpPromise;

  let win: BrowserWindow
  creatingMainWindow = true
  try {
    win = new BrowserWindow({
      title: 'Ron Browser',
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
      // No `vibrancy` here: the Glass theme mounts native Liquid Glass via
      // electron-liquid-glass, and vibrancy on top of it renders blurry
      // (see electron/window-material.ts). The renderer's `set-theme` call
      // picks the material once the page has loaded.
      webPreferences: {
        preload: join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    })
  } finally {
    creatingMainWindow = false
  }
  mainWindow = win
  attachChromeShortcuts(win.webContents)

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

  win.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    if (!request.userGesture || !validateIpcSender(request.frame) || request.frame !== win.webContents.mainFrame) {
      callback({})
      return
    }
    void (async () => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
        if (!sources.length || win.isDestroyed()) { callback({}); return }
        const choice = await dialog.showMessageBox(win, {
          type: 'question', title: 'Teach Ron a skill',
          message: 'Choose what to share with the agent',
          detail: 'The selected screen or window is sent to Gemini while you demonstrate the workflow.',
          buttons: ['Cancel', ...sources.map((source) => source.name)],
          cancelId: 0, defaultId: 0, noLink: true,
        })
        const source = sources[choice.response - 1]
        callback(source ? { video: source } : {})
      } catch (error) {
        console.error('Screen sharing could not start:', error)
        callback({})
      }
    })()
  }, { useSystemPicker: true })

  win.on('closed', () => {
    // Never keep a handle to a destroyed window: every `mainWindow?.` call
    // would otherwise throw "Object has been destroyed".
    if (mainWindow === win) {
      repairSurface.update({ repair: null })
      mainWindow = null
      tabsManager.reset()
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('resize', () => {
    updateWebContentsViewBounds()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// createWindow is async (it awaits the MCP server). It must be awaited before any tab
// work: TabsManager.attachIfActive/updateViewBounds/emitTabsUpdated all no-op when
// mainWindow is still null, which would leave the initial tab detached and invisible.
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

app.whenReady().then(() => openMainWindow())

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
      .end('<!doctype html><meta charset="utf-8"><title>Ron</title><p style="font:16px system-ui;margin:3rem">Sign-in finished. Returning to Ron.</p>')
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

ipcMain.handle('set-theme', (event, theme: 'light' | 'dark' | 'glass' | 'system') => {
  if (!validateIpcSender(event.senderFrame)) return currentTheme
  currentTheme = theme
  if (!mainWindow) return theme

  // Glass: native Liquid Glass (macOS 26+) or vibrancy behind a transparent window.
  // Others: opaque window background matching the resolved appearance. Applied
  // asynchronously (the glass view waits for the page to finish loading).
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
  void applyWindowMaterial(mainWindow, theme, dark).catch((error) => {
    console.warn('[glass] could not apply window material:', error)
  })
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
  if (!validateIpcSender(event.senderFrame)) return
  isAgentPanelOpen = isOpen
  updateWebContentsViewBounds()
})

ipcMain.handle('browser:set-agent-cursor', (event, point: { x?: number; y?: number } | null) => {
  if (!validateIpcSender(event.senderFrame)) return
  const view = tabsManager.activeTab?.view
  if (!view || view.webContents.isDestroyed()) return
  const x = typeof point?.x === 'number' && Number.isFinite(point.x) ? point.x : null
  const y = typeof point?.y === 'number' && Number.isFinite(point.y) ? point.y : null
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

ipcMain.handle('interests:set-inset', (event, width: number) => {
  if (!validateIpcSender(event.senderFrame)) return { success: false }
  interestInset = Number.isFinite(width) && width > 0 ? width : 0
  updateWebContentsViewBounds()
  return { success: true }
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
      const page = jpegDataUrl(await activeTab.view.webContents.capturePage())
      if (page) return page
    } catch {}
  }
  // Internal tabs (ron://) have no page view. Capture the window to the left of
  // the side panel so the frame is the browser the user is looking at.
  if (!mainWindow || mainWindow.isDestroyed()) return ''
  try {
    const [width, height] = mainWindow.getContentSize()
    const left = Math.min(Math.ceil(sidebarWidth), Math.max(0, width - 1))
    const panel = isAgentPanelOpen ? Math.min(agentPanelWidth, Math.max(0, width - left - 1)) : 0
    const image = await mainWindow.webContents.capturePage({ x: left, y: 0, width: Math.max(1, width - left - panel), height: Math.max(1, height) })
    return jpegDataUrl(image)
  } catch {
    return ''
  }
})

ipcMain.handle('browser:set-panel-mode', (event, mode: 'narrow' | 'wide' | 'fullscreen') => {
  if (!validateIpcSender(event.senderFrame)) return
  if (!mainWindow) return

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
