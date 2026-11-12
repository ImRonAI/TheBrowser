/**
 * Pure helpers behind the editor's "/" blocks (`src/components/board/task-detail/editor/extensions/blocks/`):
 * URL normalization for embeds (generic https, Google Maps, Figma, Loom, Vimeo, Google Drive), the
 * sources a PDF / image / media block accepts, data-URL decoding, dates, and the slash menu's search and
 * grouping. No `@/` imports so `node --experimental-strip-types --test` can run the colocated test.
 */

/** Uploads are stored inside the page HTML (pages hold at most 2,000,000 characters; 1 MB is ~1.4M base64 characters). */
export const MAX_INLINE_FILE_BYTES = 1024 * 1024

export type EmbedProvider = 'web' | 'maps' | 'figma' | 'loom' | 'vimeo' | 'drive'

export interface EmbedTarget {
  /** What the iframe loads. Always https. */
  src: string
  /** What the user gave (opened by "Open in new tab"). */
  url: string
  provider: EmbedProvider
  title: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export const EMBED_PROVIDERS: Record<EmbedProvider, { label: string; height: number; placeholder: string }> = {
  web: { label: 'Embed', height: 480, placeholder: 'Paste any https:// link' },
  maps: { label: 'Google Maps', height: 420, placeholder: 'Paste a Google Maps link or type an address' },
  figma: { label: 'Figma', height: 460, placeholder: 'Paste a Figma file, design or prototype link' },
  loom: { label: 'Loom', height: 420, placeholder: 'Paste a Loom share link' },
  vimeo: { label: 'Vimeo', height: 400, placeholder: 'Paste a Vimeo video link' },
  drive: { label: 'Google Drive', height: 560, placeholder: 'Paste a Google Docs, Sheets, Slides or Drive file link' },
}

export const EMBED_HEIGHT = { min: 120, max: 1600 }
export const clampHeight = (value: unknown, fallback: number) => {
  const number = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(number)) return fallback
  return Math.min(EMBED_HEIGHT.max, Math.max(EMBED_HEIGHT.min, Math.round(number)))
}

/** An absolute https URL without credentials, or null. `javascript:`, `data:`, `http:` and the rest are refused. */
export function parseHttpsUrl(input: string): URL | null {
  const value = input.trim()
  if (!value || /\s/.test(value)) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null
  return url
}

export const isHttpsUrl = (value: unknown): value is string => typeof value === 'string' && parseHttpsUrl(value) !== null

const hostIs = (url: URL, ...hosts: string[]) => hosts.includes(url.hostname.toLowerCase())
const isGoogleHost = (url: URL) => /^(www\.)?google\.[a-z.]+$/i.test(url.hostname) || hostIs(url, 'maps.google.com')

function mapsQuery(query: string, zoom?: string): string {
  const params = new URLSearchParams({ q: query })
  if (zoom) params.set('z', zoom)
  params.set('output', 'embed')
  return `https://www.google.com/maps?${params.toString()}`
}

