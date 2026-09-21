/**
 * Search Types
 * 
 * Types for search results, SonarReasoningPro responses, and Open-to-Chat integration.
 * Uses discriminated union pattern for polymorphic result types.
 */

// ============================================
// Search Provider Types
// ============================================

export type SearchProvider =
  | 'brave'
  | 'perplexity'
  | 'pubmed'
  | 'openfda'
  | 'datacommons'
  | 'pophive'
  | 'cms'
  | 'apify'
  | 'google-flights'
  | 'airbnb'
  | 'arxiv'
  | 'program-integrity'
  | 'sonar'

/**
 * Result type discriminator for polymorphic result handling
 */
export type ResultType =
  | 'video'
  | 'audio'
  | 'podcast'
  | 'web'
  | 'article'
  | 'social'
  | 'travel'
  | 'academic'
  | 'image'
  | 'code'

// ============================================
// Base Interfaces
// ============================================

/**
 * Top-level response from backend search API
 * Contains SonarReasoningPro analysis and universal results
 */
export interface SearchResponse {
  id: string
  query: string
  timestamp: number
  
  // SonarReasoningPro response
  sonarReasoning?: SonarReasoningResponse
  
  // Raw results (legacy/backward compatibility)
  results?: UniversalResult[]
  
  // Search metadata
  totalCount?: number
  duration?: number
  
  // State
  isComplete: boolean
  error?: string
}

/**
 * The reasoning/analysis component from SonarReasoningPro
 * Contains chain of thought, confidence scores, and source references
 */
export interface SonarReasoningResponse {
  // Core reasoning
  reasoning: string
  chainOfThought: ChainOfThought
  
  // Confidence and quality
  confidence: number
  qualityScore?: number
  
  // Sources/references
  sources: SonarSource[]
  
  // Summary of results
  summary?: string
  
  // Related queries (for expanding search)
  relatedQueries?: string[]
  
  // Metadata
  modelUsed?: string
  tokensUsed?: number
}

/**
 * Container for reasoning steps in the chain of thought
 */
export interface ChainOfThought {
  steps: ChainOfThoughtStep[]
}

/**
 * Individual step in the reasoning chain
 */
export interface ChainOfThoughtStep {
  id: string
  label: string
  description?: string
  status: 'pending' | 'running' | 'complete' | 'error'
  timestamp?: number
  
  // Nested content
  reasoning?: string
  searchResults?: UniversalResult[]
  tools?: string[]
}

/**
 * Source reference with relevance scoring
 */
export interface SonarSource {
  id: string
  url: string
  title: string
  snippet: string
  
  // Relevance to query
  relevanceScore: number
  
  // Source metadata
  type: ResultType
  domain?: string
  author?: string
  date?: string
  
  // Trust signals
  confidence?: number
  credibilityScore?: number
}

/**
 * Query metadata for search operations
 */
export interface SearchMetadata {
  query: string
  provider?: SearchProvider
  executionTime?: number
  resultCount?: number
  timestamp?: number
}

// ============================================
// Polymorphic Result Types
// ============================================

/**
 * Universal result union type for all search result types
 * Uses discriminated union with `type` field for type narrowing
 */
export type UniversalResult =
  | VideoResult
  | AudioResult
  | PodcastResult
  | WebResult
  | ArticleResult
  | SocialMediaResult
  | TravelResult
  | AcademicResult
  | ImageResult
  | CodeResult

// ============================================
// Type-Specific Interfaces
// ============================================

/**
 * Video search result with embed capabilities and transcript info
 */
export interface VideoResult {
  id: string
  type: 'video'
  
  // Core content
  title: string
  url: string
  thumbnail: string
  duration: number
  
  // Embed capabilities
  embedUrl?: string
  embedType?: 'youtube' | 'vimeo' | 'dailymotion' | 'generic'
  
  // Transcript
  transcriptUrl?: string
  hasTranscript?: boolean
  
  // Metadata
  platform?: 'youtube' | 'vimeo' | 'tiktok' | 'instagram-reels' | 'generic'
  uploader?: string
  uploaderUrl?: string
  viewCount?: number
  publishedAt?: string
  relevanceScore?: number
  
  // Open-to-Chat metadata
  metadata?: Record<string, unknown>
}

/**
 * Audio/music search result
 */
export interface AudioResult {
  id: string
  type: 'audio'
  
  // Core content
  title: string
  url: string
  audioUrl: string
  duration: number
  artwork?: string
  
  // Metadata
  artist?: string
  album?: string
  genre?: string
  
  // Transcript
  transcriptUrl?: string
  hasTranscript?: boolean
  
  // Platform
  platform?: 'spotify' | 'apple-podcasts' | 'soundcloud' | 'generic'
  
  relevanceScore?: number
  metadata?: Record<string, unknown>
}

/**
 * Podcast episode search result
 */
export interface PodcastResult {
  id: string
  type: 'podcast'
  
