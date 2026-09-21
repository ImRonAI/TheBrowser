import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Session, AuthChangeEvent } from '@supabase/supabase-js'
import {
  supabase,
  signInWithEmail,
  signUpWithEmail,
  signOut as supabaseSignOut,
  onAuthStateChange,
  getSession,
  isSupabaseConfigured,
} from '@/api/supabase'
import type { User, UserPreferences, AuthError } from '@/pages/types/user'

// ============================================
// State Interface
// ============================================

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  isInitialized: boolean
  error: AuthError | null

  // Actions
  initialize: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  loginWithOAuth: (provider: 'google' | 'apple' | 'microsoft' | 'github') => Promise<void>
  logout: () => Promise<void>
  signup: (email: string, password: string, name: string) => Promise<void>
  updateUser: (updates: Partial<User>) => void
  updatePreferences: (preferences: Partial<UserPreferences>) => Promise<void>
  clearError: () => void
  
  // Internal
  handleAuthStateChange: (event: AuthChangeEvent, session: Session | null) => void
}

// ============================================
// Helpers
// ============================================

function mapSessionToUser(session: Session, additionalData?: Partial<User>): User {
  const supabaseUser = session.user
  
  return {
    id: supabaseUser.id,
    email: supabaseUser.email || '',
    name: supabaseUser.user_metadata?.name || supabaseUser.email?.split('@')[0] || 'User',
    avatar: supabaseUser.user_metadata?.avatar_url,
    tenantId: supabaseUser.id, // User-based tenancy: tenant = user
    preferences: {
      theme: 'dark',
      interactionMode: 'type',
      searchMode: 'ai-web',
      contentDensity: 'comfortable',
      showAnimations: true,
      reduceMotion: false,
    },
    createdAt: supabaseUser.created_at,
    updatedAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    ...additionalData,
  }
}

function mapAuthError(error: unknown): AuthError {
  if (error && typeof error === 'object' && 'message' in error) {
    const e = error as { message: string; code?: string }
    return {
      code: e.code || 'AUTH_ERROR',
      message: e.message,
    }
  }
  return {
    code: 'UNKNOWN_ERROR',
    message: 'An unexpected error occurred',
  }
}

type SupabaseTable = 'users' | 'user_preferences'

const tableAvailability: Record<SupabaseTable, boolean | null> = {
  users: null,
  user_preferences: null,
}

let authSubscription: { unsubscribe: () => void } | null = null
let initializePromise: Promise<void> | null = null

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const status = (error as { status?: number }).status
  const code = (error as { code?: string }).code
  const message = (error as { message?: string }).message
  const details = (error as { details?: string }).details
  return (
    status === 404 ||
    code === '42P01' ||
    code === 'PGRST205' ||
    message?.includes('does not exist') === true ||
    message?.includes('relation') === true ||
    details?.includes('Could not find the table') === true
  )
}

function shouldQueryTable(table: SupabaseTable): boolean {
  return tableAvailability[table] !== false
}

function markTableAvailable(table: SupabaseTable) {
  tableAvailability[table] = true
}

function handleTableError(table: SupabaseTable, error: unknown): boolean {
  if (isMissingTableError(error)) {
    if (tableAvailability[table] !== false) {
      console.warn(`[Supabase] Table "${table}" unavailable. Skipping further queries.`)
    }
    tableAvailability[table] = false
    return true
  }
  return false
}

