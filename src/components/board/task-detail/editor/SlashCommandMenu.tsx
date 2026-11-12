import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { ChainedCommands, Editor, Range } from '@tiptap/core'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import { isValidYoutubeUrl } from '@tiptap/extension-youtube'
import type { EmojiItem } from '@tiptap/extension-emoji'
import { AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, FileText, Info, Lightbulb, Link2, Loader2, MessageSquareText, Upload } from 'lucide-react'
import {
  EMBED_PROVIDERS, HIGHLIGHT_COLORS, MAX_INLINE_FILE_BYTES, PDF_DATA_PREFIX, TEXT_COLORS, addDays, flattenSections, formatLongDate,
  imageSource, isHttpsUrl, isPdfBytes, matchesAll, nameFromUrl, normalizeEmbed, parseIsoDate, relativeDayLabel, searchEmoji, slashSections,
  toIsoDate, tooLargeMessage, type CalloutVariant, type ColorChoice, type EmbedProvider,
} from '@/lib/editor-blocks'
import { issueKey } from '@/lib/execute-issues'
import { relativeTime } from '@/lib/threads-api'
import { isGuestUserId, openSignIn } from '@/lib/sign-in'
import { UNTITLED } from '@/lib/project-documents'
import { cn } from '@/lib/utils'
import { fileToDataUrl } from '@/utils/file-utils'
import { useAuthStore } from '@/stores/authStore'
import { useProjectsStore } from '@/stores/projectsStore'
import { ISSUE_STATUS_CONFIG } from '@/types/projects'
import { STATUS_FILL } from '@/components/execute/IssueBits'
import { SLASH_PLUGIN_KEY, askRonCallback, type SlashItem } from './extensions/slash-shared'
import { placeBlock } from './extensions/blocks/commands'
import { MathField } from './extensions/blocks/MathBlocks'
import { RonButtonForm } from './extensions/blocks/RonButton'
import { useProjectPages, useThreads } from './extensions/blocks/workspace'

export interface SlashMenuHandle { onKeyDown: (props: SuggestionKeyDownProps) => boolean }
type MenuProps = SuggestionProps<SlashItem>
type Build = (chain: ChainedCommands) => ChainedCommands

type Step =
  | { kind: 'link'; item: SlashItem }
  | { kind: 'callout' | 'color' | 'highlight' | 'emoji' | 'issue' | 'chat' | 'page' | 'date' | 'ronButton' }
  | { kind: 'math'; display: boolean }

const LINK_ITEMS = new Set(['image', 'youtube', 'video', 'audio', 'pdf', 'embed', 'maps', 'figma', 'loom', 'vimeo', 'drive'])
const STEP_ITEMS: Record<string, Step> = {
  callout: { kind: 'callout' }, color: { kind: 'color' }, highlight: { kind: 'highlight' }, emoji: { kind: 'emoji' },
  issue: { kind: 'issue' }, chat: { kind: 'chat' }, page: { kind: 'page' }, date: { kind: 'date' }, 'ron-button': { kind: 'ronButton' },
  'math-block': { kind: 'math', display: true }, 'math-inline': { kind: 'math', display: false },
}