  // Core content
  title: string
  url: string
  audioUrl: string
  duration: number
  artwork?: string
  
  // Episode info
  episodeNumber?: number
  seasonNumber?: number
  publishedAt?: string
  
  // Show info
  showTitle?: string
  showUrl?: string
  host?: string
  hostUrl?: string
  
  // Transcript
  transcriptUrl?: string
  hasTranscript?: boolean
  
  // Platform
  platform?: 'spotify' | 'apple-podcasts' | 'google-podcasts' | 'generic'
  
  relevanceScore?: number
  metadata?: Record<string, unknown>
}

/**
 * General web page search result
 */
export interface WebResult {
  id: string
  type: 'web'
  
  // Core content
  title: string
  url: string
  snippet: string
  favicon?: string
  
  // Metadata
  domain?: string
  author?: string
  publishDate?: string
  date?: string
  
  // Embed capabilities
  iframeCompatible?: boolean
  
  // Trust signals
  relevanceScore?: number
  credibilityScore?: number
  
  metadata?: Record<string, unknown>
}

/**
 * Article/news search result
 */
export interface ArticleResult {
  id: string
  type: 'article'
  
  // Core content
  title: string
  url: string
  snippet: string
  favicon?: string
  thumbnail?: string
  
  // Article metadata
  author?: string
  authorUrl?: string
  publishDate?: string
  date?: string
  readingTime?: number
  readTime?: number
  
  // Publication info
  publication?: string
  publicationUrl?: string
  
  // Content preview
  contentPreview?: string
  wordCount?: number
  
  // Embed capabilities
  iframeCompatible?: boolean
  
  relevanceScore?: number
  metadata?: Record<string, unknown>
}

/**
 * Social media post search result
 */
export interface SocialMediaResult {
  id: string
  type: 'social'
  
  // Core content
  content: string
  url: string
  thumbnail?: string
  mediaUrl?: string
  mediaType?: 'image' | 'video' | 'gif' | 'none'
  
  // Platform info
  platform: 'twitter' | 'instagram' | 'linkedin' | 'facebook' | 'tiktok' | 'reddit' | 'generic'
  handle?: string
  author?: string
  authorUrl?: string
  avatar?: string
  
  // Engagement metrics
  likes?: number
  shares?: number
  comments?: number
  views?: number
  
  // Timestamp
  publishedAt?: string
  date?: string
  
  // Verification
  isVerified?: boolean
  isBlueCheck?: boolean
  
  relevanceScore?: number
  metadata?: Record<string, unknown>
}

/**
 * Travel booking search result (flights, hotels, etc.)
 */
export interface TravelResult {
  id: string
  type: 'travel'
  
  // Core content
  title: string
  url: string
  thumbnail?: string
  
  // Pricing
  price: number
  currency?: string
  originalPrice?: number
  
  // Trip details
  destination: string
  origin?: string
  dates: {
    departure: string
    return?: string
  }
  
  // Flight/transport details
  airline?: string
  flightNumber?: string
  duration?: string
  stops?: number
  
  // Booking
  bookingUrl: string
  provider: 'google-flights' | 'airbnb' | 'expedia' | 'generic'
  
  // Accommodation (if applicable)
  propertyType?: 'hotel' | 'apartment' | 'house' | 'villa'
  bedrooms?: number
  bathrooms?: number
  guests?: number
  rating?: number
  reviews?: number
  
  // Images
  images?: string[]
  
  relevanceScore?: number
  metadata?: Record<string, unknown>
}

/**
 * Academic paper/research search result
 */
export interface AcademicResult {
  id: string
  type: 'academic'
  
  // Core content
  title: string
  url: string
  snippet: string
  abstract?: string
  
  // Author info
  authors: string[]
  authorAffiliations?: string[]
  
  // Publication
  journal?: string
  venue?: string
  publishDate?: string
  date?: string
  
  // Identifiers
  doi?: string
  pmid?: string
  arxivId?: string
  isbn?: string
  
  // Metrics
  citationCount?: number
  year?: number
  
  // PDF access
  pdfUrl?: string
  hasOpenAccess?: boolean
  
  relevanceScore?: number
  metadata?: Record<string, unknown>
}

/**
 * Image search result
 */
export interface ImageResult {
  id: string
  type: 'image'
  
  // Core content
  title?: string
  url: string
  thumbnail: string
  
  // Image properties
  width: number
  height: number
  format?: string
  
  // Source
  sourceUrl?: string
  source?: string
  author?: string
  
  // Metadata
  altText?: string
  tags?: string[]
  colors?: string[]
  
  relevanceScore?: number
  metadata?: Record<string, unknown>
}

/**
 * Code/repository search result
 */
export interface CodeResult {
  id: string
  type: 'code'
  
  // Core content
  title: string
  url: string
  snippet: string
  
  // Repository/package
  repository?: string
  repositoryUrl?: string
  packageName?: string
  version?: string
  
