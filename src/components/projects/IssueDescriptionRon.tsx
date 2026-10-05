import { useCallback, useEffect, useRef, useState } from 'react'
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

/** Both entry points use the same issue-agent endpoint and native snapshot. Never
 * send description edits to the legacy global task stream or apply raw model HTML.
 * Live uses the same issue scope through `/bidi` and only *proposes* text; the
 * user applies it to the draft explicitly and saves as usual.
 */
export function IssueDescriptionRon({ issueId, issueTitle, currentDescription, disabled, beforeStart, onPreview, onRunning }: {
  issueId: string; issueTitle?: string; currentDescription?: string; disabled: boolean; beforeStart: () => Promise<boolean>
  onPreview: (html: string) => void; onRunning: (running: boolean) => void
}) {
  const { userId } = useProjectsStore()
  const [mode, setMode] = useState<'text' | 'voice'>('text')
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [received, setReceived] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsReview, setNeedsReview] = useState(false)
  const [modeNotice, setModeNotice] = useState('')
  // Live hand-over: set only after beforeStart() saved the draft; the prompt is prepared, never auto-sent.
  const [applied, setApplied] = useState<string | null>(null)
  const liveHandOff = useRef<(() => Promise<boolean>) | null>(null)
  const registerHandOff = useCallback((handOff: (() => Promise<boolean>) | null) => { liveHandOff.current = handOff }, [])
  const liveTurns = useLiveSessionStore((s) => (userId ? liveTurnsFor(s, liveKey(userId, `issue:${issueId}`, issueId)) : []))
  const lastProposal = latestProposal(liveTurns)
  const mounted = useRef(true)
  const pending = useRef(false)
  const callbacks = useRef({ onPreview, onRunning })
  callbacks.current = { onPreview, onRunning }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; callbacks.current.onRunning(false) } }, [])
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ issueId: string; goal: boolean }>).detail
      if (detail.issueId !== issueId) return
      if (detail.goal) setPrompt('/goal ')
      document.getElementById(`description-ron-${issueId}`)?.focus()
    }
    window.addEventListener('issue-description-ron', open)
    return () => window.removeEventListener('issue-description-ron', open)
  }, [issueId])

  const send = async () => {
    if (!userId || pending.current || disabled || needsReview || !prompt.trim()) return
    pending.current = true
    setError(null)
    try {
      if (!await beforeStart() || !mounted.current) return
      setRunning(true); setReceived(false); callbacks.current.onRunning(true)
      const request = createProjectsRequest(projectEndpoint(userId, API_BASE_URL), getSession, userId)
      const path = `/issues/${issueId}/agent`
      setNeedsReview(true)
      const { run } = await request<{ run: { id: string } }>(`${path}/messages`, 'POST', {
        message: `${prompt.trim().startsWith('/goal ') ? '/goal ' : ''}Write the description for this issue. ${prompt.trim().replace(/^\/goal\s+/, '')}\nReturn only the description text. Do not edit the description with tools: the user will review and save the streamed draft.`,
      })
      let previous = ''
      while (mounted.current) {
        const data = await request<{ runs: { id: string; output: string; status: string; error: string | null }[] }>(path)
        if (!mounted.current) break
        const current = data.runs.find((item) => item.id === run.id)
        if (!current) throw new Error('Run is no longer in recent history. Review it in the Ron pane.')
        if (current.output && current.output !== previous) {
          previous = current.output
          setReceived(true)
          callbacks.current.onPreview(descriptionHtml(current.output))
        }
        if (current.status !== 'running') {
          setNeedsReview(false)
          if (current.status !== 'completed') throw new Error(current.error || `Run ${current.status}. Partial output is retained as a draft.`)
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Description generation failed.')
    } finally {
      pending.current = false
      if (mounted.current) { setRunning(false); callbacks.current.onRunning(false) }
    }
  }

  const cancel = async () => {
    if (!userId) return
    try {
      await createProjectsRequest(projectEndpoint(userId, API_BASE_URL), getSession, userId)(`/issues/${issueId}/agent/cancel`, 'POST')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Stop was not confirmed.') }
  }

  /** Live path: save the draft first (same guard as Chat), then prepare the request for the Live composer. */
  const prepareLive = async () => {
    if (!userId || pending.current || disabled || !prompt.trim()) return
    pending.current = true
    setError(null)
    try {
      if (!await beforeStart() || !mounted.current) return
      setApplied(null)
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'The draft could not be saved before starting Live.')
    } finally { pending.current = false }
  }

  const switchMode = async (next: 'text' | 'voice') => {
    if (next === mode) return
    setModeNotice('')
    if (next === 'text' && liveHandOff.current) {
      const done = await liveHandOff.current()
      if (!done) { setModeNotice('Live is still working. Wait for pending tools or press Stop in Live before switching.'); return }
    }
    if (next === 'voice' && running) { setModeNotice('A description run is in progress. Stop it or wait before switching to Live.'); return }
    setMode(next)
  }

  const applyProposal = () => {
    if (!lastProposal) return
    callbacks.current.onPreview(descriptionHtml(lastProposal.text))
    setApplied(lastProposal.id)
  }

  return <section className="space-y-2 rounded-xl border border-indigo-500/20 p-3" aria-label="Ask Ron about this description">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label className="block text-sm font-medium" htmlFor={`description-ron-${issueId}`}>Ask Ron</label>
      <ModeSelector value={mode} onChange={(next) => void switchMode(next)} />
    </div>
    {modeNotice && <p role="status" className="text-xs text-amber-600">{modeNotice}</p>}
    <div className="flex flex-wrap gap-2">
      <input id={`description-ron-${issueId}`} className={`${projectInputClass} flex-1 min-w-[min(100%,12rem)]`} value={prompt} disabled={running}
        onChange={(event) => setPrompt(event.target.value)} placeholder={mode === 'voice' ? 'What should Ron help you say? (handed to Live)' : 'What should this description say?'} maxLength={16000}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void (mode === 'voice' ? prepareLive() : send()) } }} />
      {mode === 'voice'
        ? <Button type="button" disabled={disabled || !prompt.trim() || !userId} onClick={() => void prepareLive()}>Prepare for Live</Button>
        : running ? <Button type="button" variant="outline" onClick={() => void cancel()}>Stop</Button>
        : <Button type="button" disabled={disabled || !prompt.trim() || needsReview} onClick={() => void send()}>Write description</Button>}
    </div>
    {mode === 'text' && <>
      {running && !received && <p role="status" className="animate-pulse text-sm text-indigo-500">Ron is preparing your description…</p>}
      {received && <p role="status" className="text-xs text-ink-muted">{running ? 'Writing…' : 'Review the description and save changes.'}</p>}
      <p className="text-xs text-ink-muted">Uses this issue’s saved Ron conversation. Your current draft is saved before starting.</p>
      {needsReview && !running && <p className="text-xs text-amber-600">Review this run in the Ron pane before trying again. It may still be running.</p>}
    </>}
    {mode === 'voice' && userId && <div className="space-y-2">
      <p className="text-xs text-ink-muted">Live uses this issue’s agent scope (same tool limits as the Ron pane). Your draft is saved before the session starts. Ron’s final text is applied to the draft only when you choose to.</p>
      <div className="flex min-h-[26rem] max-h-[70vh] flex-col overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
        <VoiceAgent userId={userId} agentScope={`issue:${issueId}`} conversationId={issueId} owner="issue-description" compact
          issue={{ id: issueId, title: issueTitle, description: currentDescription }} registerHandOff={registerHandOff} />
      </div>
      {lastProposal && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200/60 bg-indigo-50/40 p-2 text-xs dark:border-indigo-900 dark:bg-indigo-950/20">
        <span className="min-w-0 flex-1 truncate">Latest Live proposal: “{lastProposal.text.slice(0, 120)}{lastProposal.text.length > 120 ? '…' : ''}”</span>
        <Button type="button" size="sm" variant={applied === lastProposal.id ? 'outline' : 'default'} disabled={disabled || applied === lastProposal.id} onClick={applyProposal}>
          {applied === lastProposal.id ? 'Applied to draft · review and save' : 'Use as description draft'}
        </Button>
      </div>}
    </div>}
    {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
  </section>
}
