import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ASK_ACTIVITY, useContextAgentStore } from '@/stores/contextAgentStore'

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
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-label="Conversation with Context Agent">
      {!asks.length && <p className="text-xs text-ron-text/50 dark:text-white/50">
        Ask Context Agent what it has learned about your interests, to rethink your graph, or to suggest an agent for something you do often.</p>}
      {asks.map((turn) => <div key={turn.id} className="space-y-1.5">
        <p className="ml-8 rounded-lg bg-royal/10 px-2.5 py-1.5 text-xs text-ron-text dark:text-white">{turn.question}</p>
        {turn.error
          ? <p className="mr-8 text-xs text-red-600 dark:text-red-400" role="alert">{turn.error}</p>
          : <p data-testid="context-answer" className="mr-8 whitespace-pre-wrap text-xs text-ron-text/80 dark:text-white/80">{turn.answer || '…'}</p>}
      </div>)}
      <div ref={end} />
    </div>
    <form onSubmit={submit} className="flex gap-1.5 border-t border-zinc-200/60 px-3 py-2 dark:border-white/10">
      <input aria-label="Ask Context Agent" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask Context Agent…"
        className="w-full rounded-md border border-zinc-200 bg-white/70 px-2 py-1.5 text-xs text-ron-text outline-none focus:border-royal dark:border-white/10 dark:bg-white/5 dark:text-white" />
      {asking
        ? <button type="button" onClick={() => void cancel()} className="rounded-md px-3 text-xs text-ron-text/70 hover:bg-zinc-100 dark:text-white/70">Stop</button>
        : <button type="submit" disabled={!question.trim()} className="rounded-md bg-royal px-3 text-xs font-raleway font-raleway-bold text-white disabled:opacity-40 dark:bg-royal-light">Ask</button>}
    </form>
  </div>
}
