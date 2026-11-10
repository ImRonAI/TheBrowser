/**
 * Native window material for the Glass theme.
 *
 * Glass is only "see-through" if something real is behind the translucent shell.
 * Chromium's CSS `backdrop-filter` samples pixels painted inside this renderer only,
 * so it can never show the desktop behind a transparent window (and never the
 * native `WebContentsView` tabs either). The desktop has to come from AppKit:
 *
 * - macOS: Electron's built-in `setVibrancy('fullscreen-ui')` mounts `ElectronVisualEffectView`,
 *   which overrides `hitTest:` to return `nil` so it never intercepts mouse clicks or
 *   conflicts with `WebContentsView` child views in `BridgedContentView`. `fullscreen-ui` is
 *   the clearest AppKit material: it lets the most of the desktop through with a light frost
 *   and only a neutral grey tint (compared on 2026-11-09 against sidebar, under-window,
 *   header, titlebar, hud, menu and popover over the same backdrop; sidebar and header add a
 *   heavy white/grey veil). The window keeps it active when it loses focus
 *   (`visualEffectState: 'active'` in electron/main.ts), so the glass does not turn opaque.
 *   The renderer adds only thin neutral veils on top (GLASS THEME in src/index.css).
 * - Linux / Windows: no native material; the renderer paints its own backdrop
 *   (see `.glass:not(.glass-native)` in `src/index.css`).
 */
import type { BrowserWindow } from 'electron'

export type ThemeName = 'light' | 'dark' | 'glass' | 'system'
export type WindowMaterial = 'vibrancy' | 'none'

// The opaque window background behind Light/Dark/System: the chrome colour (--ron-chrome in src/index.css).
const OPAQUE_BACKGROUND: Record<'light' | 'dark', string> = {
  light: '#F1F2F6',
  dark: '#070707',
}

const materials = new WeakMap<BrowserWindow, WindowMaterial>()

/**
 * Apply the window-level material for a theme. `dark` decides the opaque window
 * background for Light/Dark/System (System passes the resolved OS appearance).
 */
export async function applyWindowMaterial(win: BrowserWindow, theme: ThemeName, dark: boolean): Promise<WindowMaterial> {
  if (win.isDestroyed()) return 'none'
  const isMac = process.platform === 'darwin'

  if (theme !== 'glass') {
    if (isMac && materials.get(win) === 'vibrancy') win.setVibrancy(null)
    win.setBackgroundColor(OPAQUE_BACKGROUND[dark ? 'dark' : 'light'])
    materials.set(win, 'none')
    return 'none'
  }

  win.setBackgroundColor('#00000000')
  if (!isMac) {
    materials.set(win, 'none')
    return 'none'
  }

  win.setWindowButtonVisibility(true)
  win.setVibrancy('fullscreen-ui')
  materials.set(win, 'vibrancy')
  return 'vibrancy'
}
