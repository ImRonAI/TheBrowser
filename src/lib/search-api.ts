/**
 * Renderer side of `POST /search/stream` (agent/api/endpoints/search.py). Pure functions
 * only, so `node --experimental-strip-types` can test them; no DOM, no React.
 *
 * One search fans out to seven sources on the backend and streams SSE frames shaped
 * `event: <name>\ndata: <json>\n\n` (same framing as the panel protocol). This module
 * parses those frames, folds them into one immutable `SearchRunState` and merges the
 * Perplexity Agent API's own `search_results` / `image_search_results` with the Brave
 * sections for the Web and Images tabs.
 */
import type { DiscoverItem, FeedSection } from './discover-feed.ts'
import type { FeedRequestBody } from './discover-profile.ts'

export type SearchLevel = 'fast' | 'low' | 'medium' | 'high' | 'xhigh'
export const SEARCH_LEVELS: readonly SearchLevel[] = ['fast', 'low', 'medium', 'high', 'xhigh']
export const DEFAULT_SEARCH_LEVEL: SearchLevel = 'low'

export interface LevelInfo { id: SearchLevel; label: string; description: string }
/** Preset descriptions per https://docs.perplexity.ai/docs/agent-api/presets */
export const LEVEL_INFO: readonly LevelInfo[] = [
  { id: 'fast', label: 'Fast', description: 'Single-fact lookups and quick summaries — latency first.' },
  { id: 'low', label: 'Balanced', description: 'Everyday research with current info and inline citations.' },
  { id: 'medium', label: 'Deep', description: 'Multi-hop browsing and wide aggregation across many sources.' },
  { id: 'high', label: 'Research', description: 'Expert-level reasoning and exhaustive source coverage.' },
  { id: 'xhigh', label: 'Max', description: 'Open-ended agentic work with long tool-use loops.' },
]
export function levelLabel(level: string): string {
  return LEVEL_INFO.find((info) => info.id === level)?.label ?? level
}

import { API_BASE_URL } from './api-base.ts'
import { normalizeApiBaseUrl } from './api-origin.ts'

/** Defaults to the main API; `electron:dev` sets this to local :8766 when the VPS tunnel lacks `/search/*`. */
export const SEARCH_API = normalizeApiBaseUrl(import.meta.env?.VITE_SEARCH_API_URL, API_BASE_URL)

export interface SearchRequestBody {
  q: string
  level?: SearchLevel
  country?: string
  location?: { location?: string; latitude?: number; longitude?: number }
  shopping?: boolean
  session_id?: string | null
  follow_up?: boolean
}

export interface AgentSearchResult {
  url: string
  title?: string
  snippet?: string
  kind?: 'online' | 'local'
  address?: string | null
  rating?: number | null
  review_count?: number | null
  price_range?: string | null
  hours?: string | null
  phone?: string | null
  distance?: number | null
  [key: string]: unknown
}
export interface AgentImageResult { url: string; width?: number | null; height?: number | null; [key: string]: unknown }
export interface Citation { url: string; title: string }
export interface SourceError { source: string; code: string; message: string; status?: number | null }

export interface SearchConversationTurn {
  id: string
  question: string
  text: string
  reasoning: string
  citations: Citation[]
  status: SourceStatus
  model: string | null
  usage: Record<string, unknown> | null
  error: SourceError | null
}

export type SearchEvent =
  | {
      event: 'meta'
      data: {
        q: string
        level: string
        model: string
        provider?: string | null
        effort?: string | null
        shopping_model: string | null
        country: string
        session_id?: string | null
        follow_up?: boolean
      }
    }
  | { event: 'section'; data: FeedSection }
  | { event: 'agent.delta'; data: { text: string } }
  | { event: 'agent.reasoning'; data: { text: string } }
  | { event: 'agent.citation'; data: Citation }
  | { event: 'agent.sources'; data: { results: AgentSearchResult[] } }
  | { event: 'agent.images'; data: { results: AgentImageResult[] } }
  | { event: 'agent.fetched'; data: { results: AgentSearchResult[] } }
  | { event: 'agent.done'; data: { usage?: Record<string, unknown> | null; model?: string | null; incomplete?: boolean } }
  | { event: 'shopping.delta'; data: { text: string } }
  | { event: 'shopping.reasoning'; data: { text: string } }
  | { event: 'shopping.citation'; data: Citation }
  | { event: 'shopping.sources'; data: { results: AgentSearchResult[] } }
  | { event: 'shopping.images'; data: { results: AgentImageResult[] } }
  | { event: 'shopping.fetched'; data: { results: AgentSearchResult[] } }
  | { event: 'shopping.done'; data: { usage?: Record<string, unknown> | null; model?: string | null; incomplete?: boolean } }
  | { event: 'source_error'; data: SourceError }
  | { event: 'done'; data: { duration_ms: number } }

