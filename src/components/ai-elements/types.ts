/**
 * AI Elements Type Definitions
 */

// ─────────────────────────────────────────────────────────────────────────────
// Core Types
// ─────────────────────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'system'

export type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

export type ToolState = 'pending' | 'running' | 'success' | 'error' | 'input-available'

export type StepStatus = 'pending' | 'running' | 'complete' | 'error'

// ─────────────────────────────────────────────────────────────────────────────
// Message Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AIMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  
  // Reasoning (thinking)
  reasoning?: {
    content: string
    duration: number
  }
  isReasoningComplete?: boolean
  isReasoningStreaming?: boolean
  
  // Content streaming
  isContentComplete?: boolean
  isContentStreaming?: boolean
  
  // Sources/Citations
  sources?: AISource[]
  
  // Tool executions
  tools?: AIToolExecution[]
  
  // Chain of thought
  chainOfThought?: AIChainOfThought
  
  // Versions (for branching)
  versions?: AIMessageVersion[]
  
  // Metadata
  avatar?: string
  name?: string
  model?: string
}

export interface AIMessageVersion {
  id: string
  content: string
}

export interface AISource {
  id: string
  href: string
  title: string
  snippet?: string
  favicon?: string
}

export interface AIToolExecution {
  id: string
  name: string
  description?: string
  type?: 'mcp' | 'function' | 'api'
  state: ToolState
  input?: Record<string, unknown>
  output?: string
  errorText?: string
  startedAt?: number
  completedAt?: number
}

export interface AISuggestion {
  id: string
  text: string
  icon?: React.ReactNode
  color?: string
}

export interface AIArtifact {
  id: string
  type: 'chart' | 'table' | 'code' | 'image' | 'document'
  title: string
  description?: string
  data: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Chain of Thought Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AIChainOfThought {
  id: string
  isComplete: boolean
  steps: AIChainOfThoughtStep[]
}

export interface AIChainOfThoughtStep {
  id: string
  label: string
  description?: string
  status: StepStatus
  icon?: React.ReactNode
  content?: string
  
  // Nested content types
  searchResults?: AISearchResult[]
  tool?: AIToolExecution
  retrieval?: AIRetrievalResult
  browserAction?: AIBrowserAction
  desktopAction?: AIDesktopAction
  codeExecution?: AICodeExecution
  fileEdit?: AIFileEdit
  phoneCall?: AIPhoneCall
  sms?: AISMS
  email?: AIEmail
  document?: AIDocument
  agentTask?: AIAgentTask
}

export interface AISearchResult {
  id: string
  title: string
  url: string
  snippet: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Retrieval Types (Database, API, Web, Vector)
// ─────────────────────────────────────────────────────────────────────────────

export type RetrievalSourceType = 
  | 'web'
  | 'database'
  | 'api'
  | 'vector'
  | 'file'
  | 'cache'
  | 'browser'

export interface AIRetrievalResult {
  id: string
  sourceType: RetrievalSourceType
  sourceName: string
  query: string | object
  resultCount?: number
  duration?: number
  results: AIRetrievalItem[]
  metadata?: Record<string, unknown>
}

export interface AIRetrievalItem {
  id: string
  title: string
  content?: string
  url?: string
  table?: string
  confidence?: number
  metadata?: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser Automation Types
// ─────────────────────────────────────────────────────────────────────────────

export type BrowserActionType = 
  | 'navigate'
  | 'click'
  | 'type'
  | 'scroll'
  | 'extract'
  | 'screenshot'
  | 'wait'
  | 'hover'
  | 'select'

export interface AIBrowserAction {
  id: string
  action: BrowserActionType
  target?: string
  value?: string
  screenshot?: string
  status: StepStatus
  duration?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Desktop/Computer Use Types
// ─────────────────────────────────────────────────────────────────────────────

export type DesktopOS = 'macos' | 'windows' | 'linux'

export type DesktopActionType = 
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'type'
  | 'key_press'
  | 'scroll'
  | 'drag'
  | 'launch_app'
  | 'switch_app'
  | 'screenshot'

export interface AIDesktopAction {
  id: string
  action: DesktopActionType
  target?: string
  value?: string
  coordinates?: { x: number; y: number }
  screenshot?: string
  status: StepStatus
  duration?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Code Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AICodeExecution {
  id: string
  code: string
  language: string
  filename?: string
  status: StepStatus
  output?: string
  error?: string
  executionTime?: number
  memoryUsage?: string
  generatedImages?: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// File Types
// ─────────────────────────────────────────────────────────────────────────────

export type FileAction = 'create' | 'edit' | 'delete' | 'rename' | 'move'

export interface AIFileEdit {
  id: string
  action: FileAction
  filepath: string
  newPath?: string
  language?: string
  diff?: { additions: number; deletions: number }
  preview?: string
  status: StepStatus
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone/Telnyx Types
// ─────────────────────────────────────────────────────────────────────────────

export type CallStatus = 'dialing' | 'ringing' | 'connected' | 'on_hold' | 'ended' | 'failed'
export type CallDirection = 'outbound' | 'inbound'

export interface AIPhoneCall {
  id: string
  phoneNumber: string
  contactName?: string
  direction: CallDirection
  status: CallStatus
  duration?: number
  transcript?: string[]
}

export interface AISMS {
  id: string
  phoneNumber: string
  contactName?: string
  direction: 'outbound' | 'inbound'
  message: string
  status: 'sending' | 'sent' | 'delivered' | 'failed'
  timestamp?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Email Types
// ─────────────────────────────────────────────────────────────────────────────

export type EmailAction = 'check' | 'read' | 'compose' | 'reply' | 'forward' | 'send' | 'archive' | 'delete'

export interface AIEmail {
  id: string
  action: EmailAction
  from?: { name: string; email: string }
  to?: { name: string; email: string }[]
  cc?: { name: string; email: string }[]
  subject?: string
  body?: string
  bodyPreview?: string
  date?: number
  isRead?: boolean
  hasAttachments?: boolean
  labels?: string[]
  status: StepStatus
}

// ─────────────────────────────────────────────────────────────────────────────
// Document Types
// ─────────────────────────────────────────────────────────────────────────────

export type DocumentAction = 'create' | 'edit' | 'share' | 'export'
export type DocumentType = 'doc' | 'sheet' | 'slide' | 'pdf' | 'note'

export interface AIDocument {
  id: string
  action: DocumentAction
  documentType: DocumentType
  title: string
  content?: string
  lastModified?: number
  collaborators?: string[]
  status: StepStatus
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Orchestration Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AIAgentTask {
  id: string
  agentName: string
  agentDescription?: string
  modelId?: string
  tools?: string[]
  handoffReason?: string
  status: StepStatus
  steps?: AIChainOfThoughtStep[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AIModel {
  id: string
  name: string
  provider?: string
  description?: string
}

export interface PromptInputMessage {
  text?: string
  files?: File[]
  textAttachments?: TextAttachment[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Text Attachment Types (for large paste handling)
// ─────────────────────────────────────────────────────────────────────────────

export interface TextAttachment {
  id: string
  file: File
  dataUrl: string
  preview: string
}


