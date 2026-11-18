/**
 * Native ContextSurface: hosts `<InterestsWidget />` (`widgetView`) and `<InterestDiscoveryPanel />`
 * (`discoveryView`) inside tightly-bounded, transparent child `WebContentsView`s above external
 * tab `WebContentsView`s so websites render across 100% of the browser shell without a blank
 * right-hand column while the Context Widget persists in view at all times.
 *
 * Isolation & Security:
 * - Dedicated in-memory session (`ron-context-surface`, no `persist:` prefix, all permissions denied)
 * - `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `connect-src 'none'`
 * - Validated `http:`/`https:` links open as app tabs via `host.openExternalTab`; navigations denied
 * - User-gesture actions (`upload` / `record`) delegate to `mainWindow.webContents` with `userGesture = true`
 */
import { BrowserWindow, WebContentsView, ipcMain, screen, session } from 'electron'
import { join } from 'node:path'
import {
  computeDiscoverySurfaceLayout,
  computeWidgetSurfaceBounds,
  widgetAnchorBounds,
  type SurfaceRect,
} from '../src/lib/context-surface-bounds'

const SURFACE_PARTITION = 'ron-context-surface'

export interface ContextSurfaceLayoutFlags {
  isExpanded: boolean
  hasNotice: boolean
  hasLabels: boolean
  discoveryOpen: boolean
}

export interface ContextSurfaceSnapshot {
  layout: ContextSurfaceLayoutFlags
  htmlClassName: string
  theme: 'light' | 'dark' | 'glass' | 'system'
  interests: unknown
  contextAgent: unknown
  discovery: unknown
  projects: unknown
  auth: unknown
}

export interface ContextSurfaceHost {
  window: () => BrowserWindow | null
  contentBounds: () => SurfaceRect
  leftSidebarDip: () => number
  zoomFactor: () => number
  isShellMounted: () => boolean
  entry: () => { file?: string; url?: string }
  preload: string
  attachShortcuts: (wc: Electron.WebContents) => void
  openExternalTab: (url: string) => void
  focusActiveBrowserSurface: () => void
  onOrbClearanceChanged: (clearanceDip: number) => void
  onAction: (action: unknown) => Promise<unknown>
  onSendToIssue: (payload: unknown) => Promise<{ message?: string; error?: string }>
  onOpenSignIn: () => void
}

interface DragTracker {
  active: boolean
  startCursor: { x: number; y: number }
  startOffset: { x: number; y: number }
}

export class ContextSurface {
  private widgetView: WebContentsView | null = null
  private discoveryView: WebContentsView | null = null
  private state: ContextSurfaceSnapshot | null = null
  private pillWidthCss = 0
  private noticeHeightCss = 148
  private orbHovered = false
  private widgetDragOffset = { x: 0, y: 0 }
  private discoveryDragOffset = { x: 0, y: 0 }
  private lastClampedWidgetOffset = { x: 0, y: 0 }
  private lastClampedDiscoveryOffset = { x: 0, y: 0 }
  private widgetDrag: DragTracker = { active: false, startCursor: { x: 0, y: 0 }, startOffset: { x: 0, y: 0 } }
  private discoveryDrag: DragTracker = { active: false, startCursor: { x: 0, y: 0 }, startOffset: { x: 0, y: 0 } }
  private topSurface: 'widget' | 'discovery' = 'discovery'
  private prevDiscoveryOpen = false
  private handingOffToPanel = false
  private disposed = false

  constructor(private readonly host: ContextSurfaceHost) {
    ipcMain.handle('context-surface:action', async (event, action: unknown) => {
      if (!this.trusted(event.sender)) return null
      const actionType =
        action && typeof action === 'object' ? (action as { type?: unknown }).type : undefined
      const opensAgentPanel =
        actionType === 'panel:open' || actionType === 'panel:send' || actionType === 'ask-ron-items'
      if (opensAgentPanel) this.handingOffToPanel = true
      try {
        const res = await this.host.onAction(action)
        if (opensAgentPanel) {
          const win = this.host.window()
          if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
            win.webContents.focus()
          }
        }
        return res
      } finally {
        if (opensAgentPanel) this.handingOffToPanel = false
      }
    })

