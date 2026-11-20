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
  title?: string | undefined
  text?: string | undefined
  url?: string | undefined
  /** kind=thread: the panel session to transcribe. */
  sessionId?: string | undefined
}

export interface NewContextFile {
  kind: 'screenshot' | 'recording' | 'image' | 'video' | 'file'
  blob: Blob
  name: string
  title?: string | undefined
  source?: string | undefined
  text?: string | undefined
}

export interface SpecialistAgent {
  id: string; name: string; description: string; a2a_url: string; updated_at?: string; config?: Record<string, unknown>
  /** When it runs on its own (`agent_schedules`); null or absent = only when the user starts it. */
  schedule?: AgentSchedule | null
}

/** Scheduled runs (agent/api/core/agent_schedules.py). `time` and `weekday` are in `timezone`; weekday 0 = Monday. */
export type ScheduleEvery = 'hours' | 'day' | 'weekdays' | 'week'
export interface AgentCadence { every: ScheduleEvery; hours: number; time: string; weekday: number; timezone: string }
export interface AgentSchedule { cadence: AgentCadence; task: string; enabled: boolean; next_run_at: string | null }
export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'checkpointed'
/** One run of a specialist: a panel session (`session_id`) the Agent Panel opens as that specialist. */
export interface AgentRun {
  id: string; agent_id: string; agent_name: string; session_id: string; trigger: 'schedule' | 'manual'
  status: AgentRunStatus; summary: string; error: string; started_at: string; finished_at: string | null; seen_at: string | null
}

/** A dream's notification (`GET /context/dream`): each topic it changed, as it reads now (null: the dream deleted it). */
export interface DreamTopic { key: string; text: string | null }
export interface Dream { version: string; topics: DreamTopic[] }
/** The user's review of one topic: right or wrong, with an optional comment for the dreaming agent. */
export interface TopicReview { key: string; right: boolean; comment: string }

export type InterestCategory = 'technology' | 'design' | 'ai' | 'privacy' | 'productivity' | 'learning' | 'entertainment' | 'news' | 'other'
export interface AgentInterest { label: string; weight: number; category: InterestCategory; reason: string }
/** What a recommendation builds: a specialist agent, a project, or an app OpenCode makes. */
export type RecommendationKind = 'agent' | 'web' | 'android' | 'project'
export interface AgentRecommendation {
  id: string; kind: RecommendationKind; name: string; description: string; interest: string; rationale: string
  tools: string[]; skills: string[]; key?: string; issues?: string[]
}

/** A drafted reply to an incoming text or app notification (`draft_reply`). Sent only after approval. */
export interface ReplyDraft {
  id: string; sender: string; app: string; incoming: string; draft: string; notification_key: string; to: string
}

/** A live notification posted by an app on the user's phone (`RenNotificationListener.onNotificationPosted`). */
export interface PhoneNotification {
  key: string; app: string; package: string; title: string; text: string; at: string; can_reply: boolean
  category?: string | null; messages?: { from: string; text: string; at: string }[]
}

export interface SearchObservation { query: string; summary?: string; at: number }
export interface ChatObservation { channel: string; user: string; assistant?: string; at: number }

/** An app OpenCode built for the account (`register_application`, `GET /context/applications`). */
export interface Application {
  id: string
  name: string
  kind: 'web' | 'android'
  location: string
  description: string
  created_at: number
  icon?: string
}

/** Sent on `window` when an app joins the account's Applications, so the sidebar lists it at once. */
export const APPLICATIONS_CHANGED = 'ren:applications-changed'

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
    applications: async (): Promise<Application[]> => (await json<{ applications: Application[] }>(`/context/applications?user_id=${user}`)).applications,
    agents: async (): Promise<{ agents: SpecialistAgent[]; signInRequired: boolean }> => {
      const body = await json<{ agents: SpecialistAgent[]; sign_in_required: boolean }>(`/context/agents?user_id=${user}`)
      return { agents: body.agents, signInRequired: body.sign_in_required }
    },
    /** Save when the specialist runs on its own; a null cadence stops its schedule. */
    setSchedule: async (agentId: string, cadence: AgentCadence | null, task = ''): Promise<AgentSchedule | null> =>
      (await json<{ schedule: AgentSchedule | null }>(`/context/agents/${encodeURIComponent(agentId)}/schedule`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, cadence, task }),
      })).schedule,
    runNow: async (agentId: string): Promise<AgentRun> => (await json<{ run: AgentRun }>(`/context/agents/${encodeURIComponent(agentId)}/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId }),
    })).run,
    runs: async (): Promise<{ runs: AgentRun[]; signInRequired: boolean }> => {
      const body = await json<{ runs: AgentRun[]; sign_in_required: boolean }>(`/context/runs?user_id=${user}`)
      return { runs: body.runs, signInRequired: body.sign_in_required }
    },
    markRunSeen: async (runId: string): Promise<void> => {
      await json(`/context/runs/${encodeURIComponent(runId)}/seen`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId }),
      })
    },
    /** The newest dream the user has not reviewed or dismissed, or null. */
    dream: async (): Promise<Dream | null> => (await json<{ dream: Dream | null }>(`/context/dream?user_id=${user}`)).dream,
    /** Close the dream's notification; a non-empty review goes to the dreaming agent. */
    reviewDream: async (version: string, topics: TopicReview[]): Promise<void> => {
      await json(`/context/dream/${encodeURIComponent(version)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, topics }),
      })
    },
  }
}

