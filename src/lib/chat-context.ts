/**
 * Agent chat context: what the composer's context menu (the link button and `@` mentions) can attach to a
 * message — open tabs, previous chats, projects, issues, interests, dates that matter, project pages and
 * saved context items — and the text each one contributes when the message is sent.
 *
 * Each picked item is a prompt attachment (`src/lib/prompt-attachments.ts`): its text is read when the message is
 * sent (`src/lib/context-attachments.ts`) and travels as `prompt_attachments` on `POST /chat`, one text content
 * block of the user message, so the thread keeps it. Pure (relative imports only) so
 * `node --experimental-strip-types --test src/lib/chat-context.test.ts` runs it.
 */
import { addDays, startOfDay } from './calendar.ts'
import { stripMarkup } from './discover-feed.ts'
import { issueKey, isOverdue } from './execute-issues.ts'
import { relativeTime, type Thread, type ThreadSummary } from './threads-api.ts'
import {
  ISSUE_PRIORITY_CONFIG, ISSUE_STATUS_CONFIG, ISSUE_TYPE_CONFIG,
  type Issue, type IssueStatus, type Project,
} from '../types/projects.ts'

export type ContextType =
  | 'tab' | 'conversation' | 'project' | 'issue' | 'interest' | 'event' | 'document' | 'file'
  /** Older surfaces still name an issue a task. */
  | 'task'

/** The record behind a context item, resolved again when the message is sent so the agent sees it as it is now. */
export interface ContextRef {
  sessionId?: string | undefined
  issueId?: string | undefined
  projectId?: string | undefined
  interestId?: string | undefined
  documentId?: string | undefined
  contextItemId?: string | undefined
  contextAskId?: string | undefined
  contextVisitUrl?: string | undefined
  contextRunId?: string | undefined
  contextRecommendationId?: string | undefined
  /** ISO time of an event. */
  at?: string | undefined
  /** For events: which date of the issue (`due`, `start`, `end`) or `today`. */
  dateKind?: 'due' | 'start' | 'end' | 'today' | undefined
}

export interface ContextItem {
  id: string
  type: ContextType
  name: string
  description?: string | undefined
  meta?: string | undefined
  color?: string | undefined
  favicon?: string | undefined
  url?: string | undefined
  title?: string | undefined
  ref?: ContextRef | undefined
  /** Filled at send time: the text the agent reads for this item. */
  content?: string | undefined
  /** Filled at send time when an open tab was attached (page text, selection, metadata). */
  tab_context?: unknown
}

export type CategoryId = 'context' | 'tabs' | 'conversations' | 'issues' | 'projects' | 'dates' | 'interests' | 'documents'

export interface ContextCategory {
  id: CategoryId
  name: string
  description: string
  items: ContextItem[]
  /** Why the category is empty or partial (signed out, request failed). */
  note?: string | undefined
  loading?: boolean | undefined
}

const DAY_MS = 24 * 60 * 60 * 1000
const STATUS_DOT: Record<IssueStatus, string> = {
  backlog: 'bg-surface-400', 'in-progress': 'bg-indigo-500', review: 'bg-violet-500', blocked: 'bg-rose-500', done: 'bg-emerald-500',
}
const LIFECYCLE_DOT: Record<Project['lifecycle'], string> = {
  active: 'bg-emerald-500', paused: 'bg-amber-500', completed: 'bg-indigo-500', archived: 'bg-surface-400',
}

const statusLabel = (status: IssueStatus) => ISSUE_STATUS_CONFIG[status]?.label ?? status
const time = (value?: string) => {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** "Fri, Nov 7, 2026, 3:00 PM" in the user's locale; date only when the time is midnight. */
export function formatWhen(iso: string, locale?: string): string {
  const date = new Date(iso)
  const midnight = date.getHours() === 0 && date.getMinutes() === 0
  return date.toLocaleString(locale, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', ...(midnight ? {} : { hour: 'numeric', minute: '2-digit' }),
  })
}

