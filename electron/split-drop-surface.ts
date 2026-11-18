/**
 * Transient native drop-zone indicator (`WebContentsView`) shown above external tab
 * `WebContentsView`s ONLY during an active pointer drag (`previewSplitDrop(zone)`).
 *
 * Renders an architectural Ren Ink & Volt window frame silhouette at the exact DIP
 * rectangle of the target pane (plus a floating HUD pill with a live mini-topology
 * schematic), or a tailored dock capsule over the active tab strip / sidebar when
 * returning a split pane to grouped tabs. Immediately detached when `zone === null`,
 * when `mainWindow` loses focus, or when the shell unmounts.
 */
import { BrowserWindow, WebContentsView, session } from 'electron'
import {
  SPLIT_PANE_GAP_PX,
  SPLIT_PANE_HEADER_HEIGHT,
  SPLIT_PANE_RADIUS_PX,
  SPLIT_SHELL_PADDING_PX,
  computeDropZonePreviewBounds,
  resolveDropTargetTopology,
  type SplitDropZone,
  type SplitLayoutPreset,
  type SplitRect,
  type SplitState,
} from '../src/lib/tab-split'

const DROP_SURFACE_PARTITION = 'ron-split-drop-surface'

interface DropHudPayload {
  zone: SplitDropZone
  topology: SplitLayoutPreset | 'regroup'
  title: string
  tag: string
  dark: boolean
  headerHeightPx: number
  radiusPx: number
}

const DROP_SURFACE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<style>
  :root {
    --volt: 85 67 255;
    --hud-bg: rgba(11, 12, 23, 0.90);
    --hud-fg: #f5f5fa;
    --hud-muted: rgba(245, 245, 250, 0.64);
    --hud-border: rgba(255, 255, 255, 0.14);
    --frame-fill-center: rgba(85, 67, 255, 0.12);
    --frame-fill-edge: rgba(85, 67, 255, 0.045);
    --frame-inner: rgba(255, 255, 255, 0.45);
  }
  html[data-dark="true"] {
    --volt: 141 152 254;
    --hud-bg: rgba(18, 19, 28, 0.94);
    --hud-fg: #f5f5fa;
    --hud-muted: rgba(245, 245, 250, 0.62);
    --hud-border: rgba(141, 152, 254, 0.28);
    --frame-fill-center: rgba(141, 152, 254, 0.15);
    --frame-fill-edge: rgba(141, 152, 254, 0.05);
    --frame-inner: rgba(255, 255, 255, 0.10);
  }
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    background: transparent !important;
    overflow: hidden;
    pointer-events: none;
    user-select: none;
    -webkit-font-smoothing: antialiased;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
  }
  @keyframes frameEnter {
    from { opacity: 0; transform: scale(0.988); }
    to { opacity: 1; transform: scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    #box { animation: none !important; }
  }
  #box {
    position: relative;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    border-radius: var(--radius, 12px);
    border: 1.5px solid rgb(var(--volt) / 0.78);
    box-shadow: inset 0 1px 0 0 var(--frame-inner);
    background: radial-gradient(circle at 50% 45%, var(--frame-fill-center) 0%, var(--frame-fill-edge) 76%);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: frameEnter 140ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  #header-line {
    position: absolute;
    left: 6px;
    right: 6px;
    top: var(--header-h, 34px);
    height: 1px;
    background: rgb(var(--volt) / 0.26);
  }
  #header-dots {
    position: absolute;
    left: 12px;
    top: 13px;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  #header-dots span {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: rgb(var(--volt) / 0.42);
  }
  #header-dots i {
    display: block;
    width: 44px;
    height: 6px;
    border-radius: 999px;
    background: rgb(var(--volt) / 0.22);
  }
  #box[data-regroup="true"] {
    border-style: dashed;
    border-radius: 9px;
    background: linear-gradient(90deg, rgb(var(--volt) / 0.11), rgb(var(--volt) / 0.17), rgb(var(--volt) / 0.11));
  }
  #box[data-regroup="true"] #header-line,
  #box[data-regroup="true"] #header-dots {
    display: none;
  }
  #hud {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px 6px 9px;
    border-radius: 999px;
    background: var(--hud-bg);
    border: 1px solid var(--hud-border);
    box-shadow: 0 12px 30px -8px rgba(11, 12, 23, 0.42);
    color: var(--hud-fg);
  }
  #box[data-regroup="true"] #hud {
    padding: 4px 11px 4px 8px;
    box-shadow: 0 6px 18px -6px rgba(11, 12, 23, 0.34);
  }
  #diagram {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 16px;
    flex-shrink: 0;
  }
  #diagram svg {
    width: 22px;
    height: 16px;
    display: block;
  }
  #title {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1;
    white-space: nowrap;
  }
  #tag {
    font-family: ui-monospace, "JetBrains Mono", Menlo, monospace;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    line-height: 1;
    padding: 2px 5px;
    border-radius: 5px;
    color: rgb(179 189 255);
    background: rgba(141, 152, 254, 0.16);
    white-space: nowrap;
  }
  #tag:empty {
    display: none;
  }
