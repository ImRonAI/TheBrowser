import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSession } from '@/api/supabase'
import { API_BASE_URL, LIVE_API_BASE_URL } from '@/pages/types/api'
import { useProjectsStore } from '@/stores/projectsStore'
import { createProjectsRequest } from '@/lib/projects-api'
import { projectEndpoint } from '@/lib/project-endpoint'
import { projectInputClass } from './ProjectFieldInput'
import { TeachSkill } from '@/components/agent-panel/TeachSkill'
import { VoiceAgent } from '@/components/agent-panel/VoiceAgent'
import { ModeSelector } from '@/components/agent-panel/AgentPanel'
import { liveKey, liveTurnsFor, useLiveSessionStore } from '@/stores/liveSessionStore'
import { AssistField } from '@/components/shared/TextAssist'

interface IssueRun {
  id: string
  message: string
  output: string
  status: 'running' | 'completed' | 'failed' | 'canceled' | 'interrupted'
  error: string | null
  created_at: string
  activity?: { id: string; name: string; status: string; input?: unknown; result?: unknown }[]
}
interface Conversation {
  owner_id: string
  agent: { id: string; provider: string; model_id: string } | null
  runs: IssueRun[]
  available: boolean
}

interface PaneProps {
  issueId: string
  /** Saved issue fields shared with Live as read-only context. */
  issue?: { title?: string; description?: string }
  hasUnsavedChanges: boolean
  draft: string
  onDraftChange: (value: string) => void
  needsReview: boolean
  onReviewChange: (value: boolean) => void
}

export function IssueRonPane(props: PaneProps) {
  const { userId } = useProjectsStore()
  // Account/task changes unmount pending requests and private conversation state.
  return userId ? <ConversationPane key={`${userId}:${props.issueId}`} userId={userId} {...props} />
    : <p className="p-6 text-sm">Opening your workspace…</p>
}