/** "Today", "Tomorrow", "in 3 days", "Yesterday", "4 days ago", by calendar day. */
export function dayDistance(iso: string, now: number): string {
  const days = Math.round((startOfDay(new Date(iso)).getTime() - startOfDay(new Date(now)).getTime()) / DAY_MS)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  return days > 0 ? `in ${days} days` : `${-days} days ago`
}

// ── Item builders ────────────────────────────────────────────────────────────

export function tabItem(tab: { id: string; url: string; title: string; favicon?: string | undefined; isActive: boolean }): ContextItem {
  return {
    id: tab.id, type: 'tab', name: tab.title || tab.url || 'New Tab', description: tab.url,
    meta: tab.isActive ? 'Active' : undefined, favicon: tab.favicon, url: tab.url, title: tab.title,
  }
}

export function threadItem(thread: ThreadSummary, now = Date.now()): ContextItem {
  const agent = thread.last_agent === 'live' ? 'Live' : 'Chat'
  return {
    id: `conversation:${thread.session_id}`, type: 'conversation', name: thread.title || 'Untitled chat',
    description: `${thread.message_count} message${thread.message_count === 1 ? '' : 's'} · ${agent}${thread.browser === 'cloud' ? ' · Cloud browser' : ''}`,
    meta: relativeTime(thread.updated_at, now), ref: { sessionId: thread.session_id },
  }
}

export function projectItem(project: Project, issues: Issue[]): ContextItem {
  const own = issues.filter((issue) => issue.projectId === project.id)
  const open = own.filter((issue) => issue.status !== 'done').length
  return {
    id: `project:${project.id}`, type: 'project', name: project.name,
    description: `${project.key} · ${open} open of ${own.length} issue${own.length === 1 ? '' : 's'}`,
    meta: project.lifecycle === 'active' ? undefined : project.lifecycle.charAt(0).toUpperCase() + project.lifecycle.slice(1),
    color: LIFECYCLE_DOT[project.lifecycle], ref: { projectId: project.id },
  }
}

export function issueItem(issue: Issue, projects: Project[] | Map<string, Project>, now = Date.now()): ContextItem {
  const byId = projects instanceof Map ? projects : new Map(projects.map((project) => [project.id, project]))
  const project = byId.get(issue.projectId)
  const overdue = isOverdue(issue, now)
  return {
    id: `issue:${issue.id}`, type: 'issue', name: `${issueKey(issue, byId)} ${issue.title}`,
    description: `${statusLabel(issue.status)}${project ? ` · ${project.name}` : ''}${issue.dueDate ? ` · due ${dayDistance(issue.dueDate, now).toLowerCase()}` : ''}`,
    meta: overdue ? 'Overdue' : ISSUE_PRIORITY_CONFIG[issue.priority]?.label,
    color: STATUS_DOT[issue.status], ref: { issueId: issue.id, projectId: issue.projectId },
  }
}

export function interestItem(node: { id: string; label: string; weight: number; category: string; source: string; reason?: string | undefined }): ContextItem {
  return {
    id: `interest:${node.id}`, type: 'interest', name: node.label,
    description: node.reason || `${node.category} · from ${node.source === 'onboarding' ? 'your interview' : 'your browsing'}`,
    meta: `${Math.round(node.weight * 100)}%`, ref: { interestId: node.id },
  }
}

export function documentItem(doc: { id: string; title: string; projectId: string | null; updatedAt: number }, projects: Project[], now = Date.now()): ContextItem {
  const project = projects.find((candidate) => candidate.id === doc.projectId)
  return {
    id: `document:${doc.id}`, type: 'document', name: doc.title || 'Untitled',
    description: project ? `Page in ${project.name}` : doc.projectId ? 'Project page' : 'Page in My documents',
    meta: relativeTime(new Date(doc.updatedAt).toISOString(), now), ref: { documentId: doc.id, projectId: doc.projectId ?? undefined },
  }
}

export interface SavedContextRow {
  id: string
  kind: string
  title: string
  added: string
  source: string
  preview?: string
}

