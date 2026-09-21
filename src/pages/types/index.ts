/**
 * Type Definitions Index
 * 
 * Re-exports all types for easy importing throughout the application.
 */

// User & Authentication
export type {
  User,
  UserOrganization,
  OrganizationRole,
  UserPreferences,
  AuthSession,
  AuthTokens,
  AuthCredentials,
  SignUpData,
  OAuthProvider,
  AuthState,
  AuthError,
  AuthEventType,
  AuthEvent,
  AuthResponse,
  UserResponse,
} from './user'

// API Types
export type {
  ApiResponse,
  ApiError,
  ApiMeta,
  ApiRequestConfig,
  StreamingRequestConfig,
  StreamEventType,
  StreamEvent,
  ToolUseEvent,
  MessageEvent,
  PaginationParams,
  SortParams,
  FilterParams,
} from './api'

export { API_BASE_URL, API_ENDPOINTS, isApiError, isStreamEvent } from './api'

// Agent Types
export type {
  Message,
  ToolUse,
  ToolResult,
  TokenUsage,
  StopReason,
  Conversation,
  ConversationContext,
  AgentStreamEvent,
  AgentResult,
  ChatRequest,
  ChatResponse,
  AgentState,
  AgentError,
  AgentAction,
} from './agent'

export { isAgentStreamEvent, hasStreamData, hasToolUse, hasResult } from './agent'

// Supabase Types
export type {
  Database,
  UserRow,
  UserInsert,
  UserUpdate,
  UserPreferencesRow,
  UserPreferencesInsert,
  UserPreferencesUpdate,
  InterestRow,
  InterestInsert,
  InterestUpdate,
  InterestConnectionRow,
  InterestConnectionInsert,
  InterestConnectionUpdate,
  OnboardingAnswerRow,
  OnboardingAnswerInsert,
  OnboardingAnswerUpdate,
  ConversationRow,
  ConversationInsert,
  ConversationUpdate,
  MessageRow,
  MessageInsert,
  MessageUpdate,
  SupabaseConfig,
} from './supabase'

export type { InterestCategory } from './supabase'
export { SUPABASE_CONFIG } from './supabase'

