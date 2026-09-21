/**
 * SonarReasoningProDisplay Component
 *
 * Beautiful, transparent presentation of Sonar Reasoning Pro's chain of thought
 * using AI Elements components with streaming support.
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/utils/cn'

// AI Elements Components
import { ChainOfThought, ChainOfThoughtHeader, ChainOfThoughtContent, ChainOfThoughtStep, ChainOfThoughtSearchResults, ChainOfThoughtSearchResult, ChainOfThoughtImage } from '@/components/ai-elements/chain-of-thought'
import { Reasoning, ReasoningTrigger, ReasoningContent } from '@/components/ai-elements/reasoning'
import { Sources, SourcesTrigger, SourcesContent, Source } from '@/components/ai-elements/sources'
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

// Types
interface Citation {
  id: string
  title: string
  url: string
  snippet?: string
  domain?: string
  relevanceScore?: number
}

interface SearchResult {
  id: string
  query: string
  snippet: string
  url?: string
}

interface ImageData {
  id: string
  url: string
  caption?: string
  base64?: string
  mediaType?: string
}

interface SonarReasoningProDisplayProps {
  query: string
  isStreaming?: boolean
  className?: string
}

interface StreamingState {
  content: string
  reasoning: string
  isReasoningActive: boolean
  searchResults: SearchResult[]
  citations: Citation[]
  images: ImageData[]
  error?: string
}

function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function SonarReasoningProDisplay({
  query,
  isStreaming: initialStreaming = false,
  className
}: SonarReasoningProDisplayProps) {
  const [streamingState, setStreamingState] = useState<StreamingState>({
    content: '',
    reasoning: '',
    isReasoningActive: false,
    searchResults: [],
    citations: [],
    images: []
  })

  const [isStreaming, setIsStreaming] = useState(initialStreaming)
  const [reasoningDuration, setReasoningDuration] = useState<number | undefined>()
  const reasoningStartTime = useRef<number | null>(null)
  const { cleaned, plans, queues } = useMemo(
    () => extractStructuredBlocks(streamingState.content),
    [streamingState.content]
  )

  // Start streaming when component mounts or query changes
  useEffect(() => {
    if (!query) return

    // Reset state
    setStreamingState({
      content: '',
      reasoning: '',
      isReasoningActive: false,
      searchResults: [],
      citations: [],
      images: []
    })
    setIsStreaming(true)
    setReasoningDuration(undefined)

    // Stream from POST endpoint
    const streamResponse = async () => {
      try {
        const response = await fetch('/api/sonar-reasoning-pro/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: query }],
            reasoning_effort: 'high',
            temperature: 0.2
          })
        })

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        const reader = response.body?.getReader()
        const decoder = new TextDecoder()

        if (!reader) {
          throw new Error('No reader available')
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') {
                setIsStreaming(false)
                continue
              }

              try {
                const parsed = JSON.parse(data)

                switch (parsed.type) {
                  case 'content':
                    setStreamingState(prev => ({
                      ...prev,
                      content: prev.content + parsed.content
                    }))
                    break

                  case 'reasoning_start':
                    reasoningStartTime.current = Date.now()
                    setStreamingState(prev => ({
                      ...prev,
                      isReasoningActive: true
                    }))
                    break

                  case 'reasoning':
                    setStreamingState(prev => ({
                      ...prev,
                      reasoning: parsed.content
                    }))
                    break

                  case 'reasoning_end':
                    if (reasoningStartTime.current) {
                      setReasoningDuration(Date.now() - reasoningStartTime.current)
                    }
                    setStreamingState(prev => ({
                      ...prev,
                      isReasoningActive: false
                    }))
                    break

                  case 'metadata':
                    setStreamingState(prev => ({
                      ...prev,
                      citations: parsed.citations || prev.citations,
                      images: parsed.images || prev.images,
                      searchResults: parsed.search_results || prev.searchResults
                    }))
                    break

                  case 'error':
                    setStreamingState(prev => ({
                      ...prev,
                      error: parsed.error
                    }))
                    setIsStreaming(false)
                    break
                }
              } catch (error) {
                console.error('Error parsing SSE data:', error)
              }
            }
          }
        }
      } catch (error) {
        console.error('Streaming error:', error)
        setStreamingState(prev => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Unknown error'
        }))
        setIsStreaming(false)
      }
    }

    streamResponse()
  }, [query])

  return (
    <div className={cn(
      'w-full space-y-4',
      'animate-in fade-in slide-in-from-bottom-2 duration-300',
      className
    )}>
      {/* Error State */}
      {streamingState.error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
        >
          <p className="text-sm text-red-600 dark:text-red-400">
            {streamingState.error}
          </p>
        </motion.div>
      )}

      {/* Reasoning Section - Shows thinking process */}
      {(streamingState.reasoning || streamingState.isReasoningActive) && (
        <Reasoning
          isStreaming={streamingState.isReasoningActive}
          duration={reasoningDuration}
          defaultOpen={streamingState.isReasoningActive}
          autoCollapseDelay={3000}
        >
          <ReasoningTrigger />
          <ReasoningContent>
            {streamingState.reasoning || 'Analyzing your query...'}
          </ReasoningContent>
        </Reasoning>
      )}

      {/* Chain of Thought - Detailed reasoning steps */}
      {streamingState.searchResults.length > 0 && (
        <ChainOfThought defaultOpen={false} className="glass-frosted backdrop-blur-xl">
          <ChainOfThoughtHeader>
            Reasoning Process ({streamingState.searchResults.length} searches)
          </ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            {streamingState.searchResults.map((result, index) => (
              <ChainOfThoughtStep
                key={result.id}
                label={`Search ${index + 1}: ${result.query}`}
                description="Gathering information from multiple sources"
                status={isStreaming ? 'active' : 'complete'}
              >
                <ChainOfThoughtSearchResults>
                  <ChainOfThoughtSearchResult>
                    {result.snippet}
                  </ChainOfThoughtSearchResult>
                  {result.url && (
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-body-xs text-accent dark:text-accent-light hover:underline"
                    >
                      View source →
                    </a>
                  )}
                </ChainOfThoughtSearchResults>
              </ChainOfThoughtStep>
            ))}
          </ChainOfThoughtContent>
        </ChainOfThought>
      )}

      {/* Main Response Content with Inline Citations */}
      {(cleaned || plans.length > 0 || queues.length > 0) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="relative"
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

          {cleaned && (
            <ResponseWithCitations
              content={cleaned}
              citations={streamingState.citations.map((citation, index) => ({
                number: String(index + 1),
                title: citation.title,
                url: citation.url,
                snippet: citation.snippet,
              }))}
              className={cn(
                "prose prose-sm dark:prose-invert max-w-none",
                isStreaming && "animate-pulse"
              )}
            />
          )}
        </motion.div>
      )}

      {/* Images Section */}
      {streamingState.images.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-2 md:grid-cols-3 gap-4"
        >
          {streamingState.images.map((image) => (
            <ChainOfThoughtImage key={image.id} caption={image.caption}>
              <img
                src={image.url}
                alt={image.caption || 'Search result image'}
                className="w-full h-auto rounded-lg"
              />
            </ChainOfThoughtImage>
          ))}
        </motion.div>
      )}

      {/* Sources Section */}
      {streamingState.citations.length > 0 && (
        <Sources className="mt-6">
          <SourcesTrigger count={streamingState.citations.length} />
          <SourcesContent>
            {streamingState.citations.map((citation, index) => {
              const domain = citation.domain || getDomainFromUrl(citation.url)
              const favicon = domain
                ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
                : null

              return (
                <Source key={citation.id} href={citation.url}>
                  <div className="flex items-start gap-3">
                    {favicon ? (
                      <img
                        src={favicon}
                        alt=""
                        className="mt-0.5 h-4 w-4 rounded"
                      />
                    ) : (
                      <span className="mt-0.5 h-4 w-4 rounded bg-muted" aria-hidden />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground line-clamp-1">
                        [{index + 1}] {citation.title}
                      </p>
                      {citation.snippet && (
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                          {citation.snippet}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground/80 line-clamp-1">
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

      {/* Loading State */}
      {isStreaming && !streamingState.content && !streamingState.reasoning && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-center py-12"
        >
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 rounded-full border-2 border-accent/20 dark:border-accent-light/20" />
              <motion.div
                className="absolute inset-0 w-12 h-12 rounded-full border-2 border-accent dark:border-accent-light border-t-transparent"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              />
            </div>
            <p className="text-sm text-ink-secondary dark:text-ink-inverse-secondary">
              Initializing Sonar Reasoning Pro...
            </p>
          </div>
        </motion.div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Export as default for easy importing
// ─────────────────────────────────────────────────────────────────────────────

export default SonarReasoningProDisplay