/** When the dream ran, as ISO: its version is `YYYYMMDDTHHMMSSffffff` in UTC (core/dreaming.py). */
export function dreamTime(version: string): string {
  const v = version
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(9, 11)}:${v.slice(11, 13)}:${v.slice(13, 15)}Z`
}

/** "memory/brain/<agent>/<topic>.md" as the notice names it: the topic's heading, else its file name, and the agent. */
export function dreamTopicLabel(topic: DreamTopic): { title: string; agent: string } {
  const [, , agent = '', file = ''] = topic.key.split('/')
  const firstLine = topic.text?.split('\n', 1)[0]
  const heading = firstLine?.replace(/^#+\s*/, '').trim()
  return { title: heading || file.replace(/\.md$/, '').replace(/-/g, ' '), agent }
}

// ---------------------------------------------------------------- scheduled runs

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

/** A new schedule: every day at 08:00 in the user's own time zone. */
export function defaultCadence(timezone: string): AgentCadence {
  return { every: 'day', hours: 24, time: '08:00', weekday: 0, timezone: timezone || 'UTC' }
}

/** "08:00" as the user's clock shows it ("8:00 AM" in en-US). */
export function clockLabel(time: string, locale?: string): string {
  const [hour, minute] = time.split(':').map(Number)
  return new Date(2000, 0, 3, hour, minute).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
}

export function cadenceLabel(cadence: AgentCadence, locale?: string): string {
  if (cadence.every === 'hours') return cadence.hours === 1 ? 'Every hour' : `Every ${cadence.hours} hours`
  const at = clockLabel(cadence.time, locale)
  if (cadence.every === 'day') return `Daily at ${at}`
  if (cadence.every === 'weekdays') return `Weekdays at ${at}`
  return `${WEEKDAYS[cadence.weekday]}s at ${at}`
}

/** "Fri, Nov 14, 8:00 AM" for a next-run time. */
export function whenLabel(iso: string, locale?: string): string {
  return new Date(iso).toLocaleString(locale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Finished runs the user has not opened yet, newest first: what the Context widget notifies about. */
export function runNotifications(runs: AgentRun[]): AgentRun[] {
  return runs.filter((run) => run.status !== 'running' && !run.seen_at)
    .sort((a, b) => (b.finished_at ?? b.started_at).localeCompare(a.finished_at ?? a.started_at))
}

export function runStatusLabel(status: AgentRunStatus): string {
  return { running: 'Running', completed: 'Finished', failed: 'Failed', cancelled: 'Stopped',
    interrupted: 'Waiting for you', checkpointed: 'Paused' }[status]
}

/** A run's Markdown report as one line of plain text for the notification card. */
export function plainSummary(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/gm, '')
    .replace(/(\*\*|__|\*|_|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A failed run's error for the notification: the provider's lead sentence, without the JSON payload that often
 * follows it ("429 Too Many Requests. {'message': …}"). The full error stays on the run and in its thread.
 */
export function runErrorLine(error: string): string {
  const lead = (error.split(/[{[]/, 1)[0] ?? '').replace(/\s+/g, ' ').trim()
  return lead || plainSummary(error)
}

/** What the notification says happened, from the run's status and how it was started. */
export function runHeadline(run: Pick<AgentRun, 'status' | 'trigger'>): string {
  if (run.status === 'completed') return run.trigger === 'schedule' ? 'Finished its scheduled run' : 'Finished its run'
  if (run.status === 'failed') return 'Run failed'
  if (run.status === 'interrupted') return 'Needs your answer'
  if (run.status === 'checkpointed') return 'Paused at a checkpoint'
  if (run.status === 'cancelled') return 'Run stopped'
  return 'Running'
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function agoLabel(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
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
  const key = visit.url.split('#')[0] ?? visit.url
  const last = queue[queue.length - 1]
  if (last && last.url.split('#')[0] === key) {
    return visit.title && visit.title !== last.title ? [...queue.slice(0, -1), { ...last, title: visit.title }] : queue
  }
  return [...queue, { ...visit, url: key }].slice(-limit)
}

/** Send once enough observations piled up, or the oldest unsent one has waited long enough. */
export function browsingDue(
  queue: Visit[], now: number, minPages = 5, maxWaitMs = 3 * 60_000,
  searches: SearchObservation[] = [], chats: ChatObservation[] = [],
): boolean {
  const total = queue.length + searches.length + chats.length
  if (!total) return false
  const oldest = Math.min(
    queue[0]?.at ?? Infinity,
    searches[0]?.at ?? Infinity,
    chats[0]?.at ?? Infinity,
  )
  return total >= minPages || now - oldest >= maxWaitMs
}

const clock = (at: number) => new Date(at).toISOString().slice(11, 16)
const graphLine = (graph: { label: string; weight: number }[]) => graph.length
  ? graph.map((node) => `${node.label} (${node.weight.toFixed(2)})`).join(', ')
  : '(empty)'

export function browsingTurn(
  visits: Visit[], graph: { label: string; weight: number }[],
  searches: SearchObservation[] = [], chats: ChatObservation[] = [],
): string {
  const sections: string[] = ['[browsing]']
  if (visits.length) {
    const lines = visits.map((visit) => `- ${clock(visit.at)} ${visit.title.trim() || '(untitled)'} — ${visit.url}`)
    sections.push(`Pages the user visited:\n${lines.join('\n')}`)
  }
  if (searches.length) {
    const lines = searches.map((item) => `- ${clock(item.at)} "${item.query.trim()}"${item.summary?.trim() ? ` — ${item.summary.trim().slice(0, 240)}` : ''}`)
    sections.push(`Searches the user ran:\n${lines.join('\n')}`)
  }
  if (chats.length) {
    const lines = chats.map((item) => `- ${clock(item.at)} [${item.channel}] User: ${item.user.trim().slice(0, 300)}`
      + (item.assistant?.trim() ? ` | Ren: ${item.assistant.trim().slice(0, 240)}` : ''))
    sections.push(`Chats and user responses:\n${lines.join('\n')}`)
  }
  sections.push(`Current interest graph: ${graphLine(graph)}`)
  return sections.join('\n\n')
}

/**
 * What happened on the user's phone between two reports (ren mobile's `ContextWidget.report`): the apps they used, what
 * Ren did there, and their calls and texts (the phone tools' `calls_recent` and `sms_list` rows).
 */
export interface PhoneApp { name: string; minutes: number }
export interface PhoneAction { text: string; at: number }
export interface PhoneCall { kind: string; number: string; name?: string | null; seconds: number; at: string }
export interface PhoneSms { from: string; number: string; contact?: string | null; text: string; at: string; unread?: boolean }
export interface PhoneActivity { since: number; until: number; apps: PhoneApp[]; actions: PhoneAction[]; calls: PhoneCall[]; sms: PhoneSms[] }

const moment = (at: number) => new Date(at).toISOString().slice(0, 16).replace('T', ' ')

export function hasPhoneActivity(activity: PhoneActivity): boolean {
  return Boolean(activity.apps.length || activity.actions.length || activity.calls.length || activity.sms.length)
}

/** Pages visited in the phone's browser are browsing turns, and each notification its own turn; this is the rest of the phone. */
export function phoneTurn(activity: PhoneActivity, graph: { label: string; weight: number }[]): string {
  const apps = activity.apps.map((app) => `- ${app.name.trim() || '(unnamed app)'} — ${app.minutes} min`)
  const actions = activity.actions.map((action) => `- ${moment(action.at)} ${action.text.trim()}`)
  const sections = [
    `[phone]\nThe user's phone from ${moment(activity.since)} to ${moment(activity.until)} UTC.`,
    `Apps they used (time on screen):\n${apps.join('\n') || '(none)'}`,
    `What Ren did on the phone for them:\n${actions.join('\n') || '(nothing)'}`,
  ]
  if (activity.calls.length) {
    const calls = activity.calls.map((call) =>
      `- ${call.at} [${call.kind}] ${call.name ? `${call.name} (${call.number})` : call.number || '(unknown)'} — ${call.seconds}s`)
    sections.push(`Calls:\n${calls.join('\n')}`)
  }
  if (activity.sms.length) {
    const sms = activity.sms.map((msg) =>
      `- ${msg.at} ${msg.from === 'me' ? `me -> ${msg.contact ? `${msg.contact} (${msg.number})` : msg.number}` : `${msg.from} (${msg.number})`}: ${msg.text.trim().slice(0, 500)}`)
    sections.push(`Texts:\n${sms.join('\n')}`)
  }
  sections.push(`Current interest graph: ${graphLine(graph)}`)
  return sections.join('\n\n')
}