    ipcMain.handle('context-surface:send-to-issue', async (event, payload: unknown) => {
      if (!this.trusted(event.sender)) return { error: 'Untrusted surface' }
      return this.host.onSendToIssue(payload)
    })

    ipcMain.on('context-surface:gesture', (event, kind: unknown) => {
      if (!this.trusted(event.sender)) return
      if (kind !== 'upload' && kind !== 'record') return
      const win = this.host.window()
      if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
      const script = `window.dispatchEvent(new CustomEvent('ron:context-surface-gesture', { detail: ${JSON.stringify({ kind })} }))`
      void win.webContents.executeJavaScript(script, true).catch(() => undefined)
    })

    ipcMain.on('context-surface:metrics', (event, metrics: unknown) => {
      if (!this.trusted(event.sender) || !metrics || typeof metrics !== 'object') return
      const m = metrics as { pillWidth?: unknown; noticeHeight?: unknown; orbHovered?: unknown }
      let changed = false
      if (typeof m.pillWidth === 'number' && Number.isFinite(m.pillWidth) && m.pillWidth >= 0) {
        const next = Math.ceil(m.pillWidth)
        if (next !== this.pillWidthCss) {
          this.pillWidthCss = next
          changed = true
        }
      }
      if (typeof m.noticeHeight === 'number' && Number.isFinite(m.noticeHeight) && m.noticeHeight > 0) {
        const next = Math.ceil(m.noticeHeight)
        if (next !== this.noticeHeightCss) {
          this.noticeHeightCss = next
          changed = true
        }
      }
      if (typeof m.orbHovered === 'boolean' && m.orbHovered !== this.orbHovered) {
        this.orbHovered = m.orbHovered
        changed = true
      }
      if (changed) this.layout()
    })

    ipcMain.on('context-surface:drag-start', (event, surface: unknown) => {
      if (!this.trusted(event.sender)) return
      this.layout()
      const cursor = screen.getCursorScreenPoint()
      if (surface === 'widget') {
        this.widgetDragOffset = { ...this.lastClampedWidgetOffset }
        this.widgetDrag = { active: true, startCursor: cursor, startOffset: { ...this.widgetDragOffset } }
      } else if (surface === 'discovery') {
        this.discoveryDragOffset = { ...this.lastClampedDiscoveryOffset }
        this.discoveryDrag = { active: true, startCursor: cursor, startOffset: { ...this.discoveryDragOffset } }
      }
    })

    ipcMain.on('context-surface:drag-move', (event, surface: unknown) => {
      if (!this.trusted(event.sender)) return
      const cursor = screen.getCursorScreenPoint()
      if (surface === 'widget' && this.widgetDrag.active) {
        this.widgetDragOffset = {
          x: this.widgetDrag.startOffset.x + (cursor.x - this.widgetDrag.startCursor.x),
          y: this.widgetDrag.startOffset.y + (cursor.y - this.widgetDrag.startCursor.y),
        }
        this.layout()
      } else if (surface === 'discovery' && this.discoveryDrag.active) {
        this.discoveryDragOffset = {
          x: this.discoveryDrag.startOffset.x + (cursor.x - this.discoveryDrag.startCursor.x),
          y: this.discoveryDrag.startOffset.y + (cursor.y - this.discoveryDrag.startCursor.y),
        }
        this.layout()
      }
    })

    ipcMain.on('context-surface:drag-end', (event, surface: unknown) => {
      if (!this.trusted(event.sender)) return
      if (surface === 'widget') {
        this.widgetDrag.active = false
        this.widgetDragOffset = { ...this.lastClampedWidgetOffset }
      } else if (surface === 'discovery') {
        this.discoveryDrag.active = false
        this.discoveryDragOffset = { ...this.lastClampedDiscoveryOffset }
      }
    })

    ipcMain.on('context-surface:open-sign-in', (event) => {
      if (!this.trusted(event.sender)) return
      this.host.onOpenSignIn()
    })

