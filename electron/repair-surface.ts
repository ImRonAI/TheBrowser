/**
 * Native repair surface: one tightly bounded, trusted `WebContentsView` drawn **above** the tab
 * views (`contentView.addChildView` appends on top; `raise()` reapplies the order after a tab is
 * attached or switched), anchored to the bottom-right of the content area beside the Interests
 * orb. It stays visible with the agent panel closed and over external websites, never resizes a
 * page, steals focus, switches tabs or becomes a tab/automation target (it is created from this
 * module, so `browser-window-created` never sees it; the MCP supplier only knows TabsManager views).
 *
 * Isolation: a dedicated in-memory `Session` (no cookies/storage shared with tabs or the shell),
 * `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, a preload that exposes only
 * the three surface channels, every navigation away from the bundled entry and every popup denied,
 * all permission requests denied. The shell renderer stays the only process with authenticated
 * backend access: it mirrors the investigation state in (`repair-surface:update`) and performs the
 * decisions the surface relays out (`repair-surface:decision` -> `repair-surface:action` to the shell).
 *
 * Notifications: a silent native `Notification` per investigation state change while the window is
 * not focused (coalesced per revision); clicking it focuses the window and asks the shell to open
 * the review, never approves.
 */
import { BrowserWindow, Notification, WebContentsView, ipcMain, session } from 'electron'
import { join } from 'path'

export interface RepairSurfaceState {
  /** Mirrors `RepairInvestigation` in the renderer; `null` hides the surface. */
  repair: {
    tool: string
    rev: string
    state: 'investigating' | 'approval' | 'done'
    status?: string
    summary?: string
    count?: number
    exceptionClass?: string
    applied?: boolean
    approvalToken?: string
    demonstrations?: unknown[]
  } | null
  notification?: { title: string; body: string } | null
}

export type RepairSurfaceAction = { type: 'approve' | 'decline' | 'cancel' | 'rollback' | 'open' | 'dismiss'; rev: string }

const SURFACE_WIDTH = 360
const SURFACE_MIN_HEIGHT = 72
const SURFACE_MAX_HEIGHT = 420
const SURFACE_MARGIN = 16
/** Space for the Interests orb (bottom-right, 56px + margin). */
const ORB_CLEARANCE = 88
const SURFACE_PARTITION = 'ron-repair-surface' // in-memory: no `persist:` prefix

export interface SurfaceHost {
  window: () => BrowserWindow | null
  /** Bounds of the page area (below the chrome, left of the reserved right columns), in window DIPs. */
  contentBounds: () => { x: number; y: number; width: number; height: number }
  /** Called with the user's decision; the host forwards it to the shell renderer. */
  onAction: (action: RepairSurfaceAction) => void
  /** The bundled entry to load (file path in production, dev-server URL in development). */
  entry: () => { file?: string; url?: string }
  preload: string
}

export class RepairSurface {
  private view: WebContentsView | null = null
  private state: RepairSurfaceState = { repair: null }
  private height = SURFACE_MIN_HEIGHT
  private notified = new Map<string, string>() // rev -> last announced "state:status"
  private disposed = false

  constructor(private readonly host: SurfaceHost) {
    ipcMain.on('repair-surface:decision', (event, decision: unknown, rev: unknown) => {
      if (!this.trusted(event.sender) || typeof rev !== 'string') return
      if (decision !== 'approve' && decision !== 'decline' && decision !== 'cancel' && decision !== 'rollback' && decision !== 'open' && decision !== 'dismiss') return
      if (!this.state.repair || this.state.repair.rev !== rev) return
      this.host.onAction({ type: decision, rev })
    })
    ipcMain.on('repair-surface:size', (event, height: unknown) => {
      if (!this.trusted(event.sender) || typeof height !== 'number' || !Number.isFinite(height)) return
      this.height = Math.max(SURFACE_MIN_HEIGHT, Math.min(SURFACE_MAX_HEIGHT, Math.ceil(height)))
      this.layout()
    })
  }

  /** The sender must be this surface's own main frame at the bundled entry; pages and iframes never qualify. */
  private trusted(sender: Electron.WebContents): boolean {
    if (!this.view || this.view.webContents.isDestroyed() || sender !== this.view.webContents) return false
    const url = sender.mainFrame.url
    const entry = this.host.entry()
    if (entry.url) return url.split('#')[0] === entry.url.split('#')[0]
    return url.startsWith('file:') && url.includes('repair-surface')
  }

  /** New investigation state from the shell renderer. */
  update(state: RepairSurfaceState): void {
    if (this.disposed) return
    this.state = state
    if (!state.repair) {
      this.detach()
      return
    }
    this.ensure()
    this.send()
    this.layout()
    this.raise()
    this.notify(state)
  }

