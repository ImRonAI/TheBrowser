import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon, SearchIcon, TextQuoteIcon } from 'lucide-react'
import {
  Attachment, AttachmentHoverCard, AttachmentHoverCardContent, AttachmentHoverCardTrigger, AttachmentRemove, Attachments,
  type AttachmentData,
} from '@/components/ai-elements/attachments'
import {
  Artifact, ArtifactAction, ArtifactActions, ArtifactClose, ArtifactContent, ArtifactDescription, ArtifactHeader, ArtifactTitle,
} from '@/components/ai-elements/artifact'
import { WebPreview, WebPreviewBody, WebPreviewNavigation, WebPreviewUrl } from '@/components/ai-elements/web-preview'
import { Button } from '@/components/ui/button'
import {
  ATTACHMENT_FRAME, ATTACHMENT_HOST, attachmentMeta, attachmentStats, buildAttachmentDocument, contextAttachment, EDITOR_PALETTES,
  findTextMatches, wrapMatchIndex, type PromptAttachment,
} from '@/lib/prompt-attachments'
import { cn } from '@/utils/cn'
import { contextIcon } from './ContextPicker'
import type { ComposerAttachmentsState } from './useComposerAttachments'

/**
 * Prompt attachments as cards: a long paste or a picked context item in the composer, and the same card on a sent
 * message. Hovering (or clicking, which pins it) opens an editor: search with match navigation and an editable
 * text (read-only once sent). Ported from the v0-clone-blurple composer (`pasted-prompt-attachment.tsx`) on the
 * same AI Elements parts (Attachment hover card, Artifact, WebPreview).
 *
 * The hover card renders in place (Ren's `HoverCardContent` has no portal) and keeps to the panel's section, so
 * it never counts as browser chrome over the page (`BrowserLayout` skips overlays inside `section[aria-label]`).
 * Its buttons use `title`, not Radix tooltips, for the same reason: those portal to the body.
 */

const NUMBER = new Intl.NumberFormat('en-US')

/** The editor's colours follow `.dark` on <html> (Light, Dark, and Glass with the system appearance). */
function useEditorPalette() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setDark(root.classList.contains('dark')))
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return EDITOR_PALETTES[dark ? 'dark' : 'light']
}