export function contextAddedTurn(item: ContextItem, graph: { label: string; weight: number }[]): string {
  const source = item.source ? `\nSource: ${item.source}` : ''
  const preview = item.preview ? `\nExcerpt: ${item.preview.slice(0, 600)}` : ''
  return `[context added] ${item.kind}: ${item.title}${source}${preview}\n(id ${item.id}; read it in full with search_memory)\n\nCurrent interest graph: ${graphLine(graph)}`
}

export const TWICE_DAILY_MS = 12 * 60 * 60_000

export function reviewDue(lastReviewAt: number, hasNewNotes: boolean, now: number, intervalMs = TWICE_DAILY_MS): boolean {
  return hasNewNotes && now - lastReviewAt >= intervalMs
}

export function notificationTurn(notification: PhoneNotification, graph: { label: string; weight: number }[]): string {
  const thread = notification.messages?.length
    ? `\nRecent thread:\n${notification.messages.map((m) => `- ${m.from}: ${m.text}`).join('\n')}`
    : ''
  const target = notification.can_reply ? `notification_key=${notification.key}` : 'can_reply=false'
  return `[notification] App: ${notification.app} (${notification.package})\n`
    + `From/Title: ${notification.title || '(none)'}\n`
    + `Text: ${notification.text || '(empty)'}\n`
    + `Reply target: ${target}${thread}\n\nCurrent interest graph: ${graphLine(graph)}`
}

