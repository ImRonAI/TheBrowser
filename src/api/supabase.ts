/**
 * Supabase Client Configuration
 * 
 * Initializes and exports the Supabase client for use throughout the app.
 * Handles authentication state and provides typed database access.
 */

import { createClient, SupabaseClient, Session, AuthChangeEvent } from '@supabase/supabase-js'

// ============================================
// Configuration
// ============================================

interface SupabaseConfig {
  url: string
  anonKey: string
  options?: {
    auth?: {
      autoRefreshToken?: boolean
      persistSession?: boolean
      detectSessionInUrl?: boolean
      flowType?: 'implicit' | 'pkce'
    }
  }
}
const getSupabaseConfig = (): SupabaseConfig => {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    console.warn(
      '⚠️ Supabase credentials not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.'
    )
  }

  return {
    url: url || 'https://placeholder.supabase.co',
    anonKey: anonKey || 'placeholder-anon-key',
    options: {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false, // Electron doesn't use URL-based auth
        flowType: 'pkce',
      }
    }
  }
}

// ============================================
// Supabase Client Singleton
// ============================================

let supabaseInstance: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    const config = getSupabaseConfig()
    supabaseInstance = createClient(config.url, config.anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    })
  }
  return supabaseInstance
}

export function isSupabaseConfigured(): boolean {
  const config = getSupabaseConfig()
  return config.url !== 'https://placeholder.supabase.co'
}

// Export singleton for convenience
export const supabase = getSupabaseClient()

// ============================================
// Auth Helpers
// ============================================

export interface AuthStateSubscription {
  unsubscribe: () => void
}

/**
 * Subscribe to authentication state changes
 */
export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void
): AuthStateSubscription {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(callback)
  return {
    unsubscribe: () => subscription.unsubscribe()
  }
}

/**
 * Get the current session
 */
export async function getSession(): Promise<Session | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

/**
 * Get the current access token
 */
export async function getAccessToken(): Promise<string | null> {
  const session = await getSession()
  return session?.access_token ?? null
}

/**
 * Refresh the current session
 */
export async function refreshSession(): Promise<Session | null> {
  const { data: { session }, error } = await supabase.auth.refreshSession()
  if (error) {
    console.error('Failed to refresh session:', error)
    return null
  }
  return session
}

/**
 * Sign in with email and password
 */
export async function signInWithEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password })
}

/**
 * Sign up with email and password
 */
export async function signUpWithEmail(email: string, password: string, metadata?: { name?: string }) {
  return supabase.auth.signUp({
    email,
    password,
    options: {
      data: metadata
    }
  })
}

/**
 * Sign out the current user
 */
export async function signOut() {
  return supabase.auth.signOut()
}

/**
 * Get the current user
 */
export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function exchangeOAuthCodeForSession(callbackUrl: string) {
  const code = (() => {
    try {
      return new URL(callbackUrl).searchParams.get('code') ?? callbackUrl
    } catch {
      return callbackUrl
    }
  })()
  return supabase.auth.exchangeCodeForSession(code)
}

// ============================================
// Database Helpers
// ============================================

/**
 * Type-safe database access
 */
export const db = {
  users: () => supabase.from('users'),
  userPreferences: () => supabase.from('user_preferences'),
  interests: () => supabase.from('interests'),
  interestConnections: () => supabase.from('interest_connections'),
  onboardingAnswers: () => supabase.from('onboarding_answers'),
  conversations: () => supabase.from('conversations'),
  messages: () => supabase.from('messages'),
}

// ============================================
// Error Handling
// ============================================

export function isSupabaseError(error: unknown): error is { code: string; message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error
  )
}

export function formatSupabaseError(error: unknown): string {
  if (isSupabaseError(error)) {
    return `${error.code}: ${error.message}`
  }
  if (error instanceof Error) {
    return error.message
  }
  return 'An unknown error occurred'
}

