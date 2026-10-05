/**
 * The Web panel — the signature view. Sources are ranked by provenance instead of a
 * single flat list: CONSENSUS first (domains both the Perplexity Agent API and Brave
 * surfaced — the highest-signal results on the page), then Agent picks (the sources
 * the answer was actually built from), then the full breadth of Brave at maximum
 * count. Every result is its own card with markdown-rendered snippets and a
 * provenance mark.
 */
import { mergedWebResults, type SearchRunState } from '@/lib/search-api'
import { EmptyState, RowSkeleton, SourceErrorNotice } from './primitives'
import { ConsensusHero, ResultCard } from './ResultRow'
import { hueWash } from './tabs-meta'

function GroupLabel({ label, count, hue }: { label: string; count: number; hue: string }) {
  return (
    <div className="mb-3 mt-8 flex items-center gap-3 first:mt-0">
      <span className="h-1 w-1 rounded-full" style={{ backgroundColor: hue }} />
      <span className="text-label uppercase text-ink-muted dark:text-ink-inverse-muted">{label}</span>
      <span className="font-mono text-[10px] text-ink-muted/70 dark:text-ink-inverse-muted/70">{count}</span>
      <div className="h-px flex-1" style={{ backgroundColor: hueWash(hue, 0.18) }} />
    </div>
  )
}

export function WebResults({ state, hue, onRetry }: { state: SearchRunState; hue: string; onRetry?: () => void }) {
  const section = state.sections.web
  const hasAgentSources = state.agent.sources.length > 0

  if (!section && !hasAgentSources) return <RowSkeleton rows={5} />

  const results = mergedWebResults(state)
  const consensus = results.filter((r) => r.origin === 'both')
  const agentOnly = results.filter((r) => r.origin === 'agent')
  const braveOnly = results.filter((r) => r.origin === 'brave')

  return (
    <div className="mx-auto max-w-2xl">
      {section?.status === 'error' && <div className="mb-4"><SourceErrorNotice error={{ source: 'brave', ...section.error! }} onRetry={onRetry} /></div>}
      {state.agent.status === 'error' && state.agent.error && !hasAgentSources && (
        <div className="mb-4"><SourceErrorNotice error={state.agent.error} onRetry={onRetry} /></div>
      )}

      {results.length === 0 && section?.status === 'ok' && (
        <EmptyState title="No web results" hint="Try rephrasing the query or a deeper search level" />
      )}

      {consensus.length > 0 && (
        <section>
          <GroupLabel label="Consensus" count={consensus.length} hue={hue} />
          <ConsensusHero result={consensus[0]} hue={hue} />
          {consensus.length > 1 && (
            <div className="mt-3 space-y-3">
              {consensus.slice(1).map((result, i) => <ResultCard key={result.url} result={result} index={i + 1} hue={hue} />)}
            </div>
          )}
        </section>
      )}

      {/* With no overlap, the agent's own top source still gets the hero treatment. */}
      {consensus.length === 0 && agentOnly.length > 0 && (
        <section>
          <GroupLabel label="Agent picks" count={agentOnly.length} hue={hue} />
          <ConsensusHero result={agentOnly[0]} hue={hue} />
          {agentOnly.length > 1 && (
            <div className="mt-3 space-y-3">
              {agentOnly.slice(1).map((result, i) => <ResultCard key={result.url} result={result} index={i + 1} hue={hue} />)}
            </div>
          )}
        </section>
      )}

      {consensus.length > 0 && agentOnly.length > 0 && (
        <section>
          <GroupLabel label="Agent picks" count={agentOnly.length} hue={hue} />
          <div className="space-y-3">
            {agentOnly.map((result, i) => <ResultCard key={result.url} result={result} index={i} hue={hue} />)}
          </div>
        </section>
      )}

      {braveOnly.length > 0 && (
        <section>
          <GroupLabel label="Across the web" count={braveOnly.length} hue={hue} />
          <div className="space-y-3">
            {braveOnly.map((result, i) => <ResultCard key={result.url} result={result} index={i} hue={hue} />)}
          </div>
        </section>
      )}
    </div>
  )
}
