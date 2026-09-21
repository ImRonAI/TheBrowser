/**
 * Supabase Database Types
 * 
 * Type definitions for Supabase tables and RLS policies.
 * Schema designed for user-based multi-tenancy with future org support.
 */

// ============================================
// Database Schema Types
// ============================================

export interface Database {
  public: {
    Tables: {
      users: {
        Row: UserRow
        Insert: UserInsert
        Update: UserUpdate
      }
      user_preferences: {
        Row: UserPreferencesRow
        Insert: UserPreferencesInsert
        Update: UserPreferencesUpdate
      }
      interests: {
        Row: InterestRow
        Insert: InterestInsert
        Update: InterestUpdate
      }
      interest_connections: {
        Row: InterestConnectionRow
        Insert: InterestConnectionInsert
        Update: InterestConnectionUpdate
      }
      onboarding_answers: {
        Row: OnboardingAnswerRow
        Insert: OnboardingAnswerInsert
        Update: OnboardingAnswerUpdate
      }
      conversations: {
        Row: ConversationRow
        Insert: ConversationInsert
        Update: ConversationUpdate
      }
      messages: {
        Row: MessageRow
        Insert: MessageInsert
        Update: MessageUpdate
      }
    }
  }
}

// ============================================
// Users Table
// ============================================

export interface UserRow {
  id: string  // UUID, matches auth.users.id
  email: string
  name: string
  avatar_url: string | null
  tenant_id: string  // UUID, for RLS
  onboarding_complete: boolean
  created_at: string
  updated_at: string
  last_login_at: string | null
}

export interface UserInsert {
  id: string
  email: string
  name: string
  avatar_url?: string | null
  tenant_id: string
  onboarding_complete?: boolean
}

export interface UserUpdate {
  name?: string
  avatar_url?: string | null
  onboarding_complete?: boolean
  last_login_at?: string
  updated_at?: string
}

// ============================================
// User Preferences Table
// ============================================

export interface UserPreferencesRow {
  id: string
  user_id: string
  theme: 'light' | 'dark' | 'glass' | 'system'
  interaction_mode: 'talk' | 'type'
  search_mode: 'ai-web' | 'deep-research' | 'chat'
  content_density: 'compact' | 'comfortable' | 'spacious'
  show_animations: boolean
  reduce_motion: boolean
  created_at: string
  updated_at: string
}

export interface UserPreferencesInsert {
  user_id: string
  theme?: 'light' | 'dark' | 'glass' | 'system'
  interaction_mode?: 'talk' | 'type'
  search_mode?: 'ai-web' | 'deep-research' | 'chat'
  content_density?: 'compact' | 'comfortable' | 'spacious'
  show_animations?: boolean
  reduce_motion?: boolean
}

export interface UserPreferencesUpdate {
  theme?: 'light' | 'dark' | 'glass' | 'system'
  interaction_mode?: 'talk' | 'type'
  search_mode?: 'ai-web' | 'deep-research' | 'chat'
  content_density?: 'compact' | 'comfortable' | 'spacious'
  show_animations?: boolean
  reduce_motion?: boolean
  updated_at?: string
}

// ============================================
// Interests Table
// ============================================

export type InterestCategory = 
  | 'technology'
  | 'design'
  | 'ai'
  | 'privacy'
  | 'productivity'
  | 'learning'
  | 'entertainment'
  | 'news'
  | 'other'

export interface InterestRow {
  id: string
  user_id: string
  label: string
  weight: number  // 0-1
  category: InterestCategory
  source: 'onboarding' | 'browsing'
  created_at: string
  updated_at: string
}

export interface InterestInsert {
  user_id: string
  label: string
  weight?: number
  category: InterestCategory
  source: 'onboarding' | 'browsing'
}

export interface InterestUpdate {
  label?: string
  weight?: number
  category?: InterestCategory
  updated_at?: string
}

// ============================================
// Interest Connections Table
// ============================================

export interface InterestConnectionRow {
  id: string
  user_id: string
  from_interest_id: string
  to_interest_id: string
  strength: number  // 0-1
  created_at: string
}

export interface InterestConnectionInsert {
  user_id: string
  from_interest_id: string
  to_interest_id: string
  strength?: number
}

export interface InterestConnectionUpdate {
  strength?: number
}

// ============================================
// Onboarding Answers Table
// ============================================

export interface OnboardingAnswerRow {
  id: string
  user_id: string
  question: string
  answer: string
  question_index: number
  created_at: string
}

export interface OnboardingAnswerInsert {
  user_id: string
  question: string
  answer: string
  question_index: number
}

export interface OnboardingAnswerUpdate {
  answer?: string
}

// ============================================
// Conversations Table
// ============================================

export interface ConversationRow {
  id: string
  user_id: string
  title: string | null
  system_prompt: string | null
  context: Record<string, unknown> | null
  is_active: boolean
  created_at: string
  updated_at: string
  last_message_at: string | null
}

export interface ConversationInsert {
  user_id: string
  title?: string | null
  system_prompt?: string | null
  context?: Record<string, unknown> | null
  is_active?: boolean
}

export interface ConversationUpdate {
  title?: string | null
  system_prompt?: string | null
  context?: Record<string, unknown> | null
  is_active?: boolean
  updated_at?: string
  last_message_at?: string
}

// ============================================
// Messages Table
// ============================================

export interface MessageRow {
  id: string
  conversation_id: string
  user_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  tool_uses: Record<string, unknown>[] | null
  model: string | null
  tokens_input: number | null
  tokens_output: number | null
  stop_reason: string | null
  created_at: string
}

export interface MessageInsert {
  conversation_id: string
  user_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  tool_uses?: Record<string, unknown>[] | null
  model?: string | null
  tokens_input?: number | null
  tokens_output?: number | null
  stop_reason?: string | null
}

export interface MessageUpdate {
  content?: string
  tool_uses?: Record<string, unknown>[] | null
  tokens_input?: number | null
  tokens_output?: number | null
  stop_reason?: string | null
}

// ============================================
// Supabase Client Types
// ============================================

export interface SupabaseConfig {
  url: string
  anonKey: string
  options?: {
    auth?: {
      autoRefreshToken?: boolean
      persistSession?: boolean
      detectSessionInUrl?: boolean
    }
  }
}

// Environment variables expected
export const SUPABASE_CONFIG: SupabaseConfig = {
  url: import.meta.env.VITE_SUPABASE_URL || '',
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  options: {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,  // Electron doesn't use URL-based detection
    }
  }
}