    ipcMain.on('context-surface:ready', (event) => {
      if (!this.trusted(event.sender) || !this.state) return
      if (!event.sender.isDestroyed()) {
        event.sender.send('context-surface:state', this.state)
      }
    })
  }

  private trusted(sender: Electron.WebContents): boolean {
    const matchesWidget =
      this.widgetView !== null &&
      !this.widgetView.webContents.isDestroyed() &&
      sender === this.widgetView.webContents
    const matchesDiscovery =
      this.discoveryView !== null &&
      !this.discoveryView.webContents.isDestroyed() &&
      sender === this.discoveryView.webContents
    if (!matchesWidget && !matchesDiscovery) return false
    const url = sender.mainFrame.url
    const entry = this.host.entry()
    if (entry.url) {
      return url.split('?')[0].split('#')[0] === entry.url.split('?')[0].split('#')[0]
    }
    return url.startsWith('file:') && url.includes('context-surface.html')
  }

  update(snapshot: ContextSurfaceSnapshot): void {
    if (this.disposed) return
    const wasExpanded = Boolean(this.state?.layout.isExpanded)
    const wasDiscoveryOpen = this.prevDiscoveryOpen
    this.state = snapshot

    if (!snapshot.layout.isExpanded) {
      this.orbHovered = wasExpanded ? false : this.orbHovered
      this.widgetDrag.active = false
    }

    if (!this.host.isShellMounted()) {
      this.detachViews(false)
      this.prevDiscoveryOpen = snapshot.layout.discoveryOpen
      return
    }

    this.ensureWidgetView()
    this.syncZoom()

    if (snapshot.layout.discoveryOpen) {
      this.ensureDiscoveryView(!wasDiscoveryOpen)
      if (!wasDiscoveryOpen) {
        this.topSurface = 'discovery'
      }
    } else if (wasDiscoveryOpen) {
      this.discoveryDrag.active = false
      this.detachDiscoveryView(false)
      if (snapshot.layout.isExpanded && this.widgetView && !this.widgetView.webContents.isDestroyed()) {
        this.widgetView.webContents.focus()
      } else if (this.handingOffToPanel) {
        const win = this.host.window()
        if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.focus()
      } else {
        this.host.focusActiveBrowserSurface()
      }
    } else if (wasExpanded && !snapshot.layout.isExpanded) {
      if (this.handingOffToPanel) {
        const win = this.host.window()
        if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.focus()
      } else {
        this.host.focusActiveBrowserSurface()
      }
    }

    this.prevDiscoveryOpen = snapshot.layout.discoveryOpen
    this.sendToViews()
    this.layout()
    this.raise()
  }

  onShellMountedChanged(mounted: boolean): void {
    if (this.disposed) return
    if (!mounted) {
      this.widgetDrag.active = false
      this.discoveryDrag.active = false
      this.detachViews(false)
      return
    }
    if (!this.state) return
    this.ensureWidgetView()
    if (this.state.layout.discoveryOpen) {
      this.ensureDiscoveryView(false)
    }
    this.syncZoom()
    this.sendToViews()
    this.layout()
    this.raise()
  }

  raise(): void {
    const win = this.host.window()
    if (!win || win.isDestroyed() || !this.host.isShellMounted() || !this.state) return
    const content = win.contentView
    const bringToTop = (view: WebContentsView | null) => {
      if (!view || view.webContents.isDestroyed()) return
      if (content.children.includes(view)) content.removeChildView(view)
      content.addChildView(view)
    }

    const showDiscovery = this.state.layout.discoveryOpen
    if (showDiscovery && this.topSurface === 'widget') {
      bringToTop(this.discoveryView)
      bringToTop(this.widgetView)
    } else {
      bringToTop(this.widgetView)
      if (showDiscovery) bringToTop(this.discoveryView)
    }
    this.layout()
  }

  layout(): void {
    const win = this.host.window()
    if (!win || win.isDestroyed() || !this.state || !this.host.isShellMounted()) return

    const [windowWidth, windowHeight] = win.getContentSize()
    const zoom = this.host.zoomFactor()
    const anchor = widgetAnchorBounds(this.host.contentBounds(), windowWidth, this.host.leftSidebarDip())

    const widgetResult = computeWidgetSurfaceBounds({
      area: anchor,
      zoom,
      isExpanded: this.state.layout.isExpanded,
      hasNotice: this.state.layout.hasNotice,
      noticeHeightCss: this.noticeHeightCss,
      orbHovered: this.orbHovered,
      pillWidthCss: this.pillWidthCss,
      hasLabels: this.state.layout.hasLabels,
      dragOffset: this.widgetDragOffset,
    })

    if (this.state.layout.isExpanded) {
      this.lastClampedWidgetOffset = widgetResult.clampedDragOffset
    }

    this.host.onOrbClearanceChanged(widgetResult.orbClearance)

    if (this.widgetView && !this.widgetView.webContents.isDestroyed()) {
      this.widgetView.setBounds(widgetResult.bounds)
    }

    if (
      this.state.layout.discoveryOpen &&
      this.discoveryView &&
      !this.discoveryView.webContents.isDestroyed()
    ) {
      const discoveryResult = computeDiscoverySurfaceLayout({
        area: anchor,
        windowHeight,
        zoom,
        dragOffset: this.discoveryDragOffset,
      })
      this.lastClampedDiscoveryOffset = discoveryResult.clampedDragOffset
      this.discoveryView.setBounds(discoveryResult.bounds)
    }
  }

  syncZoom(): void {
    const zoom = this.host.zoomFactor()
    if (this.widgetView && !this.widgetView.webContents.isDestroyed()) {
      try {
        if (Math.abs(this.widgetView.webContents.getZoomFactor() - zoom) > 0.001) {
          this.widgetView.webContents.setZoomFactor(zoom)
        }
      } catch {}
    }
    if (this.discoveryView && !this.discoveryView.webContents.isDestroyed()) {
      try {
        if (Math.abs(this.discoveryView.webContents.getZoomFactor() - zoom) > 0.001) {
          this.discoveryView.webContents.setZoomFactor(zoom)
        }
      } catch {}
    }
  }

  private createIsolatedView(surface: 'widget' | 'discovery', focusWhenReady = false): WebContentsView {
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
    this.host.attachShortcuts(wc)

    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        this.host.openExternalTab(url)
      }
      return { action: 'deny' }
    })
    wc.on('will-navigate', (event) => {
      let parsed: URL | null = null
      try {
        parsed = new URL(event.url)
      } catch {
        event.preventDefault()
        return
      }
      const entry = this.host.entry()
      if (entry.url && event.url.split('?')[0].split('#')[0] === entry.url.split('?')[0].split('#')[0]) {
        return
      }
      if (parsed.protocol === 'file:' && event.url.includes('context-surface.html')) {
        return
      }
      event.preventDefault()
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        this.host.openExternalTab(parsed.href)
      }
    })
    wc.on('will-attach-webview', (event) => event.preventDefault())
    wc.on('focus', () => {
      if (this.topSurface !== surface) {
        this.topSurface = surface
        this.raise()
      }
    })
    wc.on('did-finish-load', () => {
      this.syncZoom()
      this.sendToView(view)
      if (focusWhenReady && !wc.isDestroyed()) {
        wc.focus()
      }
    })
    wc.on('render-process-gone', (_event, details) => {
      console.error(`context surface (${surface}) renderer gone:`, details.reason)
      if (surface === 'widget') {
        this.detachWidgetView(true)
      } else {
        this.detachDiscoveryView(true)
      }
    })

    const entry = this.host.entry()
    if (entry.url) {
      const sep = entry.url.includes('?') ? '&' : '?'
      void wc.loadURL(`${entry.url}${sep}surface=${surface}`)
    } else if (entry.file) {
      void wc.loadFile(entry.file, { query: { surface } })
    }

    return view
  }

  private ensureWidgetView(): void {
    const win = this.host.window()
    if (!win || win.isDestroyed()) return
    if (!this.widgetView || this.widgetView.webContents.isDestroyed()) {
      this.widgetView = this.createIsolatedView('widget', false)
    }
    if (!win.contentView.children.includes(this.widgetView)) {
      win.contentView.addChildView(this.widgetView)
    }
  }

  private ensureDiscoveryView(shouldFocus: boolean): void {
    const win = this.host.window()
    if (!win || win.isDestroyed()) return
    let created = false
    if (!this.discoveryView || this.discoveryView.webContents.isDestroyed()) {
      this.discoveryView = this.createIsolatedView('discovery', shouldFocus)
      created = true
    }
    if (!win.contentView.children.includes(this.discoveryView)) {
      win.contentView.addChildView(this.discoveryView)
    }
    if (shouldFocus && !created && !this.discoveryView.webContents.isLoading()) {
      this.discoveryView.webContents.focus()
    }
  }

  private sendToView(view: WebContentsView | null): void {
    if (!this.state || !view || view.webContents.isDestroyed() || view.webContents.isLoading()) return
    view.webContents.send('context-surface:state', this.state)
  }

  private sendToViews(): void {
    this.sendToView(this.widgetView)
    if (this.state?.layout.discoveryOpen) {
      this.sendToView(this.discoveryView)
    }
  }

  private detachWidgetView(destroy: boolean): void {
    const win = this.host.window()
    if (!this.widgetView) return
    if (win && !win.isDestroyed() && win.contentView.children.includes(this.widgetView)) {
      win.contentView.removeChildView(this.widgetView)
    }
    if (destroy || !win || win.isDestroyed()) {
      if (!this.widgetView.webContents.isDestroyed()) {
        try { this.widgetView.webContents.close() } catch {}
      }
      this.widgetView = null
    }
  }

  private detachDiscoveryView(destroy: boolean): void {
    const win = this.host.window()
    if (!this.discoveryView) return
    if (win && !win.isDestroyed() && win.contentView.children.includes(this.discoveryView)) {
      win.contentView.removeChildView(this.discoveryView)
    }
    if (destroy || !win || win.isDestroyed()) {
      if (!this.discoveryView.webContents.isDestroyed()) {
        try { this.discoveryView.webContents.close() } catch {}
      }
      this.discoveryView = null
    }
  }

  private detachViews(destroy: boolean): void {
    this.detachWidgetView(destroy)
    this.detachDiscoveryView(destroy)
  }

  reset(): void {
    this.detachViews(true)
    this.state = null
    this.orbHovered = false
    this.pillWidthCss = 0
    this.noticeHeightCss = 148
    this.widgetDragOffset = { x: 0, y: 0 }
    this.discoveryDragOffset = { x: 0, y: 0 }
    this.lastClampedWidgetOffset = { x: 0, y: 0 }
    this.lastClampedDiscoveryOffset = { x: 0, y: 0 }
    this.widgetDrag.active = false
    this.discoveryDrag.active = false
    this.prevDiscoveryOpen = false
    this.handingOffToPanel = false
  }

  dispose(): void {
    this.disposed = true
    this.reset()
    ipcMain.removeHandler('context-surface:action')
    ipcMain.removeHandler('context-surface:send-to-issue')
    ipcMain.removeAllListeners('context-surface:gesture')
    ipcMain.removeAllListeners('context-surface:metrics')
    ipcMain.removeAllListeners('context-surface:drag-start')
    ipcMain.removeAllListeners('context-surface:drag-move')
    ipcMain.removeAllListeners('context-surface:drag-end')
    ipcMain.removeAllListeners('context-surface:open-sign-in')
    ipcMain.removeAllListeners('context-surface:ready')
  }
}

export function contextSurfaceEntry(
  rendererUrl: string | undefined,
  distDir: string,
): { file?: string; url?: string } {
  if (rendererUrl) return { url: `${rendererUrl.replace(/\/$/, '')}/context-surface.html` }
  return { file: join(distDir, '../renderer/context-surface.html') }
}