/** Google Maps: a Maps link (place, search, coordinates, `?q=`), an embed link, or a plain address. No API key needed. */
export function mapsEmbed(input: string): Result<EmbedTarget> {
  const value = input.trim()
  if (!value) return { ok: false, error: 'Paste a Google Maps link or type an address.' }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return { ok: true, value: { src: mapsQuery(value), url: `https://www.google.com/maps/search/${encodeURIComponent(value)}`, provider: 'maps', title: value } }
  }
  const url = parseHttpsUrl(value)
  if (!url) return { ok: false, error: 'Use an https:// Google Maps link.' }
  if (hostIs(url, 'maps.app.goo.gl', 'goo.gl')) {
    return { ok: false, error: 'Short links cannot be embedded. Open it, then copy the full google.com/maps address.' }
  }
  if (!isGoogleHost(url) || !(url.pathname.startsWith('/maps') || hostIs(url, 'maps.google.com'))) {
    return { ok: false, error: 'That is not a Google Maps link.' }
  }
  if (url.pathname.startsWith('/maps/embed')) return { ok: true, value: { src: url.href, url: url.href, provider: 'maps', title: 'Google Maps' } }
  const decode = (segment: string) => decodeURIComponent(segment.replace(/\+/g, ' '))
  const parts = url.pathname.split('/').filter(Boolean)
  const at = parts.find((part) => part.startsWith('@'))
  const coordinates = at?.match(/^@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/)
  const named = parts[1] === 'place' || parts[1] === 'search' ? parts[2] : undefined
  const q = url.searchParams.get('q') || url.searchParams.get('query')
  if (named) {
    const title = decode(named)
    return { ok: true, value: { src: mapsQuery(title, coordinates?.[3] ? String(Math.round(Number(coordinates[3]))) : undefined), url: url.href, provider: 'maps', title } }
  }
  if (q) return { ok: true, value: { src: mapsQuery(q), url: url.href, provider: 'maps', title: q } }
  if (coordinates) {
    const point = `${coordinates[1]},${coordinates[2]}`
    return { ok: true, value: { src: mapsQuery(point, coordinates[3] ? String(Math.round(Number(coordinates[3]))) : undefined), url: url.href, provider: 'maps', title: point } }
  }
  return { ok: false, error: 'This Maps link has no place, search or coordinates to show.' }
}

