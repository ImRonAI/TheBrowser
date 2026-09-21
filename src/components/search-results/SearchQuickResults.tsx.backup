/**
 * SearchQuickResults
 * 
 * Main quick results view for search with:
 * - Collapsible Chain of Thought (auto-collapses when answer starts)
 * - Streamed answer display with Raleway typography
 * - AI Elements sources list
 * - "See Full Results" and "Try Again" action buttons
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  SparklesIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline'
import type { SourceData } from './SourceCard'
import { Sources, SourcesContent, SourcesTrigger, Source } from '@/components/ai-elements/sources'
import { ResponseWithCitations } from '@/components/ai-elements/response-with-citations'
import {
  Plan,
  PlanContent,
  PlanDescription,
  PlanFooter,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from '@/components/ai-elements/plan'
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemDescription,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from '@/components/ai-elements/queue'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface ReasoningStep {
  id: string
  label: string
  description: string
  status: 'pending' | 'running' | 'complete'
  reasoning?: string
  sources?: string[]
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
// Structured Plan / Queue Parsing
// ─────────────────────────────────────────────────────────────────────────────
type PlanStep = {
  id?: string
  title: string
  description?: string
  status?: 'pending' | 'running' | 'complete'
}

type PlanData = {
  title?: string
  description?: string
  steps?: PlanStep[]
  footer?: string
}

type QueueItemData = {
  id?: string
  title: string
  description?: string
  completed?: boolean
}

type QueueData = {
  label?: string
  items: QueueItemData[]
}

const PLAN_TAG = /<plan>([\s\S]*?)<\/plan>/gi
const QUEUE_TAG = /<queue>([\s\S]*?)<\/queue>/gi

function parseJsonBlock(raw: string) {
  try {
    return JSON.parse(raw.trim())
  } catch {
    return null
  }
}

function normalizePlanData(raw: any): PlanData | null {
  if (!raw || typeof raw !== 'object') return null
  const stepsRaw = Array.isArray(raw.steps || raw.items) ? (raw.steps || raw.items) : []
  const steps = stepsRaw
    .map((step: any, index: number) => {
      if (!step) return null
      const title = String(step.title || step.name || step.task || `Step ${index + 1}`)
      return {
        id: step.id ? String(step.id) : undefined,
        title,
        description: step.description ? String(step.description) : undefined,
        status: step.status,
      } as PlanStep
    })
    .filter(Boolean) as PlanStep[]

  return {
    title: raw.title ? String(raw.title) : raw.name ? String(raw.name) : 'Plan',
    description: raw.description ? String(raw.description) : undefined,
    steps: steps.length > 0 ? steps : undefined,
    footer: raw.footer ? String(raw.footer) : undefined,
  }
}

function normalizeQueueData(raw: any): QueueData | null {
  if (!raw || typeof raw !== 'object') return null
  const itemsRaw = Array.isArray(raw.items || raw.tasks || raw.todos)
    ? raw.items || raw.tasks || raw.todos
    : []
  const items = itemsRaw
    .map((item: any, index: number) => {
      if (!item) return null
      const title = String(item.title || item.name || item.task || `Item ${index + 1}`)
      return {
        id: item.id ? String(item.id) : undefined,
        title,
        description: item.description ? String(item.description) : undefined,
        completed: Boolean(item.completed || item.done),
      } as QueueItemData
    })
    .filter(Boolean) as QueueItemData[]

  if (items.length === 0) return null
  return {
    label: raw.label ? String(raw.label) : raw.title ? String(raw.title) : 'Queue',
    items,
  }
}

function extractStructuredBlocks(text: string) {
  const plans: PlanData[] = []
  const queues: QueueData[] = []
  let output = text

  output = output.replace(PLAN_TAG, (match, json) => {
    const parsed = parseJsonBlock(json)
    const plan = normalizePlanData(parsed)
    if (plan) {
      plans.push(plan)
      return ''
    }
    return match
  })

  output = output.replace(QUEUE_TAG, (match, json) => {
    const parsed = parseJsonBlock(json)
    const queue = normalizeQueueData(parsed)
    if (queue) {
      queues.push(queue)
      return ''
    }
    return match
  })

  return { cleaned: output.trim(), plans, queues }
}

function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reasoning Step Component
// ─────────────────────────────────────────────────────────────────────────────
function ReasoningStepItem({ step }: { step: ReasoningStep }) {
  const getStatusIcon = () => {
    switch (step.status) {
      case 'complete':
        return <CheckCircleIcon className="w-4 h-4 text-teal-400" />
      case 'running':
        return (
          <div className="w-4 h-4 flex items-center justify-center">
            <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )
      default:
        return <ClockIcon className="w-4 h-4 text-slate-500" />
    }
  }

  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5">{getStatusIcon()}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white/80">{step.label}</span>
          {step.sources && step.sources.length > 0 && (
            <span className="text-xs px-1.5 py-0.5 glass-subtle rounded text-slate-400">
              {step.sources.length} sources
            </span>
          )}
        </div>
        <p className="text-xs text-white/50 mt-0.5">{step.description}</p>
        {step.reasoning && (
          <p className="text-xs text-white/40 mt-1 italic whitespace-pre-wrap">{step.reasoning}</p>
        )}
      </div>
    </div>
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
  const [isReasoningExpanded, setIsReasoningExpanded] = useState(true)
  const [showFeedbackInput, setShowFeedbackInput] = useState(false)
  const [feedback, setFeedback] = useState('')
  const answerRef = useRef<HTMLDivElement>(null)
  const { cleaned, plans, queues } = useMemo(
    () => extractStructuredBlocks(result.answer),
    [result.answer]
  )
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

  // Auto-collapse reasoning when answer starts streaming
  useEffect(() => {
    if (result.answer.length > 0 && isReasoningExpanded) {
      // Delay collapse for smooth UX
      const timer = setTimeout(() => {
        setIsReasoningExpanded(false)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [result.answer])

  // Auto-scroll answer as it streams
  useEffect(() => {
    if (answerRef.current && isStreaming) {
      answerRef.current.scrollTop = answerRef.current.scrollHeight
    }
  }, [result.answer, isStreaming])

  const handleTryAgain = () => {
    if (showFeedbackInput && feedback.trim()) {
      onTryAgain(feedback.trim())
      setFeedback('')
      setShowFeedbackInput(false)
    } else {
      setShowFeedbackInput(true)
    }
  }

  const handleTryAgainWithoutFeedback = () => {
    onTryAgain()
    setShowFeedbackInput(false)
    setFeedback('')
  }

  return (
    <div className={`max-w-4xl mx-auto p-6 space-y-6 ${className}`}>
      {/* Query Display */}
      <div className="text-center mb-8">
        <p className="text-sm text-white/40 mb-1">Results for</p>
        <h1 className="text-xl font-medium text-white/90">{result.query}</h1>
      </div>

      {/* Chain of Thought Section - Glass Morphic */}
      {result.reasoning.length > 0 && (
        <div
          className="
            group relative
            glass-card
            overflow-hidden
            transition-all duration-500
            hover:elevated
          "
        >
          {/* Ambient Glow Overlay */}
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 bg-gradient-to-tr from-accent/5 via-transparent to-accent-light/5 pointer-events-none" />

          {/* Toggle Header */}
          <button
            onClick={() => setIsReasoningExpanded(!isReasoningExpanded)}
            className="
              relative z-10
              w-full flex items-center justify-between
              px-4 py-3
              hover:bg-white/5 transition-colors
            "
          >
            <div className="flex items-center gap-2">
              <SparklesIcon className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-medium text-white/80">Chain of Thought</span>
              <span className="text-xs px-2 py-0.5 glass-subtle rounded-full text-purple-300">
                {result.reasoning.filter(s => s.status === 'complete').length}/{result.reasoning.length}
              </span>
            </div>
            {isReasoningExpanded ? (
              <ChevronDownIcon className="w-4 h-4 text-white/50" />
            ) : (
              <ChevronRightIcon className="w-4 h-4 text-white/50" />
            )}
          </button>

          {/* Collapsible Content */}
          <div
            className={`
              relative z-10
              overflow-hidden transition-all duration-300 ease-out
              ${isReasoningExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}
            `}
          >
            <div className="px-4 pb-4 space-y-1 border-t border-white/5">
              {result.reasoning.map((step) => (
                <ReasoningStepItem key={step.id} step={step} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Answer Section - Glass Morphic with InlineCitations */}
      <div
        className="
          group relative
          glass-card
          overflow-hidden
          transition-all duration-500
          hover:elevated
        "
      >
        {/* Ambient Glow Overlay */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 bg-gradient-to-tr from-accent/5 via-transparent to-accent-light/5 pointer-events-none" />

        <div
          ref={answerRef}
          className="
            relative z-10
            p-6
            max-h-[50vh] overflow-y-auto
            scrollbar-thin
          "
        >
          {(plans.length > 0 || queues.length > 0) && (
            <div className="mb-6 space-y-4">
              {plans.map((plan, planIndex) => (
                <Plan key={`${planIndex}-${plan.title || 'plan'}`} defaultOpen>
                  <PlanHeader className="items-start gap-3">
                    <div className="space-y-1">
                      <PlanTitle>{plan.title || 'Plan'}</PlanTitle>
                      {plan.description && (
                        <PlanDescription>{plan.description}</PlanDescription>
                      )}
                    </div>
                    <PlanTrigger />
                  </PlanHeader>
                  {plan.steps && plan.steps.length > 0 && (
                    <PlanContent>
                      <ol className="space-y-2">
                        {plan.steps.map((step, index) => (
                          <li key={step.id || `${planIndex}-${index}`} className="flex items-start gap-2">
                            <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                              {index + 1}
                            </span>
                            <div>
                              <p className="text-sm font-medium text-foreground">{step.title}</p>
                              {step.description && (
                                <p className="text-xs text-muted-foreground">{step.description}</p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ol>
                    </PlanContent>
                  )}
                  {plan.footer && (
                    <PlanFooter>
                      <p className="text-xs text-muted-foreground">{plan.footer}</p>
                    </PlanFooter>
                  )}
                </Plan>
              ))}

              {queues.map((queue, queueIndex) => (
                <Queue key={`${queueIndex}-${queue.label || 'queue'}`}>
                  <QueueSection defaultOpen>
                    <QueueSectionTrigger>
                      <QueueSectionLabel count={queue.items.length} label={queue.label || 'Queue'} />
                    </QueueSectionTrigger>
                    <QueueSectionContent>
                      <QueueList>
                        {queue.items.map((item, index) => (
                          <QueueItem key={item.id || `${queueIndex}-${index}`}>
                            <div className="flex items-start gap-2">
                              <QueueItemIndicator completed={item.completed} />
                              <QueueItemContent completed={item.completed}>
                                {item.title}
                              </QueueItemContent>
                            </div>
                            {item.description && (
                              <QueueItemDescription completed={item.completed}>
                                {item.description}
                              </QueueItemDescription>
                            )}
                          </QueueItem>
                        ))}
                      </QueueList>
                    </QueueSectionContent>
                  </QueueSection>
                </Queue>
              ))}
            </div>
          )}

          {cleaned ? (
            <div className="prose prose-invert max-w-none">
              <div
                className="
                  text-base leading-relaxed text-white/80
                  font-['Raleway',_sans-serif] font-light
                  whitespace-pre-wrap
                "
              >
                <ResponseWithCitations
                  content={cleaned}
                  citations={citations}
                />
                {isStreaming && (
                  <span className="inline-block w-0.5 h-5 bg-purple-400 ml-0.5 animate-pulse" />
                )}
              </div>
            </div>
          ) : isStreaming ? (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-3 text-white/40">
                <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                <span>Generating answer...</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Sources Section */}
      {result.sources.length > 0 && (
        <Sources>
          <SourcesTrigger count={result.sources.length} />
          <SourcesContent>
            {result.sources.map((source, index) => {
              const domain = source.domain || getDomainFromUrl(source.url)
              const favicon = source.favicon
                ? source.favicon
                : domain
                ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
                : null

              return (
                <Source key={source.id || `${source.url}-${index}`} href={source.url}>
                  <div className="flex items-start gap-3">
                    {favicon ? (
                      <img src={favicon} alt="" className="mt-0.5 h-4 w-4 rounded" />
                    ) : (
                      <span className="mt-0.5 h-4 w-4 rounded bg-muted" aria-hidden />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        [{index + 1}] {source.title}
                      </p>
                      {source.snippet && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {source.snippet}
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground/80">
                        {domain}
                      </p>
                    </div>
                  </div>
                </Source>
              )
            })}
          </SourcesContent>
        </Sources>
      )}

      {/* Related Queries */}
      {result.relatedQueries.length > 0 && result.isAnswerComplete && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-white/60">Related Searches</h2>
          <div className="flex flex-wrap gap-2">
            {result.relatedQueries.map((query, i) => (
              <button
                key={i}
                className="
                  px-3 py-1.5 text-sm
                  glass-subtle
                  hover:bg-white/10
                  border border-white/10 hover:border-white/20
                  rounded-full text-white/70 hover:text-white/90
                  transition-all duration-200
                "
              >
                {query}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {result.isAnswerComplete && (
        <div className="flex items-center justify-center gap-4 pt-4">
          {/* Let's Chat Button - Primary CTA */}
          {onLetsChat && (
            <button
              onClick={onLetsChat}
              className="
                flex items-center gap-2
                px-6 py-2.5
                bg-gradient-to-r from-teal-500 to-teal-600
                hover:from-teal-400 hover:to-teal-500
                text-white font-medium
                rounded-xl
                shadow-lg shadow-teal-500/20
                transition-all duration-200
                hover:-translate-y-0.5
              "
            >
              <ChatBubbleLeftRightIcon className="w-5 h-5" />
              <span>Let's Chat</span>
            </button>
          )}

          {/* See Full Results Button */}
          <button
            onClick={onSeeFullResults}
            className="
              flex items-center gap-2
              px-6 py-2.5
              bg-gradient-to-r from-purple-600 to-purple-700
              hover:from-purple-500 hover:to-purple-600
              text-white font-medium
              rounded-xl
              shadow-lg shadow-purple-500/20
              transition-all duration-200
              hover:-translate-y-0.5
            "
          >
            <span>See Full Results</span>
            <ArrowRightIcon className="w-4 h-4" />
          </button>

          {/* Try Again Button */}
          <div className="relative">
            {showFeedbackInput ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="What would you like different?"
                  className="
                    px-4 py-2
                    glass-subtle border border-white/20
                    rounded-xl text-sm text-white
                    placeholder:text-white/40
                    focus:outline-none focus:border-purple-500/50
                    w-64
                  "
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTryAgain()
                    if (e.key === 'Escape') setShowFeedbackInput(false)
                  }}
                  autoFocus
                />
                <button
                  onClick={handleTryAgain}
                  className="
                    px-4 py-2
                    glass-subtle hover:bg-white/20
                    border border-white/20
                    rounded-xl text-sm text-white/80
                    transition-colors
                  "
                >
                  Search
                </button>
                <button
                  onClick={handleTryAgainWithoutFeedback}
                  className="
                    p-2
                    text-white/50 hover:text-white/80
                    transition-colors
                  "
                  title="Search again without feedback"
                >
                  <ArrowPathIcon className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={handleTryAgain}
                className="
                  flex items-center gap-2
                  px-4 py-2.5
                  glass-subtle hover:bg-white/10
                  border border-white/10 hover:border-white/20
                  text-white/70 hover:text-white/90
                  rounded-xl
                  transition-all duration-200
                "
              >
                <ArrowPathIcon className="w-4 h-4" />
                <span>Try Again</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default SearchQuickResults
