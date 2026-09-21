/**
 * SearchThinkingOverlay
 * 
 * A specialized loading overlay for the search thinking state.
 * Uses the reusable LoadingOverlay component.
 */

import { LoadingOverlay } from './LoadingOverlay'

interface SearchThinkingOverlayProps {
  /** Whether the overlay is visible */
  isVisible: boolean
  /** The search query being processed */
  query?: string
}

export function SearchThinkingOverlay({ isVisible, query }: SearchThinkingOverlayProps) {
  return (
    <LoadingOverlay
      isVisible={isVisible}
      query={query}
      messageInterval={3000}
      illustrationInterval={8000}
    />
  )
}

export default SearchThinkingOverlay
