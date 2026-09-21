/**
 * Ron Tab - Premium AI Chat Interface
 *
 * Redesigned to match SuperAgentInterface aesthetic:
 * - Neural grid ambient background with breathing glow
 * - Dark rich purple color scheme
 * - Glassmorphism effects
 * - Full immersive chat experience
 */

import { useState, useRef, useEffect, useMemo, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/cn'
import type { FullTask, TaskConversation } from '@/pages/types/task'
import { useTaskStore } from '@/stores/taskStore'

// AI SDK v6 - useChat with DefaultChatTransport for UIMessageStream
import { useChat, type UIMessage } from '@ai-sdk/react'
import { DefaultChatTransport, type TextUIPart, isToolUIPart } from 'ai'
import { ChainOfThoughtMessage } from '@/components/ai-elements/chain-of-thought-message'
import { useOrchestrationStore } from '@/stores/orchestrationStore'
import { handleOrchestrationDataPart } from '@/utils/orchestration-stream'
import {
  Plus as PlusIconLucide,
  History as HistoryIcon,
  ChevronDown as ChevronDownIcon
} from 'lucide-react'

// Suggestions from AI Elements
import { Suggestions, Suggestion } from '@/components/ai-elements/suggestion'

// Context Picker
import { ContextPicker, type ContextItem } from '@/components/agent-panel/ContextPicker'

// Text Attachment Components
import { TextAttachmentCard } from '@/components/ai-elements/text-attachment-card'
import { fileToDataUrl, makePastedTextFilename } from '@/utils/file-utils'
import type { TextAttachment } from '@/components/ai-elements/types'

// Preview Panel
import { PreviewPanel } from '@/components/ai-elements/preview-panel'
import { usePreviewStore } from '@/stores/previewStore'
import type { Citation } from '@/components/ai-elements/response-with-citations'
import { Message, MessageAvatar, MessageContent } from '@/components/ai-elements/message'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

interface RonTabProps {
  task: FullTask
}

interface UrlAttachment {
  id: string
  url: string
  domain: string
  favicon: string
}

// API endpoint for task agent (project manager flavor)
const TASK_AGENT_API = 'http://localhost:8765/agents/task/stream'

const LARGE_PASTE_THRESHOLD_CHARS = 2000
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi

type MessagePart = UIMessage['parts'][number]
type ToolLikePart = {
  state?: string
  output?: any
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

function extractCitationsFromParts(parts: MessagePart[]): Citation[] {
  let citations: Citation[] = []

  for (const part of parts) {
    if (!isToolUIPart(part)) continue
    const toolPart = part as ToolLikePart
    if (toolPart.state !== 'output-available' || toolPart.output == null) continue

    const output = toolPart.output as any
    let incoming: Citation[] = []

    if (Array.isArray(output?.flat_results)) {
      incoming = output.flat_results
        .map((result: any, index: number) => {
          if (!result) return null
          return {
            number: String(index + 1),
            title: result.title || 'Untitled',
            url: result.url || '',
            snippet: result.snippet,
          } as Citation
        })
        .filter((item: Citation | null): item is Citation => Boolean(item && item.url))
    }

    if (incoming.length === 0) {
      const raw =
        output?.citations ||
        output?.sources ||
        output?.links ||
        output?.results ||
        output?.items ||
        output
      incoming = normalizeCitations(raw)
    }

    citations = mergeCitations(citations, incoming)
  }

  return citations
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function RonTab({ task }: RonTabProps) {
  // Store Access
  const updateTask = useTaskStore(state => state.updateTask)
  
  // State for conversation management
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)

  // 1. INITIALIZATION ONLY
  useEffect(() => {
    if (activeConversationId) return 

    if (task.conversations && task.conversations.length > 0) {
      const sorted = [...task.conversations].sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      setActiveConversationId(sorted[0].id)
    } else {
      const newId = `conv-${Date.now()}`
      setActiveConversationId(newId)
    }
  }, []) // Empty dependency array = absolute safety from render loops.


  // 2. CHAT HOOK - AI SDK v6 compatible
  const [input, setInput] = useState('')
  
  const { messages, setMessages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: TASK_AGENT_API,
      body: () => ({
        session_id: activeConversationId
          ? `task-${task.id}-${activeConversationId}`
          : `task-${task.id}-new`,
      }),
    }),
    id: activeConversationId || 'new',
    onData: (dataPart) => {
      handleOrchestrationDataPart(dataPart as { type: string; data?: any })
    },
    onFinish: () => {
      if (!activeConversationId) return
      
      const fullHistory = messages || []
      const existingConvs = task.conversations || []
      const currentConv = existingConvs.find(c => c.id === activeConversationId)
      
      const newConv: TaskConversation = {
        id: activeConversationId,
        taskId: task.id,
        createdAt: currentConv?.createdAt || Date.now(),
        lastActiveAt: Date.now(),
        messageCount: fullHistory.length,
        messages: fullHistory as any
      }
      
      const others = existingConvs.filter(c => c.id !== activeConversationId)
      
      // Update global store
      updateTask(task.id, { conversations: [newConv, ...others] })
    }
  })

  // 3. LOAD MESSAGES ON SWITCH
  useEffect(() => {
    if (!activeConversationId) return
    
    const conv = task.conversations?.find(c => c.id === activeConversationId)
    if (conv) {
       setMessages(conv.messages as any)
    } else {
       setMessages([])
    }
  }, [activeConversationId])


  // 4. AUTO SCROLL
  const messagesEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])


  // 5. EVENT HANDLERS
  const handleCreateNewChat = () => {
    const newId = `conv-${Date.now()}`
    setActiveConversationId(newId)
    setMessages([])
    setIsHistoryOpen(false)
    useOrchestrationStore.getState().reset()
  }

  const handleSwitchChat = (convId: string) => {
    const conv = task.conversations?.find(c => c.id === convId)
    if (conv) {
      setActiveConversationId(convId)
      setMessages(conv.messages as any)
    }
    setIsHistoryOpen(false)
    useOrchestrationStore.getState().reset()
  }
  
  // 6. INPUT STATE (Attachments/Context)
  const [selectedContexts, setSelectedContexts] = useState<ContextItem[]>([])
  const [textAttachments, setTextAttachments] = useState<TextAttachment[]>([])
  const [urlAttachments, setUrlAttachments] = useState<UrlAttachment[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  
  const isTyping = status === 'streaming' || status === 'submitted'
  const isEmpty = messages.length === 0
  const isAmbientActive = isTyping

  // Focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300)
  }, [])

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleCustomSubmit()
    }
  }

  // Custom submit to handle context injection
  const handleCustomSubmit = async (text?: string) => {
    const messageText = text || input.trim()
    const canSend = status === 'ready' || status === 'error'
    if ((!messageText && textAttachments.length === 0) || !canSend) return

    // Ensure we have an active ID
    if (!activeConversationId) {
        setActiveConversationId(`conv-${Date.now()}`)
    }

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
            const textContent = [
              `Title: ${data.title}`,
              `URL: ${data.url}`,
              `\n--- PAGE TEXT CONTENT ---\n${data.dom?.text || ''}`,
              `\n--- PAGE HTML SOURCE ---\n${data.dom?.html?.slice(0, 50000) || ''}`
            ].join('\n')

            try {
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

    // Include task context
    finalMessage = `[System] Task Context: ID="${task.id}" Title="${task.title}" Status="${task.status}"\n\n${finalMessage}`

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
    
    setInput('')
    setTextAttachments([])
    setUrlAttachments([])
    setSelectedContexts([])
    
    sendMessage({ text: finalMessage || 'Sent with attachments', files } as any)
  }

  // Preview panel state
  const isPreviewOpen = usePreviewStore(state => state.isOpen)

  return (
    <div className="h-full flex flex-col relative overflow-hidden bg-surface-950">
      <NeuralGridBackground isActive={isAmbientActive} />
      <AmbientBreathingGlow />

      {/* Header Toolbar */}
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="relative z-10 flex-shrink-0 px-6 py-4 flex items-center justify-between border-b border-surface-800/50 bg-surface-900/80 backdrop-blur-xl"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-surface-800 flex items-center justify-center border border-surface-700">
            <RonIcon className="w-4 h-4 text-ink-inverse" />
          </div>
          <span className="text-body-md font-semibold text-ink-inverse font-display">
            Ron
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* History Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsHistoryOpen(!isHistoryOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-surface-800 text-sm font-medium text-ink-inverse/80 transition-colors"
              aria-label="History"
            >
              <HistoryIcon size={14} className="text-ink-inverse/50" />
              <span className="truncate max-w-[150px]">
                {(messages[0]?.parts?.find((p: any) => p.type === 'text') as any)?.text?.slice(0, 20) + '...' || 'New Chat'}
              </span>
              <ChevronDownIcon size={14} className={cn("text-ink-inverse/50 transition-transform", isHistoryOpen && "rotate-180")} />
            </button>

            <AnimatePresence>
              {isHistoryOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute top-full right-0 mt-2 w-64 p-2 rounded-xl bg-surface-900/95 border border-surface-700/50 shadow-2xl backdrop-blur-xl"
                >
                  <div className="flex items-center justify-between px-2 pb-2 mb-2 border-b border-surface-800/50">
                     <span className="text-[10px] font-bold uppercase text-ink-inverse/40">Recent Chats</span>
                     <button 
                       onClick={handleCreateNewChat} 
                       className="p-1 hover:bg-surface-800 rounded-md text-ink-inverse/60"
                       aria-label="New Chat"
                     >
                       <PlusIconLucide size={14} />
                     </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {task.conversations?.map(c => (
                      <button
                        key={c.id}
                        onClick={() => handleSwitchChat(c.id)}
                        className={cn(
                          "w-full text-left px-2 py-2 rounded-lg text-xs truncate transition-colors",
                          activeConversationId === c.id 
                            ? "bg-violet-500/20 text-violet-300 font-medium" 
                            : "hover:bg-surface-800 text-ink-inverse/60"
                        )}
                      >
                        {c.messages[0]?.content || 'Empty Chat'}
                        <div className="text-[9px] opacity-60 mt-0.5">
                          {new Date(c.lastActiveAt).toLocaleDateString()}
                        </div>
                      </button>
                    ))}
                    {(!task.conversations || task.conversations.length === 0) && (
                      <div className="text-center py-4 text-xs text-ink-inverse/40">No history</div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            onClick={handleCreateNewChat}
            className="p-2 rounded-lg text-ink-inverse/60 hover:text-ink-inverse hover:bg-surface-800 transition-colors"
            title="New conversation"
          >
            <PlusIconLucide className="w-4 h-4" />
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
                task={task}
                onSuggestionClick={handleCustomSubmit}
              />
            ) : (
              <motion.div
                key="messages"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-6 py-6 space-y-6"
              >
                <div className="max-w-3xl mx-auto space-y-6">
                  {messages.map((message) => (
                    <MessageBubble key={message.id} message={message} />
                  ))}
                  
                  {isTyping && messages[messages.length - 1]?.role === 'user' && (
                    <TypingIndicator />
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input Area */}
          <div className={cn(
            "flex-shrink-0 px-6 pb-6 pt-2",
            isEmpty && "flex-1 flex flex-col items-center justify-center"
          )}>
            <div className={cn("w-full", isEmpty ? "max-w-2xl" : "max-w-3xl mx-auto")}>
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
                  "command-nexus relative rounded-2xl transition-all duration-300",
                  "bg-surface-900/60",
                  "border",
                  input 
                    ? "border-violet-500/40 shadow-[0_0_30px_rgba(139,92,246,0.15)]" 
                    : "border-surface-700/50",
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
                      "text-body-md text-ink-inverse",
                      "placeholder:text-ink-inverse/30",
                      "outline-none",
                      "min-h-[28px] max-h-32",
                    )}
                  />
                  
                  <motion.button
                    onClick={() => handleCustomSubmit()}
                    disabled={(!input.trim() && textAttachments.length === 0) || (status !== 'ready' && status !== 'error')}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={cn(
                      "flex-shrink-0 w-8 h-8 rounded-xl",
                      "flex items-center justify-center",
                      "transition-all duration-300",
                      (input.trim() || textAttachments.length > 0) && status === 'ready'
                        ? "bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/25"
                        : "bg-surface-700 text-ink-inverse/20"
                    )}
                  >
                    <ArrowUpIcon className="w-4 h-4" />
                  </motion.button>
                </div>
              </div>

              <p className="text-center text-[11px] text-ink-inverse/30 mt-3 tracking-wide">
                ↵ to send
              </p>
            </div>
          </div>
        </div>

        {/* New AI Preview Panel */}
        <AnimatePresence>
          {isPreviewOpen && (
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
              "fill-violet-500",
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

// ─────────────────────────────────────────────────────────────────────────────
// Empty State
// ─────────────────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  task: FullTask
  onSuggestionClick: (text: string) => void
}

function EmptyState({ task, onSuggestionClick }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 flex flex-col items-center justify-center px-6 pb-32"
    >
      {/* Icon */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="relative mb-8"
      >
        <div className="w-20 h-20 rounded-2xl bg-surface-800 flex items-center justify-center border border-surface-700">
          <span className="text-3xl font-display font-light text-ink-inverse">R</span>
        </div>
        <motion.div
          className="absolute inset-0 rounded-2xl border border-violet-500/30"
          animate={{ scale: [1, 1.3], opacity: [0.5, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
        />
      </motion.div>

      {/* Task Context */}
      <motion.p
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="text-body-sm text-ink-inverse/50 text-center mb-8 max-w-md"
      >
        Task: <span className="text-ink-inverse font-medium">"{task.title}"</span>
      </motion.p>

      {/* Suggestions using AI Elements */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
      >
        <Suggestions layout="wrap" className="max-w-xl justify-center">
          <Suggestion suggestion="Summarize this task" onClick={onSuggestionClick} icon="✦" />
          <Suggestion suggestion="Draft a status update" onClick={onSuggestionClick} icon="✎" />
          <Suggestion suggestion="What are the next steps?" onClick={onSuggestionClick} icon="→" />
          <Suggestion suggestion="Show agent orchestration" onClick={onSuggestionClick} icon="◎" />
        </Suggestions>
      </motion.div>
    </motion.div>
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
          <p className="text-body-sm leading-relaxed whitespace-pre-wrap text-ink-inverse">
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
    <div className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full bg-violet-500/10 border border-violet-500/30">
      {context.favicon ? (
        <img src={context.favicon} alt="" className="w-3.5 h-3.5 rounded" />
      ) : (
        <GlobeIcon className="w-3.5 h-3.5 text-violet-400" />
      )}
      <span className="text-[11px] text-ink-inverse max-w-[140px] truncate">
        {context.name}
      </span>
      <button onClick={onRemove} className="p-0.5 rounded-full hover:bg-violet-500/20" aria-label="Remove context">
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
    <div className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full bg-blue-500/10 border border-blue-500/30">
      <img 
        src={attachment.favicon} 
        alt="" 
        className="w-3.5 h-3.5 rounded"
        onError={(e) => {
          e.currentTarget.style.display = 'none'
          e.currentTarget.nextElementSibling?.classList.remove('hidden')
        }}
      />
      <GlobeIcon className="w-3.5 h-3.5 text-blue-400 hidden" />
      <span className="text-[11px] text-ink-inverse max-w-[160px] truncate">
        {attachment.domain}
      </span>
      <button 
        onClick={onRemove} 
        className="p-0.5 rounded-full hover:bg-blue-500/20" 
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

function RonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8" />
      <path d="M12 8v8" />
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

export default RonTab
