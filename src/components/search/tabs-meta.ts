/**
 * Shared metadata for the search results tabs. Each tab owns a hue that tints the
 * page's ambient backdrop, the lens-bar indicator and that panel's accents, so the
 * whole page quietly re-keys itself around the lens you're looking through.
 */
export type SearchTab = 'agent' | 'web' | 'local' | 'news' | 'images' | 'videos' | 'shopping'

export interface TabMeta {
  id: SearchTab
  label: string
  hue: string
}

export const SEARCH_TABS: readonly TabMeta[] = [
  { id: 'agent', label: 'AI Agent', hue: '#6366F1' },
  { id: 'web', label: 'Web', hue: '#38BDF8' },
  { id: 'local', label: 'Local', hue: '#34D399' },
  { id: 'news', label: 'News', hue: '#FBBF24' },
  { id: 'images', label: 'Images', hue: '#E879F9' },
  { id: 'videos', label: 'Videos', hue: '#FB7185' },
  { id: 'shopping', label: 'Shopping', hue: '#A78BFA' },
]

export function tabHue(id: SearchTab): string {
  return SEARCH_TABS.find((tab) => tab.id === id)?.hue ?? '#6366F1'
}

/** Alpha-washed variant of a tab hue for surfaces (hex in, rgba out). */
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

/** Deterministic pleasant hue per domain, for initial-tile fallbacks. */
const DOMAIN_PALETTE = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#14B8A6', '#F97316']

export function domainHue(domain: string): string {
  let hash = 0
  for (let i = 0; i < domain.length; i += 1) hash = (hash * 31 + domain.charCodeAt(i)) >>> 0
  return DOMAIN_PALETTE[hash % DOMAIN_PALETTE.length]
}
