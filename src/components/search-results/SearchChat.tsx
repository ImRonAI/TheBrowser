/**
 * SearchChat - Premium AI Search Chat Interface
 *
 * Exact replica of RonTab.tsx + AgentPanel.tsx patterns
 * Features streaming responses with reasoning, chain of thought, inline citations, and sources
 */

import { useState, useCallback, useRef, useEffect, memo, useMemo } from 'react'
import { useChat, type UIMessage } from '@ai-sdk/react'
import { DefaultChatTransport, isDataUIPart, isToolUIPart, type TextUIPart } from 'ai'
import { motion } from 'framer-motion'
import { cn } from '@/utils/cn'
import { ArrowLeftIcon, ClockIcon, TrashIcon } from '@heroicons/react/24/outline'

import { ChainOfThoughtMessage } from '@/components/ai-elements/chain-of-thought-message'
import { Message, MessageAvatar, MessageContent } from '@/components/ai-elements/message'
import { ChatHistory } from './ChatHistory'
import { Button } from '@/components/ui/button'

// Context Picker
import { ContextPicker, SelectedContexts, type ContextItem } from '@/components/agent-panel/ContextPicker'
import {
  usePreviewStore,
  type BrowserPreviewData,
  type ProjectPreviewData,
} from '@/stores/previewStore'

// Source Card for citations
import type { SourceData } from './SourceCard'
import type { UniversalResult } from '@/pages/types/search'

import {
  handleOrchestrationDataPart,
  type OrchestrationStreamEvent,
} from '@/utils/orchestration-stream'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

interface SearchChatProps {
  searchResult: { query: string; answer?: string; sources?: SourceData[] }
  onBack: () => void
  initialContext?: UniversalResult | null
}

// Export for external use
export type ChatMessage = UIMessage

type MessagePart = UIMessage['parts'][number]

// Sleek, minimal suggestions
const SUGGESTIONS = [
  { text: 'Tell me more about this', icon: '✦' },
  { text: 'What are the key points?', icon: '◎' },
  { text: 'Show me related topics', icon: '→' },
  { text: 'Deep dive into details', icon: '∑' },
]

const API_BASE_URL = import.meta.env.VITE_SEARCH_API_URL || 'http://localhost:8765'

function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
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
      const type = item.type || 'web'

      return {
        id: item.id || `source-${index}-${domain}`,
        url,
        title,
        snippet,
        domain,
        type,
        favicon: item.favicon,
      } as SourceData
    })
    .filter((item): item is SourceData => Boolean(item))
}

