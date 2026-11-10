import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowTopRightOnSquareIcon, ArrowUpTrayIcon, CameraIcon, ClipboardDocumentListIcon, ChatBubbleLeftRightIcon, DocumentTextIcon, FilmIcon, LinkIcon, MagnifyingGlassIcon,
  NewspaperIcon, PencilSquareIcon, PhotoIcon, StopIcon, TrashIcon, VideoCameraIcon, ChatBubbleBottomCenterTextIcon, PaperClipIcon,
} from '@heroicons/react/24/outline'
import { useAgentUi } from '@/context/AgentUiContext'
import { API_BASE_URL } from '@/lib/api-base'
import { createContextClient, formatBytes, type ContextItem, type ContextKind } from '@/lib/context-api'
import { kindLabel } from '@/lib/issue-attachments'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { cn } from '@/utils/cn'
import { SendToIssue } from './SendToIssue'
import { field, ghostButton, iconButton, mutedText, primaryButton } from './contextUi'

const KIND_ICONS: Partial<Record<ContextKind, typeof LinkIcon>> = {
  search: MagnifyingGlassIcon, article: NewspaperIcon, link: LinkIcon, image: PhotoIcon, video: FilmIcon,
  selection: ChatBubbleBottomCenterTextIcon, thread: ChatBubbleLeftRightIcon, document: DocumentTextIcon,
  screenshot: CameraIcon, recording: VideoCameraIcon, file: PaperClipIcon, note: PencilSquareIcon,
}
const MAX_PROMPT_CHARS = 24_000

