/**
 * AskRonPrompt Component
 *
 * Text input with TTS option for "Something else" in Ask Ron flow.
 * Follows design patterns from prompt-input.tsx.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/cn'
import { Loader } from './loader'
import { RonExtractionInline } from './ron-extraction'

const EASE = [0.16, 1, 0.3, 1] as const

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AskRonPromptProps {
  /** The original selected text for context */
  selectedText: string
  /** The URL where the text was selected from */
  sourceUrl: string
  /** Callback when user submits their prompt */
  onSubmit: (prompt: string) => void
  /** Callback to go back to options */
  onBack: () => void
  /** Callback to close/cancel */
  onClose: () => void
  /** Whether currently submitting */
  isSubmitting?: boolean
  /** Additional class names */
  className?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// AskRonPrompt - Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function AskRonPrompt({
  selectedText,
  sourceUrl,
  onSubmit,
  onBack,
  onClose,
  isSubmitting = false,
  className,
}: AskRonPromptProps) {
  const [value, setValue] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [recordingText, setRecordingText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // Parse hostname safely
  let hostname = 'this page'
  try {
    hostname = new URL(sourceUrl).hostname
  } catch {
    // Keep default
  }

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || isSubmitting) return
    onSubmit(trimmed)
  }, [value, isSubmitting, onSubmit])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      onClose()
    }
  }

  // Speech recognition
  const startRecording = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (!SpeechRecognitionAPI) {
      console.warn('Speech recognition not supported')
      return
    }

    const recognition = new SpeechRecognitionAPI()

    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => {
      setIsRecording(true)
      setRecordingText('')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let interimTranscript = ''
      let finalTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTranscript += transcript
        } else {
          interimTranscript += transcript
        }
      }

      if (finalTranscript) {
        setValue(prev => prev + finalTranscript)
      }
      setRecordingText(interimTranscript)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error)
      setIsRecording(false)
      setRecordingText('')
    }

    recognition.onend = () => {
      setIsRecording(false)
      setRecordingText('')
    }

    recognitionRef.current = recognition
    recognition.start()
  }, [])

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
  }, [])

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: 8 }}
      transition={{ duration: 0.2, ease: EASE }}
      className={cn('w-full max-w-sm', className)}
    >
      <div className={cn(
        'rounded-2xl overflow-hidden',
        'bg-surface-0 dark:bg-surface-900',
        'border border-surface-200 dark:border-surface-700',
        'shadow-lg'
      )}>
        {/* Header */}
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={onBack}
                aria-label="Go back"
                className={cn(
                  'p-1 rounded-md',
                  'text-ink-muted dark:text-ink-inverse-muted',
                  'hover:bg-surface-100 dark:hover:bg-surface-800',
                  'hover:text-ink dark:hover:text-ink-inverse',
                  'transition-colors duration-200'
                )}
              >
                <BackIcon className="w-4 h-4" />
              </button>
              <RonExtractionInline isThinking={isSubmitting} thinkingText="Processing..." />
              {!isSubmitting && (
                <span className="text-body-sm font-medium text-ink dark:text-ink-inverse">
                  What would you like?
                </span>
              )}
            </div>

            <button
              onClick={onClose}
              aria-label="Close"
              className={cn(
                'p-1 rounded-md',
                'text-ink-muted dark:text-ink-inverse-muted',
                'hover:bg-surface-100 dark:hover:bg-surface-800',
                'hover:text-ink dark:hover:text-ink-inverse',
                'transition-colors duration-200'
              )}
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          </div>

          {/* Context reminder */}
          <div className={cn(
            'mt-3 p-2.5 rounded-lg',
            'bg-surface-50 dark:bg-surface-850'
          )}>
            <p className="text-label text-ink-muted dark:text-ink-inverse-muted mb-1">
              Selected from {hostname}
            </p>
            <p className="text-body-xs text-ink-secondary dark:text-ink-inverse-secondary line-clamp-1 italic">
              "{selectedText}"
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-surface-200 dark:bg-surface-700" />

        {/* Input area */}
        <div className="p-3">
          <div className={cn(
            'rounded-xl overflow-hidden',
            'bg-surface-50 dark:bg-surface-850',
            'border border-surface-200 dark:border-surface-700',
            'focus-within:border-accent dark:focus-within:border-accent-light',
            'focus-within:ring-2 focus-within:ring-accent/20 dark:focus-within:ring-accent-light/20',
            'transition-all duration-200'
          )}>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tell Ron what you want to do with this text..."
              disabled={isSubmitting}
              rows={3}
              className={cn(
                'w-full px-3 py-2.5 bg-transparent',
                'text-body-sm text-ink dark:text-ink-inverse',
                'placeholder:text-ink-muted dark:placeholder:text-ink-inverse-muted',
                'resize-none focus:outline-none',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            />

            {/* Recording indicator */}
            <AnimatePresence>
              {isRecording && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="px-3 pb-2"
                >
                  <div className="flex items-center gap-2 text-body-xs text-accent dark:text-accent-light">
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}
                      className="w-2 h-2 rounded-full bg-red-500"
                    />
                    <span>{recordingText || 'Listening...'}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Footer with actions */}
            <div className={cn(
              'flex items-center justify-between gap-2',
              'px-2 py-2',
              'border-t border-surface-200 dark:border-surface-700'
            )}>
              {/* Voice button */}
              <motion.button
                onClick={toggleRecording}
                disabled={isSubmitting}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={cn(
                  'p-2 rounded-lg',
                  'transition-colors duration-200',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  isRecording
                    ? 'bg-red-500/10 text-red-500 dark:text-red-400'
                    : 'text-ink-muted dark:text-ink-inverse-muted hover:bg-surface-100 dark:hover:bg-surface-700'
                )}
                title={isRecording ? 'Stop recording' : 'Start voice input'}
              >
                <MicIcon className="w-4 h-4" />
              </motion.button>

              {/* Submit button */}
              <motion.button
                onClick={handleSubmit}
                disabled={!value.trim() || isSubmitting}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={cn(
                  'w-8 h-8 rounded-lg',
                  'bg-accent dark:bg-accent-light text-white',
                  'flex items-center justify-center',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'transition-all duration-200'
                )}
              >
                {isSubmitting ? (
                  <Loader size={14} />
                ) : (
                  <SendIcon className="w-4 h-4" />
                )}
              </motion.button>
            </div>
          </div>
        </div>

        {/* Footer hint */}
        <div className="px-4 pb-3">
          <p className="text-center text-label text-ink-muted/60 dark:text-ink-inverse-muted/60">
            <kbd className="px-1 py-0.5 rounded text-label bg-surface-100 dark:bg-surface-800 font-mono">Enter</kbd>
            {' '}to send &middot;{' '}
            <kbd className="px-1 py-0.5 rounded text-label bg-surface-100 dark:bg-surface-800 font-mono">Esc</kbd>
            {' '}to cancel
          </p>
        </div>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────

function BackIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('w-full h-full', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 19l-7-7 7-7" />
    </svg>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('w-full h-full', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('w-full h-full', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('w-full h-full', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

export default AskRonPrompt
