/**
 * The Web panel — "Brief". Results are ranked by provenance instead of a flat list:
 * CONSENSUS first (both the Perplexity Agent API and Brave surfaced it), then Agent
 * picks (sources the answer was built from), then the breadth of Brave. Each result
 * is a truncated two-line row. On wide screens a sticky rail summarises the agent's
 * answer, its top sources and the provenance legend, so a glance answers the query
 * and the list is only for going deeper.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { mergedWebResults, type SearchRunState } from '@/lib/search-api'
import { EmptyState, GroupLabel, RowSkeleton, ShowMore, SourceErrorNotice, Bar } from './primitives'
import { ConsensusHero, Favicon, ResultCard } from './ResultRow'
import { hostname, plainText } from './tabs-meta'
import { openResult } from './open-result'

const BRAVE_PAGE = 8
const RAIL_MIN_WIDTH = 940

function BriefRail({ state, onOpenAnswer }: { state: SearchRunState; onOpenAnswer?: () => void }) {
  const agent = state.agent
  const summary = plainText(agent.text)
  const sources = agent.citations.slice(0, 5)
  return (
    <aside aria-label="At a glance" className="sticky top-16 space-y-6">
      <section className="rounded-xl border border-surface-200/80 bg-surface-50/70 p-4 dark:border-surface-800 dark:bg-surface-850">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted dark:text-ink-inverse-muted">At a glance</span>
          {agent.status === 'streaming' && <span className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse dark:bg-accent-light" aria-label="Writing" />}
        </div>
        {summary ? (
          <p className="mt-2 line-clamp-5 text-[13.5px] leading-relaxed text-ink dark:text-ink-inverse">{summary}</p>
        ) : agent.status === 'error' ? (
          <p className="mt-2 text-[13px] text-ink-muted dark:text-ink-inverse-muted">The answer couldn’t be generated.</p>
        ) : (
          <div className="mt-3 space-y-2"><Bar className="h-3 w-full" /><Bar className="h-3 w-11/12" /><Bar className="h-3 w-3/4" /></div>
        )}
        {onOpenAnswer && (
          <button
            type="button"
            onClick={onOpenAnswer}
            className="group mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline dark:text-accent-light"
          >
            Read full answer <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </button>
        )}
      </section>

      {sources.length > 0 && (
        <section>
          <p className="px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted dark:text-ink-inverse-muted">Cited</p>
          <ol className="mt-2 space-y-px">
            {sources.map((citation, i) => (
              <li key={citation.url}>
                <button
                  type="button"
                  onClick={() => openResult(citation.url)}
                  title={citation.url}
                  className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-[12.5px] text-ink-secondary transition-colors hover:bg-surface-50 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-850 dark:hover:text-ink-inverse"
                >
                  <span className="w-3 flex-shrink-0 text-right font-mono text-[10px] text-ink-muted dark:text-ink-inverse-muted">{i + 1}</span>
                  <Favicon url={citation.url} favicon={null} size={14} />
                  <span className="truncate">{citation.title && citation.title !== citation.url ? citation.title : hostname(citation.url)}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="space-y-1.5 px-1">
        <p className="flex items-center gap-2 text-[12px] text-ink-muted dark:text-ink-inverse-muted">
          <span className="inline-flex gap-[3px]"><span className="h-[5px] w-[5px] rounded-full bg-accent dark:bg-accent-light" /><span className="h-[5px] w-[5px] rounded-full bg-accent/45 dark:bg-accent-light/45" /></span>
          Consensus — the agent and Brave agree
        </p>
        <p className="flex items-center gap-2 text-[12px] text-ink-muted dark:text-ink-inverse-muted">
          <span className="ml-px h-[5px] w-[5px] rounded-full bg-accent dark:bg-accent-light" />
          <span className="ml-[3px]">Agent pick — used in the answer</span>
        </p>
      </section>
    </aside>
  )
}

export function WebResults({ state, onRetry, onOpenAnswer }: { state: SearchRunState; hue?: string; onRetry?: () => void; onOpenAnswer?: () => void }) {
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
    <div className={railVisible ? 'grid grid-cols-[minmax(0,1fr)_280px] gap-10' : 'grid grid-cols-1'} ref={measure}>
      <div className="min-w-0 max-w-[680px]">
        {loading && <RowSkeleton rows={6} />}
        {section?.status === 'error' && <div className="mb-4"><SourceErrorNotice error={{ source: 'brave', ...section.error! }} onRetry={onRetry} /></div>}
        {state.agent.status === 'error' && state.agent.error && !hasAgentSources && (
          <div className="mb-4"><SourceErrorNotice error={state.agent.error} onRetry={onRetry} /></div>
        )}

        {results.length === 0 && section?.status === 'ok' && (
          <EmptyState title="No web results" hint="Try rephrasing the query or a deeper search level" />
        )}

        {consensus.length > 0 && (
          <section aria-label="Consensus" className="mt-7 first:mt-0">
            <GroupLabel label="Consensus" count={consensus.length} />
            <ul>
              <ConsensusHero result={consensus[0]} label="Consensus" />
              {consensus.slice(1).map((result, i) => <ResultCard key={result.url} result={result} index={i + 1} />)}
            </ul>
          </section>
        )}

        {agentOnly.length > 0 && (
          <section aria-label="Agent picks" className="mt-7 first:mt-0">
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
          <section aria-label="Across the web" className="mt-7 first:mt-0">
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