const hostOf = (value: string) => { try { return new URL(value).hostname } catch { return '' } }
const elapsed = (since: number, now: number) => {
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function ContextTray() {
  const userId = useContextAgentStore((state) => state.userId)
  const items = useContextAgentStore((state) => state.items)
  const itemsLoaded = useContextAgentStore((state) => state.itemsLoaded)
  const busy = useContextAgentStore((state) => state.busy)
  const recordingSince = useContextAgentStore((state) => state.recordingSince)
  const { addContext, uploadContext, removeContext, captureScreenshot, startRecording, stopRecording, yieldToPanel } = useContextAgentStore.getState()
  const { sendToAgentPanel } = useAgentUi()
  const [form, setForm] = useState<null | 'link' | 'note'>(null)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [sending, setSending] = useState<ContextItem[] | null>(null)
  const [now, setNow] = useState(Date.now())
  /** Item whose Remove button is armed: removing a saved item takes a second click within 4 s. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!recordingSince) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [recordingSince])
  useEffect(() => {
    if (!confirmDelete) return
    const timer = window.setTimeout(() => setConfirmDelete(null), 4000)
    return () => window.clearTimeout(timer)
  }, [confirmDelete])
  useEffect(() => { setSelected((ids) => ids.filter((id) => items.some((item) => item.id === id))) }, [items])

  const chosen = items.filter((item) => selected.includes(item.id))
  const client = createContextClient(API_BASE_URL, userId)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const added = form === 'link'
      ? await addContext({ kind: 'link', url: url.trim(), title: title.trim() })
      : await addContext({ kind: 'note', title: title.trim(), text: text.trim() })
    if (added) { setForm(null); setUrl(''); setTitle(''); setText('') }
  }

  const upload = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file'
      await uploadContext({ kind, blob: file, name: file.name, title: file.name })
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  const askRon = async (targets: ContextItem[]) => {
    const parts: string[] = []
    let budget = MAX_PROMPT_CHARS
    for (const item of targets) {
      const markdown = await client.markdown(item.id).catch(() => `# ${item.id} ${item.title}`)
      const clipped = markdown.length > budget ? `${markdown.slice(0, Math.max(0, budget))}\n\n…(truncated; the full item is in my context store as ${item.id})` : markdown
      budget -= clipped.length
      parts.push(clipped)
      if (budget <= 0) break
    }
    sendToAgentPanel(`Here is context I saved (${targets.length} item${targets.length === 1 ? '' : 's'}). Read it and help me with it.\n\n${parts.join('\n\n---\n\n')}`)
    yieldToPanel()
  }

  return <div className="flex h-full flex-col">
    <div className="flex items-center gap-0.5 px-3 py-2" role="toolbar" aria-label="Add context">
      <button type="button" className={iconButton} title="Screenshot this page" aria-label="Screenshot" onClick={() => void captureScreenshot()} disabled={Boolean(busy)}><CameraIcon className="h-4 w-4" /></button>
      {recordingSince
        ? <button type="button" className={cn(ghostButton, 'gap-1.5 text-red-600 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400')} onClick={() => void stopRecording()}><StopIcon className="h-4 w-4" />Stop {elapsed(recordingSince, now)}</button>
        : <button type="button" className={iconButton} title="Record screen" aria-label="Record screen" onClick={() => void startRecording()}><VideoCameraIcon className="h-4 w-4" /></button>}
      <button type="button" className={cn(iconButton, form === 'link' && 'bg-surface-100 text-ink dark:bg-surface-850 dark:text-ink-inverse')} title="Add a link" aria-label="Link" aria-pressed={form === 'link'} onClick={() => setForm(form === 'link' ? null : 'link')}><LinkIcon className="h-4 w-4" /></button>
      <button type="button" className={cn(iconButton, form === 'note' && 'bg-surface-100 text-ink dark:bg-surface-850 dark:text-ink-inverse')} title="Add a note" aria-label="Note" aria-pressed={form === 'note'} onClick={() => setForm(form === 'note' ? null : 'note')}><PencilSquareIcon className="h-4 w-4" /></button>
      <button type="button" className={iconButton} title="Upload files" aria-label="Upload" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}><ArrowUpTrayIcon className="h-4 w-4" /></button>
      <input ref={fileInput} type="file" multiple hidden aria-label="Upload files to context" accept="image/*,video/*,.pdf,.txt,.md,.csv,.json"
        onChange={(event) => void upload(event.target.files)} />
    </div>

    {form && <form onSubmit={(event) => void submit(event)} className="mx-3 mb-2 space-y-1.5">
      {form === 'link'
        ? <input aria-label="Link URL" className={field} placeholder="https://…" value={url} onChange={(event) => setUrl(event.target.value)} autoFocus />
        : <textarea aria-label="Note" className={cn(field, 'h-16 resize-none')} placeholder="What should Ren know?" value={text} onChange={(event) => setText(event.target.value)} autoFocus />}
      <div className="flex items-center gap-1.5">
        <input aria-label="Title" className={field} placeholder="Title (optional)" value={title} onChange={(event) => setTitle(event.target.value)} />
        <button type="submit" disabled={Boolean(busy) || (form === 'link' ? !/^https?:\/\//i.test(url.trim()) : !text.trim())} className={primaryButton}>Add</button>
      </div>
    </form>}

    {sending && <div className="mx-3 mb-2"><SendToIssue items={sending} onCancel={() => setSending(null)}
      onDone={(message) => { setSending(null); setSelected([]); useContextAgentStore.setState({ notice: message }) }} /></div>}

    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Your context">
      {itemsLoaded && !items.length && <p className={cn(mutedText, 'px-2 py-8 text-center')}>Nothing saved yet. Capture, record, or add a link or note above.</p>}
      {items.map((item) => {
        const Icon = KIND_ICONS[item.kind] ?? DocumentTextIcon
        const isSelected = selected.includes(item.id)
        const visual = item.file && (item.file.media_type.startsWith('image/'))
        return <div key={item.id} data-testid="context-item" className={cn('group flex items-center gap-2.5 rounded-lg px-2 py-1.5', isSelected ? 'bg-blurple-600/10 dark:bg-blurple-400/15' : 'hover:bg-surface-100 dark:hover:bg-surface-850')}>
          <input type="checkbox" aria-label={`Select ${item.title}`} checked={isSelected} className="h-3.5 w-3.5 flex-shrink-0 accent-blurple-600 dark:accent-blurple-400"
            onChange={() => setSelected(isSelected ? selected.filter((id) => id !== item.id) : [...selected, item.id])} />
          {visual
            ? <img src={client.fileUrl(item.id)} alt="" className="h-8 w-11 flex-shrink-0 rounded object-cover" loading="lazy" />
            : <Icon className="h-4 w-4 flex-shrink-0 text-ink-muted dark:text-ink-inverse-muted" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink dark:text-ink-inverse" title={item.title}>{item.title || item.id}</p>
            <p className="truncate text-[11px] text-ink-muted dark:text-ink-inverse-muted" title={item.preview && !item.file ? item.preview : undefined}>
              {kindLabel(item.kind)}{hostOf(item.source) ? ` · ${hostOf(item.source)}` : ''}{item.file ? ` · ${formatBytes(item.file.size)}` : ''} · {new Date(item.added).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {item.file && <a href={client.fileUrl(item.id)} target="_blank" rel="noreferrer" className={iconButton} title="Open file" aria-label={`Open ${item.title}`}><ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" /></a>}
            <button type="button" title="Send to an issue" aria-label={`Send ${item.title} to an issue`} onClick={() => setSending([item])} className={iconButton}><ClipboardDocumentListIcon className="h-3.5 w-3.5" /></button>
            <button type="button" title="Ask Ren about this" aria-label={`Ask Ren about ${item.title}`} onClick={() => void askRon([item])} className={iconButton}><ChatBubbleLeftRightIcon className="h-3.5 w-3.5" /></button>
            {/* One element in both states, so focus stays on it between the two clicks. */}
            {confirmDelete === item.id
              ? <button type="button" title="Click again to delete it" onClick={() => { setConfirmDelete(null); void removeContext(item.id) }}
                  onBlur={() => setConfirmDelete(null)}
                  className="inline-flex h-7 items-center rounded-lg px-2 text-[11px] font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">
                  Delete<span className="sr-only"> {item.title || item.id}</span>?
                </button>
              : <button type="button" title="Remove" aria-label={`Remove ${item.title}`} onClick={() => setConfirmDelete(item.id)}
                  className={cn(iconButton, 'hover:text-red-600 dark:hover:text-red-400')}><TrashIcon className="h-3.5 w-3.5" /></button>}
          </div>
        </div>
      })}
    </div>

    {chosen.length > 0 && !sending && <div className="flex items-center justify-between gap-2 border-t border-surface-200 px-4 py-2 dark:border-surface-800">
      <span className="text-[12px] tabular-nums text-ink-secondary dark:text-ink-inverse-secondary">{chosen.length} selected</span>
      <div className="flex gap-1">
        <button type="button" onClick={() => setSending(chosen)} className={ghostButton}>Send to issue</button>
        <button type="button" onClick={() => void askRon(chosen)} className={primaryButton}>Ask Ren</button>
      </div>
    </div>}
  </div>
}
