/**
 * SuperAgent Interface - Revolutionary Redesign
 * 
 * A next-generation AI command interface featuring:
 * - AI Elements library integration (PromptInput, Suggestions, Reasoning)
 * - Orchestration visualization (Graph/Workflow/Swarm task views)
 * - Neural grid ambient background with breathing glow
 * - Holographic tagline with shimmer effect
 * - Orchestration mode selector
 */

import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/cn'
import { DEFAULT_AGENT_MODEL, ModelSelector, useAgentModels } from '@/components/agent-panel/ModelSelector'

// AI Elements
import { Suggestions, Suggestion } from '@/components/ai-elements/suggestion'
import { ChainOfThoughtMessage } from '@/components/ai-elements/chain-of-thought-message'
import { TextAttachmentCard } from '@/components/ai-elements/text-attachment-card'
import type { TextAttachment } from '@/components/ai-elements/types'

// Orchestration visualization
import { useOrchestrationStore } from '@/stores/orchestrationStore'
import { handleOrchestrationDataPart } from '@/utils/orchestration-stream'

// Preview Panel
import { PreviewPanel } from '@/components/ai-elements/preview-panel'
import { usePreviewStore } from '@/stores/previewStore'

// Context
import { ContextPicker, type ContextItem } from '@/components/agent-panel/ContextPicker'
import { API_BASE_URL } from '@/lib/api-base'
import { fileToDataUrl, makePastedTextFilename } from '@/utils/file-utils'

import type { UIMessage } from '@ai-sdk/react'
import { type TextUIPart, isDataUIPart } from 'ai'
import { Message, MessageAvatar, MessageContent } from '@/components/ai-elements/message'
import type { Citation } from '@/components/ai-elements/response-with-citations'

type MessagePart = UIMessage['parts'][number]
type OrchestrationMode = 'workflow' | 'swarm' | 'graph'

interface UrlAttachment {
  id: string
  url: string
  domain: string
  favicon: string
}

const EASE = [0.16, 1, 0.3, 1] as const
const LARGE_PASTE_THRESHOLD_CHARS = 2000

const CHAT_API = `${API_BASE_URL}/chat`
const SUPERAGENT_SESSION_STORAGE_KEY = 'ron.superagent.session_id'
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi
type SuperAgentStatus = 'ready' | 'submitted' | 'streaming' | 'error'