/** Items that act at once (the cursor's block becomes, or is followed by, the new block). */
const IMMEDIATE: Record<string, Build> = {
  text: (chain) => chain.setNode('paragraph'),
  h1: (chain) => chain.setNode('heading', { level: 1 }),
  h2: (chain) => chain.setNode('heading', { level: 2 }),
  h3: (chain) => chain.setNode('heading', { level: 3 }),
  'toggle-h1': (chain) => chain.insertToggle(1),
  'toggle-h2': (chain) => chain.insertToggle(2),
  'toggle-h3': (chain) => chain.insertToggle(3),
  quote: (chain) => chain.toggleBlockquote(),
  divider: (chain) => chain.setHorizontalRule(),
  bullet: (chain) => chain.toggleBulletList(),
  numbered: (chain) => chain.toggleOrderedList(),
  todo: (chain) => chain.toggleTaskList(),
  toggle: (chain) => chain.insertToggle(),
  'columns-2': (chain) => chain.insertColumns(2),
  'columns-3': (chain) => chain.insertColumns(3),
  'columns-4': (chain) => chain.insertColumns(4),
  card: (chain) => chain.insertCard(),
  table: (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
  toc: (chain) => chain.insertTableOfContents(),
  code: (chain) => chain.toggleCodeBlock(),
  workflow: (chain) => chain.insertWorkflow(),
}

const PANEL = 'flex max-h-[min(26rem,45vh)] w-[22rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-surface-200 bg-surface-0 text-ink shadow-dramatic dark:border-surface-700 dark:bg-surface-850 dark:text-ink-inverse dark:shadow-dark-bold'
const FIELD = 'h-8 w-full rounded-md border border-surface-200 bg-surface-0 px-2 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-accent dark:border-surface-700 dark:bg-surface-900 dark:text-ink-inverse'
const MUTED = 'px-3 py-5 text-center text-[13px] text-ink-muted dark:text-ink-inverse-muted'

export const SlashCommandMenu = forwardRef<SlashMenuHandle, MenuProps>((props, ref) => {
  const propsRef = useRef(props)
  propsRef.current = props
  const [selected, setSelected] = useState(0)
  const [step, setStep] = useState<Step | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const sections = useMemo(() => slashSections(props.items, props.query), [props.items, props.query])
  const flat = useMemo(() => flattenSections(sections), [sections])

  useEffect(() => { setSelected(0); if (listRef.current) listRef.current.scrollTop = 0 }, [props.items])
  // Typing in the editor again (after clicking back into it) leaves any open step.
  useEffect(() => { setStep(null) }, [props.query])
  useEffect(() => {
    if (step) return
    const row = listRef.current?.querySelector(`[data-index="${selected}"]`)
    if (selected === 0 && listRef.current) listRef.current.scrollTop = 0
    else row?.scrollIntoView({ block: 'nearest' })
  }, [selected, step])

  /** Remove the typed "/query" (the suggestion's current range) and run the edit. False once the menu is gone. */
  const commit = (build: Build): boolean => {
    const { editor } = propsRef.current
    const state = SLASH_PLUGIN_KEY.getState(editor.state) as { active: boolean; range: Range } | undefined
    if (!state?.active) return false
    return build(editor.chain().focus().deleteRange(state.range)).run()
  }

  /** Text color / highlight apply to the cursor's whole block, like Notion's "/color"; an empty block keeps it for typing. */
  const markBlock = (apply: Build) => {
    if (!commit((chain) => chain)) return
    const { editor } = propsRef.current
    const { $from } = editor.state.selection
    if (!$from.parent.isTextblock) return
    const start = $from.start()
    const end = $from.end()
    if (start === end) apply(editor.chain().focus()).run()
    else apply(editor.chain().focus().setTextSelection({ from: start, to: end })).setTextSelection($from.pos).run()
  }

  const back = () => {
    setStep(null)
    propsRef.current.editor.commands.focus()
  }

  const choose = (item: SlashItem) => {
    const { editor } = propsRef.current
    if (IMMEDIATE[item.id]) { commit(IMMEDIATE[item.id]); return }
    if (LINK_ITEMS.has(item.id)) { setStep({ kind: 'link', item }); return }
    if (STEP_ITEMS[item.id]) { setStep(STEP_ITEMS[item.id]); return }
    if (item.id === 'upload') { fileInput.current?.click(); return }
    if (item.id === 'ask-ron' || item.id === 'goal') {
      const callback = askRonCallback(editor)
      if (callback) {
        if (commit((chain) => chain)) callback(item.id === 'goal')
        return
      }
      if (item.id === 'ask-ron') commit((chain) => chain.insertContent({ type: 'askRon', attrs: { taskId: '' } }))
    }
  }

  const attachFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const dataUrl = await fileToDataUrl(file)
    commit((chain) => chain.insertContent({ type: 'fileAttachment', attrs: { dataUrl, name: file.name, size: file.size, type: file.type } }))
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      // A step has its own focused field; keys that still reach the editor are left to it.
      if (step || !flat.length) return false
      if (event.key === 'ArrowDown') { setSelected((index) => (index + 1) % flat.length); return true }
      if (event.key === 'ArrowUp') { setSelected((index) => (index + flat.length - 1) % flat.length); return true }
      if (event.key === 'Enter' || event.key === 'Tab') { choose(flat[Math.min(selected, flat.length - 1)]); return true }
      return false
    },
  }))

  const stepProps = { editor: props.editor, commit, onBack: back }
  let content: ReactNode
  if (step?.kind === 'link') content = <LinkStep key={step.item.id} item={step.item} {...stepProps} />
  else if (step?.kind === 'callout') content = <CalloutStep {...stepProps} />
  else if (step?.kind === 'color' || step?.kind === 'highlight') content = <ColorStep highlight={step.kind === 'highlight'} markBlock={markBlock} onBack={back} />
  else if (step?.kind === 'emoji') content = <EmojiStep {...stepProps} />
  else if (step?.kind === 'issue') content = <IssueStep {...stepProps} />
  else if (step?.kind === 'chat') content = <ChatStep {...stepProps} />
  else if (step?.kind === 'page') content = <PageStep {...stepProps} />
  else if (step?.kind === 'date') content = <DateStep {...stepProps} />
  else if (step?.kind === 'math') content = <div className="overflow-y-auto"><StepHeader title={step.display ? 'Block equation' : 'Inline equation'} onBack={back} />
    <MathField initial="" displayMode={step.display} submitLabel="Insert" onCancel={back}
      // insertContent, not insertInlineMath: that command reads the pre-chain selection, which the "/query" deletion moved.
      onSubmit={(latex) => commit((chain) => step.display ? chain.command(placeBlock((schema) => schema.nodes.blockMath.create({ latex }))) : chain.insertContent({ type: 'inlineMath', attrs: { latex } }))} /></div>
  else if (step?.kind === 'ronButton') content = <div className="overflow-y-auto"><StepHeader title="Ren button" onBack={back} />
    <div className="px-3 pb-3"><RonButtonForm initial={{ label: '', prompt: '' }} submitLabel="Insert" onCancel={back}
      onSubmit={(value) => commit((chain) => chain.insertRonButton(value))} /></div></div>
  else content = <>
    <div ref={listRef} role="listbox" aria-label="Insert a block" className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-auto p-1 scrollbar-thin">
      {sections.map((section) => <div key={section.group} role="group" aria-label={section.label}>
        <div className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">{section.label}</div>
        {section.items.map((item) => {
          const index = flat.indexOf(item)
          const active = index === selected
          const Icon = item.icon
          return <button key={item.id} type="button" role="option" aria-selected={active} data-index={index} data-slash-item={item.id}
            onMouseDown={(event) => event.preventDefault()} onMouseMove={() => { if (!active) setSelected(index) }} onClick={() => choose(item)}
            className={cn('flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors',
              active ? 'bg-accent/10 text-ink dark:bg-accent-light/15 dark:text-ink-inverse' : 'text-ink dark:text-ink-inverse')}>
            <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-md border',
              active ? 'border-accent/30 bg-surface-0 text-accent dark:border-accent-light/30 dark:bg-surface-900 dark:text-accent-light'
                : 'border-surface-200 bg-surface-0 text-ink-secondary dark:border-surface-700 dark:bg-surface-900 dark:text-ink-inverse-secondary')}>
              <Icon className="size-[17px]" strokeWidth={1.9} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium">{item.label}</span>
              <span className="block truncate text-[11.5px] text-ink-muted dark:text-ink-inverse-muted">{item.description}</span>
            </span>
          </button>
        })}
      </div>)}
      {!flat.length && <p className={MUTED}>No blocks match “/{props.query}”.</p>}
    </div>
    <p className="border-t border-surface-200 px-3 py-1.5 text-[11px] text-ink-muted dark:border-surface-700 dark:text-ink-inverse-muted">↑↓ to move · Enter to insert · Esc to close</p>
  </>

  return <div className={PANEL} data-slash-menu="" data-step={step?.kind ?? 'list'} onMouseDown={(event) => { if (event.target === event.currentTarget) event.preventDefault() }}>
    <input ref={fileInput} type="file" className="hidden" tabIndex={-1} aria-hidden="true" onChange={(event) => { void attachFile(event) }} />
    {content}
  </div>
})

