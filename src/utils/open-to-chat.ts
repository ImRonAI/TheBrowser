/**
 * Open-to-Chat Utilities
 * 
 * Utility functions for routing search results to appropriate agents
 * through the internal agent system (Ron, Researcher, Browser Agent, Coding Agent).
 * Handles context building, agent routing, and transcription stubs.
 */

import type {
  UniversalResult,
  OpenToChatContext,
  AgentId,
} from '@/pages/types/search'

import {
  isVideoResult,
  isAudioResult,
  isPodcastResult,
  isWebResult,
  isArticleResult,
  isSocialMediaResult,
  isTravelResult,
  isAcademicResult,
  isImageResult,
  isCodeResult,
} from '@/pages/types/search'

/**
 * Helper function to safely extract a display title from any result type
 * Handles cases where 'title' doesn't exist (e.g., SocialMediaResult)
 */
function getDisplayTitle(result: UniversalResult): string {
  // Use type guards to safely access properties
  if (isSocialMediaResult(result)) {
    // SocialMediaResult doesn't have title, use a portion of content
    return result.content.slice(0, 60) + (result.content.length > 60 ? '...' : '')
  }
  
  if (isImageResult(result)) {
    // ImageResult has optional title
    return result.title || result.url.split('/').pop() || 'Untitled Image'
  }
  
  // All other result types have required title
  return result.title
}

/**
 * Builds a properly formatted OpenToChatContext from a search result
 * 
 * @param result - The search result to extract context from
 * @param searchQuery - Optional original search query for reference
 * @returns A formatted OpenToChatContext object
 */
export function buildOpenToChatContext(
  result: UniversalResult,
  searchQuery?: string
): OpenToChatContext {
  // Extract title for safe access
  const title = getDisplayTitle(result)

  // Extract relevant metadata based on result type using type guards
  let snippet = ''
  let selectedText = ''
  
  if (isWebResult(result)) {
    snippet = result.snippet
    selectedText = `${title}\n\n${result.snippet}`
  } else if (isArticleResult(result)) {
    snippet = result.snippet || result.contentPreview || ''
    selectedText = `${title}\n\n${snippet}`
  } else if (isVideoResult(result)) {
    snippet = `Video: ${title}\nDuration: ${formatDuration(result.duration)}`
    selectedText = `${title}\n\nPlatform: ${result.platform || 'Unknown'}`
  } else if (isAudioResult(result)) {
    snippet = `Audio: ${title}\nArtist: ${result.artist || 'Unknown'}`
    selectedText = `${title}\n\nArtist: ${result.artist || 'Unknown'}`
  } else if (isPodcastResult(result)) {
    snippet = `Podcast: ${title}\nShow: ${result.showTitle || 'Unknown'}`
    selectedText = `${title}\n\nShow: ${result.showTitle || 'Unknown'}\nHost: ${result.host || 'Unknown'}`
  } else if (isSocialMediaResult(result)) {
    snippet = result.content
    selectedText = `Post from ${result.platform}:\n\n${result.content}`
  } else if (isTravelResult(result)) {
    snippet = `${title}\nPrice: ${result.price}${result.currency || ''}`
    selectedText = `${title}\n\nPrice: ${result.price}${result.currency || ''}\nDestination: ${result.destination}`
  } else if (isAcademicResult(result)) {
    snippet = result.snippet || result.abstract || ''
    selectedText = `${title}\n\n${snippet}`
  } else if (isImageResult(result)) {
    snippet = `Image: ${title || 'Untitled'}\nSource: ${result.source || result.url}`
    selectedText = `${title || 'Untitled'}\n\nSource: ${result.source || result.url}`
  } else if (isCodeResult(result)) {
    snippet = result.snippet
    selectedText = `${title}\n\n${snippet}\n\nLanguage: ${result.language}`
  } else {
    snippet = ''
    selectedText = ''
  }

  // Build the context object
  const context: OpenToChatContext = {
    resultId: result.id,
    resultType: result.type,
    title,
    url: result.url,
    content: buildContentSummary(result),
    snippet,
    targetAgent: getAgentForResult(result),
    routingReason: getRoutingReason(result.type),
    query: searchQuery,
    sourceUrl: result.url,
    selectedText,
    metadata: result.metadata,
  }

  return context
}

/**
 * Determines which internal agent should handle a given search result
 * based on the routing strategy from the architecture
 * 
 * @param result - The search result to route
 * @returns The internal agent ID to route to
 */
export function getAgentForResult(result: UniversalResult): AgentId {
  switch (result.type) {
    case 'video':
    case 'audio':
    case 'podcast':
      // Audio/video content needs researcher for transcription and analysis
      return 'researcher'
    
    case 'code':
      // Code-related tasks go to coding agent
      return 'coding-agent'
    
    case 'social':
    case 'web':
    case 'article':
      // Social media, web pages, and articles go to browser agent
      return 'browser'
    
    case 'travel':
    case 'academic':
      // Travel planning and research papers go to researcher
      return 'researcher'
    
    case 'image':
      // Images can be handled by browser agent for source navigation
      return 'browser'
    
    default:
      // Default to Ron (orchestrator)
      return 'ron'
  }
}

/**
 * Mock function for transcribing audio content
 * This is a placeholder for the backend transcription service
 * 
 * @param audioUrl - URL of the audio file to transcribe
 * @returns Promise resolving to the transcript text
 */
