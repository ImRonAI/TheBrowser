/**
 * User and Authentication Types
 * 
 * Designed for multi-tenant architecture with user-based tenancy
 * and future organization support.
 */

// ============================================
// User Types
// ============================================

export interface User {
  id: string
  email: string
  name: string
  avatar?: string
  
  // Multi-tenancy (user-based, extensible to org)
  tenantId: string
  
  // Future: Organization support
  organizations?: UserOrganization[]
  activeOrganizationId?: string
  
  // Preferences (synced to backend)
  preferences: UserPreferences
  
  // Metadata
  createdAt: string
  updatedAt: string
  lastLoginAt?: string
}

export interface UserOrganization {
  id: string
  name: string
  role: OrganizationRole
  joinedAt: string
}

export type OrganizationRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface UserPreferences {
  theme: 'light' | 'dark' | 'glass' | 'system'
  interactionMode: 'talk' | 'type'
  searchMode: 'ai-web' | 'deep-research' | 'chat'
  contentDensity: 'compact' | 'comfortable' | 'spacious'
  showAnimations: boolean
  reduceMotion: boolean
}

// ============================================
// Authentication Types
// ============================================

export interface AuthSession {
  accessToken: string
  refreshToken: string
  expiresAt: number  // Unix timestamp
  expiresIn: number  // Seconds until expiration
  user: User
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export interface AuthCredentials {
  email: string
  password: string
}

export interface SignUpData extends AuthCredentials {
  name: string
}

export type OAuthProvider = 'google' | 'apple' | 'microsoft' | 'github'

export interface AuthState {
  user: User | null
  session: AuthSession | null
  isAuthenticated: boolean
  isLoading: boolean
  isInitialized: boolean
  error: AuthError | null
}

export interface AuthError {
  code: string
  message: string
  details?: Record<string, unknown>
}

// ============================================
// Auth Event Types (for Electron IPC)
// ============================================

export type AuthEventType = 
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'SESSION_EXPIRED'
  | 'AUTH_ERROR'

export interface AuthEvent {
  type: AuthEventType
  session: AuthSession | null
  timestamp: number
}

// ============================================
// API Response Wrappers
// ============================================

export interface AuthResponse<T = AuthSession> {
  data: T | null
  error: AuthError | null
}

export interface UserResponse {
  data: User | null
  error: AuthError | null
}

