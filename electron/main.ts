import { app, BrowserWindow, clipboard, ipcMain, Menu, WebContentsView } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  registerElectronPlaywrightMcp,
  setActiveWebContentsSupplier,
  setTabController,
  type AutomationTab,
} from 'electron-playwright-mcp'
import { spawn, ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = join(__filename, '..')

const ELECTRON_PORT = 3000
const PLAYWRIGHT_PORT = 8931
const CDP_PORT = 9222
// Single source of truth for the automation session. The MCP cookie/storage tools resolve
// their session via session.fromPartition(SESSION_PARTITION), so every WebContentsView tab
// MUST be created with this same partition or those tools read the wrong store.
const SESSION_PARTITION = 'persist:default'
const CHROME_HEIGHT = 108
const COLLAPSED_DRAWER_HEIGHT = 32
let agentPanelWidth = 420
let drawerHeight = COLLAPSED_DRAWER_HEIGHT
let chromeHeight = CHROME_HEIGHT
let interestInset = 0

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

function calculateWebContentsViewBounds(): { x: number; y: number; width: number; height: number } {
  if (!mainWindow || mainWindow.isDestroyed()) return { x: 0, y: CHROME_HEIGHT + drawerHeight, width: 800, height: 600 }
  const [windowWidth, windowHeight] = mainWindow.getContentSize()
  // The chrome reports its layout in CSS pixels; the WebContentsView is placed in
  // window DIPs. When the shell is zoomed (Cmd +/-) those differ, and an unscaled
  // view would cover the navigation drawer and the agent panel.
  const zoom = mainWindow.webContents.isDestroyed() ? 1 : mainWindow.webContents.getZoomFactor() || 1
  const rightReserve = Math.ceil(Math.max(isAgentPanelOpen ? agentPanelWidth : 0, interestInset) * zoom)
  const top = Math.ceil((chromeHeight + drawerHeight) * zoom)
  return {
    x: 0,
    y: top,
    width: Math.max(0, windowWidth - rightReserve),
    height: Math.max(0, windowHeight - top),
  }
}

function updateWebContentsViewBounds(): void {
  tabsManager.updateActiveViewBounds()
}

/** Electron `webContents` `context-menu` — same actions as the native-page React menu. */
function attachPageContextMenu(tab: TabRecord): void {
  const view = tab.view
  if (!view) return
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
  }

  attachIfActive(tab: TabRecord) {
    if (!mainWindow || this._activeTabId !== tab.id || !tab.view) return
    const contentView = mainWindow.contentView
    if (!contentView.children.includes(tab.view)) contentView.addChildView(tab.view)
    this.updateViewBounds(tab.view)
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
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'sidebar', // Glassmorphic blur on macOS
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

  win.on('closed', () => {
    // Never keep a handle to a destroyed window: every `mainWindow?.` call
    // would otherwise throw "Object has been destroyed".
    if (mainWindow === win) {
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

  if (theme === 'glass') {
    if (process.platform === 'darwin') {
      mainWindow.setVibrancy('sidebar')
    }
    mainWindow.setBackgroundColor('#00000000')
  } else {
    if (process.platform === 'darwin') mainWindow.setVibrancy(null)
    mainWindow.setBackgroundColor(theme === 'dark' ? '#0A0A0A' : '#FFFFFF')
  }
  return theme
})

// Navigation controls
ipcMain.handle('browser:navigate', (event, url: string) => {
  if (!validateIpcSender(event.senderFrame)) return
  return tabsManager.navigateActive(url)
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

// Tabs IPC
ipcMain.handle('create-tab', (event, url?: string, clientTabId?: string) => {
  if (!validateIpcSender(event.senderFrame)) return
  return tabsManager.create(clientTabId, url)
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

ipcMain.handle('browser:screenshot', async (event) => {
  if (!validateIpcSender(event.senderFrame)) return ''
  const activeTab = tabsManager.activeTab
  if (activeTab?.view && !activeTab.view.webContents.isDestroyed()) {
    try {
      const nativeImage = await activeTab.view.webContents.capturePage()
      return nativeImage.toDataURL()
    } catch {}
  }
  return ''
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

// ============================================
// IPC Handlers - Voice Agent
// ============================================

let voiceAgentProcess: ChildProcess | null = null
let voiceAgentStdoutBuffer = ''
let voiceAgentStopRequested = false
let lastVoiceAgentApiKey: string | undefined
let appQuitting = false

// Helper to gracefully kill the voice agent process (SIGTERM then SIGKILL fallback)
async function killVoiceAgent(timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    if (!voiceAgentProcess) return resolve(false)

    voiceAgentStopRequested = true

    const proc = voiceAgentProcess
    const pid = proc.pid
    let finished = false
    let forceTimer: NodeJS.Timeout | null = null

    const cleanup = () => {
      if (finished) return
      finished = true
      if (forceTimer) clearTimeout(forceTimer)
      voiceAgentProcess = null
      voiceAgentStdoutBuffer = ''
      resolve(true)
    }

    // If the process exits on its own, clean up
    proc.once('exit', () => {
      cleanup()
    })

    // Try graceful shutdown first
    try {
      proc.kill('SIGTERM')
    } catch (_) {
      return cleanup()
    }

    // Fallback to SIGKILL after timeout
    forceTimer = setTimeout(() => {
      if (finished) return
      try {
        if (pid) process.kill(pid, 'SIGKILL')
      } catch (_) {
        // ignore
      }
    }, timeoutMs)
  })
}

async function startVoiceAgent(apiKey?: string): Promise<{ success: boolean; pid?: number; error?: string }> {
  try {
    // If already running, return existing pid
    if (voiceAgentProcess && voiceAgentProcess.pid) {
      return { success: true, pid: voiceAgentProcess.pid }
    }

    // Avoid restart loop during quit
    if (appQuitting) return { success: false, error: 'App is quitting' }

    // Reset stop flag for a fresh start
    voiceAgentStopRequested = false
    lastVoiceAgentApiKey = apiKey

    // Get the agents directory path
    const agentsPath = app.isPackaged
      ? join(process.resourcesPath, 'agents')
      : join(__dirname, '..', '..', 'agents')

    const agentScriptPath = join(agentsPath, 'voice_onboarding', 'agent.py')

    // Find Python executable - use venv if available
    const venvPython = app.isPackaged
      ? join(process.resourcesPath, 'venv', 'bin', 'python')
      : join(__dirname, '..', '..', 'venv', 'bin', 'python')

    // Fall back to system Python if venv doesn't exist
    const pythonPath = existsSync(venvPython)
      ? venvPython
      : (process.platform === 'win32' ? 'python' : 'python3')

    console.log('[Voice Agent] Using Python:', pythonPath)
    console.log('[Voice Agent] Script:', agentScriptPath)

    // Set up environment with API key
    const env = { ...process.env }
    if (apiKey) {
      env.GOOGLE_API_KEY = apiKey
      env.GEMINI_API_KEY = apiKey
      env.GOOGLE_AI_API_KEY = apiKey
    }

    // Spawn the Python process
    voiceAgentProcess = spawn(pythonPath, [agentScriptPath], {
      env,
      cwd: join(agentsPath, 'voice_onboarding')
    })

    // Handle stdout - agent output
    voiceAgentProcess.stdout?.on('data', (data) => {
      // Python stdout can arrive in arbitrary chunks. We treat it as newline-delimited JSON.
      voiceAgentStdoutBuffer += data.toString('utf8')

      const lines = voiceAgentStdoutBuffer.split('\n')
      voiceAgentStdoutBuffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue

        try {
          const event = JSON.parse(line)
          mainWindow?.webContents.send('voice-agent:event', event)
        } catch {
          // Non-JSON logs or partial output
          mainWindow?.webContents.send('voice-agent:output', rawLine)
        }
      }
    })

    // Handle stderr - errors
    voiceAgentProcess.stderr?.on('data', (data) => {
      const error = data.toString()
      console.error('[Voice Agent Error]:', error)
      mainWindow?.webContents.send('voice-agent:error', error)
    })

    // Handle process exit
    voiceAgentProcess.on('exit', (code, signal) => {
      console.log(`[Voice Agent] Process exited with code ${code}, signal ${signal}`)
      mainWindow?.webContents.send('voice-agent:stopped', { code, signal })

      voiceAgentProcess = null
      voiceAgentStdoutBuffer = ''

      const wasRequested = voiceAgentStopRequested || appQuitting
      voiceAgentStopRequested = false

      if (!wasRequested) {
        console.log('[Voice Agent] Unexpected exit; restarting...')
        setTimeout(() => {
          // Avoid restart if app quit in the meantime
          if (!appQuitting) {
            startVoiceAgent(lastVoiceAgentApiKey).catch((err) => console.error('[Voice Agent] Restart failed:', err))
          }
        }, 500)
      }
    })

    return { success: true, pid: voiceAgentProcess.pid }
  } catch (error) {
    console.error('[Voice Agent] Failed to start:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

ipcMain.handle('voice-agent:start', async (event, apiKey?: string) => {
  if (!validateIpcSender(event.senderFrame)) return { success: false, error: 'Forbidden sender' }
  return startVoiceAgent(apiKey)
})

ipcMain.handle('voice-agent:stop', async (event) => {
  if (!validateIpcSender(event.senderFrame)) return { success: false, error: 'Forbidden sender' }
  if (voiceAgentProcess) {
    voiceAgentStopRequested = true
    await killVoiceAgent()
    return { success: true }
  }
  return { success: false, error: 'No active voice agent process' }
})

app.on('before-quit', (event) => {
  event.preventDefault()
  appQuitting = true
  killVoiceAgent().finally(() => app.exit(0))
})