/** Figma's documented embed: `https://www.figma.com/embed?embed_host=share&url=<file link>`. */
export function figmaEmbed(input: string): Result<EmbedTarget> {
  const url = parseHttpsUrl(input)
  if (!url) return { ok: false, error: 'Use an https:// Figma link.' }
  if (hostIs(url, 'embed.figma.com')) return { ok: true, value: { src: url.href, url: url.href, provider: 'figma', title: 'Figma' } }
  if (!hostIs(url, 'www.figma.com', 'figma.com')) return { ok: false, error: 'That is not a figma.com link.' }
  if (url.pathname === '/embed') return { ok: true, value: { src: url.href, url: url.searchParams.get('url') || url.href, provider: 'figma', title: 'Figma' } }
  const match = url.pathname.match(/^\/(file|design|proto|board|slides|deck)\/([A-Za-z0-9]+)(?:\/([^/?#]+))?/)
  if (!match) return { ok: false, error: 'Use a Figma file, design, prototype, board or slides link.' }
  const title = match[3] ? decodeURIComponent(match[3]).replace(/-/g, ' ') : 'Figma'
  return { ok: true, value: { src: `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(url.href)}`, url: url.href, provider: 'figma', title } }
}

export function loomEmbed(input: string): Result<EmbedTarget> {
  const url = parseHttpsUrl(input)
  if (!url || !hostIs(url, 'www.loom.com', 'loom.com')) return { ok: false, error: 'Use a loom.com share link.' }
  const match = url.pathname.match(/^\/(?:share|embed)\/([a-f0-9]{16,})/i)
  if (!match) return { ok: false, error: 'Use a Loom share link (loom.com/share/…).' }
  return { ok: true, value: { src: `https://www.loom.com/embed/${match[1]}`, url: url.href, provider: 'loom', title: 'Loom video' } }
}

export function vimeoEmbed(input: string): Result<EmbedTarget> {
  const url = parseHttpsUrl(input)
  if (!url) return { ok: false, error: 'Use an https:// Vimeo link.' }
  if (hostIs(url, 'player.vimeo.com') && /^\/video\/\d+/.test(url.pathname)) {
    return { ok: true, value: { src: url.href, url: url.href, provider: 'vimeo', title: 'Vimeo video' } }
  }
  if (!hostIs(url, 'vimeo.com', 'www.vimeo.com')) return { ok: false, error: 'That is not a vimeo.com link.' }
  const match = url.pathname.match(/^\/(?:channels\/[^/]+\/|groups\/[^/]+\/videos\/)?(\d+)(?:\/([a-f0-9]+))?\/?$/i)
  if (!match) return { ok: false, error: 'Use a Vimeo video link (vimeo.com/123456789).' }
  const hash = match[2] || url.searchParams.get('h')
  return { ok: true, value: { src: `https://player.vimeo.com/video/${match[1]}${hash ? `?h=${hash}` : ''}`, url: url.href, provider: 'vimeo', title: 'Vimeo video' } }
}

const DRIVE_KINDS: Record<string, string> = { document: 'Google Doc', spreadsheets: 'Google Sheet', presentation: 'Google Slides', forms: 'Google Form' }

/** Google Docs / Sheets / Slides / Forms and Drive files, through their `/preview` (Forms: `viewform?embedded=true`) pages. */
export function driveEmbed(input: string): Result<EmbedTarget> {
  const url = parseHttpsUrl(input)
  if (!url) return { ok: false, error: 'Use an https:// Google Drive link.' }
  if (hostIs(url, 'docs.google.com')) {
    const match = url.pathname.match(/^\/(document|spreadsheets|presentation|forms)\/d\/(e\/)?([A-Za-z0-9_-]+)/)
    if (!match) return { ok: false, error: 'Use a Google Docs, Sheets, Slides or Forms link.' }
    const [, kind, published, id] = match
    const base = `https://docs.google.com/${kind}/d/${published ?? ''}${id}`
    const src = kind === 'forms' ? `${base}/viewform?embedded=true` : `${base}/preview`
    return { ok: true, value: { src, url: url.href, provider: 'drive', title: DRIVE_KINDS[kind] } }
  }
  if (hostIs(url, 'drive.google.com')) {
    const match = url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)/)
    if (!match) return { ok: false, error: 'Use a Drive file link (drive.google.com/file/d/…).' }
    return { ok: true, value: { src: `https://drive.google.com/file/d/${match[1]}/preview`, url: url.href, provider: 'drive', title: 'Google Drive file' } }
  }
  return { ok: false, error: 'That is not a Google Drive link.' }
}

const PROVIDER_NORMALIZERS: Record<Exclude<EmbedProvider, 'web'>, (input: string) => Result<EmbedTarget>> = {
  maps: mapsEmbed, figma: figmaEmbed, loom: loomEmbed, vimeo: vimeoEmbed, drive: driveEmbed,
}

/** Which provider a link belongs to, from its host, so a generic embed of a Loom/Figma/… link uses that provider's player. */
function providerOf(url: URL): Exclude<EmbedProvider, 'web'> | null {
  const host = url.hostname.toLowerCase()
  if (isGoogleHost(url) && url.pathname.startsWith('/maps')) return 'maps'
  if (host.endsWith('figma.com')) return 'figma'
  if (host.endsWith('loom.com')) return 'loom'
  if (host.endsWith('vimeo.com')) return 'vimeo'
  if (host === 'docs.google.com' || host === 'drive.google.com') return 'drive'
  return null
}

/** Any https page in a sandboxed iframe; known providers are routed to their embed player. */
export function normalizeEmbed(input: string, provider: EmbedProvider = 'web'): Result<EmbedTarget> {
  if (provider !== 'web') return PROVIDER_NORMALIZERS[provider](input)
  const url = parseHttpsUrl(input)
  if (!url) return { ok: false, error: /^\s*(javascript|data|file|blob|vbscript):/i.test(input) ? 'That kind of link cannot be embedded.' : 'Use a full https:// link.' }
  const known = providerOf(url)
  if (known) {
    const routed = PROVIDER_NORMALIZERS[known](url.href)
    if (routed.ok) return routed
  }
  return { ok: true, value: { src: url.href, url: url.href, provider: 'web', title: url.hostname.replace(/^www\./, '') } }
}

/** What an embed block may load when read back from saved HTML: https only. */
export const safeEmbedSrc = (value: unknown): string => (isHttpsUrl(value) ? String(value).trim() : '')

export interface DataUrl { mime: string; bytes: Uint8Array }

/** A `data:<mime>;base64,<payload>` URL decoded to bytes, or null for anything else. */
export function decodeBase64DataUrl(value: string): DataUrl | null {
  const match = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]*)$/i.exec(value)
  if (!match) return null
  try {
    const binary = atob(match[2].replace(/\s+/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return { mime: match[1].toLowerCase(), bytes }
  } catch {
    return null
  }
}

/** Every PDF starts with `%PDF-`. */
export const isPdfBytes = (bytes: Uint8Array) => bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-'

export const PDF_DATA_PREFIX = 'data:application/pdf;base64,'

/** A PDF block loads an https URL, or the PDF the user uploaded into the page (a base64 `application/pdf` data URL). */
export function pdfSource(value: unknown): { kind: 'url' | 'upload'; src: string } | null {
  if (typeof value !== 'string') return null
  if (value.startsWith(PDF_DATA_PREFIX)) return /^[A-Za-z0-9+/=]+$/.test(value.slice(PDF_DATA_PREFIX.length)) ? { kind: 'upload', src: value } : null
  return isHttpsUrl(value) ? { kind: 'url', src: value.trim() } : null
}

const IMAGE_DATA = /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);base64,[A-Za-z0-9+/=]+$/i

/** An image block shows an https image or one uploaded into the page. */
export const imageSource = (value: unknown): string | null =>
  typeof value === 'string' && (isHttpsUrl(value) || IMAGE_DATA.test(value)) ? value.trim() : null

export const isDataUrl = (value: unknown) => typeof value === 'string' && value.startsWith('data:')

/** File name from a URL path (`report.pdf`), else the host. */
export function nameFromUrl(value: string): string {
  const url = parseHttpsUrl(value)
  if (!url) return value
  const last = url.pathname.split('/').filter(Boolean).pop()
  try { return last ? decodeURIComponent(last) : url.hostname } catch { return last || url.hostname }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function tooLargeMessage(name: string, bytes: number): string {
  return `${name} is ${formatBytes(bytes)}. Files stored in the page can be up to ${formatBytes(MAX_INLINE_FILE_BYTES)}; use a link for larger files.`
}

// ---------------------------------------------------------------- dates

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A calendar date (`YYYY-MM-DD`) as local midnight, or null when it is not a real date. */
export function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const match = ISO_DATE.exec(value)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

export function toIsoDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  next.setDate(next.getDate() + days)
  return next
}

/** Whole calendar days from `now` to the date (negative in the past). */
export function daysFrom(iso: string, now: Date = new Date()): number | null {
  const date = parseIsoDate(iso)
  if (!date) return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((date.getTime() - today.getTime()) / 86_400_000)
}

export function relativeDayLabel(iso: string, now: Date = new Date()): string {
  const days = daysFrom(iso, now)
  if (days === null) return ''
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  return days > 0 ? `in ${days} days` : `${-days} days ago`
}

export function formatLongDate(iso: string, locale = 'en-US'): string {
  const date = parseIsoDate(iso)
  return date ? date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : iso
}

// ---------------------------------------------------------------- slash menu search

export type SlashGroup = 'basic' | 'lists' | 'media' | 'embeds' | 'layout' | 'advanced' | 'workspace'

export const SLASH_GROUPS: readonly { id: SlashGroup; label: string }[] = [
  { id: 'basic', label: 'Basic blocks' },
  { id: 'lists', label: 'Lists' },
  { id: 'media', label: 'Media' },
  { id: 'embeds', label: 'Embeds' },
  { id: 'layout', label: 'Layout' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'workspace', label: 'Ren / Workspace' },
]

export interface SearchableItem { id: string; label: string; group: SlashGroup; keywords?: readonly string[] }

const normalize = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, ' ').trim()

