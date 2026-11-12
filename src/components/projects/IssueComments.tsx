import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, Check, Loader2, MessageSquare, Pencil, RefreshCw, Square, Trash2, X } from 'lucide-react'
import { RenIcon, RenMark } from '@/components/brand'
import { ResponseMarkdown } from '@/components/ai-elements/response'
import { AssistField } from '@/components/shared/TextAssist'
import { Button } from '@/components/ui/button'
import {
  COMMENT_MAX, canDeleteComment, canEditComment, commentAuthor, commentEdited, commentLength, commentProblem,
  commentTime, commentTimestamp, commentViewer, type CommentViewer, type IssueComment,
} from '@/lib/issue-comments'
import { initials } from '@/lib/project-members'
import { useProjectsStore } from '@/stores/projectsStore'
import { cn } from '@/lib/utils'
import { useRenReply, type IssueCommentsState } from './useIssueComments'

const BUTTON = 'h-8 gap-1.5 rounded-lg px-3 text-[13px] font-semibold shadow-none transition-colors duration-150 ease-out disabled:opacity-40'
const PRIMARY = `${BUTTON} bg-blurple-600 text-white hover:bg-blurple-700 active:bg-blurple-800 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300`
const SECONDARY = `${BUTTON} border border-surface-200 bg-surface-0 text-ink hover:bg-surface-50 hover:text-ink dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:hover:bg-surface-850 dark:hover:text-ink-inverse`
const QUIET = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-ink-muted transition-colors duration-150 hover:bg-surface-100 hover:text-ink disabled:opacity-40 dark:text-ink-inverse-muted dark:hover:bg-surface-850 dark:hover:text-ink-inverse'
const MUTED = 'text-ink-muted dark:text-ink-inverse-muted'
const NEAR_LIMIT = Math.floor(COMMENT_MAX * 0.9)

/** Wall-clock tick so relative timestamps ("just now" → "1m ago") advance while the tab stays open. */
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/**
 * The issue workspace's **Comments** tab: team discussion (project owners, invited members, and guests in their
 * own workspace) alongside comments posted by issue and project agents. "Comment & ask Ren" posts the person's
 * comment and runs this issue's agent to reply in the thread (`useRenReply`).
 */
