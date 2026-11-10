import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import {
  emptyPanelState, hydratePanelSession, isTerminalEvent, readPanelStream, reconcilePanelSession, reducePanelEvent, resolveBrowserSelection, responseError, shouldFollowPanel,
  PanelReplayOverflow, type BrowserSelection, type PanelEvent, type PanelState, type RuntimeOptions,
} from '@/lib/panel-stream'
import { ARTICLE_PREFIX, type AgentDestination, type ArticleAttachment } from '@/lib/articles'
import { attachmentBlock, type PromptAttachment } from '@/lib/prompt-attachments'
import { notePanelTools } from '@/stores/agentPresenceStore'

import { API_BASE_URL } from '@/lib/api-base'
import { agentTarget, RON_AGENT, type AgentChoice } from '@/lib/panel-agents'
import { chatScopeFields, panelSessionKey, sendsProjectCredential, type PanelConnection } from '@/lib/panel-chat'
import { getSession } from '@/api/supabase'
import { guestWorkspace } from '@/lib/project-workspace'
import { useRepairStore } from '@/stores/repairStore'
import { repairDecisionRequest } from '@/lib/repair-api'

const API = API_BASE_URL
type Connection = PanelConnection
const newSessionId = () => `agent-${crypto.randomUUID()}`
const waitForFollow = (signal: AbortSignal, delay: number) => new Promise<void>((resolve) => {
  const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
  const timer = setTimeout(finish, delay)
  signal.addEventListener('abort', finish, { once: true })
  if (signal.aborted) finish()
})
function savedSession(key: string): string {
  try { return localStorage.getItem(key) || newSessionId() } catch { return newSessionId() }
}
/** A project agent and an issue chat act with the user's own project access: the same credential the Projects API uses. */
async function projectAuthHeaders(): Promise<Record<string, string>> {
  const session = await getSession()
  return session ? { Authorization: `Bearer ${session.access_token}` } : { 'X-Ron-Workspace': guestWorkspace().token }
}
/** `GET /sessions/{id}` snapshot → `selection.browser`, or null when absent/invalid. */
function snapshotBrowser(snapshot: unknown): BrowserSelection | null {
  const selection = snapshot && typeof snapshot === 'object' ? (snapshot as { selection?: unknown }).selection : undefined
  return resolveBrowserSelection(selection && typeof selection === 'object' ? (selection as { browser?: unknown }).browser : undefined)
}

interface Selection {
  destination?: AgentDestination
  /** Required for `destination: 'issue'`: the issue whose agent this conversation talks to. */
  issueId?: string
  attachments?: ArticleAttachment[]
  model: string
  provider: string
  effort: string
  /** Who to talk to (sent on a conversation's first turn; the server pins it). Defaults to Ron. */
  agent?: AgentChoice
  /** The composer's pastes and picked context (`useComposerAttachments`), read when a message is sent. */
  promptAttachments?: { count: number; resolve: () => Promise<PromptAttachment[]> }
  options: RuntimeOptions
}