function mergeSources(existing: SourceData[], incoming: SourceData[]): SourceData[] {
  if (incoming.length === 0) return existing
  const existingUrls = new Set(existing.map((source) => source.url))
  const merged = [...existing]
  for (const source of incoming) {
    if (!existingUrls.has(source.url)) {
      merged.push(source)
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
  const merged: SourceData[] = []
  for (const candidate of candidates) {
    merged.push(...normalizeSources(candidate))
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

function mergeToolResult(
  parts: MessagePart[],
  toolCallId: string | undefined,
  output: unknown,
  errorText?: string
) {
  if (!toolCallId) return
  const index = parts.findIndex((part) => {
    if (!isToolUIPart(part)) return false
    return (part as { toolCallId?: string }).toolCallId === toolCallId
  })
  if (index === -1) return

  parts[index] = {
    ...(parts[index] as object),
    state: errorText ? 'output-error' : 'output-available',
    output,
    errorText,
  } as MessagePart
}

function toCitations(sources: SourceData[]) {
  return sources.map((source, index) => ({
    number: String(index + 1),
    title: source.title,
    url: source.url,
    snippet: source.snippet,
  }))
}

function isBrowserPreviewData(value: unknown): value is BrowserPreviewData {
  return Boolean(value) && typeof value === 'object'
}

function isProjectPreviewData(value: unknown): value is ProjectPreviewData {
  if (!value || typeof value !== 'object') return false
  const status = (value as Record<string, unknown>).status
  return status === 'starting' || status === 'running' || status === 'stopped' || status === 'error'
}

function isOrchestrationEvent(value: unknown): value is OrchestrationStreamEvent {
  return Boolean(value) && typeof value === 'object'
}

function buildInitialContext(
  searchResult: SearchChatProps['searchResult'],
  userQuery: string
): string {
  const answer = searchResult.answer?.trim()
  const sources = searchResult.sources || []
  const sourcesText = sources
    .map((source, index) => `${index + 1}. ${source.title} - ${source.url}`)
    .join('\n')

  if (!answer && sources.length === 0) {
    return userQuery
  }

  return [
    'You are continuing an in-depth discussion based on the initial search.',
    answer ? `Initial answer:\n${answer}` : null,
    sources.length > 0 ? `Initial sources:\n${sourcesText}` : null,
    `User follow-up:\n${userQuery}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function SearchChat({ searchResult, onBack, initialContext }: SearchChatProps) {
  const query = searchResult.query
  const [input, setInput] = useState('')
  const [selectedContexts, setSelectedContexts] = useState<ContextItem[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [hasSentContext, setHasSentContext] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const sessionIdRef = useRef<string>(crypto.randomUUID())

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_BASE_URL}/agents/search/stream`,
        body: () => ({
          session_id: sessionIdRef.current,
          persist_session: true,
        }),
      }),
    []
  )

  const { messages, setMessages, sendMessage, status, clearError } = useChat({
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
    },
    onError: (error: Error) => {
      console.error('Search chat stream error:', error)
    },
  })

  const isTyping = status === 'streaming' || status === 'submitted'
  const isEmpty = messages.length === 0

  const handleLoadSession = async (sid: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/chat-sessions/${sid}`)
      if (res.ok) {
        const data = await res.json()
        sessionIdRef.current = sid
        setSessionId(sid)

        const loadedMessages: UIMessage[] = data.messages.map((msg: any, i: number) => {
          const parts: MessagePart[] = []
          if (typeof msg.content === 'string') {
            parts.push({ type: 'text', text: msg.content } as MessagePart)
          } else if (Array.isArray(msg.content)) {
            msg.content.forEach((block: any) => {
              if (typeof block === 'string') {
                parts.push({ type: 'text', text: block } as MessagePart)
              } else if (block?.type === 'text') {
                parts.push({ type: 'text', text: block.text || '' } as MessagePart)
              } else if (block?.type === 'reasoning' || block?.type === 'thinking') {
                parts.push({ type: 'reasoning', text: block.text || block.content || '' } as MessagePart)
              } else if (block?.type === 'tool_use') {
                parts.push({
                  type: 'dynamic-tool',
                  toolName: block.name,
                  toolCallId: block.id,
                  state: block.output ? 'output-available' : 'input-available',
                  input: block.input,
                  output: block.output,
                  errorText: block.errorText,
                } as MessagePart)
              } else if (block?.type === 'tool_result') {
                mergeToolResult(parts, block.toolCallId, block.output, block.errorText)
              } else if (
                block?.type?.startsWith?.('data-') ||
                block?.type === 'source-url' ||
                block?.type === 'source-document' ||
                block?.type === 'file'
              ) {
                parts.push(block as MessagePart)
              }
            })
          }

          return {
            id: `msg-${sid}-${i}`,
            role: msg.role,
            content: '',
            parts: parts.length > 0 ? parts : [{ type: 'text', text: '' } as MessagePart],
          } as UIMessage
        })

        setMessages(loadedMessages)
        setHasSentContext(true) // Assume context was already handled in old chat
      }
    } catch (err) {
      console.error('Failed to load session:', err)
    }
  }

  const handleDeleteCurrentSession = async () => {
    if (!sessionId || !confirm('Delete this chat permanently?')) return
    
    try {
      const res = await fetch(`${API_BASE_URL}/chat-sessions/${sessionId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        // Clear UI or go back? 
        // Going back seems appropriate
        onBack()
      }
    } catch (err) {
      console.error('Failed to delete session:', err)
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Initialize context if provided
  useEffect(() => {
    if (initialContext) {
      const contextItem: ContextItem = {
        id: initialContext.id,
        type: 'tab', // Treat search results as tabs/links
        name: (initialContext as any).title || initialContext.url || 'Result',
        description: initialContext.url,
        url: initialContext.url,
        favicon: (initialContext as any).favicon,
      }
      setSelectedContexts([contextItem])
    }
  }, [initialContext])

  // Seed chat with initial search result or fetch if missing
  useEffect(() => {
    if (!query) return

    if (searchResult.answer || (searchResult.sources && searchResult.sources.length > 0)) {
      const assistantParts: MessagePart[] = []
      if (searchResult.sources && searchResult.sources.length > 0) {
        assistantParts.push({
          type: 'data-search-results',
          data: { sources: searchResult.sources },
        } as MessagePart)
      }
      if (searchResult.answer) {
        assistantParts.push({
          type: 'text',
          text: searchResult.answer,
        } as MessagePart)
      }

      setMessages([
        {
          id: `msg-${Date.now()}-user`,
          role: 'user',
          content: '',
          parts: [{ type: 'text', text: query } as MessagePart],
        } as UIMessage,
        {
          id: `msg-${Date.now()}-assistant`,
          role: 'assistant',
          content: '',
          parts: assistantParts.length > 0 ? assistantParts : [{ type: 'text', text: '' } as MessagePart],
        } as UIMessage,
      ])
      return
    }

    handleSubmit(query, { includeContext: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(async (text?: string, options?: { includeContext?: boolean }) => {
    const messageText = text || input.trim()
    const canSend = status === 'ready' || status === 'error'
    if (!messageText || !canSend) return

    if (status === 'error') {
      clearError()
    }

    const shouldIncludeContext = options?.includeContext ?? (!hasSentContext && Boolean(searchResult.answer || searchResult.sources?.length))
    const requestText = shouldIncludeContext
      ? buildInitialContext(searchResult, messageText)
      : messageText

    setInput('')
    setSelectedContexts([])

    try {
      if (!sessionId) {
        const nextSessionId = crypto.randomUUID()
        sessionIdRef.current = nextSessionId
        setSessionId(nextSessionId)
      }
      await sendMessage({ text: requestText } as any)
      setHasSentContext(true)
    } catch (error) {
      console.error('Search submit failed:', error)
    }
  }, [input, status, clearError, sessionId, searchResult, hasSentContext, selectedContexts, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="h-full flex flex-col relative overflow-hidden bg-surface-0 dark:bg-surface-900">
      <NeuralGridBackground isActive={isTyping} />
      <AmbientBreathingGlow />

      <ChatHistory 
        isOpen={isHistoryOpen} 
        onClose={() => setIsHistoryOpen(false)}
        onSelectSession={handleLoadSession}
        currentSessionId={sessionId}
      />

      {/* Header with back button */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative z-10 flex-shrink-0 px-6 py-4 flex items-center gap-4 border-b border-surface-100 dark:border-surface-800"
      >
        <motion.button
          onClick={onBack}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          className="p-2 rounded-lg text-ink-muted dark:text-ink-inverse-muted hover:text-ink dark:hover:text-ink-inverse hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
        >
          <ArrowLeftIcon className="w-5 h-5" />
        </motion.button>

        <div className="flex-1 min-w-0">
          <h2 className="text-body-md font-medium text-ink dark:text-ink-inverse truncate">
            {query || 'Search'}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsHistoryOpen(true)}
            className="text-ink-muted dark:text-ink-inverse-muted"
            title="Chat History"
          >
            <ClockIcon className="w-5 h-5" />
          </Button>
          
          {sessionId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDeleteCurrentSession}
              className="text-ink-muted dark:text-ink-inverse-muted hover:text-red-500 hover:bg-red-50"
              title="Delete Chat"
            >
              <TrashIcon className="w-5 h-5" />
            </Button>
          )}
        </div>
      </motion.div>

      {/* Content */}
      <div className="relative z-10 flex-1 overflow-hidden">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="h-full flex flex-col"
        >
          {isEmpty ? (
            <EmptyState query={query} onSubmit={handleSubmit} />
          ) : (
            <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-6">
              <div className="max-w-3xl mx-auto space-y-6">
                {messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    isStreaming={isTyping && msg.role === 'assistant' && msg.id === messages[messages.length - 1]?.id}
                  />
                ))}
                {isTyping && messages[messages.length - 1]?.role === 'user' && (
                  <TypingIndicator />
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {/* Input */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="relative z-10 flex-shrink-0 p-4 border-t border-surface-100 dark:border-surface-800"
      >
        <div className="max-w-3xl mx-auto">
          {/* Selected Contexts Display */}
          <SelectedContexts
            contexts={selectedContexts}
            onRemove={(id) => setSelectedContexts(prev => prev.filter(c => c.id !== id))}
            className="mb-3"
          />

          <div className={cn(
            "rounded-2xl transition-all duration-300",
            "bg-surface-50 dark:bg-surface-850",
            "border",
            input
              ? "border-accent/40 dark:border-accent-light/40 shadow-sm"
              : "border-surface-200 dark:border-surface-700"
          )}>
            {/* Input Row */}
            <div className="flex items-center gap-2 px-3 py-2">
              {/* Context Picker */}
              <ContextPicker
                selectedContexts={selectedContexts}
                onContextsChange={setSelectedContexts}
              />

              {/* Text Input */}
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a follow-up question..."
                rows={1}
                className={cn(
                  "flex-1 resize-none",
                  "py-1.5",
                  "bg-transparent",
                  "text-body-md text-ink dark:text-ink-inverse",
                  "placeholder:text-ink-muted/60 dark:placeholder:text-ink-inverse-muted/60",
                  "outline-none",
                  "min-h-[32px] max-h-32",
                )}
              />

              {/* Send Button */}
              <motion.button
                onClick={() => handleSubmit()}
                disabled={!input.trim() || isTyping}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={cn(
                  "flex-shrink-0",
                  "w-8 h-8 rounded-lg",
                  "flex items-center justify-center",
                  "transition-all duration-300",
                  input.trim() && !isTyping
                    ? "bg-ink dark:bg-ink-inverse text-surface-0 dark:text-surface-900"
                    : "bg-surface-200 dark:bg-surface-700 text-ink-muted/50 dark:text-ink-inverse-muted/50"
                )}
              >
                <ArrowUpIcon className="w-4 h-4" />
              </motion.button>
            </div>
          </div>

          <p className="text-center text-body-xs text-ink-muted/50 dark:text-ink-inverse-muted/50 mt-2">
            ↵ to send · Web search included
          </p>
        </div>
      </motion.div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EMPTY STATE
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({ query, onSubmit }: { query: string; onSubmit: (text: string) => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-8">
      {/* Minimal logo mark */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="relative mb-10"
      >
        <div className="w-16 h-16 rounded-2xl bg-ink dark:bg-ink-inverse flex items-center justify-center">
          <span className="text-2xl font-display font-light text-surface-0 dark:text-surface-900">R</span>
        </div>
        {/* Subtle pulse ring */}
        <motion.div
          className="absolute inset-0 rounded-2xl border border-ink/20 dark:border-ink-inverse/20"
          animate={{ scale: [1, 1.3], opacity: [0.5, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
        />
      </motion.div>

      {/* Headline */}
      <motion.h2
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="text-display-md font-display font-light text-ink dark:text-ink-inverse text-center mb-3"
      >
        {query ? `Searching for "${query}"...` : 'What would you like to search?'}
      </motion.h2>

      <motion.p
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="text-body-sm text-ink-muted dark:text-ink-inverse-muted text-center mb-12 max-w-md"
      >
        I'll search the web and provide comprehensive answers with sources
      </motion.p>

      {/* Sleek Pill Suggestions */}
      <motion.div
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="flex flex-wrap justify-center gap-2 max-w-lg"
      >
        {SUGGESTIONS.map((suggestion, i) => (
          <motion.button
            key={suggestion.text}
            onClick={() => onSubmit(suggestion.text)}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.25 + i * 0.04 }}
            whileHover={{ scale: 1.03, y: -1 }}
            whileTap={{ scale: 0.97 }}
            className={cn(
              "group relative",
              "inline-flex items-center gap-2",
              "px-4 py-2 rounded-full",
              "bg-surface-50 dark:bg-surface-850",
              "border border-surface-200 dark:border-surface-700",
              "hover:border-surface-300 dark:hover:border-surface-600",
              "hover:bg-surface-100 dark:hover:bg-surface-800",
              "transition-all duration-300 ease-out",
              "cursor-pointer"
            )}
          >
            <span className="text-ink-muted dark:text-ink-inverse-muted text-sm font-light opacity-60 group-hover:opacity-100 transition-opacity">
              {suggestion.icon}
            </span>
            <span className="text-body-sm text-ink-secondary dark:text-ink-inverse-secondary group-hover:text-ink dark:group-hover:text-ink-inverse transition-colors">
              {suggestion.text}
            </span>
          </motion.button>
        ))}
      </motion.div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE BUBBLE
// ─────────────────────────────────────────────────────────────────────────────

function MessageBubble({ message, isStreaming }: { message: UIMessage; isStreaming: boolean }) {
  const isUser = message.role === 'user'
  const parts = message.parts || []
  const sources = extractSourcesFromParts(parts)
  const citations = toCitations(sources)
  const userText = getMessageText(parts)

  return (
    <Message from={isUser ? 'user' : 'assistant'}>
      <MessageAvatar fallback={isUser ? 'U' : 'R'} />
      <MessageContent variant={isUser ? 'contained' : 'flat'}>
        {isUser ? (
          <p className="text-body-sm leading-relaxed whitespace-pre-wrap">
            {userText}
          </p>
        ) : (
          <ChainOfThoughtMessage
            parts={parts}
            isStreaming={isStreaming}
            messageId={message.id}
            citations={citations}
          />
        )}
      </MessageContent>
    </Message>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPING INDICATOR
// ─────────────────────────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-1 px-4 py-3 rounded-2xl rounded-bl-md bg-surface-100 dark:bg-surface-800 w-fit"
    >
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-ink-muted/40 dark:bg-ink-inverse-muted/40"
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.1 }}
        />
      ))}
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ICONS
// ─────────────────────────────────────────────────────────────────────────────

function ArrowUpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Neural Grid Background - Exactly from SuperAgentInterface
// ─────────────────────────────────────────────────────────────────────────────

const NeuralGridBackground = memo(function NeuralGridBackground({ isActive }: { isActive: boolean }) {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <svg className="w-full h-full opacity-[0.07]">
        {Array.from({ length: 100 }).map((_, i) => (
          <circle
            key={i}
            cx={`${(i % 10) * 10 + 5}%`}
            cy={`${Math.floor(i / 10) * 10 + 5}%`}
            r={isActive ? 2 : 1.5}
            className={cn(
              "fill-violet-400 dark:fill-violet-500",
              isActive && "animate-pulse"
            )}
            style={{ 
              animationDelay: `${i * 0.02}s`,
              opacity: isActive ? 0.6 : 0.3,
            }}
          />
        ))}
      </svg>
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Ambient Breathing Glow - Exactly from SuperAgentInterface
// ─────────────────────────────────────────────────────────────────────────────

const AmbientBreathingGlow = memo(function AmbientBreathingGlow() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Core glow */}
      <motion.div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px]"
        animate={{ scale: [1, 1.05, 1], opacity: [0.06, 0.08, 0.06] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        style={{ 
          background: 'radial-gradient(ellipse, rgba(139,92,246,0.12), transparent 70%)', 
          filter: 'blur(80px)' 
        }}
      />
      {/* Middle ring */}
      <motion.div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px]"
        animate={{ scale: [1, 1.03, 1], opacity: [0.04, 0.06, 0.04] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
        style={{ 
          background: 'radial-gradient(ellipse, rgba(124,58,237,0.08), transparent 70%)', 
          filter: 'blur(100px)' 
        }}
      />
      {/* Outer haze */}
      <motion.div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[600px]"
        animate={{ scale: [1, 1.02, 1], opacity: [0.02, 0.04, 0.02] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        style={{ 
          background: 'radial-gradient(ellipse, rgba(99,102,241,0.06), transparent 70%)', 
          filter: 'blur(120px)' 
        }}
      />
    </div>
  )
})

export default SearchChat