/**
 * How well an item matches the typed query (lower is better), or null when it does not match:
 * 0 label starts with it, 1 a label word starts with it, 2 a keyword starts with it, 3 the label
 * contains it, 4 a keyword contains it. Spaces are optional ("todo" finds "To-Do List").
 */
export function matchScore(item: SearchableItem, query: string): number | null {
  const needle = normalize(query)
  if (!needle) return 0
  const compact = needle.replace(/ /g, '')
  const label = normalize(item.label)
  const keywords = (item.keywords ?? []).map(normalize)
  if (label.startsWith(needle) || label.replace(/ /g, '').startsWith(compact)) return 0
  if (label.split(' ').some((word) => word.startsWith(needle))) return 1
  if (keywords.some((word) => word.startsWith(needle) || word.replace(/ /g, '').startsWith(compact))) return 2
  if (label.includes(needle)) return 3
  if (keywords.some((word) => word.includes(needle))) return 4
  return null
}

export interface SlashSection<T> { group: SlashGroup; label: string; items: T[] }

/**
 * The menu's sections. With no query: every group in menu order, items in their listed order. With a
 * query: only matches, each group sorted by score, groups ordered by their best match.
 */
export function slashSections<T extends SearchableItem>(items: readonly T[], query: string): SlashSection<T>[] {
  const scored = items.map((item, index) => ({ item, index, score: matchScore(item, query) }))
    .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== null)
  const sections = SLASH_GROUPS.map(({ id, label }, order) => {
    const entries = scored.filter((entry) => entry.item.group === id).sort((a, b) => a.score - b.score || a.index - b.index)
    return { group: id, label, order, best: entries.length ? entries[0].score : Infinity, items: entries.map((entry) => entry.item) }
  }).filter((section) => section.items.length)
  if (normalize(query)) sections.sort((a, b) => a.best - b.best || a.order - b.order)
  return sections.map(({ group, label, items: sectionItems }) => ({ group, label, items: sectionItems }))
}

