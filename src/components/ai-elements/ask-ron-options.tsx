/**
 * AskRonOptions Component
 *
 * Displays AI-suggested options when user invokes "Ask Ron" with selected text.
 * Compact inline listbox design for the agent panel input area.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/utils/cn'
import { RonExtractionInline } from './ron-extraction'
import { Loader } from './loader'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AskRonOption {
  id: string
  label: string
  description?: string
}

interface AskRonOptionsProps {
  /** The selected text that was sent to Ron */
  selectedText: string
  /** The URL where the text was selected from */
  sourceUrl: string
  /** Whether Ron is currently thinking/loading options */
  isLoading?: boolean
  /** Current thinking text to display */
  thinkingText?: string
  /** The 3 AI-suggested options */
  options: AskRonOption[]
  /** Callback when an option is selected */
  onSelectOption: (option: AskRonOption) => void
  /** Callback when "Something Else" is selected */
  onSelectSomethingElse: () => void
  /** Callback to close/cancel */
  onClose: () => void
  /** Additional class names */
  className?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// AskRonOptions - Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function AskRonOptions({
  selectedText,
  sourceUrl,
  isLoading = false,
  thinkingText = 'Analyzing...',
  options,
  onSelectOption,
  onSelectSomethingElse,
  onClose,
  className,
}: AskRonOptionsProps) {
  const letters = ['A', 'B', 'C']

  // Parse hostname safely
  let hostname = 'this page'
  try {
    hostname = new URL(sourceUrl).hostname
  } catch {
    // Keep default
  }

  return (
    <div className={cn('w-full', className)}>
      <div className={cn(
        'rounded-xl overflow-hidden',
        'bg-surface-50 dark:bg-surface-850',
        'border border-surface-200 dark:border-surface-700'
      )}>
        {/* Compact Header */}
        <div className="px-3 py-2 flex items-center justify-between border-b border-surface-100 dark:border-surface-700">
          <div className="flex items-center gap-2">
            <RonExtractionInline
              isThinking={isLoading}
              thinkingText={thinkingText}
            />
            {!isLoading && (
              <span className="text-body-xs font-medium text-ink dark:text-ink-inverse">
                Ask Ron
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
            <CloseIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Selected text preview - compact */}
        <div className="px-3 py-2 border-b border-surface-100 dark:border-surface-700">
          <p className="text-[10px] text-ink-muted dark:text-ink-inverse-muted mb-0.5">
            From {hostname}
          </p>
          <p className="text-body-xs text-ink-secondary dark:text-ink-inverse-secondary line-clamp-1 italic">
            "{selectedText}"
          </p>
        </div>

        {/* Options - compact list */}
        <div className="py-1">
          <AnimatePresence mode="wait">
            {isLoading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-4 flex items-center justify-center gap-2"
              >
                <Loader size={16} />
                <p className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">
                  {thinkingText}
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="options"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {options.slice(0, 3).map((option, index) => (
                  <button
                    key={option.id}
                    onClick={() => onSelectOption(option)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-left',
                      'hover:bg-surface-100 dark:hover:bg-surface-800',
                      'transition-colors duration-150'
                    )}
                  >
                    <span className={cn(
                      'flex-shrink-0 w-5 h-5 rounded text-[10px] font-medium',
                      'flex items-center justify-center',
                      'bg-surface-100 dark:bg-surface-700',
                      'text-ink-muted dark:text-ink-inverse-muted'
                    )}>
                      {letters[index]}
                    </span>
                    <span className="flex-1 text-body-xs text-ink dark:text-ink-inverse truncate">
                      {option.label}
                    </span>
                  </button>
                ))}
                
                {/* Something else */}
                <button
                  onClick={onSelectSomethingElse}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-left',
                    'hover:bg-surface-100 dark:hover:bg-surface-800',
                    'border-t border-surface-100 dark:border-surface-700',
                    'transition-colors duration-150'
                  )}
                >
                  <span className={cn(
                    'flex-shrink-0 w-5 h-5 rounded text-[10px] font-medium',
                    'flex items-center justify-center',
                    'bg-surface-100 dark:bg-surface-700',
                    'text-ink-muted dark:text-ink-inverse-muted'
                  )}>
                    D
                  </span>
                  <span className="flex-1 text-body-xs text-ink-muted dark:text-ink-inverse-muted">
                    Something else...
                  </span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('w-full h-full', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

export default AskRonOptions
