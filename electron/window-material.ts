/**
 * Native window material for the Glass theme.
 *
 * Glass is only "see-through" if something real is behind the translucent shell.
 * Chromium's CSS `backdrop-filter` samples pixels painted inside this renderer only,
 * so it can never show the desktop behind a transparent window (and never the
 * native `WebContentsView` tabs either). The desktop has to come from AppKit:
 *
 * - macOS: Electron's built-in `setVibrancy('sidebar')` mounts `ElectronVisualEffectView`,
 *   which overrides `hitTest:` to return `nil` so it never intercepts mouse clicks or
 *   conflicts with `WebContentsView` child views in `BridgedContentView`.
 * - Linux / Windows: no native material; the renderer paints its own backdrop
 *   (see `.glass:not(.glass-native)` in `src/index.css`).
 */
import type { BrowserWindow } from 'electron'

export type ThemeName = 'light' | 'dark' | 'glass' | 'system'
export type WindowMaterial = 'vibrancy' | 'none'

const OPAQUE_BACKGROUND: Record<'light' | 'dark', string> = {
  light: '#F8F7F4',
  dark: '#131312',
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
  win.setVibrancy('sidebar')
  materials.set(win, 'vibrancy')
  return 'vibrancy'
}