export interface ContextAskSource {
  id: string
  question: string
  answer: string
  error?: string
}

export interface ContextVisitSource {
  url: string
  title: string
  at: number
}

export interface ContextRunSource {
  id: string
  agent_name: string
  status: string
  summary: string
  error: string
  started_at: string
  finished_at: string | null
  session_id?: string
}

export interface ContextRecommendationSource {
  id: string
  name: string
  description: string
  interest: string
  rationale: string
  tools?: string[]
  skills?: string[]
}

export function savedContextItem(item: SavedContextRow, now = Date.now()): ContextItem {
  const previewText = item.preview ? item.preview.replace(/\s+/g, ' ').trim() : ''
  const detail = item.source && item.source !== item.title
    ? item.source
    : previewText
      ? (previewText.length > 90 ? `${previewText.slice(0, 89)}…` : previewText)
      : ''
  return {
    id: `file:${item.id}`,
    type: 'file',
    name: item.title || item.source || item.kind,
    description: `Saved ${item.kind}${detail ? ` · ${detail}` : ''}`,
    meta: relativeTime(item.added, now),
    ref: { contextItemId: item.id },
  }
}

/** Merge `GET /context/items` rows with in-store Context Agent widget `items`, deduplicating by `id` newest first. */
export function mergeSavedContextRows<T extends SavedContextRow>(
  remoteRows: readonly T[],
  widgetRows: readonly T[],
): T[] {
  const byId = new Map<string, T>()
  for (const row of widgetRows) {
    if (row.id) byId.set(row.id, row)
  }
  for (const row of remoteRows) {
    if (row.id) byId.set(row.id, row)
  }
  return Array.from(byId.values()).sort((a, b) => (Date.parse(b.added) || 0) - (Date.parse(a.added) || 0))
}

export function contextAskContent(turn: ContextAskSource): string {
  const answer = turn.answer.trim() || (turn.error ? `Error: ${turn.error}` : '(Pending answer from Context Agent)')
  return `Context Agent Q&A:\nQuestion: ${turn.question.trim()}\n\nAnswer:\n${answer}`
}

export function contextAskItem(turn: ContextAskSource): ContextItem {
  const question = turn.question.trim() || 'Context Agent question'
  const answerOneLine = turn.answer.replace(/\s+/g, ' ').trim()
  const snippet = answerOneLine
    ? (answerOneLine.length > 90 ? `${answerOneLine.slice(0, 89)}…` : answerOneLine)
    : turn.error
      ? turn.error
      : 'Thinking…'
  return {
    id: `context-ask:${turn.id}`,
    type: 'file',
    name: question,
    description: `Context Ask · ${snippet}`,
    meta: 'Ask',
    color: 'bg-blurple-500',
    ref: { contextAskId: turn.id },
    content: contextAskContent(turn),
  }
}

export function contextVisitContent(visit: ContextVisitSource): string {
  const iso = new Date(visit.at).toISOString()
  return [
    `Recent page observed in Context:`,
    `Title: ${visit.title.trim() || '(untitled)'}`,
    `URL: ${visit.url}`,
    `Visited: ${formatWhen(iso)}`,
  ].join('\n')
}

export function contextVisitItem(visit: ContextVisitSource, now = Date.now()): ContextItem {
  const iso = new Date(visit.at).toISOString()
  return {
    id: `context-visit:${visit.url}`,
    type: 'file',
    name: visit.title.trim() || visit.url,
    description: `Recent browsing · ${visit.url}`,
    meta: relativeTime(iso, now),
    color: 'bg-sky-500',
    url: visit.url,
    ref: { contextVisitUrl: visit.url, at: iso },
    content: contextVisitContent(visit),
  }
}

export function contextRunContent(run: ContextRunSource): string {
  const when = formatWhen(run.finished_at ?? run.started_at)
  const body = run.summary.trim() || (run.error.trim() ? `Error: ${run.error.trim()}` : '(No summary recorded yet.)')
  return `Specialist agent run "${run.agent_name || 'Context Specialist'}" (${run.status}, ${when}):\n\n${body}`
}

