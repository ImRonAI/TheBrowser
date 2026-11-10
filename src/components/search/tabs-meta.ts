/**
 * Shared metadata for the search results tabs. Ren uses one accent for every lens: volt,
 * which follows the theme (blurple 600 on paper, 400 on ink). `hue` stays on the contract so
 * panels can tint small marks, and every tab resolves to the same volt colour.
 */
export type SearchTab = 'agent' | 'web' | 'local' | 'news' | 'images' | 'videos' | 'shopping'

export interface TabMeta {
  id: SearchTab
  label: string
  hue: string
}

/** The one accent: volt, read from the theme's `--ren-volt` channels (docs/brand.md). */
export const SEARCH_ACCENT = 'rgb(var(--ren-volt))'

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

/**
 * Alpha-washed variant of a hue for surfaces. Takes a theme token in the `rgb(var(--token))`
 * form (what `SEARCH_ACCENT` is) or a `#rrggbb` hex, and returns a CSS colour with that alpha.
 */
export function hueWash(hue: string, alpha: number): string {
  const token = /^rgb\((var\(--[\w-]+\))\)$/.exec(hue)
  if (token) return `rgb(${token[1]} / ${alpha})`
  const r = parseInt(hue.slice(1, 3), 16)
  const g = parseInt(hue.slice(3, 5), 16)
  const b = parseInt(hue.slice(5, 7), 16)
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

/**
 * Deterministic tone per domain for initial-tile fallbacks, drawn from Ren's own theme tokens
 * (volt, deep volt, soft volt, muted ink) so every tone follows Light, Dark and Glass.
 */
const DOMAIN_PALETTE = [
  'rgb(var(--ren-volt))',
  'rgb(var(--ren-volt-deep))',
  'rgb(var(--ren-volt-soft))',
  'hsl(var(--muted-foreground))',
]

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
  return text.replace(/[^]*/g, '').replace(/[-]/g, '')
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