</style>
</head>
<body>
  <div id="box" data-regroup="false">
    <div id="header-dots"><span></span><i></i></div>
    <div id="header-line"></div>
    <div id="hud">
      <span id="diagram"></span>
      <span id="title"></span>
      <span id="tag"></span>
    </div>
  </div>
  <script>
    function cellSvg(x, y, w, h, active) {
      const fill = active ? 'rgb(141, 152, 254)' : 'rgba(255, 255, 255, 0.10)';
      const stroke = active ? 'rgb(179, 189, 255)' : 'rgba(255, 255, 255, 0.34)';
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="1.6" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1"/>';
    }
    function buildDiagram(topology, zone) {
      if (topology === 'regroup') {
        return '<svg viewBox="0 0 22 16" fill="none">' +
          '<rect x="1" y="1.5" width="20" height="4" rx="1.5" fill="rgb(141, 152, 254)" />' +
          '<path d="M11 14V8M11 8L8.2 10.8M11 8L13.8 10.8" stroke="#f5f5fa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>';
      }
      if (topology === '50-50') {
        const leftAct = zone === 'left' || zone === 'topLeft' || zone === 'bottomLeft';
        return '<svg viewBox="0 0 22 16" fill="none">' +
          cellSvg(1, 1, 9, 14, leftAct) +
          cellSvg(12, 1, 9, 14, !leftAct) +
          '</svg>';
      }
      if (topology === '2x1-left') {
        return '<svg viewBox="0 0 22 16" fill="none">' +
          cellSvg(1, 1, 9, 6, zone === 'topLeft') +
          cellSvg(1, 9, 9, 6, zone === 'bottomLeft' || zone === 'left') +
          cellSvg(12, 1, 9, 14, zone === 'right' || zone === 'topRight' || zone === 'bottomRight') +
          '</svg>';
      }
      if (topology === '2x1-right') {
        return '<svg viewBox="0 0 22 16" fill="none">' +
          cellSvg(1, 1, 9, 14, zone === 'left' || zone === 'topLeft' || zone === 'bottomLeft') +
          cellSvg(12, 1, 9, 6, zone === 'topRight') +
          cellSvg(12, 9, 9, 6, zone === 'bottomRight' || zone === 'right') +
          '</svg>';
      }
      return '<svg viewBox="0 0 22 16" fill="none">' +
        cellSvg(1, 1, 9, 6, zone === 'topLeft' || zone === 'left') +
        cellSvg(12, 1, 9, 6, zone === 'topRight' || zone === 'right') +
        cellSvg(1, 9, 9, 6, zone === 'bottomLeft') +
        cellSvg(12, 9, 9, 6, zone === 'bottomRight') +
        '</svg>';
    }
    window.__setDropHud = (payload) => {
      if (!payload) return;
      document.documentElement.dataset.dark = payload.dark ? 'true' : 'false';
      const box = document.getElementById('box');
      if (box) {
        box.dataset.regroup = payload.topology === 'regroup' ? 'true' : 'false';
        box.style.setProperty('--header-h', (payload.headerHeightPx || 34) + 'px');
        box.style.setProperty('--radius', (payload.radiusPx || 12) + 'px');
        box.style.animation = 'none';
        void box.offsetWidth;
        box.style.animation = '';
      }
      const diag = document.getElementById('diagram');
      if (diag) diag.innerHTML = buildDiagram(payload.topology, payload.zone);
      const title = document.getElementById('title');
      if (title) title.textContent = payload.title || '';
      const tag = document.getElementById('tag');
      if (tag) tag.textContent = payload.tag || '';
    };
  </script>
