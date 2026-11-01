import { liveApiBase } from './live-api.ts'
import { DEFAULT_API_BASE_URL, normalizeApiBaseUrl } from './api-origin.ts'

export { DEFAULT_API_BASE_URL, normalizeApiBaseUrl }

export const API_BASE_URL = normalizeApiBaseUrl(import.meta.env?.VITE_API_BASE_URL)
export const LIVE_API_BASE_URL = liveApiBase(import.meta.env?.VITE_LIVE_API_BASE_URL, API_BASE_URL)
