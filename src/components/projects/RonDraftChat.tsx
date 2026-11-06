import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { nanoid } from 'nanoid'
import { Check, CornerDownRight, Loader2, MousePointerClick, Replace, RotateCcw, Sparkles, Square, Target, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Message, MessageContent } from '@/components/ai-elements/message'
import { MessageResponse } from '@/components/ai-elements/response'
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtHeader } from '@/components/ai-elements/chain-of-thought'
import { MessageBubble } from '@/components/agent-panel/AgentPanel'
import { WorkflowDiagram } from '@/components/workflow/WorkflowCanvas'
import { AssistField } from '@/components/shared/TextAssist'
import { documentContent, hasDraft, unwrapMarkdown, type DocNode } from '@/lib/document-ron'
import { PLACEMENT_KEY, describeTarget, insertionTarget, placementPlugin } from '@/lib/document-placement'
import { draftParts, type DraftTurn } from '@/lib/ron-draft'
import type { RonSegment } from '@/lib/ron-run'
import { workflowOutline } from '@/lib/workflow'
import { cn } from '@/lib/utils'

/** Who answers: the Document Agent (pages) or the issue's own agent (descriptions). */
export interface DraftAgent {
  turns: DraftTurn[]
  running: boolean
  error: string | null
  /** A request (first turn, optionally in Goal mode) or feedback on the last draft (Try again). */
  send: (ask: string, kind: 'request' | 'feedback', goal: boolean) => Promise<void>
  stop: () => Promise<void>
}

const NO_SUPERSEDED: ReadonlySet<string> = new Set()
const noUiAction = () => {}

/** The Agent Panel's composer card. */
const composerClass = 'relative rounded-2xl border px-4 pt-3 pb-2.5 transition-all duration-200 bg-surface-0 dark:bg-surface-850/90 border-surface-200 dark:border-surface-700/80 shadow-[0_4px_20px_-4px_rgb(26_25_23/0.06)] dark:shadow-[0_8px_24px_-6px_rgb(0_0_0/0.35)] focus-within:border-accent/50 focus-within:shadow-[0_0_0_3px_rgb(169_83_46/0.12),0_8px_24px_-6px_rgb(26_25_23/0.12)] dark:focus-within:border-accent-light/50'
const composerInput = 'w-full min-w-0 resize-none bg-transparent py-1 text-[14px] leading-relaxed placeholder:text-ink-muted/60 outline-none disabled:opacity-60 min-h-[52px] max-h-40'
const sendClass = 'shrink-0 rounded-xl bg-ink dark:bg-ink-inverse text-white dark:text-surface-900 px-3.5 h-8 text-xs font-semibold shadow-sm transition-all hover:opacity-90 disabled:opacity-30'

function placementMarker(): HTMLElement {
  const marker = document.createElement('div')
  marker.contentEditable = 'false'
  marker.setAttribute('data-ron-placement', '')
  marker.className = 'not-prose pointer-events-none my-2 flex select-none items-center gap-2 rounded-lg border-2 border-dashed border-accent/60 bg-accent/5 px-3 py-2 text-xs font-semibold text-accent dark:border-accent-light/60 dark:text-accent-light'
  marker.textContent = 'Ron’s draft goes here'
  return marker
}

/** The draft Ron wrote: Markdown and drawn workflows, as the panel renders an answer. */
function DraftView({ segments, streaming }: { segments: RonSegment[]; streaming: boolean }) {
  return (
    <Message from="assistant">
      <MessageContent variant="flat" className="min-w-0 w-full space-y-3">
        {segments.map((segment, index) => segment.kind === 'workflow'
          ? (
            <figure key={segment.id} className="space-y-1.5">
              <figcaption className="text-xs font-medium text-ink-secondary dark:text-ink-inverse-secondary">Workflow · {segment.title}</figcaption>
              <WorkflowDiagram graph={segment.graph} className="h-[300px]" label={`${segment.title}: ${workflowOutline(segment.graph).join(', then ')}`} />
            </figure>
          )
          : <MessageResponse key={`text-${index}`} isAnimating={streaming && index === segments.length - 1}>{unwrapMarkdown(segment.text)}</MessageResponse>)}
      </MessageContent>
    </Message>
  )
}