export function usePanelChat(selection: Selection) {
  const destination = selection.destination ?? 'panel'
  const userId = useAuthStore((store) => store.user?.id || 'default')
  const issueId = selection.issueId
  // One remembered conversation per user (and per issue for an issue chat).
  const sessionKey = panelSessionKey(userId, destination, issueId)
  const [sessionId, setSessionId] = useState(() => savedSession(sessionKey))
  const [state, setState] = useState(() => emptyPanelState(sessionId))
  const [connection, setConnection] = useState<Connection>('loading')
  const [transportError, setTransportError] = useState<string>()
  const [controlBusy, setControlBusy] = useState(false)
  const [restoreVersion, setRestoreVersion] = useState(0)
  const [browser, setBrowser] = useState<BrowserSelection>('user')
  // The server pins `browser` per session; a reloaded session must adopt the
  // stored value before the first POST or the immutable-selection check 409s.
  const [browserHydrated, setBrowserHydrated] = useState(false)
  const current = useRef(state)
  const generation = useRef(0)
  const controller = useRef<AbortController | undefined>(undefined)
  const posting = useRef(false)
  const controlPending = useRef(false)
  const ready = useRef(false)
  const owner = useRef(sessionKey)
  const commit = useCallback((next: PanelState) => {
    current.current = next
    setState(next)
    notePanelTools(next.sessionId, next.messages)
  }, [])
  const sessionUrl = useCallback((id: string) => `${API}/sessions/${encodeURIComponent(id)}`, [])
  const syncBrowser = useCallback((snapshot: unknown) => {
    const stored = snapshotBrowser(snapshot)
    if (stored) setBrowser(stored)
    setBrowserHydrated(true)
  }, [])

  const refreshCanonical = useCallback(async (id: string, token: number, signal: AbortSignal) => {
    const response = await fetch(`${sessionUrl(id)}?user_id=${encodeURIComponent(userId)}`, { signal })
    if (!response.ok) throw await responseError(response)
    const snapshot: unknown = await response.json()
    if (signal.aborted || token !== generation.current) return
    const hydrated = hydratePanelSession(id, snapshot)
    syncBrowser(snapshot)
    commit(reconcilePanelSession(current.current, hydrated))
    ready.current = !shouldFollowPanel(hydrated) || (hydrated.status === 'running' && hydrated.sequence === hydrated.latestSequence)
  }, [commit, sessionUrl, syncBrowser, userId])

  const replay = useCallback(async (
    id: string, token: number, signal: AbortSignal,
  ) => {
    let lastError: unknown
    let attempt = 0
    while (attempt < 4) {
      if (signal.aborted || token !== generation.current) return
      try {
        setConnection(attempt || !ready.current ? 'reconnecting' : 'connected')
        const response = await fetch(`${sessionUrl(id)}/events?user_id=${encodeURIComponent(userId)}&after=${current.current.sequence}`, { signal })
        const terminal = await readPanelStream(response, (event: PanelEvent) => {
          if (signal.aborted || token !== generation.current || event.session_id !== id || event.sequence <= current.current.sequence) return false
          commit(reducePanelEvent(current.current, event))
          if (isTerminalEvent(event)) { ready.current = false; setConnection('reconnecting') }
          if (current.current.status === 'running' && event.sequence >= (current.current.latestSequence ?? 0)) {
            ready.current = true
            setConnection('connected')
          }
        })
        if (signal.aborted || token !== generation.current) return
        if (terminal || current.current.status !== 'running') {
          await refreshCanonical(id, token, signal)
          if (signal.aborted || token !== generation.current) return
          if (shouldFollowPanel(current.current)) {
            // Successful follow-up runs do not consume the transport retry budget.
            attempt = 0
            if (current.current.followPending) await waitForFollow(signal, 100)
            continue
          }
          setConnection('connected')
          setTransportError(undefined)
          return
        }
        throw new Error('Event stream ended before run_finished; the run may still be active')
      } catch (error) {
        if (signal.aborted || token !== generation.current) return
        lastError = error
        if (error instanceof PanelReplayOverflow) {
          // A gap snapshot advances to a valid attach cursor and explicitly
          // reports which live history could not be recovered.
          try {
            await refreshCanonical(id, token, signal)
            if (signal.aborted || token !== generation.current) return
            if (!shouldFollowPanel(current.current)) {
              setConnection('connected')
              setTransportError('Replay history expired. Restored committed history; unavailable live progress could not be recovered.')
              return
            }
            attempt++
            continue
          } catch (refreshError) { lastError = refreshError }
          break
        }
        if (attempt < 3) {
          setConnection('reconnecting')
          await waitForFollow(signal, 500 * 2 ** attempt)
        }
        attempt++
      }
    }
    if (signal.aborted || token !== generation.current) return
    setConnection('detached')
    setTransportError(lastError instanceof Error ? lastError.message : 'Unable to reconnect to the run')
  }, [commit, refreshCanonical, sessionUrl, userId])

  useEffect(() => {
    if (owner.current !== sessionKey) {
      owner.current = sessionKey
      setSessionId(savedSession(sessionKey))
      return
    }
    const token = ++generation.current
    const abort = new AbortController()
    controller.current?.abort()
    controller.current = abort
    ready.current = false
    posting.current = false
    controlPending.current = false
    setControlBusy(false)
    if (current.current.sessionId !== sessionId) commit(emptyPanelState(sessionId))
    setConnection('loading')
    setTransportError(undefined)
    try { localStorage.setItem(sessionKey, sessionId) } catch { /* Storage can be unavailable. */ }
    setBrowserHydrated(false)
    void (async () => {
      try {
        const response = await fetch(`${sessionUrl(sessionId)}?user_id=${encodeURIComponent(userId)}`, { signal: abort.signal })
        if (token !== generation.current || abort.signal.aborted) return
        // A brand-new session keeps the locally chosen browser; nothing to adopt.
        if (response.status === 404) { commit(emptyPanelState(sessionId)); ready.current = true; setBrowserHydrated(true); setConnection('connected'); return }
        if (!response.ok) throw await responseError(response)
        const snapshot: unknown = await response.json()
        if (token !== generation.current || abort.signal.aborted) return
        const hydrated = hydratePanelSession(sessionId, snapshot)
        syncBrowser(snapshot)
        commit(reconcilePanelSession(current.current, hydrated))
        if (hydrated.recoveryRequired) {
          ready.current = true
          setConnection('connected')
          return
        }
        ready.current = !shouldFollowPanel(hydrated) || (hydrated.status === 'running' && hydrated.sequence === hydrated.latestSequence)
        if (shouldFollowPanel(hydrated)) {
          await replay(sessionId, token, abort.signal)
        } else setConnection('connected')
      } catch (error) {
        if (token !== generation.current || abort.signal.aborted) return
        // Unreachable backend: never block composing; the retry path re-hydrates.
        setBrowserHydrated(true)
        setConnection('detached')
        setTransportError(error instanceof Error ? error.message : 'Unable to restore session')
      }
    })()
    return () => { ++generation.current; ready.current = false; abort.abort(); controller.current?.abort() }
  }, [sessionId, sessionKey, userId, destination, commit, replay, sessionUrl, syncBrowser, restoreVersion])

  /** Switch this agent to a thread: a brand-new id (`newChat`) or an existing one from the Threads list. */
  const openThread = useCallback((id: string) => {
    ++generation.current
    controller.current?.abort() // Detach only. The server owns the old run's lifecycle.
    ready.current = false
    setConnection('loading')
    setTransportError(undefined)
    commit(emptyPanelState(id))
    setSessionId(id)
  }, [commit])
  const newChat = useCallback(() => openThread(newSessionId()), [openThread])

  const sendControl = useCallback(async (kind: 'steer' | 'cancel', message?: string) => {
    if (controlPending.current) return false
    const token = generation.current
    const id = current.current.sessionId
    controlPending.current = true
    setControlBusy(true)
    setTransportError(undefined)
    try {
      const response = await fetch(`${sessionUrl(id)}/${kind}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, ...(message ? { message } : {}) }),
      })
      if (!response.ok) throw await responseError(response)
      if (token !== generation.current) return false
      if (kind === 'steer' && message) {
        const messages = [...current.current.messages]
        const index = messages.findIndex((item) => item.role === 'assistant' && item.runId === current.current.runId)
        const part = { kind: 'activity' as const, key: crypto.randomUUID(), path: [], text: `You · steering sent · ${message}` }
        if (index >= 0) messages[index] = { ...messages[index], parts: [...messages[index].parts, part] }
        else messages.push({ id: `steer-${crypto.randomUUID()}`, role: 'user', parts: [part] })
        commit({ ...current.current, messages })
        // The acknowledgement's run_id is the accepting run, not necessarily
        // the invocation subsequently reserved by idle/finishing steering.
        ++generation.current
        controller.current?.abort()
        ready.current = false
        posting.current = false
        controlPending.current = false
        setControlBusy(false)
        setConnection('loading')
        setRestoreVersion((version) => version + 1)
      }
      return true
    } catch (error) {
      if (token === generation.current) setTransportError(error instanceof Error ? error.message : `${kind} failed`)
      return false
    } finally {
      if (token === generation.current) { controlPending.current = false; setControlBusy(false) }
    }
  }, [commit, sessionUrl, userId])

  const sendMessage = useCallback(async (
    text: string,
    action: 'message' | 'checkpoint_resume' | 'interrupt_response' = 'message',
    responses?: { interruptId: string; response: unknown }[],
    onAccepted?: () => void,
  ): Promise<boolean> => {
    if (!ready.current || !browserHydrated || current.current.recoveryRequired) return false
    if (current.current.status === 'running') {
      // Steering is text only: attachments wait for the next message.
      const sent = action === 'message' && Boolean(text.trim()) && !selection.attachments?.length && !selection.promptAttachments?.count
        ? await sendControl('steer', text.trim()) : false
      if (sent) onAccepted?.()
      return sent
    }
    if (posting.current || (action === 'message' && !text.trim())) return false
    if (action === 'message' && ['interrupted', 'checkpointed'].includes(current.current.status)) return false
    posting.current = true
    const token = generation.current
    // Attachments are read before the message shows, so it shows exactly what the agent receives.
    let promptAttachments: PromptAttachment[] = []
    if (action === 'message' && selection.promptAttachments?.count) {
      try {
        promptAttachments = await selection.promptAttachments.resolve()
      } catch (error) {
        if (token === generation.current) {
          posting.current = false
          setTransportError(error instanceof Error ? error.message : 'Attachments could not be read')
        }
        return false
      }
      if (token !== generation.current) return false
    }
    const id = current.current.sessionId
    const previous = current.current
    const configuration = previous.configuration ?? {
      model: selection.model, provider: selection.provider, effort: selection.effort, options: { ...selection.options },
      agent: agentTarget(selection.agent ?? RON_AGENT),
    }
    const agent = configuration.agent ?? agentTarget(RON_AGENT)
    const abort = new AbortController()
    controller.current?.abort()
    controller.current = abort
    setTransportError(undefined)
    setConnection('connected')
    commit({ ...previous, status: 'running', configuration, configurationLocked: true, error: undefined, errorDetails: undefined, stopReason: undefined,
      messages: action === 'message' ? [...previous.messages, {
        id: `user-${crypto.randomUUID()}`, role: 'user', parts: [{ kind: 'text', key: crypto.randomUUID(), path: [], text: text.trim() },
          ...(selection.attachments ?? []).map((article) => ({ kind: 'text' as const, key: article.id, path: [], text: ARTICLE_PREFIX + JSON.stringify(article) })),
          ...promptAttachments.map((attachment) => ({ kind: 'text' as const, key: `attachment-${attachment.id}`, path: [], text: attachmentBlock(attachment) }))],
      }] : previous.messages })
    let accepted = false
    let observed = false
    let rejected = false
    try {
      const auth = sendsProjectCredential(destination, agent.kind) ? await projectAuthHeaders() : {}
      if (token !== generation.current || abort.signal.aborted) return false
      const response = await fetch(`${API}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, signal: abort.signal,
        body: JSON.stringify({
          session_id: id, user_id: userId, message: action === 'message' ? text.trim() : '', action,
          destination, attachments: action === 'message' ? selection.attachments ?? [] : [],
          ...(promptAttachments.length ? { prompt_attachments: promptAttachments } : {}),
          ...chatScopeFields(destination, issueId),
          ...(!previous.configurationLocked ? { model: configuration.model, provider: configuration.provider,
            reasoning_effort: configuration.effort || null, options: configuration.options, agent } : {}),
          ...(responses ? { interrupt_responses: responses } : {}),
        }),
      })
      if (!response.ok) {
        rejected = true
        const error = await responseError(response)
        if (token === generation.current) {
          commit(previous)
          if (response.status === 409) setRestoreVersion((version) => version + 1)
        }
        throw error
      }
      accepted = true
      onAccepted?.()
      if (token !== generation.current) return false
      const terminal = await readPanelStream(response, (event) => {
        if (abort.signal.aborted || token !== generation.current || event.session_id !== id || event.sequence <= current.current.sequence) return false
        observed = true
        let next = reducePanelEvent(current.current, event)
        if (!event.node_path.length && action === 'message') {
          next = { ...next, messages: next.messages.map((message, index) => index === previous.messages.length && message.role === 'user'
            ? { ...message, runId: event.run_id } : message) }
        }
        commit(next)
        if (isTerminalEvent(event)) { ready.current = false; setConnection('reconnecting') }
      })
      if (token !== generation.current || abort.signal.aborted) return accepted
      if (!terminal) await replay(id, token, abort.signal)
      else {
        await refreshCanonical(id, token, abort.signal)
        if (token !== generation.current || abort.signal.aborted) return accepted
        if (shouldFollowPanel(current.current)) await replay(id, token, abort.signal)
        else { setConnection('connected'); setTransportError(undefined) }
      }
      return true
    } catch (error) {
      if (token !== generation.current || abort.signal.aborted) return accepted
      setTransportError(error instanceof Error ? error.message : 'Agent request failed')
      // A failed HTTP connection does not imply that the backend run was cancelled.
      if (!rejected || accepted || observed) await replay(id, token, abort.signal)
      return accepted
    } finally {
      if (token === generation.current) posting.current = false
    }
  }, [browser, browserHydrated, commit, refreshCanonical, replay, selection, sendControl, userId, destination, issueId])

  const reconnect = useCallback(() => {
    const token = ++generation.current
    controller.current?.abort()
    posting.current = false
    controlPending.current = false
    setControlBusy(false)
    if (!ready.current || current.current.status !== 'running') { setRestoreVersion((version) => version + 1); return }
    const abort = new AbortController()
    controller.current = abort
    setTransportError(undefined)
    void replay(current.current.sessionId, token, abort.signal)
  }, [replay])

  const followRepair = useCallback(async (id: string, token: number, signal: AbortSignal) => {
    // An investigation runs while the session is idle, so the replay stream returns after each
    // batch; keep re-attaching at the cursor until the terminal `tool_repair_ready` arrives.
    for (let attempt = 0; attempt < 1800 && !signal.aborted && token === generation.current; attempt++) {
      try {
        const response = await fetch(`${sessionUrl(id)}/events?user_id=${encodeURIComponent(userId)}&after=${current.current.sequence}`, { signal })
        let done = false
        await readPanelStream(response, (event: PanelEvent) => {
          if (signal.aborted || token !== generation.current || event.session_id !== id || event.sequence <= current.current.sequence) return false
          commit(reducePanelEvent(current.current, event))
          if (event.node_path.length === 0 && event.type === 'tool_repair_ready') done = true
        })
        if (done || current.current.repair?.state === 'done') return
      } catch (error) {
        if (signal.aborted || token !== generation.current) return
        setTransportError(error instanceof Error ? error.message : 'Repair stream failed')
      }
      await waitForFollow(signal, 1000)
    }
  }, [commit, sessionUrl, userId])

  // A running investigation (started by the server's tool-failure hook) is followed as soon as
  // the run that triggered it has finished.
  useEffect(() => {
    const repair = state.repair
    if (!repair || repair.state === 'done' || state.status === 'running') return
    const abort = new AbortController()
    void followRepair(state.sessionId, generation.current, abort.signal)
    return () => abort.abort()
  }, [followRepair, state.repair?.rev, state.repair?.state, state.status, state.sessionId])

  /**
   * Per-user tool repair (CAT-50/51). Investigations start on their own; the user decides:
   * `approve` activates the verified revision with its approval token (the
   * revision becomes active for this account at the next invocation of each live session),
   * `decline` answers it negatively, `cancel` stops a running investigation, `rollback` swaps the
   * vendored tool back, `dismiss` is local only.
   */
  const repairAction = useCallback(async (kind: 'approve' | 'decline' | 'cancel' | 'rollback' | 'dismiss', tool: string, rev?: string, approvalToken?: string): Promise<boolean> => {
    if (kind === 'dismiss') {
      commit({ ...current.current, repairProposal: undefined, repair: undefined })
      return true
    }
    if (controlPending.current) return false
    const token = generation.current
    controlPending.current = true
    setControlBusy(true)
    setTransportError(undefined)
    try {
      const { url, body } = repairDecisionRequest(API, kind, userId, tool, rev, approvalToken)
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw await responseError(response)
      if (token !== generation.current) return false
      if (kind === 'rollback' || kind === 'decline') commit({ ...current.current, repair: undefined })
      if (kind === 'approve' && current.current.repair) {
        commit({ ...current.current, repair: { ...current.current.repair, state: 'done', status: 'active', applied: true, approvalToken: undefined } })
      }
      return true
    } catch (error) {
      if (token === generation.current) setTransportError(error instanceof Error ? error.message : `${kind} failed`)
      return false
    } finally {
      if (token === generation.current) { controlPending.current = false; setControlBusy(false) }
    }
  }, [commit, userId])

  // Publish the investigation for the native repair surface (works with the panel closed); the
  // surface's decisions come back through the same `repairAction`.
  const publishRepair = useRepairStore((store) => store.publish)
  const clearRepair = useRepairStore((store) => store.clear)
  useEffect(() => {
    publishRepair(state.sessionId, state.repair, (kind, repair) => repairAction(kind, repair.tool, repair.rev, repair.approvalToken))
  }, [publishRepair, repairAction, state.repair, state.sessionId])
  useEffect(() => () => clearRepair(state.sessionId), [clearRepair, state.sessionId])

  // `configurationLocked` flips optimistically on the first accepted POST and on
  // every hydrated snapshot; `runId` alone lags until run_started arrives.
  const browserLocked = Boolean(state.configurationLocked)
  return { ...state, connection, transportError, controlBusy, browser, setBrowser, browserLocked, browserHydrated, newChat, openThread, sendMessage,
    stop: () => sendControl('cancel'), reconnect, repairAction }
}

export type PanelChat = ReturnType<typeof usePanelChat>