export type SectionKind = 'web' | 'news' | 'videos' | 'images' | 'places'
export const SECTION_KINDS: readonly SectionKind[] = ['web', 'news', 'videos', 'images', 'places']

export type SourceStatus = 'idle' | 'streaming' | 'done' | 'error'

export interface AgentRunState {
  status: SourceStatus
  text: string
  reasoning: string
  citations: Citation[]
  sources: AgentSearchResult[]
  images: AgentImageResult[]
  fetched: AgentSearchResult[]
  usage: Record<string, unknown> | null
  model: string | null
  error: SourceError | null
}

export interface SearchRunState {
  meta: {
    q: string
    level: string
    model: string
    provider?: string | null
    effort?: string | null
    shoppingModel: string | null
    country: string
    sessionId?: string | null
    followUp?: boolean
  } | null
  sessionId: string | null
  effort: string | null
  activeQuestion: string | null
  turns: SearchConversationTurn[]
  sections: Partial<Record<SectionKind, FeedSection>>
  agent: AgentRunState
  shopping: AgentRunState
  errors: SourceError[]
  durationMs: number | null
}

function initialAgentRun(): AgentRunState {
  return { status: 'idle', text: '', reasoning: '', citations: [], sources: [], images: [], fetched: [],
    usage: null, model: null, error: null }
}

export function initialRunState(): SearchRunState {
  return {
    meta: null,
    sessionId: null,
    effort: null,
    activeQuestion: null,
    turns: [],
    sections: {},
    agent: initialAgentRun(),
    shopping: initialAgentRun(),
    errors: [],
    durationMs: null,
  }
}

/**
 * Archive the completed current agent answer into `state.turns` and reset `state.agent`
 * to stream a conversational follow-up turn while preserving accumulated sources/images,
 * Brave sections, shopping results, and `sessionId`.
 */
export function beginFollowUpState(state: SearchRunState, question: string): SearchRunState {
  const previousQuestion = state.activeQuestion || state.meta?.q || ''
  const hasPreviousTurn = Boolean(state.agent.text || state.agent.reasoning || state.agent.error)
  const nextTurns: SearchConversationTurn[] = hasPreviousTurn
    ? [
        ...state.turns,
        {
          id: `turn-${state.turns.length + 1}`,
          question: previousQuestion,
          text: state.agent.text,
          reasoning: state.agent.reasoning,
          citations: state.agent.citations,
          status: state.agent.status === 'streaming' ? 'done' : state.agent.status,
          model: state.agent.model,
          usage: state.agent.usage,
          error: state.agent.error,
        },
      ]
    : state.turns

  return {
    ...state,
    activeQuestion: question,
    turns: nextTurns,
    agent: {
      ...initialAgentRun(),
      status: 'streaming',
      sources: state.agent.sources,
      images: state.agent.images,
      fetched: state.agent.fetched,
    },
  }
}

/** Which query and level a stored run belongs to; the results page starts a run only when this changes. */
export function searchRunKey(q: string, level: string): string {
  return `${level}:${q}`
}

export const CANCELLED_ANSWER_MESSAGE = 'Stopped before an answer was written.'
export const CANCELLED_SECTION_MESSAGE = 'Stopped before results arrived.'

/**
 * Settle a run the user stopped. The aborted stream delivers no further events, so every
 * lane still `idle`/`streaming` is closed here: one with text keeps it as a finished
 * answer, one without becomes a `cancelled` error (rendered with Retry), and each Brave
 * section that never arrived becomes a `cancelled` error section instead of a skeleton.
 * A follow-up streams only the agent lane (the backend skips Brave and shopping for
 * `follow_up`), so `'follow-up'` settles that lane alone.
 */
export function settleCancelledRun(state: SearchRunState, scope: 'search' | 'follow-up' = 'search'): SearchRunState {
  const settle = (lane: AgentRunState, source: 'agent' | 'shopping'): AgentRunState => {
    if (lane.status !== 'idle' && lane.status !== 'streaming') return lane
    if (lane.text) return { ...lane, status: 'done' }
    return { ...lane, status: 'error', error: { source, code: 'cancelled', message: CANCELLED_ANSWER_MESSAGE } }
  }
  const agent = settle(state.agent, 'agent')
  if (scope === 'follow-up') return { ...state, agent }
  const sections = { ...state.sections }
  for (const kind of SECTION_KINDS) {
    if (sections[kind]) continue
    sections[kind] = {
      kind,
      q: state.meta?.q ?? state.activeQuestion,
      status: 'error',
      items: [],
      error: { code: 'cancelled', message: CANCELLED_SECTION_MESSAGE },
    }
  }
  return { ...state, agent, shopping: settle(state.shopping, 'shopping'), sections }
}