  // Author
  author?: string
  authorUrl?: string
  
  // Language
  language: string
  languageIcon?: string
  
  // Metrics
  stars?: number
  forks?: number
  downloads?: number
  lastUpdated?: string
  
  // Code preview
  codePreview?: string
  lineCount?: number
  
  relevanceScore?: number
  metadata?: Record<string, unknown>
}

// ============================================
// Utility Types
// ============================================

/**
 * Search filters for filtering and sorting results
 */
export interface SearchFilters {
  type?: ResultType | ResultType[]
  dateRange?: {
    from?: string
    to?: string
  }
  sortBy?: 'relevance' | 'date' | 'popularity'
  minRelevanceScore?: number
}

/**
 * Context packaging for agent routing from search results
 */
export interface OpenToChatContext {
  resultId: string
  resultType: ResultType
  title: string
  url?: string
  content: string
  snippet?: string
  targetAgent?: 'ron' | 'researcher' | 'browser' | 'coding-agent'
  routingReason?: string
  query?: string
  sourceUrl?: string
  selectedText?: string
  metadata?: Record<string, unknown>
}

/**
 * Agent routing strategy based on result type
 */
export type AgentRoutingStrategy = 'ron' | 'researcher' | 'browser' | 'coding-agent'

/**
 * Agent ID type for type-safe agent selection
 */
export type AgentId = 'ron' | 'researcher' | 'browser' | 'coding-agent'

// ============================================
// Type Guards
// ============================================

/**
 * Type guard for VideoResult
 */
export function isVideoResult(result: UniversalResult): result is VideoResult {
  return result.type === 'video'
}

/**
 * Type guard for AudioResult
 */
export function isAudioResult(result: UniversalResult): result is AudioResult {
  return result.type === 'audio'
}

/**
 * Type guard for PodcastResult
 */
export function isPodcastResult(result: UniversalResult): result is PodcastResult {
  return result.type === 'podcast'
}

/**
 * Type guard for WebResult
 */
export function isWebResult(result: UniversalResult): result is WebResult {
  return result.type === 'web'
}

/**
 * Type guard for ArticleResult
 */
export function isArticleResult(result: UniversalResult): result is ArticleResult {
  return result.type === 'article'
}

/**
 * Type guard for SocialMediaResult
 */
export function isSocialMediaResult(result: UniversalResult): result is SocialMediaResult {
  return result.type === 'social'
}

/**
 * Type guard for TravelResult
 */
export function isTravelResult(result: UniversalResult): result is TravelResult {
  return result.type === 'travel'
}

/**
 * Type guard for AcademicResult
 */
export function isAcademicResult(result: UniversalResult): result is AcademicResult {
  return result.type === 'academic'
}

/**
 * Type guard for ImageResult
 */
export function isImageResult(result: UniversalResult): result is ImageResult {
  return result.type === 'image'
}

/**
 * Type guard for CodeResult
 */
export function isCodeResult(result: UniversalResult): result is CodeResult {
  return result.type === 'code'
}

// ============================================
// Component Props Types
// ============================================

/**
 * Props for SearchLayout component
 */
export interface SearchLayoutProps {
  searchResponse: SearchResponse | null
  isLoading?: boolean
  error?: string | null
  viewMode?: 'grid' | 'list'
  filters?: SearchFilters
  onResultClick?: (result: UniversalResult) => void
  onFilterChange?: (filters: SearchFilters) => void
  onExpandPreview?: (result: UniversalResult) => void
}

/**
 * Props for SonarBrain component
 */
export interface SonarBrainProps {
  reasoning?: string
  chainOfThought?: ChainOfThought
  confidence?: number
  sources?: SonarSource[]
  isExpanded?: boolean
  isStreaming?: boolean
  onSendMessage?: (message: string, context: OpenToChatContext) => void
}

/**
 * Props for UniversalResultCard component
 */
export interface UniversalResultCardProps {
  result: UniversalResult
  compact?: boolean
  showThumbnail?: boolean
  onClick?: () => void
  onOpenInChat?: (context: OpenToChatContext) => void
  onExpandPreview?: () => void
}

// ============================================
// Result Type Map
// ============================================

/**
 * Map of result types to their display labels
 */
export const ResultTypeLabels: Record<ResultType, string> = {
  video: 'Video',
  audio: 'Audio',
  podcast: 'Podcast',
  web: 'Web',
  article: 'Article',
  social: 'Social',
  travel: 'Travel',
  academic: 'Academic',
  image: 'Image',
  code: 'Code',
}

/**
 * Map of result types to their icon names
 */
export const ResultTypeIcons: Record<ResultType, string> = {
  video: 'video',
  audio: 'music',
  podcast: 'podcast',
  web: 'globe',
  article: 'file-text',
  social: 'share-2',
  travel: 'plane',
  academic: 'book-open',
  image: 'image',
  code: 'code',
}
