/**
 * API Layer Index
 * 
 * Re-exports all API utilities for easy importing.
 */

// Supabase Client
export {
  supabase,
  getSupabaseClient,
  onAuthStateChange,
  getSession,
  getAccessToken,
  refreshSession,
  signInWithEmail,
  signUpWithEmail,
  signOut,
  getCurrentUser,
  db,
  isSupabaseError,
  formatSupabaseError,
  type AuthStateSubscription,
} from './supabase'

// HTTP Client
export {
  apiClient,
  api,
} from './client'