SlashCommandMenu.displayName = 'SlashCommandMenu'

// ---------------------------------------------------------------- step building blocks

interface StepProps { editor: Editor; commit: (build: Build) => boolean; onBack: () => void }

function StepHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-2">
    <button type="button" onClick={onBack} aria-label="Back to blocks" title="Back (Esc)"
      className="flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-surface-100 hover:text-ink dark:hover:bg-surface-800 dark:hover:text-ink-inverse">
      <ArrowLeft className="size-3.5" />
    </button>
    <p className="text-[12.5px] font-semibold">{title}</p>
  </div>
}

/** A filter field over a list, driven by ↑ ↓ Enter / Tab, Esc goes back. */
function SearchList<T>({ title, placeholder, query, setQuery, items, getKey, renderItem, onChoose, onBack, loading, error, empty, footer }: {
  title: string
  placeholder: string
  query: string
  setQuery: (value: string) => void
  items: readonly T[]
  getKey: (item: T) => string
  renderItem: (item: T) => ReactNode
  onChoose: (item: T) => void
  onBack: () => void
  loading?: boolean
  error?: string
  empty: ReactNode
  footer?: ReactNode
}) {
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const current = Math.min(active, Math.max(0, items.length - 1))
  useEffect(() => { setActive(0) }, [query])
  useEffect(() => { list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' }) }, [current])
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && items.length) { event.preventDefault(); setActive((current + 1) % items.length) }
    else if (event.key === 'ArrowUp' && items.length) { event.preventDefault(); setActive((current + items.length - 1) % items.length) }
    else if ((event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) && items.length) { event.preventDefault(); onChoose(items[current]) }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onBack() }
  }
  return <>
    <StepHeader title={title} onBack={onBack} />
    <div className="px-2 pb-1.5">
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} aria-label={placeholder} className={FIELD} />
    </div>
    <div ref={list} role="listbox" aria-label={title} className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-auto p-1 scrollbar-thin">
      {error ? <p role="alert" className="px-3 py-4 text-center text-[13px] text-rose-600 dark:text-rose-400">{error}</p>
        : !items.length ? (loading ? <p className={cn(MUTED, 'flex items-center justify-center gap-2')}><Loader2 className="size-3.5 animate-spin" />Loading…</p> : <div className={MUTED}>{empty}</div>)
          : items.map((item, index) => <button key={getKey(item)} type="button" role="option" aria-selected={index === current} data-index={index}
              onMouseMove={() => { if (index !== current) setActive(index) }} onClick={() => onChoose(item)}
              className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left', index === current && 'bg-accent/10 dark:bg-accent-light/15')}>
              {renderItem(item)}
            </button>)}
    </div>
    {footer}
  </>
}

