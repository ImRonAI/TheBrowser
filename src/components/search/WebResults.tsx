/**
 * The Web panel — "Brief". Results are ranked by provenance instead of a flat list:
 * CONSENSUS first (both the Perplexity Agent API and Brave surfaced it), then Agent
 * picks (sources the answer was built from), then the breadth of Brave. Each result
 * is a truncated two-line row. On wide screens a sticky rail summarises the agent's
 * answer (a volt-rule Ren card), its top sources and the provenance legend, so a glance
 * answers the query and the list is only for going deeper.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { RenMark } from '@/components/brand'
import { mergedWebResults, type SearchRunState } from '@/lib/search-api'
import { EmptyState, GroupLabel, LiveText, RowSkeleton, ShowMore, SourceErrorNotice, Bar } from './primitives'
import { ConsensusHero, Favicon, ResultCard } from './ResultRow'
import { hostname, plainText } from './tabs-meta'
import { openResult } from './open-result'

const BRAVE_PAGE = 8
const RAIL_MIN_WIDTH = 940

const microLabel = 'font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted'

function BriefRail({ state, onOpenAnswer }: { state: SearchRunState; onOpenAnswer?: () => void }) {
  const agent = state.agent
  const summary = plainText(agent.text)
  const sources = agent.citations.slice(0, 5)
  return (
    <aside aria-label="At a glance" className="sticky top-16 space-y-6">
      <section className="relative overflow-hidden rounded-xl border border-surface-200 bg-surface-0 py-4 pl-5 pr-4 dark:border-surface-800 dark:bg-surface-900">
        <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-blurple-600 dark:bg-blurple-400" />
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-volt">
            <RenMark className="h-4 w-4" />
            At a glance
          </span>
          {agent.status === 'streaming' && (
            <LiveText className="font-mono text-[11px]">{agent.text ? 'Writing' : 'Searching'}</LiveText>
          )}
        </div>
        {summary ? (
          <p className="mt-3 line-clamp-5 text-[13.5px] leading-relaxed text-ink dark:text-ink-inverse">{summary}</p>
        ) : agent.status === 'error' ? (
          <p className="mt-3 text-[13px] text-ink-secondary dark:text-ink-inverse-secondary">The answer couldn’t be generated.</p>
        ) : (
          <div className="mt-4 space-y-2"><Bar className="h-3 w-full" /><Bar className="h-3 w-11/12" /><Bar className="h-3 w-3/4" /></div>
        )}
        {onOpenAnswer && (
          <button
            type="button"
            onClick={onOpenAnswer}
            className="group -ml-1 mt-3 inline-flex h-7 items-center gap-1 rounded-md px-1 text-[12.5px] font-semibold text-volt decoration-2 underline-offset-4 hover:underline"
          >
            Read full answer
            <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
          </button>
        )}
      </section>

      {sources.length > 0 && (
        <section>
          <p className={`px-1.5 ${microLabel}`}>Cited</p>
          <ol className="mt-2 space-y-px">
            {sources.map((citation, i) => (
              <li key={citation.url}>
                <button
                  type="button"
                  onClick={() => openResult(citation.url)}
                  title={citation.url}
                  className="group flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-[12.5px] text-ink-secondary transition-colors duration-150 hover:bg-surface-100 hover:text-ink focus-visible:ring-offset-0 dark:text-ink-inverse-secondary dark:hover:bg-surface-850 dark:hover:text-ink-inverse"
                >
                  <span className="w-4 flex-shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-muted group-hover:text-volt dark:text-ink-inverse-muted">{i + 1}</span>
                  <Favicon url={citation.url} favicon={null} size={14} />
                  <span className="truncate">{citation.title && citation.title !== citation.url ? citation.title : hostname(citation.url)}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="space-y-2 px-1.5">
        <p className="flex items-center gap-2 text-[12px] text-ink-muted dark:text-ink-inverse-muted">
          <span className="inline-flex w-4 flex-shrink-0 justify-end gap-[3px]">
            <span className="h-[5px] w-[5px] rounded-full bg-blurple-600 dark:bg-blurple-400" />
            <span className="h-[5px] w-[5px] rounded-full bg-blurple-600/40 dark:bg-blurple-400/40" />
          </span>
          Consensus — the agent and Brave agree
        </p>
        <p className="flex items-center gap-2 text-[12px] text-ink-muted dark:text-ink-inverse-muted">
          <span className="inline-flex w-4 flex-shrink-0 justify-end pr-2">
            <span className="h-[5px] w-[5px] rounded-full bg-blurple-600 dark:bg-blurple-400" />
          </span>
          Agent pick — used in the answer
        </p>
      </section>
    </aside>
  )
}

export function WebResults({ state, onRetry, onOpenAnswer, deeper }: {
  state: SearchRunState
  hue?: string
  onRetry?: () => void
  onOpenAnswer?: () => void
  /** Re-run the query one search level deeper; null at the deepest level. */
  deeper?: { label: string; onClick: () => void } | null
}) {
  const [braveShown, setBraveShown] = useState(BRAVE_PAGE)
  // The rail needs room beside a full-measure column; the content area narrows when the
  // sidebar or agent panel opens, so measure the panel itself rather than the viewport.
  const [railVisible, setRailVisible] = useState(false)
  const observer = useRef<ResizeObserver | null>(null)
  const measure = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect()
    if (!node) return
    observer.current = new ResizeObserver(([entry]) => setRailVisible(entry.contentRect.width >= RAIL_MIN_WIDTH))
    observer.current.observe(node)
  }, [])
  useEffect(() => () => observer.current?.disconnect(), [])
  const section = state.sections.web
  const hasAgentSources = state.agent.sources.length > 0

  const results = mergedWebResults(state)
  const consensus = results.filter((r) => r.origin === 'both')
  const agentOnly = results.filter((r) => r.origin === 'agent')
  const braveOnly = results.filter((r) => r.origin === 'brave')
  const loading = !section && !hasAgentSources

  return (
    <div className={railVisible ? 'grid grid-cols-[minmax(0,1fr)_288px] gap-12' : 'grid grid-cols-1'} ref={measure}>
      <div className="min-w-0 max-w-[680px]">
        {loading && <RowSkeleton rows={6} />}
        {section?.status === 'error' && <div className="mb-4"><SourceErrorNotice error={{ source: 'brave', ...section.error! }} onRetry={onRetry} /></div>}
        {state.agent.status === 'error' && state.agent.error && !hasAgentSources && (
          <div className="mb-4"><SourceErrorNotice error={state.agent.error} onRetry={onRetry} /></div>
        )}

        {results.length === 0 && section?.status === 'ok' && (
          <EmptyState
            title="No web results"
            hint={deeper ? 'Nothing matched. Rephrase it, or go a level deeper.' : 'Nothing matched. Try rephrasing it.'}
            action={deeper ?? undefined}
          />
        )}

        {consensus.length > 0 && (
          <section aria-label="Consensus" className="mt-8 first:mt-0">
            <GroupLabel label="Consensus" count={consensus.length} />
            <ul>
              <ConsensusHero result={consensus[0]} label="Consensus" />
              {consensus.slice(1).map((result, i) => <ResultCard key={result.url} result={result} index={i + 1} />)}
            </ul>
          </section>
        )}

        {agentOnly.length > 0 && (
          <section aria-label="Agent picks" className="mt-8 first:mt-0">
            <GroupLabel label="Agent picks" count={agentOnly.length} />
            <ul>
              {/* With no overlap, the agent's own top source gets the lead treatment. */}
              {consensus.length === 0
                ? <ConsensusHero result={agentOnly[0]} label="Top pick" />
                : <ResultCard result={agentOnly[0]} index={0} />}
              {agentOnly.slice(1).map((result, i) => <ResultCard key={result.url} result={result} index={i + 1} />)}
            </ul>
          </section>
        )}

        {braveOnly.length > 0 && (
          <section aria-label="Across the web" className="mt-8 first:mt-0">
            <GroupLabel label="Across the web" count={braveOnly.length} />
            <ul>
              {braveOnly.slice(0, braveShown).map((result, i) => <ResultCard key={result.url} result={result} index={i} />)}
            </ul>
            <ShowMore hidden={braveOnly.length - braveShown} onClick={() => setBraveShown((n) => n + BRAVE_PAGE * 2)} />
          </section>
        )}
      </div>

      {railVisible && (
        <div>
          <BriefRail state={state} onOpenAnswer={onOpenAnswer} />
        </div>
      )}
    </div>
  )
}