export function contextRunItem(run: ContextRunSource, now = Date.now()): ContextItem {
  const oneLine = (run.summary || run.error).replace(/\s+/g, ' ').trim()
  const excerpt = oneLine.length > 90 ? `${oneLine.slice(0, 89)}…` : oneLine
  return {
    id: `context-run:${run.id}`,
    type: 'file',
    name: `${run.agent_name || 'Specialist'} · ${run.status}`,
    description: `Agent run${excerpt ? ` · ${excerpt}` : ''}`,
    meta: relativeTime(run.finished_at ?? run.started_at, now),
    color: run.status === 'failed' ? 'bg-rose-500' : 'bg-emerald-500',
    ref: { contextRunId: run.id, ...(run.session_id ? { sessionId: run.session_id } : {}) },
    content: contextRunContent(run),
  }
}

export function contextRecommendationContent(rec: ContextRecommendationSource): string {
  return [
    `Recommended Context specialist: ${rec.name}`,
    rec.interest ? `Interest: ${rec.interest}` : '',
    rec.description ? `Description: ${rec.description}` : '',
    rec.rationale ? `Rationale: ${rec.rationale}` : '',
    rec.tools?.length ? `Tools: ${rec.tools.join(', ')}` : '',
    rec.skills?.length ? `Skills: ${rec.skills.join(', ')}` : '',
  ].filter(Boolean).join('\n')
}

export function contextRecommendationItem(rec: ContextRecommendationSource): ContextItem {
  return {
    id: `context-rec:${rec.id}`,
    type: 'file',
    name: `Recommended · ${rec.name}`,
    description: [rec.interest, rec.description].filter(Boolean).join(' · '),
    meta: 'Agent',
    color: 'bg-blurple-500',
    ref: { contextRecommendationId: rec.id },
    content: contextRecommendationContent(rec),
  }
}

/**
 * Build the complete list of selectable items for the `Context` parent category (`id: 'context'`),
 * surfacing everything currently in the Context Agent widget (`GET /context/items` merged with
 * `useContextAgentStore` `items`, `asks`, `visits`, `runs`, and `recommendations`).
 */
export function widgetContextItems(
  sources: {
    savedItems?: readonly SavedContextRow[]
    storeItems?: readonly SavedContextRow[]
    asks?: readonly ContextAskSource[]
    visits?: readonly ContextVisitSource[]
    runs?: readonly ContextRunSource[]
    recommendations?: readonly ContextRecommendationSource[]
  },
  now = Date.now(),
): ContextItem[] {
  const mergedSaved = mergeSavedContextRows(sources.savedItems ?? [], sources.storeItems ?? [])
  const askItems = [...(sources.asks ?? [])].reverse().map(contextAskItem)
  const visitByUrl = new Map<string, ContextVisitSource>()
  for (const visit of sources.visits ?? []) {
    if (visit.url) visitByUrl.set(visit.url, visit)
  }
  const visitItems = Array.from(visitByUrl.values())
    .sort((a, b) => b.at - a.at)
    .map((visit) => contextVisitItem(visit, now))
  const runItems = [...(sources.runs ?? [])]
    .sort((a, b) => (b.finished_at ?? b.started_at).localeCompare(a.finished_at ?? a.started_at))
    .map((run) => contextRunItem(run, now))
  const recItems = (sources.recommendations ?? []).map(contextRecommendationItem)

  return [
    ...mergedSaved.map((row) => savedContextItem(row, now)),
    ...askItems,
    ...visitItems,
    ...runItems,
    ...recItems,
  ]
}