function generateSuperAgentSessionId(): string {
  return `superagent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function persistSuperAgentSessionId(sessionId: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SUPERAGENT_SESSION_STORAGE_KEY, sessionId)
}

function getOrCreateSuperAgentSessionId(): string {
  if (typeof window === 'undefined') return generateSuperAgentSessionId()
  const existing = window.localStorage.getItem(SUPERAGENT_SESSION_STORAGE_KEY)
  if (existing && existing.trim()) return existing
  const created = generateSuperAgentSessionId()
  window.localStorage.setItem(SUPERAGENT_SESSION_STORAGE_KEY, created)
  return created
}

/**
 * Read the numbered citations off a terminal AgentPanelResponse data part.
 *
 * The backend emits `citations` already shaped as the native `Citation`
 * interface from response-with-citations.tsx, so there is nothing to normalize:
 * grok fills in number/title/url/snippet against the Pydantic schema.
 */
function extractCitationsFromParts(parts: MessagePart[]): Citation[] {
  const citations: Citation[] = []

  for (const part of parts) {
    if (!isDataUIPart(part)) continue
    const { data } = part as { data?: { citations?: Citation[] } }
    if (Array.isArray(data?.citations)) citations.push(...data.citations)
  }

  return citations
}

function createTextPart(text: string): TextUIPart {
  return { type: 'text', text } as TextUIPart
}

/**
 * The frames emitted by /chat in agent/api/endpoints/chat.py.
 *
 * `panel` carries the schema-validated AgentPanelResponse spread at the top
 * level, so its fields match the Pydantic models one-for-one.
 */
type StreamFrame = {
  type: 'start' | 'delta' | 'reasoning' | 'panel' | 'error' | string
  text?: string
  error?: string
  model_id?: string
  answer?: string
  reasoning?: string
  steps?: unknown[]
  results?: unknown[]
  images?: unknown[]
  citations?: Citation[]
  data?: unknown
}

function getSendText(message: unknown): string {
  if (typeof message === 'string') return message
  if (message && typeof message === 'object' && 'text' in message) {
    const text = (message as { text?: unknown }).text
    return typeof text === 'string' ? text : ''
  }
  return ''
}

function useSuperAgentChat(
  sessionIdRef: React.MutableRefObject<string>,
  selectedModel: string,
  selectedProvider: string,
  selectedEffort: string,
) {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [status, setStatus] = useState<SuperAgentStatus>('ready')

  const clearError = useCallback(() => {
    setStatus('ready')
  }, [])

  const sendMessage = useCallback(
    async (message: unknown) => {
      const text = getSendText(message).trim()
      if (!text) return

      const userMessage = {
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: 'user',
        parts: [createTextPart(text)],
      } as UIMessage
      const assistantId = `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const assistantMessage = {
        id: assistantId,
        role: 'assistant',
        parts: [createTextPart('')],
      } as UIMessage

      setMessages((prev) => [...prev, userMessage, assistantMessage])
      setStatus('submitted')

      try {
        console.info('[SuperAgent] sending chat turn', {
          sessionId: sessionIdRef.current,
          requestedModel: selectedModel,
        })
        const response = await fetch(CHAT_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionIdRef.current,
            user_id: 'default',
            message: text,
            browser_context: { surface: 'superagent' },
            model: selectedModel,
            provider: selectedProvider,
            reasoning_effort: selectedEffort || null,
          }),
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        if (!response.body) {
          throw new Error('No response body')
        }

        setStatus('streaming')
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let loggedActiveModel = false

        /** Append a streamed delta to the assistant's single text part. */
        const appendText = (chunk: string) => {
          if (!chunk) return
          setMessages((prev) => prev.map((item) => {
            if (item.id !== assistantId) return item
            const others = item.parts.filter((part) => part.type !== 'text')
            const current = item.parts
              .filter((part) => part.type === 'text')
              .map((part) => (part as TextUIPart).text)
              .join('')
            return { ...item, parts: [...others, createTextPart(current + chunk)] } as UIMessage
          }))
        }

        /** Append a reasoning delta to the assistant's single reasoning part. */
        const appendReasoning = (chunk: string) => {
          if (!chunk) return
          setMessages((prev) => prev.map((item) => {
            if (item.id !== assistantId) return item
            const others = item.parts.filter((part) => part.type !== 'reasoning')
            const current = item.parts
              .filter((part) => part.type === 'reasoning')
              .map((part) => (part as { text?: string }).text ?? '')
              .join('')
            return {
              ...item,
              parts: [{ type: 'reasoning', text: current + chunk } as MessagePart, ...others],
            } as UIMessage
          }))
        }

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (!value) continue

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const rawLine of lines) {
            const line = rawLine.trim()
            if (!line.startsWith('data:')) continue
            const jsonText = line.slice(5).trim()
            if (!jsonText) continue

            if (jsonText === '[DONE]') continue

            const event = JSON.parse(jsonText) as StreamFrame

            if (event.type === 'start') {
              if (!loggedActiveModel && typeof event.model_id === 'string') {
                loggedActiveModel = true
                console.info('[SuperAgent] backend active model', {
                  sessionId: sessionIdRef.current,
                  requestedModel: selectedModel,
                  activeModel: event.model_id,
                })
              }
            } else if (event.type === 'delta') {
              appendText(event.text ?? '')
            } else if (event.type === 'reasoning') {
              appendReasoning(event.text ?? '')
            } else if (event.type === 'panel') {
              // Terminal frame: schema-validated AgentPanelResponse. `answer` is
              // authoritative, so it replaces the streamed deltas rather than
              // appending to them.
              const { type: _type, ...panel } = event
              setMessages((prev) => prev.map((item) => {
                if (item.id !== assistantId) return item
                const reasoningParts = item.parts.filter((part) => part.type === 'reasoning')
                return {
                  ...item,
                  parts: [
                    ...reasoningParts,
                    createTextPart(panel.answer ?? ''),
                    { type: 'data-agent-panel', data: panel } as MessagePart,
                  ],
                } as UIMessage
              }))
            } else if (event.type === 'error') {
              throw new Error(typeof event.error === 'string' ? event.error : 'Agent stream failed')
            } else if (typeof event.type === 'string') {
              handleOrchestrationDataPart(event as { type: string; data?: any })
            }
          }
        }

        setStatus('ready')
      } catch (error) {
        console.error('[SuperAgentInterface] API Error:', error)
        console.error('[SuperAgentInterface] Failed to connect to backend at:', CHAT_API)
        setMessages((prev) => prev.map((item) => {
          if (item.id !== assistantId) return item
          const currentText = item.parts
            .filter((part) => part.type === 'text')
            .map((part) => (part as TextUIPart).text)
            .join('')
          if (currentText) return item
          return {
            ...item,
            parts: [createTextPart(error instanceof Error ? error.message : 'Agent stream failed')],
          } as UIMessage
        }))
        setStatus('error')
      }
    },
    [selectedModel, selectedProvider, selectedEffort, sessionIdRef],
  )

  return { messages, sendMessage, status, setMessages, clearError }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function SuperAgentInterface() {
  const sessionIdRef = useRef<string>(getOrCreateSuperAgentSessionId())
  const { defaultModel, defaultProvider, refresh: refreshModels, ...modelCatalogue } = useAgentModels()
  const [selection, setSelection] = useState({ model: DEFAULT_AGENT_MODEL, provider: '', effort: '' })
  const { messages, sendMessage, status, setMessages, clearError } = useSuperAgentChat(
    sessionIdRef,
    selection.model,
    selection.provider,
    selection.effort,
  )

  // State
  const [input, setInput] = useState('')
  const [selectedContexts, setSelectedContexts] = useState<ContextItem[]>([])
  const [textAttachments, setTextAttachments] = useState<TextAttachment[]>([])
  const [urlAttachments, setUrlAttachments] = useState<UrlAttachment[]>([])
  const [isDeepResearch, setIsDeepResearch] = useState(false)
  const [orchestrationMode, setOrchestrationMode] = useState<OrchestrationMode>('workflow')
  const [previewContent, setPreviewContent] = useState<{
    type: 'code' | 'document' | 'browser'
    content: string
    title?: string
  } | null>(null)

  // Orchestration store
  const { graphNodes, workflowTasks, swarmNodes } = useOrchestrationStore()
  const hasOrchestration = graphNodes.length > 0 || workflowTasks.length > 0 || swarmNodes.length > 0
  // Preview store (for browser/project automation previews)
  const isPreviewOpen = usePreviewStore(state => state.isOpen)

  const isTyping = status === 'streaming' || status === 'submitted'
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const isEmpty = messages.length === 0
  const isAmbientActive = isTyping || hasOrchestration

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300)
  }, [])

  useEffect(() => {
    setSelection((current) => current.model === DEFAULT_AGENT_MODEL && !current.provider
      ? { model: defaultModel, provider: defaultProvider, effort: '' } : current)
  }, [defaultModel, defaultProvider])

  // ─────────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  const convertBlobUrlToDataUrl = async (url: string): Promise<string | null> => {
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      })
    } catch {
      return null
    }
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items || [])
    const fileItems = items
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((f): f is File => Boolean(f))

    if (fileItems.length > 0) {
      e.preventDefault()
      const newAttachments = await Promise.all(fileItems.map(async (file) => {
        const dataUrl = await fileToDataUrl(file)
        return {
          id: Math.random().toString(36).substr(2, 9),
          file,
          dataUrl,
          preview: dataUrl,
        } as TextAttachment
      }))
      setTextAttachments(prev => [...prev, ...newAttachments])
      return
    }

    const text = e.clipboardData.getData('text/plain')
    
    // Detect URLs in pasted text
    const urls = text.match(URL_REGEX)
    if (urls && urls.length > 0) {
      e.preventDefault()
      const newUrlAttachments: UrlAttachment[] = urls.map(url => {
        let domain = 'link'
        try {
          domain = new URL(url).hostname.replace(/^www\./, '')
        } catch { /* ignore */ }
        return {
          id: Math.random().toString(36).substr(2, 9),
          url,
          domain,
          favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
        }
      })
      // Remove duplicates by URL
      setUrlAttachments(prev => {
        const existing = new Set(prev.map(u => u.url))
        return [...prev, ...newUrlAttachments.filter(u => !existing.has(u.url))]
      })
      // Keep any remaining text after removing URLs
      const remainingText = text.replace(URL_REGEX, '').trim()
      if (remainingText) {
        setInput(prev => prev + remainingText)
      }
      return
    }
    
    if (text && text.length >= LARGE_PASTE_THRESHOLD_CHARS) {
      e.preventDefault()
      const file = new File([text], makePastedTextFilename(), { type: 'text/plain' })
      const dataUrl = await fileToDataUrl(file)
      const newAttachment: TextAttachment = {
        id: Math.random().toString(36).substr(2, 9),
        file,
        dataUrl,
        preview: dataUrl,
      }
      setTextAttachments(prev => [...prev, newAttachment])
    }
  }

  const handleSubmit = async (text?: string) => {
    const messageText = text || input.trim()
    const canSend = status === 'ready' || status === 'error'
    if ((!messageText && textAttachments.length === 0) || !canSend) return

    if (status === 'error') {
      clearError()
    }

    setInput('')
    
    let finalMessage = messageText
    let tempFiles: { type: 'file'; mediaType: string; filename: string; url: string }[] = []

    // Include URL attachments in the message
    if (urlAttachments.length > 0) {
      const urlList = urlAttachments.map(u => u.url).join('\n')
      finalMessage = `${messageText}\n\nReferences:\n${urlList}`
    }

    if (selectedContexts.length > 0) {
      // 1. Fetch full data for any 'tab' contexts
      const enrichedContexts = await Promise.all(
        selectedContexts.map(async (c) => {
          if (c.type === 'tab' && typeof window !== 'undefined' && (window as any).electron?.tabs?.getContext) {
            try {
              // Fetch complete context from Electron (DOM, Screenshot, etc.)
              const fullData = await (window as any).electron.tabs.getContext(c.id)
              return { ...c, fullData }
            } catch (err) {
              console.error(`Failed to fetch context for tab ${c.id}:`, err)
              return c
            }
          }
          return c
        })
      )

      // 2. Process contexts into file attachments
      const contextSummaries: string[] = []

      enrichedContexts.forEach(c => {
        if (c.type === 'tab') {
          contextSummaries.push(`[Context: Tab] ${c.title || c.name} (${c.url})`)
          
          const data = (c as any).fullData
          if (data) {
            // Create .txt attachment for page content
            const textContent = [
              `Title: ${data.title}`,
              `URL: ${data.url}`,
              `\n--- PAGE TEXT CONTENT ---\n${data.dom?.text || ''}`,
              `\n--- PAGE HTML SOURCE ---\n${data.dom?.html?.slice(0, 50000) || ''}` // Cap HTML to 50k
            ].join('\n')

            try {
              // Unicode-safe base64 encoding for data URL
              const base64Content = window.btoa(unescape(encodeURIComponent(textContent)))
              
              tempFiles.push({
                type: 'file',
                mediaType: 'text/plain',
                filename: `[Tab] ${c.title || 'Page'}.txt`,
                url: `data:text/plain;base64,${base64Content}`
              })
            } catch (e) {
              console.error('Failed to create text attachment for tab', e)
            }

            // Create .png attachment for screenshot
            if (data.screenshot) {
              tempFiles.push({
                type: 'file',
                mediaType: 'image/png',
                filename: `[Tab] ${c.title || 'Page'}.png`,
                url: `data:image/png;base64,${data.screenshot}`
              })
            }
          }
        } else {
          contextSummaries.push(`[Context: ${c.type}] ${c.name} - ${c.description || ''}`)
        }
      })

      if (contextSummaries.length > 0) {
        finalMessage = `Context:\n${contextSummaries.join('\n')}\n\n${messageText}`
      } else {
        finalMessage = messageText
      }
    }

    if (isDeepResearch) {
      finalMessage = `[Deep Research Mode]\n${finalMessage}`
    }

    // Add orchestration mode context
    finalMessage = `[Orchestration Mode: ${orchestrationMode}]\n${finalMessage}`

    let files: { type: 'file'; mediaType: string; filename: string; url: string }[] | undefined
    
    if (textAttachments.length > 0) {
      files = await Promise.all(
        textAttachments.map(async (item) => {
          let dataUrl = item.dataUrl
          if (dataUrl.startsWith('blob:')) {
            const converted = await convertBlobUrlToDataUrl(dataUrl)
            if (converted) dataUrl = converted
          }
          return {
            type: 'file' as const,
            mediaType: item.file.type || 'text/plain',
            filename: item.file.name,
            url: dataUrl,
          }
        })
      )
    }

    if (tempFiles.length > 0) {
      files = files ? [...files, ...tempFiles] : tempFiles
    }
    
    setTextAttachments([])
    setUrlAttachments([])
    sendMessage({ text: finalMessage || 'Sent with attachments', files } as any)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleNewChat = () => {
    const newSessionId = generateSuperAgentSessionId()
    sessionIdRef.current = newSessionId
    persistSuperAgentSessionId(newSessionId)
    setMessages([])
    setInput('')
    setSelectedContexts([])
    setTextAttachments([])
    setUrlAttachments([])
    setPreviewContent(null)
    useOrchestrationStore.getState().reset()
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  const handleTextAttachmentRemove = (id: string) => {
    setTextAttachments(prev => prev.filter(att => att.id !== id))
  }

  const handleTextAttachmentUpdate = (
    id: string,
    next: Pick<TextAttachment, 'file' | 'dataUrl' | 'preview'>
  ) => {
    setTextAttachments(prev => prev.map(att =>
      att.id === id ? { ...att, ...next } : att
    ))
  }

  const handleUrlAttachmentRemove = (id: string) => {
    setUrlAttachments(prev => prev.filter(u => u.id !== id))
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col relative overflow-hidden bg-surface-0 dark:bg-surface-900">
      <NeuralGridBackground isActive={isAmbientActive} />
      <AmbientBreathingGlow />

      {/* Header */}
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="relative z-10 flex-shrink-0 px-6 py-4 flex items-center justify-between border-b border-surface-100 dark:border-surface-800 bg-surface-0/90 dark:bg-surface-900/90 backdrop-blur"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center border border-surface-200 dark:border-surface-700">
            <LayersIcon className="w-4 h-4 text-ink dark:text-ink-inverse" />
          </div>
          <span className="text-body-md font-semibold text-ink dark:text-ink-inverse">
            SuperAgent
          </span>
        </div>

        <div className="flex items-center gap-3">
          <ModelSelector
            value={selection.model}
            provider={selection.provider}
            effort={selection.effort}
            {...modelCatalogue}
            disabled={isTyping}
            onChange={(model, provider, effort) => setSelection({ model, provider, effort })}
            onOpen={refreshModels}
            className="ron-field w-[240px]"
          />
          <DeepResearchToggle enabled={isDeepResearch} onChange={setIsDeepResearch} />
          
          <button
            onClick={handleNewChat}
            className="p-2 rounded-lg text-ink-muted dark:text-ink-inverse-muted hover:text-ink dark:hover:text-ink-inverse hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
            title="New conversation"
          >
            <PlusIcon className="w-4 h-4" />
          </button>
        </div>
      </motion.header>

      {/* Main Content */}
      <div className="relative z-10 flex-1 min-h-0 flex">
        <div className="flex-1 flex flex-col min-h-0">
          <AnimatePresence mode="wait">
            {isEmpty ? (
              <EmptyState 
                key="empty" 
                onSuggestionClick={handleSubmit}
                orchestrationMode={orchestrationMode}
                onModeChange={setOrchestrationMode}
              />
            ) : (
              <motion.div
                key="messages"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-6 py-4 space-y-4"
              >
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
                
                {isTyping && messages[messages.length - 1]?.role === 'user' && (
                  <TypingIndicator />
                )}

                <div ref={messagesEndRef} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input Area */}
          <div className={cn(
            "flex-shrink-0 px-6 pb-6 pt-2",
            isEmpty && "flex-1 flex flex-col items-center justify-center"
          )}>
            <div className={cn("w-full", isEmpty ? "max-w-2xl" : "max-w-4xl mx-auto")}>
              {/* Attachments */}
              {textAttachments.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {textAttachments.map(attachment => (
                    <TextAttachmentCard
                      key={attachment.id}
                      attachment={attachment}
                      onRemove={handleTextAttachmentRemove}
                      onUpdate={handleTextAttachmentUpdate}
                    />
                  ))}
                </div>
              )}

              {/* Context chips */}
              {selectedContexts.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {selectedContexts.map(context => (
                    <ContextChip
                      key={context.id}
                      context={context}
                      onRemove={() => setSelectedContexts(prev => prev.filter(c => c.id !== context.id))}
                    />
                  ))}
                </div>
              )}

              {/* URL badges */}
              {urlAttachments.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {urlAttachments.map(urlAtt => (
                    <UrlBadge
                      key={urlAtt.id}
                      attachment={urlAtt}
                      onRemove={() => handleUrlAttachmentRemove(urlAtt.id)}
                    />
                  ))}
                </div>
              )}

              {/* Command Nexus Input */}
              <div 
                className={cn(
                  "ron-field command-nexus relative rounded-2xl transition-all duration-300",
                  "bg-surface-50 dark:bg-surface-850",
                  "border",
                  input 
                    ? "border-accent/40 dark:border-accent-light/40 shadow-sm" 
                    : "border-surface-200 dark:border-surface-700",
                )}
              >
                <div className="flex items-center gap-2 px-4 py-3">
                  <ContextPicker
                    selectedContexts={selectedContexts}
                    onContextsChange={setSelectedContexts}
                  />

                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder="What would you like to accomplish?"
                    rows={1}
                    className={cn(
                      "flex-1 resize-none py-1",
                      "bg-transparent",
                      "text-body-md text-ink dark:text-ink-inverse",
                      "placeholder:text-ink-muted/50 dark:placeholder:text-ink-inverse-muted/50",
                      "outline-none",
                      "min-h-[28px] max-h-32",
                    )}
                  />
                  
                  <motion.button
                    onClick={() => handleSubmit()}
                    disabled={(!input.trim() && textAttachments.length === 0) || (status !== 'ready' && status !== 'error')}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={cn(
                      "flex-shrink-0 w-8 h-8 rounded-xl",
                      "flex items-center justify-center",
                      "transition-all duration-300",
                      (input.trim() || textAttachments.length > 0) && status === 'ready'
                        ? "bg-gradient-to-r from-violet-500 to-purple-600 text-white"
                        : "bg-surface-200 dark:bg-surface-700 text-ink-muted/40"
                    )}
                  >
                    <ArrowUpIcon className="w-4 h-4" />
                  </motion.button>
                </div>
              </div>

              <p className="text-center text-[11px] text-ink-muted/40 dark:text-ink-inverse-muted/40 mt-3 tracking-wide">
                ↵ to send{isDeepResearch && ' · Deep Research enabled'}
              </p>
            </div>
          </div>
        </div>

        {/* Preview Panel - Old style (for backward compatibility) */}
        <AnimatePresence>
          {previewContent && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 420, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="flex-shrink-0 border-l border-surface-200/80 dark:border-surface-700/80 bg-surface-50/95 dark:bg-surface-850/95 backdrop-blur-sm overflow-hidden"
            >
              <div className="w-[420px] h-full flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200 dark:border-surface-700">
                  <div className="flex items-center gap-2">
                    {previewContent.type === 'code' && <CodeIcon className="w-4 h-4 text-violet-500" />}
                    {previewContent.type === 'document' && <DocumentIcon className="w-4 h-4 text-violet-500" />}
                    {previewContent.type === 'browser' && <BrowserIcon className="w-4 h-4 text-violet-500" />}
                    <span className="text-body-sm font-medium text-ink dark:text-ink-inverse">
                      {previewContent.title || 'Preview'}
                    </span>
                  </div>
                  <button
                    onClick={() => setPreviewContent(null)}
                    className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                    aria-label="Close preview"
                  >
                    <XIcon className="w-3.5 h-3.5 text-ink-muted" />
                  </button>
                </div>
                <div className="flex-1 p-4 overflow-auto">
                  <pre className="text-body-xs text-ink-secondary dark:text-ink-inverse-secondary font-mono whitespace-pre-wrap">
                    {previewContent.content}
                  </pre>
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* New AI Preview Panel (for browser automation & project previews) */}
        <AnimatePresence>
          {isPreviewOpen && !previewContent && (
            <PreviewPanel variant="sliding" />
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Neural Grid Background
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
// Ambient Breathing Glow
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
          background: 'radial-gradient(ellipse, rgba(194,106,65,0.12), transparent 70%)', 
          filter: 'blur(80px)' 
        }}
      />
      {/* Middle ring */}
      <motion.div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px]"
        animate={{ scale: [1, 1.03, 1], opacity: [0.04, 0.06, 0.04] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
        style={{ 
          background: 'radial-gradient(ellipse, rgba(169,83,46,0.08), transparent 70%)', 
          filter: 'blur(100px)' 
        }}
      />
      {/* Outer haze */}
      <motion.div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[600px]"
        animate={{ scale: [1, 1.02, 1], opacity: [0.02, 0.04, 0.02] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        style={{ 
          background: 'radial-gradient(ellipse, rgba(194,106,65,0.06), transparent 70%)', 
          filter: 'blur(120px)' 
        }}
      />
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Empty State with Mode Selector
// ─────────────────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  onSuggestionClick: (text: string) => void
  orchestrationMode: OrchestrationMode
  onModeChange: (mode: OrchestrationMode) => void
}

function EmptyState({ onSuggestionClick, orchestrationMode, onModeChange }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 flex flex-col items-center justify-center px-6 pb-32"
    >
      {/* Orchestration Mode Selector */}
      <OrchestrationModeSelector mode={orchestrationMode} onModeChange={onModeChange} />

      {/* Suggestions using AI Elements */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
      >
          <Suggestions layout="wrap" className="max-w-xl justify-center">
            <Suggestion suggestion="Research a topic in depth" onClick={onSuggestionClick} icon="🔬" />
            <Suggestion suggestion="Analyze and summarize documents" onClick={onSuggestionClick} icon="📄" />
            <Suggestion suggestion="Build a workflow automation" onClick={onSuggestionClick} icon="⚡" />
            <Suggestion suggestion="Help me code something" onClick={onSuggestionClick} icon="💻" />
          </Suggestions>
      </motion.div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Holographic Tagline
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Orchestration Mode Selector
// ─────────────────────────────────────────────────────────────────────────────

interface OrchestrationModeSelectorProps {
  mode: OrchestrationMode
  onModeChange: (mode: OrchestrationMode) => void
}

const OrchestrationModeSelector = memo(function OrchestrationModeSelector({ 
  mode, 
  onModeChange 
}: OrchestrationModeSelectorProps) {
  const modes = [
    { id: 'workflow' as const, label: 'Workflow', icon: <SequenceIcon className="w-4 h-4" />, desc: 'Sequential' },
    { id: 'swarm' as const, label: 'Swarm', icon: <SwarmIcon className="w-4 h-4" />, desc: 'Dynamic' },
    { id: 'graph' as const, label: 'Graph', icon: <GraphIcon className="w-4 h-4" />, desc: 'Parallel' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25 }}
      className="flex items-center gap-2 mb-6"
    >
      {modes.map((m) => (
        <motion.button
          key={m.id}
          onClick={() => onModeChange(m.id)}
          whileHover={{ scale: 1.02, y: -1 }}
          whileTap={{ scale: 0.98 }}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-300",
            mode === m.id
              ? "bg-surface-100 dark:bg-surface-800 text-ink dark:text-ink-inverse border border-surface-200 dark:border-surface-700"
              : "text-ink-muted dark:text-ink-inverse-muted hover:text-ink dark:hover:text-ink-inverse border border-transparent hover:border-surface-300 dark:hover:border-surface-600"
          )}
        >
          {m.icon}
          <span className="text-body-sm font-medium">{m.label}</span>
        </motion.button>
      ))}
    </motion.div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Deep Research Toggle
// ─────────────────────────────────────────────────────────────────────────────

function DeepResearchToggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-200",
        "text-[11px] font-medium tracking-wide",
        enabled
          ? "bg-surface-100 dark:bg-surface-800 text-ink dark:text-ink-inverse"
          : "text-ink-muted dark:text-ink-inverse-muted hover:text-ink dark:hover:text-ink-inverse"
      )}
    >
      <div className={cn(
        "w-2 h-2 rounded-full transition-colors",
        enabled ? "bg-ink dark:bg-ink-inverse" : "bg-ink-muted/30 dark:bg-ink-inverse-muted/30"
      )} />
      Deep Research
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Bubble
// ─────────────────────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: { id: string; role: string; parts: MessagePart[] }
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const citations = useMemo(() => extractCitationsFromParts(message.parts), [message.parts])

  if (isUser) {
    const textParts = message.parts.filter(p => p.type === 'text') as TextUIPart[]
    return (
      <Message from="user">
        <MessageAvatar fallback="U" />
        <MessageContent>
          <p className="text-body-sm leading-relaxed whitespace-pre-wrap">
            {textParts.map(p => p.text).join('')}
          </p>
        </MessageContent>
      </Message>
    )
  }

  const isStreaming = message.parts.some(p => (p as { state?: string }).state === 'streaming')

  return (
    <Message from="assistant">
      <MessageAvatar fallback="R" />
      <MessageContent variant="flat">
        <ChainOfThoughtMessage
          parts={message.parts}
          isStreaming={isStreaming}
          messageId={message.id}
          citations={citations}
        />
      </MessageContent>
    </Message>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Chip
// ─────────────────────────────────────────────────────────────────────────────

function ContextChip({ context, onRemove }: { context: ContextItem; onRemove: () => void }) {
  return (
    <div className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full bg-violet-50 dark:bg-violet-900/20 border border-violet-200/60 dark:border-violet-500/30">
      {context.favicon ? (
        <img src={context.favicon} alt="" className="w-3.5 h-3.5 rounded" />
      ) : (
        <GlobeIcon className="w-3.5 h-3.5 text-violet-500" />
      )}
      <span className="text-[11px] text-ink dark:text-ink-inverse max-w-[140px] truncate">
        {context.name}
      </span>
      <button onClick={onRemove} className="p-0.5 rounded-full hover:bg-violet-100 dark:hover:bg-violet-800/40" aria-label="Remove context">
        <XIcon className="w-2.5 h-2.5 text-violet-400" />
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// URL Badge
// ─────────────────────────────────────────────────────────────────────────────

function UrlBadge({ attachment, onRemove }: { attachment: UrlAttachment; onRemove: () => void }) {
  return (
    <div className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full bg-blue-50 dark:bg-blue-900/20 border border-blue-200/60 dark:border-blue-500/30">
      <img 
        src={attachment.favicon} 
        alt="" 
        className="w-3.5 h-3.5 rounded"
        onError={(e) => {
          e.currentTarget.style.display = 'none'
          e.currentTarget.nextElementSibling?.classList.remove('hidden')
        }}
      />
      <GlobeIcon className="w-3.5 h-3.5 text-blue-500 hidden" />
      <span className="text-[11px] text-ink dark:text-ink-inverse max-w-[160px] truncate">
        {attachment.domain}
      </span>
      <button 
        onClick={onRemove} 
        className="p-0.5 rounded-full hover:bg-blue-100 dark:hover:bg-blue-800/40" 
        aria-label="Remove URL"
      >
        <XIcon className="w-2.5 h-2.5 text-blue-400" />
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Typing Indicator
// ─────────────────────────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1.5 px-4 py-3">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-violet-400"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────

function LayersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function ArrowUpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  )
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

function CodeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  )
}

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  )
}

function BrowserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <circle cx="7" cy="6" r="1" fill="currentColor" />
      <circle cx="10" cy="6" r="1" fill="currentColor" />
    </svg>
  )
}

function SequenceIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

function SwarmIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
      <line x1="9" y1="9" x2="7" y2="7" />
      <line x1="15" y1="9" x2="17" y2="7" />
      <line x1="9" y1="15" x2="7" y2="17" />
      <line x1="15" y1="15" x2="17" y2="17" />
    </svg>
  )
}

function GraphIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="12" cy="18" r="3" />
      <line x1="8" y1="8" x2="10" y2="15" />
      <line x1="16" y1="8" x2="14" y2="15" />
    </svg>
  )
}

export default SuperAgentInterface
