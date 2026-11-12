/**
 * The Answer panel — the Strands Harness Search Agent's (`xai/grok-4.7`) streamed
 * answer as a single reading column. Every answer is a card with a 2px volt rule and a
 * mono "REN" label: an optional "Show reasoning" disclosure, the answer itself with a caret
 * while it streams (a skeleton and shimmer "Searching" in the label until the first words
 * arrive, then "Writing"), numbered mono source chips and a
 * provenance footer (model, effort, tokens). Follow-up questions are echoed in the display
 * face above their answers, and a native `PromptInput` composer carries the conversation.
 */
import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, CornerDownRight } from 'lucide-react'
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
import { RenMark } from '@/components/brand'
import type { AgentRunState, Citation, SearchConversationTurn } from '@/lib/search-api'
import { cn } from '@/utils/cn'
import { AnswerSkeleton, LiveText, SourceErrorNotice } from './primitives'
import { Favicon } from './ResultRow'
import { hostname, stripCitationMarkers } from './tabs-meta'
import { openResult } from './open-result'

/** Reading styles for the streamed Markdown (paragraphs, headings, list markers, images). */
const PROSE = [
  'text-[15.5px] leading-[1.75] text-ink dark:text-ink-inverse',
  '[&_p]:text-[15.5px] [&_p]:leading-[1.75] [&_p]:text-ink dark:[&_p]:text-ink-inverse',
  '[&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_h4]:text-base',
  'marker:text-blurple-600 dark:marker:text-blurple-400',
  '[&_img]:my-3 [&_img]:max-h-56 [&_img]:w-auto [&_img]:rounded-lg [&_img]:border [&_img]:border-surface-200 [&_img]:bg-surface-0 [&_img]:object-contain dark:[&_img]:border-surface-800',
].join(' ')

function Caret() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-4 w-[2px] rounded-full bg-blurple-600 align-text-bottom dark:bg-blurple-400"
    />
  )
}

/** One answer: hairline card, 2px volt rule on the left, mono "REN" label. */
function AnswerCard({ streaming, label = 'Writing', children }: { streaming: boolean; label?: string; children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-surface-200 bg-surface-0 px-5 py-5 dark:border-surface-800 dark:bg-surface-900 sm:px-6">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-blurple-600 dark:bg-blurple-400" />
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-volt">
          <RenMark className="h-4 w-4" />
          Ren
        </span>
        {streaming && <LiveText className="font-mono text-[11px]">{label}</LiveText>}
      </div>
      {children}
    </div>
  )
}

/** A follow-up question, echoed in the display face above its answer. */
function FollowUpQuestion({ question }: { question: string }) {
  return (
    <div className="mb-4 flex items-start gap-2.5">
      <CornerDownRight className="mt-1 h-4 w-4 flex-shrink-0 text-volt" strokeWidth={2} aria-hidden />
      <p className="font-display text-xl font-bold leading-snug tracking-[-0.02em] text-ink [overflow-wrap:anywhere] dark:text-ink-inverse">
        {question}
      </p>
    </div>
  )
}

function ReasoningDisclosure({ reasoning, streaming }: { reasoning: string; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  const reduced = useReducedMotion()
  if (!reasoning) return null
  const label = open ? 'Hide reasoning' : 'Show reasoning'
  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="-ml-2 inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-850 dark:hover:text-ink-inverse"
      >
        {streaming ? <LiveText tone="muted">{label}</LiveText> : label}
        <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', open && 'rotate-180')} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-2 max-h-56 overflow-y-auto border-l-2 border-surface-200 py-1 pl-4 scrollbar-thin dark:border-surface-700">
              <p className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
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
    <section className="mt-6 border-t border-surface-200 pt-4 dark:border-surface-800" aria-label="Sources">
      <p className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted">
        Sources <span className="tabular-nums">{citations.length}</span>
      </p>
      <ol className="mt-3 flex flex-wrap gap-1.5">
        {citations.map((citation, i) => (
          <li key={citation.url}>
            <button
              type="button"
              onClick={() => openResult(citation.url)}
              title={citation.url}
              className="group inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-full border border-surface-200 bg-surface-0 pl-1 pr-2.5 text-[12px] text-ink-secondary transition-colors duration-150 hover:border-surface-300 hover:text-ink dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse-secondary dark:hover:border-surface-700 dark:hover:text-ink-inverse"
            >
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-surface-100 px-1 font-mono text-[10px] font-semibold tabular-nums text-ink-secondary transition-colors duration-150 group-hover:bg-blurple-600 group-hover:text-white dark:bg-surface-850 dark:text-ink-inverse-secondary dark:group-hover:bg-blurple-400 dark:group-hover:text-ink">
                {i + 1}
              </span>
              <Favicon url={citation.url} favicon={null} size={14} />
              <span className="truncate">
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
    return <div className="max-w-[720px]"><SourceErrorNotice error={run.error!} onRetry={onRetry} /></div>
  }

  const handlePromptSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim()
    if (!text || !onFollowUp) return
    await onFollowUp(text)
  }

  return (
    <article className="max-w-[720px]" aria-busy={streaming}>
      {turns.length > 0 && (
        <div className="mb-8 space-y-8">
          {turns.map((turn, index) => (
            <section key={turn.id} aria-label={`Turn ${index + 1}`}>
              {index > 0 && turn.question && <FollowUpQuestion question={turn.question} />}
              <AnswerCard streaming={false}>
                <ReasoningDisclosure reasoning={turn.reasoning} streaming={false} />
                {turn.text && (
                  <div className={PROSE}>
                    <ResponseMarkdown content={stripCitationMarkers(turn.text)} isStreaming={false} />
                  </div>
                )}
                {turn.error && <div className="mt-4"><SourceErrorNotice error={turn.error} /></div>}
                <CitationsStrip citations={turn.citations} />
              </AnswerCard>
            </section>
          ))}
        </div>
      )}

      {turns.length > 0 && activeQuestion && <FollowUpQuestion question={activeQuestion} />}

      <AnswerCard streaming={streaming} label={run.text ? 'Writing' : 'Searching'}>
        <ReasoningDisclosure reasoning={run.reasoning} streaming={streaming} />

        {(idle || streaming) && !run.text ? (
          <AnswerSkeleton />
        ) : (
          <div className={PROSE}>
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
          <p className="mt-5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-muted dark:text-ink-inverse-muted">
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
      </AnswerCard>

      {showFollowUpComposer && (
        <section className="mt-8" aria-label="Follow-up conversation">
          <PromptInput
            onSubmit={handlePromptSubmit}
            className="ron-field rounded-xl border border-surface-200 bg-surface-0 transition-colors duration-150 focus-within:border-blurple-500 dark:border-surface-800 dark:bg-surface-900 dark:focus-within:border-blurple-400 [&>[data-slot=input-group]]:rounded-xl [&>[data-slot=input-group]]:border-0 [&>[data-slot=input-group]]:shadow-none dark:[&>[data-slot=input-group]]:bg-transparent"
          >
            <PromptInputBody>
              <PromptInputTextarea
                assist={{ suggest: true, spellcheck: true }}
                placeholder="Ask a follow-up about these findings…"
                disabled={streaming || followUpLoading}
                className="min-h-12 px-4 pt-3.5 text-[14px] text-ink placeholder:text-ink-muted dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted"
              />
            </PromptInputBody>
            <PromptInputFooter className="px-3 pb-2.5 pt-1">
              <PromptInputTools className="gap-2">
                <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-100 px-2.5 font-mono text-[11px] text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary">
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
                className="rounded-lg"
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