</body>
</html>`

const ZONE_TITLES: Record<SplitDropZone, string> = {
  regroup: 'Return to grouped tabs',
  left: 'Split left',
  right: 'Split right',
  topLeft: 'Top left',
  bottomLeft: 'Bottom left',
  topRight: 'Top right',
  bottomRight: 'Bottom right',
}

const TOPOLOGY_TAGS: Record<SplitLayoutPreset | 'regroup', string> = {
  regroup: '',
  '50-50': '50/50',
  '2x1-left': '2×1',
  '2x1-right': '2×1',
  '2x2': '2×2',
}

export interface SplitDropSurfaceHost {
  window: () => BrowserWindow | null
  contentBounds: () => SplitRect
  chromeBounds: () => SplitRect
  leftSidebarDip?: () => number
  zoomFactor?: () => number
  splitMode?: () => SplitState['mode']
  isDark?: () => boolean
}

export class SplitDropSurface {
  private view: WebContentsView | null = null
  private activeZone: SplitDropZone | null = null
  private ready = false

  constructor(private readonly host: SplitDropSurfaceHost) {}

  get isActive(): boolean {
    return this.activeZone !== null
  }

  preview(zone: SplitDropZone | null): void {
    this.activeZone = zone
    if (!zone) {
      this.detach(false)
      return
    }
    this.ensure()
    this.syncZoom()
    this.updateHud()
    this.layout()
    this.raise()
  }

  raise(): void {
    const win = this.host.window()
    if (!this.view || !win || win.isDestroyed() || !this.activeZone) return
    const content = win.contentView
    if (content.children.includes(this.view)) content.removeChildView(this.view)
    content.addChildView(this.view)
    this.layout()
  }

  syncZoom(): void {
    if (!this.view || this.view.webContents.isDestroyed()) return
    const zoom = this.host.zoomFactor?.() ?? 1
    try {
      if (Math.abs(this.view.webContents.getZoomFactor() - zoom) > 0.001) {
        this.view.webContents.setZoomFactor(zoom)
      }
    } catch {}
  }

  layout(): void {
    const win = this.host.window()
    if (!this.view || !win || win.isDestroyed() || !this.activeZone || this.view.webContents.isDestroyed()) {
      return
    }
    const zoom = this.host.zoomFactor?.() ?? 1

    if (this.activeZone === 'regroup') {
      const sidebarDip = this.host.leftSidebarDip?.() ?? 0
      const [, windowHeight] = win.getContentSize()
      if (sidebarDip > 0) {
        const pad = Math.round(10 * zoom)
        const targetH = Math.round(38 * zoom)
        const targetY = Math.min(
          Math.max(Math.round(52 * zoom), windowHeight - targetH - Math.round(52 * zoom)),
          Math.round(396 * zoom),
        )
        this.view.setBounds({
          x: pad,
          y: targetY,
          width: Math.max(0, sidebarDip - pad * 2),
          height: targetH,
        })
        return
      }

      const chrome = this.host.chromeBounds()
      const leftClearance = Math.round(80 * zoom)
      const rightClearance = Math.round(44 * zoom)
      const dockH = Math.round(30 * zoom)
      const usableWidth = chrome.width - leftClearance - rightClearance
      this.view.setBounds({
        x: usableWidth >= 140 ? chrome.x + leftClearance : chrome.x + Math.round(8 * zoom),
        y: Math.max(4, chrome.y + chrome.height - dockH - Math.round(5 * zoom)),
        width: Math.max(0, usableWidth >= 140 ? usableWidth : chrome.width - Math.round(16 * zoom)),
        height: dockH,
      })
      return
    }

    const area = this.host.contentBounds()
    const local = computeDropZonePreviewBounds(area, this.activeZone, {
      shellPaddingDip: Math.round(SPLIT_SHELL_PADDING_PX * zoom),
      gapDip: Math.max(1, Math.round(SPLIT_PANE_GAP_PX * zoom)),
    })
    this.view.setBounds({
      x: area.x + local.x,
      y: area.y + local.y,
      width: local.width,
      height: local.height,
    })
  }

  private ensure(): void {
    const win = this.host.window()
    if (!win || win.isDestroyed()) return
    if (!this.view || this.view.webContents.isDestroyed()) {
      this.ready = false
      const dropSession = session.fromPartition(DROP_SURFACE_PARTITION)
      dropSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false))
      dropSession.setPermissionCheckHandler(() => false)
      const view = new WebContentsView({
        webPreferences: {
          session: dropSession,
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
      wc.on('will-navigate', (event) => {
        if (!event.url.startsWith('data:text/html')) event.preventDefault()
      })
      wc.on('did-finish-load', () => {
        this.ready = true
        this.syncZoom()
        this.updateHud()
      })
      void wc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(DROP_SURFACE_HTML)}`)
      this.view = view
    }
    if (!win.contentView.children.includes(this.view)) {
      win.contentView.addChildView(this.view)
    }
  }

  private updateHud(): void {
    if (!this.view || !this.ready || !this.activeZone || this.view.webContents.isDestroyed()) return
    const splitMode = this.host.splitMode?.() ?? 'single'
    const topology = resolveDropTargetTopology(splitMode, this.activeZone)
    const payload: DropHudPayload = {
      zone: this.activeZone,
      topology,
      title: ZONE_TITLES[this.activeZone],
      tag: TOPOLOGY_TAGS[topology],
      dark: Boolean(this.host.isDark?.()),
      headerHeightPx: SPLIT_PANE_HEADER_HEIGHT,
      radiusPx: SPLIT_PANE_RADIUS_PX,
    }
    void this.view.webContents
      .executeJavaScript(`window.__setDropHud && window.__setDropHud(${JSON.stringify(payload)})`)
      .catch(() => undefined)
  }

  detach(destroy = false): void {
    this.activeZone = null
    const win = this.host.window()
    if (!this.view) return
    if (win && !win.isDestroyed() && win.contentView.children.includes(this.view)) {
      win.contentView.removeChildView(this.view)
    }
    if (destroy || !win || win.isDestroyed()) {
      if (!this.view.webContents.isDestroyed()) {
        try { this.view.webContents.close() } catch {}
      }
      this.view = null
      this.ready = false
    }
  }

  reset(): void {
    this.detach(true)
  }
}