function ConversationPane({ userId, issueId, issue, hasUnsavedChanges, draft, onDraftChange, needsReview, onReviewChange }: PaneProps & { userId: string }) {
  const request = useMemo(() => createProjectsRequest(projectEndpoint(userId, API_BASE_URL), getSession, userId), [userId])
  const path = `/issues/${issueId}/agent`
  const [mode, setMode] = useState<'text' | 'voice'>('text')
  const [modeNotice, setModeNotice] = useState('')
  const liveHandOff = useRef<(() => Promise<boolean>) | null>(null)
  const registerHandOff = useCallback((handOff: (() => Promise<boolean>) | null) => { liveHandOff.current = handOff }, [])
  const liveTurns = useLiveSessionStore((s) => liveTurnsFor(s, liveKey(userId, `issue:${issueId}`, issueId)))
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [older, setOlder] = useState<IssueRun[]>([])
  const [hasMore, setHasMore] = useState(false)
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const { refreshFromServer } = useProjectsStore()
  const running = conversation?.runs.some((run) => run.status === 'running') ?? false

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let current = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const data = await request<Conversation>(path)
        if (!current) return
        setConversation(data)
        setReadError(null)
        if (!older.length) setHasMore(data.runs.length === 50)
        timer = setTimeout(() => void load(), data.runs.some((run) => run.status === 'running') ? 1000 : 5000)
      } catch (cause) {
        if (current) setReadError(cause instanceof Error ? cause.message : 'Conversation could not be loaded.')
      }
    }
    void load()
    return () => { current = false; clearTimeout(timer) }
  }, [request, path, revision, older.length])

  const send = async () => {
    if (inFlight.current || running || !draft.trim() || hasUnsavedChanges || needsReview) return
    inFlight.current = true; setBusy(true); setError(null)
    // Persist uncertainty in the workspace before sending: this pane may unmount
    // before the response arrives, while the server still accepts the request.
    onReviewChange(true)
    try {
      const data = await request<{ owner_id: string; agent: NonNullable<Conversation['agent']>; run: IssueRun }>(`${path}/messages`, 'POST', { message: draft })
      if (!mounted.current) return
      onDraftChange('')
      onReviewChange(false)
      setConversation((current) => ({ owner_id: data.owner_id, agent: data.agent, available: true, runs: [data.run, ...(current?.runs ?? [])] }))
      setOlder([])
      setRevision((value) => value + 1)
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : 'Run was not confirmed. Refresh before retrying.')
        onReviewChange(true)
      }
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const cancel = async () => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true)
    try {
      await request(`${path}/cancel`, 'POST')
      if (mounted.current) setRevision((value) => value + 1)
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Cancellation failed.')
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const loadOlder = async () => {
    if (inFlight.current || !conversation) return
    inFlight.current = true; setBusy(true)
    try {
      const data = await request<Conversation>(`${path}?offset=${conversation.runs.length + older.length}`)
      if (mounted.current) { setOlder((current) => [...current, ...data.runs]); setHasMore(data.runs.length === 50) }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'History could not be loaded.')
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const runs = [...new Map([...(conversation?.runs ?? []), ...older].map((run) => [run.id, run])).values()].reverse()
  const switchMode = async (next: 'text' | 'voice') => {
    if (next === mode) return
    setModeNotice('')
    if (next === 'text' && liveHandOff.current) {
      const done = await liveHandOff.current()
      if (!done) { setModeNotice('Live is still working. Wait for pending tools or press Stop in Live before switching.'); return }
    }
    if (next === 'voice' && running) { setModeNotice('A task run is in progress. Stop it or wait before switching to Live.'); return }
    setMode(next)
  }
  const review = async () => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true)
    try {
      const data = await request<Conversation>(path)
      if (mounted.current) {
        setConversation(data); setOlder([]); onReviewChange(false); setError(null); setReadError(null)
        setRevision((value) => value + 1)
      }
    } catch (cause) {
      if (mounted.current) setReadError(cause instanceof Error ? cause.message : 'Refresh failed.')
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return <section className="flex h-full min-h-0 flex-col text-ink dark:text-ink-inverse" aria-label="Task Ron conversation">
    <header className="border-b border-surface-200 dark:border-surface-800 p-4 space-y-2">
      <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Ron · Task assistant</h3>
        <div className="flex items-center gap-2">
          <ModeSelector value={mode} onChange={(next) => void switchMode(next)} />
          <button type="button" disabled={busy} onClick={() => void review()} className="text-sm text-indigo-500">Refresh conversation</button>
        </div></div>
      {modeNotice && <p role="status" className="text-xs text-amber-600">{modeNotice}</p>}
      {mode === 'voice' && <p className="text-xs text-ink-muted">Live uses this issue’s agent scope and the same tool limits as the saved conversation; relevant saved turns are shared with Gemini as context. Live turns are not written to the saved issue conversation.</p>}
      <p className="text-xs text-ink-muted">Saved with this issue and shared with description Ask Ron. Can edit content, create children, link related issues and save attachments. Use /goal followed by acceptance criteria for judge-reviewed execution. Cannot change issue status or browse your computer.</p>
      {conversation?.agent && <p className="text-xs text-ink-muted">{conversation.agent.provider} · {conversation.agent.model_id}</p>}
      <button type="button" className="text-xs text-indigo-500" onClick={() => void refreshFromServer().then((result) => {
        if (mounted.current && result.error) setError(result.error)
      })}>Reload issue changes (keeps your draft)</button>
    </header>
    {conversation?.owner_id && <TeachSkill userId={conversation.owner_id} agentId={`issue:${issueId}`} apiBaseUrl={projectEndpoint(userId, LIVE_API_BASE_URL)} />}
    {mode === 'voice' ? <div className="flex min-h-0 flex-1">
      {conversation?.owner_id
        ? <VoiceAgent userId={userId} agentScope={`issue:${issueId}`} sessionId={issueId} owner="issue-pane"
            issue={{ id: issueId, title: issue?.title, description: issue?.description }} registerHandOff={registerHandOff} />
        : <p className="p-6 text-sm text-ink-muted">Load the saved conversation before starting Live.</p>}
    </div> : <>
    <div className="flex-1 overflow-y-auto p-4 space-y-5" role="log" aria-label="Saved task conversation">
      {!conversation && !readError && <p className="text-sm text-ink-muted">Loading saved conversation…</p>}
      {hasMore && <button type="button" disabled={busy} onClick={() => void loadOlder()} className="text-sm text-indigo-500">Load older messages</button>}
      {conversation && !runs.length && <p className="text-sm text-ink-muted">Ask Ron to work on this issue. The conversation and agent memory persist when you close this window.</p>}
      {runs.map((run) => <article key={run.id} className="space-y-3">
        <div className="rounded-xl bg-surface-100 dark:bg-surface-800 p-3"><p className="text-xs font-semibold mb-1">You</p><p className="text-sm whitespace-pre-wrap break-words">{run.message}</p></div>
        <div className="p-3"><div className="flex items-center justify-between text-xs text-ink-muted mb-2"><span>Ron · {run.status}</span><time>{new Date(run.created_at).toLocaleString()}</time></div>
          <p className="text-sm whitespace-pre-wrap break-words">{run.output || (run.status === 'running' ? 'Working on this issue…' : 'No response was saved.')}</p>
          {run.activity?.map((item, index) => <details key={`${item.id}:${index}`} className="mt-2 rounded-lg border border-surface-200 dark:border-surface-800 p-2 text-xs">
            <summary className="cursor-pointer">{item.name} · {item.status}</summary>
            {(item.input !== undefined || item.result !== undefined) && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(item.input ?? item.result, null, 2)}</pre>}
          </details>)}
          {run.error && <p className="mt-2 text-sm text-rose-500">{run.error}</p>}
        </div>
      </article>)}
      {liveTurns.length > 0 && <section aria-label="Live turns (read-only)" className="rounded-xl border border-indigo-200/60 bg-indigo-50/30 p-3 text-xs dark:border-indigo-900 dark:bg-indigo-950/10">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Live · {liveTurns.length} turn{liveTurns.length === 1 ? '' : 's'} · not saved with this issue</p>
        <ul className="space-y-2">{liveTurns.map((turn) => <li key={turn.id} className="flex gap-2"><span className="shrink-0 font-semibold">{turn.role === 'user' ? 'You' : 'Ron'}</span><span className="min-w-0 whitespace-pre-wrap break-words">{turn.text}</span></li>)}</ul>
      </section>}
    </div>
    <form className="border-t border-surface-200 dark:border-surface-800 p-4 space-y-2" onSubmit={(event) => { event.preventDefault(); void send() }}>
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
      {readError && <p role="alert" className="text-sm text-rose-500">{readError}</p>}
      {needsReview && <p className="text-xs text-amber-600">Refresh and review saved messages before retrying; your previous request may have started.</p>}
      {hasUnsavedChanges && <p className="text-xs text-amber-600">Save your issue draft before starting Ron. Ron only sees saved data.</p>}
      {conversation && !conversation.available && <p className="text-xs text-amber-600">Configure an agent provider on the backend to enable execution.</p>}
      <label className="sr-only" htmlFor={`task-ron-${issueId}`}>Message task Ron</label>
      <AssistField value={draft} onChange={onDraftChange} suggest count={5} placement="above">
        {(field) => <textarea id={`task-ron-${issueId}`} disabled={busy} rows={3} maxLength={20000} value={draft} onChange={(event) => onDraftChange(event.target.value)} className={projectInputClass} placeholder="What should Ron do for this issue?" {...field} />}
      </AssistField>
      <div className="flex justify-between items-center gap-3"><p className="text-xs text-ink-muted">Closing the pane does not stop a running task.</p>
        {running ? <button type="button" disabled={busy} onClick={() => void cancel()} className="text-sm text-rose-500">Stop run</button>
          : <button type="submit" disabled={busy || !conversation?.available || !draft.trim() || hasUnsavedChanges || needsReview || !!readError} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? 'Starting…' : 'Send to Ron'}</button>}
      </div>
    </form>
    </>}
  </section>
}
