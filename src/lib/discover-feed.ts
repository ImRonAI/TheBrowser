/**
 * Renderer side of `POST /discover/feed` (agent/api/core/brave_search.py). Pure functions
 * only, so `node --experimental-strip-types` can test them; no DOM, no React.
 */
import type { Story } from './articles.ts'
import type { FeedRequestBody } from './discover-profile.ts'

export type ItemKind = 'article' | 'video' | 'image' | 'place' | 'discussion' | 'web' | 'rich'
export interface RichAnswer {
  vertical: string
  subtype: string
  provider: { name?: string; url?: string; img?: string; long_name?: string }
  card: Record<string, unknown>
  raw: Record<string, unknown>
}
export interface DiscoverItem {
  kind: ItemKind
  id: string
  title: string
  url: string
  source: string
  description: string
  thumbnail: string | null
  favicon: string | null
  published: string | null
  age: string | null
  video?: { duration?: string | null; creator?: string | null; publisher?: string | null; views?: number | null } | null
  image?: { url?: string | null; width?: number | null; height?: number | null; thumbnail_width?: number | null; thumbnail_height?: number | null; confidence?: string | null } | null
  place?: Record<string, unknown> | null
  rich?: RichAnswer | null
}
export interface FeedSectionError { code: string; message: string; status?: number | null; retry_after?: number | null }
export interface FeedSection {
  kind: 'news' | 'videos' | 'images' | 'web' | 'places' | 'rich'
  q: string | null
  status: 'ok' | 'error'
  items: DiscoverItem[]
  error?: FeedSectionError | null
}
export interface FeedResponse { sections: FeedSection[] }

import { API_BASE_URL } from './api-base.ts'

export const DISCOVER_API = API_BASE_URL
/** Re-fetch when the cached feed is older than this. */
export const FEED_TTL_MS = 30 * 60 * 1000

export class DiscoverFeedError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'DiscoverFeedError'
    this.code = code
    this.status = status
  }
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

export async function fetchDiscoverFeed(body: FeedRequestBody, fetcher: Fetcher = fetch, api = DISCOVER_API): Promise<FeedResponse> {
  let response: Response
  try {
    response = await fetcher(`${api}/discover/feed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch (error) {
    throw new DiscoverFeedError(error instanceof Error ? error.message : 'Backend unreachable', 'unreachable', 0)
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { detail?: { code?: string; message?: string } | string } | null
    const info = detail && typeof detail.detail === 'object' ? detail.detail : null
    throw new DiscoverFeedError(info?.message || (typeof detail?.detail === 'string' ? detail.detail : `HTTP ${response.status}`),
      info?.code || (response.status === 503 ? 'not_configured' : 'http_error'), response.status)
  }
  const data = await response.json() as FeedResponse
  if (!data || !Array.isArray(data.sections)) throw new DiscoverFeedError('Malformed feed response', 'malformed', response.status)
  return data
}

/** Stable identity of a feed request; a changed profile invalidates the cache. */
export function feedRequestKey(body: FeedRequestBody): string {
  return JSON.stringify(body)
}

export function isFresh(fetchedAt: number | null, now = Date.now(), ttl = FEED_TTL_MS): boolean {
  return fetchedAt !== null && now - fetchedAt < ttl
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' }
/** Brave wraps hits in `<strong>` and escapes entities; render as text without needing a DOM. */
export function stripMarkup(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/&(#?\w+);/g, (match, name: string) => ENTITIES[name] ?? match).replace(/\s+/g, ' ').trim()
}

export function sectionLabel(section: Pick<FeedSection, 'kind' | 'q'>): string {
  const q = (section.q || '').trim()
  if (section.kind === 'videos') return q ? `${q} · Video` : 'Video'
  if (section.kind === 'places') return q ? `Near you · ${q}` : 'Near you'
  return q || section.kind
}

const STORY_KINDS = new Set<ItemKind>(['article', 'web', 'video', 'discussion'])

export function itemToStory(item: DiscoverItem, topic: string): Story | null {
  if (!STORY_KINDS.has(item.kind) || !item.title || !/^https?:\/\//i.test(item.url)) return null
  let hostname = ''
  try { hostname = new URL(item.url).hostname } catch { hostname = item.source || '' }
  return { title: stripMarkup(item.title), url: item.url, description: stripMarkup(item.description || ''), age: item.age || '', topic,
    hostname,
    thumbnail: item.thumbnail || '',
    source: item.source || hostname,
    favicon: item.favicon || '',
    published: item.published || '',
    kind: item.kind === 'video' ? 'video' : item.kind === 'discussion' ? 'discussion' : item.kind === 'web' ? 'web' : 'article',
  }
}

/** Story groups for the cinematic grid: one group per successful non-rich section, deduplicated by URL. */
export function sectionsToStoryGroups(sections: FeedSection[]): Story[][] {
  const seen = new Set<string>()
  const groups: Story[][] = []
  for (const section of sections) {
    if (section.status !== 'ok' || section.kind === 'rich' || section.kind === 'images' || section.kind === 'places') continue
    const topic = sectionLabel(section)
    const group: Story[] = []
    for (const item of section.items) {
      const story = itemToStory(item, topic)
      if (!story || seen.has(story.url)) continue
      seen.add(story.url)
      group.push(story)
    }
    if (group.length) groups.push(group)
  }
  return groups
}

export function richAnswers(sections: FeedSection[]): RichAnswer[] {
  const out: RichAnswer[] = []
  const seen = new Set<string>()
  for (const section of sections) {
    if (section.kind !== 'rich' || section.status !== 'ok') continue
    for (const item of section.items) {
      if (!item.rich) continue
      const key = `${item.rich.subtype}:${JSON.stringify(item.rich.card).slice(0, 200)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(item.rich)
    }
  }
  return out
}

export function failedSections(sections: FeedSection[]): FeedSection[] {
  return sections.filter((section) => section.status === 'error')
}

/**
 * Brave series arrive as `[[ts, value]]` (stocks), `[[ts, price]]`/`[price]` (crypto) or
 * `[[ts, rate]]` (currency); objects with a numeric field also appear. Return plain numbers.
 */
export function sparklinePoints(series: unknown): number[] {
  if (!Array.isArray(series)) return []
  const values: number[] = []
  for (const point of series) {
    let value: unknown = point
    if (Array.isArray(point)) value = point[point.length - 1]
    else if (point && typeof point === 'object') {
      const record = point as Record<string, unknown>
      value = record.value ?? record.price ?? record.close ?? record.rate ?? record.y
    }
    if (typeof value === 'string' && value.trim() !== '') value = Number(value)
    if (typeof value === 'number' && Number.isFinite(value)) values.push(value)
  }
  return values
}

/** SVG `points` attribute for a polyline of `values` within a `width`×`height` box. */
export function sparklinePath(values: number[], width = 96, height = 28): string {
  if (values.length < 2) return ''
  const min = Math.min(...values), max = Math.max(...values)
  const span = max - min || 1
  const step = width / (values.length - 1)
  return values.map((value, index) => `${(index * step).toFixed(1)},${(height - ((value - min) / span) * height).toFixed(1)}`).join(' ')
}

export function formatNumber(value: unknown, options: Intl.NumberFormatOptions = {}): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2, ...options }).format(value)
}

export function formatRelative(from: number, now = Date.now()): string {
  const minutes = Math.round((now - from) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