/** The square at the start of a card: the volt mark of a paste, a tab's favicon, or the context kind's icon. */
function AttachmentTile({ attachment, favicon, dot, size = 'md' }: { attachment: PromptAttachment; favicon?: string; dot?: string; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-9 rounded-[11px]' : 'size-8 rounded-[10px]'
  if (attachment.kind === 'pasted') {
    return <span aria-hidden className={cn(box, 'relative flex shrink-0 items-center justify-center overflow-hidden text-white',
      'bg-[linear-gradient(140deg,#8D98FE_0%,#5543FF_48%,#3429A7_100%)] shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_8px_16px_-8px_rgb(85_67_255/0.8)]')}>
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgb(255_255_255/0.35),transparent_55%)]" />
      <TextQuoteIcon className="relative size-4" strokeWidth={2.25} />
    </span>
  }
  const Icon = contextIcon(attachment.kind)
  return <span aria-hidden className={cn(box, 'relative flex shrink-0 items-center justify-center',
    'bg-surface-100 text-ink-secondary ring-1 ring-inset ring-black/[0.06] dark:bg-white/[0.07] dark:text-ink-inverse-secondary dark:ring-white/[0.08]')}>
    {favicon ? <img src={favicon} alt="" className="size-4 rounded-[3px]" /> : <Icon className="size-4" />}
    {dot && <span className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface-0 dark:ring-[#141416]', dot)} />}
  </span>
}

export interface AttachmentEditorProps {
  attachment: PromptAttachment
  editable: boolean
  onTextChange?: (text: string) => void
  onClose: () => void
  favicon?: string
  dot?: string
  /** A paste longer than one attachment carries: its full length. */
  clippedFrom?: number
}

/** The hover editor: header (name, size, copy, close), search with match navigation, then the sandboxed text editor. */
export function AttachmentEditor({ attachment, editable, onTextChange, onClose, favicon, dot, clippedFrom }: AttachmentEditorProps) {
  const { id, title, text } = attachment
  const palette = useEditorPalette()
  const [initialText] = useState(text)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [seek, setSeek] = useState(0)
  const [copied, setCopied] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const focusMatch = useRef(false)
  // The document is built once from the opening text: edits stay in the frame, so it never reloads mid-edit.
  const srcDoc = useMemo(() => buildAttachmentDocument(initialText, id, { editable, label: title, palette }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialText, id, editable, palette])
  const matches = useMemo(() => findTextMatches(text, query), [text, query])
  const safeIndex = wrapMatchIndex(activeIndex, matches.length)
  const highlight = useRef({ ranges: matches, activeIndex: safeIndex })
  const stats = attachmentStats(text)

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as { source?: string; id?: string; type?: string; text?: string } | null
      if (!data || data.source !== ATTACHMENT_FRAME || data.id !== id) return
      if (data.type === 'edit' && editable && typeof data.text === 'string') onTextChange?.(data.text)
      if (data.type === 'close') onClose()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [id, editable, onClose, onTextChange])

  const post = useCallback((focus: boolean) => {
    const current = highlight.current
    iframeRef.current?.contentWindow?.postMessage({ source: ATTACHMENT_HOST, id, type: 'highlight', focus,
      ranges: current.ranges, activeIndex: current.activeIndex }, '*')
  }, [id])

  useEffect(() => {
    highlight.current = { ranges: matches, activeIndex: safeIndex }
    const focus = focusMatch.current
    focusMatch.current = false
    post(focus)
  }, [matches, safeIndex, seek, post])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1400)
    return () => clearTimeout(timer)
  }, [copied])

  const moveMatch = (delta: number) => {
    if (!matches.length) return
    focusMatch.current = true
    setActiveIndex((index) => wrapMatchIndex(index + delta, matches.length))
    setSeek((value) => value + 1)
  }
  const status = query.trim() ? matches.length ? `${safeIndex + 1} / ${matches.length}` : 'No matches' : 'Find'

  return <Artifact aria-label={`Preview of ${title}`} data-testid="prompt-attachment-preview"
    className={cn('relative flex h-[18rem] w-[min(25rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl',
      'border border-black/[0.08] bg-white/[0.93] text-ink shadow-[0_32px_80px_-30px_rgb(11_12_23/0.5),inset_0_1px_0_rgb(255_255_255/0.8)] backdrop-blur-2xl backdrop-saturate-150',
      'dark:border-white/[0.09] dark:bg-[#111113]/[0.93] dark:text-ink-inverse dark:shadow-[0_32px_80px_-24px_rgb(0_0_0/0.9),inset_0_1px_0_rgb(255_255_255/0.06)]')}>
    <div aria-hidden className="pointer-events-none absolute inset-x-12 top-0 z-10 h-px bg-gradient-to-r from-transparent via-blurple-500/80 to-transparent dark:via-blurple-300/70" />
    <ArtifactHeader className="gap-3 border-b border-black/[0.06] bg-transparent px-3 py-2.5 dark:border-white/[0.07]">
      <div className="flex min-w-0 items-center gap-2.5">
        <AttachmentTile attachment={attachment} favicon={favicon} dot={dot} size="lg" />
        <div className="min-w-0">
          <ArtifactTitle className="truncate font-display text-[14px] font-bold leading-tight tracking-[-0.015em] text-ink dark:text-ink-inverse">{title}</ArtifactTitle>
          <ArtifactDescription className="mt-0.5 truncate text-[11px] tabular-nums tracking-[0.01em] text-ink-muted dark:text-ink-inverse-muted">
            {NUMBER.format(stats.characters)} chars · {NUMBER.format(stats.lines)} lines · {NUMBER.format(stats.words)} words
            {clippedFrom ? ` · clipped from ${NUMBER.format(clippedFrom)}` : ''}
          </ArtifactDescription>
        </div>
      </div>
      <ArtifactActions className="gap-0.5">
        <ArtifactAction icon={copied ? CheckIcon : CopyIcon} label={copied ? 'Copied' : 'Copy text'} title={copied ? 'Copied' : 'Copy text'}
          className={cn('rounded-full', copied && 'text-emerald-600 hover:text-emerald-600 dark:text-emerald-400')}
          onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true)) }} />
        <ArtifactClose onClick={onClose} title="Close" className="rounded-full" />
      </ArtifactActions>
    </ArtifactHeader>
    <ArtifactContent className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent p-0">
      <WebPreview className="min-h-0 flex-1 rounded-none border-0 bg-transparent" defaultUrl="">
        <WebPreviewNavigation className="h-11 shrink-0 gap-1.5 border-black/[0.06] bg-surface-50/70 px-2.5 dark:border-white/[0.06] dark:bg-white/[0.025]">
          <div className="relative min-w-0 flex-1">
            <SearchIcon aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted dark:text-ink-inverse-muted" />
            <WebPreviewUrl aria-label={`Search ${title}`} autoComplete="off" spellCheck={false} value={query}
              placeholder={editable ? 'Search or edit below…' : 'Search this attachment…'}
              className="h-8 w-full rounded-full border-black/[0.08] bg-white pl-8 pr-3 text-[12.5px] shadow-[inset_0_1px_2px_rgb(11_12_23/0.06)] placeholder:text-ink-muted/80 focus-visible:border-blurple-400 focus-visible:ring-2 focus-visible:ring-blurple-500/20 dark:border-white/[0.08] dark:bg-white/[0.05] dark:placeholder:text-ink-inverse-muted/80"
              onChange={(event) => { setQuery(event.currentTarget.value); setActiveIndex(0) }}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key === 'Enter') { event.preventDefault(); moveMatch(event.shiftKey ? -1 : 1) }
                if (event.key === 'Escape') { event.preventDefault(); onClose() }
              }} />
          </div>
          <span aria-live="polite" className={cn('shrink-0 rounded-full px-2 py-1 text-[10.5px] font-medium tabular-nums tracking-[0.02em]',
            query.trim() && !matches.length ? 'bg-rose-500/10 text-rose-600 dark:text-rose-300'
              : query.trim() ? 'bg-blurple-500/10 text-blurple-700 dark:bg-blurple-400/15 dark:text-blurple-200'
                : 'bg-black/[0.04] text-ink-muted dark:bg-white/[0.06] dark:text-ink-inverse-muted')}>{status}</span>
          <Button type="button" variant="ghost" size="sm" disabled={!matches.length} onClick={() => moveMatch(-1)}
            aria-label="Previous match" title="Previous match (⇧↵)" className="size-8 rounded-full p-0 text-ink-secondary hover:text-ink dark:text-ink-inverse-secondary dark:hover:text-ink-inverse">
            <ChevronUpIcon className="size-4" /></Button>
          <Button type="button" variant="ghost" size="sm" disabled={!matches.length} onClick={() => moveMatch(1)}
            aria-label="Next match" title="Next match (↵)" className="size-8 rounded-full p-0 text-ink-secondary hover:text-ink dark:text-ink-inverse-secondary dark:hover:text-ink-inverse">
            <ChevronDownIcon className="size-4" /></Button>
        </WebPreviewNavigation>
        <WebPreviewBody ref={iframeRef} title={title} src="about:blank" srcDoc={srcDoc} sandbox="allow-scripts"
          onLoad={() => post(false)} className="min-h-0 bg-transparent" style={{ colorScheme: palette.scheme }} />
      </WebPreview>
    </ArtifactContent>
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-black/[0.06] px-3 py-1.5 text-[10.5px] text-ink-muted dark:border-white/[0.07] dark:text-ink-inverse-muted">
      <span className="truncate">{editable ? 'Edits go with your message' : 'Sent · read only'}</span>
      <span className="shrink-0"><kbd className="font-sans">↵</kbd> next match · <kbd className="font-sans">Esc</kbd> close</span>
    </div>
  </Artifact>
}