  /** Reapply z-order after TabsManager attached/switched a tab view (tabs are added on top). */
  raise(): void {
    const win = this.host.window()
    if (!this.view || !win || win.isDestroyed() || !this.state.repair) return
    const content = win.contentView
    if (content.children.includes(this.view)) content.removeChildView(this.view)
    content.addChildView(this.view)
    this.layout()
  }

  layout(): void {
    const win = this.host.window()
    if (!this.view || !win || win.isDestroyed() || this.view.webContents.isDestroyed()) return
    const area = this.host.contentBounds()
    const width = Math.min(SURFACE_WIDTH, Math.max(0, area.width - SURFACE_MARGIN * 2))
    const height = Math.min(this.height, Math.max(0, area.height - SURFACE_MARGIN - ORB_CLEARANCE))
    this.view.setBounds({
      x: Math.max(area.x, area.x + area.width - width - SURFACE_MARGIN),
      y: Math.max(area.y, area.y + area.height - height - ORB_CLEARANCE),
      width, height,
    })
  }

  private ensure(): void {
    const win = this.host.window()
    if (this.view || !win || win.isDestroyed()) return
    const surfaceSession = session.fromPartition(SURFACE_PARTITION)
    surfaceSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    surfaceSession.setPermissionCheckHandler(() => false)
    const view = new WebContentsView({
      webPreferences: {
        session: surfaceSession,
        preload: this.host.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
      },
    })
    view.setBackgroundColor('#00000000')
    const wc = view.webContents
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.on('will-navigate', (event) => event.preventDefault())
    wc.on('will-attach-webview', (event) => event.preventDefault())
    wc.on('did-finish-load', () => this.send())
    wc.on('render-process-gone', (_event, details) => {
      console.error('repair surface renderer gone:', details.reason)
      this.detach(true)
    })
    const entry = this.host.entry()
    if (entry.url) void wc.loadURL(entry.url)
    else if (entry.file) void wc.loadFile(entry.file)
    this.view = view
    win.contentView.addChildView(view)
    this.layout()
  }

  private send(): void {
    if (!this.view || this.view.webContents.isDestroyed() || this.view.webContents.isLoading()) return
    this.view.webContents.send('repair-surface:state', this.state)
  }

  private notify(state: RepairSurfaceState): void {
    const repair = state.repair
    const note = state.notification
    if (!repair || !note || !Notification.isSupported()) return
    const key = `${repair.state}:${repair.status ?? ''}`
    if (this.notified.get(repair.rev) === key) return
    this.notified.set(repair.rev, key)
    const win = this.host.window()
    if (win && !win.isDestroyed() && win.isFocused()) return // the surface itself is visible
    const notification = new Notification({ title: note.title, body: note.body, silent: true })
    notification.on('click', () => {
      const current = this.host.window()
      if (current && !current.isDestroyed()) { current.show(); current.focus() }
      this.host.onAction({ type: 'open', rev: repair.rev }) // review only; never approves
    })
    notification.show()
  }

  private detach(destroy = false): void {
    const win = this.host.window()
    if (this.view) {
      if (win && !win.isDestroyed() && win.contentView.children.includes(this.view)) win.contentView.removeChildView(this.view)
      if (destroy || !win || win.isDestroyed()) {
        if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
        this.view = null
      }
    }
  }

  /** Window closed / app teardown: drop the view and close its webContents. */
  dispose(): void {
    this.disposed = true
    this.detach(true)
    ipcMain.removeAllListeners('repair-surface:decision')
    ipcMain.removeAllListeners('repair-surface:size')
  }
}

/** Pure layout helper (tested): where the surface sits inside the page area. */
export function surfaceBounds(area: { x: number; y: number; width: number; height: number }, height: number) {
  const width = Math.min(SURFACE_WIDTH, Math.max(0, area.width - SURFACE_MARGIN * 2))
  const clamped = Math.max(SURFACE_MIN_HEIGHT, Math.min(SURFACE_MAX_HEIGHT, height))
  const h = Math.min(clamped, Math.max(0, area.height - SURFACE_MARGIN - ORB_CLEARANCE))
  return { x: Math.max(area.x, area.x + area.width - width - SURFACE_MARGIN), y: Math.max(area.y, area.y + area.height - h - ORB_CLEARANCE), width, height: h }
}

export function surfaceEntry(rendererUrl: string | undefined, distDir: string): { file?: string; url?: string } {
  if (rendererUrl) return { url: `${rendererUrl.replace(/\/$/, '')}/repair-surface.html` }
  return { file: join(distDir, '../renderer/repair-surface.html') }
}
