/**
 * The Answer panel — the Strands Harness Search Agent's (`xai/grok-4.7`) streamed
 * answer as a single reading column: prior conversational turns, an optional
 * "Show reasoning" disclosure, the answer itself with a breathing caret while it
 * streams, numbered source chips, a provenance footer (model, effort, tokens),
 * and a native `PromptInput` composer for multi-turn conversational follow-ups.
 */
import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, MessageSquare } from 'lucide-react'
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { ResponseMarkdown } from '@/components/ai-elements/response'
import type { AgentRunState, Citation, SearchConversationTurn } from '@/lib/search-api'
import { cn } from '@/utils/cn'
import { AnswerSkeleton, SourceErrorNotice } from './primitives'
import { Favicon } from './ResultRow'
import { hostname, stripCitationMarkers } from './tabs-meta'
import { openResult } from './open-result'

function Caret() {
  const reduced = useReducedMotion()
  return (
    <motion.span
      aria-hidden
      className="ml-0.5 inline-block h-4 w-[2px] rounded-full bg-accent align-text-bottom dark:bg-accent-light"
      animate={reduced ? undefined : { opacity: [1, 0.15, 1] }}
      transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
    />
  )
}

function ReasoningDisclosure({ reasoning, streaming }: { reasoning: string; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  if (!reasoning) return null
  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md py-1 text-[12.5px] font-medium text-ink-muted transition-colors hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse"
      >
        {streaming && <span className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse dark:bg-accent-light" aria-hidden />}
        {open ? 'Hide reasoning' : 'Show reasoning'}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-2 max-h-56 overflow-y-auto border-l-2 border-surface-200 py-1 pl-4 scrollbar-thin dark:border-surface-700">
              <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
                {reasoning}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CitationsStrip({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null
  return (
    <section className="mt-8" aria-label="Sources">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted dark:text-ink-inverse-muted">
        Sources <span className="ml-1 font-mono tabular-nums">{citations.length}</span>
      </p>
      <ol className="mt-3 flex flex-wrap gap-1.5">
        {citations.map((citation, i) => (
          <li key={citation.url}>
            <button
              type="button"
              onClick={() => openResult(citation.url)}
              title={citation.url}
              className="flex items-center gap-1.5 rounded-md border border-surface-200 py-1 pl-1.5 pr-2.5 text-[12px] text-ink-secondary transition-colors hover:border-surface-300 hover:bg-surface-50 hover:text-ink dark:border-surface-700 dark:text-ink-inverse-secondary dark:hover:border-surface-600 dark:hover:bg-surface-850 dark:hover:text-ink-inverse"
            >
              <span className="font-mono text-[10px] text-ink-muted dark:text-ink-inverse-muted">{i + 1}</span>
              <Favicon url={citation.url} favicon={null} size={14} />
              <span className="max-w-[160px] truncate">
                {citation.title && citation.title !== citation.url ? citation.title : hostname(citation.url)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

export interface AgentAnswerProps {
  run: AgentRunState
  turns?: SearchConversationTurn[]
  activeQuestion?: string | null
  effort?: string | null
  hue?: string
  onRetry?: () => void
  onFollowUp?: (message: string) => void | Promise<void>
  onCancel?: () => void
  followUpLoading?: boolean
}

export function AgentAnswer({
  run,
  turns = [],
  activeQuestion,
  effort,
  onRetry,
  onFollowUp,
  onCancel,
  followUpLoading = false,
}: AgentAnswerProps) {
  const streaming = run.status === 'streaming'
  const idle = run.status === 'idle'
  const showFollowUpComposer = Boolean(onFollowUp && (run.text || run.status === 'done' || turns.length > 0))

  if (run.status === 'error' && !run.text && turns.length === 0) {
    return <div className="max-w-[680px]"><SourceErrorNotice error={run.error!} onRetry={onRetry} /></div>
  }

  const handlePromptSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim()
    if (!text || !onFollowUp) return
    await onFollowUp(text)
  }

  return (
    <article className="max-w-[680px]" aria-busy={streaming}>
      {turns.length > 0 && (
        <div className="mb-10 space-y-10">
          {turns.map((turn, index) => (
            <section
              key={turn.id}
              className="border-b border-surface-200/80 pb-8 dark:border-surface-800"
              aria-label={`Turn ${index + 1}`}
            >
              {index > 0 && turn.question && (
                <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-surface-200/80 bg-surface-50/80 px-4 py-3 dark:border-surface-800 dark:bg-surface-850/70">
                  <MessageSquare className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent dark:text-accent-light" strokeWidth={1.75} />
                  <p className="text-[14.5px] font-medium leading-snug text-ink dark:text-ink-inverse">
                    {turn.question}
                  </p>
                </div>
              )}
              <ReasoningDisclosure reasoning={turn.reasoning} streaming={false} />
              {turn.text && (
                <div className="text-[15.5px] leading-[1.75] text-ink dark:text-ink-inverse [&_img]:my-3 [&_img]:max-h-56 [&_img]:w-auto [&_img]:rounded-lg [&_img]:border [&_img]:border-surface-200/70 [&_img]:bg-white [&_img]:object-contain dark:[&_img]:border-surface-800">
                  <ResponseMarkdown content={stripCitationMarkers(turn.text)} isStreaming={false} />
                </div>
              )}
              {turn.error && <div className="mt-4"><SourceErrorNotice error={turn.error} /></div>}
              <CitationsStrip citations={turn.citations} />
            </section>
          ))}
        </div>
      )}

      {turns.length > 0 && activeQuestion && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-surface-200/80 bg-surface-50/80 px-4 py-3 dark:border-surface-800 dark:bg-surface-850/70">
          <MessageSquare className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent dark:text-accent-light" strokeWidth={1.75} />
          <p className="text-[14.5px] font-medium leading-snug text-ink dark:text-ink-inverse">
            {activeQuestion}
          </p>
        </div>
      )}

      <ReasoningDisclosure reasoning={run.reasoning} streaming={streaming} />

      {idle && !run.text ? (
        <AnswerSkeleton />
      ) : (
        <div className="text-[15.5px] leading-[1.75] text-ink dark:text-ink-inverse [&_img]:my-3 [&_img]:max-h-56 [&_img]:w-auto [&_img]:rounded-lg [&_img]:border [&_img]:border-surface-200/70 [&_img]:bg-white [&_img]:object-contain dark:[&_img]:border-surface-800">
          <ResponseMarkdown content={stripCitationMarkers(run.text)} isStreaming={streaming} />
          {streaming && <Caret />}
        </div>
      )}

      {run.status === 'error' && (run.text || turns.length > 0) && (
        <div className="mt-5">
          <SourceErrorNotice error={run.error!} onRetry={onRetry} />
        </div>
      )}

      <CitationsStrip citations={run.citations} />

      {run.status === 'done' && (
        <p className="mt-8 flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-muted dark:text-ink-inverse-muted">
          <span>{run.model || 'xai/grok-4.7'}</span>
          {effort && (
            <>
              <span aria-hidden>·</span>
              <span>effort: {effort}</span>
            </>
          )}
          {typeof run.usage?.total_tokens === 'number' && (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{run.usage.total_tokens.toLocaleString()} tokens</span>
            </>
          )}
        </p>
      )}

      {showFollowUpComposer && (
        <section className="mt-10 border-t border-surface-200/80 pt-6 dark:border-surface-800" aria-label="Follow-up conversation">
          <PromptInput
            onSubmit={handlePromptSubmit}
            className="rounded-xl border border-surface-200/90 bg-surface-0 shadow-sm transition-colors focus-within:border-surface-300 dark:border-surface-700/90 dark:bg-surface-850 dark:focus-within:border-surface-600"
          >
            <PromptInputBody>
              <PromptInputTextarea
                assist={{ suggest: true, spellcheck: true }}
                placeholder="Ask a follow-up question about these findings…"
                disabled={streaming || followUpLoading}
                className="min-h-12 px-3.5 pt-3 text-[14px] text-ink placeholder:text-ink-muted dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted"
              />
            </PromptInputBody>
            <PromptInputFooter className="px-3 pb-2.5 pt-1">
              <PromptInputTools className="gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-100 px-2 py-0.5 font-mono text-[11px] text-ink-secondary dark:bg-surface-800 dark:text-ink-inverse-secondary">
                  <span>{run.model || 'xai/grok-4.7'}</span>
                  {effort && (
                    <>
                      <span aria-hidden className="text-ink-muted dark:text-ink-inverse-muted">/</span>
                      <span>{effort}</span>
                    </>
                  )}
                </span>
              </PromptInputTools>
              <PromptInputSubmit
                status={streaming || followUpLoading ? 'streaming' : 'ready'}
                onStop={onCancel}
              />
            </PromptInputFooter>
          </PromptInput>
        </section>
      )}
    </article>
  )
}
