/**
 * AI Elements Showcase - NYC Pizza Chat Simulation
 *
 * Simple demo: User asks about pizza, Ron responds with tools and reasoning.
 * ~75 seconds runtime. Steps auto-collapse but are re-openable.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/cn'

// AI Elements Components
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
  ChainOfThoughtSearchResults,
  ChainOfThoughtSearchResult,
} from '@/components/ai-elements/chain-of-thought'

import { Tool, ToolHeader, ToolContent, ToolInput } from '@/components/ai-elements/tool'

import { Reasoning, ReasoningTrigger, ReasoningContent } from '@/components/ai-elements/reasoning'

import { Task, TaskTrigger, TaskContent } from '@/components/ai-elements/task'

import {
  StrandsSwarm,
  type SwarmState,
  type StrandsSwarmNode,
  type StrandsSwarmEdge,
} from '@/components/ai-elements/strands-orchestration'

import { ResponseMarkdown } from '@/components/ai-elements/response'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface WebResult {
  id: string
  title: string
  url: string
  snippet: string
}

interface Paper {
  id: string
  title: string
  journal: string
  confidence: number
}

interface DemoImage {
  id: string
  url: string
  alt: string
}

type StepStatus = 'pending' | 'running' | 'complete' | 'error'
type ToolState = 'pending' | 'running' | 'success'
type CallStatus = 'idle' | 'dialing' | 'ringing' | 'connected' | 'ended'

/** Map internal StepStatus to ChainOfThoughtStep's expected status */
function toCotStatus(s: StepStatus): 'pending' | 'active' | 'complete' {
  if (s === 'running') return 'active'
  if (s === 'error') return 'complete'
  return s as 'pending' | 'complete'
}

// ─────────────────────────────────────────────────────────────────────────────
// DEMO DATA
// ─────────────────────────────────────────────────────────────────────────────

const WEB_RESULTS: WebResult[] = [
  { id: 'w1', title: "Joe's Pizza - The Best Slice in NYC", url: 'https://ny.eater.com/joes-pizza', snippet: "Since 1975, Joe's has been serving what many consider the quintessential New York slice." },
  { id: 'w2', title: "NYC's Top 10 Pizza Spots 2024", url: 'https://timeout.com/nyc/pizza', snippet: "From dollar slices to gourmet pies, we rank the absolute best pizza in New York City." },
  { id: 'w3', title: "Di Fara Pizza: Worth the Wait?", url: 'https://seriouseats.com/di-fara', snippet: "Dom DeMarco's legendary Brooklyn pizzeria draws lines around the block." },
  { id: 'w4', title: "Prince Street Pizza: The Spicy Spring", url: 'https://infatuation.com/prince-street', snippet: "The pepperoni-studded square slice that launched a thousand Instagram posts." },
  { id: 'w5', title: "L'industrie Pizzeria Brooklyn", url: 'https://nytimes.com/lindustrie', snippet: "This Williamsburg spot serves some of the best Neapolitan-style pizza outside of Naples." },
]

const PAPERS: Paper[] = [
  { id: 'p1', title: 'The Maillard Reaction in Pizza Crust Formation', journal: 'Journal of Food Science', confidence: 0.94 },
  { id: 'p2', title: 'Optimal Oven Temperature for Neapolitan Pizza', journal: 'Culinary Science Quarterly', confidence: 0.89 },
  { id: 'p3', title: 'Consumer Preferences in NYC Pizza Culture', journal: 'Food Studies Journal', confidence: 0.82 },
]

