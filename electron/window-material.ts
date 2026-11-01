/**
 * Native window material for the Glass theme.
 *
 * Glass is only "see-through" if something real is behind the translucent shell.
 * Chromium's CSS `backdrop-filter` samples pixels painted inside this renderer only,
 * so it can never show the desktop behind a transparent window (and never the
 * native `WebContentsView` tabs either). The desktop has to come from AppKit:
 *
 * - macOS 26+: `electron-liquid-glass` inserts Apple's `NSGlassEffectView` (the
 *   Liquid Glass material) behind the window's web contents.
 * - older macOS: the same library falls back to an `NSVisualEffectView`; if the
 *   addon itself cannot load (e.g. not unpacked from an asar), Electron's built-in
 *   `setVibrancy('sidebar')` is used instead.
 * - Linux / Windows: no native material; the renderer paints its own backdrop
 *   (see `.glass:not(.glass-native)` in `src/index.css`).
 *
 * Usage rules from the library's README that this module follows:
 * - the window is created `transparent: true` and WITHOUT `vibrancy` (vibrancy on
 *   top of liquid glass "will override and look blurry");
 * - `setWindowButtonVisibility(true)` keeps the traffic lights above the glass;
 * - the glass view is added after the page has loaded;
 * - only the documented `addView` API is used, never the `unstable_*` private ones.
 *
 * The library has no `removeView` yet. Leaving Glass therefore keeps the native
 * view mounted underneath; the opaque renderer (and opaque window background)
 * covers it completely in Light/Dark/System. Re-entering Glass reuses it.
 */
import type { BrowserWindow } from 'electron'

export type ThemeName = 'light' | 'dark' | 'glass' | 'system'
export type WindowMaterial = 'liquid-glass' | 'vibrancy' | 'none'

/** Matches the macOS 26 corner radius of a window with a hidden title bar. */
const WINDOW_CORNER_RADIUS = 16

const OPAQUE_BACKGROUND: Record<'light' | 'dark', string> = {
  light: '#F8F7F4',
  dark: '#131312',
}

interface GlassOptions {
  cornerRadius?: number
  tintColor?: string
  opaque?: boolean
}

/** The documented surface of `electron-liquid-glass` (optional, darwin-only dependency). */
interface LiquidGlassApi {
  addView(handle: Buffer, options?: GlassOptions): number
  isGlassSupported(): boolean
}

let liquidGlassModule: Promise<LiquidGlassApi | null> | null = null

/** Loaded lazily so Linux (the VPS cloud browser), where the package is not installed, never crashes. */
function loadLiquidGlass(): Promise<LiquidGlassApi | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null)
  liquidGlassModule ??= import('electron-liquid-glass')
    .then((mod) => (mod.default ?? mod) as unknown as LiquidGlassApi)
    .catch((error: unknown) => {
      console.warn('[glass] electron-liquid-glass unavailable, using vibrancy:', error)
      return null
    })
  return liquidGlassModule
}

/** Native glass view id per window (`addView` replaces, so add once per window). */
const glassViews = new WeakMap<BrowserWindow, number>()
const materials = new WeakMap<BrowserWindow, WindowMaterial>()
const requested = new WeakMap<BrowserWindow, ThemeName>()

/**
 * The README adds the glass view after the page has loaded; wait only for the main
 * frame (`did-stop-loading` also fires when the load fails, so this never hangs).
 */
function whenLoaded(win: BrowserWindow): Promise<void> {
  if (!win.webContents.isLoadingMainFrame()) return Promise.resolve()
  return new Promise((resolve) => win.webContents.once('did-stop-loading', () => resolve()))
}

async function addLiquidGlass(win: BrowserWindow): Promise<boolean> {
  if (glassViews.has(win)) return true
  const liquidGlass = await loadLiquidGlass()
  if (!liquidGlass) return false
  await whenLoaded(win)
  if (win.isDestroyed()) return false
  try {
    const id = liquidGlass.addView(win.getNativeWindowHandle(), { cornerRadius: WINDOW_CORNER_RADIUS })
    if (id < 0) return false
    glassViews.set(win, id)
    return true
  } catch (error) {
    console.warn('[glass] addView failed, using vibrancy:', error)
    return false
  }
}

/**
 * Apply the window-level material for a theme. `dark` decides the opaque window
 * background for Light/Dark/System (System passes the resolved OS appearance).
 */
export async function applyWindowMaterial(win: BrowserWindow, theme: ThemeName, dark: boolean): Promise<WindowMaterial> {
  if (win.isDestroyed()) return 'none'
  const isMac = process.platform === 'darwin'
  requested.set(win, theme)

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
  const hasLiquidGlass = await addLiquidGlass(win)
  // The theme may have changed while the addon loaded; the newer call wins.
  if (win.isDestroyed() || requested.get(win) !== 'glass') return materials.get(win) ?? 'none'
  if (hasLiquidGlass) {
    // Never stack Electron's vibrancy on top of the glass view.
    win.setVibrancy(null)
    materials.set(win, 'liquid-glass')
    return 'liquid-glass'
  }
  win.setVibrancy('sidebar')
  materials.set(win, 'vibrancy')
  return 'vibrancy'
}