// ============================================
// Store
// ============================================

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isInitialized: false,
      error: null,

      // ----------------------------------------
      // Initialize
      // ----------------------------------------
      initialize: async () => {
        if (get().isInitialized) return
        if (initializePromise) return initializePromise
        initializePromise = (async () => {
          set({ isLoading: true })

          try {
            // Keep exactly one auth state listener in development + HMR.
            if (authSubscription) {
              authSubscription.unsubscribe()
            }
            authSubscription = onAuthStateChange((event, session) => {
              get().handleAuthStateChange(event, session)
            })

            // Check for existing session
            const session = await getSession()
            
            if (session) {
              // Try to fetch user profile from database (may not exist yet)
              let userProfile: Record<string, unknown> | null = null
              let preferences: Record<string, unknown> | null = null
              
              if (shouldQueryTable('users')) {
                try {
                  const { data, error } = await supabase
                    .from('users')
                    .select('*')
                    .eq('id', session.user.id)
                    .single()
                  if (error) {
                    if (!handleTableError('users', error)) {
                      console.warn('Failed to fetch user profile:', error)
                    }
                  } else {
                    markTableAvailable('users')
                    userProfile = data
                  }
                } catch (error) {
                  if (!handleTableError('users', error)) {
                    console.warn('Failed to fetch user profile:', error)
                  }
                }
              }

              if (shouldQueryTable('user_preferences')) {
                try {
                  const { data, error } = await supabase
                    .from('user_preferences')
                    .select('*')
                    .eq('user_id', session.user.id)
                    .single()
                  if (error) {
                    if (!handleTableError('user_preferences', error)) {
                      console.warn('Failed to fetch user preferences:', error)
                    }
                  } else {
                    markTableAvailable('user_preferences')
                    preferences = data
                  }
                } catch (error) {
                  if (!handleTableError('user_preferences', error)) {
                    console.warn('Failed to fetch user preferences:', error)
                  }
                }
              }

              const user = mapSessionToUser(session, {
                name: (userProfile?.name as string) || session.user.user_metadata?.name,
                avatar: (userProfile?.avatar_url as string) || undefined,
                preferences: preferences ? {
                  theme: preferences.theme as UserPreferences['theme'],
                  interactionMode: preferences.interaction_mode as UserPreferences['interactionMode'],
                  searchMode: preferences.search_mode as UserPreferences['searchMode'],
                  contentDensity: preferences.content_density as UserPreferences['contentDensity'],
                  showAnimations: preferences.show_animations as boolean,
                  reduceMotion: preferences.reduce_motion as boolean,
                } : undefined,
              })

              set({
                user,
                isAuthenticated: true,
                isLoading: false,
                isInitialized: true,
              })

            } else {
              set({
                user: null,
                isAuthenticated: false,
                isLoading: false,
                isInitialized: true,
              })
            }
          } catch (error) {
            console.error('Auth initialization error:', error)
            set({
              error: mapAuthError(error),
              isLoading: false,
              isInitialized: true,
            })
          } finally {
            initializePromise = null
          }
        })()

        return initializePromise
      },

      // ----------------------------------------
      // Handle Auth State Changes
      // ----------------------------------------
      handleAuthStateChange: (event: AuthChangeEvent, session: Session | null) => {
        if (event !== 'INITIAL_SESSION') {
          console.log('Auth state change:', event, session?.user?.email)
        }

        switch (event) {
          case 'SIGNED_IN':
            if (session) {
              const currentUser = get().user
              if (get().isAuthenticated && currentUser?.id === session.user.id) {
                break
              }

              const user = mapSessionToUser(session)
              set({
                user,
                isAuthenticated: true,
                isLoading: false,
                error: null,
              })
            }
            break

          case 'SIGNED_OUT':
            set({
              user: null,
              isAuthenticated: false,
              isLoading: false,
            })
            break

          case 'TOKEN_REFRESHED':
            break

          case 'USER_UPDATED':
            if (session) {
              const currentUser = get().user
              if (currentUser) {
                set({
                  user: {
                    ...currentUser,
                    email: session.user.email || currentUser.email,
                    name: session.user.user_metadata?.name || currentUser.name,
                    avatar: session.user.user_metadata?.avatar_url || currentUser.avatar,
                    updatedAt: new Date().toISOString(),
                  }
                })
              }
            }
            break
        }
      },

      // ----------------------------------------
      // Login
      // ----------------------------------------
      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null })

        if (!isSupabaseConfigured()) {
          set({
            isLoading: false,
            error: {
              code: 'CONFIG_ERROR',
              message: 'Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.',
            }
          })
          return
        }

        try {
          const { data, error } = await signInWithEmail(email, password)

          if (error) {
            set({
              error: mapAuthError(error),
              isLoading: false,
            })
            return
          }

          if (data.session) {
            const user = mapSessionToUser(data.session)
            
            // Try to update last login time in database
            if (shouldQueryTable('users')) {
              try {
                const { error } = await supabase
                  .from('users')
                  .update({ last_login_at: new Date().toISOString() })
                  .eq('id', user.id)
                if (error) {
                  if (!handleTableError('users', error)) {
                    console.warn('Failed to update last login:', error)
                  }
                } else {
                  markTableAvailable('users')
                }
              } catch (error) {
                if (!handleTableError('users', error)) {
                  console.warn('Failed to update last login:', error)
                }
              }
            }

            set({
              user,
              isAuthenticated: true,
              isLoading: false,
            })
          }
        } catch (error) {
          set({
            error: mapAuthError(error),
            isLoading: false,
          })
        }
      },

      // ----------------------------------------
      // OAuth Login
      // ----------------------------------------
      loginWithOAuth: async (provider: 'google' | 'apple' | 'microsoft' | 'github') => {
        set({ isLoading: true, error: null })

        if (!isSupabaseConfigured()) {
          set({
            isLoading: false,
            error: {
              code: 'CONFIG_ERROR',
              message: 'Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.',
            }
          })
          return
        }

        try {
          // Map our provider names to Supabase provider names
          const supabaseProvider = provider === 'microsoft' ? 'azure' : provider
          
          const { data, error } = await supabase.auth.signInWithOAuth({
            provider: supabaseProvider,
            options: {
              redirectTo: 'ron://auth/callback',
              skipBrowserRedirect: true,
            }
          })

          if (data.url) {
            window.open(data.url, '_blank', 'noopener,noreferrer')
          }

          if (error) {
            set({
              error: mapAuthError(error),
              isLoading: false,
            })
          }
          // The actual sign-in will be handled by onAuthStateChange
        } catch (error) {
          set({
            error: mapAuthError(error),
            isLoading: false,
          })
        }
      },

      // ----------------------------------------
      // Logout
      // ----------------------------------------
      logout: async () => {
        set({ isLoading: true })

        try {
          await supabaseSignOut()

          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: null,
          })
        } catch (error) {
          set({
            error: mapAuthError(error),
            isLoading: false,
          })
        }
      },

      // ----------------------------------------
      // Signup
      // ----------------------------------------
      signup: async (email: string, password: string, name: string) => {
        set({ isLoading: true, error: null })

        if (!isSupabaseConfigured()) {
          set({
            isLoading: false,
            error: {
              code: 'CONFIG_ERROR',
              message: 'Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.',
            }
          })
          return
        }

        try {
          const { data, error } = await signUpWithEmail(email, password, { name })

          if (error) {
            set({
              error: mapAuthError(error),
              isLoading: false,
            })
            return
          }

          if (data.user && data.session) {
            // Try to create user profile in database
            if (shouldQueryTable('users')) {
              try {
                const { error } = await supabase.from('users').insert({
                  id: data.user.id,
                  email: data.user.email || email,
                  name,
                  tenant_id: data.user.id, // User-based tenancy
                  onboarding_complete: false,
                })
                if (error) {
                  if (!handleTableError('users', error)) {
                    console.warn('Could not create user profile in database:', error)
                  }
                } else {
                  markTableAvailable('users')
                }
              } catch (error) {
                if (!handleTableError('users', error)) {
                  console.warn('Could not create user profile in database:', error)
                }
              }
            }

            if (shouldQueryTable('user_preferences')) {
              try {
                const { error } = await supabase.from('user_preferences').insert({
                  user_id: data.user.id,
                })
                if (error) {
                  if (!handleTableError('user_preferences', error)) {
                    console.warn('Could not create user preferences:', error)
                  }
                } else {
                  markTableAvailable('user_preferences')
                }
              } catch (error) {
                if (!handleTableError('user_preferences', error)) {
                  console.warn('Could not create user preferences:', error)
                }
              }
            }

            const user = mapSessionToUser(data.session, { name })

            set({
              user,
              isAuthenticated: true,
              isLoading: false,
            })
          } else if (data.user && !data.session) {
            // Email confirmation required
            set({
              isLoading: false,
              error: {
                code: 'EMAIL_CONFIRMATION_REQUIRED',
                message: 'Please check your email to confirm your account.',
              }
            })
          }
        } catch (error) {
          set({
            error: mapAuthError(error),
            isLoading: false,
          })
        }
      },

      // ----------------------------------------
      // Update User
      // ----------------------------------------
      updateUser: (updates: Partial<User>) => {
        const currentUser = get().user
        if (currentUser) {
          set({
            user: {
              ...currentUser,
              ...updates,
              updatedAt: new Date().toISOString(),
            }
          })
        }
      },

      // ----------------------------------------
      // Update Preferences
      // ----------------------------------------
      updatePreferences: async (preferences: Partial<UserPreferences>) => {
        const currentUser = get().user
        if (!currentUser) return

        // Update local state immediately
        set({
          user: {
            ...currentUser,
            preferences: {
              ...currentUser.preferences,
              ...preferences,
            },
            updatedAt: new Date().toISOString(),
          }
        })

        // Try to sync to database
        if (shouldQueryTable('user_preferences')) {
          try {
            const { error } = await supabase
              .from('user_preferences')
              .update({
                theme: preferences.theme,
                interaction_mode: preferences.interactionMode,
                search_mode: preferences.searchMode,
                content_density: preferences.contentDensity,
                show_animations: preferences.showAnimations,
                reduce_motion: preferences.reduceMotion,
                updated_at: new Date().toISOString(),
              })
              .eq('user_id', currentUser.id)
            if (error) {
              if (!handleTableError('user_preferences', error)) {
                console.error('Failed to sync preferences:', error)
              }
            } else {
              markTableAvailable('user_preferences')
            }
          } catch (error) {
            if (!handleTableError('user_preferences', error)) {
              console.error('Failed to sync preferences:', error)
            }
          }
        }
      },

      // ----------------------------------------
      // Clear Error
      // ----------------------------------------
      clearError: () => {
        set({ error: null })
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: () => ({}),
      migrate: (persisted) => persisted as Partial<AuthState>,
    }
  )
)

export async function handleDeepLinkCallback(url: string) {
  try {
    const callbackUrl = new URL(url)
    const hash = callbackUrl.hash.startsWith('#') ? callbackUrl.hash.slice(1) : callbackUrl.hash
    const hashParams = new URLSearchParams(hash)
    const code = callbackUrl.searchParams.get('code') ?? hashParams.get('code')

    if (!code) return

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) throw error
  } catch (error) {
    useAuthStore.setState({
      error: mapAuthError(error),
      isLoading: false,
    })
    throw error
  }
}

// ============================================
// Auto-initialize
// ============================================

// Initialize auth when the module loads
if (typeof window !== 'undefined') {
  // Delay initialization to ensure Supabase client is ready
  setTimeout(() => {
    useAuthStore.getState().initialize()
  }, 0)
}
