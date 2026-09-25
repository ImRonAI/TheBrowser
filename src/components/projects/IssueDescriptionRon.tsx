import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { getSession } from '@/api/supabase'
import { API_BASE_URL } from '@/pages/types/api'
import { createProjectsRequest } from '@/lib/projects-api'
import { projectEndpoint } from '@/lib/project-endpoint'
import { useProjectsStore } from '@/stores/projectsStore'
import { projectInputClass } from './ProjectFieldInput'

/** Both entry points use the same issue-agent endpoint and native snapshot. Never
 * send description edits to the legacy global task stream or apply raw model HTML.
 */
export function IssueDescriptionRon({ issueId, disabled, beforeStart, onPreview, onRunning }: {
  issueId: string; disabled: boolean; beforeStart: () => Promise<boolean>
  onPreview: (html: string) => void; onRunning: (running: boolean) => void
}) {
  const { userId } = useProjectsStore()
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [received, setReceived] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsReview, setNeedsReview] = useState(false)
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
          const html = current.output.split(/\n\n+/).map((paragraph) => `<p>${paragraph.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`).join('')
          callbacks.current.onPreview(html)
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

  return <section className="space-y-2 rounded-xl border border-indigo-500/20 p-3" aria-label="Ask Ron about this description">
    <label className="block text-sm font-medium" htmlFor={`description-ron-${issueId}`}>Ask Ron</label>
    <div className="flex flex-wrap gap-2">
      <input id={`description-ron-${issueId}`} className={`${projectInputClass} flex-1 min-w-[min(100%,12rem)]`} value={prompt} disabled={running}
        onChange={(event) => setPrompt(event.target.value)} placeholder="What should this description say?" maxLength={16000}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void send() } }} />
      {running ? <Button type="button" variant="outline" onClick={() => void cancel()}>Stop</Button>
        : <Button type="button" disabled={disabled || !prompt.trim() || needsReview} onClick={() => void send()}>Write description</Button>}
    </div>
    {running && !received && <p role="status" className="animate-pulse text-sm text-indigo-500">Ron is preparing your description…</p>}
    {received && <p role="status" className="text-xs text-ink-muted">{running ? 'Writing…' : 'Review the description and save changes.'}</p>}
    <p className="text-xs text-ink-muted">Uses this issue’s saved Ron conversation. Your current draft is saved before starting.</p>
    {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    {needsReview && !running && <p className="text-xs text-amber-600">Review this run in the Ron pane before trying again. It may still be running.</p>}
  </section>
}