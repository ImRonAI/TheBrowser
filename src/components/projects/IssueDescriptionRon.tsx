import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { nanoid } from 'nanoid'
import { Check, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getSession } from '@/api/supabase'
import { API_BASE_URL } from '@/pages/types/api'
import { createProjectsRequest } from '@/lib/projects-api'
import { projectEndpoint } from '@/lib/project-endpoint'
import { useProjectsStore } from '@/stores/projectsStore'
import { projectInputClass } from './ProjectFieldInput'
import { ModeSelector } from '@/components/agent-panel/AgentPanel'
import { VoiceAgent } from '@/components/agent-panel/VoiceAgent'
import { liveKey, liveTurnsFor, useLiveSessionStore } from '@/stores/liveSessionStore'
import { descriptionHtml, latestProposal } from '@/lib/issue-description-live'
import { descriptionRequestMessage, descriptionRetryMessage, issueRunMessage, issueRunStatus, type DraftTurn, type IssueAgentRun } from '@/lib/ron-draft'
import { AssistField } from '@/components/shared/TextAssist'
import { RonDraftChat, type DraftAgent } from './RonDraftChat'

const SUGGESTIONS = ['Write the description from the title', 'Add acceptance criteria', 'Research this and summarize the approach', 'Tighten the wording']
const POLL_MS = 400

/**
 * The issue's own agent (issue_agents: this issue's tools, research, its saved conversation) behind the
 * writing chat. Each request is a run on that conversation; the run's recorded tool activity and output
 * become a panel message, so the chat shows Ron's tracing with the panel's components.
 */
function useIssueAgent(issueId: string, beforeStart: () => Promise<boolean>, onRunning: (running: boolean) => void) {
  const { userId } = useProjectsStore()
  const [done, setDone] = useState<DraftTurn[]>([])
  const [current, setCurrent] = useState<DraftTurn | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const busy = useRef(false)
  const running = useRef(onRunning)
  running.current = onRunning
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; running.current(false) } }, [])

  const request = useCallback(() => {
    if (!userId) throw new Error('Sign in or open a workspace to ask Ron.')
    return createProjectsRequest(projectEndpoint(userId, API_BASE_URL), getSession, userId)
  }, [userId])

  const send: DraftAgent['send'] = async (ask, kind, goal) => {
    if (busy.current) return
    busy.current = true
    setError(null)
    const turn: DraftTurn = { id: nanoid(8), kind, ask, message: null, status: 'running' }
    try {
      // Ron reads the saved issue: save the current draft before the first request.
      if (kind === 'request' && !await beforeStart()) return
      if (!mounted.current) return
      setCurrent(turn)
      running.current(true)
      const api = request()
      const path = `/issues/${issueId}/agent`
      const { run } = await api<{ run: { id: string } }>(`${path}/messages`, 'POST', {
        message: kind === 'request' ? descriptionRequestMessage(ask, goal) : descriptionRetryMessage(ask),
      })
      while (mounted.current) {
        const { runs } = await api<{ runs: IssueAgentRun[] }>(path)
        const found = runs.find((item) => item.id === run.id)
        if (!found) throw new Error('This run is no longer in recent history. Review it in the Ron tab.')
        const next: DraftTurn = { ...turn, message: issueRunMessage(found), status: issueRunStatus(found.status), error: found.error ?? undefined }
        if (next.status !== 'running') { setDone((turns) => [...turns, next]); setCurrent(null); return }
        setCurrent(next)
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      }
    } catch (cause) {
      if (mounted.current) {
        setDone((turns) => [...turns, { ...turn, status: 'error', error: cause instanceof Error ? cause.message : 'Description generation failed.' }])
        setCurrent(null)
      }
    } finally {
      busy.current = false
      if (mounted.current) running.current(false)
    }
  }

  const stop = async () => {
    try { await request()(`/issues/${issueId}/agent/cancel`, 'POST') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Stop was not confirmed.') }
  }

  const agent: DraftAgent = { turns: current ? [...done, current] : done, running: current !== null, error, send, stop }
  const clear = () => { setDone([]); setCurrent(null); setError(null) }
  return { agent, clear }
}

