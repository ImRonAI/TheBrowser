/**
 * The AI Agent panel — the Perplexity Agent API's streamed answer as the hero.
 * A single quiet reading column: an optional "Process" disclosure for the reasoning
 * trace, the answer itself streaming in with a breathing caret, a filmstrip of cited
 * sources, and a provenance footer (model, tokens) once the run completes.
 */
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Cpu } from 'lucide-react'
import { ResponseMarkdown } from '@/components/ai-elements/response'
import type { AgentRunState } from '@/lib/search-api'
import { cn } from '@/utils/cn'
import { AnswerSkeleton, SourceErrorNotice } from './primitives'
import { domainInitials, hostname, hueWash } from './tabs-meta'
import { openResult } from './open-result'

function Caret({ hue }: { hue: string }) {
  return (
    <motion.span
      className="ml-0.5 inline-block h-4 w-[2px] rounded-full align-text-bottom"
      style={{ backgroundColor: hue }}
      animate={{ opacity: [1, 0.15, 1] }}
      transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
    />
  )
}

export function AgentAnswer({ run, hue, onRetry }: { run: AgentRunState; hue: string; onRetry?: () => void }) {
  const [processOpen, setProcessOpen] = useState(false)
  const streaming = run.status === 'streaming'
  const idle = run.status === 'idle'

  if (run.status === 'error' && !run.text) {
    return <SourceErrorNotice error={run.error!} onRetry={onRetry} />
  }

  return (
    <div className="mx-auto max-w-2xl">
      {run.reasoning && (
        <div className="mb-5">
          <button
            onClick={() => setProcessOpen((open) => !open)}
            className="group flex items-center gap-2 text-xs text-ink-muted transition-colors hover:text-ink-secondary dark:text-ink-inverse-muted dark:hover:text-ink-inverse-secondary"
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: hue, opacity: streaming ? 1 : 0.4 }}
            />
            <span className="uppercase tracking-[0.14em]">Process</span>
            <ChevronDown className={cn('h-3 w-3 transition-transform duration-200', processOpen && 'rotate-180')} />
          </button>
          <AnimatePresence initial={false}>
            {processOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-surface-200/60 bg-surface-50/60 px-4 py-3 scrollbar-thin dark:border-surface-700/50 dark:bg-surface-800/40">
                  <p className="whitespace-pre-wrap text-xs font-light leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
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
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
          <div className="text-[15px] font-light leading-[1.85] text-ink dark:text-ink-inverse">
            <ResponseMarkdown content={run.text} isStreaming={streaming} />
            {streaming && <Caret hue={hue} />}
          </div>
        </motion.div>
      )}

      {run.status === 'error' && run.text && (
        <div className="mt-5">
          <SourceErrorNotice error={run.error!} onRetry={onRetry} />
        </div>
      )}

      {run.citations.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-3">
            <span className="text-label uppercase text-ink-muted dark:text-ink-inverse-muted">Sources</span>
            <div className="h-px flex-1 bg-surface-200/70 dark:bg-surface-700/60" />
            <span className="font-mono text-[10px] text-ink-muted dark:text-ink-inverse-muted">{run.citations.length}</span>
          </div>
          <div className="scrollbar-none -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
            {run.citations.map((citation) => (
              <motion.button
                key={citation.url}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={() => openResult(citation.url)}
                className="group flex flex-shrink-0 items-center gap-2 rounded-full border border-surface-200/70 bg-surface-0/70 py-1.5 pl-1.5 pr-3 backdrop-blur-sm transition-all hover:border-surface-300 dark:border-surface-700/60 dark:bg-surface-800/60 dark:hover:border-surface-600"
              >
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-semibold"
                  style={{ backgroundColor: hueWash(hue, 0.14), color: hue }}
                >
                  {domainInitials(citation.url)}
                </span>
                <span className="max-w-[140px] truncate text-xs font-light text-ink-secondary group-hover:text-ink dark:text-ink-inverse-secondary dark:group-hover:text-ink-inverse">
                  {citation.title && citation.title !== citation.url ? citation.title : hostname(citation.url)}
                </span>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {run.status === 'done' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-8 flex items-center gap-2 text-[11px] text-ink-muted/80 dark:text-ink-inverse-muted/80"
        >
          <Cpu className="h-3 w-3" />
          <span className="font-mono">{run.model}</span>
          {typeof run.usage?.total_tokens === 'number' && (
            <>
              <span aria-hidden>·</span>
              <span className="font-mono tabular-nums">{run.usage.total_tokens.toLocaleString()} tokens</span>
            </>
          )}
        </motion.div>
      )}
    </div>
  )
}
