/**
 * Global chrome shortcuts. Electron reads them from `before-input-event` (so
 * they work while a website has focus) and sends `chrome:shortcut`; the
 * renderer's own keydown listener uses the same table for internal pages and
 * plain-browser runs. Pure: no React, no DOM globals at import time.
 */
export type ChromeShortcut = 'ask-ron' | 'search' | 'toggle-sidebar' | 'focus-url'

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')

/** Display glyph for the platform modifier key. */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl+'

export const SHORTCUTS: ReadonlyArray<{ id: ChromeShortcut; key: string; label: string }> = [
  { id: 'ask-ron', key: 'j', label: 'Ask Ren' },
  { id: 'search', key: 'k', label: 'Search' },
  { id: 'toggle-sidebar', key: '\\', label: 'Toggle sidebar' },
  { id: 'focus-url', key: 'l', label: 'Address bar' },
]

export interface ShortcutKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  repeat?: boolean
}

/** Map a keydown to a chrome shortcut (⌘ on macOS, Ctrl elsewhere; no Shift/Alt). */
export function shortcutFor(event: ShortcutKeyEvent, mac = IS_MAC): ChromeShortcut | null {
  if (event.repeat || event.shiftKey || event.altKey) return null
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (!mod) return null
  const key = event.key.toLowerCase()
  return SHORTCUTS.find((shortcut) => shortcut.key === key)?.id ?? null
}
