/**
 * SonarBrain Component
 * 
 * Displays SonarReasoningPro response with expandable ChainOfThought and inline chat capabilities.
 * Positioned as "Top Left" section of Search Results page.
 * 
 * Features:
 * - Reasoning text with confidence and quality scores
 * - Expandable ChainOfThought section with individual reasoning steps
 * - Sources list with clickable links
 * - "Chat with Me" inline chat interface
 * - "Escalate to Agent" button to route conversation to Ron through Agent UI context
 */

import { useState, useRef, useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'

import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Textarea } from '@/components/ui/textarea'

import type { SonarReasoningResponse, ChainOfThoughtStep, UniversalResult } from '@/pages/types/search'
import { isSocialMediaResult, isImageResult } from '@/pages/types/search'
import { cn } from '@/lib/utils'
import { useAgentUi } from '@/context/AgentUiContext'

// ─────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Message type for inline chat interface
 */
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

/**
 * Props for SonarBrain component
 */
export interface SonarBrainProps {
  /** SonarReasoningPro response containing reasoning, chain of thought, and sources */
  sonarReasoning: SonarReasoningResponse
  /** Original search query */
  searchQuery: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Components
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Brain icon for SonarBrain header
 */
function BrainIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.54" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.54" />
    </svg>
  )
}

/**
 * Chevron icon for expand/collapse
 */