/** One exchange: the user's message, Ron's tracing in an accordion, then the draft. */
function TurnView({ turn }: { turn: DraftTurn }) {
  const running = turn.status === 'running'
  const { tracing, segments } = useMemo(() => draftParts(turn.message), [turn.message])
  const [open, setOpen] = useState(running)
  // Open while Ron works; fold away once the draft is done (the user can reopen it).
  useEffect(() => { setOpen(running) }, [running])
  const steps = tracing.filter((part) => part.kind === 'tool' || part.kind === 'native').length
  const ask = { id: `${turn.id}:ask`, role: 'user' as const, parts: [{ kind: 'text' as const, key: `${turn.id}:ask`, path: [], text: turn.ask }] }
  return (
    <div className="space-y-3">
      <MessageBubble message={ask} status="completed" onUiAction={noUiAction} superseded={NO_SUPERSEDED} />
      {(tracing.length > 0 || (running && !hasDraft(segments))) && (
        <ChainOfThought open={open} onOpenChange={setOpen} className="rounded-xl border border-surface-200 px-3 py-2 dark:border-surface-700">
          <ChainOfThoughtHeader>
            {running ? (hasDraft(segments) ? 'Ron is writing…' : 'Ron is working…') : `Ron’s work · ${steps} ${steps === 1 ? 'step' : 'steps'}`}
          </ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            {tracing.length
              ? <MessageBubble message={{ ...turn.message!, parts: tracing }} status={turn.status} onUiAction={noUiAction} superseded={NO_SUPERSEDED} />
              : <p className="flex items-center gap-2 text-xs text-ink-muted dark:text-ink-inverse-muted"><Loader2 className="size-3.5 animate-spin" />Starting…</p>}
          </ChainOfThoughtContent>
        </ChainOfThought>
      )}
      {hasDraft(segments) && <DraftView segments={segments} streaming={running} />}
      {!running && !hasDraft(segments) && turn.status !== 'error' && (
        <p role="status" className="px-1 text-sm text-ink-muted dark:text-ink-inverse-muted">{turn.status === 'cancelled' ? 'Stopped before Ron wrote a draft.' : 'Ron did not write a draft.'}</p>
      )}
      {turn.status === 'error' && <p role="alert" className="px-1 text-sm text-danger">{turn.error || 'Ron could not finish this request.'}</p>}
    </div>
  )
}

/**
 * Ask Ron to write, as a temporary chat built from the Agent Panel's own components: the user's
 * request, Ron's tracing (tools, reasoning) in an accordion, and the draft. The draft only reaches the
 * editor when the user chooses Insert (pick the spot; nothing is overwritten) or Overwrite; either one
 * ends the chat (`onApplied`) for good. Try again sends feedback in the same conversation.
 */