/** Places count the search stream asks Brave for (`SECTION_COUNTS["places"]` in agent/api/endpoints/search.py). */
export const PLACES_RESULT_COUNT = 20

/**
 * `POST /discover/feed` body that re-runs only the Places section of a search. The feed
 * route and the search stream share `run_section`, so this returns the same section the
 * stream would for the new location.
 */
export function placesRefreshRequest(q: string, opts: { country: string; location?: string | null }): FeedRequestBody {
  const location = opts.location?.trim()
  return {
    sections: [{ kind: 'places', q, count: PLACES_RESULT_COUNT }],
    ...(location ? { location: { location } } : {}),
    country: opts.country,
  }
}

function mergeByUrl<T extends { url: string }>(existing: T[], incoming: T[]): T[] {
  if (!incoming.length) return existing
  const seen = new Set(existing.map((item) => item.url))
  const merged = [...existing]
  for (const item of incoming) {
    if (!item.url || seen.has(item.url)) continue
    seen.add(item.url)
    merged.push(item)
  }
  return merged
}

function applyAgentEvent(run: AgentRunState, name: string, data: Record<string, unknown>): AgentRunState {
  switch (name) {
    case 'delta':
      return { ...run, status: run.status === 'error' ? 'error' : 'streaming', text: run.text + (data.text as string) }
    case 'reasoning':
      return { ...run, status: run.status === 'error' ? 'error' : 'streaming', reasoning: run.reasoning + (data.text as string) }
    case 'citation': {
      const citation = data as unknown as Citation
      if (!citation.url || run.citations.some((c) => c.url === citation.url)) return run
      return { ...run, citations: [...run.citations, citation] }
    }
    case 'sources':
      return { ...run, sources: mergeByUrl(run.sources, (data.results as AgentSearchResult[]) || []) }
    case 'images':
      return { ...run, images: mergeByUrl(run.images, (data.results as AgentImageResult[]) || []) }
    case 'fetched':
      return { ...run, fetched: mergeByUrl(run.fetched, (data.results as AgentSearchResult[]) || []) }
    case 'done':
      return { ...run, status: run.status === 'error' ? 'error' : 'done',
        usage: (data.usage as Record<string, unknown> | null) ?? null, model: (data.model as string | null) ?? null }
    default:
      return run
  }
}

export function applySearchEvent(state: SearchRunState, event: SearchEvent): SearchRunState {
  if (event.event === 'meta') {
    const { q, level, model, provider, effort, shopping_model, country, session_id, follow_up } = event.data
    const nextMeta = {
      q: follow_up && state.meta?.q ? state.meta.q : q,
      level,
      model,
      ...(provider !== undefined ? { provider } : {}),
      ...(effort !== undefined ? { effort } : {}),
      shoppingModel: shopping_model ?? state.meta?.shoppingModel ?? null,
      country,
      ...(session_id !== undefined ? { sessionId: session_id } : {}),
      ...(follow_up !== undefined ? { followUp: follow_up } : {}),
    }
    return {
      ...state,
      meta: nextMeta,
      sessionId: session_id ?? state.sessionId,
      effort: effort ?? state.effort,
      activeQuestion: state.activeQuestion ?? q,
    }
  }
  if (event.event === 'section') {
    const section = event.data
    const kind = section.kind as SectionKind
    if (!SECTION_KINDS.includes(kind)) return state
    return { ...state, sections: { ...state.sections, [kind]: section } }
  }
  if (event.event.startsWith('agent.')) {
    return { ...state, agent: applyAgentEvent(state.agent, event.event.slice('agent.'.length), event.data as Record<string, unknown>) }
  }
  if (event.event.startsWith('shopping.')) {
    return { ...state, shopping: applyAgentEvent(state.shopping, event.event.slice('shopping.'.length), event.data as Record<string, unknown>) }
  }
  if (event.event === 'source_error') {
    const error = event.data
    if (error.source === 'agent') return { ...state, agent: { ...state.agent, status: 'error', error } }
    if (error.source === 'shopping') return { ...state, shopping: { ...state.shopping, status: 'error', error } }
    return { ...state, errors: [...state.errors, error] }
  }
  if (event.event === 'done') {
    return { ...state, durationMs: event.data.duration_ms }
  }
  return state
}

