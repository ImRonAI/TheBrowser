/**
 * Issue comments (`public.issue_comments`, migration 021) through the Projects API: where the people on a
 * project, and the agents working for them, discuss an issue. Everyone who can open the project reads and
 * writes them (a guest in their own workspace too). A person edits and deletes their own comments; an agent's
 * comment (an issue agent, the project agent) is its user's row with the agent's name and is never edited, only
 * deleted; the project owner deletes any comment. Edits are version-checked: a stale version answers 409.
 * Pure (relative imports) so node:test can run it.
 */
import { allProjectPages, type ProjectsRequest } from './projects-api.ts'
import { issueRunStatus, type IssueAgentRun } from './ron-draft.ts'
import { isGuestUserId } from './sign-in.ts'

type Row = Record<string, any>

export interface IssueComment {
  id: string
  issueId: string
  projectId: string
  /** Who wrote it, or whose agent did; null once their account is deleted. */
  authorId: string | null
  /** Their display name when they wrote it (a guest is "You"). */
  authorName: string
  authorKind: 'user' | 'agent'
  /** The agent's name on an agent's comment ("Issue agent", "Project agent"), else null. */
  agentName: string | null
  /** Markdown. */
  body: string
  version: number
  createdAt: number
  updatedAt: number
  /** When the body last changed; null when it never did. */
  editedAt: number | null
}

/** The longest body the API stores, after trimming (021_issue_comments.sql, ProjectService.COMMENT_MAX). */
export const COMMENT_MAX = 20000

const time = (value: unknown) => (typeof value === 'string' ? Date.parse(value) : Number.NaN)

export function mapComment(row: Row): IssueComment {
  const agent = row.author_kind === 'agent'
  return {
    id: String(row.id), issueId: String(row.issue_id), projectId: String(row.project_id),
    authorId: row.author_id ?? null, authorName: typeof row.author_name === 'string' ? row.author_name : '',
    authorKind: agent ? 'agent' : 'user', agentName: agent && typeof row.agent_name === 'string' ? row.agent_name : null,
    body: typeof row.body === 'string' ? row.body : '', version: Number(row.version),
    createdAt: time(row.created_at), updatedAt: time(row.updated_at), editedAt: row.edited_at ? time(row.edited_at) : null,
  }
}