const IMAGES: DemoImage[] = [
  { id: 'i1', url: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=300&h=200&fit=crop', alt: "Classic New York pizza slice" },
  { id: 'i2', url: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=300&h=200&fit=crop', alt: "Pizza being made" },
  { id: 'i3', url: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=300&h=200&fit=crop', alt: "Fresh pizza with toppings" },
]

const PHONE_TRANSCRIPT = [
  "Joe's Pizza, how can I help you?",
  "Hi, I'm checking if you're open today and what time you close?",
  "Yes! We're open until 4 AM tonight.",
  "Perfect, thank you so much!",
]

const FINAL_RESPONSE = `Based on my comprehensive research, here are my top recommendations for the best pizza slice in NYC:

**Top Pick: Joe's Pizza** (Greenwich Village)
The quintessential New York slice since 1975. Perfect thin crust with just the right amount of char. I just confirmed they're open until 4 AM tonight!

**Runner Up: Prince Street Pizza** (NoLita)
Famous for their spicy spring square slice - worth the line!

**Honorable Mention: Di Fara Pizza** (Brooklyn)
If you have time, Dom DeMarco's legendary pies are worth the trip.

The food science research confirms that the key to great NYC pizza is the Maillard reaction at high temperatures - something these spots have mastered.`

// ─────────────────────────────────────────────────────────────────────────────
// SWARM STATE
// ─────────────────────────────────────────────────────────────────────────────

function createSwarmState(): SwarmState {
  const nodes: StrandsSwarmNode[] = [
    { id: "orchestrator", type: "swarm-node", position: { x: 320, y: 20 }, data: { type: "swarm-node", agent: { id: "orchestrator", name: "Ron", description: "Coordinates pizza research", modelProvider: "bedrock", modelId: "claude-opus-4", tools: ["handoff"], priority: 5 }, status: "idle", isEntryPoint: true, canHandoffTo: ["food_expert", "local_guide", "reviewer"] } },
    { id: "food_expert", type: "swarm-node", position: { x: 40, y: 220 }, data: { type: "swarm-node", agent: { id: "food_expert", name: "Food Expert", description: "Analyzes pizza quality", modelProvider: "anthropic", modelId: "claude-sonnet-4", tools: ["search"], priority: 4 }, status: "idle", canHandoffTo: ["orchestrator", "reviewer"] } },
    { id: "local_guide", type: "swarm-node", position: { x: 320, y: 220 }, data: { type: "swarm-node", agent: { id: "local_guide", name: "Local Guide", description: "NYC expertise", modelProvider: "anthropic", modelId: "claude-sonnet-4", tools: ["maps"], priority: 4 }, status: "idle", canHandoffTo: ["orchestrator", "food_expert"] } },
    { id: "reviewer", type: "swarm-node", position: { x: 600, y: 220 }, data: { type: "swarm-node", agent: { id: "reviewer", name: "Reviewer", description: "Compiles recommendations", modelProvider: "bedrock", modelId: "claude-sonnet-4", tools: ["summarize"], priority: 3 }, status: "idle", canHandoffTo: ["orchestrator"] } },
  ]
  const edges: StrandsSwarmEdge[] = [
    { id: "e1", source: "orchestrator", target: "food_expert", type: "swarm-edge", data: { type: "swarm-edge", isActive: false } },
    { id: "e2", source: "orchestrator", target: "local_guide", type: "swarm-edge", data: { type: "swarm-edge", isActive: false } },
    { id: "e3", source: "orchestrator", target: "reviewer", type: "swarm-edge", data: { type: "swarm-edge", isActive: false } },
    { id: "e4", source: "food_expert", target: "reviewer", type: "swarm-edge", data: { type: "swarm-edge", isActive: false } },
    { id: "e5", source: "local_guide", target: "reviewer", type: "swarm-edge", data: { type: "swarm-edge", isActive: false } },
  ]
  return { 
    id: "pizza_swarm", 
    status: "running", 
    currentNode: "orchestrator", 
    nodes, 
    edges, 
    nodeHistory: ["orchestrator"], 
    handoffs: [], 
    sharedContext: { orchestrator: { query: "Best pizza in NYC" } }, 
    maxHandoffs: 8, 
    handoffCount: 0 
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function AIElementsShowcase() {
  const [isRunning, setIsRunning] = useState(false)
  const [showUser, setShowUser] = useState(false)
  const [showCoT, setShowCoT] = useState(false)

  // Step states - simple
  const [step1, setStep1] = useState<{ status: StepStatus; text: string; streaming: boolean }>({ status: 'pending', text: '', streaming: false })
  const [step2, setStep2] = useState<{ status: StepStatus; tool: ToolState; results: WebResult[] }>({ status: 'pending', tool: 'pending', results: [] })
  const [step3, setStep3] = useState<{ status: StepStatus; text: string; streaming: boolean }>({ status: 'pending', text: '', streaming: false })
  const [step4, setStep4] = useState<{ status: StepStatus; tool: ToolState; papers: Paper[] }>({ status: 'pending', tool: 'pending', papers: [] })
  const [step5, setStep5] = useState<{ status: StepStatus; text: string; streaming: boolean }>({ status: 'pending', text: '', streaming: false })
  const [step6, setStep6] = useState<{ status: StepStatus; tool: ToolState; images: DemoImage[] }>({ status: 'pending', tool: 'pending', images: [] })
  const [step7, setStep7] = useState<{ status: StepStatus; text: string; streaming: boolean }>({ status: 'pending', text: '', streaming: false })
  const [step8, setStep8] = useState<{ status: StepStatus; orchestration: ToolState }>({ status: 'pending', orchestration: 'pending' })
  const [step9, setStep9] = useState<{ status: StepStatus; text: string; streaming: boolean }>({ status: 'pending', text: '', streaming: false })
  const [step10, setStep10] = useState<{ status: StepStatus; tool: ToolState; call: CallStatus; transcript: string[] }>({ status: 'pending', tool: 'pending', call: 'idle', transcript: [] })

  const [showFinal, setShowFinal] = useState(false)
  const [finalText, setFinalText] = useState('')
  const [finalStreaming, setFinalStreaming] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const swarmState = createSwarmState()

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [step1, step2, step3, step4, step5, step6, step7, step8, step9, step10, finalText])

  const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

  const streamText = async (text: string, onUpdate: (t: string) => void, ms = 60) => {
    const words = text.split(' ')
    for (let i = 0; i < words.length; i++) {
      await delay(ms)
      onUpdate(words.slice(0, i + 1).join(' '))
    }
  }

  const runDemo = useCallback(async () => {
    setIsRunning(true)

    // User message
    await delay(500)
    setShowUser(true)
    await delay(1000)
    setShowCoT(true)

    // Step 1: Initial reasoning (~5s)
    await delay(800)
    setStep1({ status: 'running', text: '', streaming: true })
    await streamText(
      "I'll help you find the best pizza in NYC. Let me search for current recommendations and reviews, then check some food science research on what makes NYC pizza special.",
      (t) => setStep1(s => ({ ...s, text: t })),
      70
    )
    await delay(500)
    setStep1(s => ({ ...s, status: 'complete', streaming: false }))

    // Step 2: Web search (~10s)
    await delay(1500)
    setStep2({ status: 'running', tool: 'running', results: [] })
    await delay(2000)
    for (let i = 0; i < WEB_RESULTS.length; i++) {
      await delay(1200)
      setStep2(s => ({ ...s, results: WEB_RESULTS.slice(0, i + 1) }))
    }
    await delay(1000)
    setStep2(s => ({ ...s, status: 'complete', tool: 'success' }))

    // Step 3: Research reasoning (~5s)
    await delay(1500)
    setStep3({ status: 'running', text: '', streaming: true })
    await streamText(
      "Found several highly-rated spots. Let me also check food science research to understand what makes these pizzerias stand out technically.",
      (t) => setStep3(s => ({ ...s, text: t })),
      70
    )
    await delay(500)
    setStep3(s => ({ ...s, status: 'complete', streaming: false }))

    // Step 4: Academic papers (~8s)
    await delay(1500)
    setStep4({ status: 'running', tool: 'running', papers: [] })
    await delay(1500)
    for (let i = 0; i < PAPERS.length; i++) {
      await delay(1500)
      setStep4(s => ({ ...s, papers: PAPERS.slice(0, i + 1) }))
    }
    await delay(1000)
    setStep4(s => ({ ...s, status: 'complete', tool: 'success' }))

    // Step 5: Image reasoning (~4s)
    await delay(1500)
    setStep5({ status: 'running', text: '', streaming: true })
    await streamText(
      "The Maillard reaction research explains the perfect char. Let me find visual references so you know what to look for.",
      (t) => setStep5(s => ({ ...s, text: t })),
      70
    )
    await delay(500)
    setStep5(s => ({ ...s, status: 'complete', streaming: false }))

    // Step 6: Images (~4s)
    await delay(1500)
    setStep6({ status: 'running', tool: 'running', images: [] })
    await delay(2000)
    setStep6({ status: 'complete', tool: 'success', images: IMAGES })

    // Step 7: Orchestration reasoning (~5s)
    await delay(1500)
    setStep7({ status: 'running', text: '', streaming: true })
    await streamText(
      "Now coordinating with specialized agents - Food Expert, Local Guide, and Reviewer - to synthesize recommendations.",
      (t) => setStep7(s => ({ ...s, text: t })),
      70
    )
    await delay(500)
    setStep7(s => ({ ...s, status: 'complete', streaming: false }))

    // Step 8: Agent orchestration (~6s)
    await delay(1500)
    setStep8({ status: 'running', orchestration: 'running' })
    await delay(5000)
    setStep8({ status: 'complete', orchestration: 'success' })

    // Step 9: Phone reasoning (~4s)
    await delay(1500)
    setStep9({ status: 'running', text: '', streaming: true })
    await streamText(
      "Joe's Pizza is the top pick. Let me call them to confirm they're open today.",
      (t) => setStep9(s => ({ ...s, text: t })),
      70
    )
    await delay(500)
    setStep9(s => ({ ...s, status: 'complete', streaming: false }))

    // Step 10: Phone call (~15s)
    await delay(1500)
    setStep10({ status: 'running', tool: 'running', call: 'dialing', transcript: [] })
    await delay(2500)
    setStep10(s => ({ ...s, call: 'ringing' }))
    await delay(3000)
    setStep10(s => ({ ...s, call: 'connected' }))
    for (let i = 0; i < PHONE_TRANSCRIPT.length; i++) {
      await delay(2500)
      setStep10(s => ({ ...s, transcript: PHONE_TRANSCRIPT.slice(0, i + 1) }))
    }
    await delay(2000)
    setStep10({ status: 'complete', tool: 'success', call: 'ended', transcript: PHONE_TRANSCRIPT })

    // Final response (~8s)
    await delay(2000)
    setShowFinal(true)
    setFinalStreaming(true)
    await streamText(FINAL_RESPONSE, setFinalText, 40)
    await delay(500)
    setFinalStreaming(false)
    setIsRunning(false)
  }, [])

  const reset = () => {
    setIsRunning(false)
    setShowUser(false)
    setShowCoT(false)
    setStep1({ status: 'pending', text: '', streaming: false })
    setStep2({ status: 'pending', tool: 'pending', results: [] })
    setStep3({ status: 'pending', text: '', streaming: false })
    setStep4({ status: 'pending', tool: 'pending', papers: [] })
    setStep5({ status: 'pending', text: '', streaming: false })
    setStep6({ status: 'pending', tool: 'pending', images: [] })
    setStep7({ status: 'pending', text: '', streaming: false })
    setStep8({ status: 'pending', orchestration: 'pending' })
    setStep9({ status: 'pending', text: '', streaming: false })
    setStep10({ status: 'pending', tool: 'pending', call: 'idle', transcript: [] })
    setShowFinal(false)
    setFinalText('')
    setFinalStreaming(false)
  }

  const isEmpty = !showUser

  return (
    <div className="h-screen flex flex-col bg-surface-0 dark:bg-surface-900">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-surface-200 dark:border-surface-700">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-ink dark:text-ink-inverse">AI Elements Showcase</h1>
            <p className="text-sm text-ink-muted dark:text-ink-inverse-muted">Interactive demo of Ron's capabilities</p>
          </div>
          {!isEmpty && (
            <button
              onClick={reset}
              disabled={isRunning}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium",
                isRunning ? "bg-surface-200 dark:bg-surface-700 text-ink-muted cursor-not-allowed" : "bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700"
              )}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="h-full flex flex-col items-center justify-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mb-8">
              <span className="text-2xl font-light text-white">R</span>
            </div>
            <h2 className="text-2xl font-light text-ink dark:text-ink-inverse mb-2">AI Elements Demo</h2>
            <p className="text-ink-muted dark:text-ink-inverse-muted text-center mb-8 max-w-md">
              Watch Ron answer a question using reasoning, web search, academic research, images, agent orchestration, and a phone call.
            </p>
            <button
              onClick={runDemo}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-medium hover:opacity-90"
            >
              Start Demo
            </button>
            <p className="mt-4 text-sm text-ink-muted/60">"Where can I get the best slice of pizza in NYC?"</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            {/* User Message */}
            <AnimatePresence>
              {showUser && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
                  <div className="max-w-[80%] px-4 py-3 rounded-2xl rounded-br-md bg-gradient-to-br from-violet-600 to-indigo-600 text-white">
                    Where can I get the best slice of pizza in NYC?
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Chain of Thought */}
            <AnimatePresence>
              {showCoT && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                  <ChainOfThought defaultOpen={true}>
                    <ChainOfThoughtHeader>Thinking Process</ChainOfThoughtHeader>
                    <ChainOfThoughtContent>

                      {/* Step 1: Initial Reasoning */}
                      {step1.status !== 'pending' && (
                        <ChainOfThoughtStep label="Analyzing Request" status={toCotStatus(step1.status)}>
                          <Reasoning isStreaming={step1.streaming} defaultOpen={true} autoCollapseDelay={3000}>
                            <ReasoningTrigger />
                            <ReasoningContent>{step1.text}</ReasoningContent>
                          </Reasoning>
                        </ChainOfThoughtStep>
                      )}

                      {/* Step 2: Web Search */}
                      {step2.status !== 'pending' && (
                        <ChainOfThoughtStep label="Web Search" description="Finding pizza recommendations" status={toCotStatus(step2.status)}>
                          <Tool defaultOpen={true}>
                            <ToolHeader title="brave_web_search" type="mcp" state={step2.tool} />
                            <ToolContent>
                              <ToolInput input={{ query: "best pizza slice NYC 2024", count: 5 }} />
                              {step2.results.length > 0 && (
                                <div className="mt-2 space-y-2">
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>Brave Search</span>
                                    <span>&middot;</span>
                                    <span>{step2.results.length} results</span>
                                    {step2.tool === 'success' && <span>&middot; 234ms</span>}
                                  </div>
                                  <ChainOfThoughtSearchResults>
                                    {step2.results.map((r) => (
                                      <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer">
                                        <ChainOfThoughtSearchResult>{r.title}</ChainOfThoughtSearchResult>
                                      </a>
                                    ))}
                                  </ChainOfThoughtSearchResults>
                                </div>
                              )}
                            </ToolContent>
                          </Tool>
                        </ChainOfThoughtStep>
                      )}

                      {/* Step 3: Research Reasoning */}
                      {step3.status !== 'pending' && (
                        <ChainOfThoughtStep label="Analyzing Results" status={toCotStatus(step3.status)}>
                          <Reasoning isStreaming={step3.streaming} defaultOpen={true} autoCollapseDelay={3000}>
                            <ReasoningTrigger />
                            <ReasoningContent>{step3.text}</ReasoningContent>
                          </Reasoning>
                        </ChainOfThoughtStep>
                      )}

                      {/* Step 4: Academic Papers */}
                      {step4.status !== 'pending' && (
                        <ChainOfThoughtStep label="Academic Research" description="Food science literature" status={toCotStatus(step4.status)}>
                          <Tool defaultOpen={true}>
                            <ToolHeader title="semantic_scholar_search" type="mcp" state={step4.tool} />
                            <ToolContent>
                              <ToolInput input={{ query: "pizza crust Maillard NYC", limit: 3 }} />
                              {step4.papers.length > 0 && (
                                <div className="mt-2 space-y-2">
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>Semantic Scholar</span>
                                    <span>&middot;</span>
                                    <span>{step4.papers.length} results</span>
                                    {step4.tool === 'success' && <span>&middot; 456ms</span>}
                                  </div>
                                  <ChainOfThoughtSearchResults>
                                    {step4.papers.map((p) => (
                                      <ChainOfThoughtSearchResult key={p.id}>
                                        {p.title} ({Math.round(p.confidence * 100)}%)
                                      </ChainOfThoughtSearchResult>
                                    ))}
                                  </ChainOfThoughtSearchResults>
                                </div>
                              )}
                            </ToolContent>
                          </Tool>
                        </ChainOfThoughtStep>
                      )}

                      {/* Step 5: Image Reasoning */}
                      {step5.status !== 'pending' && (
                        <ChainOfThoughtStep label="Planning Visual Search" status={toCotStatus(step5.status)}>
                          <Reasoning isStreaming={step5.streaming} defaultOpen={true} autoCollapseDelay={3000}>
                            <ReasoningTrigger />
                            <ReasoningContent>{step5.text}</ReasoningContent>
                          </Reasoning>
                        </ChainOfThoughtStep>
                      )}

                      {/* Step 6: Images */}
                      {step6.status !== 'pending' && (
                        <ChainOfThoughtStep label="Image Search" description="Visual references" status={toCotStatus(step6.status)}>
                          <Tool defaultOpen={true}>
                            <ToolHeader title="brave_image_search" type="mcp" state={step6.tool} />
                            <ToolContent>
                              <ToolInput input={{ query: "NYC pizza slice", count: 3 }} />
                              {step6.images.length > 0 && (
                                <div className="grid grid-cols-3 gap-2 mt-2">
                                  {step6.images.map((img) => (
                                    <div key={img.id} className="aspect-[3/2] rounded-lg overflow-hidden bg-surface-100 dark:bg-surface-800">
                                      <img src={img.url} alt={img.alt} className="w-full h-full object-cover" />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </ToolContent>
                          </Tool>
                        </ChainOfThoughtStep>
                      )}

                      {/* Step 7: Orchestration Reasoning */}
                      {step7.status !== 'pending' && (
                        <ChainOfThoughtStep label="Coordinating Agents" status={toCotStatus(step7.status)}>
                          <Reasoning isStreaming={step7.streaming} defaultOpen={true} autoCollapseDelay={3000}>
                            <ReasoningTrigger />
                            <ReasoningContent>{step7.text}</ReasoningContent>
                          </Reasoning>
                        </ChainOfThoughtStep>
                      )}

                      {/* Step 8: Agent Orchestration */}
                      {step8.status !== 'pending' && (
                        <ChainOfThoughtStep label="Agent Orchestration" description="Multi-agent collaboration" status={toCotStatus(step8.status)}>
                          <Task defaultOpen>
                            <TaskTrigger title="Agent Swarm" description="4 agents coordinating" status={step8.orchestration as any} />
                            <TaskContent>
                              <div className="h-[280px] w-full rounded-lg overflow-hidden border border-surface-200 dark:border-surface-700">
                                <StrandsSwarm initialState={swarmState} onEvent={() => {}} showHistory={false} showStats={false} showContext={false} showControls={false} />
                              </div>
                            </TaskContent>
                          </Task>
                        </ChainOfThoughtStep>
                      )}

                      {/* Step 9: Phone Reasoning */}
                      {step9.status !== 'pending' && (
                        <ChainOfThoughtStep label="Planning Verification" status={toCotStatus(step9.status)}>
                          <Reasoning isStreaming={step9.streaming} defaultOpen={true} autoCollapseDelay={3000}>
                            <ReasoningTrigger />
                            <ReasoningContent>{step9.text}</ReasoningContent>
                          </Reasoning>
                        </ChainOfThoughtStep>
                      )}

                      {/* Step 10: Phone Call */}
                      {step10.status !== 'pending' && (
                        <ChainOfThoughtStep label="Phone Verification" description="Confirming hours" status={toCotStatus(step10.status)}>
                          <Tool defaultOpen={true}>
                            <ToolHeader title="telnyx_make_call" type="mcp" state={step10.tool} />
                            <ToolContent>
                              <ToolInput input={{ to: "+1 (212) 366-1182", from: "+1 (888) RON-AI00" }} />
                              {step10.call !== 'idle' && (
                                <div className="mt-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
                                  <div className="flex items-center gap-2 text-sm">
                                    <span className="font-medium">Joe's Pizza</span>
                                    <span className="text-xs text-muted-foreground">+1 (212) 366-1182</span>
                                    <span className={cn(
                                      "ml-auto text-xs font-medium px-2 py-0.5 rounded-full",
                                      step10.call === 'dialing' && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                                      step10.call === 'ringing' && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                                      step10.call === 'connected' && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
                                      step10.call === 'ended' && "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
                                    )}>
                                      {step10.call === 'dialing' ? 'Dialing...' : step10.call === 'ringing' ? 'Ringing...' : step10.call === 'connected' ? 'Connected' : `Ended · ${18}s`}
                                    </span>
                                  </div>
                                  {step10.transcript.length > 0 && (
                                    <div className="space-y-1.5 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                                      {step10.transcript.map((line, i) => (
                                        <div key={i} className="text-xs text-zinc-600 dark:text-zinc-400">
                                          <span className="font-medium text-zinc-500 dark:text-zinc-500">{i % 2 === 0 ? 'Them' : 'Ron'}:</span> {line}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </ToolContent>
                          </Tool>
                        </ChainOfThoughtStep>
                      )}

                    </ChainOfThoughtContent>
                  </ChainOfThought>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Final Response */}
            <AnimatePresence>
              {showFinal && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="px-4 py-3 rounded-2xl rounded-bl-md bg-surface-100 dark:bg-surface-800">
                  <ResponseMarkdown content={finalText} isStreaming={finalStreaming} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}

export default AIElementsShowcase