export function IssueComments({ issueId, projectOwnerId, thread, onAgentSettled }: {
  issueId: string
  projectOwnerId: string | null | undefined
  thread: IssueCommentsState
  /** Called after a "Comment & ask Ren" run finishes, so the workspace refreshes if Ren edited the issue. */
  onAgentSettled?: () => void
}) {
  const { userId } = useProjectsStore()
  const viewer = useMemo(() => commentViewer(userId, projectOwnerId), [userId, projectOwnerId])
  const now = useMinuteClock()
  const listEndRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const composerHintId = useId()

  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState<'comment' | 'ask' | null>(null)
  const [postError, setPostError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    setDraft('')
    setPostError(null)
    setPosting(null)
  }, [issueId])

  const onReplySettled = useCallback(() => {
    void thread.refresh()
    onAgentSettled?.()
  }, [thread, onAgentSettled])
  const renReply = useRenReply(issueId, onReplySettled)

  const reload = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await thread.refresh()
    } finally {
      setRefreshing(false)
    }
  }

  const length = commentLength(draft)
  const problem = draft.trim() ? commentProblem(draft) : null
  const canSubmit = posting === null && length > 0 && length <= COMMENT_MAX

  const submit = async (askRen: boolean) => {
    if (posting !== null) return
    const check = commentProblem(draft)
    if (check) {
      setPostError(check)
      composerRef.current?.focus()
      return
    }
    if (askRen && renReply.replying) return
    setPosting(askRen ? 'ask' : 'comment')
    setPostError(null)
    try {
      const created = await thread.add(draft)
      setDraft('')
      requestAnimationFrame(() => listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }))
      if (askRen) void renReply.ask(created.id)
    } catch (cause) {
      setPostError(cause instanceof Error ? cause.message : 'The comment was not posted.')
    } finally {
      setPosting(null)
    }
  }

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault()
    void submit(false)
  }

  const count = thread.comments.length

  return (
    <section aria-label="Issue comments" className="flex h-full min-h-0 flex-col text-ink dark:text-ink-inverse">
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6 pt-7">
        <div className="mx-auto max-w-3xl space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h3 className="font-display text-lg font-bold leading-tight tracking-tight text-ink dark:text-ink-inverse">Comments</h3>
              {thread.status === 'ready' && (
                <span className={cn('text-[12px]', MUTED)}>
                  <span className="font-mono tabular-nums">{count}</span> {count === 1 ? 'comment' : 'comments'} · Shared with everyone on this project
                </span>
              )}
            </div>
            <Button type="button" variant="outline" size="sm" disabled={refreshing || thread.status === 'loading'}
              className={SECONDARY} onClick={() => void reload()}>
              <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />Refresh
            </Button>
          </div>

          {thread.status === 'loading' && (
            <p role="status" className={cn('flex items-center gap-2 py-8 text-[13px]', MUTED)}>
              <Loader2 className="size-4 animate-spin" />Loading comments…
            </p>
          )}

          {thread.status === 'error' && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              <span className="flex min-w-0 items-center gap-2">
                <AlertTriangle className="size-4 shrink-0" />
                <span>{thread.error ?? 'The comments could not be loaded.'}</span>
              </span>
              <Button type="button" variant="outline" size="sm" className={SECONDARY} onClick={() => void reload()}>Try again</Button>
            </div>
          )}

          {thread.status === 'ready' && thread.error && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              <span>Latest refresh failed: {thread.error}</span>
              <button type="button" onClick={() => void reload()} className="font-medium underline-offset-2 hover:underline">Try again</button>
            </div>
          )}

          {thread.status === 'ready' && count === 0 && !renReply.replying && (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-surface-300 px-6 py-12 text-center dark:border-surface-700">
              <span className="flex size-11 items-center justify-center rounded-xl bg-surface-100 text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary">
                <MessageSquare className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <p className="mt-4 font-display text-base font-bold leading-tight tracking-tight text-ink dark:text-ink-inverse">No comments yet</p>
              <p className={cn('mt-1.5 max-w-md text-[13px] leading-relaxed', MUTED)}>
                Discuss decisions and blockers with your team, or choose <span className="font-medium text-ink-secondary dark:text-ink-inverse-secondary">Comment &amp; ask Ren</span> to have the issue agent weigh in.
              </p>
            </div>
          )}

          {count > 0 && (
            <ol aria-label="Comments" className="space-y-3">
              {thread.comments.map((comment) => (
                <CommentItem key={comment.id} comment={comment} viewer={viewer} now={now}
                  onEdit={(body) => thread.edit(comment, body)} onDelete={() => thread.remove(comment)} />
              ))}
            </ol>
          )}

          {renReply.replying && (
            <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-blurple-600/25 bg-blurple-50/60 px-4 py-3 text-[13px] dark:border-blurple-400/25 dark:bg-blurple-950/30">
              <span className="flex min-w-0 items-center gap-2.5 text-ink dark:text-ink-inverse">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-blurple-600/10 text-blurple-700 dark:bg-blurple-400/15 dark:text-blurple-300">
                  <RenMark className="size-3.5" />
                </span>
                <Loader2 className="size-3.5 shrink-0 animate-spin text-volt" />
                <span className="truncate">{renReply.replying.stopping ? 'Stopping Ren’s reply…' : 'Ren is reading the issue and writing a reply…'}</span>
              </span>
              {renReply.replying.runId && (
                <Button type="button" variant="outline" size="sm" disabled={renReply.replying.stopping}
                  className={cn(SECONDARY, 'h-7 px-2.5 text-[12px]')} onClick={() => void renReply.stop()}>
                  <Square className="size-3" />Stop
                </Button>
              )}
            </div>
          )}

          {renReply.notice && (
            <div role={renReply.notice.tone === 'error' ? 'alert' : 'status'}
              className={cn('space-y-2 rounded-xl border px-4 py-3 text-[12.5px]',
                renReply.notice.tone === 'error'
                  ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
                  : 'border-surface-200 bg-surface-50 text-ink-secondary dark:border-surface-800 dark:bg-surface-850 dark:text-ink-inverse-secondary')}>
              <div className="flex items-start justify-between gap-3">
                <p className="leading-snug">{renReply.notice.text}</p>
                <button type="button" aria-label="Dismiss notice" onClick={renReply.dismiss}
                  className="shrink-0 rounded-md p-0.5 text-current opacity-70 transition-opacity hover:opacity-100">
                  <X className="size-3.5" />
                </button>
              </div>
              {renReply.notice.output && (
                <div className="max-h-60 overflow-y-auto rounded-lg border border-surface-200 bg-surface-0 px-3 py-2 text-ink dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse">
                  <ResponseMarkdown content={renReply.notice.output} />
                </div>
              )}
            </div>
          )}

          <div ref={listEndRef} />
        </div>
      </div>

      <form onSubmit={onFormSubmit} className="shrink-0 border-t border-surface-200 bg-surface-0/80 px-8 py-4 dark:border-surface-800 dark:bg-surface-900/80">
        <div className="mx-auto max-w-3xl space-y-2.5">
          <div className="rounded-xl border border-surface-200 bg-surface-0 transition-colors duration-150 focus-within:border-blurple-600 focus-within:ring-2 focus-within:ring-blurple-600/20 dark:border-surface-800 dark:bg-surface-900 dark:focus-within:border-blurple-400 dark:focus-within:ring-blurple-400/25">
            <AssistField value={draft} onChange={(value) => { setDraft(value); if (postError) setPostError(null) }}>
              {(field) => (
                <textarea ref={composerRef} aria-label="Write a comment" aria-describedby={composerHintId}
                  rows={3} value={draft} disabled={posting !== null}
                  placeholder="Write a comment in Markdown…"
                  onChange={(event) => { setDraft(event.target.value); if (postError) setPostError(null) }}
                  onFocus={field.onFocus} onBlur={field.onBlur}
                  onKeyDown={(event) => {
                    field.onKeyDown(event)
                    if (event.defaultPrevented) return
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault()
                      void submit(event.shiftKey && !renReply.replying)
                    }
                  }}
                  className="block max-h-56 min-h-[76px] w-full resize-y bg-transparent px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink placeholder:text-ink-muted [field-sizing:content] focus:outline-none focus-visible:ring-0 disabled:opacity-60 dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted" />
              )}
            </AssistField>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-surface-200/80 px-3 py-2 dark:border-surface-800/80">
              <span id={composerHintId} className={cn('text-[11.5px]', length > COMMENT_MAX ? 'font-medium text-red-700 dark:text-red-400' : MUTED)}>
                {length >= NEAR_LIMIT
                  ? `${length.toLocaleString('en-US')} / ${COMMENT_MAX.toLocaleString('en-US')} characters`
                  : 'Markdown supported · ⌘↵ to comment · ⇧⌘↵ to comment & ask Ren'}
              </span>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm"
                  disabled={!canSubmit || renReply.replying !== null}
                  title="Post this comment and ask this issue’s agent to reply in the comments"
                  className={SECONDARY} onClick={() => void submit(true)}>
                  {posting === 'ask' ? <Loader2 className="size-3.5 animate-spin" /> : <RenIcon className="size-3.5" />}
                  Comment &amp; ask Ren
                </Button>
                <Button type="submit" size="sm" disabled={!canSubmit} className={PRIMARY}>
                  {posting === 'comment' && <Loader2 className="size-3.5 animate-spin" />}Comment
                </Button>
              </div>
            </div>
          </div>
          {(postError || problem) && (
            <p role="alert" className="flex items-center gap-1.5 text-[12px] text-red-700 dark:text-red-400">
              <AlertTriangle className="size-3.5 shrink-0" />{postError ?? problem}
            </p>
          )}
        </div>
      </form>
    </section>
  )
}

