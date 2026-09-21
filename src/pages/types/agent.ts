/**
 * Agent Types
 * 
 * Types for AI agent communication, streaming, and conversation management.
 * Compatible with Strands Agent Framework patterns.
 */

// ============================================
// Message Types
// ============================================

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  
  // Streaming state
  isStreaming?: boolean
  streamedContent?: string
  
  // Tool usage
  toolUses?: ToolUse[]
  
  // Metadata
  model?: string
  tokens?: TokenUsage
  stopReason?: StopReason
}

export interface ToolUse {
  id: string
  name: string
  input?: Record<string, unknown>
  result?: ToolResult
  status: 'pending' | 'running' | 'success' | 'error'
  startedAt?: number
  completedAt?: number
}

export interface ToolResult {
  status: 'success' | 'error'
  content: Array<{ text?: string; type?: string }>
  error?: string
}

export interface TokenUsage {
  input: number
  output: number
  total: number
  reasoningTokens?: number
}

export type StopReason = 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence'

// ============================================
// Conversation Types
// ============================================

export interface Conversation {
  id: string
  title?: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  
  // Context
  systemPrompt?: string
  context?: ConversationContext
  
  // State
  isActive: boolean
  lastMessageAt?: number
}

export interface ConversationContext {
  // User context from onboarding
  userInterests?: string[]
  userPreferences?: Record<string, unknown>
  
  // Session context
  currentUrl?: string
  pageContent?: string
  selectedText?: string
  
  // Provided tab contexts (attachments)
  selectedTabs?: Array<{
    id: string
    url: string
    title: string
    favicon?: string
    isExternal?: boolean
    dom?: { html: string; text: string; metas: Array<{ name: string; content: string }>; localStorage: Record<string, string | null>; sessionStorage: Record<string, string | null> }
    cookies?: Array<{ name: string; value: string; domain?: string; path?: string }>
    screenshot?: string
  }>
  
  // Agent context
  agentId?: string
  agentName?: string
}

// ============================================
// Streaming Event Types (Strands-compatible)
// ============================================

export interface AgentStreamEvent {
  // UIMessageStream event type
  type?: string
  id?: string
  delta?: string
  finishReason?: string

  // Text streaming
  data?: unknown
  reasoningText?: string
  
  // Event loop lifecycle
  init_event_loop?: boolean
  start_event_loop?: boolean
  complete?: boolean
  force_stop?: boolean
  force_stop_reason?: string
  
  // Message events
  message?: {
    role: 'user' | 'assistant' | 'system'
    content?: Array<{ text?: string; type?: string }>
  }
  
  // Tool events
  current_tool_use?: {
    id?: string
    name?: string
    input?: Record<string, unknown>
  }
  toolCallId?: string
  toolName?: string
  input?: Record<string, unknown>
  output?: unknown
  errorText?: string
  tool_stream_event?: {
    data?: unknown
  }
  
  // Result
  result?: AgentResult
}

export interface AgentResult {
  message: {
    role: 'assistant'
    content: Array<{ text?: string; type?: string }>
  }
  stop_reason: StopReason
  metrics?: {
    latency?: number
    tokens?: TokenUsage
  }
}

// ============================================
// Agent Request Types
// ============================================

export interface ChatRequest {
  prompt: string
  conversationId?: string
  
  // Context
  systemPrompt?: string
  context?: ConversationContext
  
  // Options
  stream?: boolean
  model?: string
  temperature?: number
  maxTokens?: number
  
  // Tools
  tools?: string[]  // Tool names to enable
}

export interface ChatResponse {
  message: Message
  conversationId: string
  usage?: TokenUsage
}

// ============================================
// Agent State Types
// ============================================

export interface AgentState {
  // Panel state
  isPanelOpen: boolean
  interactionMode: 'voice' | 'text'
  
  // Agent state
  isListening: boolean
  isSpeaking: boolean
  isThinking: boolean
  isStreaming: boolean
  
  // Vision state
  isViewingScreen: boolean
  screenshotData: string | null
  
  // Conversation state
  activeConversationId: string | null
  conversations: Record<string, Conversation>
  
  // Current streaming state
  currentStreamingMessage: string | null
  currentToolUse: ToolUse | null
  
  // Error state
  error: AgentError | null
  
  // Connection state
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error'
}

export interface AgentError {
  code: string
  message: string
  recoverable: boolean
}

// ============================================
// Agent Actions
// ============================================

export type AgentAction =
  | { type: 'OPEN_PANEL' }
  | { type: 'CLOSE_PANEL' }
  | { type: 'SET_INTERACTION_MODE'; mode: 'voice' | 'text' }
  | { type: 'START_LISTENING' }
  | { type: 'STOP_LISTENING' }
  | { type: 'START_THINKING' }
  | { type: 'STOP_THINKING' }
  | { type: 'START_STREAMING' }
  | { type: 'STOP_STREAMING' }
  | { type: 'UPDATE_STREAMING_CONTENT'; content: string }
  | { type: 'FINALIZE_MESSAGE'; message: Message }
  | { type: 'ADD_MESSAGE'; message: Message }
  | { type: 'SET_ERROR'; error: AgentError | null }
  | { type: 'SET_CONNECTION_STATUS'; status: AgentState['connectionStatus'] }
  | { type: 'START_VIEWING_SCREEN'; screenshot?: string }
  | { type: 'STOP_VIEWING_SCREEN' }
  | { type: 'SET_TOOL_USE'; toolUse: ToolUse | null }
  | { type: 'CLEAR_CONVERSATION' }

// ============================================
// Type Guards
// ============================================

export function isAgentStreamEvent(value: unknown): value is AgentStreamEvent {
  return typeof value === 'object' && value !== null
}

export function hasStreamData(event: AgentStreamEvent): event is AgentStreamEvent & { data: string } {
  return typeof event.data === 'string'
}

export function hasToolUse(event: AgentStreamEvent): event is AgentStreamEvent & { current_tool_use: NonNullable<AgentStreamEvent['current_tool_use']> } {
  return event.current_tool_use !== undefined && event.current_tool_use !== null
}

export function hasResult(event: AgentStreamEvent): event is AgentStreamEvent & { result: AgentResult } {
  return event.result !== undefined
}
