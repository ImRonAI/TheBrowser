/**
 * SourceCard
 * 
 * Compact citation card with favicon, domain, title, snippet, and citation badge.
 * Features hover actions: Visit Site, Send to Ron, Send to Coding, Attach to Task, Start Task.
 */

import { useState } from 'react'
import { 
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftRightIcon,
  CodeBracketIcon,
  PaperClipIcon,
  PlayIcon,
} from '@heroicons/react/24/outline'

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
}

interface SourceCardProps {
  source: SourceData
  citationNumber?: number
  onVisitSite?: () => void
  onSendToRon?: () => void
  onSendToCoding?: () => void
  onAttachToTask?: () => void
  onStartTask?: () => void
  onPreview?: () => void
  className?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Get favicon URL
// ─────────────────────────────────────────────────────────────────────────────
function getFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Get type icon color
// ─────────────────────────────────────────────────────────────────────────────
function getTypeAccent(type: SourceData['type']): string {
  switch (type) {
    case 'academic':
      return 'text-amber-400'
    case 'video':
      return 'text-red-400'
    case 'code':
      return 'text-green-400'
    case 'social':
      return 'text-blue-400'
    default:
      return 'text-slate-400'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export function SourceCard({
  source,
  citationNumber,
  onVisitSite,
  onSendToRon,
  onSendToCoding,
  onAttachToTask,
  onStartTask,
  onPreview,
  className = '',
}: SourceCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [faviconError, setFaviconError] = useState(false)

  const handleClick = () => {
    if (onPreview) {
      onPreview()
    } else if (onVisitSite) {
      onVisitSite()
    } else {
      window.open(source.url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div
      className={`
        group relative w-full
        glass-bold
        rounded-xl overflow-hidden
        border border-white/20 dark:border-white/10
        shadow-lg shadow-indigo-500/5 dark:shadow-black/20
        transition-all duration-200 ease-out
        hover:scale-[1.02]
        hover:shadow-xl hover:shadow-indigo-500/10 dark:hover:shadow-black/40
        cursor-pointer
        ${className}
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      {/* Hover Overlay - Enhanced Glass */}
      <div 
        className={`
          absolute inset-0 z-0
          bg-gradient-to-br from-white/5 to-white/0 dark:from-white/5 dark:to-transparent
          opacity-0 group-hover:opacity-100 transition-opacity duration-500
        `}
      />
      {/* Citation badge */}
      {citationNumber !== undefined && (
        <div 
          className="
            absolute -top-1 -right-1 z-10
            w-5 h-5 flex items-center justify-center
            bg-gradient-to-br from-purple-500 to-purple-700
            text-white text-[10px] font-bold
            rounded-full shadow-md
            border border-purple-400/50
          "
        >
          {citationNumber}
        </div>
      )}

      {/* Main content */}
      <div className="p-3">
        {/* Header: favicon + domain */}
        <div className="flex items-center gap-2 mb-2">
          {/* Favicon */}
          <div className="w-5 h-5 rounded flex items-center justify-center bg-slate-700/50 overflow-hidden">
            {!faviconError ? (
              <img 
                src={source.favicon || getFaviconUrl(source.domain)}
                alt=""
                className="w-4 h-4 object-contain"
                onError={() => setFaviconError(true)}
              />
            ) : (
              <div className={`text-xs font-bold ${getTypeAccent(source.type)}`}>
                {source.domain.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          {/* Domain + type indicator */}
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            <span className={`text-xs font-medium truncate ${getTypeAccent(source.type)}`}>
              {source.domain}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 bg-slate-700/50 rounded text-slate-400">
              {source.type}
            </span>
          </div>
        </div>

        {/* Title */}
        <h4 className="text-sm font-medium text-white/90 line-clamp-2 mb-1.5 leading-tight">
          {source.title}
        </h4>

        {/* Snippet */}
        <p className="text-xs text-white/50 line-clamp-2 leading-relaxed">
          {source.snippet}
        </p>
      </div>

      {/* Hover actions */}
      <div 
        className={`
          absolute inset-0 flex items-center justify-center gap-1.5
          bg-slate-900/90 backdrop-blur-sm
          transition-opacity duration-200
          ${isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'}
        `}
      >
        {/* Visit Site */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            window.open(source.url, '_blank', 'noopener,noreferrer')
          }}
          className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
          title="Visit Site"
        >
          <ArrowTopRightOnSquareIcon className="w-4 h-4 text-white/80" />
        </button>

        {/* Send to Ron */}
        {onSendToRon && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSendToRon()
            }}
            className="p-2 rounded-lg bg-teal-500/20 hover:bg-teal-500/30 transition-colors"
            title="Send to Ron"
          >
            <ChatBubbleLeftRightIcon className="w-4 h-4 text-teal-400" />
          </button>
        )}

        {/* Send to Coding */}
        {onSendToCoding && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSendToCoding()
            }}
            className="p-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 transition-colors"
            title="Send to Coding Agent"
          >
            <CodeBracketIcon className="w-4 h-4 text-blue-400" />
          </button>
        )}

        {/* Attach to Task */}
        {onAttachToTask && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAttachToTask()
            }}
            className="p-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 transition-colors"
            title="Attach to Task"
          >
            <PaperClipIcon className="w-4 h-4 text-amber-400" />
          </button>
        )}

        {/* Start Task */}
        {onStartTask && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onStartTask()
            }}
            className="p-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 transition-colors"
            title="Start Task"
          >
            <PlayIcon className="w-4 h-4 text-purple-400" />
          </button>
        )}
      </div>
    </div>
  )
}

export default SourceCard
