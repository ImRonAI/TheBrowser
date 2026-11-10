/**
 * Inline markdown for search snippets and titles. Brave wraps hits in <strong> and
 * agent snippets carry **bold** — both render here as real emphasis instead of being
 * stripped flat. All other tags/entities are unwrapped to text; never any HTML.
 */
import { useMemo } from 'react'

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' }

function decodeEntities(text: string): string {
  return text.replace(/&(#?\w+);/g, (match, name: string) => ENTITIES[name] ?? match)
}

export function inlineMarkdownParts(text: string): Array<{ text: string; bold: boolean }> {
  const normalized = decodeEntities(
    text
      .replace(/<\/?(?:strong|b)\s*>/gi, '**')
      .replace(/<[^>]*>/g, ''),
  )
  const parts: Array<{ text: string; bold: boolean }> = []
  for (const chunk of normalized.split(/(\*\*[^*]+\*\*|__[^_]+__)/g)) {
    if (!chunk) continue
    const bold = (chunk.startsWith('**') && chunk.endsWith('**')) || (chunk.startsWith('__') && chunk.endsWith('__'))
    parts.push({ text: bold ? chunk.slice(2, -2) : chunk, bold })
  }
  return parts
}

export function InlineMarkdown({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => inlineMarkdownParts(text), [text])
  return (
    <span className={className}>
      {parts.map((part, index) =>
        part.bold ? (
          <strong key={index} className="font-semibold text-ink dark:text-ink-inverse">
            {part.text}
          </strong>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  )
}