const RowText = ({ title, detail }: { title: ReactNode; detail?: ReactNode }) => <span className="min-w-0 flex-1">
  <span className="block truncate text-[13px] font-medium">{title}</span>
  {detail && <span className="block truncate text-[11.5px] text-ink-muted dark:text-ink-inverse-muted">{detail}</span>}
</span>

// ---------------------------------------------------------------- link / upload step

interface LinkConfig { title: string; placeholder: string; hint: string; upload?: 'image' | 'pdf'; submit: (value: string, commit: StepProps['commit']) => string | null }

const embedConfig = (provider: EmbedProvider, title: string, hint: string): LinkConfig => ({
  title, hint, placeholder: EMBED_PROVIDERS[provider].placeholder,
  submit: (value, commit) => {
    const result = normalizeEmbed(value, provider)
    if (!result.ok) return result.error
    commit((chain) => chain.insertEmbed(result.value))
    return null
  },
})

const mediaConfig = (kind: 'video' | 'audio'): LinkConfig => ({
  title: kind === 'video' ? 'Video' : 'Audio',
  placeholder: kind === 'video' ? 'https://example.com/clip.mp4' : 'https://example.com/episode.mp3',
  hint: kind === 'video' ? 'A direct https link to an MP4 or WebM file. For YouTube use /youtube.' : 'A direct https link to an MP3, M4A, OGG or WAV file.',
  submit: (value, commit) => {
    if (!isHttpsUrl(value)) return 'Use a full https:// link to the file.'
    commit((chain) => chain.insertMedia({ kind, src: value.trim() }))
    return null
  },
})

