/**
 * SearchQuickResults
 * 
 * Premium search results view with:
 * - Chain of Thought using AI Elements components
 * - Inline citations with ResponseWithCitations
 * - Browser preview panel integration
 * - Premium source cards with checkboxes
 * - Redesigned action buttons with animations
 * - Code interpretation support
 */

'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowPathIcon,
  ArrowRightIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline'
import { CheckIcon } from '@heroicons/react/24/solid'

// AI Elements - Chain of Thought
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
  ChainOfThoughtSearchResults,
  ChainOfThoughtSearchResult,
  ChainOfThoughtImage,
} from '@/components/ai-elements/chain-of-thought'
import { Task, TaskTrigger, TaskContent } from '@/components/ai-elements/task'
import { Agent, AgentHeader, AgentContent } from '@/components/ai-elements/agent'

// AI Elements - Reasoning
import { Reasoning, ReasoningTrigger, ReasoningContent } from '@/components/ai-elements/reasoning'

// AI Elements - Tool
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool'

// AI Elements - Code & Image
import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block'
import { Image } from '@/components/ai-elements/image'

// AI Elements - Response & Sources
import { ResponseWithCitations } from '@/components/ai-elements/response-with-citations'
import { Sources, SourcesContent, SourcesTrigger, Source } from '@/components/ai-elements/sources'

// AI Elements - Preview Panel
import { PreviewPanel } from '@/components/ai-elements/preview-panel'
import { usePreviewStore } from '@/stores/previewStore'

// Utils
import { cn } from '@/utils/cn'
import type { SourceData } from './SourceCard'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchResultItem {
  id: string
  title: string
  url: string
  snippet?: string
  favicon?: string
  thumbnail?: string
}

export interface CodeOutput {
  code: string
  language: string
  output?: string
  error?: string
  visualizations?: ImageResult[]
}

export interface SubagentResult {
  agentId: string
  agentName: string
  type: 'use_agent' | 'batch' | 'swarm' | 'graph' | 'workflow'
  status: 'pending' | 'running' | 'complete' | 'error'
  result?: unknown
}

export interface ImageResult {
  id: string
  src: string
  alt?: string
  caption?: string
}

export interface ReasoningStep {
  id: string
  label: string
  description: string
  status: 'pending' | 'running' | 'complete'
  reasoning?: string
  sources?: string[]
  // Extended types
  searchResults?: SearchResultItem[]
  codeOutput?: CodeOutput
  subagentResult?: SubagentResult
  images?: ImageResult[]
  toolName?: string
  toolInput?: unknown
  toolOutput?: unknown
}

export interface QuickSearchResult {
  query: string
  answer: string
  isAnswerComplete: boolean
  reasoning: ReasoningStep[]
  sources: SourceData[]
  relatedQueries: string[]
}

