/**
 * Shared types for the Build Workbench feature.
 *
 * NOTE: The full Build Workbench UI was scaffolded but not committed to the
 * repository. These types support the existing `buildStore` and the
 * placeholder `BuildWorkbenchPage` until the feature is reintroduced.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Agents
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentProfile {
  id: string
  name: string
  description: string
  tools: string[]
  avatar: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────────────────

export type ToolCallStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'cancelled'

export interface TextBlock {
  type: 'text'
  content: string
}

export interface ToolCallBlock {
  type: 'tool_call'
  toolName: string
  status: ToolCallStatus
  input?: unknown
  output?: string
  error?: string
}

export interface CodeBlock {
  type: 'code'
  language?: string
  content: string
}

export interface ReasoningBlock {
  type: 'reasoning'
  content: string
}

export type MessageBlock = TextBlock | ToolCallBlock | CodeBlock | ReasoningBlock

export interface BuildMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  blocks: MessageBlock[]
  timestamp: number
  isStreaming?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildSession {
  id: string
  agentId: string
  title: string
  createdAt: number
  updatedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Projects
// ─────────────────────────────────────────────────────────────────────────────

export interface CodingProject {
  id: string
  name: string
  description?: string
  createdAt: number
  updatedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Plan
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionStep {
  id: string
  title: string
  description?: string
  status: 'pending' | 'running' | 'success' | 'error' | 'cancelled'
}

export interface ExecutionPlan {
  id: string
  title: string
  steps: ExecutionStep[]
  createdAt: number
  updatedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Sources / Citations
// ─────────────────────────────────────────────────────────────────────────────

export interface Source {
  url: string
  title: string
  description?: string
  snippet?: string
  favicon?: string
}

export interface Citation {
  url: string
  title: string
  index?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Views
// ─────────────────────────────────────────────────────────────────────────────

export type CenterView = 'chat' | 'project' | 'preview' | 'plan' | 'artifacts'