/** The preview's frame while a context item's text is read for the first time. */
function AttachmentEditorLoading({ attachment, favicon, dot }: { attachment: PromptAttachment; favicon?: string; dot?: string }) {
  return <div role="status" aria-label={`Reading ${attachment.title}`}
    className="flex h-[18rem] w-[min(25rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-black/[0.08] bg-white/[0.93] shadow-[0_32px_80px_-30px_rgb(11_12_23/0.5)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-[#111113]/[0.93]">
    <div className="flex items-center gap-2.5 border-b border-black/[0.06] px-3 py-2.5 dark:border-white/[0.07]">
      <AttachmentTile attachment={attachment} favicon={favicon} dot={dot} size="lg" />
      <div className="min-w-0">
        <p className="truncate font-display text-[14px] font-bold tracking-[-0.015em] text-ink dark:text-ink-inverse">{attachment.title}</p>
        <p className="mt-0.5 text-[11px] text-ink-muted dark:text-ink-inverse-muted">Reading…</p>
      </div>
    </div>
    <div className="space-y-2.5 p-4">
      {[92, 78, 85, 64, 88, 40].map((width, index) => <div key={index} className="h-2.5 animate-pulse rounded-full bg-black/[0.06] dark:bg-white/[0.07]" style={{ width: `${width}%` }} />)}
    </div>
  </div>
}

