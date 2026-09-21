/**
 * Sonar Reasoning Pro renderer hook.
 *
 * Provider calls and credentials must live in backend code. The renderer consumes a
 * UI-message-compatible endpoint through AI SDK useChat/DefaultChatTransport.
 */

import { useCallback, useMemo } from 'react'
import { useChat, type UIMessage } from '@ai-sdk/react'
import { DefaultChatTransport, isDataUIPart, type TextUIPart } from 'ai'

export interface Citation {
  id: string
  title: string
  url: string
  snippet?: string
  domain?: string
  relevanceScore?: number
}

export interface SearchResult {
  id: string
  query: string
  snippet: string
  url?: string
}

export interface ImageData {
  id: string
  url: string
  caption?: string
  base64?: string
  mediaType?: string
}

type MessagePart = UIMessage['parts'][number]

function getDomainFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

function textFromParts(parts: MessagePart[]): string {
  return parts
    .filter((part): part is TextUIPart => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

function reasoningFromParts(parts: MessagePart[]): string {
  return parts
    .filter((part) => part.type === 'reasoning')
    .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
    .join('')
}

function normalizeCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index): Citation[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const url = typeof record.url === 'string' ? record.url : ''
    if (!url) return []
    const title = typeof record.title === 'string' ? record.title : getDomainFromUrl(url) || url
    const snippet = typeof record.snippet === 'string' ? record.snippet : undefined
    const domain = typeof record.domain === 'string' ? record.domain : getDomainFromUrl(url)
    const relevanceScore = typeof record.relevanceScore === 'number' ? record.relevanceScore : undefined

    return [{
      id: typeof record.id === 'string' ? record.id : `cite-${index}`,
      title,
      url,
      snippet,
      domain,
      relevanceScore,
    }]
  })
}

function normalizeSearchResults(value: unknown): SearchResult[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index): SearchResult[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const query = typeof record.query === 'string' ? record.query : ''
    const snippet = typeof record.snippet === 'string' ? record.snippet : ''
    const url = typeof record.url === 'string' ? record.url : undefined

    return [{
      id: typeof record.id === 'string' ? record.id : `result-${index}`,
      query,
      snippet,
      url,
    }]
  })
}

function normalizeImages(value: unknown): ImageData[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index): ImageData[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const url = typeof record.url === 'string' ? record.url : ''
    if (!url) return []

    return [{
      id: typeof record.id === 'string' ? record.id : `image-${index}`,
      url,
      caption: typeof record.caption === 'string' ? record.caption : undefined,
      base64: typeof record.base64 === 'string' ? record.base64 : undefined,
      mediaType: typeof record.mediaType === 'string' ? record.mediaType : undefined,
    }]
  })
}

function collectData<T>(parts: MessagePart[], key: string, normalizer: (value: unknown) => T[]): T[] {
  const collected: T[] = []
  for (const part of parts) {
    if (!isDataUIPart(part)) continue
    const data = (part as { data?: unknown }).data
    if (!data || typeof data !== 'object') continue
    collected.push(...normalizer((data as Record<string, unknown>)[key]))
  }
  return collected
}

// renderer-only hook
export function useSonarReasoningPro() {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/sonar-reasoning-pro/stream' }),
    [],
  )

  const chat = useChat({
    transport: transport,
  })

  const latestAssistantMessage = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i -= 1) {
      if (chat.messages[i].role === 'assistant') return chat.messages[i]
    }
    return null
  }, [chat.messages])

  const parts = latestAssistantMessage?.parts || []
  const stream = useCallback((query: string) => {
    if (!query.trim()) return
    void chat.sendMessage({ text: query })
  }, [chat])

  return {
    ...chat,
    stream,
    isStreaming: chat.status === 'streaming' || chat.status === 'submitted',
    content: textFromParts(parts),
    reasoning: reasoningFromParts(parts),
    citations: collectData(parts, 'citations', normalizeCitations),
    images: collectData(parts, 'images', normalizeImages),
    searchResults: collectData(parts, 'search_results', normalizeSearchResults),
    error: chat.error?.message || null,
  }
}
