/**
 * API Client
 * 
 * HTTP client for communicating with the Ron AI backend.
 * Handles authentication, error handling, and request/response transformation.
 * 
 * Base URL: https://api.ron-ai.io/v1
 */

import { API_BASE_URL, type ApiResponse, type ApiError, type ApiRequestConfig } from '@/pages/types/api'
import { getAccessToken, refreshSession } from './supabase'

// ============================================
// Client Configuration
// ============================================

interface ClientConfig {
  baseUrl: string
  timeout: number
  retryCount: number
  retryDelay: number
}

const defaultConfig: ClientConfig = {
  baseUrl: API_BASE_URL,
  timeout: 30000,
  retryCount: 3,
  retryDelay: 1000,
}

// ============================================
// API Client Class
// ============================================

class ApiClient {
  private config: ClientConfig
  private isRefreshing = false
  private refreshPromise: Promise<string | null> | null = null

  constructor(config: Partial<ClientConfig> = {}) {
    this.config = { ...defaultConfig, ...config }
  }

  /**
   * Get authentication headers with fresh access token
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getValidToken()
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    return headers
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  private async getValidToken(): Promise<string | null> {
    // If already refreshing, wait for that to complete
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise
    }

    const token = await getAccessToken()
    
    // Token exists and we assume it's valid (Supabase handles refresh automatically)
    return token
  }

  /**
   * Handle token refresh when we get a 401
   */
  private async handleUnauthorized(): Promise<string | null> {
    if (this.isRefreshing) {
      return this.refreshPromise
    }

    this.isRefreshing = true
    this.refreshPromise = (async () => {
      try {
        const session = await refreshSession()
        return session?.access_token ?? null
      } finally {
        this.isRefreshing = false
        this.refreshPromise = null
      }
    })()

    return this.refreshPromise
  }

  /**
   * Build full URL with query parameters
   */
  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(path, this.config.baseUrl)
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value))
        }
      })
    }
    
    return url.toString()
  }

  /**
   * Parse API error from response
   */
  private async parseError(response: Response): Promise<ApiError> {
    try {
      const data = await response.json()
      return {
        code: data.code || `HTTP_${response.status}`,
        message: data.message || response.statusText,
        status: response.status,
        details: data.details,
        requestId: response.headers.get('x-request-id') || undefined,
      }
    } catch {
      return {
        code: `HTTP_${response.status}`,
        message: response.statusText || 'Request failed',
        status: response.status,
      }
    }
  }

  /**
   * Execute a request with retry logic
   */
  private async executeWithRetry<T>(
    config: ApiRequestConfig,
    retryCount = 0
  ): Promise<ApiResponse<T>> {
    const { method, path, body, params, headers: customHeaders, timeout, signal } = config

    try {
      const headers = {
        ...(await this.getAuthHeaders()),
        ...customHeaders,
      }

      const url = this.buildUrl(path, params)
      
      // Create abort controller for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(
        () => controller.abort(),
        timeout || this.config.timeout
      )

      // Combine with external signal if provided
      const combinedSignal = signal 
        ? this.combineAbortSignals(signal, controller.signal)
        : controller.signal

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: combinedSignal,
      })

      clearTimeout(timeoutId)

      // Handle 401 - try to refresh token and retry once
      if (response.status === 401 && retryCount === 0) {
        const newToken = await this.handleUnauthorized()
        if (newToken) {
          return this.executeWithRetry(config, retryCount + 1)
        }
      }

      // Handle non-OK responses
      if (!response.ok) {
        const error = await this.parseError(response)
        return { data: null, error }
      }

      // Parse successful response
      const data = await response.json()
      return { data: data as T, error: null }

    } catch (error) {
      // Handle abort/timeout
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          data: null,
          error: {
            code: 'REQUEST_TIMEOUT',
            message: 'Request timed out',
            status: 408,
          }
        }
      }

      // Handle network errors with retry
      if (retryCount < this.config.retryCount) {
        await this.delay(this.config.retryDelay * (retryCount + 1))
        return this.executeWithRetry(config, retryCount + 1)
      }

      // Return final error
      return {
        data: null,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network request failed',
          status: 0,
        }
      }
    }
  }

  /**
   * Combine multiple abort signals
   */
  private combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController()
    
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort()
        break
      }
      signal.addEventListener('abort', () => controller.abort())
    }
    
    return controller.signal
  }

  /**
   * Delay helper for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // ============================================
  // Public HTTP Methods
  // ============================================

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<ApiResponse<T>> {
    return this.executeWithRetry({ method: 'GET', path, params })
  }

  async post<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<ApiResponse<T>> {
    return this.executeWithRetry({ method: 'POST', path, body, params })
  }

  async put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.executeWithRetry({ method: 'PUT', path, body })
  }

  async patch<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.executeWithRetry({ method: 'PATCH', path, body })
  }

  async delete<T>(path: string): Promise<ApiResponse<T>> {
    return this.executeWithRetry({ method: 'DELETE', path })
  }

  /**
   * Execute a custom request
   */
  async request<T>(config: ApiRequestConfig): Promise<ApiResponse<T>> {
    return this.executeWithRetry(config)
  }
}

// ============================================
// Singleton Export
// ============================================

export const apiClient = new ApiClient()

// ============================================
// Convenience Functions
// ============================================

export const api = {
  get: <T>(path: string, params?: Record<string, string | number | boolean | undefined>) => 
    apiClient.get<T>(path, params),
  
  post: <T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>) => 
    apiClient.post<T>(path, body, params),
  
  put: <T>(path: string, body?: unknown) => 
    apiClient.put<T>(path, body),
  
  patch: <T>(path: string, body?: unknown) => 
    apiClient.patch<T>(path, body),
  
  delete: <T>(path: string) => 
    apiClient.delete<T>(path),
}