/** Oldest first, as the API lists them (created_at, then id), one row per comment (pages can overlap). */
export function orderComments(comments: IssueComment[]): IssueComment[] {
  const unique = new Map(comments.map((comment) => [comment.id, comment]))
  return [...unique.values()].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
/** The thread with `comment` added, or replacing its earlier version. */
export const withComment = (comments: IssueComment[], comment: IssueComment) =>
  orderComments([...comments.filter((item) => item.id !== comment.id), comment])
export const withoutComment = (comments: IssueComment[], id: string) => comments.filter((item) => item.id !== id)
/** Whether two lists hold the same versions of the same comments: a refresh that changed nothing keeps the old list. */
export const sameComments = (a: IssueComment[], b: IssueComment[]) => a.length === b.length && a.every((item, index) =>
  item.id === b[index].id && item.version === b[index].version && item.updatedAt === b[index].updatedAt && item.authorId === b[index].authorId)

/** The length the API checks: characters (code points, not UTF-16 units) of the trimmed body. */
export const commentLength = (body: string) => Array.from(body.trim()).length

/** Why `body` can't be posted, or null. */
export function commentProblem(body: string): string | null {
  const length = commentLength(body)
  if (!length) return 'Write something before posting the comment.'
  if (length > COMMENT_MAX) return `A comment is at most ${COMMENT_MAX.toLocaleString('en-US')} characters.`
  return null
}

const issuePath = (issueId: string) => `/issues/${encodeURIComponent(issueId)}/comments`
const commentPath = (id: string) => `/comments/${encodeURIComponent(id)}`
const invalid = (problem: string) => Object.assign(new Error(problem), { status: 422 })

/** Every comment on the issue, oldest first (all pages). 404 when the issue is not visible. */
export const listComments = async (request: ProjectsRequest, issueId: string) =>
  orderComments((await allProjectPages<Row>(request, issuePath(issueId))).map(mapComment))

/** Posts a person's comment; agents comment through their own tools. */
export async function addComment(request: ProjectsRequest, issueId: string, body: string): Promise<IssueComment> {
  const problem = commentProblem(body)
  if (problem) throw invalid(problem)
  return mapComment(await request<Row>(issuePath(issueId), 'POST', { body: body.trim() }))
}

/** Replaces your own comment's body from the version you read; 409 when it changed since (or is not yours). */
export async function editComment(request: ProjectsRequest, comment: Pick<IssueComment, 'id' | 'version'>, body: string): Promise<IssueComment> {
  const problem = commentProblem(body)
  if (problem) throw invalid(problem)
  return mapComment(await request<Row>(commentPath(comment.id), 'PATCH', { version: comment.version, body: body.trim() }))
}

/** Deletes your own comment (your agents' too), or any comment on a project you own; 404 when it is gone or not yours. */
export async function deleteComment(request: ProjectsRequest, id: string): Promise<void> {
  const result = await request<{ deleted?: boolean }>(commentPath(id), 'DELETE')
  if (result?.deleted !== true) throw new Error('The deletion was not confirmed. Reload the comments before trying again.')
}

/** The HTTP status a Projects API error carries (`createProjectsRequest`), if any. */
export const errorStatus = (error: unknown) => (error as { status?: number } | null)?.status

export function commentErrorMessage(error: unknown, fallback: string): string {
  if (errorStatus(error) === 401) return 'You’re signed out. Sign in again to read and post comments.'
  return (error instanceof Error && error.message) || fallback
}

// ── Display ──────────────────────────────────────────────────────────────────────────────────────────────

/** Who a comment is from: the person, or the agent and the person it works for. */
export function commentAuthor(comment: Pick<IssueComment, 'authorKind' | 'authorName' | 'agentName'>): { name: string; forName: string | null } {
  const person = comment.authorName.trim() || 'Someone'
  return comment.authorKind === 'agent' ? { name: comment.agentName?.trim() || 'Agent', forName: person } : { name: person, forName: null }
}

/** "Tim Hunter", or "Issue agent · for Tim Hunter". */
export function commentAuthorLabel(comment: Pick<IssueComment, 'authorKind' | 'authorName' | 'agentName'>): string {
  const { name, forName } = commentAuthor(comment)
  return forName ? `${name} · for ${forName}` : name
}

/** Times in a fixed locale and zone for tests; the app uses the person's own. */
export interface TimeOptions { now?: number; locale?: string; timeZone?: string }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** When a comment was written, as a thread says it: "just now", "5m ago", "3h ago", "2d ago", then "Nov 3" ("Nov 3, 2025" in another year). */
export function commentTime(at: number, { now = Date.now(), locale, timeZone }: TimeOptions = {}): string {
  if (!Number.isFinite(at)) return ''
  // A server clock slightly ahead of this one is "just now", never in the future.
  const elapsed = Math.max(0, now - at)
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d ago`
  const year = (value: number) => new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone }).format(value)
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone, ...(year(at) === year(now) ? {} : { year: 'numeric' }) }).format(at)
}

/** The full date and time, for a tooltip ("Nov 11, 2026, 3:04 PM"). */
export function commentTimestamp(at: number, { locale, timeZone }: TimeOptions = {}): string {
  return Number.isFinite(at) ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(at) : ''
}

/** The "edited" marker's tooltip ("Edited Nov 11, 2026, 3:04 PM"), or null for a comment never edited. */
export function commentEdited(comment: Pick<IssueComment, 'editedAt'>, options: TimeOptions = {}): string | null {
  return comment.editedAt === null ? null : `Edited ${commentTimestamp(comment.editedAt, options)}`.trim()
}

// ── Who may do what (the API enforces it; the thread offers only what will work) ──────────────────────────

/** The person looking, as comment rows name people, and whether they own the project. */
export interface CommentViewer { authorId: string | null; owner: boolean }

/**
 * A signed-in user is their account id. A guest workspace has one person: their rows carry the workspace's
 * API identity (not the renderer's `guest:` id), which owns every project in it.
 */
export function commentViewer(userId: string | null, projectOwnerId: string | null | undefined): CommentViewer {
  if (!userId) return { authorId: null, owner: false }
  if (isGuestUserId(userId)) return { authorId: projectOwnerId ?? null, owner: true }
  return { authorId: userId, owner: !!projectOwnerId && projectOwnerId === userId }
}

const mine = (comment: Pick<IssueComment, 'authorId'>, viewer: CommentViewer) =>
  viewer.authorId !== null && comment.authorId === viewer.authorId

/** Only your own comments, never an agent's: what an agent said stays as it said it. */
export const canEditComment = (comment: Pick<IssueComment, 'authorId' | 'authorKind'>, viewer: CommentViewer) =>
  comment.authorKind === 'user' && mine(comment, viewer)

/** Your own comments and those your agents wrote, or any comment on a project you own. */
export const canDeleteComment = (comment: Pick<IssueComment, 'authorId'>, viewer: CommentViewer) =>
  viewer.owner || mine(comment, viewer)

// ── "Comment & ask Ren": the issue's agent replies in the comments ───────────────────────────────────────

/**
 * What the issue's agent is sent once the comment is posted. It reads the thread itself (`read_comments`), so
 * the comment is named, not repeated, and the message stays within the agent API's 20,000 characters.
 */
export function renReplyMessage(commentId: string): string {
  return `I just commented on this issue (comment ${commentId}) and want your reply in the comments. `
    + 'Read the issue with read_issue and its comments with read_comments, then post one reply with add_comment, in Markdown, '
    + 'that answers what the newest comments ask. If they ask you to change the issue, make the change with your tools and '
    + 'say in your reply what you changed. The people on this project read the comments, not this conversation, so put '
    + 'your whole answer in the comment.'
}

export interface ReplyOutcome {
  status: 'completed' | 'cancelled' | 'failed'
  /** Ren posted a comment (`add_comment` succeeded). */
  replied: boolean
  error: string | null
  /** What Ren wrote in its own conversation: shown when it posted no comment. */
  output: string
}

/** A finished reply run, read from its recorded tool activity (each call: `running`, then `success` or `error`). */
export function replyOutcome(run: IssueAgentRun): ReplyOutcome {
  const status = issueRunStatus(run.status)
  const ended = status === 'completed' || status === 'cancelled'
  return {
    status: ended ? status : 'failed',
    replied: (run.activity ?? []).some((event) => event.name === 'add_comment' && event.status === 'success'),
    error: ended ? null : run.error?.trim() || 'Ren stopped before it finished.',
    output: run.output?.trim() ?? '',
  }
}

/** What the thread says about a finished reply: nothing when Ren replied, else why it did not. */
export function replyNotice(outcome: ReplyOutcome): { tone: 'error' | 'info'; text: string; output: string } | null {
  if (outcome.status === 'failed') {
    const text = outcome.replied ? `Ren replied, then stopped with an error: ${outcome.error}` : `Ren couldn’t reply: ${outcome.error}`
    return { tone: 'error', text, output: '' }
  }
  if (outcome.replied) return null
  if (outcome.status === 'cancelled') return { tone: 'info', text: 'Stopped before Ren replied.', output: '' }
  return { tone: 'info', text: 'Ren finished without replying in the comments.', output: outcome.output }
}