interface SearchQuickResultsProps {
  result: QuickSearchResult
  isStreaming: boolean
  onSeeFullResults: () => void
  onTryAgain: (feedback?: string) => void
  onLetsChat?: () => void
  onSendToRon?: (source: SourceData) => void
  onSendToCoding?: (source: SourceData) => void
  onAttachToTask?: (source: SourceData) => void
  onStartTask?: (source: SourceData) => void
  className?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Premium Source Card Component
// ─────────────────────────────────────────────────────────────────────────────

interface PremiumSourceCardProps {
  source: SourceData
  index: number
  isSelected: boolean
  onSelect: () => void
  onCardClick: () => void
}

function PremiumSourceCard({ 
  source, 
  index, 
  isSelected, 
  onSelect, 
  onCardClick 
}: PremiumSourceCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const domain = source.domain || getDomainFromUrl(source.url)
  const favicon = source.favicon || `https://www.google.com/s2/favicons?domain=${domain}&sz=32`

  return (
    <motion.div
      className={cn(
        'group relative rounded-2xl overflow-hidden cursor-pointer',
        'border transition-all duration-300',
        isSelected
          ? 'bg-accent-indigo border-accent-light shadow-lg shadow-accent-indigo/20'
          : 'bg-surface-850/80 border-surface-700/60 hover:border-surface-600/80',
        'backdrop-blur-xl'
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onCardClick}
      whileHover={{ y: -2, scale: 1.01 }}
      transition={{ duration: 0.2 }}
    >
      {/* Checkbox */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onSelect()
        }}
        aria-label={isSelected ? 'Deselect source' : 'Select source'}
        title={isSelected ? 'Deselect source' : 'Select source'}
        className={cn(
          'absolute top-3 right-3 z-10 w-6 h-6 rounded-lg',
          'flex items-center justify-center transition-all duration-200',
          isSelected
            ? 'bg-accent-light text-white'
            : 'bg-surface-800/80 border border-surface-600/60 text-transparent hover:border-accent-light/50'
        )}
      >
        <CheckIcon className="w-4 h-4" />
      </button>

      {/* Thumbnail Image */}
      {source.thumbnail && (
        <div className="aspect-video overflow-hidden">
          <img
            src={source.thumbnail}
            alt=""
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </div>
      )}

      {/* Content */}
      <div className="p-4 space-y-2">
        {/* Header with favicon and domain */}
        <div className="flex items-center gap-2">
          <img src={favicon} alt="" className="w-4 h-4 rounded" />
          <span className={cn(
            'text-xs font-medium',
            isSelected ? 'text-white/80' : 'text-ink-inverse-muted'
          )}>
            {domain}
          </span>
          <span className={cn(
            'ml-auto text-xs px-1.5 py-0.5 rounded-full',
            isSelected ? 'bg-white/20 text-white' : 'bg-surface-700/60 text-ink-inverse-secondary'
          )}>
            [{index + 1}]
          </span>
        </div>

        {/* Title */}
        <h3 className={cn(
          'text-sm font-medium line-clamp-2 font-raleway',
          isSelected ? 'text-white' : 'text-ink-inverse'
        )}>
          {source.title}
        </h3>

        {/* Snippet */}
        {source.snippet && (
          <p className={cn(
            'text-xs line-clamp-2 font-light',
            isSelected ? 'text-white/70' : 'text-ink-inverse-secondary'
          )}>
            {source.snippet}
          </p>
        )}

        {/* See more indicator on hover */}
        <AnimatePresence>
          {isHovered && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className={cn(
                'flex items-center gap-1 text-xs font-medium pt-1',
                isSelected ? 'text-white/90' : 'text-accent-light'
              )}
            >
              <span>See more</span>
              <ArrowRightIcon className="w-3 h-3" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Chain of Thought Step Renderer
// ─────────────────────────────────────────────────────────────────────────────

interface ReasoningStepRendererProps {
  step: ReasoningStep
  isStreaming: boolean
  onSourceClick?: (source: SearchResultItem) => void
}

function ReasoningStepRenderer({ step, isStreaming, onSourceClick }: ReasoningStepRendererProps) {
  const isRunning = step.status === 'running'

  // If step has tool info, render with Tool component
  if (step.toolName) {
    const toolState = step.status === 'complete' ? 'success' : isRunning ? 'running' : 'pending'
    const toolInput = step.toolInput as Record<string, unknown> | string | undefined
    const toolType = step.toolName.startsWith('tool-') ? step.toolName : `tool-${step.toolName}`
    return (
      <Tool
        defaultOpen={isRunning}
      >
        <ToolHeader
          title={step.toolName}
          type={toolType}
          state={toolState}
        />
        <ToolContent>
          {toolInput && (
            <ToolInput input={toolInput} />
          )}
          {step.toolOutput !== undefined && step.toolOutput !== null && (
            <ToolOutput output={JSON.stringify(step.toolOutput) as never} />
          )}
        </ToolContent>
      </Tool>
    )
  }

  // If step has search results, render with ChainOfThoughtStep + SearchResults
  if (step.searchResults && step.searchResults.length > 0) {
    const cotStatus: 'pending' | 'active' | 'complete' = isRunning ? 'active' : step.status === 'complete' ? 'complete' : 'pending'
    return (
      <ChainOfThoughtStep
        label={step.description || 'Searching...'}
        status={cotStatus}
      >
        <ChainOfThoughtSearchResults>
          {step.searchResults.map((sr, i) => {
            let hostname = sr.title
            try {
              if (sr.url) hostname = new URL(sr.url).hostname.replace(/^www\./, '')
            } catch { /* use title */ }
            return (
              <ChainOfThoughtSearchResult
                key={sr.id || `${sr.url}-${i}`}
                className="cursor-pointer"
                onClick={() => onSourceClick?.(sr)}
              >
                {hostname}
              </ChainOfThoughtSearchResult>
            )
          })}
        </ChainOfThoughtSearchResults>
      </ChainOfThoughtStep>
    )
  }

  // If step has code output, render with CodeBlock
  if (step.codeOutput) {
    return (
      <div className="space-y-3">
        <CodeBlock
          code={step.codeOutput.code}
          language={step.codeOutput.language as any}
          className="rounded-xl"
        >
          <CodeBlockCopyButton />
        </CodeBlock>
        {step.codeOutput.output && (
          <div className="bg-surface-800/80 rounded-xl p-4">
            <p className="text-xs text-ink-inverse-muted mb-2">Output</p>
            <pre className="text-sm text-ink-inverse font-mono whitespace-pre-wrap">
              {step.codeOutput.output}
            </pre>
          </div>
        )}
        {step.codeOutput.visualizations && step.codeOutput.visualizations.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {step.codeOutput.visualizations.map((viz) => (
              <Image key={viz.id} src={viz.src} alt={viz.alt} className="rounded-xl" />
            ))}
          </div>
        )}
      </div>
    )
  }

  // If step has subagent result, render with Task + Agent (70/30 layout)
  if (step.subagentResult) {
    const taskStatus = step.subagentResult.status === 'complete' ? 'success' as const
      : step.subagentResult.status === 'error' ? 'error' as const
      : step.subagentResult.status === 'running' ? 'running' as const
      : 'pending' as const
    const cotStatus: 'pending' | 'active' | 'complete' = step.subagentResult.status === 'running' ? 'active' : step.subagentResult.status === 'complete' || step.subagentResult.status === 'error' ? 'complete' : 'pending'
    return (
      <ChainOfThoughtStep
        label={step.subagentResult.agentName}
        status={cotStatus}
      >
        <div className="flex gap-3">
          <div className="flex-[7] min-w-0">
            <Task defaultOpen={false}>
              <TaskTrigger
                title={step.subagentResult.agentName}
                status={taskStatus}
                description={step.subagentResult.type}
              />
              <TaskContent>
                {step.subagentResult.result !== undefined && step.subagentResult.result !== null && (
                  <ToolOutput output={JSON.stringify(step.subagentResult.result) as never} />
                )}
              </TaskContent>
            </Task>
          </div>
          <div className="flex-[3] min-w-0">
            <Agent>
              <AgentHeader name={step.subagentResult.agentName} />
              <AgentContent>
                <div className="text-xs text-muted-foreground">
                  {step.subagentResult.status === 'running' ? 'Working...' : step.subagentResult.status}
                </div>
              </AgentContent>
            </Agent>
          </div>
        </div>
      </ChainOfThoughtStep>
    )
  }

  // If step has images, render with ChainOfThoughtImage
  if (step.images && step.images.length > 0) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {step.images.map((img) => (
          <ChainOfThoughtImage key={img.id} caption={img.caption}>
            <img
              src={img.src}
              alt={img.alt || ''}
              className="max-h-full max-w-full object-contain"
            />
          </ChainOfThoughtImage>
        ))}
      </div>
    )
  }

  // Default: render as a ChainOfThoughtStep
  const cotStatus: 'pending' | 'active' | 'complete' = step.status === 'running' ? 'active' : step.status === 'complete' ? 'complete' : 'pending'
  return (
    <ChainOfThoughtStep
      label={step.label}
      description={step.description}
      status={cotStatus}
    >
      {step.reasoning && (
        <Reasoning isStreaming={isRunning && isStreaming} defaultOpen={isRunning}>
          <ReasoningTrigger title="Reasoning" />
          <ReasoningContent>{step.reasoning}</ReasoningContent>
        </Reasoning>
      )}
    </ChainOfThoughtStep>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function SearchQuickResults({
  result,
  isStreaming,
  onSeeFullResults,
  onTryAgain,
  onLetsChat,
  className = '',
}: SearchQuickResultsProps) {
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set())
  const [showFeedbackInput, setShowFeedbackInput] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [letsChatHovered, setLetsChatHovered] = useState(false)
  const [fullResultsHovered, setFullResultsHovered] = useState(false)
  const answerRef = useRef<HTMLDivElement>(null)
  
  // Preview store integration
  const { openBrowserPreview } = usePreviewStore()

  // Build citations array from sources
  const citations = useMemo(
    () =>
      result.sources.map((source, index) => ({
        number: String(index + 1),
        title: source.title,
        url: source.url,
        snippet: source.snippet,
      })),
    [result.sources]
  )

  // Auto-scroll answer as it streams
  useEffect(() => {
    if (answerRef.current && isStreaming) {
      answerRef.current.scrollTop = answerRef.current.scrollHeight
    }
  }, [result.answer, isStreaming])

  const handleTryAgain = useCallback(() => {
    if (showFeedbackInput && feedback.trim()) {
      onTryAgain(feedback.trim())
      setFeedback('')
      setShowFeedbackInput(false)
    } else {
      setShowFeedbackInput(true)
    }
  }, [showFeedbackInput, feedback, onTryAgain])

  const handleTryAgainWithoutFeedback = useCallback(() => {
    onTryAgain()
    setShowFeedbackInput(false)
    setFeedback('')
  }, [onTryAgain])

  const toggleSourceSelection = useCallback((sourceId: string) => {
    setSelectedSources(prev => {
      const next = new Set(prev)
      if (next.has(sourceId)) {
        next.delete(sourceId)
      } else {
        next.add(sourceId)
      }
      return next
    })
  }, [])

  const handleSourceCardClick = useCallback((source: SourceData) => {
    openBrowserPreview({
      url: source.url,
      title: source.title,
      isLive: true,
    })
  }, [openBrowserPreview])

  const handleSearchResultClick = useCallback((result: SearchResultItem) => {
    openBrowserPreview({
      url: result.url,
      title: result.title,
      isLive: true,
    })
  }, [openBrowserPreview])

  return (
    <div className={cn('max-w-4xl mx-auto p-6 space-y-6', className)}>
      {/* Query Display */}
      <div className="text-center mb-8">
        <p className="text-sm text-ink-inverse-muted mb-1 font-raleway font-light">Results for</p>
        <h1 className="text-xl font-medium text-ink-inverse font-raleway">{result.query}</h1>
      </div>

      {/* Chain of Thought Section */}
      {result.reasoning.length > 0 && (
        <ChainOfThought
          isStreaming={isStreaming}
          defaultOpen={true}
          autoCollapseDelay={2000}
          className="backdrop-blur-xl"
        >
          <ChainOfThoughtHeader>
            <span className="flex items-center gap-2">
              Chain of Thought
              <span className="text-xs px-2 py-0.5 rounded-full bg-accent-indigo/20 text-accent-light">
                {result.reasoning.filter(s => s.status === 'complete').length}/{result.reasoning.length}
              </span>
            </span>
          </ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            <div className="space-y-4">
              {result.reasoning.map((step) => (
                <ReasoningStepRenderer
                  key={step.id}
                  step={step}
                  isStreaming={isStreaming}
                  onSourceClick={handleSearchResultClick}
                />
              ))}
            </div>
          </ChainOfThoughtContent>
        </ChainOfThought>
      )}

      {/* Answer Section with Inline Citations */}
      <motion.div
        className={cn(
          'group relative rounded-2xl overflow-hidden',
          'bg-gradient-to-br from-surface-900/80 to-surface-850/60',
          'border border-surface-700/60',
          'backdrop-blur-xl shadow-lg',
          'transition-all duration-500 hover:shadow-xl hover:shadow-accent-indigo/5'
        )}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {/* Ambient Glow Overlay */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 bg-gradient-to-tr from-accent-indigo/5 via-transparent to-accent-light/5 pointer-events-none" />

        <div
          ref={answerRef}
          className="relative z-10 p-6 max-h-[50vh] overflow-y-auto scrollbar-thin"
        >
          {result.answer ? (
            <div className="prose prose-invert max-w-none">
              <div className="text-base leading-relaxed text-ink-inverse font-raleway font-light whitespace-pre-wrap">
                <ResponseWithCitations
                  content={result.answer}
                  citations={citations}
                  isStreaming={isStreaming}
                />
                {isStreaming && (
                  <span className="inline-block w-0.5 h-5 bg-accent-light ml-0.5 animate-pulse" />
                )}
              </div>
            </div>
          ) : isStreaming ? (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-3 text-ink-inverse-muted">
                <div className="w-5 h-5 border-2 border-accent-light border-t-transparent rounded-full animate-spin" />
                <span className="font-raleway font-light">Generating answer...</span>
              </div>
            </div>
          ) : null}
        </div>
      </motion.div>

      {/* Premium Source Cards Grid */}
      {result.sources.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink-inverse-muted font-raleway">
              Sources ({result.sources.length})
            </h2>
            {selectedSources.size > 0 && (
              <span className="text-xs text-accent-light font-medium">
                {selectedSources.size} selected
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {result.sources.slice(0, 6).map((source, index) => (
              <PremiumSourceCard
                key={source.id || `${source.url}-${index}`}
                source={source}
                index={index}
                isSelected={selectedSources.has(source.id || source.url)}
                onSelect={() => toggleSourceSelection(source.id || source.url)}
                onCardClick={() => handleSourceCardClick(source)}
              />
            ))}
          </div>
          
          {/* Expandable sources list for remaining items */}
          {result.sources.length > 6 && (
            <Sources>
              <SourcesTrigger count={result.sources.length - 6} />
              <SourcesContent>
                {result.sources.slice(6).map((source, index) => {
                  const domain = source.domain || getDomainFromUrl(source.url)
                  const favicon = source.favicon || `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
                  return (
                    <Source key={source.id || `${source.url}-${index + 6}`} href={source.url}>
                      <div className="flex items-start gap-3">
                        <img src={favicon} alt="" className="mt-0.5 h-4 w-4 rounded" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            [{index + 7}] {source.title}
                          </p>
                          {source.snippet && (
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {source.snippet}
                            </p>
                          )}
                        </div>
                      </div>
                    </Source>
                  )
                })}
              </SourcesContent>
            </Sources>
          )}
        </div>
      )}

      {/* Related Queries */}
      {result.relatedQueries.length > 0 && result.isAnswerComplete && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-ink-inverse-muted font-raleway">Related Searches</h2>
          <div className="flex flex-wrap gap-2">
            {result.relatedQueries.map((query, i) => (
              <button
                key={i}
                className={cn(
                  'px-3 py-1.5 text-sm font-raleway font-light',
                  'bg-surface-800/60 hover:bg-surface-700/80',
                  'border border-surface-700/60 hover:border-surface-600/80',
                  'rounded-full text-ink-inverse-secondary hover:text-ink-inverse',
                  'transition-all duration-200'
                )}
              >
                {query}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Premium Action Buttons */}
      {result.isAnswerComplete && (
        <div className="flex items-center justify-center gap-4 pt-6">
          {/* Let's Chat Button - Primary CTA with shimmer */}
          {onLetsChat && (
            <motion.button
              onClick={onLetsChat}
              onMouseEnter={() => setLetsChatHovered(true)}
              onMouseLeave={() => setLetsChatHovered(false)}
              className={cn(
                'relative group/btn flex items-center gap-2.5',
                'px-7 py-3 rounded-2xl font-medium font-raleway',
                'bg-gradient-to-r from-accent-indigo to-accent-light',
                'text-white shadow-lg shadow-accent-indigo/30',
                'transition-all duration-300',
                'hover:shadow-xl hover:shadow-accent-indigo/40'
              )}
              whileHover={{ y: -2, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {/* Shimmer effect */}
              <AnimatePresence>
                {letsChatHovered && (
                  <motion.div
                    className="absolute inset-0 rounded-2xl overflow-hidden"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                      initial={{ x: '-100%' }}
                      animate={{ x: '100%' }}
                      transition={{ duration: 0.8, ease: 'easeInOut' }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              <ChatBubbleLeftRightIcon className="w-5 h-5" />
              <span>Let's Chat</span>
            </motion.button>
          )}

          {/* Full Results Button - Secondary with arrow animation */}
          <motion.button
            onClick={onSeeFullResults}
            onMouseEnter={() => setFullResultsHovered(true)}
            onMouseLeave={() => setFullResultsHovered(false)}
            className={cn(
              'group/btn flex items-center gap-2',
              'px-6 py-3 rounded-2xl font-medium font-raleway',
              'bg-surface-800/80 hover:bg-surface-700/80',
              'border border-surface-700/60 hover:border-accent-light/40',
              'text-ink-inverse-secondary hover:text-ink-inverse',
              'shadow-md transition-all duration-300'
            )}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
          >
            <span>Full Results</span>
            <motion.div
              animate={{ x: fullResultsHovered ? 4 : 0, opacity: fullResultsHovered ? 1 : 0.5 }}
              transition={{ duration: 0.2 }}
            >
              <ArrowRightIcon className="w-4 h-4" />
            </motion.div>
          </motion.button>

          {/* Try Again Button */}
          <div className="relative">
            {showFeedbackInput ? (
              <motion.div
                className="flex items-center gap-2"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
              >
                <input
                  type="text"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="What would you like different?"
                  className={cn(
                    'px-4 py-2.5 w-64 rounded-2xl text-sm font-raleway font-light',
                    'bg-surface-800/80 border border-surface-700/60',
                    'text-ink-inverse placeholder:text-ink-inverse-muted',
                    'focus:outline-none focus:border-accent-light/50',
                    'transition-colors duration-200'
                  )}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTryAgain()
                    if (e.key === 'Escape') setShowFeedbackInput(false)
                  }}
                  autoFocus
                />
                <button
                  onClick={handleTryAgain}
                  className={cn(
                    'px-4 py-2.5 rounded-2xl text-sm font-medium font-raleway',
                    'bg-surface-700/80 hover:bg-surface-600/80',
                    'border border-surface-600/60',
                    'text-ink-inverse-secondary hover:text-ink-inverse',
                    'transition-colors duration-200'
                  )}
                >
                  Search
                </button>
                <button
                  onClick={handleTryAgainWithoutFeedback}
                  className="p-2.5 text-ink-inverse-muted hover:text-ink-inverse transition-colors"
                  title="Search again without feedback"
                >
                  <ArrowPathIcon className="w-4 h-4" />
                </button>
              </motion.div>
            ) : (
              <motion.button
                onClick={handleTryAgain}
                className={cn(
                  'flex items-center gap-2',
                  'px-5 py-3 rounded-2xl font-medium font-raleway',
                  'bg-surface-800/60 hover:bg-surface-700/80',
                  'border border-surface-700/60 hover:border-surface-600/80',
                  'text-ink-inverse-muted hover:text-ink-inverse-secondary',
                  'transition-all duration-200'
                )}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
              >
                <ArrowPathIcon className="w-4 h-4" />
                <span>Try Again</span>
              </motion.button>
            )}
          </div>
        </div>
      )}

      {/* Preview Panel */}
      <PreviewPanel variant="sliding" />
    </div>
  )
}

export default SearchQuickResults