const LINK_CONFIG: Record<string, LinkConfig> = {
  embed: embedConfig('web', 'Embed a page', 'Any https page. Google Maps, Figma, Loom, Vimeo and Google Drive links switch to their players.'),
  maps: embedConfig('maps', 'Google Maps', 'An address, a place name or a Google Maps link.'),
  figma: embedConfig('figma', 'Figma', 'Share link of a Figma file, prototype or FigJam board.'),
  loom: embedConfig('loom', 'Loom', 'Share link of a Loom recording.'),
  vimeo: embedConfig('vimeo', 'Vimeo', 'Link to a Vimeo video (unlisted links keep their hash).'),
  drive: embedConfig('drive', 'Google Drive', 'A Docs, Sheets, Slides, Forms or Drive file link shared with you.'),
  youtube: {
    title: 'YouTube video', placeholder: 'https://www.youtube.com/watch?v=…', hint: 'A YouTube video, Short or playlist link. It plays from youtube-nocookie.com.',
    submit: (value, commit) => {
      const src = value.trim()
      if (!isValidYoutubeUrl(src)) return 'That is not a YouTube video link.'
      commit((chain) => chain.setYoutubeVideo({ src }))
      return null
    },
  },
  video: mediaConfig('video'),
  audio: mediaConfig('audio'),
  image: {
    title: 'Image', placeholder: 'https://example.com/picture.png', upload: 'image', hint: `Paste an image link, or upload an image (large photos are resized to fit ${Math.round(MAX_INLINE_FILE_BYTES / 1024 / 1024)} MB).`,
    submit: (value, commit) => {
      const src = value.trim()
      if (!isHttpsUrl(src) || !imageSource(src)) return 'Use a full https:// link to an image.'
      commit((chain) => chain.setImage({ src, alt: nameFromUrl(src) }))
      return null
    },
  },
  pdf: {
    title: 'PDF', placeholder: 'https://example.com/report.pdf', upload: 'pdf', hint: `Paste a link to a PDF, or upload one up to ${Math.round(MAX_INLINE_FILE_BYTES / 1024 / 1024)} MB.`,
    submit: (value, commit) => {
      const src = value.trim()
      if (!isHttpsUrl(src)) return 'Use a full https:// link to the PDF.'
      commit((chain) => chain.insertPdf({ src, name: nameFromUrl(src) }))
      return null
    },
  },
}

/** An uploaded image as a data URL; JPEG/PNG/WebP photos over the limit are downscaled to WebP to fit. */
async function imageDataUrl(file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|gif|webp|avif|svg\+xml)$/i.test(file.type)) throw new Error(`${file.name} is not a PNG, JPEG, GIF, WebP, AVIF or SVG image.`)
  if (file.size <= MAX_INLINE_FILE_BYTES) return fileToDataUrl(file)
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) throw new Error(tooLargeMessage(file.name, file.size))
  const bitmap = await createImageBitmap(file)
  try {
    for (const edge of [2400, 1800, 1400, 1000]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85))
      if (blob && blob.size <= MAX_INLINE_FILE_BYTES) return fileToDataUrl(new File([blob], file.name, { type: 'image/webp' }))
    }
  } finally {
    bitmap.close()
  }
  throw new Error(tooLargeMessage(file.name, file.size))
}

/** An uploaded PDF as `data:application/pdf;base64,…`, after checking its size and `%PDF-` signature. */
async function pdfDataUrl(file: File): Promise<string> {
  if (file.size > MAX_INLINE_FILE_BYTES) throw new Error(tooLargeMessage(file.name, file.size))
  if (!isPdfBytes(new Uint8Array(await file.slice(0, 5).arrayBuffer()))) throw new Error(`${file.name} is not a PDF.`)
  const dataUrl = await fileToDataUrl(file)
  return PDF_DATA_PREFIX + dataUrl.slice(dataUrl.indexOf(',') + 1)
}

