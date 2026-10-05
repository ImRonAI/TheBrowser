/** Production default and fallback when VITE_API_BASE_URL is unset. */
export const DEFAULT_API_BASE_URL = 'http://localhost:8765'

export function normalizeApiBaseUrl(configured: string | undefined, fallback = DEFAULT_API_BASE_URL): string {
  const raw = (configured?.trim() || fallback).replace(/\/$/, '')
  const url = new URL(raw)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('API base URL must be an HTTP(S) origin without credentials, query, fragment, or path.')
  }
  return url.origin
}