function CommentItem({ comment, viewer, now, onEdit, onDelete }: {
  comment: IssueComment
  viewer: CommentViewer
  now: number
  onEdit: (body: string) => Promise<IssueComment>
  onDelete: () => Promise<void>
}) {
  const author = commentAuthor(comment)
  const editable = canEditComment(comment, viewer)
  const deletable = canDeleteComment(comment, viewer)
  const editedTitle = commentEdited(comment)

  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState(comment.body)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [itemError, setItemError] = useState<string | null>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) editRef.current?.focus()
  }, [editing])

  const startEdit = () => {
    setConfirmDelete(false)
    setItemError(null)
    setEditDraft(comment.body)
    setEditing(true)
  }
  const cancelEdit = () => {
    if (saving) return
    setEditing(false)
    setItemError(null)
  }
  const saveEdit = async () => {
    if (saving) return
    const check = commentProblem(editDraft)
    if (check) {
      setItemError(check)
      editRef.current?.focus()
      return
    }
    if (editDraft.trim() === comment.body.trim()) {
      setEditing(false)
      setItemError(null)
      return
    }
    setSaving(true)
    setItemError(null)
    try {
      await onEdit(editDraft)
      setEditing(false)
    } catch (cause) {
      setItemError(cause instanceof Error ? cause.message : 'Your edit was not saved.')
    } finally {
      setSaving(false)
    }
  }

  const runDelete = async () => {
    if (deleting) return
    setDeleting(true)
    setItemError(null)
    try {
      await onDelete()
    } catch (cause) {
      setDeleting(false)
      setConfirmDelete(false)
      setItemError(cause instanceof Error ? cause.message : 'The comment was not deleted.')
    }
  }

  return (
    <li className="rounded-xl border border-surface-200 bg-surface-0 px-4 py-3.5 dark:border-surface-800 dark:bg-surface-900"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && confirmDelete && !deleting) {
          event.preventDefault()
          setConfirmDelete(false)
        }
      }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {comment.authorKind === 'agent' ? (
            <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-blurple-600/10 text-blurple-700 dark:bg-blurple-400/15 dark:text-blurple-300">
              <RenMark className="size-4" />
            </span>
          ) : (
            <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-200 text-[11px] font-semibold text-ink-secondary dark:bg-surface-700 dark:text-ink-inverse-secondary">
              {initials(author.name)}
            </span>
          )}
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
            <span className="truncate font-semibold text-ink dark:text-ink-inverse">{author.name}</span>
            {comment.authorKind === 'agent' && (
              <span className="inline-flex items-center rounded-full bg-blurple-600/10 px-2 py-0.5 text-[10.5px] font-medium leading-none text-blurple-700 dark:bg-blurple-400/15 dark:text-blurple-300">
                Agent
              </span>
            )}
            {author.forName && (
              <span className={cn('truncate text-[12px]', MUTED)}>for {author.forName}</span>
            )}
            <span aria-hidden className="text-ink-ghost dark:text-surface-600">·</span>
            <time dateTime={Number.isFinite(comment.createdAt) ? new Date(comment.createdAt).toISOString() : undefined}
              title={commentTimestamp(comment.createdAt)}
              className={cn('shrink-0 font-mono text-[11.5px] tabular-nums', MUTED)}>
              {commentTime(comment.createdAt, { now })}
            </time>
            {editedTitle && (
              <span title={editedTitle} className={cn('text-[11.5px]', MUTED)}>(edited)</span>
            )}
          </div>
        </div>

        {!editing && (editable || deletable) && (
          confirmDelete ? (
            <div className="flex items-center gap-1.5 text-[12px]">
              <span className="font-medium text-red-700 dark:text-red-400">Delete comment?</span>
              <button type="button" disabled={deleting} onClick={() => setConfirmDelete(false)} className={QUIET}>Cancel</button>
              <Button type="button" size="sm" variant="destructive" disabled={deleting}
                className="h-7 rounded-md px-2.5 text-[12px]" onClick={() => void runDelete()}>
                {deleting && <Loader2 className="size-3 animate-spin" />}Delete
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-0.5">
              {editable && (
                <button type="button" aria-label={`Edit comment by ${author.name}`} onClick={startEdit} className={QUIET}>
                  <Pencil className="size-3" />Edit
                </button>
              )}
              {deletable && (
                <button type="button" aria-label={`Delete comment by ${author.name}`} onClick={() => { setItemError(null); setConfirmDelete(true) }}
                  className={cn(QUIET, 'hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-400')}>
                  <Trash2 className="size-3" />Delete
                </button>
              )}
            </div>
          )
        )}
      </div>

      {editing ? (
        <div className="mt-3 space-y-2">
          <AssistField value={editDraft} onChange={(value) => { setEditDraft(value); if (itemError) setItemError(null) }}>
            {(field) => (
              <textarea ref={editRef} aria-label="Edit comment" rows={3} value={editDraft} disabled={saving}
                onChange={(event) => { setEditDraft(event.target.value); if (itemError) setItemError(null) }}
                onFocus={field.onFocus} onBlur={field.onBlur}
                onKeyDown={(event) => {
                  field.onKeyDown(event)
                  if (event.defaultPrevented) return
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelEdit()
                  } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    void saveEdit()
                  }
                }}
                className="block max-h-56 min-h-[72px] w-full resize-y rounded-lg border border-surface-200 bg-surface-0 px-3 py-2 text-[13.5px] leading-relaxed text-ink [field-sizing:content] focus:border-blurple-600 focus:outline-none focus:ring-2 focus:ring-blurple-600/20 disabled:opacity-60 dark:border-surface-700 dark:bg-surface-900 dark:text-ink-inverse dark:focus:border-blurple-400 dark:focus:ring-blurple-400/25" />
            )}
          </AssistField>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cn('text-[11.5px]', commentLength(editDraft) > COMMENT_MAX ? 'font-medium text-red-700 dark:text-red-400' : MUTED)}>
              {commentLength(editDraft) >= NEAR_LIMIT
                ? `${commentLength(editDraft).toLocaleString('en-US')} / ${COMMENT_MAX.toLocaleString('en-US')} characters`
                : '⌘↵ to save · Esc to cancel'}
            </span>
            <div className="flex items-center gap-1.5">
              <Button type="button" variant="outline" size="sm" disabled={saving} className={cn(SECONDARY, 'h-7 px-2.5 text-[12px]')} onClick={cancelEdit}>
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={saving || commentLength(editDraft) === 0 || commentLength(editDraft) > COMMENT_MAX}
                className={cn(PRIMARY, 'h-7 px-2.5 text-[12px]')} onClick={() => void saveEdit()}>
                {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}Save
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 pl-9 text-[13.5px] leading-relaxed text-ink dark:text-ink-inverse">
          <ResponseMarkdown content={comment.body} />
        </div>
      )}

      {itemError && (
        <p role="alert" className="mt-2 flex items-center gap-1.5 pl-9 text-[12px] text-red-700 dark:text-red-400">
          <AlertTriangle className="size-3.5 shrink-0" />{itemError}
        </p>
      )}
    </li>
  )
}