export async function transcribeAudio(audioUrl: string): Promise<string> {
  // TODO: Implement actual backend transcription service
  // This is a stub that will be replaced with real transcription
  
  return new Promise((resolve) => {
    // Simulate transcription delay
    setTimeout(() => {
      resolve('[Transcription Service Stub]\n\nThis is a placeholder for the audio transcription service.\n\nAudio URL: ' + audioUrl)
    }, 1000)
  })
}

// ============================================
// Helper Functions
// ============================================

/**
 * Formats a duration in seconds to a human-readable format
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`
  }
  return `${secs}s`
}

/**
 * Builds a summary content string for the agent prompt
 */
function buildContentSummary(result: UniversalResult): string {
  const title = getDisplayTitle(result)
  
  if (isWebResult(result)) {
    return result.snippet || ''
  } else if (isArticleResult(result)) {
    return result.snippet || ''
  } else if (isVideoResult(result)) {
    return `Video: ${title}\nPlatform: ${result.platform || 'Unknown'}\nDuration: ${formatDuration(result.duration)}`
  } else if (isAudioResult(result)) {
    return `Audio: ${title}\nArtist: ${result.artist || 'Unknown'}\nAlbum: ${result.album || 'Unknown'}`
  } else if (isPodcastResult(result)) {
    return `Podcast: ${title}\nShow: ${result.showTitle || 'Unknown'}\nHost: ${result.host || 'Unknown'}`
  } else if (isSocialMediaResult(result)) {
    return `Social post from ${result.platform}\n\n${result.content}`
  } else if (isTravelResult(result)) {
    return `${title}\nDestination: ${result.destination}\nPrice: ${result.price}${result.currency || ''}`
  } else if (isAcademicResult(result)) {
    return `Research Paper: ${title}\nAuthors: ${result.authors.join(', ')}\nJournal: ${result.journal || 'Unknown'}`
  } else if (isImageResult(result)) {
    return `Image: ${title}\nSource: ${result.source || result.url}\nSize: ${result.width}x${result.height}`
  } else if (isCodeResult(result)) {
    return `Code: ${title}\nLanguage: ${result.language}\n${result.snippet || ''}`
  } else {
    return ''
  }
}

/**
 * Gets the routing reason for a given result type
 */
function getRoutingReason(type: UniversalResult['type']): string {
  switch (type) {
    case 'video':
    case 'audio':
    case 'podcast':
      return 'Media content requires transcription and analysis'
    
    case 'code':
      return 'Code-related task requiring coding specialist'
    
    case 'social':
    case 'web':
    case 'article':
      return 'Web content requiring navigation and browsing'
    
    case 'travel':
    case 'academic':
      return 'Research and analysis required'
    
    case 'image':
      return 'Image content with source navigation'
    
    default:
      return 'General inquiry handled by orchestrator'
  }
}

/**
 * Builds an appropriate prompt for opening a result in an internal agent
 */
export function buildAgentPromptForResult(
  result: UniversalResult,
  searchQuery?: string,
  context?: OpenToChatContext
): string {
  const searchContext = searchQuery ? `I was searching for: "${searchQuery}"\n\n` : ''
  const title = getDisplayTitle(result)

  const sourceUrl = context?.sourceUrl || context?.url || result.url
  const sourceSection = sourceUrl ? `\n\nSource URL: ${sourceUrl}` : ''
  const selectedText = context?.selectedText?.trim()
  const selectedTextSection = selectedText ? `\n\nSelected context:\n${selectedText}` : ''

  let metadataSection = ''
  if (context?.metadata && Object.keys(context.metadata).length > 0) {
    try {
      metadataSection = `\n\nContext metadata: ${JSON.stringify(context.metadata)}`
    } catch {
      metadataSection = ''
    }
  }

  const withContext = (basePrompt: string) =>
    `${basePrompt}${sourceSection}${selectedTextSection}${metadataSection}`

  if (isVideoResult(result) || isAudioResult(result) || isPodcastResult(result)) {
    return withContext(`${searchContext}I found this ${result.type} result and would like you to analyze it:\n\n${title}`)
  } else if (isCodeResult(result)) {
    return withContext(`${searchContext}I found this code repository and would like you to help me understand it:\n\n${title}\n\n${result.snippet || ''}`)
  } else if (isTravelResult(result)) {
    return withContext(`${searchContext}I found this travel option and would like your analysis:\n\n${title}\n\nDestination: ${result.destination}\nPrice: ${result.price}${result.currency || ''}`)
  } else if (isAcademicResult(result)) {
    return withContext(`${searchContext}I found this research paper and would like a summary:\n\n${title}\n\n${result.snippet || result.abstract || ''}`)
  } else if (isWebResult(result) || isArticleResult(result)) {
    const snippet = isWebResult(result) ? result.snippet : isArticleResult(result) ? result.snippet : ''
    return withContext(`${searchContext}I found this result and would like you to help me understand it:\n\n${title}\n\n${snippet || ''}`)
  } else if (isSocialMediaResult(result)) {
    return withContext(`${searchContext}I found this result and would like you to help me understand it:\n\n${title}\n\n${result.content}`)
  } else if (isImageResult(result)) {
    return withContext(`${searchContext}I found this image and would like more information:\n\n${title}`)
  } else {
    return withContext(`${searchContext}I found this result and would like you to help me understand it:\n\n${title}`)
  }
}