export function sendReplyTurn(draft: ReplyDraft, text: string): string {
  return `[send_reply ${draft.id}] The user tapped Send on this reply. Ask for approval with phone_request_approval(action_type="send_messages", ...) FIRST, then send only if approved.\n`
    + JSON.stringify({ ...draft, draft: text })
}

export function reviewTurn(graph: { label: string; weight: number }[], existingRecommendations: string[]): string {
  const known = existingRecommendations.length ? existingRecommendations.join(', ') : '(none)'
  return `[review]\nTwice-daily review of your journal and long-term memory.\n`
    + `Already recommended: ${known}\n`
    + `Current interest graph: ${graphLine(graph)}`
}

export function approveAgentTurn(recommendation: AgentRecommendation): string {
  // Recommendations saved before apps existed carry no kind: they are agents.
  if (recommendation.kind === 'project') {
    return `[approve_project ${recommendation.id}] Create the project "${recommendation.name}" now.\nRecommendation: ${JSON.stringify(recommendation)}`
  }
  if (recommendation.kind === 'web' || recommendation.kind === 'android') {
    return `[approve_app ${recommendation.id}] Build the ${recommendation.kind === 'web' ? 'web' : 'Android'} app "${recommendation.name}" now.\nRecommendation: ${JSON.stringify(recommendation)}`
  }
  return `[approve_agent ${recommendation.id}] Build "${recommendation.name}" now.\nRecommendation: ${JSON.stringify(recommendation)}`
}

// ---------------------------------------------------------------- results

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

function jsonBlock(output: unknown, key: string): unknown {
  if (!Array.isArray(output)) return undefined
  for (const block of output) {
    const json = record(record(block)["json"])
    if (key in json) return json[key]
  }
  return undefined
}