/** Today's date, so "this week" or "tomorrow" in a message resolves the way the user means it. */
export function todayItem(now = Date.now(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): ContextItem {
  const iso = new Date(now).toISOString()
  return {
    id: 'event:today', type: 'event', name: `Today · ${new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`,
    description: timeZone, meta: 'Now', color: 'bg-accent', ref: { at: iso, dateKind: 'today' },
  }
}

const DATE_LABEL = { due: 'Due', start: 'Starts', end: 'Ends' } as const

/**
 * Dates that matter to the user, from their issues: unfinished issues past due (last `pastDays`), then every
 * due, start and end date from today through `horizonDays`, soonest first. Done issues only keep future dates
 * that are not due dates (a finished issue is no longer due).
 */
export function importantDates(issues: Issue[], projects: Project[], now = Date.now(), horizonDays = 60, pastDays = 30): ContextItem[] {
  const byId = new Map(projects.map((project) => [project.id, project]))
  const today = startOfDay(new Date(now)).getTime()
  const horizon = addDays(new Date(today), horizonDays + 1).getTime()
  const floor = today - pastDays * DAY_MS
  const events: { at: number; item: ContextItem }[] = []
  for (const issue of issues) {
    const project = byId.get(issue.projectId)
    if (project?.lifecycle === 'archived') continue
    for (const dateKind of ['due', 'start', 'end'] as const) {
      const value = dateKind === 'due' ? issue.dueDate : dateKind === 'start' ? issue.startDate : issue.endDate
      const at = time(value)
      if (at === null || !value) continue
      const overdue = dateKind === 'due' && isOverdue(issue, now)
      if (dateKind === 'due' && issue.status === 'done') continue
      if (!(overdue ? at >= floor : at >= today && at < horizon)) continue
      const key = issueKey(issue, byId)
      events.push({
        at,
        item: {
          id: `event:${issue.id}:${dateKind}`, type: 'event', name: `${DATE_LABEL[dateKind]} · ${issue.title}`,
          description: `${formatWhen(value)} · ${key}${project ? ` · ${project.name}` : ''}`,
          meta: overdue ? 'Overdue' : dayDistance(value, now),
          color: overdue ? 'bg-rose-500' : at < today + DAY_MS ? 'bg-amber-500' : 'bg-sky-500',
          ref: { issueId: issue.id, projectId: issue.projectId, at: new Date(at).toISOString(), dateKind },
        },
      })
    }
  }
  const isPast = (entry: { item: ContextItem }) => entry.item.meta === 'Overdue'
  events.sort((a, b) => Number(isPast(b)) - Number(isPast(a)) || a.at - b.at)
  return events.map((entry) => entry.item)
}

// ── Search (`@` mentions) ───────────────────────────────────────────────────

function score(item: ContextItem, needle: string): number {
  const name = item.name.toLowerCase()
  if (!needle) return 1
  if (name.startsWith(needle)) return 100
  if (name.split(/[\s\-_/·.]+/).some((word) => word.startsWith(needle))) return 60
  if (name.includes(needle)) return 40
  if ((item.description ?? '').toLowerCase().includes(needle) || (item.url ?? '').toLowerCase().includes(needle)) return 15
  return 0
}

/** Best matches for `query` across every category, keeping each item's category. Ties keep category order. */
export function searchContexts(categories: ContextCategory[], query: string, limit = 8): { category: ContextCategory; item: ContextItem }[] {
  const needle = query.trim().toLowerCase()
  const matches: { category: ContextCategory; item: ContextItem; score: number; order: number }[] = []
  let order = 0
  for (const category of categories) {
    for (const item of category.items) {
      const value = score(item, needle)
      if (value > 0) matches.push({ category, item, score: value, order: order++ })
    }
  }
  matches.sort((a, b) => b.score - a.score || a.order - b.order)
  return matches.slice(0, limit).map(({ category, item }) => ({ category, item }))
}

/**
 * The `@query` being typed at the caret (an `@` at the start or after whitespace), or null. The query may hold
 * spaces so multi-word titles can be matched ("@launch sprint"); the composer closes it once a spaced query stops
 * matching, so ordinary text after an `@` is never captured.
 */
export function mentionAt(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret)
  const match = /(^|\s)@([^\s@][^@\n]{0,59}|)$/.exec(before)
  if (!match || match[2] === undefined) return null
  return { query: match[2], start: before.length - match[2].length - 1 }
}

