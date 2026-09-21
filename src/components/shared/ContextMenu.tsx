import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAgentUi } from '@/context/AgentUiContext'
import { useTabStore } from '@/stores/tabStore'
import { AskRonOptions } from '@/components/ai-elements/ask-ron-options'
import { AskRonPrompt } from '@/components/ai-elements/ask-ron-prompt'
import { InterestsContextItems } from '@/components/interests/InterestsContextItems'
import {
  ClipboardDocumentIcon,
  ScissorsIcon,
  ClipboardIcon,
  ChatBubbleLeftIcon,
  CheckIcon,
} from '@heroicons/react/24/outline'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ContextMenuProps {
  x: number
  y: number
  isOpen: boolean
  onClose: () => void
  selectedText?: string
}

export function ContextMenu({ x, y, isOpen, onClose, selectedText }: ContextMenuProps) {
  const {
    startAskRon,
    askRonStep,
    askRonSelectedText,
    askRonSourceUrl,
    askRonOptions,
    askRonThinkingText,
    setAskRonStep,
    selectAskRonOption,
    submitCustomAskRon,
    closeAskRon,
  } = useAgentUi()
  const { getActiveTab } = useTabStore()
  const [copiedFeedback, setCopiedFeedback] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Adjust position to keep menu within viewport
  const [adjustedPosition, setAdjustedPosition] = useState({ x, y })

  useEffect(() => {
    if (isOpen && menuRef.current) {
      const menuRect = menuRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      let newX = x
      let newY = y

      // Adjust horizontal position
      if (x + menuRect.width > viewportWidth - 10) {
        newX = viewportWidth - menuRect.width - 10
      }

      // Adjust vertical position
      if (y + menuRect.height > viewportHeight - 10) {
        newY = viewportHeight - menuRect.height - 10
      }

      setAdjustedPosition({ x: newX, y: newY })
    } else {
      setAdjustedPosition({ x, y })
    }
  }, [isOpen, x, y])

  // Reset state when context menu opens
  useEffect(() => {
    if (isOpen) {
      setCopiedFeedback(null)
    } else {
      // Close Ask Ron UI when context menu closes
      closeAskRon()
    }
  }, [isOpen, closeAskRon])

  const showFeedback = (action: string) => {
    setCopiedFeedback(action)
    setTimeout(() => setCopiedFeedback(null), 1500)
  }

  const handleCopy = async () => {
    if (selectedText) {
      try {
        await navigator.clipboard.writeText(selectedText)
        showFeedback('Copied!')
        setTimeout(onClose, 300)
      } catch (err) {
        console.error('Failed to copy:', err)
        onClose()
      }
    } else {
      onClose()
    }
  }

  const handleCopyMarkdown = async () => {
    if (selectedText) {
      try {
        // Wrap in backticks for markdown code
        await navigator.clipboard.writeText(`\`${selectedText}\``)
        showFeedback('Copied as Markdown!')
        setTimeout(onClose, 300)
      } catch (err) {
        console.error('Failed to copy:', err)
        onClose()
      }
    } else {
      onClose()
    }
  }

  const handleCut = async () => {
    if (selectedText) {
      try {
        await navigator.clipboard.writeText(selectedText)
        // Execute cut command to remove selected text
        document.execCommand('cut')
        showFeedback('Cut!')
        setTimeout(onClose, 300)
      } catch (err) {
        console.error('Failed to cut:', err)
        onClose()
      }
    } else {
      onClose()
    }
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      // Get the active element and paste
      const activeElement = document.activeElement as HTMLInputElement | HTMLTextAreaElement
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
        const start = activeElement.selectionStart || 0
        const end = activeElement.selectionEnd || 0
        const currentValue = activeElement.value
        activeElement.value = currentValue.substring(0, start) + text + currentValue.substring(end)
        activeElement.selectionStart = activeElement.selectionEnd = start + text.length
        // Trigger input event for React
        activeElement.dispatchEvent(new Event('input', { bubbles: true }))
        showFeedback('Pasted!')
        setTimeout(onClose, 300)
      } else {
        // Try execCommand for contenteditable elements
        document.execCommand('insertText', false, text)
        showFeedback('Pasted!')
        setTimeout(onClose, 300)
      }
    } catch (err) {
      console.error('Failed to paste:', err)
      onClose()
    }
  }

  const handleAskRon = () => {
    if (!selectedText) return

    // Get the current tab URL
    const activeTab = getActiveTab()
    const sourceUrl = activeTab?.url || window.location.href

    // Start the Ask Ron flow
    startAskRon(selectedText, sourceUrl)
  }

  const handleCloseAskRon = () => {
    closeAskRon()
    onClose()
  }

  // Close on escape key for the custom Ask Ron panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen && askRonStep !== 'closed') {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, askRonStep, onClose])

  // Determine if Ask Ron UI should be shown
  const showAskRonUI = askRonStep !== 'closed'

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop to catch clicks */}
          <div className="fixed inset-0 z-[100]" onClick={showAskRonUI ? handleCloseAskRon : onClose} />

          {/* Ask Ron UI - Options or Custom Prompt */}
          {showAskRonUI ? (
            <motion.div
              className="fixed z-[9999]"
              style={{
                left: `${adjustedPosition.x}px`,
                top: `${adjustedPosition.y}px`,
              }}
            >
              <AnimatePresence mode="wait">
                {(askRonStep === 'loading' || askRonStep === 'options') && askRonSelectedText && askRonSourceUrl && (
                  <AskRonOptions
                    key="options"
                    selectedText={askRonSelectedText}
                    sourceUrl={askRonSourceUrl}
                    isLoading={askRonStep === 'loading'}
                    thinkingText={askRonThinkingText}
                    options={askRonOptions}
                    onSelectOption={selectAskRonOption}
                    onSelectSomethingElse={() => setAskRonStep('custom-prompt')}
                    onClose={handleCloseAskRon}
                  />
                )}
                {askRonStep === 'custom-prompt' && askRonSelectedText && askRonSourceUrl && (
                  <AskRonPrompt
                    key="prompt"
                    selectedText={askRonSelectedText}
                    sourceUrl={askRonSourceUrl}
                    onSubmit={submitCustomAskRon}
                    onBack={() => setAskRonStep('options')}
                    onClose={handleCloseAskRon}
                    isSubmitting={false}
                  />
                )}
                {askRonStep === 'executing' && askRonSelectedText && askRonSourceUrl && (
                  <AskRonOptions
                    key="executing"
                    selectedText={askRonSelectedText}
                    sourceUrl={askRonSourceUrl}
                    isLoading={true}
                    thinkingText={askRonThinkingText}
                    options={[]}
                    onSelectOption={() => {}}
                    onSelectSomethingElse={() => {}}
                    onClose={handleCloseAskRon}
                  />
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            /* Regular Context Menu */
            <DropdownMenu open={isOpen} onOpenChange={(open) => !open && onClose()}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Context menu anchor"
                  className="fixed sr-only"
                  style={{
                    left: `${adjustedPosition.x}px`,
                    top: `${adjustedPosition.y}px`,
                  }}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                ref={menuRef}
                sideOffset={0}
                align="start"
                className="fixed z-[9999] rounded-xl py-1.5 min-w-[220px] overflow-hidden shadow-2xl bg-white dark:bg-zinc-800 border border-black/10 dark:border-white/10"
              >
                {/* Feedback toast */}
                <AnimatePresence>
                  {copiedFeedback && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="absolute top-0 left-0 right-0 px-3 py-1.5 flex items-center justify-center gap-2 text-xs font-raleway font-raleway-bold bg-green-500/20 text-green-700 dark:text-green-400"
                    >
                      <CheckIcon className="w-3.5 h-3.5" />
                      {copiedFeedback}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Standard clipboard actions */}
                {selectedText && (
                  <>
                    <MenuAction
                      icon={<ClipboardDocumentIcon className="w-4 h-4" />}
                      label="Copy"
                      onSelect={handleCopy}
                      shortcut="⌘C"
                    />
                    <MenuAction
                      icon={<ClipboardIcon className="w-4 h-4" />}
                      label="Copy as Markdown"
                      onSelect={handleCopyMarkdown}
                    />
                    <MenuAction
                      icon={<ScissorsIcon className="w-4 h-4" />}
                      label="Cut"
                      onSelect={handleCut}
                      shortcut="⌘X"
                    />
                  </>
                )}

                <MenuAction
                  icon={<ClipboardIcon className="w-4 h-4" />}
                  label="Paste"
                  onSelect={handlePaste}
                  shortcut="⌘V"
                />

                {/* Separator */}
                <div className="my-1.5 h-px mx-2 bg-gradient-to-r from-transparent via-black/10 dark:via-white/10 to-transparent" />

                {/* Ask Ron - special highlight */}
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault()
                    handleAskRon()
                  }}
                  className="w-full px-3 py-2.5 mx-0 flex items-center gap-3 text-left transition-all duration-200 group focus:bg-royal/10 dark:focus:bg-royal-light/15 hover:bg-royal/10 dark:hover:bg-royal-light/15"
                >
                  <motion.div
                    className="flex-shrink-0"
                    animate={{
                      scale: [1, 1.1, 1],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  >
                    <ChatBubbleLeftIcon className="w-4 h-4 text-royal dark:text-royal-light" />
                  </motion.div>
                  <span className="text-sm font-raleway font-raleway-bold text-royal dark:text-royal-light">
                    Ask Ron?
                  </span>
                  {selectedText && (
                    <span className="ml-auto text-xs font-raleway text-ron-text/40 dark:text-white/40 group-hover:text-royal/70 dark:group-hover:text-royal-light/70 group-focus:text-royal/70 dark:group-focus:text-royal-light/70">
                      with selection
                    </span>
                  )}
                </DropdownMenuItem>
                <InterestsContextItems onClose={onClose} />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </>
      )}
    </AnimatePresence>
  )
}

interface MenuActionProps {
  icon: ReactNode
  label: string
  onSelect: () => void | Promise<void>
  shortcut?: string
}

function MenuAction({ icon, label, onSelect, shortcut }: MenuActionProps) {
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault()
        void onSelect()
      }}
      className="w-full px-3 py-2 flex items-center gap-3 text-left transition-colors duration-200 focus:bg-black/5 dark:focus:bg-white/10 hover:bg-black/5 dark:hover:bg-white/10"
    >
      <span className="flex-shrink-0 text-ron-text/60 dark:text-white/60">
        {icon}
      </span>
      <span className="flex-1 text-sm font-raleway text-ron-text dark:text-white">
        {label}
      </span>
      {shortcut && (
        <span className="text-xs font-raleway text-ron-text/40 dark:text-white/40">
          {shortcut}
        </span>
      )}
    </DropdownMenuItem>
  )
}