/** Keyboard order = display order. */
export const flattenSections = <T>(sections: readonly SlashSection<T>[]): T[] => sections.flatMap((section) => section.items)

/** Case-insensitive match of every word of the query against any of the texts (pickers for issues, chats, pages, emoji). */
export function matchesAll(texts: readonly (string | undefined | null)[], query: string): boolean {
  const words = normalize(query).split(' ').filter(Boolean)
  if (!words.length) return true
  const haystack = texts.filter(Boolean).map((text) => normalize(String(text))).join(' ')
  return words.every((word) => haystack.includes(word))
}

export interface SearchableEmoji { name: string; shortcodes: readonly string[]; tags?: readonly string[]; group?: string }

/**
 * Emoji picker ranking (lower is better), or null when not every query word matches: 0 the name or a
 * shortcode is the query, 1 one starts with it, 2 a word of one starts with it, 3 only tags/group match.
 * So "rocket" lists 🚀 before 🧑‍🚀, whose tags also say rocket.
 */
export function emojiScore(emoji: SearchableEmoji, query: string): number | null {
  if (!matchesAll([emoji.name, ...emoji.shortcodes, ...(emoji.tags ?? []), emoji.group], query)) return null
  const needle = normalize(query)
  if (!needle) return 0
  const names = [emoji.name, ...emoji.shortcodes].map(normalize)
  if (names.includes(needle)) return 0
  if (names.some((name) => name.startsWith(needle))) return 1
  if (names.some((name) => name.split(' ').some((word) => word.startsWith(needle)))) return 2
  return 3
}

