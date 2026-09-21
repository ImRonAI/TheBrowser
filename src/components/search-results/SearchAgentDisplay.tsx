/**
 * SearchAgentDisplay - AI Elements implementation for Search Agent
 *
 * Framework-native streaming via AI SDK `useChat` + `DefaultChatTransport`.
 * No custom SSE parsing.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useChat, type UIMessage } from '@ai-sdk/react'
import { DefaultChatTransport, isDataUIPart, isToolUIPart, type TextUIPart } from 'ai'
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline'
import { ChainOfThoughtMessage } from '@/components/ai-elements/chain-of-thought-message'
import { Sources, SourcesContent, SourcesTrigger, Source } from '@/components/ai-elements/sources'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SourceData } from './SourceCard'
import { useSearchStore } from '@/stores/searchStore'
import {
  usePreviewStore,
  type BrowserPreviewData,
  type ProjectPreviewData,
} from '@/stores/previewStore'
import {
  handleOrchestrationDataPart,
  type OrchestrationStreamEvent,
} from '@/utils/orchestration-stream'

interface Citation {
  number: string
  url: string
  title: string
  snippet?: string
}

interface SearchAgentDisplayProps {
  query: string
  sessionId?: string
}

type MessagePart = UIMessage['parts'][number]

const API_URL = 'http://localhost:8765/agents/search/stream'

function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function normalizeSourceType(value: unknown): SourceData['type'] {
  if (value === 'web' || value === 'academic' || value === 'video' || value === 'social' || value === 'code') {
    return value
  }
  return 'web'
}

function normalizeSources(raw: unknown): SourceData[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const url =
        (typeof record.url === 'string' && record.url) ||
        (typeof record.link === 'string' && record.link) ||
        (typeof record.source === 'string' && record.source) ||
        ''
      if (!url) return null

      const title =
        (typeof record.title === 'string' && record.title) ||
        (typeof record.name === 'string' && record.name) ||
        getDomainFromUrl(url)

      const snippet =
        (typeof record.snippet === 'string' && record.snippet) ||
        (typeof record.description === 'string' && record.description) ||
        (typeof record.quote === 'string' && record.quote) ||
        ''

      const domain =
        (typeof record.domain === 'string' && record.domain) || getDomainFromUrl(url)

      const type = normalizeSourceType(record.type)

      const source: SourceData = {
        id: (typeof record.id === 'string' && record.id) || `source-${index}-${domain}`,
        url,
        title,
        snippet,
        domain,
        type,
      }

      if (typeof record.favicon === 'string') {
        source.favicon = record.favicon
      }

      return source
    })
    .filter((item): item is SourceData => item !== null)
}

function mergeSources(existing: SourceData[], incoming: SourceData[]): SourceData[] {
  if (incoming.length === 0) return existing

  const seen = new Set(existing.map((source) => source.url))
  const merged = [...existing]

  for (const source of incoming) {
    if (!seen.has(source.url)) {
      merged.push(source)
      seen.add(source.url)
    }
  }

  return merged
}

function extractSourcesFromPayload(payload: unknown): SourceData[] {
  if (!payload || typeof payload !== 'object') return []

  const record = payload as Record<string, unknown>
  const candidates = [
    record.sources,
    record.search_results,
    record.results,
    record.citations,
    record.links,
  ]

  let merged: SourceData[] = []
  for (const candidate of candidates) {
    merged = mergeSources(merged, normalizeSources(candidate))
  }

  return merged
}

function extractSourcesFromParts(parts: MessagePart[]): SourceData[] {
  let sources: SourceData[] = []

  for (const part of parts) {
    if (isToolUIPart(part)) {
      const toolPart = part as { input?: unknown; output?: unknown }
      sources = mergeSources(sources, extractSourcesFromPayload(toolPart.input))
      sources = mergeSources(sources, extractSourcesFromPayload(toolPart.output))
      continue
    }

    if (isDataUIPart(part)) {
      const dataPart = part as { data?: unknown }
      sources = mergeSources(sources, extractSourcesFromPayload(dataPart.data))
    }
  }

  return sources
}

function getMessageText(parts: MessagePart[]): string {
  return parts
    .filter((part): part is TextUIPart => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

function toCitations(sources: SourceData[]): Citation[] {
  return sources.map((source, index) => ({
    number: String(index + 1),
    url: source.url,
    title: source.title,
    snippet: source.snippet,
  }))
}

function isBrowserPreviewData(value: unknown): value is BrowserPreviewData {
  return Boolean(value) && typeof value === 'object'
}

function isProjectPreviewData(value: unknown): value is ProjectPreviewData {
  if (!value || typeof value !== 'object') return false
  const status = (value as Record<string, unknown>).status
  return (
    status === 'starting' ||
    status === 'running' ||
    status === 'stopped' ||
    status === 'error'
  )
}

function isOrchestrationEvent(value: unknown): value is OrchestrationStreamEvent {
  return Boolean(value) && typeof value === 'object'
}

export function SearchAgentDisplay({ query, sessionId = 'search-default' }: SearchAgentDisplayProps) {
  const [error, setError] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  const [extraSources, setExtraSources] = useState<SourceData[]>([])

  const clearSearch = useSearchStore((state) => state.clearSearch)
  const goToChat = useSearchStore((state) => state.goToChat)
  const goToFullResults = useSearchStore((state) => state.goToFullResults)
  const updateQuickResult = useSearchStore((state) => state.updateQuickResult)
  const setIsStreamingStore = useSearchStore((state) => state.setIsStreaming)

  const runKeyRef = useRef<string>('')
  const sessionIdRef = useRef<string>(`${sessionId}-${crypto.randomUUID()}`)

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: API_URL,
        body: () => ({
          session_id: sessionIdRef.current,
          persist_session: true,
        }),
      }),
    [],
  )

  const { messages, sendMessage, status, setMessages, clearError } = useChat({
    transport,
    onData: (dataPart) => {
      const part = dataPart as { type?: string; data?: unknown }

      if (part.type === 'data-orchestration' && isOrchestrationEvent(part.data)) {
        handleOrchestrationDataPart({ type: 'data-orchestration', data: part.data })
      } else if (part.type === 'data-browser' && isBrowserPreviewData(part.data)) {
        usePreviewStore.getState().openBrowserPreview(part.data)
      } else if (part.type === 'data-project' && isProjectPreviewData(part.data)) {
        usePreviewStore.getState().openProjectPreview(part.data)
      }

      // Also harvest sources from non-message data parts.
      const incomingSources = extractSourcesFromPayload(part.data)
      if (incomingSources.length > 0) {
        setExtraSources((prev) => mergeSources(prev, incomingSources))
      }
    },
    onError: (chatError: Error) => {
      setError(chatError.message || 'An error occurred')
    },
  })

  const isStreaming = status === 'streaming' || status === 'submitted'

  const latestAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'assistant') return messages[i]
    }
    return null
  }, [messages])

  const assistantParts = latestAssistant?.parts || []
  const answerText = useMemo(() => getMessageText(assistantParts), [assistantParts])

  const mergedSources = useMemo(() => {
    const fromParts = extractSourcesFromParts(assistantParts)
    return mergeSources(fromParts, extraSources)
  }, [assistantParts, extraSources])

  const citations = useMemo(() => toCitations(mergedSources), [mergedSources])

  useEffect(() => {
    if (!query) return

    updateQuickResult({
      query,
      answer: answerText,
      isAnswerComplete: Boolean(answerText) && !isStreaming,
      sources: mergedSources,
      relatedQueries: [],
    })
  }, [query, answerText, mergedSources, isStreaming, updateQuickResult])

  useEffect(() => {
    if (!query) return
    setIsStreamingStore(isStreaming)
  }, [query, isStreaming, setIsStreamingStore])

  useEffect(() => {
    if (!query) return

    const runKey = `${query}::${retryToken}`
    if (runKeyRef.current === runKey) return
    runKeyRef.current = runKey

    const run = async () => {
      setError(null)
      setExtraSources([])
      setMessages([])

      // Fresh session per run avoids stale context pollution while staying framework-native.
      sessionIdRef.current = `${sessionId}-${crypto.randomUUID()}`

      if (status === 'error') {
        clearError()
      }

      try {
        await sendMessage({ text: query } as any)
      } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : 'Unknown error'
        setError(message)
      }
    }

    void run()
  }, [query, retryToken, sessionId, sendMessage, setMessages, status, clearError])

  return (
    <div className="max-w-5xl mx-auto px-5 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <Button
          onClick={clearSearch}
          variant="ghost"
          size="sm"
          className="rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition h-auto py-1 px-3"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5 mr-2" />
          Back
        </Button>
        <div className="text-xs text-muted-foreground/60">
          {isStreaming ? 'Streaming response' : 'Response ready'}
        </div>
      </div>

      <div className="text-center space-y-1.5">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground/60">Search</p>
        <h1 className="text-2xl font-medium text-foreground/90">{query}</h1>
        <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground/40">
          <Button
            onClick={() => setRetryToken((value) => value + 1)}
            variant="ghost"
            size="sm"
            className="rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition h-auto py-1 px-3"
          >
            <ArrowPathIcon className="h-3.5 w-3.5 mr-1" />
            Retry
          </Button>
        </div>
      </div>

      {assistantParts.length > 0 && (
        <ChainOfThoughtMessage
          parts={assistantParts}
          isStreaming={isStreaming}
          messageId={`search-agent-${sessionId}-${retryToken}`}
          citations={citations}
        />
      )}

      <div className="space-y-2">
        {mergedSources.length > 0 ? (
          <Sources>
            <SourcesTrigger count={mergedSources.length} />
            <SourcesContent>
              {mergedSources.map((source, index) => (
                <Source key={source.id || `${source.url}-${index}`} href={source.url}>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      [{index + 1}] {source.title}
                    </p>
                    {source.snippet && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {source.snippet}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground/80">
                      {getDomainFromUrl(source.url)}
                    </p>
                  </div>
                </Source>
              ))}
            </SourcesContent>
          </Sources>
        ) : (
          <div className="rounded-xl border border-border bg-muted/5 px-4 py-3 text-xs text-muted-foreground/40">
            Sources will appear here as they stream in.
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <Button
          onClick={() => {
            updateQuickResult({
              query,
              answer: answerText,
              isAnswerComplete: Boolean(answerText) && !isStreaming,
              sources: mergedSources,
              relatedQueries: [],
            })
            goToChat()
          }}
          className={cn(
            'rounded-xl bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-lg shadow-teal-500/20 hover:-translate-y-0.5',
            'h-auto py-2 px-5',
          )}
        >
          <ChatBubbleLeftRightIcon className="h-4 w-4 mr-2" />
          Let's Chat
        </Button>
        <Button
          onClick={goToFullResults}
          className={cn(
            'rounded-xl bg-gradient-to-r from-purple-600 to-purple-700 text-white shadow-lg shadow-purple-500/20 hover:-translate-y-0.5',
            'h-auto py-2 px-5',
          )}
        >
          Full Results
          <ArrowRightIcon className="h-4 w-4 ml-2" />
        </Button>
      </div>

      {error && (
        <div className="glass-card rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-4 text-sm text-red-100">
          <div className="font-medium">Search error</div>
          <div className="mt-1 text-red-100/80">{error}</div>
        </div>
      )}
    </div>
  )
}

export default SearchAgentDisplay
