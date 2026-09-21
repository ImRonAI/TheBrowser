/**
 * Response Components
 *
 * Renders AI response content with streaming support and markdown formatting.
 * Uses Streamdown from vercel/ai-elements pattern.
 */

import { memo, type ComponentProps } from 'react'
import { Streamdown } from 'streamdown'
import { cn } from '@/utils/cn'
import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block'
import type { BundledLanguage } from 'shiki'

const CODE_BLOCK_LANGUAGE = /language-([^\s]+)/i

const MARKDOWN_COMPONENTS: NonNullable<ComponentProps<typeof Streamdown>['components']> = {
  code: ({ className, children, ...props }) => {
    const raw = Array.isArray(children) ? children.join('') : String(children ?? '')
    const match = typeof className === 'string' ? className.match(CODE_BLOCK_LANGUAGE) : null
    const language = (match?.[1] || 'text') as BundledLanguage
    const isInline = !match

    if (isInline) {
      return (
        <code
          className={cn(
            'rounded bg-surface-100/70 px-1.5 py-0.5 text-[0.85em] text-ink dark:bg-surface-800/70 dark:text-ink-inverse',
            className
          )}
          {...props}
        >
          {children}
        </code>
      )
    }

    return (
      <CodeBlock code={raw.trimEnd()} language={language} className="my-3">
        <CodeBlockCopyButton />
      </CodeBlock>
    )
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// MessageResponse - Following vercel/ai-elements pattern
// ─────────────────────────────────────────────────────────────────────────────

export type MessageResponseProps = ComponentProps<typeof Streamdown>

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
      components={MARKDOWN_COMPONENTS}
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children
)

MessageResponse.displayName = "MessageResponse"

// ─────────────────────────────────────────────────────────────────────────────
// ResponseMarkdown - Wrapper for backward compatibility
// ─────────────────────────────────────────────────────────────────────────────

interface ResponseMarkdownProps {
  content: string
  isStreaming?: boolean
  className?: string
}

export function ResponseMarkdown({ content, isStreaming, className }: ResponseMarkdownProps) {
  return (
    <MessageResponse
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none',
        className
      )}
      mode={isStreaming ? 'streaming' : 'static'}
      isAnimating={isStreaming}
      parseIncompleteMarkdown={isStreaming}
    >
      {content}
    </MessageResponse>
  )
}