/** The text with the `@query` at [start, caret) removed, and where the caret goes. */
export function removeMention(text: string, start: number, caret: number): { text: string; caret: number } {
  const after = text.slice(caret)
  const head = text.slice(0, start)
  const joined = head.endsWith(' ') && after.startsWith(' ') ? head + after.slice(1) : head + after
  return { text: joined, caret: start }
}

// ── What the agent reads ────────────────────────────────────────────────────

/** HTML (issue descriptions, project pages) as readable plain text that keeps paragraphs and list items. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|tr|blockquote|pre|ul|ol)>/gi, '\n')
    .split('\n')
    .map((line) => stripMarkup(line))
    .reduce<string[]>((lines, line) => (line || lines[lines.length - 1] ? [...lines, line] : lines), [])
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export function issueContent(issue: Issue, projects: Project[], issues: Issue[], now = Date.now()): string {
  const byId = new Map(projects.map((project) => [project.id, project]))
  const project = byId.get(issue.projectId)
  const parent = issue.parentId ? issues.find((candidate) => candidate.id === issue.parentId) : undefined
  const children = issues.filter((candidate) => candidate.parentId === issue.id)
  const lines = [
    `Issue ${issueKey(issue, byId)}: ${issue.title}`,
    project ? `Project: ${project.name} (${project.key})` : '',
    `Type: ${ISSUE_TYPE_CONFIG[issue.type]?.label ?? issue.type} · Status: ${statusLabel(issue.status)} · Priority: ${ISSUE_PRIORITY_CONFIG[issue.priority]?.label ?? issue.priority}`,
    issue.startDate ? `Start: ${formatWhen(issue.startDate)}` : '',
    issue.endDate ? `End: ${formatWhen(issue.endDate)}` : '',
    issue.dueDate ? `Due: ${formatWhen(issue.dueDate)} (${isOverdue(issue, now) ? 'overdue' : dayDistance(issue.dueDate, now).toLowerCase()})` : '',
    typeof issue.estimate === 'number' ? `Estimate: ${issue.estimate}` : '',
    issue.labels.length ? `Labels: ${issue.labels.join(', ')}` : '',
    parent ? `Parent: ${issueKey(parent, byId)} ${parent.title}` : '',
    children.length ? `Children: ${children.map((child) => `${issueKey(child, byId)} ${child.title} [${statusLabel(child.status)}]`).join('; ')}` : '',
    `Updated: ${formatWhen(new Date(issue.updatedAt).toISOString())}`,
    issue.description ? `Description:\n${clip(htmlToText(issue.description), 6000)}` : 'Description: (none)',
  ]
  return lines.filter(Boolean).join('\n')
}

export function projectContent(project: Project, issues: Issue[], now = Date.now()): string {
  const own = issues.filter((issue) => issue.projectId === project.id)
  const byStatus = (Object.keys(ISSUE_STATUS_CONFIG) as IssueStatus[])
    .map((status) => `${statusLabel(status)} ${own.filter((issue) => issue.status === status).length}`).join(', ')
  const map = new Map([[project.id, project]])
  const overdue = own.filter((issue) => isOverdue(issue, now))
  const upcoming = own.filter((issue) => issue.status !== 'done' && issue.dueDate && !isOverdue(issue, now))
    .sort((a, b) => (time(a.dueDate) ?? 0) - (time(b.dueDate) ?? 0)).slice(0, 10)
  const active = own.filter((issue) => issue.status === 'in-progress' || issue.status === 'review' || issue.status === 'blocked')
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 15)
  const line = (issue: Issue) => `- ${issueKey(issue, map)} ${issue.title} [${statusLabel(issue.status)}]${issue.dueDate ? ` due ${formatWhen(issue.dueDate)}` : ''}`
  return [
    `Project ${project.name} (${project.key}) · ${project.lifecycle}`,
    project.summary ? `Summary: ${clip(project.summary, 1500)}` : '',
    `Issues: ${own.length} (${byStatus})`,
    overdue.length ? `Overdue:\n${overdue.map(line).join('\n')}` : '',
    active.length ? `In flight:\n${active.map(line).join('\n')}` : '',
    upcoming.length ? `Next due:\n${upcoming.map(line).join('\n')}` : '',
  ].filter(Boolean).join('\n')
}

function blockText(block: Record<string, unknown>): string {
  return typeof block["text"] === 'string' ? block["text"] : ''
}

/** A previous chat as a transcript of what the user asked and what Ron answered, newest kept when long. */
export function threadContent(thread: Thread, maxChars = 8000): string {
  const turns: string[] = []
  for (const message of thread.messages) {
    if (message.kind !== 'user_prompt' && message.kind !== 'assistant_output') continue
    const text = message.content.map(blockText).filter(Boolean).join('\n').trim()
    if (!text) continue
    turns.push(`${message.role === 'user' ? 'User' : 'Ren'}: ${text}`)
  }
  const header = `Previous chat "${thread.title || 'Untitled chat'}" · ${thread.message_count} messages · last active ${formatWhen(thread.updated_at)}`
  const kept: string[] = []
  let size = header.length
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const rawTurn = turns[index]
    if (rawTurn === undefined) continue
    const turn = clip(rawTurn, 2000)
    if (size + turn.length + 2 > maxChars) {
      kept.unshift(`[${index + 1} earlier turn${index ? 's' : ''} omitted]`)
      break
    }
    kept.unshift(turn)
    size += turn.length + 2
  }
  return [header, ...kept].join('\n\n')
}