function LinkStep({ item, commit, onBack }: StepProps & { item: SlashItem }) {
  const config = LINK_CONFIG[item.id]
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const upload = useRef<HTMLInputElement>(null)
  const submit = () => {
    if (!value.trim()) { setError('Paste a link first.'); return }
    const problem = config.submit(value, commit)
    if (problem) setError(problem)
  }
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try {
      if (config.upload === 'image') {
        const src = await imageDataUrl(file)
        if (!imageSource(src)) throw new Error(`${file.name} could not be read as an image.`)
        commit((chain) => chain.setImage({ src, alt: file.name }))
      } else {
        const src = await pdfDataUrl(file)
        commit((chain) => chain.insertPdf({ src, name: file.name, size: file.size }))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return <div className="overflow-y-auto">
    <StepHeader title={config.title} onBack={onBack} />
    <form className="space-y-2 px-3 pb-3" onSubmit={(event) => { event.preventDefault(); submit() }}>
      <div className="flex items-center gap-1.5">
        <span className="relative min-w-0 flex-1">
          <Link2 className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted" />
          <input autoFocus value={value} placeholder={config.placeholder} aria-label={`${config.title} link`} aria-invalid={!!error}
            onChange={(event) => { setValue(event.target.value); setError('') }}
            onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onBack() } }}
            className={cn(FIELD, 'pl-7')} />
        </span>
        <button type="submit" disabled={busy} className="h-8 shrink-0 rounded-md bg-accent px-3 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-40">Embed</button>
      </div>
      {config.upload && <>
        <input ref={upload} type="file" className="hidden" tabIndex={-1} aria-hidden="true" onChange={(event) => { void onFile(event) }}
          accept={config.upload === 'image' ? 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml' : 'application/pdf,.pdf'} />
        <button type="button" disabled={busy} onClick={() => upload.current?.click()}
          className="flex h-8 w-full items-center justify-center gap-2 rounded-md border border-dashed border-surface-300 text-[12.5px] font-medium text-ink-secondary hover:border-accent hover:text-accent disabled:opacity-50 dark:border-surface-600 dark:text-ink-inverse-secondary">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          {busy ? 'Reading file…' : config.upload === 'image' ? 'Upload an image' : 'Upload a PDF'}
        </button>
      </>}
      {error ? <p role="alert" className="text-[12px] text-rose-600 dark:text-rose-400">{error}</p>
        : <p className="text-[11.5px] leading-snug text-ink-muted dark:text-ink-inverse-muted">{config.hint}</p>}
    </form>
  </div>
}

// ---------------------------------------------------------------- choice steps

const CALLOUTS: { id: CalloutVariant; label: string; detail: string; icon: typeof Info; tint: string }[] = [
  { id: 'info', label: 'Info', detail: 'Neutral context or a note', icon: Info, tint: 'text-info' },
  { id: 'warning', label: 'Warning', detail: 'Something to be careful about', icon: AlertTriangle, tint: 'text-warning' },
  { id: 'success', label: 'Success', detail: 'A result or a done state', icon: CheckCircle2, tint: 'text-success' },
  { id: 'tip', label: 'Tip', detail: 'A helpful suggestion', icon: Lightbulb, tint: 'text-yellow-600 dark:text-yellow-300' },
]

function CalloutStep({ commit, onBack }: StepProps) {
  const [query, setQuery] = useState('')
  const items = CALLOUTS.filter((callout) => matchesAll([callout.label, callout.detail], query))
  return <SearchList title="Callout" placeholder="Filter callout styles…" query={query} setQuery={setQuery} items={items} getKey={(callout) => callout.id}
    onBack={onBack} empty="No callout style matches." onChoose={(callout) => commit((chain) => chain.setCallout(callout.id))}
    renderItem={(callout) => <><callout.icon className={cn('size-4 shrink-0', callout.tint)} /><RowText title={callout.label} detail={callout.detail} /></>} />
}

function ColorStep({ highlight, markBlock, onBack }: { highlight: boolean; markBlock: (apply: Build) => void; onBack: () => void }) {
  const [query, setQuery] = useState('')
  const choices = (highlight ? HIGHLIGHT_COLORS : TEXT_COLORS).filter((choice) => matchesAll([choice.label], query))
  const apply = (choice: ColorChoice) => markBlock((chain) => highlight
    ? (choice.value ? chain.setHighlight({ color: choice.value }) : chain.unsetHighlight())
    : (choice.value ? chain.setColor(choice.value) : chain.unsetColor()))
  return <SearchList title={highlight ? 'Highlight' : 'Text color'} placeholder="Filter colors…" query={query} setQuery={setQuery} items={choices}
    getKey={(choice) => choice.id} onBack={onBack} empty="No color matches." onChoose={apply}
    renderItem={(choice) => <>
      <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded border border-surface-200 text-[13px] font-semibold dark:border-surface-700"
        style={highlight ? { backgroundColor: choice.value ?? undefined } : { color: choice.value ?? undefined }}>A</span>
      <RowText title={choice.label} detail={choice.value ? (highlight ? 'Background of this block’s text' : 'Color of this block’s text') : 'Remove it from this block'} />
    </>} />
}