/**
 * Ask Ron about an issue description. Chat opens a temporary writing chat (the panel's components) that
 * ends for good when the user inserts Ron's draft or overwrites the description; the runs stay in the
 * issue's saved Ron conversation. Live uses the same issue scope through `/bidi` and only *proposes*
 * text; the user applies it to the draft explicitly and saves as usual.
 */
export function IssueDescriptionRon({ issueId, issueTitle, currentDescription, editor, disabled, beforeStart, onPreview, onRunning }: {
  issueId: string; issueTitle?: string; currentDescription?: string
  /** The description editor: Ron's draft is inserted into it or overwrites it. */
  editor: Editor | null
  disabled: boolean; beforeStart: () => Promise<boolean>
  /** Live only: put the proposal into the description draft. */
  onPreview: (html: string) => void
  onRunning: (running: boolean) => void
}) {
  const { userId } = useProjectsStore()
  const [open, setOpen] = useState(false)
  const [goal, setGoal] = useState(false)
  const [chat, setChat] = useState(0)
  const [notice, setNotice] = useState('')
  const [mode, setMode] = useState<'text' | 'voice'>('text')
  const [modeNotice, setModeNotice] = useState('')
  const [livePrompt, setLivePrompt] = useState('')
  const [liveError, setLiveError] = useState<string | null>(null)
  const [applied, setApplied] = useState<string | null>(null)
  const liveHandOff = useRef<(() => Promise<boolean>) | null>(null)
  const registerHandOff = useCallback((handOff: (() => Promise<boolean>) | null) => { liveHandOff.current = handOff }, [])
  const liveTurns = useLiveSessionStore((s) => (userId ? liveTurnsFor(s, liveKey(userId, `issue:${issueId}`, issueId)) : []))
  const lastProposal = latestProposal(liveTurns)
  const { agent, clear } = useIssueAgent(issueId, beforeStart, onRunning)

  // The editor's Ask Ron / Goal slash commands open the chat.
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<{ issueId: string; goal: boolean }>).detail
      if (detail.issueId !== issueId) return
      setGoal(detail.goal)
      setNotice('')
      setOpen(true)
    }
    window.addEventListener('issue-description-ron', show)
    return () => window.removeEventListener('issue-description-ron', show)
  }, [issueId])

  /** Ends the chat; a new one starts empty next time. */
  const close = () => {
    if (agent.running) return
    clear()
    setChat((value) => value + 1)
    setOpen(false)
    setMode('text')
  }

  const switchMode = async (next: 'text' | 'voice') => {
    if (next === mode) return
    setModeNotice('')
    if (next === 'text' && liveHandOff.current) {
      const done = await liveHandOff.current()
      if (!done) { setModeNotice('Live is still working. Wait for pending tools or press Stop in Live before switching.'); return }
    }
    if (next === 'voice' && agent.running) { setModeNotice('Ron is writing. Stop it or wait before switching to Live.'); return }
    setMode(next)
  }

  /** Live path: save the draft first (same guard as Chat), then prepare the request for the Live composer. */
  const prepareLive = async () => {
    if (!userId || disabled || !livePrompt.trim()) return
    setLiveError(null)
    try { if (await beforeStart()) setApplied(null) }
    catch (cause) { setLiveError(cause instanceof Error ? cause.message : 'The draft could not be saved before starting Live.') }
  }
  const applyProposal = () => {
    if (!lastProposal) return
    onPreview(descriptionHtml(lastProposal.text))
    setApplied(lastProposal.id)
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className="gap-1.5 rounded-full" disabled={disabled}
          onClick={() => { setGoal(false); setNotice(''); setOpen(true) }}>
          <Sparkles className="size-4 text-accent dark:text-accent-light" />Ask Ron to write
        </Button>
        {notice && <p role="status" className="flex items-center gap-1.5 text-sm text-success"><Check className="size-4" />{notice}</p>}
      </div>
    )
  }

  const modes = <ModeSelector value={mode} onChange={(next) => void switchMode(next)} />
  if (mode === 'text') {
    return (
      <div className="space-y-2">
        {modeNotice && <p role="status" className="text-xs text-amber-600">{modeNotice}</p>}
        <RonDraftChat key={chat} agent={agent} editor={editor} noun="description" suggestions={SUGGESTIONS} initialGoal={goal}
          disabled={disabled && !agent.running} headerExtra={modes} onClose={close}
          idleNote={<p className="mt-2 px-1 text-xs text-ink-muted dark:text-ink-inverse-muted">Uses this issue’s saved Ron conversation. Your current draft is saved before Ron starts.</p>}
          onApplied={(how) => { close(); setNotice(how === 'inserted' ? 'Inserted Ron’s draft. Save changes to keep it.' : 'Replaced the description with Ron’s draft. Save changes to keep it.') }} />
      </div>
    )
  }

  return <section className="space-y-2 rounded-2xl border border-surface-200 p-3 dark:border-surface-700" aria-label="Ask Ron about this description">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-semibold">Ask Ron · Live</p>
      <div className="flex items-center gap-2">{modes}<Button type="button" variant="ghost" size="sm" onClick={close}>Close</Button></div>
    </div>
    {modeNotice && <p role="status" className="text-xs text-amber-600">{modeNotice}</p>}
    <div className="flex flex-wrap gap-2">
      <AssistField value={livePrompt} onChange={setLivePrompt} suggest count={5} className="flex-1 min-w-[min(100%,12rem)]">
        {(field) => <input className={`${projectInputClass} w-full`} value={livePrompt} aria-label="What should Ron help you say?"
          onChange={(event) => setLivePrompt(event.target.value)} placeholder="What should Ron help you say? (handed to Live)" maxLength={16000}
          onFocus={field.onFocus} onBlur={field.onBlur}
          onKeyDown={(event) => { field.onKeyDown(event); if (event.defaultPrevented) return; if (event.key === 'Enter') { event.preventDefault(); void prepareLive() } }} />}
      </AssistField>
      <Button type="button" disabled={disabled || !livePrompt.trim() || !userId} onClick={() => void prepareLive()}>Prepare for Live</Button>
    </div>
    {userId && <div className="space-y-2">
      <p className="text-xs text-ink-muted">Live uses this issue’s agent scope (same tool limits as the Ron pane). Your draft is saved before the session starts. Ron’s final text is applied to the draft only when you choose to.</p>
      <div className="flex min-h-[26rem] max-h-[70vh] flex-col overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
        <VoiceAgent userId={userId} agentScope={`issue:${issueId}`} sessionId={issueId} owner="issue-description" compact
          issue={{ id: issueId, title: issueTitle, description: currentDescription }} registerHandOff={registerHandOff} />
      </div>
      {lastProposal && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200/60 bg-indigo-50/40 p-2 text-xs dark:border-indigo-900 dark:bg-indigo-950/20">
        <span className="min-w-0 flex-1 truncate">Latest Live proposal: “{lastProposal.text.slice(0, 120)}{lastProposal.text.length > 120 ? '…' : ''}”</span>
        <Button type="button" size="sm" variant={applied === lastProposal.id ? 'outline' : 'default'} disabled={disabled || applied === lastProposal.id} onClick={applyProposal}>
          {applied === lastProposal.id ? 'Applied to draft · review and save' : 'Use as description draft'}
        </Button>
      </div>}
    </div>}
    {liveError && <p role="alert" className="text-sm text-rose-500">{liveError}</p>}
  </section>
}
