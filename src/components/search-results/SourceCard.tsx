/**
 * SourceCard
 *
 * AI Elements-aligned source display. Uses the core <Source /> component and
 * optional lightweight actions.
 */

import type { MouseEvent } from 'react'
import {
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftRightIcon,
  CodeBracketIcon,
  PaperClipIcon,
  PlayIcon,
} from '@heroicons/react/24/outline'
import { Source } from '@/components/ai-elements/sources'
import { cn } from '@/utils/cn'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface SourceData {
  id: string
  url: string
  title: string
  snippet: string
  domain: string
  type: 'web' | 'academic' | 'video' | 'social' | 'code'
  favicon?: string
  thumbnail?: string
}

interface SourceCardProps {
  source: SourceData
  citationNumber?: number
  selected?: boolean
  onSelectionChange?: (selected: boolean) => void
  onVisitSite?: () => void
  onSendToRon?: () => void
  onSendToCoding?: () => void
  onAttachToTask?: () => void
  onStartTask?: () => void
  onPreview?: () => void
  className?: string
}

function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export function SourceCard({
  source,
  citationNumber,
  selected = false,
  onSelectionChange,
  onVisitSite,
  onSendToRon,
  onSendToCoding,
  onAttachToTask,
  onStartTask,
  onPreview,
  className = '',
}: SourceCardProps) {
  const domain = source.domain || getDomainFromUrl(source.url)
  const favicon = source.favicon
    ? source.favicon
    : domain
    ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
    : null

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (onPreview) {
      event.preventDefault()
      onPreview()
      return
    }
    if (onVisitSite) {
      event.preventDefault()
      onVisitSite()
    }
  }

  const actions = [
    { label: 'Visit', icon: ArrowTopRightOnSquareIcon, onClick: onVisitSite },
    { label: 'Chat', icon: ChatBubbleLeftRightIcon, onClick: onSendToRon },
    { label: 'Code', icon: CodeBracketIcon, onClick: onSendToCoding },
    { label: 'Attach', icon: PaperClipIcon, onClick: onAttachToTask },
    { label: 'Start', icon: PlayIcon, onClick: onStartTask },
  ].filter((action) => Boolean(action.onClick))

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-start gap-2">
        <Source href={source.url} onClick={handleClick}>
          <div className="flex items-start gap-3">
            {favicon ? (
              <img src={favicon} alt="" className="mt-0.5 h-4 w-4 rounded" />
            ) : (
              <span className="mt-0.5 h-4 w-4 rounded bg-muted" aria-hidden />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground line-clamp-1">
                {citationNumber ? `[${citationNumber}] ` : ''}
                {source.title}
              </p>
              {source.snippet && (
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                  {source.snippet}
                </p>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground/80 line-clamp-1">
                {domain}
              </p>
            </div>
          </div>
        </Source>

        {onSelectionChange && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelectionChange(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border border-muted-foreground/40"
            title="Select source"
          />
        )}
      </div>

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => {
            const Icon = action.icon
            return (
              <button
                key={action.label}
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  action.onClick?.()
                }}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Icon className="h-3 w-3" />
                {action.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default SourceCard
