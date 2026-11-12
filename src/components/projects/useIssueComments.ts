import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { projectsRequestFor, useProjectsStore } from '@/stores/projectsStore'
import type { ProjectsRequest } from '@/lib/projects-api'
import { issueRunStatus, type IssueAgentRun } from '@/lib/ron-draft'
import {
  addComment, commentErrorMessage, deleteComment, editComment, errorStatus, listComments, renReplyMessage, replyNotice, replyOutcome,
  sameComments, withComment, withoutComment, type IssueComment, type ReplyOutcome,
} from '@/lib/issue-comments'

/** Comments written elsewhere (teammates, agents) appear within this long while the issue is open. */
const REFRESH_MS = 30_000
/** How often a reply run is checked; each check reads the issue agent's recent runs. */
const REPLY_POLL_MS = 1500

const OPENING = 'Your workspace is still opening. Try again in a moment.'
const need = (request: ProjectsRequest | null) => {
  if (!request) throw new Error(OPENING)
  return request
}

export interface IssueCommentsState {
  /** Oldest first. */
  comments: IssueComment[]
  /** The first load: `loading` until it answers, then `ready`, or `error` when it failed (retry with `refresh`). */
  status: 'loading' | 'ready' | 'error'
  /** Why the last load failed; the thread keeps the last list that loaded. */
  error: string | null
  refresh: () => Promise<void>
  /** Posts a comment and answers it; throws an error whose message can be shown as is. */
  add: (body: string) => Promise<IssueComment>
  /** Saves your edit from `comment.version`. A 409 reloads the thread and throws a message saying what changed. */
  edit: (comment: IssueComment, body: string) => Promise<IssueComment>
  /** Deletes the comment; one already deleted elsewhere counts as deleted. */
  remove: (comment: IssueComment) => Promise<void>
}

/**
 * One issue's comments (`/projects/issues/{id}/comments`): every page on open, again every 30 seconds while
 * mounted and whenever the window regains focus, plus add, edit and delete. Requests can't be aborted, so a
 * late answer is dropped instead: one for another issue or account, or one overtaken by a newer load or by a
 * write whose result is already shown.
 */
