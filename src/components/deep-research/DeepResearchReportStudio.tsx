/**
 * DeepResearchReportStudio — the right-hand studio pane of the Deep Research workbench.
 *
 * Three studio views (a build outcome's run shows what OpenCode built, `DeepResearchApplication`, in the report's
 * place, and has no deck):
 * - **PDF Report**: Embedded scholarly PDF viewer (`/deep-research/runs/{id}/artifacts/report.pdf`)
 *   when ready, with live streaming Markdown fallback (and PDF / Markdown toggle), **Download PDF**,
 *   **Copy Markdown**, and **Save to Context** (`POST /context/items`).
 * - **Slidev Deck**: Embedded interactive Slidev presentation (`/deep-research/runs/{id}/artifacts/slides/index.html`)
 *   or deck PDF fallback, streaming Slidev outline preview, **Open Fullscreen Tab**,
 *   **Download Slidev `.md`**, and **Download Deck PDF**.
 * - **Formation Trace**: Chronological expandable trace of every nested formation node, Swarm
 *   `handoff_to_agent` and built-in `subagent` run, with its tool calls. The report's sources are
 *   its own reference list.
 *
 * Uses Inter (`font-sans`) and `useElementWidth` for container-driven responsiveness across Light, Dark, and Glass themes.
 */
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import {
  Activity,
  ArrowLeftRight,
  BookmarkCheck,
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FilePen,
  FileText,
  Layers,
  Loader2,
  Maximize2,
  Presentation,
  Wrench,
} from 'lucide-react'
import { MARKDOWN_COMPONENTS, MessageResponse } from '@/components/ai-elements/response'
import { RenMark } from '@/components/brand'
import { useElementWidth } from '@/hooks/useElementWidth'
import { API_BASE_URL } from '@/lib/api-base'
import { createContextClient } from '@/lib/context-api'
import { documentsLibraryUrl } from '@/lib/project-documents'
import { openInternalUrl } from '@/components/board/task-detail/editor/extensions/blocks/workspace'
import { useDeepResearchStore } from '@/stores/deepResearchStore'
import {
  humanizeIdentifier,
  researchUrl,
  resolveResearchArtifactUrl,
  type DeepResearchSkillExecution,
  type DeepResearchSnapshot,
  type DeepResearchTraceEntry,
} from '@/lib/deep-research-api'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { cn } from '@/utils/cn'
import { DeepResearchApplication } from './DeepResearchApplication'
import { builtOutcome } from './DeepResearchHero'
import { openSourceInNewTab } from './openSource'

export type ResearchStudioTab = 'report' | 'deck' | 'trace'
type TraceFilter = 'all' | DeepResearchTraceEntry['kind']

const REPORT_PROSE = [
  'prose prose-sm dark:prose-invert max-w-none font-sans',
  'text-[15px] leading-[1.75] text-ink dark:text-ink-inverse',
  '[&_p]:font-sans [&_p]:text-[15px] [&_p]:leading-[1.75] [&_p]:text-ink dark:[&_p]:text-ink-inverse',
  '[&_h1]:font-display [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-[-0.025em]',
  '[&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-[-0.02em] [&_h2]:mt-7',
  '[&_h3]:font-display [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:tracking-[-0.015em] [&_h3]:mt-5',
  '[&_li]:my-1 marker:text-blurple-600 dark:marker:text-blurple-400',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-blurple-500 [&_blockquote]:pl-4 [&_blockquote]:text-ink-secondary dark:[&_blockquote]:border-blurple-400 dark:[&_blockquote]:text-ink-inverse-secondary',
].join(' ')

const REPORT_MARKDOWN_COMPONENTS: NonNullable<ComponentProps<typeof MessageResponse>['components']> = {
  ...MARKDOWN_COMPONENTS,
  a: ({ href, children, className, ...props }) => (
    <a
      {...props}
      href={href}
      onClick={(e) => {
        if (href && /^https?:\/\//i.test(href)) {
          e.preventDefault()
          openSourceInNewTab(href)
        }
      }}
      className={cn(
        'cursor-pointer font-medium text-volt underline decoration-blurple-600/35 decoration-2 underline-offset-[3px] transition-colors hover:decoration-blurple-600 dark:decoration-blurple-400/35 dark:hover:decoration-blurple-400',
        className,
      )}
    >
      {children}
    </a>
  ),
}

function slugifyFilename(title: string, fallback: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return slug || fallback
}

function triggerUrlDownload(url: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

function triggerTextDownload(content: string, filename: string, mimeType = 'text/markdown;charset=utf-8'): void {
  const blob = new Blob([content], { type: mimeType })
  const blobUrl = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = blobUrl
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1500)
  }
}

interface ParsedSlide {
  index: number
  title: string
  body: string
}

