/**
 * The Answer panel — the Perplexity Agent API's streamed answer as a single
 * reading column: an optional "Show reasoning" disclosure, the answer itself with a
 * breathing caret while it streams, numbered source chips, and a provenance footer
 * (model, tokens) once the run completes.
 */
import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { ResponseMarkdown } from '@/components/ai-elements/response'
import type { AgentRunState } from '@/lib/search-api'
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

export function AgentAnswer({ run, onRetry }: { run: AgentRunState; hue?: string; onRetry?: () => void }) {
  const [processOpen, setProcessOpen] = useState(false)
  const streaming = run.status === 'streaming'
  const idle = run.status === 'idle'

  if (run.status === 'error' && !run.text) {
    return <div className="max-w-[680px]"><SourceErrorNotice error={run.error!} onRetry={onRetry} /></div>
  }

  return (
    <article className="max-w-[680px]" aria-busy={streaming}>
      {run.reasoning && (
        <div className="mb-6">
          <button
            type="button"
            onClick={() => setProcessOpen((open) => !open)}
            aria-expanded={processOpen}
            className="flex items-center gap-1.5 rounded-md py-1 text-[12.5px] font-medium text-ink-muted transition-colors hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse"
          >
            {streaming && <span className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse dark:bg-accent-light" aria-hidden />}
            {processOpen ? 'Hide reasoning' : 'Show reasoning'}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', processOpen && 'rotate-180')} />
          </button>
          <AnimatePresence initial={false}>
            {processOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-2 max-h-56 overflow-y-auto border-l-2 border-surface-200 py-1 pl-4 scrollbar-thin dark:border-surface-700">
                  <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
                    {run.reasoning}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {idle && !run.text ? (
        <AnswerSkeleton />
      ) : (
        <div className="text-[15.5px] leading-[1.75] text-ink dark:text-ink-inverse [&_img]:my-3 [&_img]:max-h-56 [&_img]:w-auto [&_img]:rounded-lg [&_img]:border [&_img]:border-surface-200/70 [&_img]:bg-white [&_img]:object-contain dark:[&_img]:border-surface-800">
          <ResponseMarkdown content={stripCitationMarkers(run.text)} isStreaming={streaming} />
          {streaming && <Caret />}
        </div>
      )}

      {run.status === 'error' && run.text && (
        <div className="mt-5">
          <SourceErrorNotice error={run.error!} onRetry={onRetry} />
        </div>
      )}

      {run.citations.length > 0 && (
        <section className="mt-10" aria-label="Sources">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted dark:text-ink-inverse-muted">
            Sources <span className="ml-1 font-mono tabular-nums">{run.citations.length}</span>
          </p>
          <ol className="mt-3 flex flex-wrap gap-1.5">
            {run.citations.map((citation, i) => (
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
      )}

      {run.status === 'done' && (
        <p className="mt-8 flex items-center gap-2 font-mono text-[11px] text-ink-muted dark:text-ink-inverse-muted">
          <span>{run.model}</span>
          {typeof run.usage?.total_tokens === 'number' && (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{run.usage.total_tokens.toLocaleString()} tokens</span>
            </>
          )}
        </p>
      )}
    </article>
  )
}
