/**
 * SearchLayout
 *
 * Full search results layout component.
 * Displays search agent response plus grouped results across multiple content types.
 */

import type { UIMessage } from '@ai-sdk/react'
import type { SearchResponse, UniversalResult, SearchFilters, ResultType } from '@/pages/types/search'
import { ResultTypeLabels } from '@/pages/types/search'
import { UniversalResultCard } from '@/components/search-results/UniversalResultCard'
import { ChainOfThought } from '@/components/ai-elements/chain-of-thought'
import { ChainOfThoughtHeader } from '@/components/ai-elements/chain-of-thought'
import { ChainOfThoughtContent } from '@/components/ai-elements/chain-of-thought'
import { ChainOfThoughtMessage } from '@/components/ai-elements/chain-of-thought-message'
import { ThinkingIndicator } from '@/components/ai-elements/loader'
import type { Citation } from '@/components/ai-elements/response-with-citations'
import { Message, MessageAvatar, MessageContent } from '@/components/ai-elements/message'

interface SearchLayoutProps {
  searchResponse: SearchResponse | null
  searchQuery: string
  isLoading?: boolean
  error?: string | null
  agentState?: SearchAgentState
  viewMode?: 'grid' | 'list'
  filters?: SearchFilters
  onResultClick?: (result: UniversalResult) => void
  onFilterChange?: (filters: SearchFilters) => void
  onExpandPreview?: (result: UniversalResult) => void
  onChatClick?: (result: UniversalResult) => void
}

type MessagePart = UIMessage['parts'][number]

interface SearchAgentState {
  parts: MessagePart[]
  citations: Citation[]
  isStreaming: boolean
  error?: string | null
}

export function SearchLayout({
  searchResponse,
  searchQuery,
  isLoading,
  error,
  agentState,
  onResultClick,
  onChatClick,
}: SearchLayoutProps) {
  const { results = [], sonarReasoning, totalCount } = searchResponse || {}
  const hasResults = results.length > 0
  const groupedResults = results.reduce<Record<ResultType, UniversalResult[]>>((acc, result) => {
    acc[result.type] = acc[result.type] || []
    acc[result.type].push(result)
    return acc
  }, {} as Record<ResultType, UniversalResult[]>)
  const agentHasParts = Boolean(agentState && agentState.parts.length > 0)
  const agentIsStreaming = Boolean(agentState?.isStreaming)

  return (
    <div className="space-y-6">
      <ChainOfThought defaultOpen={agentIsStreaming || agentHasParts} className="shadow-none">
        <ChainOfThoughtHeader>
          <span className="flex items-center gap-2">
            <span>Search agent response</span>
            {agentIsStreaming && (
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                Streaming
              </span>
            )}
          </span>
        </ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          {agentHasParts ? (
            <div className="p-4">
              <Message from="assistant">
                <MessageAvatar fallback="R" />
                <MessageContent variant="flat">
                  <ChainOfThoughtMessage
                    parts={agentState?.parts || []}
                    citations={agentState?.citations || []}
                    isStreaming={agentIsStreaming}
                    messageId={`search-results-${searchQuery.replace(/\s+/g, '-').toLowerCase()}`}
                  />
                </MessageContent>
              </Message>
            </div>
          ) : (
            <div className="p-6">
              <ThinkingIndicator text={agentIsStreaming ? 'Searching...' : 'No response yet'} />
            </div>
          )}
          {agentState?.error && (
            <div className="px-6 pb-6 text-sm text-red-500">
              {agentState.error}
            </div>
          )}
        </ChainOfThoughtContent>
      </ChainOfThought>

      <div className="rounded-2xl border border-surface-200/60 bg-surface-0/80 p-6 shadow-sm dark:border-surface-700/60 dark:bg-surface-900/80">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-ink dark:text-ink-inverse">
            {totalCount || results.length} results for "{searchQuery}"
          </h2>
          {sonarReasoning?.summary && (
            <p className="text-sm text-ink-muted dark:text-ink-inverse-muted">
              {sonarReasoning.summary}
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-6 py-4 text-sm text-red-100">
          <div className="font-medium">Error loading results</div>
          <div className="mt-1 text-red-100/80">{error}</div>
        </div>
      )}

      {isLoading ? (
        <div className="rounded-2xl border border-surface-200/60 bg-surface-0/80 p-8 text-center text-sm text-ink-muted dark:border-surface-700/60 dark:bg-surface-900/80 dark:text-ink-inverse-muted">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-surface-300 border-t-transparent dark:border-surface-600" />
          Gathering results...
        </div>
      ) : hasResults ? (
        <div className="space-y-6">
          {Object.entries(groupedResults).map(([type, items]) => (
            <section key={type} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink dark:text-ink-inverse">
                  {ResultTypeLabels[type as ResultType]}
                </h3>
                <span className="text-xs text-ink-muted dark:text-ink-inverse-muted">
                  {items.length} item{items.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {items.map((result) => (
                  <UniversalResultCard
                    key={result.id}
                    result={result}
                    searchQuery={searchQuery}
                    onClick={onResultClick ? () => onResultClick(result) : undefined}
                    onChatClick={onChatClick}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-surface-200/60 bg-surface-0/80 p-8 text-center text-sm text-ink-muted dark:border-surface-700/60 dark:bg-surface-900/80 dark:text-ink-inverse-muted">
          No results to display yet.
        </div>
      )}

      {sonarReasoning?.relatedQueries && sonarReasoning.relatedQueries.length > 0 && (
        <div className="rounded-2xl border border-surface-200/60 bg-surface-0/80 p-6 dark:border-surface-700/60 dark:bg-surface-900/80">
          <h3 className="text-sm font-semibold text-ink dark:text-ink-inverse">Related searches</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {sonarReasoning.relatedQueries.map((query, i) => (
              <button
                key={i}
                className="rounded-full border border-surface-200/70 bg-surface-50 px-3 py-1 text-xs text-ink-muted transition hover:border-surface-300 hover:text-ink dark:border-surface-700/70 dark:bg-surface-800 dark:text-ink-inverse-muted"
              >
                {query}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Alias for premium naming convention
export const PremiumSearchLayout = SearchLayout

export default SearchLayout