/**
 * Search Results Page - Premium Redesign
 *
 * A luxurious, dark-themed search results experience inspired by 
 * v0.dev, Bolt.new, and Lovable.dev vibe coding platforms.
 * 
 * Features:
 * - Chain of Thought UI with reasoning visualization
 * - Inline citations and premium sources display
 * - Dynamic result cards with selection system
 * - Browser automation preview panel
 * - Seamless chat integration
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { useChat, type UIMessage } from '@ai-sdk/react'
import { DefaultChatTransport, isDataUIPart, isToolUIPart, type TextUIPart } from 'ai'
import { PremiumSearchLayout } from '@/components/search-results/SearchLayout'
import { useSearchStore } from '@/stores/searchStore'
import type {
  SearchResponse,
  UniversalResult,
} from '@/pages/types/search'
import type { Citation } from '@/components/ai-elements/response-with-citations'
import { AnimatePresence, motion } from 'framer-motion'
import { SearchChat } from '@/components/search-results/SearchChat'
import { cn } from '@/utils/cn'
import { PreviewPanel } from '@/components/ai-elements/preview-panel'
import { usePreviewStore } from '@/stores/previewStore'

// Icons (lucide)
import { 
  ArrowLeft, 
  MessageSquare, 
  LayoutGrid,
  Sparkles,
  RefreshCw
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

type MessagePart = UIMessage['parts'][number]

type ToolExecution = {
  id: string
  name: string
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
  input?: unknown
  output?: unknown
  errorText?: string
}

type UsageData = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
}

type SourceData = {
  id: string
  url: string
  title: string
  snippet: string
  domain?: string
  type?: string
  favicon?: string
}

function buildSearchAgentParts({
  answerText,
  reasoningText,
  toolExecutions,
  isStreaming,
  usage,
}: {
  answerText: string
  reasoningText: string
  toolExecutions: ToolExecution[]
  isStreaming: boolean
  usage: UsageData | null
}): MessagePart[] {
  const parts: MessagePart[] = []

  if (usage) {
    parts.push({
      type: 'data-usage',
      data: usage,
    } as MessagePart)
  }

  if (reasoningText || isStreaming) {
    parts.push({
      type: 'reasoning',
      text: reasoningText || 'Analyzing your query...',
      state: isStreaming ? 'streaming' : 'done',
    } as MessagePart)
  }

  toolExecutions.forEach((tool) => {
    parts.push({
      type: 'dynamic-tool',
      toolName: tool.name,
      toolCallId: tool.id,
      state: tool.state,
      input: tool.input,
      output: tool.output,
      errorText: tool.errorText,
    } as MessagePart)
  })

  const finalText = answerText || (isStreaming ? '' : '')
  if (finalText) {
    parts.push({
      type: 'text',
      text: finalText,
      state: isStreaming ? 'streaming' : 'done',
    } as MessagePart)
  }

  return parts
}

function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function normalizeCitations(raw: any): Citation[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map((item, index): Citation | null => {
      if (!item) return null
      if (typeof item === 'string') {
        const url = item
        return {
          number: String(index + 1),
          url,
          title: getDomainFromUrl(url),
          snippet: undefined,
        }
      }

      const url = item.url || item.link || item.source || ''
      const title = item.title || item.name || getDomainFromUrl(url)
      const snippet = item.snippet || item.description || item.quote
      const number = item.number ? String(item.number) : String(index + 1)

      return {
        number,
        url,
        title,
        snippet,
      }
    })
    .filter((item): item is Citation => Boolean(item && item.url))
}

function mergeCitations(existing: Citation[], incoming: Citation[]): Citation[] {
  if (incoming.length === 0) return existing

  const seen = new Map<string, Citation>()
  for (const citation of existing) {
    seen.set(citation.url, citation)
  }
  for (const citation of incoming) {
    if (!seen.has(citation.url)) {
      seen.set(citation.url, citation)
    }
  }

  return Array.from(seen.values()).map((citation, index) => ({
    ...citation,
    number: String(index + 1),
  }))
}

function normalizeSources(raw: any): SourceData[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map((item, index) => {
      if (!item) return null
      const url = item.url || item.link || item.source || ''
      if (!url) return null

      const title = item.title || item.name || getDomainFromUrl(url)
      const snippet = item.snippet || item.description || item.quote || ''
      const domain = item.domain || getDomainFromUrl(url)

      return {
        id: item.id || `source-${index}-${domain}`,
        url,
        title,
        snippet,
        domain,
        type: item.type || 'web',
        favicon: item.favicon,
      } as SourceData
    })
    .filter((item): item is SourceData => Boolean(item))
}

function sourcesToWebResults(sources: SourceData[]): UniversalResult[] {
  return sources.map((source, index) => ({
    id: source.id || `web-${index}`,
    type: 'web',
    title: source.title || source.url,
    url: source.url,
    snippet: source.snippet || '',
    favicon: source.favicon,
    domain: source.domain,
  }))
}

function mergeResults(existing: UniversalResult[], incoming: UniversalResult[]): UniversalResult[] {
  if (incoming.length === 0) return existing
  const seen = new Set(existing.map((result) => result.url || result.id))
  const merged = [...existing]
  for (const result of incoming) {
    const key = result.url || result.id
    if (!seen.has(key)) {
      merged.push(result)
      seen.add(key)
    }
  }
  return merged
}

function normalizeToolOutput(
  output: any,
  existingCitations: Citation[],
  existingResults: UniversalResult[]
): { citations: Citation[]; results: UniversalResult[] } {
  const citationsRaw = output?.citations || output?.sources || output?.links
  const incomingCitations = normalizeCitations(citationsRaw)
  const nextCitations = mergeCitations(existingCitations, incomingCitations)

  const sourcesRaw = output?.sources || output?.search_results || output?.results || output?.items
  const sources = normalizeSources(sourcesRaw)
  const incomingResults = sourcesToWebResults(sources)
  const nextResults = mergeResults(existingResults, incomingResults)

  return { citations: nextCitations, results: nextResults }
}

function getMessageText(parts: MessagePart[]): string {
  return parts
    .filter((part): part is TextUIPart => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

function getReasoningText(parts: MessagePart[]): string {
  return parts
    .filter((part) => part.type === 'reasoning')
    .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
    .join('')
}

function getToolExecutions(parts: MessagePart[]): ToolExecution[] {
  return parts.flatMap((part, index) => {
    if (!isToolUIPart(part)) return []
    const toolPart = part as {
      state?: ToolExecution['state'] | 'output-denied'
      toolCallId?: string
      toolName?: string
      input?: unknown
      output?: unknown
      errorText?: string
    }
    const state = toolPart.state === 'output-denied' ? 'output-error' : toolPart.state || 'input-available'

    return [{
      id: toolPart.toolCallId || `tool-${index}`,
      name: toolPart.toolName || toolPart.toolCallId || `tool-${index}`,
      state,
      input: toolPart.input,
      output: toolPart.output,
      errorText: toolPart.errorText,
    }]
  })
}

function extractSearchArtifacts(parts: MessagePart[]): { citations: Citation[]; results: UniversalResult[] } {
  let nextCitations: Citation[] = []
  let nextResults: UniversalResult[] = []

  for (const part of parts) {
    if (isToolUIPart(part)) {
      const toolPart = part as { input?: unknown; output?: unknown }
      const inputData = normalizeToolOutput(toolPart.input, nextCitations, nextResults)
      nextCitations = inputData.citations
      nextResults = inputData.results
      const outputData = normalizeToolOutput(toolPart.output, nextCitations, nextResults)
      nextCitations = outputData.citations
      nextResults = outputData.results
      continue
    }

    if (isDataUIPart(part)) {
      const dataPart = part as { data?: unknown }
      const dataOutput = normalizeToolOutput(dataPart.data, nextCitations, nextResults)
      nextCitations = dataOutput.citations
      nextResults = dataOutput.results
      continue
    }

    if (part.type === 'source-url') {
      const sourcePart = part as { url?: string; sourceId?: string; title?: string }
      const url = sourcePart.url || sourcePart.sourceId || ''
      if (url) {
        nextCitations = mergeCitations(nextCitations, normalizeCitations([{ url, title: sourcePart.title }]))
      }
    } else if (part.type === 'source-document') {
      const sourcePart = part as { url?: string; sourceId?: string; title?: string }
      const url = sourcePart.url || sourcePart.sourceId || ''
      if (url) {
        nextCitations = mergeCitations(nextCitations, normalizeCitations([{ url, title: sourcePart.title }]))
      }
    }
  }

  if (nextResults.length === 0) {
    nextResults = citationsToWebResults(nextCitations)
  }

  return { citations: nextCitations, results: nextResults }
}

function citationsToWebResults(citationList: Citation[]): UniversalResult[] {
  return citationList.map((citation, index) => ({
    id: `citation-${index + 1}`,
    type: 'web',
    title: citation.title || citation.url,
    url: citation.url,
    snippet: citation.snippet || '',
    domain: getDomainFromUrl(citation.url),
  }))
}

export function SearchResultsPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [answerText, setAnswerText] = useState('')
  const [reasoningText, setReasoningText] = useState('')
  const [citations, setCitations] = useState<Citation[]>([])
  const [toolExecutions, setToolExecutions] = useState<ToolExecution[]>([])
  const [isAgentStreaming, setIsAgentStreaming] = useState(false)
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [agentError, setAgentError] = useState<string | null>(null)
  // View State
  const [viewMode, setViewMode] = useState<'results' | 'chat'>('results')
  const [chatContext, setChatContext] = useState<UniversalResult | null>(null)

  const { query: storeQuery, clearSearch } = useSearchStore()
  const { isOpen: isPreviewOpen } = usePreviewStore()

  const searchQuery = storeQuery || 'artificial intelligence and machine learning'

  const transport = useMemo(
    () => new DefaultChatTransport({
      api: 'http://localhost:8765/agents/search/stream',
      body: () => ({ session_id: 'search-page' }),
    }),
    [],
  )

  const { messages, sendMessage, status, setMessages, clearError, stop } = useChat({
    transport,
    onData: (part) => {
      if (part.type === 'data-usage') setUsage(part.data as UsageData)
    },
    onError: (chatError: Error) => {
      const message = chatError.message || 'Search error'
      setError(message)
      setAgentError(message)
      setIsLoading(false)
      setIsAgentStreaming(false)
    },
  })

  const latestAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'assistant') return messages[i]
    }
    return null
  }, [messages])

  const sentQueryRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      void stop()
    }
  }, [stop])

  const agentState = useMemo(() => ({
    parts: buildSearchAgentParts({
      answerText,
      reasoningText,
      toolExecutions,
      isStreaming: isAgentStreaming,
      usage,
    }),
    citations,
    isStreaming: isAgentStreaming,
    error: agentError,
  }), [answerText, reasoningText, toolExecutions, isAgentStreaming, citations, agentError, usage])

  useEffect(() => {
    if (!searchQuery || status !== 'ready' || sentQueryRef.current === searchQuery) return

    setIsLoading(true)
    setIsAgentStreaming(true)
    setAgentError(null)
    setError(null)
    setSearchResponse(null)
    setAnswerText('')
    setReasoningText('')
    setCitations([])
    setToolExecutions([])
    setUsage(null)
    setMessages([])
    clearError()

    sentQueryRef.current = searchQuery
    void sendMessage({ text: searchQuery })
  }, [searchQuery, sendMessage, status, setMessages, clearError])

  useEffect(() => {
    const isStreaming = status === 'streaming' || status === 'submitted'
    setIsAgentStreaming(isStreaming)

    if (!latestAssistantMessage) {
      if (status === 'error') setIsLoading(false)
      return
    }

    const text = getMessageText(latestAssistantMessage.parts)
    const reasoning = getReasoningText(latestAssistantMessage.parts)
    const tools = getToolExecutions(latestAssistantMessage.parts)
    const artifacts = extractSearchArtifacts(latestAssistantMessage.parts)

    setAnswerText(text)
    setReasoningText(reasoning)
    setToolExecutions(tools)
    setCitations(artifacts.citations)

    if (status === 'ready') {
      setSearchResponse({
        id: `search-${latestAssistantMessage.id}`,
        query: searchQuery,
        timestamp: Date.now(),
        isComplete: true,
        totalCount: artifacts.results.length,
        duration: 0,
        sonarReasoning: {
          reasoning: reasoning || text,
          chainOfThought: {
            steps: [],
          },
          confidence: 0.85,
          qualityScore: 0.9,
          sources: artifacts.citations.map((citation, index) => ({
            id: `source-${index}`,
            url: citation.url || '',
            title: citation.title || '',
            snippet: citation.snippet || '',
            relevanceScore: 0.9,
            type: 'web',
            domain: citation.url ? getDomainFromUrl(citation.url) : '',
          })),
          summary: text.substring(0, 200),
          relatedQueries: [],
          modelUsed: 'sonar-reasoning-pro',
          tokensUsed: usage?.totalTokens || 0,
        },
        results: artifacts.results,
      })
      setIsLoading(false)
    }
  }, [latestAssistantMessage, searchQuery, status, usage])

  const handleRefresh = () => {
    window.location.reload()
  }

  const handleResultClick = (result: UniversalResult) => {
    console.log('Result clicked:', result)
    // In a real app, this would open the result
  }

  const handleBackToHome = () => {
    clearSearch()
  }

  const handleChatClick = (result: UniversalResult) => {
    setChatContext(result)
    setViewMode('chat')
  }

  return (
    <div className="min-h-screen bg-surface-950 dark:bg-surface-950 relative overflow-hidden">
      {/* Premium Background Effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Gradient orbs */}
        <div className="absolute -top-[40%] -left-[20%] w-[80%] h-[80%] rounded-full bg-gradient-to-br from-accent-indigo/8 via-accent-light/5 to-transparent blur-3xl" />
        <div className="absolute -bottom-[30%] -right-[20%] w-[70%] h-[70%] rounded-full bg-gradient-to-tl from-accent-muted/6 via-accent-light/4 to-transparent blur-3xl" />
        
        {/* Subtle grid pattern */}
        <div 
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(99, 102, 241, 0.3) 1px, transparent 1px),
              linear-gradient(90deg, rgba(99, 102, 241, 0.3) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px'
          }}
        />
      </div>

      {/* Header */}
      <motion.header 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 border-b border-surface-800/60 bg-surface-900/40 backdrop-blur-xl"
      >
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Left: Back + Query */}
            <div className="flex items-center gap-4">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleBackToHome}
                className="p-2.5 rounded-xl bg-surface-800/50 border border-surface-700/50 text-ink-inverse-muted hover:text-ink-inverse hover:border-accent-light/30 hover:bg-surface-800/80 transition-all duration-200"
              >
                <ArrowLeft className="w-4 h-4" />
              </motion.button>
              
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute inset-0 bg-gradient-to-r from-accent-indigo to-accent-light rounded-xl blur opacity-40" />
                  <div className="relative p-2 rounded-xl bg-gradient-to-br from-accent-indigo to-accent-light">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                </div>
                <div>
                  <h1 className="text-lg font-light text-ink-inverse tracking-tight">
                    Search Results
                  </h1>
                  <p className="text-sm text-ink-inverse-muted font-light">
                    "{searchQuery}"
                  </p>
                </div>
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2">
              {/* View Toggle */}
              <div className="flex items-center bg-surface-800/60 border border-surface-700/50 rounded-xl p-1">
                <button
                  onClick={() => setViewMode('results')}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-light transition-all duration-200",
                    viewMode === 'results'
                      ? "bg-gradient-to-r from-accent-indigo to-accent-light text-white shadow-lg shadow-accent-indigo/25"
                      : "text-ink-inverse-muted hover:text-ink-inverse"
                  )}
                >
                  <LayoutGrid className="w-4 h-4" />
                  <span>Results</span>
                </button>
                <button
                  onClick={() => setViewMode('chat')}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-light transition-all duration-200",
                    viewMode === 'chat'
                      ? "bg-gradient-to-r from-accent-indigo to-accent-light text-white shadow-lg shadow-accent-indigo/25"
                      : "text-ink-inverse-muted hover:text-ink-inverse"
                  )}
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Chat</span>
                </button>
              </div>

              <div className="w-px h-8 bg-surface-700/50 mx-1" />

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleRefresh}
                disabled={isLoading}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-light transition-all duration-200 border",
                  isLoading
                    ? "bg-surface-800/40 border-surface-700/30 text-ink-inverse-muted cursor-not-allowed"
                    : "bg-surface-800/60 border-surface-700/50 text-ink-inverse-secondary hover:text-ink-inverse hover:border-accent-light/30"
                )}
              >
                <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
                <span>{isLoading ? 'Loading' : 'Refresh'}</span>
              </motion.button>
            </div>
          </div>
        </div>
      </motion.header>

      {/* Main Content */}
      <div className={cn(
        "relative z-10 flex-1 transition-all duration-300",
        isPreviewOpen ? "mr-[480px]" : ""
      )}>
        <AnimatePresence mode="wait">
          {viewMode === 'results' ? (
            <motion.div
              key="results"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="max-w-7xl mx-auto px-6 py-8"
            >
              <PremiumSearchLayout
                searchResponse={searchResponse}
                searchQuery={searchQuery}
                isLoading={isLoading}
                error={error}
                agentState={agentState}
                onResultClick={handleResultClick}
                onChatClick={handleChatClick}
              />
            </motion.div>
          ) : (
            <motion.div
              key="chat"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="h-[calc(100vh-73px)]"
            >
              <SearchChat
                searchResult={{
                  query: searchQuery,
                  answer: answerText,
                  sources: citations.map(c => ({
                    id: c.url,
                    url: c.url,
                    title: c.title || c.url,
                    snippet: c.snippet || '',
                    domain: getDomainFromUrl(c.url),
                    type: 'web',
                    favicon: undefined
                  }))
                }}
                onBack={() => setViewMode('results')}
                initialContext={chatContext}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Browser Automation Preview Panel */}
      <PreviewPanel variant="sliding" />
    </div>
  )
}

export default SearchResultsPage