export function useIssueComments(issueId: string): IssueCommentsState {
  const { userId } = useProjectsStore()
  const request = useMemo(() => (userId ? projectsRequestFor(userId) : null), [userId])
  const [comments, setComments] = useState<IssueComment[]>([])
  const [status, setStatus] = useState<IssueCommentsState['status']>('loading')
  const [error, setError] = useState<string | null>(null)
  /** Bumped for another issue or account, and on unmount. */
  const scope = useRef(0)
  /** Bumped by every load and every write: only the newest may change the thread. */
  const latest = useRef(0)
  const loading = useRef(false)
  const loaded = useRef(false)

  const load = useCallback(async (): Promise<IssueComment[]> => {
    const api = need(request)
    const ticket = ++latest.current
    const at = scope.current
    const current = () => at === scope.current && ticket === latest.current
    loading.current = true
    try {
      const next = await listComments(api, issueId)
      if (current()) {
        loaded.current = true
        // A refresh that changed nothing keeps the list, so nothing that shows it renders again.
        setComments((shown) => (sameComments(shown, next) ? shown : next))
        setError(null)
        setStatus('ready')
      }
      return next
    } catch (cause) {
      if (current()) {
        setError(commentErrorMessage(cause, 'The comments could not be loaded.'))
        setStatus(loaded.current ? 'ready' : 'error')
      }
      throw cause
    } finally {
      if (current()) loading.current = false
    }
  }, [request, issueId])
  const refresh = useCallback(() => load().then(() => undefined, () => undefined), [load])

  useEffect(() => {
    scope.current++
    loading.current = false
    loaded.current = false
    setComments([]); setStatus('loading'); setError(null)
    if (request) void refresh()
    return () => { scope.current++ }
  }, [request, refresh])

  useEffect(() => {
    const auto = () => { if (!loading.current && document.visibilityState !== 'hidden') void refresh() }
    const visible = () => { if (document.visibilityState === 'visible') auto() }
    const timer = window.setInterval(auto, REFRESH_MS)
    window.addEventListener('focus', auto)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', auto)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [refresh])

  /** A write's answer is the newest state: a load already on its way started before it, so its answer is dropped. */
  const settle = useCallback((at: number, change: (list: IssueComment[]) => IssueComment[]) => {
    if (at !== scope.current) return
    latest.current++
    loading.current = false
    setComments(change)
    // Until the thread has loaded once, the rest of it is still unknown.
    if (!loaded.current) void refresh()
  }, [refresh])

  const add = useCallback(async (body: string) => {
    const api = need(request)
    const at = scope.current
    try {
      const comment = await addComment(api, issueId, body)
      settle(at, (list) => withComment(list, comment))
      return comment
    } catch (cause) {
      throw new Error(commentErrorMessage(cause, 'The comment was not posted.'))
    }
  }, [request, issueId, settle])

  const edit = useCallback(async (comment: IssueComment, body: string) => {
    const api = need(request)
    const at = scope.current
    try {
      const updated = await editComment(api, comment, body)
      settle(at, (list) => withComment(list, updated))
      return updated
    } catch (cause) {
      if (errorStatus(cause) !== 409 || at !== scope.current) throw new Error(commentErrorMessage(cause, 'Your edit was not saved.'))
      // It changed since it was read (in another window) or it is gone: show the thread as it is now.
      const now = await load().catch(() => null)
      if (!now) throw new Error('This comment changed since you started editing, and the comments could not be reloaded. Refresh them, then save again.')
      throw new Error(now.some((item) => item.id === comment.id)
        ? 'This comment changed since you started editing. The latest version is loaded; save again to replace it with your text.'
        : 'This comment was deleted, so your edit was not saved.')
    }
  }, [request, issueId, settle, load])

  const remove = useCallback(async (comment: IssueComment) => {
    const api = need(request)
    const at = scope.current
    try {
      await deleteComment(api, comment.id)
    } catch (cause) {
      const failure = new Error(commentErrorMessage(cause, 'The comment was not deleted.'))
      if (errorStatus(cause) !== 404 || at !== scope.current) throw failure
      // Already deleted elsewhere is what was asked for; still there means it isn't yours to delete.
      const now = await load().catch(() => null)
      if (now && !now.some((item) => item.id === comment.id)) return
      throw failure
    }
    settle(at, (list) => withoutComment(list, comment.id))
  }, [request, settle, load])

  return { comments, status, error, refresh, add, edit, remove }
}

export interface RenReplyState {
  /** Ren is replying, from the request until its run ends; `runId` is null until the run has started. */
  replying: { runId: string | null; stopping: boolean } | null
  /** Why the last reply did not end in a comment; dismissible. */
  notice: { tone: 'error' | 'info'; text: string; output: string } | null
  /** Asks the issue's agent to reply in the comments to the comment just posted. */
  ask: (commentId: string) => Promise<void>
  stop: () => Promise<void>
  dismiss: () => void
}

/**
 * "Comment & ask Ren": a run of this issue's own agent (`/projects/issues/{id}/agent`, the conversation the
 * description's Ask Ren uses) asked to reply with `add_comment`. The run is followed until it ends; then
 * `onSettled` gets its outcome (null when it could no longer be followed), so the thread reloads.
 */
export function useRenReply(issueId: string, onSettled: (outcome: ReplyOutcome | null) => void): RenReplyState {
  const { userId } = useProjectsStore()
  const request = useMemo(() => (userId ? projectsRequestFor(userId) : null), [userId])
  const [replying, setReplying] = useState<RenReplyState['replying']>(null)
  const [notice, setNotice] = useState<RenReplyState['notice']>(null)
  const settled = useRef(onSettled)
  settled.current = onSettled
  /** The run being followed: bumped for another issue or account, and on unmount, so a late poll changes nothing. */
  const follow = useRef(0)
  const busy = useRef(false)
  useEffect(() => {
    setReplying(null); setNotice(null)
    return () => { follow.current++; busy.current = false }
  }, [issueId, request])

  const ask = useCallback(async (commentId: string) => {
    if (busy.current) return
    if (!request) { setNotice({ tone: 'error', text: OPENING, output: '' }); return }
    busy.current = true
    const ticket = ++follow.current
    const live = () => ticket === follow.current
    const path = `/issues/${encodeURIComponent(issueId)}/agent`
    setNotice(null)
    setReplying({ runId: null, stopping: false })
    try {
      let runId: string
      try {
        ({ run: { id: runId } } = await request<{ run: { id: string } }>(`${path}/messages`, 'POST', { message: renReplyMessage(commentId) }))
      } catch (cause) {
        if (live()) setNotice({ tone: 'error', text: `Your comment was posted, but Ren couldn’t start: ${commentErrorMessage(cause, 'the issue agent did not answer.')}`, output: '' })
        return
      }
      if (!live()) return
      setReplying((current) => current && { ...current, runId })
      for (let failures = 0; ;) {
        await new Promise((resolve) => setTimeout(resolve, REPLY_POLL_MS))
        if (!live()) return
        let runs: IssueAgentRun[]
        try {
          ({ runs } = await request<{ runs: IssueAgentRun[] }>(path))
          failures = 0
        } catch (cause) {
          // A dropped check is retried; three in a row and the run can't be followed from here.
          if (++failures < 3) continue
          if (live()) {
            setNotice({ tone: 'error', text: `Lost track of Ren’s reply: ${commentErrorMessage(cause, 'the issue agent did not answer.')} Its reply shows here once it posts one.`, output: '' })
            settled.current(null)
          }
          return
        }
        if (!live()) return
        const run = runs.find((item) => item.id === runId)
        if (!run) {
          setNotice({ tone: 'error', text: 'Ren’s reply is no longer among this issue’s recent agent runs.', output: '' })
          settled.current(null)
          return
        }
        if (issueRunStatus(run.status) === 'running') continue
        const outcome = replyOutcome(run)
        setNotice(replyNotice(outcome))
        settled.current(outcome)
        return
      }
    } finally {
      if (live()) { busy.current = false; setReplying(null) }
    }
  }, [request, issueId])

  const runId = replying?.runId ?? null
  const stopping = replying?.stopping ?? false
  const stop = useCallback(async () => {
    if (!request || !runId || stopping) return
    setReplying((current) => current && { ...current, stopping: true })
    try {
      await request(`/issues/${encodeURIComponent(issueId)}/agent/cancel`, 'POST')
    } catch (cause) {
      // 409: no live run, it has just ended; the next check says how.
      if (errorStatus(cause) === 409) return
      setReplying((current) => current && { ...current, stopping: false })
      setNotice({ tone: 'error', text: `Stop wasn’t confirmed: ${commentErrorMessage(cause, 'try again.')}`, output: '' })
    }
  }, [request, issueId, runId, stopping])

  const dismiss = useCallback(() => setNotice(null), [])
  return { replying, notice, ask, stop, dismiss }
}
