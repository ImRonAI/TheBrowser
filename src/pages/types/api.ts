/**
 * API Types
 * 
 * Shared types for API requests, responses, and error handling.
 * Base URL: https://api.ron-ai.io/v1
 */

// ============================================
// Base API Types
// ============================================

export interface ApiResponse<T> {
  data: T | null
  error: ApiError | null
  meta?: ApiMeta
}

export interface ApiError {
  code: string
  message: string
  status: number
  details?: Record<string, unknown>
  timestamp?: string
  requestId?: string
}

export interface ApiMeta {
  page?: number
  limit?: number
  total?: number
  hasMore?: boolean
}

// ============================================
// Request Configuration
// ============================================

export interface ApiRequestConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
  params?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string>
  timeout?: number
  signal?: AbortSignal
}

export interface StreamingRequestConfig extends Omit<ApiRequestConfig, 'method'> {
  method?: 'POST' | 'GET'
  onEvent: (event: StreamEvent) => void
  onError?: (error: ApiError) => void
  onComplete?: () => void
}

// ============================================
// Streaming Types (SSE)
// ============================================

export type StreamEventType = 
  | 'data'           // Text chunk
  | 'tool_use'       // Tool invocation
  | 'tool_result'    // Tool response
  | 'thinking'       // Reasoning/thinking text
  | 'message'        // Message completion
  | 'error'          // Stream error
  | 'done'           // Stream complete

export interface StreamEvent {
  type: StreamEventType
  data?: string
  tool?: ToolUseEvent
  message?: MessageEvent
  error?: ApiError
  timestamp: number
}

export interface ToolUseEvent {
  id: string
  name: string
  input?: Record<string, unknown>
  result?: unknown
  status: 'pending' | 'running' | 'success' | 'error'
}

export interface MessageEvent {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  stopReason?: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence'
}

// ============================================
// Pagination & Filtering
// ============================================

export interface PaginationParams {
  page?: number
  limit?: number
  cursor?: string
}

export interface SortParams {
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface FilterParams extends PaginationParams, SortParams {
  search?: string
  filters?: Record<string, string | string[]>
}

// ============================================
// API Endpoints
// ============================================

export { API_BASE_URL, LIVE_API_BASE_URL } from '../../lib/api-base'

export const API_ENDPOINTS = {
  // Auth
  auth: {
    login: '/auth/login',
    logout: '/auth/logout',
    refresh: '/auth/refresh',
    me: '/auth/me',
  },
  
  // Agent/Chat - SDK-native Strands agent stream
  agent: {
    chat: '/chat',
    stream: '/chat',
    conversations: '/agents/sessions',
    conversation: (id: string) => `/chat/${id}`,
  },
  
  // User
  user: {
    profile: '/user/profile',
    preferences: '/user/preferences',
    interests: '/user/interests',
  },
  
  // Onboarding
  onboarding: {
    answers: '/onboarding/answers',
    complete: '/onboarding/complete',
  },
} as const

// ============================================
// Type Guards
// ============================================

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    'status' in value
  )
}

export function isStreamEvent(value: unknown): value is StreamEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'timestamp' in value
  )
}
