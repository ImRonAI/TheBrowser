/**
 * Preview Panel - Sliding Preview for Browser Automation & Project Preview
 * 
 * Based on AI Elements vibe coding implementation.
 * Shows browser automation in real-time and project dev server previews.
 * 
 * Features:
 * - Sliding panel that animates in from the right
 * - Fullscreen mode with blurred background (same size as TaskDetailView)
 * - Browser preview with navigation, URL bar, screenshot display
 * - Project preview with console output and live iframe
 * - Scale down to fit in constrained spaces (Agent Panel accordion)
 */

'use client'

import { useState, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/cn'
import { usePreviewStore, type BrowserPreviewData, type ProjectPreviewData, type CodePreviewData } from '@/stores/previewStore'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type PreviewPanelVariant = 'sliding' | 'accordion' | 'overlay'

interface PreviewPanelProps {
  variant?: PreviewPanelVariant
  className?: string
}

interface AccordionPreviewProps {
  isExpanded: boolean
  onToggle: () => void
  className?: string
}

const EASE = [0.16, 1, 0.3, 1] as const

// ─────────────────────────────────────────────────────────────────────────────
// Main Preview Panel Component
// ─────────────────────────────────────────────────────────────────────────────

export const PreviewPanel = memo(function PreviewPanel({
  variant = 'sliding',
  className,
}: PreviewPanelProps) {
  const {
    isOpen,
    isFullscreen,
    previewType,
    browserData,
    projectData,
    codeData,
    closePreview,
    toggleFullscreen,
  } = usePreviewStore()

  if (!isOpen) return null

  // Fullscreen overlay mode
  if (isFullscreen) {
    return (
      <FullscreenPreview
        previewType={previewType}
        browserData={browserData}
        projectData={projectData}
        codeData={codeData}
        onClose={closePreview}
        onToggleFullscreen={toggleFullscreen}
      />
    )
  }

  // Sliding panel mode (for Ron Tab and SuperAgent)
  if (variant === 'sliding') {
    return (
      <SlidingPreviewPanel
        previewType={previewType}
        browserData={browserData}
        projectData={projectData}
        codeData={codeData}
        onClose={closePreview}
        onToggleFullscreen={toggleFullscreen}
        className={className}
      />
    )
  }

  // Accordion mode (for Agent Panel task)
  return (
    <AccordionPreviewContent
      previewType={previewType}
      browserData={browserData}
      projectData={projectData}
      codeData={codeData}
      onClose={closePreview}
      onToggleFullscreen={toggleFullscreen}
      className={className}
    />
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Fullscreen Overlay Preview
// ─────────────────────────────────────────────────────────────────────────────

interface FullscreenPreviewProps {
  previewType: 'browser' | 'project' | 'code' | 'none'
  browserData: BrowserPreviewData | null
  projectData: ProjectPreviewData | null
  codeData: CodePreviewData | null
  onClose: () => void
  onToggleFullscreen: () => void
}

function FullscreenPreview({
  previewType,
  browserData,
  projectData,
  codeData,
  onClose,
  onToggleFullscreen,
}: FullscreenPreviewProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 md:p-10"
    >
      {/* Blurred Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-surface-900/60 dark:bg-surface-900/80 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal Container - Same sizing as TaskDetailView */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 24 }}
        transition={{ duration: 0.4, ease: EASE }}
        className={cn(
          "relative z-10",
          "glass-bold",
          "rounded-2xl",
          "border border-white/20 dark:border-white/10",
          "shadow-2xl shadow-indigo-500/10 dark:shadow-black/50",
          "overflow-hidden",
          "flex flex-col",
          "w-full max-w-5xl h-full max-h-[800px]"
        )}
      >
        {/* Header */}
        <PreviewHeader
          title={getPreviewTitle(previewType, browserData, projectData)}
          onClose={onClose}
          onToggleFullscreen={onToggleFullscreen}
          isFullscreen={true}
        />

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          <PreviewContent
            previewType={previewType}
            browserData={browserData}
            projectData={projectData}
            codeData={codeData}
          />
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sliding Panel Preview
// ─────────────────────────────────────────────────────────────────────────────

interface SlidingPreviewPanelProps extends FullscreenPreviewProps {
  className?: string
}

function SlidingPreviewPanel({
  previewType,
  browserData,
  projectData,
  codeData,
  onClose,
  onToggleFullscreen,
  className,
}: SlidingPreviewPanelProps) {
  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className={cn(
        "flex flex-col",
        "w-[400px] h-full",
        "border-l border-surface-200 dark:border-surface-700",
        "bg-surface-50 dark:bg-surface-850",
        "shadow-xl",
        className
      )}
    >
      {/* Header */}
      <PreviewHeader
        title={getPreviewTitle(previewType, browserData, projectData)}
        onClose={onClose}
        onToggleFullscreen={onToggleFullscreen}
        isFullscreen={false}
      />

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <PreviewContent
          previewType={previewType}
          browserData={browserData}
          projectData={projectData}
          codeData={codeData}
        />
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Accordion Preview Content (for Agent Panel)
// ─────────────────────────────────────────────────────────────────────────────

interface AccordionPreviewContentProps extends FullscreenPreviewProps {
  className?: string
}

function AccordionPreviewContent({
  previewType,
  browserData,
  projectData,
  codeData,
  onClose,
  onToggleFullscreen,
  className,
}: AccordionPreviewContentProps) {
  return (
    <div className={cn("flex flex-col rounded-lg overflow-hidden border border-surface-200 dark:border-surface-700", className)}>
      {/* Compact Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700">
        <div className="flex items-center gap-2">
          <PreviewTypeIcon type={previewType} />
          <span className="text-body-xs font-medium text-ink dark:text-ink-inverse truncate">
            {getPreviewTitle(previewType, browserData, projectData)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleFullscreen}
            className="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-ink-muted dark:text-ink-inverse-muted"
            aria-label="Fullscreen"
          >
            <ExpandIcon className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-ink-muted dark:text-ink-inverse-muted"
            aria-label="Close"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Scaled Preview */}
      <div className="relative aspect-video overflow-hidden bg-surface-900">
        <div 
          className="absolute inset-0 origin-top-left"
          style={{ 
            transform: 'scale(0.5)', 
            width: '200%', 
            height: '200%' 
          }}
        >
          <PreviewContent
            previewType={previewType}
            browserData={browserData}
            projectData={projectData}
            codeData={codeData}
            compact
          />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Accordion Wrapper for Agent Panel Task
// ─────────────────────────────────────────────────────────────────────────────

export function AccordionPreview({ isExpanded, onToggle, className }: AccordionPreviewProps) {
  const { isOpen, previewType, browserData, projectData, codeData, closePreview, toggleFullscreen } = usePreviewStore()

  if (!isOpen) return null

  return (
    <div className={cn("mt-3", className)}>
      {/* Accordion Trigger */}
      <button
        onClick={onToggle}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 rounded-lg",
          "bg-surface-100 dark:bg-surface-800",
          "border border-surface-200 dark:border-surface-700",
          "hover:bg-surface-200 dark:hover:bg-surface-700",
          "transition-colors duration-200"
        )}
      >
        <div className="flex items-center gap-2">
          <PreviewTypeIcon type={previewType} />
          <span className="text-body-xs font-medium text-ink dark:text-ink-inverse">
            Preview
          </span>
          {previewType === 'browser' && (
            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300">
              Live
            </span>
          )}
        </div>
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDownIcon className="w-4 h-4 text-ink-muted dark:text-ink-inverse-muted" />
        </motion.div>
      </button>

      {/* Accordion Content */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="pt-2">
              <AccordionPreviewContent
                previewType={previewType}
                browserData={browserData}
                projectData={projectData}
                codeData={codeData}
                onClose={closePreview}
                onToggleFullscreen={toggleFullscreen}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview Header
// ─────────────────────────────────────────────────────────────────────────────

interface PreviewHeaderProps {
  title: string
  onClose: () => void
  onToggleFullscreen: () => void
  isFullscreen: boolean
}

function PreviewHeader({ title, onClose, onToggleFullscreen, isFullscreen }: PreviewHeaderProps) {
  return (
    <div className="flex-shrink-0 px-4 py-3 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-850">
      <div className="flex items-center justify-between">
        {/* Left: Window controls (macOS style) */}
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="group w-3 h-3 rounded-full bg-rose-500 hover:bg-rose-600 flex items-center justify-center transition-colors"
            aria-label="Close"
          >
            <XIcon className="w-1.5 h-1.5 text-rose-900 opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="group w-3 h-3 rounded-full bg-amber-500 hover:bg-amber-600 flex items-center justify-center transition-colors"
            aria-label="Minimize"
          >
            <MinimizeIcon className="w-1.5 h-1.5 text-amber-900 opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onToggleFullscreen}
            className="group w-3 h-3 rounded-full bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center transition-colors"
            aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            <ExpandIcon className="w-1.5 h-1.5 text-emerald-900 opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.button>
        </div>

        {/* Center: Title */}
        <h3 className="text-body-sm font-medium text-ink dark:text-ink-inverse truncate mx-4">
          {title}
        </h3>

        {/* Right: Spacer */}
        <div className="w-16" />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview Content
// ─────────────────────────────────────────────────────────────────────────────

interface PreviewContentProps {
  previewType: 'browser' | 'project' | 'code' | 'none'
  browserData: BrowserPreviewData | null
  projectData: ProjectPreviewData | null
  codeData: CodePreviewData | null
  compact?: boolean
}

function PreviewContent({ previewType, browserData, projectData, codeData, compact }: PreviewContentProps) {
  if (previewType === 'browser' && browserData) {
    return <BrowserPreviewContent data={browserData} compact={compact} />
  }

  if (previewType === 'project' && projectData) {
    return <ProjectPreviewContent data={projectData} compact={compact} />
  }

  if (previewType === 'code' && codeData) {
    return <CodePreviewContent data={codeData} compact={compact} />
  }

  return (
    <div className="h-full flex items-center justify-center text-ink-muted dark:text-ink-inverse-muted">
      <p>No preview available</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser Preview Content
// ─────────────────────────────────────────────────────────────────────────────

interface BrowserPreviewContentProps {
  data: BrowserPreviewData
  compact?: boolean
}

function BrowserPreviewContent({ data }: BrowserPreviewContentProps) {
  const { url, screenshot, title, isLive } = data

  return (
    <div className="h-full flex flex-col">
      {/* Mini browser chrome */}
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700">
        {/* Traffic lights */}
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
        </div>
        
        {/* URL bar */}
        <div className="flex-1 flex items-center gap-2 px-2 py-1 rounded bg-surface-0 dark:bg-surface-900 text-body-xs">
          <LockIcon className="w-3 h-3 text-green-500" />
          <span className="text-ink-secondary dark:text-ink-inverse-secondary truncate">
            {url || 'No URL'}
          </span>
        </div>

        {/* Live indicator */}
        {isLive && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-100 dark:bg-red-900/30">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] font-bold uppercase text-red-600 dark:text-red-400">
              Live
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 relative bg-white dark:bg-surface-900">
        {isLive && url ? (
          <iframe
            src={url}
            className="w-full h-full"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            title={title || 'Browser preview'}
            data-preview="browser"
            data-active={isLive ? 'true' : 'false'}
          />
        ) : screenshot ? (
          <img 
            src={screenshot} 
            alt={title || 'Page screenshot'}
            className="w-full h-full object-cover object-top"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center">
              <GlobeIcon className="w-12 h-12 mx-auto text-ink-muted/30 dark:text-ink-inverse-muted/30 mb-2" />
              <p className="text-body-sm text-ink-muted dark:text-ink-inverse-muted">
                Waiting for browser action...
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Preview Content
// ─────────────────────────────────────────────────────────────────────────────

interface ProjectPreviewContentProps {
  data: ProjectPreviewData
  compact?: boolean
}

function ProjectPreviewContent({ data }: ProjectPreviewContentProps) {
  const { url, name, status, consoleOutput } = data
  const [showConsole, setShowConsole] = useState(false)

  return (
    <div className="h-full flex flex-col">
      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700">
        <div className="flex items-center gap-2">
          <StatusIndicator status={status} />
          <span className="text-body-xs font-medium text-ink dark:text-ink-inverse">
            {name || 'Dev Server'}
          </span>
        </div>
        
        {url && (
          <span className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">
            {url}
          </span>
        )}
      </div>

      {/* Preview iframe or loading state */}
      <div className="flex-1 relative">
        {status === 'running' && url ? (
          <iframe
            src={url}
            className="w-full h-full bg-white"
            title={name || 'Project preview'}
            data-preview="project"
            data-active={status === 'running' ? 'true' : 'false'}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-surface-50 dark:bg-surface-850">
            {status === 'starting' && (
              <div className="text-center">
                <LoaderSpinner className="w-8 h-8 mx-auto text-accent dark:text-accent-light mb-3" />
                <p className="text-body-sm text-ink-muted dark:text-ink-inverse-muted">
                  Starting dev server...
                </p>
              </div>
            )}
            {status === 'stopped' && (
              <div className="text-center">
                <StopIcon className="w-8 h-8 mx-auto text-ink-muted/30 dark:text-ink-inverse-muted/30 mb-2" />
                <p className="text-body-sm text-ink-muted dark:text-ink-inverse-muted">
                  Server stopped
                </p>
              </div>
            )}
            {status === 'error' && (
              <div className="text-center">
                <ErrorIcon className="w-8 h-8 mx-auto text-red-500 mb-2" />
                <p className="text-body-sm text-red-600 dark:text-red-400">
                  Failed to start server
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Console section */}
      {consoleOutput && consoleOutput.length > 0 && (
        <div className="border-t border-surface-200 dark:border-surface-700">
          <button
            onClick={() => setShowConsole(!showConsole)}
            className="w-full flex items-center justify-between px-3 py-2 hover:bg-surface-100 dark:hover:bg-surface-800"
          >
            <span className="text-body-xs font-medium text-ink dark:text-ink-inverse">
              Console
            </span>
            <ChevronDownIcon className={cn(
              "w-4 h-4 text-ink-muted transition-transform",
              showConsole && "rotate-180"
            )} />
          </button>
          
          <AnimatePresence>
            {showConsole && (
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                exit={{ height: 0 }}
                className="overflow-hidden"
              >
                <div className="max-h-32 overflow-y-auto p-3 bg-surface-900 font-mono text-xs">
                {consoleOutput.map((log: { level: 'log' | 'warn' | 'error'; message: string; timestamp: Date }, i: number) => (
                    <div
                      key={i}
                      className={cn(
                        "py-0.5",
                        log.level === 'error' && "text-red-400",
                        log.level === 'warn' && "text-yellow-400",
                        log.level === 'log' && "text-surface-300"
                      )}
                    >
                      <span className="text-surface-500 mr-2">
                        {log.timestamp.toLocaleTimeString()}
                      </span>
                      {log.message}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Code Preview Content
// ─────────────────────────────────────────────────────────────────────────────

interface CodePreviewContentProps {
  data: CodePreviewData
  compact?: boolean
}

function CodePreviewContent({ data }: CodePreviewContentProps) {
  const { code, filename } = data

  return (
    <div className="h-full flex flex-col">
      {filename && (
        <div className="flex items-center px-3 py-2 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700">
          <FileIcon className="w-4 h-4 text-ink-muted dark:text-ink-inverse-muted mr-2" />
          <span className="text-body-xs font-mono text-ink dark:text-ink-inverse">
            {filename}
          </span>
        </div>
      )}
      <div className="flex-1 overflow-auto p-4 bg-surface-900">
        <pre className="font-mono text-xs text-surface-100 whitespace-pre-wrap">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Components
// ─────────────────────────────────────────────────────────────────────────────

function StatusIndicator({ status }: { status: 'starting' | 'running' | 'stopped' | 'error' }) {
  const config = {
    starting: { color: 'bg-amber-500', animate: true },
    running: { color: 'bg-green-500', animate: false },
    stopped: { color: 'bg-surface-400', animate: false },
    error: { color: 'bg-red-500', animate: false },
  }

  const { color, animate } = config[status]

  return (
    <div className={cn("w-2 h-2 rounded-full", color, animate && "animate-pulse")} />
  )
}

function PreviewTypeIcon({ type }: { type: 'browser' | 'project' | 'code' | 'none' }) {
  switch (type) {
    case 'browser':
      return <GlobeIcon className="w-4 h-4 text-cyan-500" />
    case 'project':
      return <PlayIcon className="w-4 h-4 text-green-500" />
    case 'code':
      return <CodeIcon className="w-4 h-4 text-purple-500" />
    default:
      return null
  }
}

function getPreviewTitle(
  type: 'browser' | 'project' | 'code' | 'none',
  browserData: BrowserPreviewData | null,
  projectData: ProjectPreviewData | null
): string {
  if (type === 'browser' && browserData?.title) return browserData.title
  if (type === 'browser' && browserData?.url) return browserData.url
  if (type === 'project' && projectData?.name) return projectData.name
  
  const titles = {
    browser: 'Browser Preview',
    project: 'Project Preview',
    code: 'Code Preview',
    none: 'Preview',
  }
  return titles[type]
}

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function MinimizeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function ExpandIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  )
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  )
}

function CodeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  )
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </svg>
  )
}

function ErrorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

function LoaderSpinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" />
      <path className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" fill="currentColor" />
    </svg>
  )
}

export { PreviewPanel as default }