/** One SSE block (`event:` + `data:` lines) -> a typed event, or null. */
export function parseSseBlock(block: string): SearchEvent | null {
  let name: string | null = null
  let data: string | null = null
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) name = line.slice('event:'.length).trim()
    else if (line.startsWith('data:')) data = line.slice('data:'.length).trim()
  }
  if (!name || !data) return null
  try {
    return { event: name, data: JSON.parse(data) } as SearchEvent
  } catch {
    return null
  }
}

export class SearchApiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'SearchApiError'
    this.code = code
    this.status = status
  }
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

/** POST the search and invoke `onEvent` per SSE frame until the stream ends or aborts. */
export async function streamSearch(
  body: SearchRequestBody,
  onEvent: (event: SearchEvent) => void,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
  api = SEARCH_API,
): Promise<void> {
  let response: Response
  try {
    response = await fetcher(`${api}/search/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new SearchApiError(error instanceof Error ? error.message : 'Backend unreachable', 'unreachable', 0)
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { detail?: { code?: string; message?: string } | string } | null
    const info = detail && typeof detail.detail === 'object' ? detail.detail : null
    throw new SearchApiError(info?.message || (typeof detail?.detail === 'string' ? detail.detail : `HTTP ${response.status}`),
      info?.code || (response.status === 503 ? 'not_configured' : 'http_error'), response.status)
  }
  if (!response.body) throw new SearchApiError('Search stream had no body', 'malformed', response.status)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const flush = (final: boolean) => {
    let index: number
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      const event = parseSseBlock(block)
      if (event) onEvent(event)
    }
    if (final && buffer.trim()) {
      const event = parseSseBlock(buffer)
      if (event) onEvent(event)
      buffer = ''
    }
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      flush(false)
    }
    buffer += decoder.decode()
    flush(true)
  } finally {
    reader.releaseLock()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab projections
// ─────────────────────────────────────────────────────────────────────────────

export interface MergedResult {
  url: string
  title: string
  snippet: string
  /** 'agent' = only the Perplexity Agent API saw it, 'brave' = only Brave, 'both'. */
  origin: 'agent' | 'brave' | 'both'
  kind: 'web' | 'discussion'
  favicon: string | null
  age: string | null
}

/** Web tab: the Agent API's own `search_results` merged with Brave web + discussions, URL-deduped. */
export function mergedWebResults(state: SearchRunState): MergedResult[] {
  const byUrl = new Map<string, MergedResult>()
  for (const source of state.agent.sources) {
    if (!source.url) continue
    byUrl.set(source.url, {
      url: source.url, title: source.title || source.url, snippet: (source.snippet as string) || '',
      origin: 'agent', kind: 'web', favicon: null, age: null,
    })
  }
  const section = state.sections.web
  if (section?.status === 'ok') {
    for (const item of section.items) {
      if (!item.url) continue
      const kind = item.kind === 'discussion' ? 'discussion' : 'web'
      const existing = byUrl.get(item.url)
      if (existing) {
        byUrl.set(item.url, { ...existing, origin: 'both', favicon: existing.favicon ?? item.favicon,
          age: existing.age ?? item.age, snippet: existing.snippet || item.description || '' })
      } else {
        byUrl.set(item.url, { url: item.url, title: item.title || item.url, snippet: item.description || '',
          origin: 'brave', kind, favicon: item.favicon, age: item.age })
      }
    }
  }
  return [...byUrl.values()]
}

export interface MergedImage {
  url: string
  pageUrl: string | null
  title: string
  width: number | null
  height: number | null
  origin: 'agent' | 'brave'
}

/** Images tab: Agent API `image_search_results` + Brave images, URL-deduped (agent first). */
export function mergedImages(state: SearchRunState): MergedImage[] {
  const seen = new Set<string>()
  const out: MergedImage[] = []
  for (const image of state.agent.images) {
    if (!image.url || seen.has(image.url)) continue
    seen.add(image.url)
    out.push({ url: image.url, pageUrl: (image.page_url as string) || (image.source as string) || null,
      title: (image.title as string) || '', width: image.width ?? null, height: image.height ?? null, origin: 'agent' })
  }
  const section = state.sections.images
  if (section?.status === 'ok') {
    for (const item of section.items) {
      const url = item.image?.url || item.thumbnail || ''
      if (!url || seen.has(url)) continue
      seen.add(url)
      out.push({ url, pageUrl: item.url || null, title: item.title || '',
        width: item.image?.width ?? null, height: item.image?.height ?? null,
        origin: 'brave' })
    }
  }
  return out
}

/** Section items for the simple single-source tabs. */
export function sectionItems(state: SearchRunState, kind: SectionKind): DiscoverItem[] {
  const section = state.sections[kind]
  return section?.status === 'ok' ? section.items : []
}