/** Split Slidev `.md` source into individual slide cards while stripping frontmatter blocks. */
function parseSlidevDeckOutline(markdown: string): ParsedSlide[] {
  const trimmed = markdown.trim()
  if (!trimmed) return []
  const rawChunks = trimmed.split(/\r?\n---\r?\n/g)
  const slides: ParsedSlide[] = []
  for (const chunk of rawChunks) {
    const text = chunk.trim()
    if (!text) continue
    const lines = text.split(/\r?\n/)
    const looksLikeFrontmatterOnly =
      lines.every((line) => !line.trim() || /^[a-zA-Z0-9_-]+\s*:/.test(line.trim())) &&
      !lines.some((line) => line.trim().startsWith('#'))
    if (looksLikeFrontmatterOnly) continue

    const headingLine = lines.find((line) => /^#{1,3}\s+/.test(line.trim()))
    const title = headingLine
      ? headingLine.trim().replace(/^#{1,3}\s+/, '').trim()
      : `Slide ${slides.length + 1}`
    const body = headingLine
      ? lines
          .filter((line) => line !== headingLine && !/^[a-zA-Z0-9_-]+\s*:/.test(line.trim()))
          .join('\n')
          .trim()
      : text
    slides.push({ index: slides.length + 1, title, body })
  }
  return slides
}

function buildContextExportMarkdown(snapshot: DeepResearchSnapshot): string {
  return snapshot.report_markdown.trim()
}

function TraceRow({
  entry,
  skillLookup,
}: {
  entry: DeepResearchTraceEntry
  skillLookup: Map<string, DeepResearchSkillExecution>
}) {
  const [open, setOpen] = useState(false)
  const linkedSkill = entry.skill_id ? skillLookup.get(entry.skill_id) : undefined
  const richBody = linkedSkill?.output_text || linkedSkill?.summary || entry.detail
  const expandable = Boolean(richBody && richBody.length > 100) || Boolean(linkedSkill?.tools.length)

  const badgeStyles =
    entry.kind === 'skill'
      ? 'bg-blurple-600/10 text-volt dark:bg-blurple-400/15'
      : entry.kind === 'handoff'
        ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
        : 'bg-surface-100 text-ink-secondary dark:bg-surface-800 dark:text-ink-inverse-secondary'

  const Icon =
    entry.kind === 'skill'
      ? Layers
      : entry.kind === 'handoff'
        ? ArrowLeftRight
        : Activity

  return (
    <div className="rounded-xl border border-surface-200 bg-surface-0 p-3 font-sans dark:border-surface-800 dark:bg-surface-850">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          disabled={!expandable}
          onClick={() => setOpen((prev) => !prev)}
          className="flex min-w-0 flex-1 items-start gap-2.5 text-left disabled:cursor-default"
        >
          <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md', badgeStyles)}>
            <Icon className="h-3 w-3" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-sans text-[11px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">
                #{entry.sequence}
              </span>
              <span className="truncate font-sans text-[12.5px] font-semibold text-ink dark:text-ink-inverse">
                {entry.title}
              </span>
              <span
                className={cn(
                  'rounded-full px-2 py-px font-sans text-[10.5px] font-medium',
                  entry.status === 'running' || entry.status === 'executing'
                    ? 'bg-blurple-600/10 text-volt dark:bg-blurple-400/15'
                    : entry.status === 'failed'
                      ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                      : 'bg-surface-100 text-ink-muted dark:bg-surface-800 dark:text-ink-inverse-muted',
                )}
              >
                {entry.status}
              </span>
            </div>

            {entry.node_path.length > 0 && (
              <p className="mt-0.5 truncate font-sans text-[11px] text-ink-muted dark:text-ink-inverse-muted">
                {entry.node_path.map(humanizeIdentifier).join(' › ')}
              </p>
            )}
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          {expandable && (
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              aria-expanded={open}
              aria-label={open ? 'Collapse trace entry' : 'Expand trace entry'}
              className="rounded p-1 text-ink-muted hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-surface-800 dark:hover:text-ink-inverse"
            >
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {entry.detail && !open && (
        <p className="mt-1.5 line-clamp-2 pl-7 font-sans text-[12px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
          {entry.detail}
        </p>
      )}

      {open && (
        <div className="mt-2.5 border-t border-surface-200/80 pt-2.5 pl-7 dark:border-surface-800">
          {linkedSkill?.task && (
            <div className="mb-2">
              <span className="font-sans text-[11px] font-medium text-ink-muted dark:text-ink-inverse-muted">
                Subagent brief
              </span>
              <p className="mt-0.5 font-sans text-[12px] text-ink dark:text-ink-inverse">{linkedSkill.task}</p>
            </div>
          )}

          {linkedSkill && linkedSkill.tools.length > 0 && (
            <div className="mb-2 space-y-1">
              <span className="font-sans text-[11px] font-medium text-ink-muted dark:text-ink-inverse-muted">
                Leaf research tools ({linkedSkill.tools.length})
              </span>
              <div className="flex flex-wrap gap-1.5">
                {linkedSkill.tools.map((t) => (
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-1 rounded-md border border-surface-200 bg-surface-50 px-2 py-0.5 font-sans text-[11px] text-ink-secondary dark:border-surface-700 dark:bg-surface-900 dark:text-ink-inverse-secondary"
                  >
                    <Wrench className="h-2.5 w-2.5 text-volt" aria-hidden />
                    <strong className="font-medium">{t.tool_name}</strong>
                    {t.input_preview && <span className="max-w-[220px] truncate">· {t.input_preview}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          {richBody && (
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-50 p-2.5 font-mono text-[11px] leading-relaxed text-ink-secondary scrollbar-thin dark:bg-surface-900 dark:text-ink-inverse-secondary">
              {richBody}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export interface DeepResearchReportStudioProps {
  snapshot: DeepResearchSnapshot
  userId: string
}

export function DeepResearchReportStudio({ snapshot, userId }: DeepResearchReportStudioProps) {
  const studioRef = useRef<HTMLElement>(null)
  const studioWidth = useElementWidth(studioRef)
  const compact = studioWidth > 0 && studioWidth < 620
  const twoColSources = studioWidth === 0 || studioWidth >= 680

  const [activeTab, setActiveTab] = useState<ResearchStudioTab>('report')
  // A build outcome's run shows what OpenCode built where a report's run shows its report, and has no deck.
  const made = builtOutcome(snapshot.outcome)
  const tab = made && activeTab === 'deck' ? 'report' : activeTab
  const [reportFormat, setReportFormat] = useState<'pdf' | 'markdown'>('pdf')
  const [deckFormat, setDeckFormat] = useState<'interactive' | 'markdown'>('interactive')
  const [traceFilter, setTraceFilter] = useState<TraceFilter>('all')
  const [copied, setCopied] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const saveReportAsDocument = useDeepResearchStore((state) => state.saveReportAsDocument)
  const [documentState, setDocumentState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [documentError, setDocumentError] = useState('')

  const reportPdfUrl = useMemo(
    () => resolveResearchArtifactUrl(snapshot.artifacts?.report_pdf_url, userId),
    [snapshot.artifacts?.report_pdf_url, userId],
  )
  const reportPdfDownloadUrl = useMemo(
    () => resolveResearchArtifactUrl(snapshot.artifacts?.report_pdf_url, userId, { download: true }),
    [snapshot.artifacts?.report_pdf_url, userId],
  )
  const slidevPreviewUrl = useMemo(
    () => resolveResearchArtifactUrl(snapshot.artifacts?.slidev_preview_url, userId),
    [snapshot.artifacts?.slidev_preview_url, userId],
  )
  const slidevPdfUrl = useMemo(
    () => resolveResearchArtifactUrl(snapshot.artifacts?.slidev_pdf_url, userId),
    [snapshot.artifacts?.slidev_pdf_url, userId],
  )
  const slidevPdfDownloadUrl = useMemo(
    () => resolveResearchArtifactUrl(snapshot.artifacts?.slidev_pdf_url, userId, { download: true }),
    [snapshot.artifacts?.slidev_pdf_url, userId],
  )
  const slidevMarkdownUrl = useMemo(
    () => resolveResearchArtifactUrl(snapshot.artifacts?.slidev_markdown_url, userId, { download: true }),
    [snapshot.artifacts?.slidev_markdown_url, userId],
  )

  const parsedSlides = useMemo(
    () => parseSlidevDeckOutline(snapshot.slidev_markdown || ''),
    [snapshot.slidev_markdown],
  )

  const skillLookup = useMemo(() => {
    const map = new Map<string, DeepResearchSkillExecution>()
    for (const s of snapshot.skill_invocations) {
      map.set(s.id, s)
    }
    return map
  }, [snapshot.skill_invocations])

  const filteredTrace = useMemo(() => {
    if (traceFilter === 'all') return snapshot.trace
    return snapshot.trace.filter((entry) => entry.kind === traceFilter)
  }, [snapshot.trace, traceFilter])

  const hasReportText = Boolean(snapshot.report_markdown.trim())
  const hasSlidevText = Boolean(snapshot.slidev_markdown.trim())
  const hasDeckArtifact = Boolean(slidevPreviewUrl || slidevPdfUrl)
  const isStreamingReport = snapshot.active && hasReportText
  const baseFilename = slugifyFilename(snapshot.title || snapshot.query, `deep-research-${snapshot.session_id}`)

  const showPdfIframe = Boolean(reportPdfUrl) && (reportFormat === 'pdf' || !hasReportText)
  const deckEmbedUrl = slidevPreviewUrl || slidevPdfUrl
  const showDeckIframe = Boolean(deckEmbedUrl) && (deckFormat === 'interactive' || !hasSlidevText)

  // A finished run's report is kept as a Document under Deep Research, once.
  const reportReady = snapshot.status === 'completed' && hasReportText
  const saveDocument = () => {
    setDocumentState('saving')
    setDocumentError('')
    saveReportAsDocument(snapshot.session_id, userId)
      .then(() => setDocumentState('idle'))
      .catch((err: unknown) => {
        setDocumentState('error')
        setDocumentError(err instanceof Error ? err.message : 'Could not save the report as a Document')
      })
  }
  useEffect(() => {
    if (reportReady && !snapshot.document_id) saveDocument()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per finished run without a Document
  }, [reportReady, snapshot.document_id, snapshot.session_id])

  const handleCopyMarkdown = async () => {
    const text = buildContextExportMarkdown(snapshot)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable
    }
  }

  const handleSaveToContext = async () => {
    const markdown = buildContextExportMarkdown(snapshot)
    if (!markdown || saveState === 'saving') return
    setSaveState('saving')
    setSaveError('')
    try {
      const client = createContextClient(API_BASE_URL, userId || 'default')
      await client.add({
        kind: 'document',
        title: snapshot.title || snapshot.query || 'Squad report',
        text: markdown,
        url: researchUrl(snapshot.session_id),
      })
      void useContextAgentStore.getState().refreshItems()
      setSaveState('saved')
      window.setTimeout(() => setSaveState('idle'), 3000)
    } catch (err) {
      setSaveState('error')
      setSaveError(err instanceof Error ? err.message : 'Could not save to Context')
    }
  }

  const handleDownloadSlidevMd = () => {
    if (hasSlidevText) {
      triggerTextDownload(snapshot.slidev_markdown, `${baseFilename}-slides.md`)
      return
    }
    if (slidevMarkdownUrl) {
      triggerUrlDownload(slidevMarkdownUrl, `${baseFilename}-slides.md`)
    }
  }

  return (
    <section
      ref={studioRef}
      aria-label="Research studio"
      className="ron-glass-panel flex h-full min-h-0 flex-col bg-surface-0 font-sans text-ink dark:bg-surface-900 dark:text-ink-inverse"
    >
      {/* Studio Tab Header + Contextual Artifact Actions */}
      <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-surface-200 bg-surface-0 px-3.5 py-1.5 dark:border-surface-800 dark:bg-surface-900">
        <nav role="tablist" aria-label="Research studio views" className="flex min-w-0 flex-wrap items-center gap-1">
          {(
            [
              {
                id: 'report',
                label: made ? made.label : compact ? 'PDF' : 'PDF Report',
                icon: made ? made.icon : FileText,
                count: null,
                readyDot: Boolean(made ? snapshot.application : reportPdfUrl),
              },
              {
                id: 'deck',
                label: compact ? 'Slides' : 'Slidev Deck',
                icon: Presentation,
                count: parsedSlides.length > 0 ? parsedSlides.length : null,
                readyDot: hasDeckArtifact,
              },
              {
                id: 'trace',
                label: compact ? 'Trace' : 'Formation Trace',
                icon: Activity,
                count: snapshot.trace.length,
                readyDot: false,
              },
            ] as const
          ).filter(({ id }) => !made || id !== 'deck').map(({ id, label, icon: Icon, count, readyDot }) => {
            const selected = tab === id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(id)}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 font-sans text-[12.5px] font-medium transition-colors duration-150',
                  selected
                    ? 'bg-surface-100 font-semibold text-ink dark:bg-surface-800 dark:text-ink-inverse'
                    : 'text-ink-muted hover:bg-surface-50 hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-surface-850 dark:hover:text-ink-inverse',
                )}
              >
                <Icon className={cn('h-3.5 w-3.5', selected && 'text-volt')} aria-hidden />
                <span>{label}</span>
                {readyDot && !selected && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                )}
                {count !== null && count > 0 && (
                  <span className="rounded-full bg-surface-200/70 px-1.5 py-px font-sans text-[10.5px] font-medium tabular-nums text-ink-secondary dark:bg-surface-700/80 dark:text-ink-inverse-secondary">
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* Report Tab Actions */}
        {tab === 'report' && (reportPdfUrl || hasReportText) && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {reportPdfUrl && hasReportText && (
              <div
                role="group"
                aria-label="Report display mode"
                className="inline-flex items-center rounded-lg bg-surface-100 p-0.5 dark:bg-surface-800"
              >
                {(
                  [
                    ['pdf', 'PDF'],
                    ['markdown', 'Markdown'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setReportFormat(mode)}
                    className={cn(
                      'h-6 rounded-md px-2 font-sans text-[11px] font-medium transition-colors',
                      reportFormat === mode
                        ? 'bg-surface-0 text-ink shadow-sm dark:bg-surface-900 dark:text-ink-inverse'
                        : 'text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {reportReady && (
              <button
                type="button"
                disabled={documentState === 'saving'}
                onClick={() =>
                  snapshot.document_id ? openInternalUrl(documentsLibraryUrl(snapshot.document_id)) : saveDocument()
                }
                title={
                  documentState === 'error'
                    ? documentError
                    : snapshot.document_id
                      ? 'Open the report in Documents › Squad'
                      : 'Saving the report to Documents › Squad'
                }
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-blurple-600/35 bg-blurple-600/10 px-2.5 font-sans text-[11.5px] font-medium text-volt transition-colors hover:bg-blurple-600/15 disabled:opacity-60 dark:border-blurple-400/35 dark:bg-blurple-400/15 dark:hover:bg-blurple-400/25"
              >
                {documentState === 'saving' || (!snapshot.document_id && documentState === 'idle') ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <FilePen className="h-3.5 w-3.5" aria-hidden />
                )}
                <span>
                  {snapshot.document_id
                    ? compact ? 'Document' : 'Open Document'
                    : documentState === 'error'
                      ? 'Retry Document'
                      : 'Saving Document…'}
                </span>
              </button>
            )}

            {reportPdfDownloadUrl && (
              <button
                type="button"
                onClick={() => triggerUrlDownload(reportPdfDownloadUrl, `${baseFilename}-report.pdf`)}
                title="Download scholarly PDF report"
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-surface-200 bg-surface-0 px-2.5 font-sans text-[11.5px] font-medium text-ink-secondary transition-colors hover:bg-surface-50 hover:text-ink dark:border-surface-800 dark:bg-surface-850 dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse"
              >
                <Download className="h-3.5 w-3.5 text-volt" aria-hidden />
                {!compact && <span>Download PDF</span>}
              </button>
            )}

            {hasReportText && (
              <>
                <button
                  type="button"
                  onClick={() => void handleCopyMarkdown()}
                  title="Copy report as Markdown"
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-surface-200 bg-surface-0 px-2.5 font-sans text-[11.5px] font-medium text-ink-secondary transition-colors hover:bg-surface-50 hover:text-ink dark:border-surface-800 dark:bg-surface-850 dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden />
                      {!compact && <span>Copy Markdown</span>}
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={saveState === 'saving'}
                  onClick={() => void handleSaveToContext()}
                  title="Save dossier to Ren Context"
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 font-sans text-[11.5px] font-medium transition-colors',
                    saveState === 'saved'
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-blurple-600/35 bg-blurple-600/10 text-volt hover:bg-blurple-600/15 dark:border-blurple-400/35 dark:bg-blurple-400/15 dark:hover:bg-blurple-400/25',
                  )}
                >
                  {saveState === 'saving' ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      <span>Saving…</span>
                    </>
                  ) : saveState === 'saved' ? (
                    <>
                      <BookmarkCheck className="h-3.5 w-3.5" aria-hidden />
                      <span>Saved to Context</span>
                    </>
                  ) : (
                    <>
                      <BookmarkPlus className="h-3.5 w-3.5" aria-hidden />
                      {!compact ? <span>Save to Context</span> : <span>Context</span>}
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        )}

        {/* Slidev Deck Tab Actions */}
        {tab === 'deck' && (deckEmbedUrl || hasSlidevText || slidevMarkdownUrl || slidevPdfUrl) && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {deckEmbedUrl && hasSlidevText && (
              <div
                role="group"
                aria-label="Deck display mode"
                className="inline-flex items-center rounded-lg bg-surface-100 p-0.5 dark:bg-surface-800"
              >
                {(
                  [
                    ['interactive', 'Deck'],
                    ['markdown', 'Slidev .md'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setDeckFormat(mode)}
                    className={cn(
                      'h-6 rounded-md px-2 font-sans text-[11px] font-medium transition-colors',
                      deckFormat === mode
                        ? 'bg-surface-0 text-ink shadow-sm dark:bg-surface-900 dark:text-ink-inverse'
                        : 'text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {deckEmbedUrl && (
              <button
                type="button"
                onClick={() => openSourceInNewTab(deckEmbedUrl)}
                title="Open Slidev presentation in a fullscreen browser tab"
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-blurple-600/35 bg-blurple-600/10 px-2.5 font-sans text-[11.5px] font-medium text-volt transition-colors hover:bg-blurple-600/15 dark:border-blurple-400/35 dark:bg-blurple-400/15 dark:hover:bg-blurple-400/25"
              >
                <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                {!compact ? <span>Open Fullscreen Tab</span> : <span>Fullscreen</span>}
              </button>
            )}

            {(hasSlidevText || slidevMarkdownUrl) && (
              <button
                type="button"
                onClick={handleDownloadSlidevMd}
                title="Download Slidev Markdown source (.md)"
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-surface-200 bg-surface-0 px-2.5 font-sans text-[11.5px] font-medium text-ink-secondary transition-colors hover:bg-surface-50 hover:text-ink dark:border-surface-800 dark:bg-surface-850 dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse"
              >
                <FileCode2 className="h-3.5 w-3.5" aria-hidden />
                {!compact ? <span>Download Slidev .md</span> : <span>.md</span>}
              </button>
            )}

            {slidevPdfDownloadUrl && (
              <button
                type="button"
                onClick={() => triggerUrlDownload(slidevPdfDownloadUrl, `${baseFilename}-slides.pdf`)}
                title="Download presentation deck as PDF"
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-surface-200 bg-surface-0 px-2.5 font-sans text-[11.5px] font-medium text-ink-secondary transition-colors hover:bg-surface-50 hover:text-ink dark:border-surface-800 dark:bg-surface-850 dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse"
              >
                <Download className="h-3.5 w-3.5 text-volt" aria-hidden />
                {!compact ? <span>Download Deck PDF</span> : <span>Deck PDF</span>}
              </button>
            )}
          </div>
        )}
      </header>

      {saveState === 'error' && saveError && (
        <div
          role="alert"
          className="border-b border-rose-500/25 bg-rose-500/10 px-4 py-2 font-sans text-[12px] text-rose-700 dark:text-rose-300"
        >
          {saveError}
        </div>
      )}

      {/* Tab Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 scrollbar-thin">
        {/* 1. PDF Report Tab */}
        {tab === 'report' && (
          <div className={cn('mx-auto', showPdfIframe || snapshot.application ? 'max-w-[960px]' : 'max-w-[760px]')}>
            {snapshot.error && (
              <div
                role="alert"
                className="mb-5 rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 font-sans text-[13px] text-rose-700 dark:text-rose-300"
              >
                <p className="font-semibold">Formation run stopped with an error</p>
                <p className="mt-1 opacity-90">{snapshot.error}</p>
              </div>
            )}

            {snapshot.application ? (
              <DeepResearchApplication application={snapshot.application} userId={userId} />
            ) : showPdfIframe && reportPdfUrl ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2 rounded-xl border border-surface-200 bg-surface-50/80 px-3.5 py-2 dark:border-surface-800 dark:bg-surface-850/80">
                  <div className="flex min-w-0 items-center gap-2">
                    <RenMark className="h-4 w-4 shrink-0" />
                    <span className="truncate font-sans text-[12px] font-medium text-ink-secondary dark:text-ink-inverse-secondary">
                      Scholarly Publication PDF
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openSourceInNewTab(reportPdfUrl)}
                    className="inline-flex shrink-0 items-center gap-1 font-sans text-[12px] font-medium text-volt hover:underline"
                  >
                    <span>Open in browser tab</span>
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </button>
                </div>

                <iframe
                  src={reportPdfUrl}
                  title="Scholarly Research Report PDF"
                  className="h-[calc(100vh-210px)] min-h-[620px] w-full rounded-2xl border border-surface-200 bg-surface-50 shadow-soft dark:border-surface-800 dark:bg-surface-950 dark:shadow-dark-soft"
                />
              </div>
            ) : hasReportText ? (
              <article className="relative rounded-2xl border border-surface-200 bg-surface-0 p-6 dark:border-surface-800 dark:bg-surface-850/90">
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-[2.5px] rounded-l-2xl bg-blurple-600 dark:bg-blurple-400"
                />
                <div className="mb-5 flex items-center justify-between gap-3 border-b border-surface-100 pb-3.5 dark:border-surface-800">
                  <div className="flex items-center gap-2">
                    <RenMark className="h-4 w-4 shrink-0" />
                    <span className="font-sans text-[12.5px] font-semibold text-ink dark:text-ink-inverse">
                      Ren Research Dossier
                    </span>
                  </div>
                  {isStreamingReport ? (
                    <span className="inline-flex items-center gap-1.5 font-sans text-[12px] font-medium text-volt">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      Synthesizing &amp; typesetting PDF…
                    </span>
                  ) : null}
                </div>

                <MessageResponse
                  className={REPORT_PROSE}
                  components={REPORT_MARKDOWN_COMPONENTS}
                  mode={isStreamingReport ? 'streaming' : 'static'}
                  isAnimating={isStreamingReport}
                  parseIncompleteMarkdown={isStreamingReport}
                >
                  {snapshot.report_markdown}
                </MessageResponse>

              </article>
            ) : snapshot.active ? (
              <div className="rounded-2xl border border-surface-200 bg-surface-50/70 p-6 dark:border-surface-800 dark:bg-surface-850/70">
                <div className="flex items-center gap-3">
                  <RenMark className="h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-sans text-[12px] font-medium text-volt">
                      Formation in progress
                    </p>
                    <h2 className="mt-0.5 font-display text-[17px] font-semibold tracking-[-0.015em] text-ink dark:text-ink-inverse">
                      Gathering, cross-examining, and verifying primary evidence
                    </h2>
                  </div>
                </div>

                <p className="mt-3 font-sans text-[13.5px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
                  {made
                    ? "The research swarm researches and checks the sources, then the build swarm has OpenCode build it on Ren's workspace computer, checks it and lists it under Applications."
                    : 'The research swarm researches and checks the sources, the data analysis graph builds the charts, the writing swarm writes the report and the deck, and the production graph publishes the PDF and the Slidev deck.'}
                </p>

                {snapshot.active_node_path.length > 0 && (
                  <div className="mt-4 flex items-center gap-2 rounded-xl border border-blurple-500/30 bg-blurple-600/[0.06] px-3.5 py-2.5 font-sans text-[12px] font-medium text-volt dark:border-blurple-400/30 dark:bg-blurple-400/[0.12]">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                    <span className="truncate">
                      Active: {snapshot.active_node_path.map(humanizeIdentifier).join(' › ')}
                    </span>
                  </div>
                )}

                {snapshot.skill_invocations.length > 0 && (
                  <div className="mt-5 space-y-2">
                    <p className="font-sans text-[12px] font-medium text-ink-muted dark:text-ink-inverse-muted">
                      Recent skill subagent findings ({snapshot.skill_invocations.length})
                    </p>
                    {snapshot.skill_invocations.slice(-3).map((sk) => (
                      <div
                        key={sk.id}
                        className="rounded-xl border border-surface-200 bg-surface-0 px-3.5 py-2.5 dark:border-surface-800 dark:bg-surface-900"
                      >
                        <div className="flex items-center justify-between gap-2 font-sans text-[12px]">
                          <span className="font-medium text-volt">{sk.skill_name}</span>
                          <span className="text-ink-muted dark:text-ink-inverse-muted">{sk.status}</span>
                        </div>
                        {(sk.summary || sk.task) && (
                          <p className="mt-1 line-clamp-2 font-sans text-[12px] text-ink-secondary dark:text-ink-inverse-secondary">
                            {sk.summary || sk.task}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-5">
                  <button
                    type="button"
                    onClick={() => setActiveTab('trace')}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-surface-200 bg-surface-0 px-3 font-sans text-[12px] font-medium text-ink transition-colors hover:bg-surface-100 dark:border-surface-700 dark:bg-surface-850 dark:text-ink-inverse dark:hover:bg-surface-800"
                  >
                    <Activity className="h-3.5 w-3.5 text-volt" aria-hidden />
                    Inspect live Formation Trace
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-surface-200 px-6 py-12 text-center dark:border-surface-800">
                <h3 className="font-display text-[16px] font-semibold tracking-[-0.015em] text-ink dark:text-ink-inverse">
                  {made ? `No ${made.label.toLowerCase()} came out of this run.` : 'No synthesis report was generated for this run.'}
                </h3>
                <p className="mt-1.5 font-sans text-[13px] text-ink-muted dark:text-ink-inverse-muted">
                  Open the Formation Trace tab to inspect stage outputs and status details.
                </p>
              </div>
            )}
          </div>
        )}

        {/* 2. Slidev Deck Tab */}
        {tab === 'deck' && (
          <div className="mx-auto max-w-[960px]">
            {showDeckIframe && deckEmbedUrl ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-2 rounded-xl border border-surface-200 bg-surface-50/80 px-3.5 py-2 dark:border-surface-800 dark:bg-surface-850/80">
                  <div className="flex min-w-0 items-center gap-2">
                    <Presentation className="h-4 w-4 shrink-0 text-volt" aria-hidden />
                    <span className="truncate font-sans text-[12px] font-medium text-ink-secondary dark:text-ink-inverse-secondary">
                      {slidevPreviewUrl
                        ? 'Interactive Slidev Presentation · Use arrow keys to navigate slides'
                        : 'Slidev Presentation Deck (PDF)'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openSourceInNewTab(deckEmbedUrl)}
                    className="inline-flex shrink-0 items-center gap-1 font-sans text-[12px] font-medium text-volt hover:underline"
                  >
                    <span>Fullscreen tab</span>
                    <Maximize2 className="h-3 w-3" aria-hidden />
                  </button>
                </div>

                <iframe
                  src={deckEmbedUrl}
                  allow="fullscreen"
                  title="Slidev Presentation Deck"
                  className={cn(
                    'w-full rounded-2xl border border-surface-200 bg-surface-950 shadow-soft dark:border-surface-800 dark:shadow-dark-soft',
                    slidevPreviewUrl ? 'aspect-video min-h-[440px]' : 'h-[calc(100vh-210px)] min-h-[600px]',
                  )}
                />

                {parsedSlides.length > 0 && (
                  <div className="mt-2">
                    <p className="mb-2.5 font-sans text-[12px] font-medium text-ink-muted dark:text-ink-inverse-muted">
                      Slide deck outline ({parsedSlides.length} slides)
                    </p>
                    <div className={cn('grid gap-2.5', twoColSources ? 'grid-cols-2' : 'grid-cols-1')}>
                      {parsedSlides.map((slide) => (
                        <div
                          key={slide.index}
                          className="rounded-xl border border-surface-200 bg-surface-0 p-3.5 dark:border-surface-800 dark:bg-surface-850"
                        >
                          <div className="flex items-center gap-2">
                            <span className="rounded-md bg-blurple-600/10 px-1.5 py-0.5 font-sans text-[11px] font-semibold tabular-nums text-volt dark:bg-blurple-400/15">
                              {String(slide.index).padStart(2, '0')}
                            </span>
                            <h3 className="truncate font-sans text-[13.5px] font-semibold text-ink dark:text-ink-inverse">
                              {slide.title}
                            </h3>
                          </div>
                          {slide.body && (
                            <p className="mt-1.5 line-clamp-3 font-sans text-[12px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
                              {slide.body}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : hasSlidevText ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2 rounded-xl border border-surface-200 bg-surface-50/80 px-3.5 py-2.5 dark:border-surface-800 dark:bg-surface-850/80">
                  <div className="flex items-center gap-2">
                    <Presentation className="h-4 w-4 text-volt" aria-hidden />
                    <span className="font-sans text-[12.5px] font-medium text-ink dark:text-ink-inverse">
                      Slidev Markdown Deck ({parsedSlides.length || 1} slides)
                    </span>
                  </div>
                  {snapshot.active && (
                    <span className="inline-flex items-center gap-1.5 font-sans text-[12px] font-medium text-volt">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      Building interactive Slidev bundle…
                    </span>
                  )}
                </div>

                {parsedSlides.length > 0 && (
                  <div className={cn('grid gap-3', twoColSources ? 'grid-cols-2' : 'grid-cols-1')}>
                    {parsedSlides.map((slide) => (
                      <div
                        key={slide.index}
                        className="rounded-xl border border-surface-200 bg-surface-0 p-4 dark:border-surface-800 dark:bg-surface-850"
                      >
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-blurple-600/10 px-1.5 py-0.5 font-sans text-[11px] font-semibold tabular-nums text-volt dark:bg-blurple-400/15">
                            {String(slide.index).padStart(2, '0')}
                          </span>
                          <h3 className="truncate font-sans text-[14px] font-semibold text-ink dark:text-ink-inverse">
                            {slide.title}
                          </h3>
                        </div>
                        {slide.body && (
                          <p className="mt-2 whitespace-pre-line line-clamp-4 font-sans text-[12.5px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
                            {slide.body}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <details className="rounded-xl border border-surface-200 bg-surface-0 p-3.5 dark:border-surface-800 dark:bg-surface-850">
                  <summary className="cursor-pointer font-sans text-[12px] font-medium text-ink-secondary dark:text-ink-inverse-secondary">
                    Inspect Slidev source (slides.md)
                  </summary>
                  <pre className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-50 p-3 font-mono text-[11.5px] leading-relaxed text-ink-secondary scrollbar-thin dark:bg-surface-900 dark:text-ink-inverse-secondary">
                    {snapshot.slidev_markdown}
                  </pre>
                </details>
              </div>
            ) : snapshot.active ? (
              <div className="rounded-2xl border border-surface-200 bg-surface-50/70 p-6 dark:border-surface-800 dark:bg-surface-850/70">
                <div className="flex items-center gap-3">
                  <Presentation className="h-5 w-5 shrink-0 text-volt" aria-hidden />
                  <div>
                    <p className="font-sans text-[12px] font-medium text-volt">
                      Slidev deck queued
                    </p>
                    <h2 className="mt-0.5 font-display text-[17px] font-semibold tracking-[-0.015em] text-ink dark:text-ink-inverse">
                      The production graph builds the deck
                    </h2>
                  </div>
                </div>
                <p className="mt-3 font-sans text-[13.5px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
                  The writing swarm writes slides.md and the production graph builds it into an interactive
                  Slidev deck and a PDF, alongside the report.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-surface-200 px-6 py-12 text-center dark:border-surface-800">
                <h3 className="font-display text-[16px] font-semibold tracking-[-0.015em] text-ink dark:text-ink-inverse">
                  No Slidev presentation deck is attached to this run yet.
                </h3>
                <p className="mt-1.5 font-sans text-[13px] text-ink-muted dark:text-ink-inverse-muted">
                  Completed runs publish the interactive Slidev deck, its .md source and its PDF here.
                </p>
              </div>
            )}
          </div>
        )}

        {/* 3. Formation Trace Tab */}
        {tab === 'trace' && (
          <div className="mx-auto max-w-[780px]">
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              {(
                [
                  ['all', 'All'],
                  ['skill', 'Skills'],
                  ['handoff', 'Handoffs'],
                  ['node', 'Nodes'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTraceFilter(id)}
                  className={cn(
                    'inline-flex h-7 items-center rounded-full px-3 font-sans text-[12px] font-medium transition-colors',
                    traceFilter === id
                      ? 'bg-blurple-600 text-white dark:bg-blurple-400 dark:text-ink'
                      : 'bg-surface-100 text-ink-secondary hover:text-ink dark:bg-surface-800 dark:text-ink-inverse-secondary dark:hover:text-ink-inverse',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {filteredTrace.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-surface-200 px-6 py-12 text-center dark:border-surface-800">
                <h3 className="font-display text-[16px] font-semibold tracking-[-0.015em] text-ink dark:text-ink-inverse">
                  No trace events recorded yet.
                </h3>
                <p className="mt-1.5 font-sans text-[13px] text-ink-muted dark:text-ink-inverse-muted">
                  Formation node transitions, swarm handoffs, and skill invocations appear here live.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredTrace.map((entry) => (
                  <TraceRow key={entry.id} entry={entry} skillLookup={skillLookup} />
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </section>
  )
}