function ChevronDownIcon({ className, isOpen }: { className?: string; isOpen: boolean }) {
  return (
    <svg 
      className={cn('transition-transform duration-200', isOpen && 'rotate-180', className)} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

/**
 * External link icon for sources
 */
function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

/**
 * Step number badge for chain of thought
 */
function StepBadge({ step, status }: { step: number; status: ChainOfThoughtStep['status'] }) {
  const getStatusColor = () => {
    switch (status) {
      case 'complete': return 'bg-primary text-primary-foreground'
      case 'running': return 'bg-yellow-500 text-white'
      case 'error': return 'bg-destructive text-destructive-foreground'
      default: return 'bg-muted text-muted-foreground'
    }
  }

  return (
    <div className={cn('flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold', getStatusColor())}>
      {step}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat Message Components
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Individual chat message in the inline chat interface
 */
function ChatMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex items-start gap-3', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div className={cn(
        'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold',
        isUser 
          ? 'bg-primary text-primary-foreground' 
          : 'bg-gradient-to-br from-accent to-accent-light text-white'
      )}>
        {isUser ? 'U' : <BrainIcon className="w-4 h-4" />}
      </div>

      {/* Message content */}
      <div className={cn(
        'flex flex-col max-w-[80%]',
        isUser ? 'items-end' : 'items-start'
      )}>
        <div className={cn(
          'px-4 py-3 rounded-2xl text-sm',
          isUser 
            ? 'bg-primary text-primary-foreground rounded-br-md' 
            : 'bg-muted text-foreground rounded-bl-md'
        )}>
          {message.content}
        </div>
        <span className="text-xs text-muted-foreground mt-1">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SonarBrain Component
 * 
 * Displays SonarReasoningPro reasoning with inline chat interface
 */
export function SonarBrain({ sonarReasoning, searchQuery }: SonarBrainProps) {
  const { sendToAgentPanel } = useAgentUi()
  // State for chain of thought expansion
  const [isChainOfThoughtOpen, setIsChainOfThoughtOpen] = useState(true)

  // State for inline chat
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [isSending, setIsSending] = useState(false)

  // Ref for scrolling chat messages
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  /**
   * Get color class for confidence badge based on score
   */
  const getConfidenceBadgeVariant = (score: number): 'default' | 'secondary' | 'destructive' | 'outline' => {
    if (score >= 0.8) return 'default'
    if (score >= 0.5) return 'secondary'
    return 'destructive'
  }

  /**
   * Get color class for quality badge based on score
   */
  const getQualityBadgeVariant = (score?: number): 'default' | 'secondary' | 'destructive' | 'outline' => {
    if (!score) return 'outline'
    if (score >= 0.8) return 'default'
    if (score >= 0.5) return 'secondary'
    return 'destructive'
  }

  /**
   * Helper function to get display title from a UniversalResult
   * Handles cases where 'title' doesn't exist (e.g., SocialMediaResult)
   */
  const getDisplayTitle = (result: UniversalResult): string => {
    if (isSocialMediaResult(result)) {
      // SocialMediaResult doesn't have title, use a portion of content
      return result.content.slice(0, 60) + (result.content.length > 60 ? '...' : '')
    }
    
    if (isImageResult(result)) {
      // ImageResult has optional title
      return result.title || result.url.split('/').pop() || 'Untitled Image'
    }
    
    // All other result types have required title
    return 'title' in result ? result.title : searchQuery
  }

  /**
   * Handle sending a message in inline chat
   */
  const handleSendMessage = () => {
    if (!chatInput.trim() || isSending) return

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: chatInput.trim(),
      timestamp: Date.now(),
    }

    setChatMessages(prev => [...prev, userMessage])
    setChatInput('')
    setIsSending(true)

    // Simulate Sonar response (in real implementation, this would call the backend)
    setTimeout(() => {
      const sonarMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `I'm analyzing your follow-up question about "${chatInput.trim()}" based on the reasoning I provided. [This is a placeholder - actual responses will come from SonarReasoningPro backend]`,
        timestamp: Date.now(),
      }

      setChatMessages(prev => [...prev, sonarMessage])
      setIsSending(false)
    }, 1000)
  }

  /**
   * Handle "Escalate to Agent" button click
   * Routes conversation to Ron via Agent Panel context
   */
  const handleEscalateToAgent = () => {
    const escalationPrompt = chatMessages.length > 0
      ? `I was discussing search results for "${searchQuery}" with Sonar. Here's our conversation:\n\n${chatMessages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}\n\nCan you help me continue this conversation?`
      : `I'd like to discuss search results for "${searchQuery}" more deeply.`

    sendToAgentPanel(escalationPrompt)
  }

  return (
    <Card className="w-full">
      {/* Card Header */}
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <BrainIcon className="w-5 h-5 text-primary" />
            <CardTitle>Sonar Reasoning</CardTitle>
          </div>

          {/* Confidence and Quality Badges */}
          <div className="flex items-center gap-2">
            <Badge variant={getConfidenceBadgeVariant(sonarReasoning.confidence)}>
              {(sonarReasoning.confidence * 100).toFixed(0)}% confidence
            </Badge>
            {sonarReasoning.qualityScore && (
              <Badge variant={getQualityBadgeVariant(sonarReasoning.qualityScore)}>
                {(sonarReasoning.qualityScore * 100).toFixed(0)}% quality
              </Badge>
            )}
          </div>
        </div>

        {/* Search Query Description */}
        <CardDescription>
          Results for: "{searchQuery}"
        </CardDescription>
      </CardHeader>

      {/* Card Content */}
      <CardContent className="space-y-6">
        {/* Main Reasoning Text */}
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <p className="text-foreground">{sonarReasoning.reasoning}</p>
        </div>

        {/* Chain of Thought - Expandable Section */}
        {sonarReasoning.chainOfThought && sonarReasoning.chainOfThought.steps.length > 0 && (
          <Collapsible open={isChainOfThoughtOpen} onOpenChange={setIsChainOfThoughtOpen}>
            <CollapsibleTrigger asChild>
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full justify-between hover:bg-muted"
              >
                <span className="flex items-center gap-2 font-medium">
                  <BrainIcon className="w-4 h-4" />
                  Chain of Thought ({sonarReasoning.chainOfThought.steps.length} steps)
                </span>
                <ChevronDownIcon className="w-4 h-4" isOpen={isChainOfThoughtOpen} />
              </Button>
            </CollapsibleTrigger>
            
            <CollapsibleContent className="space-y-3 mt-3">
              {sonarReasoning.chainOfThought.steps.map((step, index) => (
                <Card key={step.id} className="border-muted bg-muted/20">
                  <CardHeader className="p-4">
                    <div className="flex items-start gap-3">
                      <StepBadge step={index + 1} status={step.status} />
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base">{step.label}</CardTitle>
                        {step.description && (
                          <CardDescription className="mt-1">{step.description}</CardDescription>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  {(step.reasoning || (step.searchResults && step.searchResults.length > 0) || (step.tools && step.tools.length > 0)) && (
                    <CardContent className="px-4 pb-4">
                      {/* Step reasoning */}
                      {step.reasoning && (
                        <div className="mb-3 text-sm text-muted-foreground">
                          {step.reasoning}
                        </div>
                      )}

                      {/* Tools used */}
                      {step.tools && step.tools.length > 0 && (
                        <div className="mb-3 flex flex-wrap gap-1">
                          {step.tools.map((tool) => (
                            <Badge key={tool} variant="outline" className="text-xs">
                              {tool}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {/* Search results evidence */}
                      {step.searchResults && step.searchResults.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">Supporting Evidence:</p>
                          {step.searchResults.map((result) => (
                            <div key={result.id} className="p-2 rounded bg-background border text-xs">
                              <div className="font-medium">{getDisplayTitle(result)}</div>
                              <div className="mt-1 text-muted-foreground truncate">
                                {result.url}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Sources List */}
        {sonarReasoning.sources && sonarReasoning.sources.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Sources ({sonarReasoning.sources.length})</h4>
            <div className="space-y-2">
              {sonarReasoning.sources.map((source) => (
                <a
                  key={source.id}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-3 rounded-lg border hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {source.domain && (
                          <span className="text-xs text-muted-foreground">[{source.domain}]</span>
                        )}
                        <span className="text-sm font-medium line-clamp-1">{source.title}</span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{source.snippet}</p>
                      {source.author && (
                        <p className="text-xs text-muted-foreground mt-1">By {source.author}</p>
                      )}
                    </div>
                    <ExternalLinkIcon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                  </div>
                  {source.relevanceScore !== undefined && (
                    <div className="mt-2">
                      <div className="h-1 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary transition-all duration-300"
                          style={{ width: `${source.relevanceScore * 100}%` }}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Relevance: {(source.relevanceScore * 100).toFixed(0)}%
                      </div>
                    </div>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      {/* Card Footer - Action Buttons */}
      <CardFooter className="flex-col gap-3">
        <div className="flex items-center gap-2 w-full">
          <Button 
            variant="default" 
            className="flex-1"
            onClick={() => setIsChatOpen(!isChatOpen)}
          >
            <BrainIcon className="w-4 h-4 mr-2" />
            Chat with Me
          </Button>
          {chatMessages.length > 0 && (
            <Button 
              variant="outline"
              onClick={handleEscalateToAgent}
            >
              Escalate to Agent
            </Button>
          )}
        </div>

        {/* Inline Chat Interface */}
        <AnimatePresence>
          {isChatOpen && (
            <div className="w-full space-y-3 pt-3 border-t">
              {/* Chat Messages */}
              <div className="max-h-60 overflow-y-auto space-y-4 pr-2">
                {chatMessages.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    <BrainIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>Ask a follow-up question about these results</p>
                  </div>
                ) : (
                  chatMessages.map((message) => (
                    <ChatMessage key={message.id} message={message} />
                  ))
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input */}
              <div className="flex gap-2">
                <Textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSendMessage()
                    }
                  }}
                  placeholder="Ask a follow-up question..."
                  className="flex-1 min-h-[80px] resize-none"
                  disabled={isSending}
                />
                <Button 
                  onClick={handleSendMessage}
                  disabled={!chatInput.trim() || isSending}
                  className="self-end"
                >
                  {isSending ? '...' : 'Send'}
                </Button>
              </div>

              {/* Escalate button visible when chat is active */}
              {chatMessages.length > 0 && (
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={handleEscalateToAgent}
                  className="w-full"
                >
                  <ExternalLinkIcon className="w-4 h-4 mr-2" />
                  Move this conversation to Ren
                </Button>
              )}
            </div>
          )}
        </AnimatePresence>
      </CardFooter>
    </Card>
  )
}
