/**
 * TextAttachmentCard Component
 * 
 * A sophisticated card for text file attachments with:
 * - Thumbnail preview (file icon + TXT badge)
 * - HoverCard with full preview and markdown rendering
 * - Edit dialog with find/replace functionality
 * - Download capability
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { 
  HoverCard, 
  HoverCardTrigger, 
  HoverCardContent 
} from '@/components/ui/hover-card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { 
  fileToDataUrl, 
  dataUrlToText, 
  formatFileSize 
} from '@/utils/file-utils'
import type { TextAttachment } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────

function FileTextIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  )
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

function ChevronsLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m11 17-5-5 5-5" />
      <path d="m18 17-5-5 5-5" />
    </svg>
  )
}

function ChevronsRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 17 5-5-5-5" />
      <path d="m13 17 5-5-5-5" />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TextAttachmentCard Component
// ─────────────────────────────────────────────────────────────────────────────

interface TextAttachmentCardProps {
  attachment: TextAttachment
  onRemove?: (id: string) => void
  onUpdate?: (id: string, next: Pick<TextAttachment, 'file' | 'dataUrl' | 'preview'>) => void
  className?: string
}

export function TextAttachmentCard({
  attachment,
  onRemove,
  onUpdate,
  className,
}: TextAttachmentCardProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [draftText, setDraftText] = useState<string>('')
  const [findQuery, setFindQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [activeMatchIdx, setActiveMatchIdx] = useState(0)
  const desiredMatchStartRef = useRef<number | null>(null)
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const editFieldFocusRef = useRef<HTMLInputElement | null>(null)

  const decoded = dataUrlToText(attachment.dataUrl)
  const previewText = decoded && decoded.length > 12000 ? `${decoded.slice(0, 12000)}\n…` : decoded

  const downloadName = attachment.file.name || 'attachment'
  const isPastedText = downloadName.startsWith('pasted-') && downloadName.endsWith('.txt')

  // Find all matches
  const matches = useMemo(() => {
    if (!findQuery) return []
    const indices: number[] = []
    let from = 0
    while (true) {
      const at = draftText.indexOf(findQuery, from)
      if (at === -1) break
      indices.push(at)
      from = at + Math.max(1, findQuery.length)
      if (indices.length > 5000) break // guard: extremely repetitive input
    }
    return indices
  }, [draftText, findQuery])

  const goToMatch = useCallback(
    (idx: number) => {
      const textarea = editTextareaRef.current
      if (!textarea) return
      if (!findQuery) return
      if (matches.length === 0) return

      const clamped = Math.min(Math.max(0, idx), matches.length - 1)
      const start = matches[clamped] ?? 0
      const end = start + findQuery.length

      const restoreTarget =
        editFieldFocusRef.current && document.contains(editFieldFocusRef.current)
          ? editFieldFocusRef.current
          : null

      try {
        textarea.focus({ preventScroll: true })
      } catch {
        textarea.focus()
      }
      textarea.setSelectionRange(start, end)

      if (restoreTarget) {
        try {
          restoreTarget.focus({ preventScroll: true })
        } catch {
          restoreTarget.focus()
        }
      }
    },
    [findQuery, matches],
  )

  const openEdit = () => {
    setDraftText(decoded ?? '')
    setFindQuery('')
    setReplaceQuery('')
    setActiveMatchIdx(0)
    setEditOpen(true)
  }

  const saveEdit = async () => {
    if (!onUpdate) return
    const nextFile = new File([draftText], downloadName, { type: 'text/plain' })
    const nextDataUrl = await fileToDataUrl(nextFile)
    onUpdate(attachment.id, { file: nextFile, dataUrl: nextDataUrl, preview: nextDataUrl })
    setEditOpen(false)
  }

  // When query changes, jump to first match
  useEffect(() => {
    if (!editOpen) return
    if (!findQuery) return
    if (matches.length === 0) return
    setActiveMatchIdx(0)
    queueMicrotask(() => goToMatch(0))
  }, [editOpen, findQuery, matches.length, goToMatch])

  // After replace/replace-all, pick the next match at/after the desired position
  useEffect(() => {
    if (!editOpen) return
    if (!findQuery) return
    if (desiredMatchStartRef.current == null) return

    const desired = desiredMatchStartRef.current
    desiredMatchStartRef.current = null

    if (matches.length === 0) return
    const nextIdx = matches.findIndex((m) => m >= desired)
    const idx = nextIdx === -1 ? matches.length - 1 : nextIdx
    setActiveMatchIdx(idx)
    queueMicrotask(() => goToMatch(idx))
  }, [editOpen, findQuery, matches, goToMatch])

  // Keep selection in sync when navigating
  useEffect(() => {
    if (!editOpen) return
    if (!findQuery) return
    if (matches.length === 0) return
    goToMatch(activeMatchIdx)
  }, [editOpen, findQuery, matches.length, activeMatchIdx, goToMatch])

  const goFirst = () => setActiveMatchIdx(0)
  const goLast = () => setActiveMatchIdx(Math.max(0, matches.length - 1))
  const goPrev = () =>
    setActiveMatchIdx((prev) =>
      matches.length === 0 ? 0 : (prev - 1 + matches.length) % matches.length,
    )
  const goNext = () =>
    setActiveMatchIdx((prev) => (matches.length === 0 ? 0 : (prev + 1) % matches.length))

  const replaceCurrent = () => {
    if (!findQuery) return
    if (matches.length === 0) return
    const start = matches[Math.min(Math.max(0, activeMatchIdx), matches.length - 1)]
    if (start == null) return
    const nextText =
      draftText.slice(0, start) + replaceQuery + draftText.slice(start + findQuery.length)
    desiredMatchStartRef.current = start + replaceQuery.length
    setDraftText(nextText)
  }

  const replaceAll = () => {
    if (!findQuery) return
    if (matches.length === 0) return
    const nextText = draftText.split(findQuery).join(replaceQuery)
    desiredMatchStartRef.current = 0
    setActiveMatchIdx(0)
    setDraftText(nextText)
  }

  return (
    <HoverCard openDelay={150} closeDelay={75}>
      <HoverCardTrigger asChild>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className={cn(
            'group relative overflow-hidden rounded-2xl',
            'border border-surface-200 dark:border-surface-700',
            'bg-surface-50 dark:bg-surface-800',
            'shadow-soft dark:shadow-dark-soft',
            'transition-all duration-300 ease-smooth',
            'hover:border-surface-300 dark:hover:border-surface-600',
            'hover:shadow-medium dark:hover:shadow-dark-medium',
            className
          )}
        >
          {/* Main card content */}
          <div className="flex h-16 w-16 items-center justify-center bg-gradient-to-br from-surface-100/80 via-surface-50/60 to-accent/10 dark:from-surface-700/80 dark:via-surface-800/60 dark:to-accent-light/10">
            <div className="flex flex-col items-center gap-1">
              <FileTextIcon className="h-5 w-5 text-ink-muted dark:text-ink-inverse-muted" />
              <span className="rounded-full border border-surface-200 dark:border-surface-600 bg-surface-0/80 dark:bg-surface-700/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-muted dark:text-ink-inverse-muted">
                {attachment.file.type === 'application/pdf' ? 'PDF' : 'TXT'}
              </span>
            </div>
          </div>

          {/* Remove button */}
          {onRemove && (
            <button
              onClick={() => onRemove(attachment.id)}
              className={cn(
                'absolute -right-1 -top-1',
                'flex h-5 w-5 items-center justify-center rounded-full',
                'border border-surface-200 dark:border-surface-600',
                'bg-surface-0/90 dark:bg-surface-800/90',
                'text-ink-muted dark:text-ink-inverse-muted',
                'opacity-0 group-hover:opacity-100',
                'transition-all duration-200',
                'hover:bg-red-50 dark:hover:bg-red-900/30',
                'hover:text-red-500 dark:hover:text-red-400'
              )}
              type="button"
              title="Remove attachment"
              aria-label={`Remove ${attachment.file.name}`}
            >
              <XIcon className="size-3" />
            </button>
          )}

          {/* Filename bar */}
          <div className="absolute bottom-0 left-0 right-0 truncate bg-surface-0/90 dark:bg-surface-800/90 backdrop-blur-sm px-2 py-1 text-[0.65rem] text-ink-muted dark:text-ink-inverse-muted">
            {attachment.file.name}
          </div>
        </motion.div>
      </HoverCardTrigger>

      {/* HoverCard Content - Preview */}
      <HoverCardContent className="w-[520px] p-0 overflow-hidden" align="start">
        {/* Header */}
        <div className="border-b border-surface-200 dark:border-surface-700 bg-gradient-to-r from-surface-0 via-surface-0 to-accent/5 dark:from-surface-800 dark:via-surface-800 dark:to-accent-light/5 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileTextIcon className="h-4 w-4 text-ink-muted dark:text-ink-inverse-muted" />
                <div className="truncate text-sm font-semibold text-ink dark:text-ink-inverse">{downloadName}</div>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted dark:text-ink-inverse-muted">
                <span className="font-mono">{attachment.file.type || 'text/plain'}</span>
                <span aria-hidden>•</span>
                <span>{formatFileSize(attachment.file.size)}</span>
                {isPastedText && (
                  <>
                    <span aria-hidden>•</span>
                    <span className="rounded-full border border-accent/30 dark:border-accent-light/30 bg-accent/10 dark:bg-accent-light/10 px-2 py-0.5 font-semibold uppercase tracking-[0.2em] text-accent dark:text-accent-light">
                      Large paste
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button asChild size="sm" variant="outline" className="gap-2 rounded-full">
                <a href={attachment.dataUrl} download={downloadName}>
                  <DownloadIcon className="h-4 w-4" />
                  Download
                </a>
              </Button>
              {onUpdate && (
                <Button
                  size="sm"
                  variant="default"
                  className="gap-2 rounded-full"
                  onClick={openEdit}
                  type="button"
                >
                  <FileTextIcon className="h-4 w-4" />
                  Edit
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Preview content */}
        <div className="p-3">
          <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-850 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-ink-muted dark:text-ink-inverse-muted">
              <FileTextIcon className="h-3.5 w-3.5" />
              Preview
            </div>
            
            {attachment.file.type === 'application/pdf' ? (
                <iframe 
                    src={attachment.dataUrl} 
                    className="w-full h-[300px] rounded-lg border border-surface-200 dark:border-surface-700 bg-white"
                    title="PDF Preview"
                />
            ) : (
                <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-100 dark:bg-surface-800 p-3 font-mono text-[12px] leading-relaxed text-ink dark:text-ink-inverse scrollbar-thin">
                  {previewText ?? 'Preview unavailable.'}
                </pre>
            )}
          </div>
        </div>
      </HoverCardContent>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit attachment</DialogTitle>
            <DialogDescription>
              Changes apply to the attachment that will be sent with your next message.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-ink dark:text-ink-inverse">{downloadName}</div>

            {/* Find/Replace section */}
            <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-850 p-3">
              <div className="grid gap-2">
                {/* Find row */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative flex-1">
                    <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted dark:text-ink-inverse-muted" />
                    <Input
                      value={findQuery}
                      onChange={(e) => setFindQuery(e.target.value)}
                      onFocus={(e) => {
                        editFieldFocusRef.current = e.currentTarget
                      }}
                      placeholder="Find in document…"
                      className="pl-9"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          if (e.shiftKey) goPrev()
                          else goNext()
                        }
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2 sm:justify-end">
                    <div className="text-xs text-ink-muted dark:text-ink-inverse-muted tabular-nums">
                      {matches.length > 0 && findQuery
                        ? `${Math.min(activeMatchIdx + 1, matches.length)}/${matches.length}`
                        : `0/0`}
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={goFirst}
                        disabled={!findQuery || matches.length === 0}
                        aria-label="First match"
                        title="First match"
                      >
                        <ChevronsLeftIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={goPrev}
                        disabled={!findQuery || matches.length === 0}
                        aria-label="Previous match"
                        title="Previous match"
                      >
                        <ChevronLeftIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={goNext}
                        disabled={!findQuery || matches.length === 0}
                        aria-label="Next match"
                        title="Next match"
                      >
                        <ChevronRightIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={goLast}
                        disabled={!findQuery || matches.length === 0}
                        aria-label="Last match"
                        title="Last match"
                      >
                        <ChevronsRightIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Replace row */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    value={replaceQuery}
                    onChange={(e) => setReplaceQuery(e.target.value)}
                    onFocus={(e) => {
                      editFieldFocusRef.current = e.currentTarget
                    }}
                    placeholder="Replace with…"
                    className="flex-1"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={replaceCurrent}
                      disabled={!findQuery || matches.length === 0}
                    >
                      Replace
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={replaceAll}
                      disabled={!findQuery || matches.length === 0}
                    >
                      Replace all
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Textarea editor */}
            <Textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              className="h-[220px] w-full max-h-[220px] overflow-y-auto overflow-x-hidden whitespace-pre-wrap font-mono text-[13px] leading-relaxed"
              placeholder="Enter file contents..."
              ref={editTextareaRef}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} type="button">
              Cancel
            </Button>
            <Button onClick={saveEdit} type="button" disabled={!onUpdate}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </HoverCard>
  )
}
