import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ASK_ACTIVITY, useContextAgentStore } from '@/stores/contextAgentStore'
import { field, ghostButton, mutedText, primaryButton } from './contextUi'

/** A direct line to the Context Agent: ask about your interests, context or agents. */
export function ContextAsk() {
  const asks = useContextAgentStore((state) => state.asks)
  // Stop is offered only while one of the user's own questions is the running turn. Background turns
  // (browsing, reading added context, building an agent) share the session, and asking during them
  // queues behind them, so they leave Ask available and are never cancelled from here.
  const asking = useContextAgentStore((state) => state.status === 'running' && state.activity === ASK_ACTIVITY)
  const { ask, cancel } = useContextAgentStore.getState()
  const [question, setQuestion] = useState('')
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [asks])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!question.trim()) return
    void ask(question)
    setQuestion('')
  }

  return <div className="flex h-full flex-col">
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-label="Conversation with Context Agent">
      {!asks.length && <p className={mutedText}>Ask what Ren has learned about you, or for an agent that handles something you do often.</p>}
      {asks.map((turn) => <div key={turn.id} className="space-y-1.5">
        <p className="ml-10 rounded-xl bg-surface-100 px-3 py-1.5 text-[13px] text-ink dark:bg-surface-850 dark:text-ink-inverse">{turn.question}</p>
        {turn.error
          ? <p className="mr-10 text-[13px] text-red-600 dark:text-red-400" role="alert">{turn.error}</p>
          : <p data-testid="context-answer" className="mr-10 whitespace-pre-wrap text-[13px] leading-relaxed text-ink dark:text-ink-inverse">{turn.answer || '…'}</p>}
      </div>)}
      <div ref={end} />
    </div>
    <form onSubmit={submit} className="flex items-center gap-1.5 border-t border-surface-200 px-4 py-2 dark:border-surface-800">
      <input aria-label="Ask Context Agent" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about your context…" className={field} />
      {asking
        ? <button type="button" onClick={() => void cancel()} className={ghostButton}>Stop</button>
        : <button type="submit" disabled={!question.trim()} className={primaryButton}>Ask</button>}
    </form>
  </div>
}
