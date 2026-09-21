/**
 * ResponseWithCitations
 *
 * Extends ResponseMarkdown to support inline citations with hover previews.
 * Parses [1], [2], [3] markers and renders InlineCitation components.
 */

import { ResponseMarkdown } from './response'
import {
  InlineCitation,
  InlineCitationText,
  InlineCitationCard,
  InlineCitationCardTrigger,
  InlineCitationCardBody,
  InlineCitationCarousel,
  InlineCitationCarouselContent,
  InlineCitationCarouselItem,
  InlineCitationCarouselHeader,
  InlineCitationCarouselIndex,
  InlineCitationCarouselPrev,
  InlineCitationCarouselNext,
  InlineCitationSource
} from './inline-citation'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Citation {
  number: string
  title: string
  url: string
  snippet?: string
}

interface ResponseWithCitationsProps {
  content: string
  citations?: Citation[]
  isStreaming?: boolean
  className?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Citation Parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseInlineCitations(content: string, citations: Citation[]) {
  // If no citations provided, return raw markdown
  if (!citations || citations.length === 0) {
    return content
  }

  // Split by numbered citations: [1], [2], [3], etc.
  const parts = content.split(/(\[\d+\])/)

  return parts.map((part, index) => {
    // Check if this part matches citation pattern
    const citationMatch = part.match(/\[(\d+)\]/)

    if (citationMatch) {
      const citationNumber = citationMatch[1]
      // Find citation by number (1-indexed)
      const citation = citations.find(c => c.number === citationNumber)

      if (citation) {
        return (
          <InlineCitation key={index}>
            <InlineCitationCard>
              <InlineCitationCardTrigger sources={[citation.url]} />
              <InlineCitationCardBody>
                <InlineCitationCarousel>
                  <InlineCitationCarouselHeader>
                    <InlineCitationCarouselPrev />
                    <InlineCitationCarouselNext />
                    <InlineCitationCarouselIndex />
                  </InlineCitationCarouselHeader>
                  <InlineCitationCarouselContent>
                    <InlineCitationCarouselItem>
                      <InlineCitationSource
                        title={citation.title}
                        url={citation.url}
                        description={citation.snippet}
                      />
                    </InlineCitationCarouselItem>
                  </InlineCitationCarouselContent>
                </InlineCitationCarousel>
              </InlineCitationCardBody>
            </InlineCitationCard>
          </InlineCitation>
        )
      }

      // If no matching citation found, still render as styled citation text
      return (
        <span
          key={index}
          className="text-purple-400 font-medium cursor-default"
          title="Citation (source metadata pending)"
        >
          {part}
        </span>
      )
    }

    return <InlineCitationText key={index}>{part}</InlineCitationText>
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function ResponseWithCitations({
  content,
  citations = [],
  isStreaming,
  className
}: ResponseWithCitationsProps) {
  // If we have citations, parse and render with InlineCitation components
  if (citations && citations.length > 0) {
    return (
      <div className={className}>
        {parseInlineCitations(content, citations)}
      </div>
    )
  }

  // Fall back to regular markdown rendering
  return (
    <ResponseMarkdown
      content={content}
      isStreaming={isStreaming}
      className={className}
    />
  )
}