export function interestContent(node: { label: string; weight: number; category: string; source: string; reason?: string | undefined; lastUpdated?: number | undefined }): string {
  return [
    `Interest: ${node.label} (${node.category}, strength ${Math.round(node.weight * 100)}%, from ${node.source === 'onboarding' ? 'the onboarding interview' : 'browsing'})`,
    node.reason ? `Why: ${node.reason}` : '',
    node.lastUpdated ? `Last updated: ${formatWhen(new Date(node.lastUpdated).toISOString())}` : '',
  ].filter(Boolean).join('\n')
}

export function eventContent(item: ContextItem, issue: Issue | undefined, projects: Project[], issues: Issue[], now = Date.now()): string {
  if (item.ref?.dateKind === 'today' || !issue) {
    const at = item.ref?.at ?? new Date(now).toISOString()
    return `Today is ${formatWhen(at)} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`
  }
  const kind = item.ref?.dateKind ?? 'due'
  return `Date that matters: ${DATE_LABEL[kind as 'due' | 'start' | 'end']} ${formatWhen(item.ref?.at ?? '')} (${item.meta}).\n${issueContent(issue, projects, issues, now)}`
}

/** Plain-text page content for an attached project page, clipped for one model call. */
export function documentContent(title: string, html: string, projectName?: string, maxChars = 12000): string {
  const text = htmlToText(html)
  return `Project page "${title || 'Untitled'}"${projectName ? ` in ${projectName}` : ''}:\n${text ? clip(text, maxChars) : '(This page is empty.)'}`
}

/**
 * Format resolved composer `PromptAttachment`s (picked context items, `@` mentions, and long pastes)
 * into clean Markdown passed as `context` to `POST /deep-research/runs`.
 */
export function formatAttachmentsForResearchContext(
  attachments: readonly { kind: string; title: string; text: string; url?: string | undefined; source?: string | undefined }[],
): string {
  const blocks: string[] = []
  for (const att of attachments) {
    const body = att.text.trim()
    if (!body) continue
    const headerLines = [`### [${att.kind.toUpperCase()}] ${att.title || 'Attached Context'}`]
    if (att.url) headerLines.push(`URL: ${att.url}`)
    if (att.source) headerLines.push(`Source: ${att.source}`)
    blocks.push(`${headerLines.join('\n')}\n\n${body}`)
  }
  return blocks.join('\n\n---\n\n')
}