export interface PromptAttachmentCardProps {
  attachment: PromptAttachment
  /** In the composer: removable and editable. On a sent message: read only. */
  editable: boolean
  onRemove?: () => void
  onTextChange?: (text: string) => void
  /** Called each time the preview opens (a context item reads its text then). */
  onOpen?: () => void
  /** A context item's text is still being read for the first time. */
  loading?: boolean
  /** Changes when a re-read brings new text: the open editor restarts with it. */
  version?: number
  /** The title model is still naming a paste. */
  naming?: boolean
  edited?: boolean
  clippedFrom?: number
  favicon?: string
  /** A context item's status colour (Tailwind background class). */
  dot?: string
  align?: 'start' | 'end'
}

/** One attachment card with its hover editor (hover opens it; a click pins it until Close, Esc or a click outside). */
export function PromptAttachmentCard({ attachment, editable, onRemove, onTextChange, onOpen, loading, version = 0, naming, edited, clippedFrom, favicon, dot, align = 'start' }: PromptAttachmentCardProps) {
  const [open, setOpen] = useState(false)
  const shown = useRef(false)
  const pinned = useRef(false)
  const pointerInside = useRef(false)
  const focusInside = useRef(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // The preview stays inside the panel section it was opened from (see the file comment).
  const [boundary, setBoundary] = useState<Element | null>(null)
  const trigger = useCallback((node: HTMLElement | null) => {
    triggerRef.current = node
    setBoundary(node?.closest('section[aria-label]') ?? null)
  }, [])

  const show = (next: boolean) => {
    if (next && !shown.current) onOpen?.()
    shown.current = next
    setOpen(next)
  }
  const dismiss = useCallback(() => {
    pinned.current = false
    pointerInside.current = false
    focusInside.current = false
    shown.current = false
    setOpen(false)
  }, [])
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (triggerRef.current?.contains(target) || contentRef.current?.contains(target))) return
      dismiss()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, dismiss])

  const data: AttachmentData = useMemo(() => ({ id: attachment.id, type: 'file', mediaType: attachment.kind === 'tab' ? 'text/html' : 'text/plain',
    filename: attachment.title, url: attachment.url ?? '' }), [attachment.id, attachment.kind, attachment.title, attachment.url])
  const meta = attachmentMeta(attachment)
  const pin = () => { pinned.current = true; show(true) }

  return <AttachmentHoverCard open={open} openDelay={150} closeDelay={300} onOpenChange={(next) => {
    if (next) { show(true); return }
    if (pinned.current || pointerInside.current || focusInside.current) return
    show(false)
  }}>
    <AttachmentHoverCardTrigger asChild ref={trigger}>
      <Attachment data={data} onRemove={onRemove} data-testid="prompt-attachment" data-kind={attachment.kind}
        role="button" tabIndex={0} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${attachment.title}, ${meta}. Open to ${editable ? 'search and edit' : 'search'}.`}
        onClick={pin}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pin() }
          if (event.key === 'Escape' && open) { event.preventDefault(); dismiss() }
          if ((event.key === 'Backspace' || event.key === 'Delete') && onRemove) { event.preventDefault(); onRemove() }
        }}
        onPointerEnter={() => { pointerInside.current = true }}
        onPointerLeave={() => { pointerInside.current = false }}
        className={cn('group/att relative h-auto w-max max-w-[17rem] cursor-pointer items-center gap-2.5 rounded-[14px] py-1.5 pl-1.5 pr-3 text-left font-normal',
          'border border-black/[0.07] bg-white/75 shadow-[inset_0_1px_0_rgb(255_255_255/0.75),0_10px_26px_-20px_rgb(11_12_23/0.55)] backdrop-blur-md',
          'transition-[border-color,box-shadow,transform,background-color] duration-200 ease-out hover:-translate-y-px hover:border-blurple-300 hover:bg-white/90 hover:text-ink',
          'hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.75),0_16px_34px_-18px_rgb(85_67_255/0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple-500/40',
          'dark:border-white/[0.09] dark:bg-white/[0.05] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.05),0_12px_30px_-18px_rgb(0_0_0/0.85)]',
          'dark:hover:border-blurple-400/45 dark:hover:bg-white/[0.08] dark:hover:text-ink-inverse',
          open && 'border-blurple-300 dark:border-blurple-400/45')}>
        <AttachmentTile attachment={attachment} favicon={favicon} dot={dot} />
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[12.5px] font-semibold leading-tight tracking-[-0.01em] text-ink dark:text-ink-inverse',
            naming && 'animate-pulse')}>{attachment.title}</span>
          <span className="mt-[3px] flex items-center gap-1.5 text-[10.5px] leading-none tabular-nums text-ink-muted dark:text-ink-inverse-muted">
            <span className="truncate">{naming ? 'Naming…' : meta}</span>
            {edited && <span className="shrink-0 rounded-full bg-blurple-500/10 px-1.5 py-[2px] text-[9px] font-bold uppercase tracking-[0.08em] text-blurple-700 dark:bg-blurple-400/15 dark:text-blurple-200">Edited</span>}
            {clippedFrom ? <span title={`Clipped from ${NUMBER.format(clippedFrom)} characters`} className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-[2px] text-[9px] font-bold uppercase tracking-[0.08em] text-amber-800 dark:text-amber-300">Clipped</span> : null}
          </span>
        </span>
        {onRemove && <AttachmentRemove label={`Remove ${attachment.title}`} title="Remove"
          className={cn('absolute -right-1.5 -top-1.5 size-5 rounded-full p-0 opacity-0 shadow-sm transition-opacity duration-150',
            'bg-ink text-white ring-2 ring-white hover:bg-ink hover:text-white group-hover/att:opacity-100 focus-visible:opacity-100',
            'dark:bg-ink-inverse dark:text-ink dark:ring-[#141416] dark:hover:bg-ink-inverse dark:hover:text-ink [&_svg]:size-3')} />}
      </Attachment>
    </AttachmentHoverCardTrigger>
    <AttachmentHoverCardContent ref={contentRef} side="top" sideOffset={10} align={align} collisionPadding={8}
      collisionBoundary={boundary ?? undefined}
      className="w-auto border-0 bg-transparent p-0 shadow-none outline-none"
      onFocusCapture={() => { focusInside.current = true; pinned.current = true; show(true) }}
      onPointerDown={() => { pinned.current = true }}
      onPointerEnter={() => { pointerInside.current = true }}
      onPointerLeave={() => { pointerInside.current = false }}>
      {open ? loading
        ? <AttachmentEditorLoading attachment={attachment} favicon={favicon} dot={dot} />
        : <AttachmentEditor key={version} attachment={attachment} editable={editable} onTextChange={onTextChange} onClose={dismiss}
            favicon={favicon} dot={dot} clippedFrom={clippedFrom} />
        : null}
    </AttachmentHoverCardContent>
  </AttachmentHoverCard>
}

/** The composer's attachments: pastes first (editable, removable), then the picked context items. */
export function ComposerAttachmentTray({ attachments, className }: { attachments: ComposerAttachmentsState; className?: string }) {
  const { pasted, contexts, previews, edits, naming, notice } = attachments
  if (!pasted.length && !contexts.length && !notice) return null
  return <div className={className}>
    {(pasted.length > 0 || contexts.length > 0) && <Attachments variant="inline" aria-label="Attachments" className="gap-2">
      {pasted.map((item) => <PromptAttachmentCard key={item.id} attachment={item} editable naming={naming.has(item.id)} clippedFrom={item.clippedFrom}
        onRemove={() => attachments.removePasted(item.id)} onTextChange={(text) => attachments.editPasted(item.id, text)} />)}
      {contexts.map((item) => {
        const preview = previews[item.id]
        const edited = edits[item.id]
        return <PromptAttachmentCard key={item.id} editable version={preview?.version}
          attachment={contextAttachment({ ...item, url: item.type === 'tab' ? item.url : undefined }, edited ?? preview?.text ?? '')}
          favicon={item.favicon} dot={item.color?.startsWith('bg-') ? item.color : undefined} edited={edited !== undefined}
          loading={edited === undefined && preview === undefined} onOpen={() => attachments.loadPreview(item)}
          onRemove={() => attachments.removeContext(item.id)} onTextChange={(text) => attachments.editContext(item.id, text)} />
      })}
    </Attachments>}
    {notice && <p role="status" className="mt-1.5 text-[11.5px] font-medium text-amber-800 dark:text-amber-300">{notice}</p>}
  </div>
}

/** The attachments a sent message carried, above its bubble. Read only: search and copy still work. */
export function SentAttachments({ attachments }: { attachments: PromptAttachment[] }) {
  if (!attachments.length) return null
  return <Attachments variant="inline" aria-label="Attachments" className="w-full justify-end gap-2">
    {attachments.map((attachment) => <PromptAttachmentCard key={attachment.id} attachment={attachment} editable={false} align="end" />)}
  </Attachments>
}
