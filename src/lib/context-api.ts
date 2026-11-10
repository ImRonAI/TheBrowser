/**
 * Context widget client: the user's context items (`/context/*`), the Context Agent's turns, and the
 * results it returns (agent/api/core/context_agent.py).
 *
 * The Context Agent is a `POST /chat` destination (`context`). Its two tools return a native tool result
 * whose first block is `{json: {...}}`, the same way `render_ui` does, so the widget reads the interest
 * graph and agent recommendations straight from the run's tool parts — no side channel.
 *
 * Pure (fetch + relative imports, no React) so node:test can run it.
 */
import type { PanelMessage, PanelState, ToolPart } from './panel-stream.ts'

export type ContextKind = 'search' | 'article' | 'link' | 'image' | 'video' | 'selection' | 'thread' | 'document'
  | 'screenshot' | 'recording' | 'file' | 'note'

export interface ContextFile { media_type: string; size: number; name: string }

export interface ContextItem {
  id: string
  kind: ContextKind
  title: string
  source: string
  added: string
  file: ContextFile | null
  preview: string
  chars: number
}

export interface NewContextItem {
  kind: Exclude<ContextKind, 'screenshot' | 'recording' | 'file'>
  title?: string
  text?: string
  url?: string
  /** kind=thread: the panel session to transcribe. */
  sessionId?: string
}

export interface NewContextFile {
  kind: 'screenshot' | 'recording' | 'image' | 'video' | 'file'
  blob: Blob
  name: string
  title?: string
  source?: string
  text?: string
}

export interface SpecialistAgent { id: string; name: string; description: string; a2a_url: string; updated_at?: string; config?: Record<string, unknown> }

export type InterestCategory = 'technology' | 'design' | 'ai' | 'privacy' | 'productivity' | 'learning' | 'entertainment' | 'news' | 'other'
export interface AgentInterest { label: string; weight: number; category: InterestCategory; reason: string }
export interface AgentRecommendation { id: string; name: string; description: string; interest: string; rationale: string; tools: string[]; skills: string[] }

export const CONTEXT_DESTINATION = 'context' as const
const CATEGORIES: InterestCategory[] = ['technology', 'design', 'ai', 'privacy', 'productivity', 'learning', 'entertainment', 'news', 'other']

async function failure(response: Response): Promise<Error> {
  let detail = `${response.status} ${response.statusText}`.trim()
  try {
    const body = await response.json() as { detail?: unknown }
    if (typeof body.detail === 'string') detail = body.detail
    else if (body.detail) detail = JSON.stringify(body.detail)
  } catch { /* not JSON */ }
  return new Error(detail)
}

export function createContextClient(apiBase: string, userId: string, fetcher: typeof fetch = fetch) {
  const base = apiBase.replace(/\/$/, '')
  const user = encodeURIComponent(userId)
  const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetcher(`${base}${path}`, init)
    if (!response.ok) throw await failure(response)
    return await response.json() as T
  }
  return {
    list: async (): Promise<ContextItem[]> => (await json<{ items: ContextItem[] }>(`/context/items?user_id=${user}`)).items,
    add: async (item: NewContextItem): Promise<ContextItem> => (await json<{ item: ContextItem }>('/context/items', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, kind: item.kind, title: item.title ?? '', text: item.text ?? '', url: item.url ?? '',
        ...(item.sessionId ? { session_id: item.sessionId } : {}) }),
    })).item,
    upload: async (file: NewContextFile): Promise<ContextItem> => {
      const form = new FormData()
      form.set('user_id', userId)
      form.set('kind', file.kind)
      form.set('title', file.title ?? '')
      form.set('source', file.source ?? '')
      form.set('text', file.text ?? '')
      form.set('file', file.blob, file.name)
      return (await json<{ item: ContextItem }>('/context/files', { method: 'POST', body: form })).item
    },
    markdown: async (id: string): Promise<string> => (await json<{ markdown: string }>(`/context/items/${encodeURIComponent(id)}?user_id=${user}`)).markdown,
    fileUrl: (id: string): string => `${base}/context/items/${encodeURIComponent(id)}/file?user_id=${user}`,
    fileBlob: async (id: string): Promise<Blob> => {
      // Revalidate: a thumbnail <img> may have cached this URL without CORS headers.
      const response = await fetcher(`${base}/context/items/${encodeURIComponent(id)}/file?user_id=${user}`, { cache: 'no-cache' })
      if (!response.ok) throw await failure(response)
      return await response.blob()
    },
    remove: async (id: string): Promise<void> => { await json(`/context/items/${encodeURIComponent(id)}?user_id=${user}`, { method: 'DELETE' }) },
    agents: async (): Promise<{ agents: SpecialistAgent[]; signInRequired: boolean }> => {
      const body = await json<{ agents: SpecialistAgent[]; sign_in_required: boolean }>(`/context/agents?user_id=${user}`)
      return { agents: body.agents, signInRequired: body.sign_in_required }
    },
  }
}