export function RonDraftChat({ agent, editor, noun, suggestions, initialGoal = false, onApplied, onClose, disabled, headerExtra, idleNote }: {
  agent: DraftAgent
  editor: Editor | null
  /** What Ron writes: “page” or “description”. */
  noun: string
  suggestions: string[]
  initialGoal?: boolean
  /** The draft went into the editor: the chat ends. */
  onApplied: (how: 'inserted' | 'overwritten') => void
  onClose?: () => void
  disabled?: boolean
  headerExtra?: ReactNode
  /** Shown under the composer before the first request. */
  idleNote?: ReactNode
}) {
  const [prompt, setPrompt] = useState('')
  const [goal, setGoal] = useState(initialGoal)
  const [stage, setStage] = useState<'review' | 'placing' | 'feedback'>('review')
  const [feedback, setFeedback] = useState('')
  const [spot, setSpot] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const feedbackRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setGoal(initialGoal) }, [initialGoal])

  const started = agent.turns.length > 0
  const latest = agent.turns[agent.turns.length - 1]
  const latestSegments = useMemo(() => draftParts(latest?.message ?? null).segments, [latest?.message])
  const drafted = !agent.running && latest !== undefined && hasDraft(latestSegments)

  useEffect(() => { if (!started) inputRef.current?.focus() }, [started])
  useEffect(() => { if (stage === 'feedback') feedbackRef.current?.focus() }, [stage])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [agent.turns.length, drafted, stage])

  // Choosing where the draft goes: a marker in the editor follows the caret until the user places it.
  useEffect(() => {
    if (stage !== 'placing' || !editor || editor.isDestroyed) return
    editor.registerPlugin(placementPlugin(placementMarker))
    const update = () => setSpot(describeTarget(insertionTarget(editor.state.doc, editor.state.selection.to)))
    update()
    editor.on('transaction', update)
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setStage('review') }
    window.addEventListener('keydown', onKey)
    return () => {
      editor.off('transaction', update)
      window.removeEventListener('keydown', onKey)
      if (!editor.isDestroyed) editor.unregisterPlugin(PLACEMENT_KEY)
    }
  }, [stage, editor])

  const send = (text = prompt) => {
    const ask = text.trim()
    if (!ask || agent.running || started || disabled) return
    setPrompt(ask)
    void agent.send(ask, 'request', goal)
  }
  const retry = () => {
    const note = feedback.trim()
    if (!note || agent.running || disabled) return
    setStage('review')
    setFeedback('')
    void agent.send(note, 'feedback', false)
  }

  const blocks = (): DocNode[] => {
    const markdown = editor?.markdown
    if (!markdown) return []
    return documentContent(latestSegments, (text) => markdown.parse(text) as DocNode, () => nanoid(10))
  }
  const place = () => {
    const content = blocks()
    if (!editor || !content.length) return
    const target = insertionTarget(editor.state.doc, editor.state.selection.to)
    editor.unregisterPlugin(PLACEMENT_KEY)
    editor.chain().focus().insertContentAt(target.replace ?? target.at, content).scrollIntoView().run()
    onApplied('inserted')
  }
  const overwrite = () => {
    const content = blocks()
    if (!editor || !content.length) return
    editor.chain().focus().setContent({ type: 'doc', content }).run()
    onApplied('overwritten')
  }

  return (
    <section aria-label="Ask Ron to write" className="not-prose rounded-2xl border border-surface-200 bg-surface-0 shadow-subtle dark:border-surface-700 dark:bg-surface-900 dark:shadow-dark-subtle">
      <header className="flex items-center gap-2 border-b border-surface-200/80 px-3 py-2 dark:border-surface-800">
        <span className="flex size-7 items-center justify-center rounded-lg bg-accent/10 text-accent dark:bg-accent-light/10 dark:text-accent-light"><Sparkles className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink dark:text-ink-inverse">Ask Ron</p>
          <p className="truncate text-xs text-ink-muted dark:text-ink-inverse-muted">Ron researches and drafts this {noun}; nothing changes until you insert or overwrite.</p>
        </div>
        {headerExtra}
        {!started && (
          <button type="button" role="switch" aria-checked={goal} onClick={() => setGoal((value) => !value)} disabled={disabled}
            title="Goal mode: Ron keeps working until a judge agrees the request is met"
            className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
              goal ? 'border-accent/40 bg-accent/10 text-accent dark:border-accent-light/40 dark:bg-accent-light/10 dark:text-accent-light'
                : 'border-surface-200 text-ink-muted hover:text-ink dark:border-surface-700 dark:text-ink-inverse-muted dark:hover:text-ink-inverse')}>
            <Target className="size-3.5" />Goal
          </button>
        )}
        {onClose && <Button type="button" variant="ghost" size="icon-sm" aria-label="Close Ask Ron" className="rounded-full" onClick={onClose}><X className="size-4" /></Button>}
      </header>

      {started && (
        <div className="max-h-[640px] space-y-5 overflow-y-auto px-4 py-4" aria-label="Ask Ron conversation">
          {agent.turns.map((turn) => <TurnView key={turn.id} turn={turn} />)}
          <div ref={endRef} />
        </div>
      )}
      {agent.error && <p role="alert" className="px-4 pb-2 text-sm text-danger">{agent.error}</p>}

      <div className="px-3 pb-3 pt-1">
        {!started && (
          <>
            <form className={composerClass} onSubmit={(event) => { event.preventDefault(); send() }}>
              <AssistField value={prompt} onChange={setPrompt} suggest count={5} className="min-w-0">
                {(field) => (
                  <textarea ref={inputRef} aria-label={`What should Ron write in this ${noun}?`} rows={2} maxLength={8000} value={prompt} disabled={disabled}
                    onChange={(event) => setPrompt(event.target.value)} onFocus={field.onFocus} onBlur={field.onBlur}
                    onKeyDown={(event) => {
                      field.onKeyDown(event)
                      if (event.defaultPrevented) return
                      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() }
                      if (event.key === 'Escape') onClose?.()
                    }}
                    placeholder={goal ? `Describe the outcome; Ron works until the ${noun} meets it` : `What should Ron write? e.g. “an onboarding checklist with the approval workflow”`}
                    className={composerInput} />
                )}
              </AssistField>
              <div className="mt-2 flex items-center justify-end gap-2 border-t border-surface-200/60 pt-2 dark:border-surface-700/60">
                <button type="submit" className={sendClass} disabled={!prompt.trim() || !editor || disabled}>Write</button>
              </div>
            </form>
            <div className="mt-2 flex flex-wrap gap-1.5 px-1">
              {suggestions.map((suggestion) => (
                <button key={suggestion} type="button" disabled={disabled || !editor} onClick={() => send(suggestion)}
                  className="rounded-full border border-surface-200 px-2.5 py-1 text-xs text-ink-secondary transition-colors hover:border-accent/40 hover:text-ink disabled:opacity-50 dark:border-surface-700 dark:text-ink-inverse-secondary dark:hover:text-ink-inverse">
                  {suggestion}
                </button>
              ))}
            </div>
            {idleNote}
          </>
        )}

        {agent.running && (
          <div className="flex items-center justify-between gap-2 px-1">
            <p role="status" className="flex items-center gap-2 text-xs text-ink-muted dark:text-ink-inverse-muted"><span className="h-2 w-2 rounded-full bg-emerald-500" />Ron is working on your {noun}</p>
            <Button type="button" variant="outline" size="sm" className="gap-1.5 rounded-full" onClick={() => void agent.stop()}><Square className="size-3" />Stop</Button>
          </div>
        )}

        {drafted && stage === 'review' && (
          <div className="flex flex-wrap items-center gap-2 px-1">
            <Button type="button" className="gap-1.5 rounded-full" onClick={() => { setStage('placing'); editor?.commands.focus() }} disabled={disabled || !editor}><CornerDownRight className="size-4" />Insert</Button>
            <Button type="button" variant="outline" className="gap-1.5 rounded-full" onClick={overwrite} disabled={disabled || !editor}><Replace className="size-4" />Overwrite</Button>
            <Button type="button" variant="outline" className="gap-1.5 rounded-full" onClick={() => setStage('feedback')} disabled={disabled}><RotateCcw className="size-4" />Try again</Button>
          </div>
        )}

        {drafted && stage === 'placing' && (
          <p role="status" className="flex items-center gap-2 px-1 text-sm text-ink-secondary dark:text-ink-inverse-secondary">
            <MousePointerClick className="size-4 text-accent dark:text-accent-light" />Click in the {noun} where Ron’s draft should go, then choose Place here.
          </p>
        )}

        {started && !agent.running && stage === 'feedback' && (
          <form className={composerClass} onSubmit={(event) => { event.preventDefault(); retry() }}>
            <AssistField value={feedback} onChange={setFeedback} className="min-w-0">
              {(field) => (
                <textarea ref={feedbackRef} aria-label="What should Ron change?" rows={2} maxLength={4000} value={feedback} disabled={disabled}
                  onChange={(event) => setFeedback(event.target.value)} onFocus={field.onFocus} onBlur={field.onBlur}
                  onKeyDown={(event) => {
                    field.onKeyDown(event)
                    if (event.defaultPrevented) return
                    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); retry() }
                    if (event.key === 'Escape') setStage('review')
                  }}
                  placeholder="What are you looking for? e.g. “shorter, add sources, and a step for legal review”"
                  className={composerInput} />
              )}
            </AssistField>
            <div className="mt-2 flex items-center justify-end gap-2 border-t border-surface-200/60 pt-2 dark:border-surface-700/60">
              <Button type="button" variant="ghost" size="sm" className="rounded-full text-ink-muted" onClick={() => setStage('review')}>Cancel</Button>
              <button type="submit" className={sendClass} disabled={!feedback.trim() || disabled}><RotateCcw className="mr-1 inline size-3" />Try again</button>
            </div>
          </form>
        )}

        {started && !agent.running && !drafted && stage !== 'feedback' && (
          <div className="flex items-center gap-2 px-1">
            <Button type="button" variant="outline" className="gap-1.5 rounded-full" onClick={() => setStage('feedback')} disabled={disabled}><RotateCcw className="size-4" />Try again</Button>
          </div>
        )}
      </div>

      {stage === 'placing' && drafted && createPortal(
        <div role="dialog" aria-label="Choose where Ron’s draft goes"
          className="fixed bottom-6 left-1/2 z-[60] flex w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-2xl border border-surface-200 bg-surface-0/95 px-4 py-3 shadow-lg backdrop-blur dark:border-surface-700 dark:bg-surface-900/95">
          <MousePointerClick className="size-5 shrink-0 text-accent dark:text-accent-light" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink dark:text-ink-inverse">Click in the {noun} where it should go</p>
            <p className="truncate text-xs text-ink-muted dark:text-ink-inverse-muted" aria-live="polite">{spot}</p>
          </div>
          <Button type="button" variant="ghost" className="rounded-full" onMouseDown={(event) => event.preventDefault()} onClick={() => setStage('review')}>Cancel</Button>
          <Button type="button" className="gap-1.5 rounded-full" onMouseDown={(event) => event.preventDefault()} onClick={place}><Check className="size-4" />Place here</Button>
        </div>,
        document.body,
      )}
    </section>
  )
}