/** The matching emoji, best first (dataset order within a rank). */
export function searchEmoji<T extends SearchableEmoji>(all: readonly T[], query: string, limit = 120): T[] {
  return all.map((emoji, index) => ({ emoji, index, score: emojiScore(emoji, query) }))
    .filter((entry): entry is { emoji: T; index: number; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.emoji)
}

// ---------------------------------------------------------------- colors and headings

export interface ColorChoice { id: string; label: string; value: string | null }

/** Text colors readable on both the light and dark surfaces. */
export const TEXT_COLORS: readonly ColorChoice[] = [
  { id: 'default', label: 'Default', value: null },
  { id: 'gray', label: 'Gray', value: '#8A847C' },
  { id: 'brown', label: 'Brown', value: '#A0704F' },
  { id: 'orange', label: 'Orange', value: '#D9730D' },
  { id: 'yellow', label: 'Yellow', value: '#C29A0C' },
  { id: 'green', label: 'Green', value: '#3F9A62' },
  { id: 'blue', label: 'Blue', value: '#3E7FC1' },
  { id: 'purple', label: 'Purple', value: '#9065B0' },
  { id: 'pink', label: 'Pink', value: '#C14C8A' },
  { id: 'red', label: 'Red', value: '#D44C47' },
]

/** Translucent highlight backgrounds: they tint both the light and dark surfaces. */
export const HIGHLIGHT_COLORS: readonly ColorChoice[] = [
  { id: 'none', label: 'No highlight', value: null },
  { id: 'gray', label: 'Gray', value: 'rgba(138, 132, 124, 0.25)' },
  { id: 'brown', label: 'Brown', value: 'rgba(160, 112, 79, 0.25)' },
  { id: 'orange', label: 'Orange', value: 'rgba(217, 115, 13, 0.25)' },
  { id: 'yellow', label: 'Yellow', value: 'rgba(234, 179, 8, 0.32)' },
  { id: 'green', label: 'Green', value: 'rgba(63, 154, 98, 0.25)' },
  { id: 'blue', label: 'Blue', value: 'rgba(62, 127, 193, 0.25)' },
  { id: 'purple', label: 'Purple', value: 'rgba(144, 101, 176, 0.25)' },
  { id: 'pink', label: 'Pink', value: 'rgba(193, 76, 138, 0.25)' },
  { id: 'red', label: 'Red', value: 'rgba(212, 76, 71, 0.25)' },
]

export interface HeadingEntry { level: number; text: string; pos: number }

/** Table of contents rows: empty headings dropped, depth relative to the shallowest heading present. */
export function tocRows(headings: readonly HeadingEntry[]): (HeadingEntry & { depth: number })[] {
  const present = headings.filter((heading) => heading.text.trim())
  const top = Math.min(...present.map((heading) => heading.level))
  return present.map((heading) => ({ ...heading, text: heading.text.trim(), depth: heading.level - top }))
}

export const CALLOUT_VARIANTS = ['info', 'warning', 'success', 'tip'] as const
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number]
export const calloutVariant = (value: unknown): CalloutVariant =>
  (CALLOUT_VARIANTS as readonly string[]).includes(String(value)) ? value as CalloutVariant : 'info'

/** `ron://project/<id>/docs/<page>` (the app's page deep link). */
/** A page's address: its project's Docs, or the Documents library for a personal page (no project). */
export const pageHref = (projectId: string | null, documentId: string) =>
  projectId ? `ron://project/${projectId}/docs/${documentId}` : `ron://documents/${documentId}`
export const projectHref = (projectId: string) => `ron://project/${projectId}`

/** One Markdown line for an embedded issue (what Ron reads). */
export function issueMarkdown(issue: { key: string; title: string; status?: string; dueDate?: string; projectId?: string }): string {
  const details = [issue.status && `status: ${issue.status}`, issue.dueDate && `due ${issue.dueDate}`].filter(Boolean).join(', ')
  const link = issue.projectId ? `[${issue.key}: ${issue.title}](${projectHref(issue.projectId)})` : `${issue.key}: ${issue.title}`
  return `Issue ${link}${details ? ` (${details})` : ''}`
}