function EmojiStep({ commit, onBack }: StepProps) {
  const [query, setQuery] = useState('')
  const [all, setAll] = useState<EmojiItem[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    // The official emoji dataset (~650 KB) is loaded the first time the picker opens.
    import('@tiptap/extension-emoji')
      .then((module) => { if (live) setAll(module.emojis.filter((emoji) => !!emoji.emoji)) })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'The emoji list could not be loaded.') })
    return () => { live = false }
  }, [])
  const items = useMemo(() => searchEmoji(all ?? [], query), [all, query])
  return <SearchList title="Emoji" placeholder="Search emoji (smile, rocket, check)…" query={query} setQuery={setQuery} items={items} getKey={(emoji) => emoji.name}
    loading={!all} error={error} onBack={onBack} empty="No emoji matches."
    onChoose={(emoji) => commit((chain) => chain.insertContent(emoji.emoji ?? ''))}
    renderItem={(emoji) => <><span className="w-6 shrink-0 text-center text-[18px] leading-none">{emoji.emoji}</span>
      <RowText title={emoji.name.replace(/_/g, ' ')} detail={`:${emoji.shortcodes[0] ?? emoji.name}:`} /></>} />
}

function DateStep({ commit, onBack }: StepProps) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState('')
  const today = new Date()
  const typed = parseIsoDate(query.trim())
  const options = [
    ...(typed ? [{ id: 'typed', label: formatLongDate(toIsoDate(typed)), iso: toIsoDate(typed) }] : []),
    { id: 'today', label: 'Today', iso: toIsoDate(today) },
    { id: 'tomorrow', label: 'Tomorrow', iso: toIsoDate(addDays(today, 1)) },
    { id: 'week', label: 'In a week', iso: toIsoDate(addDays(today, 7)) },
    { id: 'two-weeks', label: 'In two weeks', iso: toIsoDate(addDays(today, 14)) },
    { id: 'month', label: 'In a month', iso: toIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, today.getDate())) },
  ].filter((option) => option.id === 'typed' || matchesAll([option.label, formatLongDate(option.iso)], query))
  const insert = (iso: string) => commit((chain) => chain.insertDate(iso))
  return <SearchList title="Date" placeholder="Filter, or type a date (YYYY-MM-DD)…" query={query} setQuery={setQuery} items={options} getKey={(option) => option.id}
    onBack={onBack} empty="Type a date as YYYY-MM-DD, or pick one below." onChoose={(option) => insert(option.iso)}
    renderItem={(option) => <><CalendarDays className="size-4 shrink-0 text-ink-muted" />
      <RowText title={option.label} detail={option.id === 'typed' ? relativeDayLabel(option.iso) : formatLongDate(option.iso)} /></>}
    footer={<form className="flex items-center gap-1.5 border-t border-surface-200 px-2 py-2 dark:border-surface-700" onSubmit={(event) => { event.preventDefault(); if (picked) insert(picked) }}>
      <input type="date" value={picked} onChange={(event) => setPicked(event.target.value)} aria-label="Pick a date" className={cn(FIELD, 'flex-1')} />
      <button type="submit" disabled={!picked} className="h-8 rounded-md bg-accent px-3 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-40">Insert</button>
    </form>} />
}

// ---------------------------------------------------------------- workspace pickers