export type ContextClient = ReturnType<typeof createContextClient>

// ---------------------------------------------------------------- browsing

export interface Visit { url: string; title: string; at: number }

/** Pages worth telling the Context Agent about: public web pages, not Ron's own or local ones. */
export function isObservable(url: string): boolean {
  let parsed: URL
  try { parsed = new URL(url) } catch { return false }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
  const host = parsed.hostname
  if (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.local')) return false
  if (/^(accounts\.google|login\.|auth\.|signin\.)/.test(host) || /\/(login|signin|oauth|auth)(\/|$)/i.test(parsed.pathname)) return false
  return true
}

/** Add a visit unless it repeats the previous page (same URL without hash) or is not observable. */
export function recordVisit(queue: Visit[], visit: Visit, limit = 40): Visit[] {
  if (!isObservable(visit.url)) return queue
  const key = visit.url.split('#')[0]
  const last = queue[queue.length - 1]
  if (last && last.url.split('#')[0] === key) {
    return visit.title && visit.title !== last.title ? [...queue.slice(0, -1), { ...last, title: visit.title }] : queue
  }
  return [...queue, { ...visit, url: key }].slice(-limit)
}

/** Send once enough pages piled up, or the oldest unsent page has waited long enough. */
export function browsingDue(queue: Visit[], now: number, minPages = 5, maxWaitMs = 3 * 60_000): boolean {
  if (!queue.length) return false
  return queue.length >= minPages || now - queue[0].at >= maxWaitMs
}

const clock = (at: number) => new Date(at).toISOString().slice(11, 16)
const graphLine = (graph: { label: string; weight: number }[]) => graph.length
  ? graph.map((node) => `${node.label} (${node.weight.toFixed(2)})`).join(', ')
  : '(empty)'

export function browsingTurn(visits: Visit[], graph: { label: string; weight: number }[]): string {
  const lines = visits.map((visit) => `- ${clock(visit.at)} ${visit.title.trim() || '(untitled)'} — ${visit.url}`)
  return `[browsing]\nPages the user visited:\n${lines.join('\n')}\n\nCurrent interest graph: ${graphLine(graph)}`
}

export function contextAddedTurn(item: ContextItem, graph: { label: string; weight: number }[]): string {
  const source = item.source ? `\nSource: ${item.source}` : ''
  const preview = item.preview ? `\nExcerpt: ${item.preview.slice(0, 600)}` : ''
  return `[context added] ${item.kind}: ${item.title}${source}${preview}\n(id ${item.id}; read it in full with search_memory)\n\nCurrent interest graph: ${graphLine(graph)}`
}

export function approveAgentTurn(recommendation: AgentRecommendation): string {
  return `[approve_agent ${recommendation.id}] Build "${recommendation.name}" now.\nRecommendation: ${JSON.stringify(recommendation)}`
}

// ---------------------------------------------------------------- results

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

function jsonBlock(output: unknown, key: string): unknown {
  if (!Array.isArray(output)) return undefined
  for (const block of output) {
    const json = record(record(block).json)
    if (key in json) return json[key]
  }
  return undefined
}

export function interestsFromOutput(output: unknown): AgentInterest[] | null {
  const value = jsonBlock(output, 'interests')
  if (!Array.isArray(value)) return null
  return value.flatMap((item) => {
    const entry = record(item)
    const label = typeof entry.label === 'string' ? entry.label.trim() : ''
    const weight = typeof entry.weight === 'number' && Number.isFinite(entry.weight) ? Math.max(0, Math.min(1, entry.weight)) : NaN
    if (!label || Number.isNaN(weight)) return []
    const category = CATEGORIES.includes(entry.category as InterestCategory) ? entry.category as InterestCategory : 'other'
    return [{ label, weight, category, reason: typeof entry.reason === 'string' ? entry.reason : '' }]
  })
}

export function recommendationFromOutput(output: unknown): AgentRecommendation | null {
  const entry = record(jsonBlock(output, 'agent_recommendation'))
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  if (typeof entry.id !== 'string' || typeof entry.name !== 'string') return null
  return {
    id: entry.id, name: entry.name, description: String(entry.description ?? ''), interest: String(entry.interest ?? ''),
    rationale: String(entry.rationale ?? ''), tools: strings(entry.tools), skills: strings(entry.skills),
  }
}

const finishedTools = (messages: PanelMessage[]): ToolPart[] => messages.flatMap((message) => message.parts)
  .filter((part): part is ToolPart => part.kind === 'tool' && part.finished && (!part.status || part.status === 'success'))

export interface ContextRunResults {
  /** The newest graph the agent wrote in these messages, if any. */
  interests: AgentInterest[] | null
  recommendations: AgentRecommendation[]
  /** Names of specialists saved with create_harness. */
  created: string[]
}

export function contextResults(messages: PanelMessage[]): ContextRunResults {
  let interests: AgentInterest[] | null = null
  const recommendations: AgentRecommendation[] = []
  const created: string[] = []
  for (const part of finishedTools(messages)) {
    if (part.name === 'update_interest_graph') interests = interestsFromOutput(part.output) ?? interests
    else if (part.name === 'recommend_agent') {
      const recommendation = recommendationFromOutput(part.output)
      if (recommendation) recommendations.push(recommendation)
    } else if (part.name === 'create_harness') {
      const name = record(firstJson(part.output)).name // create_harness returns its listing as JSON text
      if (typeof name === 'string') created.push(name)
    }
  }
  return { interests, recommendations, created }
}

function firstJson(output: unknown): unknown {
  if (!Array.isArray(output)) return undefined
  for (const block of output) {
    const entry = record(block)
    if ('json' in entry) return entry.json
    if (typeof entry.text === 'string') {
      try { return JSON.parse(entry.text) } catch { /* plain text */ }
    }
  }
  return undefined
}

/** The Context Agent's latest reply text (what the widget shows under the composer). */
export function latestReply(state: PanelState): string {
  const assistant = [...state.messages].reverse().find((message) => message.role === 'assistant')
  if (!assistant) return ''
  return assistant.parts.flatMap((part) => part.kind === 'text' ? [part.text] : []).join('').trim()
}

/**
 * Discover topics: the strongest interests the Context Agent learned from browsing and saved context
 * (at most `maxLearned`, weight >= 0.45, not onboarding seeds) lead, then the profile's own topics.
 */
/** Whether a saved specialist serves an interest: built from that interest's recommendation, or its name,
 * description or instructions name the interest as a whole word. */
export function agentServesInterest(agent: SpecialistAgent, label: string, builtFor?: string): boolean {
  const key = label.trim().toLowerCase()
  if (!key) return false
  if (builtFor?.trim().toLowerCase() === key) return true
  const instructions = typeof agent.config?.instructions === 'string' ? agent.config.instructions : ''
  const text = `${agent.name}\n${agent.description}\n${instructions}`.toLowerCase()
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text)
}

