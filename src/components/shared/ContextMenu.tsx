import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAgentUi } from '@/context/AgentUiContext'
import { useTabStore } from '@/stores/tabStore'
import { AskRonOptions } from '@/components/ai-elements/ask-ron-options'
import { AskRonPrompt } from '@/components/ai-elements/ask-ron-prompt'
import { InterestsContextItems } from '@/components/interests/InterestsContextItems'
import { MOD_KEY } from '@/lib/shortcuts'
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
        showFeedback('Copied')
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
        showFeedback('Copied as Markdown')
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
        showFeedback('Cut')
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
        showFeedback('Pasted')
        setTimeout(onClose, 300)
      } else {
        // Try execCommand for contenteditable elements
        document.execCommand('insertText', false, text)
        showFeedback('Pasted')
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
              data-chrome-overlay="true"
              className="fixed z-[9999] w-[320px] max-w-[calc(100vw-20px)] rounded-xl shadow-float"
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
                className="fixed z-[9999] min-w-[232px] overflow-hidden rounded-xl border-border p-1 data-[state=open]:shadow-float"
              >
                {/* Feedback toast */}
                <AnimatePresence>
                  {copiedFeedback && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-x-0 top-0 z-10 flex h-8 items-center justify-center gap-2 bg-muted px-3 text-[12px] font-medium text-foreground"
                    >
                      <CheckIcon className="h-3.5 w-3.5 text-success" />
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
                      shortcut={`${MOD_KEY}C`}
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
                      shortcut={`${MOD_KEY}X`}
                    />
                  </>
                )}

                <MenuAction
                  icon={<ClipboardIcon className="w-4 h-4" />}
                  label="Paste"
                  onSelect={handlePaste}
                  shortcut={`${MOD_KEY}V`}
                />

                {/* Separator */}
                <div className="-mx-1 my-1 h-px bg-border" />

                {/* Ask Ren - the menu's one volt action */}
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault()
                    handleAskRon()
                  }}
                  className="group flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 py-0 text-left transition-colors duration-150 hover:bg-blurple-50 focus:bg-blurple-50 dark:hover:bg-blurple-950/60 dark:focus:bg-blurple-950/60"
                >
                  <ChatBubbleLeftIcon className="h-4 w-4 flex-shrink-0 text-volt" />
                  <span className="text-[13px] font-semibold text-popover-foreground">
                    Ask Ren
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                    {selectedText ? 'with selection · ' : ''}{MOD_KEY}J
                  </span>
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
      className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 py-0 text-left transition-colors duration-150 hover:bg-muted focus:bg-muted"
    >
      <span className="flex-shrink-0 text-muted-foreground">
        {icon}
      </span>
      <span className="flex-1 text-[13px] text-popover-foreground">
        {label}
      </span>
      {shortcut && (
        <span className="font-mono text-[11px] text-muted-foreground">
          {shortcut}
        </span>
      )}
    </DropdownMenuItem>
  )
}