function IssueStep({ commit, onBack }: StepProps) {
  const { issues, projects, isInitialized, isLoading, error, initialize } = useProjectsStore()
  const [query, setQuery] = useState('')
  useEffect(() => { if (!isInitialized && !isLoading) void initialize() }, [isInitialized, isLoading, initialize])
  const byProject = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const items = useMemo(() => [...issues].sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((issue) => matchesAll([issueKey(issue, byProject), issue.title, byProject.get(issue.projectId)?.name, ISSUE_STATUS_CONFIG[issue.status]?.label], query))
    .slice(0, 60), [issues, byProject, query])
  return <SearchList title="Embed an issue" placeholder="Search issues by key or title…" query={query} setQuery={setQuery} items={items} getKey={(issue) => issue.id}
    loading={!isInitialized || isLoading} error={error ?? ''} onBack={onBack} empty={issues.length ? 'No issue matches.' : 'There are no issues in your projects yet.'}
    onChoose={(issue) => commit((chain) => chain.insertIssue({ issueId: issue.id, projectId: issue.projectId, key: issueKey(issue, byProject), title: issue.title, status: issue.status }))}
    renderItem={(issue) => <>
      <span className={cn('size-2 shrink-0 rounded-full', STATUS_FILL[issue.status])} aria-hidden="true" />
      <span className="w-[4.5rem] shrink-0 truncate font-mono text-[11.5px] font-semibold text-ink-muted dark:text-ink-inverse-muted">{issueKey(issue, byProject)}</span>
      <RowText title={issue.title || 'Untitled issue'} detail={`${ISSUE_STATUS_CONFIG[issue.status]?.label ?? issue.status} · ${byProject.get(issue.projectId)?.name ?? 'Project'}`} />
    </>} />
}

function ChatStep({ commit, onBack }: StepProps) {
  const userId = useAuthStore((state) => state.user?.id || 'default')
  const guest = isGuestUserId(userId)
  const list = useThreads(guest ? null : userId, true)
  const [query, setQuery] = useState('')
  if (guest || list.data.signInRequired) return <div className="overflow-y-auto">
    <StepHeader title="Reference a chat" onBack={onBack} />
    <div className="space-y-2 px-3 pb-3 text-[13px] text-ink-secondary dark:text-ink-inverse-secondary">
      <p>Agent Panel chats are kept for signed-in accounts. Sign in to reference one here.</p>
      <button type="button" autoFocus onClick={() => openSignIn()} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onBack() } }}
        className="h-8 rounded-md bg-accent px-3 text-[12.5px] font-medium text-white hover:opacity-90">Sign in</button>
    </div>
  </div>
  const items = list.data.threads.filter((thread) => matchesAll([thread.title], query)).slice(0, 60)
  return <SearchList title="Reference a chat" placeholder="Search your Agent Panel chats…" query={query} setQuery={setQuery} items={items} getKey={(thread) => thread.session_id}
    loading={list.status === 'loading'} error={list.status === 'error' ? list.error : ''} onBack={onBack}
    empty={list.data.threads.length ? 'No chat matches.' : 'No Agent Panel chats yet.'}
    onChoose={(thread) => commit((chain) => chain.insertChatReference({
      sessionId: thread.session_id, ownerId: userId, title: thread.title || 'Untitled thread', messageCount: thread.message_count, updatedAt: thread.updated_at,
    }))}
    renderItem={(thread) => <><MessageSquareText className="size-4 shrink-0 text-ink-muted" />
      <RowText title={thread.title || 'Untitled thread'} detail={`${thread.message_count} ${thread.message_count === 1 ? 'message' : 'messages'} · ${relativeTime(thread.updated_at)}`} /></>} />
}

function PageStep({ commit, onBack }: StepProps) {
  const { userId, projects } = useProjectsStore()
  const pages = useProjectPages(userId, true)
  const [query, setQuery] = useState('')
  const names = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const items = useMemo(() => [...pages.data].sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((page) => matchesAll([page.title || UNTITLED, page.projectId ? names.get(page.projectId) : 'My documents'], query)).slice(0, 60), [pages.data, names, query])
  return <SearchList title="Link to page" placeholder="Search your documents…" query={query} setQuery={setQuery} items={items} getKey={(page) => page.id}
    loading={pages.status === 'loading'} error={pages.status === 'error' ? pages.error : ''} onBack={onBack}
    empty={pages.data.length ? 'No page matches.' : 'There are no project pages yet.'}
    onChoose={(page) => commit((chain) => chain.insertPageLink({ documentId: page.id, projectId: page.projectId, title: page.title || UNTITLED }))}
    renderItem={(page) => <><FileText className="size-4 shrink-0 text-ink-muted" />
      <RowText title={page.title || UNTITLED} detail={page.projectId ? names.get(page.projectId) ?? 'Project page' : 'My documents'} /></>} />
}