export function discoverTopics(profileTopics: string[], interests: { label: string; weight: number; source?: string }[], max = 7, maxLearned = 4): string[] {
  const seen = new Set<string>()
  const fresh = (label: string) => { const key = label.trim().toLowerCase(); if (!key || seen.has(key)) return false; seen.add(key); return true }
  const learned = [...interests]
    .filter((node) => node.source !== 'onboarding' && node.weight >= 0.45)
    .sort((a, b) => b.weight - a.weight)
    .map((node) => node.label.trim())
    .filter(fresh)
    .slice(0, maxLearned)
  return [...learned, ...profileTopics.filter(fresh)].slice(0, max)
}

/** A search the user saved: the question, Ron's answer with its citations, and the top results. */
export function searchMarkdown(search: {
  query: string
  turns: { question: string; text: string }[]
  answer: string
  citations: { url: string; title: string }[]
  results: { url: string; title: string; snippet: string }[]
}): string {
  const lines = [`Search: ${search.query}`]
  for (const turn of search.turns) if (turn.text.trim()) lines.push('', `## ${turn.question}`, '', turn.text.trim())
  if (search.answer.trim()) lines.push('', "## Ren's answer", '', search.answer.trim())
  if (search.citations.length) lines.push('', '## Citations', '', ...search.citations.map((item) => `- [${item.title || item.url}](${item.url})`))
  if (search.results.length) {
    lines.push('', '## Top results', '')
    for (const result of search.results) lines.push(`- [${result.title || result.url}](${result.url})${result.snippet ? ` — ${result.snippet}` : ''}`)
  }
  return lines.join('\n')
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** A data: URL (e.g. `browser.screenshot()`) as a Blob. */
export function dataUrlBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match) throw new Error('Not a data URL')
  const [, type, base64, payload] = match
  const bytes = base64 ? Uint8Array.from(atob(payload), (char) => char.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(payload))
  return new Blob([bytes], { type })
}