export function interestsFromOutput(output: unknown): AgentInterest[] | null {
  const value = jsonBlock(output, 'interests')
  if (!Array.isArray(value)) return null
  return value.flatMap((item) => {
    const entry = record(item)
    const label = typeof entry["label"] === 'string' ? entry["label"].trim() : ''
    const weight = typeof entry["weight"] === 'number' && Number.isFinite(entry["weight"]) ? Math.max(0, Math.min(1, entry["weight"])) : NaN
    if (!label || Number.isNaN(weight)) return []
    const category = CATEGORIES.includes(entry["category"] as InterestCategory) ? entry["category"] as InterestCategory : 'other'
    return [{ label, weight, category, reason: typeof entry["reason"] === 'string' ? entry["reason"] : '' }]
  })
}

export function recommendationFromOutput(output: unknown): AgentRecommendation | null {
  const entry = record(jsonBlock(output, 'agent_recommendation'))
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  if (typeof entry["id"] !== 'string' || typeof entry["name"] !== 'string') return null
  const kind: RecommendationKind = entry["kind"] === 'web' || entry["kind"] === 'android' || entry["kind"] === 'project' ? entry["kind"] : 'agent'
  return {
    id: entry["id"], kind, name: entry["name"], description: String(entry["description"] ?? ''), interest: String(entry["interest"] ?? ''),
    rationale: String(entry["rationale"] ?? ''), tools: strings(entry["tools"]), skills: strings(entry["skills"]),
    ...(typeof entry["key"] === 'string' && entry["key"] ? { key: entry["key"] } : {}),
    ...(Array.isArray(entry["issues"]) ? { issues: strings(entry["issues"]) } : {}),
  }
}

export function replyDraftFromOutput(output: unknown): ReplyDraft | null {
  const entry = record(jsonBlock(output, 'reply_draft'))
  if (typeof entry["id"] !== 'string' || typeof entry["sender"] !== 'string' || typeof entry["app"] !== 'string' || typeof entry["draft"] !== 'string') return null
  return {
    id: entry["id"], sender: entry["sender"], app: entry["app"], incoming: String(entry["incoming"] ?? ''),
    draft: entry["draft"], notification_key: String(entry["notification_key"] ?? ''), to: String(entry["to"] ?? ''),
  }
}

const finishedTools = (messages: PanelMessage[]): ToolPart[] => messages.flatMap((message) => message.parts)
  .filter((part): part is ToolPart => part.kind === 'tool' && part.finished && (!part.status || part.status === 'success'))

export interface ContextRunResults {
  /** The newest graph the agent wrote in these messages, if any. */
  interests: AgentInterest[] | null
  recommendations: AgentRecommendation[]
  replyDrafts: ReplyDraft[]
  /** Names of specialists saved with create_harness. */
  created: string[]
  /** Names of projects created with create_project. */
  createdProjects: string[]
}

export function contextResults(messages: PanelMessage[]): ContextRunResults {
  let interests: AgentInterest[] | null = null
  const recommendations: AgentRecommendation[] = []
  const replyDrafts: ReplyDraft[] = []
  const created: string[] = []
  const createdProjects: string[] = []
  for (const part of finishedTools(messages)) {
    if (part.name === 'update_interest_graph') interests = interestsFromOutput(part.output) ?? interests
    else if (part.name === 'recommend_agent' || part.name === 'recommend_app' || part.name === 'recommend_project') {
      const recommendation = recommendationFromOutput(part.output)
      if (recommendation) recommendations.push(recommendation)
    } else if (part.name === 'draft_reply') {
      const draft = replyDraftFromOutput(part.output)
      if (draft) replyDrafts.push(draft)
    } else if (part.name === 'create_harness') {
      const name = record(firstJson(part.output))["name"] // create_harness returns its listing as JSON text
      if (typeof name === 'string') created.push(name)
    } else if (part.name === 'create_project') {
      const name = record(firstJson(part.output))["name"]
      if (typeof name === 'string') createdProjects.push(name)
    }
  }
  return { interests, recommendations, replyDrafts, created, createdProjects }
}

function firstJson(output: unknown): unknown {
  if (!Array.isArray(output)) return undefined
  for (const block of output) {
    const entry = record(block)
    if ('json' in entry) return entry["json"]
    if (typeof entry["text"] === 'string') {
      try { return JSON.parse(entry["text"]) } catch { /* plain text */ }
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
  const instructions = typeof agent.config?.["instructions"] === 'string' ? agent.config["instructions"] : ''
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
  if (!match || match[1] === undefined || match[3] === undefined) throw new Error('Not a data URL')
  const [, type, base64, payload] = match
  const bytes = base64 ? Uint8Array.from(atob(payload), (char) => char.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(payload))
  return new Blob([bytes], { type })
}
