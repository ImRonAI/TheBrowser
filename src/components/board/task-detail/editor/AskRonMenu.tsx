/**
 * AskRonMenu - AI-powered inline editor with context picker
 * Features: Improved readability, more options, context picker, paste-to-attachment
 */

import { useState, useEffect } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { motion, AnimatePresence } from 'framer-motion'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { 
  Sparkles, ArrowRight, X, Check, Wand2, 
  FileText, MessageSquare, Languages, Code
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { ContextPicker, SelectedContexts, ContextItem } from '@/components/agent-panel/ContextPicker'
import { TextAttachmentCard } from '@/components/ai-elements/text-attachment-card'
import { fileToDataUrl, makePastedTextFilename } from '@/utils/file-utils'
import type { TextAttachment } from '@/components/ai-elements/types'

const TASK_AGENT_API = 'http://localhost:8765/agents/task/stream'
const LARGE_PASTE_THRESHOLD_CHARS = 2000

// Options for the menu
const QUICK_OPTIONS = [
  { id: 'fix', icon: Check, label: 'Fix Grammar', prompt: 'Fix spelling and grammar.' },
  { id: 'shorten', icon: FileText, label: 'Make Shorter', prompt: 'Make the text more concise.' },
  { id: 'expand', icon: Wand2, label: 'Expand', prompt: 'Expand on the preceding text with more detail.' },
  { id: 'summarize', icon: MessageSquare, label: 'Summarize', prompt: 'Summarize the preceding text in 2-3 sentences.' },
  { id: 'translate', icon: Languages, label: 'Translate', prompt: 'Translate the text to Spanish.' },
  { id: 'code', icon: Code, label: 'Write Code', prompt: 'Convert the description into working code.' },
]

const FUNNY_QUOTES = [
  "Deep Research IN THIS ECONOMY?! Fine... brb..",
  "Consulting the oracle...",
  "Trying to understand your code...",
  "Asking the elders of the internet...",
  "Pretending to work hard...",
  "Reticulating splines...",
  "Summoning the AI spirits...",
]

interface AskRonMenuProps {
  node: {
    attrs: {
      taskId?: string
      defaultAction?: 'fix' | 'expand' | null
    }
  }
  deleteNode: () => void
  editor: any
  getPos: () => number | undefined
}

export function AskRonMenu({ node, deleteNode, editor, getPos }: AskRonMenuProps) {
  const [mode, setMode] = useState<'menu' | 'input' | 'loading' | 'done'>('menu')
  const [customPrompt, setCustomPrompt] = useState('')
  const [loadingQuote, setLoadingQuote] = useState(FUNNY_QUOTES[0])
  const [selectedContexts, setSelectedContexts] = useState<ContextItem[]>([])
  const [textAttachments, setTextAttachments] = useState<TextAttachment[]>([])

  const { sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: TASK_AGENT_API,
      body: () => ({
        session_id: node.attrs.taskId || 'default-ask-ron'
      }),
    }),
    onFinish: (message: any) => {
        setTimeout(() => {
             let text = ''
             if (message.content) {
                 text = message.content
             } else if (message.parts) {
                 text = message.parts
                    .filter((p: any) => p.type === 'text')
                    .map((p: any) => p.text)
                    .join('')
             }
             replaceNodeWithResult(text)
        }, 800)
    }
  })

  useEffect(() => {
    if (status === 'streaming') {
        setMode('loading')
    }
  }, [status])

  // Rotate quotes during loading
  useEffect(() => {
    if (mode === 'loading') {
      const interval = setInterval(() => {
        setLoadingQuote(FUNNY_QUOTES[Math.floor(Math.random() * FUNNY_QUOTES.length)])
      }, 2500)
      return () => clearInterval(interval)
    }
  }, [mode])

  // Handle auto-action if provided
  useEffect(() => {
    if (node.attrs.defaultAction && mode === 'menu') {
        const action = node.attrs.defaultAction
        if (action === 'fix') triggerRequest("Fix spelling and grammar in the preceding text.")
        else if (action === 'expand') triggerRequest("Expand on the preceding text with more detail.")
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const triggerRequest = (prompt: string) => {
    setMode('loading')
    
    const pos = getPos() ?? 0
    const docBefore = editor.state.doc.textBetween(Math.max(0, pos - 1500), pos, '\n')
    
    // Build context from selected items
    const contextStr = selectedContexts.length > 0 
      ? `\n\nAdditional Context:\n${selectedContexts.map(c => `- ${c.type}: ${c.name}${c.description ? ` (${c.description})` : ''}`).join('\n')}`
      : ''
    
    // Build attachment info for prompt (for context)
    const attachmentStr = textAttachments.length > 0
      ? `\n\nAttached Files:\n${textAttachments.map(a => `- ${a.file.name}: [content attached below]`).join('\n')}`
      : ''
    
    const systemContent = `[System] Task ID: "${node.attrs.taskId}".
The user is asking for an edit or generation based on the following context (text preceding the cursor):
"${docBefore}"
${contextStr}${attachmentStr}

Instruction: ${prompt}

Return ONLY the result text. Do not include "Here is the text" or quotes.`

    // AI SDK v6: Convert attachments to FileUIPart format for sendMessage
    // FileUIPart = { type: 'file', mediaType: string, filename?: string, url: string (data URL) }
    let files: { type: 'file'; mediaType: string; filename: string; url: string }[] | undefined
    
    if (textAttachments.length > 0) {
      files = textAttachments.map((item) => ({
        type: 'file' as const,
        mediaType: item.file.type || 'text/plain',
        filename: item.file.name,
        url: item.dataUrl,  // Already a data URL from handlePaste
      }))
    }

    // Send message with files array in AI SDK v6 format
    sendMessage({ 
      text: systemContent,
      files,
    } as any)
    
    // Clear attachments after sending
    setTextAttachments([])
  }

  const replaceNodeWithResult = (text: string) => {
    const pos = getPos() ?? 0
    editor.chain()
      .focus()
      .deleteRange({ from: pos, to: pos + 1 }) 
      .insertContent(text)
      .run()
  }

  const handleCustomSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!customPrompt.trim()) return
    triggerRequest(customPrompt)
  }

  // Handle paste for large text attachments
  const handlePaste = async (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text/plain')
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

  const handleAttachmentRemove = (id: string) => {
    setTextAttachments(prev => prev.filter(a => a.id !== id))
  }

  return (
    <NodeViewWrapper className="my-3 relative z-50">
      <AnimatePresence mode="wait">
        
        {/* MENU MODE */}
        {mode === 'menu' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex flex-col w-full max-w-sm bg-surface-0 dark:bg-surface-800 backdrop-blur-xl border border-surface-200 dark:border-surface-700 shadow-xl rounded-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-100 dark:border-surface-700/50 bg-gradient-to-r from-accent/5 to-transparent dark:from-accent-light/5">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-accent/10 dark:bg-accent-light/10 flex items-center justify-center">
                  <Sparkles size={14} className="text-accent dark:text-accent-light" />
                </div>
                <span className="text-sm font-semibold text-ink dark:text-ink-inverse">Ask Ron</span>
              </div>
              <button 
                onClick={deleteNode} 
                aria-label="Close" 
                className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-ink-muted dark:text-ink-inverse-muted transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            
            {/* Quick Options Grid */}
            <div className="p-2 grid grid-cols-2 gap-1.5">
              {QUICK_OPTIONS.map(opt => (
                <button 
                  key={opt.id}
                  onClick={() => triggerRequest(opt.prompt)}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left",
                    "text-sm font-medium text-ink dark:text-ink-inverse",
                    "hover:bg-surface-100 dark:hover:bg-surface-700",
                    "transition-all duration-150",
                    "group"
                  )}
                >
                  <div className="w-8 h-8 rounded-lg bg-surface-100 dark:bg-surface-700 flex items-center justify-center group-hover:bg-accent/10 dark:group-hover:bg-accent-light/10 transition-colors">
                    <opt.icon size={16} className="text-ink-muted dark:text-ink-inverse-muted group-hover:text-accent dark:group-hover:text-accent-light transition-colors" />
                  </div>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
            
            {/* Something Else Button */}
            <div className="px-2 pb-2">
              <button 
                onClick={() => setMode('input')}
                className={cn(
                  "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl",
                  "bg-accent/10 dark:bg-accent-light/10 text-accent dark:text-accent-light",
                  "hover:bg-accent/20 dark:hover:bg-accent-light/20",
                  "text-sm font-medium transition-colors"
                )}
              >
                <Wand2 size={14} />
                Something Else...
              </button>
            </div>
          </motion.div>
        )}

        {/* INPUT MODE */}
        {mode === 'input' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex flex-col w-full max-w-md bg-surface-0 dark:bg-surface-800 border border-accent/30 dark:border-accent-light/30 rounded-2xl shadow-xl overflow-hidden ring-2 ring-accent/10 dark:ring-accent-light/10"
          >
            {/* Header Row */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-surface-100 dark:border-surface-700/50">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-accent dark:text-accent-light" />
                <span className="text-xs font-semibold text-ink-muted dark:text-ink-inverse-muted uppercase tracking-wider">Custom Prompt</span>
              </div>
              <button 
                onClick={() => setMode('menu')} 
                aria-label="Back" 
                className="text-xs text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse transition-colors"
              >
                ← Back
              </button>
            </div>
            
            {/* Context Chips */}
            {selectedContexts.length > 0 && (
              <div className="px-3 pt-2">
                <SelectedContexts 
                  contexts={selectedContexts} 
                  onRemove={(id) => setSelectedContexts(prev => prev.filter(c => c.id !== id))} 
                />
              </div>
            )}
            
            {/* Text Attachments */}
            {textAttachments.length > 0 && (
              <div className="px-3 pt-2 flex flex-wrap gap-2">
                {textAttachments.map(att => (
                  <TextAttachmentCard 
                    key={att.id} 
                    attachment={att} 
                    onRemove={handleAttachmentRemove}
                    className="max-w-[120px]"
                  />
                ))}
              </div>
            )}
            
            {/* Input Row */}
            <div className="flex items-center gap-2 px-3 py-3">
              <ContextPicker 
                selectedContexts={selectedContexts} 
                onContextsChange={setSelectedContexts} 
              />
              
              <input 
                autoFocus
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                onKeyDown={e => {
                    if(e.key === 'Enter') handleCustomSubmit()
                    if(e.key === 'Escape') setMode('menu')
                }}
                onPaste={handlePaste}
                placeholder="Tell Ron what to write..."
                className="flex-1 bg-transparent border-none outline-none text-sm text-ink dark:text-ink-inverse placeholder:text-ink-muted/50"
              />
              
              <button 
                onClick={() => handleCustomSubmit()}
                disabled={!customPrompt.trim()}
                aria-label="Send"
                className={cn(
                  "p-2 rounded-xl transition-all",
                  customPrompt.trim() 
                    ? "bg-accent dark:bg-accent-light text-white hover:opacity-90" 
                    : "bg-surface-100 dark:bg-surface-700 text-ink-muted dark:text-ink-inverse-muted"
                )}
              >
                <ArrowRight size={16} />
              </button>
            </div>
          </motion.div>
        )}

        {/* LOADING MODE */}
        {mode === 'loading' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="flex flex-col items-center justify-center p-8 bg-surface-0 dark:bg-surface-800 backdrop-blur-md rounded-2xl border border-surface-200 dark:border-surface-700 shadow-xl max-w-sm mx-auto text-center gap-5"
          >
            {/* Animated Spinner */}
            <div className="relative w-16 h-16">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0 rounded-full border-2 border-dashed border-accent/20 dark:border-accent-light/20"
              />
              <motion.div
                animate={{ rotate: -360 }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                className="absolute inset-2 rounded-full border-2 border-accent/40 dark:border-accent-light/40 border-t-accent dark:border-t-accent-light"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles size={20} className="text-accent dark:text-accent-light" />
              </div>
            </div>
             
            <motion.p 
              key={loadingQuote}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm font-medium text-ink-muted dark:text-ink-inverse-muted italic"
            >
              "{loadingQuote}"
            </motion.p>
          </motion.div>
        )}

      </AnimatePresence>
    </NodeViewWrapper>
  )
}
