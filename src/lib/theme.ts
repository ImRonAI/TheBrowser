/**
 * Theme classes on <html>. One place decides them so the preferences store and
 * the `useTheme` hook can never disagree.
 *
 * - light  → no class
 * - dark   → `.dark`
 * - system → `.dark` when the OS prefers dark
 * - glass  → `.glass` (+ `.dark` when the OS prefers dark, so the ink always
 *   contrasts with the native material, which follows the system appearance)
 *   and `.glass-native` when the shell sits on a real macOS material (Liquid
 *   Glass via electron-liquid-glass on macOS 26+, vibrancy before that; see
 *   electron/window-material.ts). Without it (plain browser, Linux, Windows)
 *   glass falls back to a painted backdrop so translucent panes never show a
 *   raw desktop behind text. The CSS lives under "GLASS THEME" in index.css.
 */
export type ThemeName = 'light' | 'dark' | 'glass' | 'system'

export const THEME_OPTIONS: ReadonlyArray<{ id: ThemeName; label: string }> = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'glass', label: 'Glass' },
  { id: 'system', label: 'System' },
]

export function prefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Real behind-window blur exists only in the Electron shell on macOS (`vibrancy`). */
export function hasNativeGlass(): boolean {
  if (typeof window === 'undefined' || !(window as { electron?: unknown }).electron) return false
  const platform = navigator.platform || navigator.userAgent || ''
  return /Mac/i.test(platform)
}

export function applyThemeClasses(theme: ThemeName, root: HTMLElement = document.documentElement): void {
  root.classList.remove('dark', 'glass', 'glass-native')
  if (theme === 'dark') root.classList.add('dark')
  else if (theme === 'system') { if (prefersDark()) root.classList.add('dark') }
  else if (theme === 'glass') {
    root.classList.add('glass')
    if (prefersDark()) root.classList.add('dark')
    if (hasNativeGlass()) root.classList.add('glass-native')
  }
  try { localStorage.setItem('theme', theme) } catch { /* storage unavailable */ }
}

/** Next theme for one-click cycling (toolbar menu offers every option directly). */
export function nextTheme(theme: ThemeName): ThemeName {
  const order: ThemeName[] = ['light', 'dark', 'glass', 'system']
  return order[(order.indexOf(theme) + 1) % order.length]
}
