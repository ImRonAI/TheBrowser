import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import {
  emptyPanelState, hydratePanelSession, isTerminalEvent, readPanelStream, reconcilePanelSession, reducePanelEvent, resolveBrowserSelection, responseError, shouldFollowPanel,
  PanelReplayOverflow, type BrowserSelection, type PanelEvent, type PanelState, type RuntimeOptions,
} from '@/lib/panel-stream'
import type { ContextItem } from './ContextPicker'
import { ARTICLE_PREFIX, type AgentDestination, type ArticleAttachment } from '@/lib/articles'

const API = 'http://localhost:8765'
type Connection = 'loading' | 'connected' | 'reconnecting' | 'detached'
const newSessionId = () => `agent-${crypto.randomUUID()}`
const storageKey = (userId: string, destination: AgentDestination) => `ron-${destination}-session:${userId}`
const waitForFollow = (signal: AbortSignal, delay: number) => new Promise<void>((resolve) => {
  const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
  const timer = setTimeout(finish, delay)
  signal.addEventListener('abort', finish, { once: true })
  if (signal.aborted) finish()
})
function savedSession(userId: string, destination: AgentDestination): string {
  try { return localStorage.getItem(storageKey(userId, destination)) || newSessionId() } catch { return newSessionId() }
}
/** `GET /sessions/{id}` snapshot → `selection.browser`, or null when absent/invalid. */
function snapshotBrowser(snapshot: unknown): BrowserSelection | null {
  const selection = snapshot && typeof snapshot === 'object' ? (snapshot as { selection?: unknown }).selection : undefined
  return resolveBrowserSelection(selection && typeof selection === 'object' ? (selection as { browser?: unknown }).browser : undefined)
}

interface Selection {
  destination?: AgentDestination
  attachments?: ArticleAttachment[]
  model: string
  provider: string
  effort: string
  contexts: ContextItem[]
  options: RuntimeOptions
  onSent: () => void
}

export function usePanelChat(selection: Selection) {
  const destination = selection.destination ?? 'panel'
  const userId = useAuthStore((store) => store.user?.id || 'default')
  const [sessionId, setSessionId] = useState(() => savedSession(userId, destination))
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
  const owner = useRef(userId)
  const commit = useCallback((next: PanelState) => {
    current.current = next
    setState(next)
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
    if (owner.current !== userId) {
      owner.current = userId
      setSessionId(savedSession(userId, destination))
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
    try { localStorage.setItem(storageKey(userId, destination), sessionId) } catch { /* Storage can be unavailable. */ }
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
  }, [sessionId, userId, destination, commit, replay, sessionUrl, syncBrowser, restoreVersion])

  const newChat = useCallback(() => {
    ++generation.current
    controller.current?.abort() // Detach only. The server owns the old run's lifecycle.
    ready.current = false
    setConnection('loading')
    setTransportError(undefined)
    const id = newSessionId()
    commit(emptyPanelState(id))
    setSessionId(id)
  }, [commit])

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
      const sent = action === 'message' && Boolean(text.trim()) && !selection.attachments?.length
        ? await sendControl('steer', text.trim()) : false
      if (sent) onAccepted?.()
      return sent
    }
    if (posting.current || (action === 'message' && !text.trim())) return false
    if (action === 'message' && ['interrupted', 'checkpointed'].includes(current.current.status)) return false
    posting.current = true
    const token = generation.current
    const id = current.current.sessionId
    const previous = current.current
    const configuration = previous.configuration ?? {
      model: selection.model, provider: selection.provider, effort: selection.effort, options: { ...selection.options },
    }
    const abort = new AbortController()
    controller.current?.abort()
    controller.current = abort
    setTransportError(undefined)
    setConnection('connected')
    commit({ ...previous, status: 'running', configuration, configurationLocked: true, error: undefined, stopReason: undefined,
      messages: action === 'message' ? [...previous.messages, {
        id: `user-${crypto.randomUUID()}`, role: 'user', parts: [{ kind: 'text', key: crypto.randomUUID(), path: [], text: text.trim() },
          ...(selection.attachments ?? []).map((article) => ({ kind: 'text' as const, key: article.id, path: [], text: ARTICLE_PREFIX + JSON.stringify(article) }))],
      }] : previous.messages })
    let accepted = false
    let observed = false
    let rejected = false
    try {
      let browserContext: unknown = {}
      try { browserContext = await window.electron?.browser?.getPanelContext?.() } catch { /* Context is optional. */ }
      if (token !== generation.current || abort.signal.aborted) return false
      const response = await fetch(`${API}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({
          session_id: id, user_id: userId, message: action === 'message' ? text.trim() : '', action,
          destination, attachments: action === 'message' ? selection.attachments ?? [] : [],
          ...(!previous.configurationLocked ? { model: configuration.model, provider: configuration.provider,
            reasoning_effort: configuration.effort || null, options: configuration.options, browser } : {}),
          browser_context: { ...(browserContext as Record<string, unknown> ?? {}), selected_contexts: selection.contexts },
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
      selection.onSent()
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
  }, [browser, browserHydrated, commit, refreshCanonical, replay, selection, sendControl, userId, destination])

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

  // `configurationLocked` flips optimistically on the first accepted POST and on
  // every hydrated snapshot; `runId` alone lags until run_started arrives.
  const browserLocked = Boolean(state.configurationLocked)
  return { ...state, connection, transportError, controlBusy, browser, setBrowser, browserLocked, browserHydrated, newChat, sendMessage,
    stop: () => sendControl('cancel'), reconnect }
}
