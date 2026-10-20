/**
 * Shared metadata for the search results tabs. The 2026 redesign uses a single
 * ember accent for every lens (no per-tab rainbow): `hue` stays on the contract so
 * panels can tint small marks, but every tab resolves to the same accent.
 */
export type SearchTab = 'agent' | 'web' | 'local' | 'news' | 'images' | 'videos' | 'shopping'

export interface TabMeta {
  id: SearchTab
  label: string
  hue: string
}

/** The one accent (Tailwind `ember-500`). */
export const SEARCH_ACCENT = '#C26A41'

export const SEARCH_TABS: readonly TabMeta[] = [
  { id: 'agent', label: 'Answer', hue: SEARCH_ACCENT },
  { id: 'web', label: 'Web', hue: SEARCH_ACCENT },
  { id: 'news', label: 'News', hue: SEARCH_ACCENT },
  { id: 'images', label: 'Images', hue: SEARCH_ACCENT },
  { id: 'videos', label: 'Videos', hue: SEARCH_ACCENT },
  { id: 'local', label: 'Places', hue: SEARCH_ACCENT },
  { id: 'shopping', label: 'Shopping', hue: SEARCH_ACCENT },
]

export function tabHue(id: SearchTab): string {
  return SEARCH_TABS.find((tab) => tab.id === id)?.hue ?? SEARCH_ACCENT
}

/** Alpha-washed variant of a hue for surfaces (hex in, rgba out). */
export function hueWash(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function hostname(url: string): string {
  try {
    const host = new URL(url).hostname
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return url
  }
}

/** Initials tile used when no favicon exists. */
export function domainInitials(url: string): string {
  const host = hostname(url).split('.')[0] || '?'
  return host.slice(0, 2).toUpperCase()
}

/** Deterministic, muted earth tone per domain, for initial-tile fallbacks. */
const DOMAIN_PALETTE = ['#8A6A55', '#6F7A68', '#7A6F86', '#5F7684', '#8C7A57', '#7E6A6A', '#6A7C76', '#857265']

export function domainHue(domain: string): string {
  let hash = 0
  for (let i = 0; i < domain.length; i += 1) hash = (hash * 31 + domain.charCodeAt(i)) >>> 0
  return DOMAIN_PALETTE[hash % DOMAIN_PALETTE.length]
}

/**
 * Display-only: drop private-use citation tokens some models leak into answer text
 * (U+E200 "cite" U+E202 "turn0search3" … U+E201). Citations still render as chips.
 */
export function stripCitationMarkers(text: string): string {
  return text.replace(/\uE200[^\uE201]*\uE201/g, '').replace(/[\uE200-\uE202]/g, '')
}

/** Markdown/HTML-free plain text (for one-line previews of the agent answer). */
export function plainText(markdown: string): string {
  return stripCitationMarkers(markdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\d+\]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>~|]/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}
