import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowUpTrayIcon, CameraIcon, ChatBubbleLeftRightIcon, DocumentTextIcon, FilmIcon, LinkIcon, MagnifyingGlassIcon,
  NewspaperIcon, PencilSquareIcon, PhotoIcon, StopIcon, TrashIcon, VideoCameraIcon, ChatBubbleBottomCenterTextIcon, PaperClipIcon,
} from '@heroicons/react/24/outline'
import { useAgentUi } from '@/context/AgentUiContext'
import { API_BASE_URL } from '@/lib/api-base'
import { createContextClient, formatBytes, type ContextItem, type ContextKind } from '@/lib/context-api'
import { kindLabel } from '@/lib/issue-attachments'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { cn } from '@/utils/cn'
import { SendToIssue } from './SendToIssue'

const KIND_ICONS: Partial<Record<ContextKind, typeof LinkIcon>> = {
  search: MagnifyingGlassIcon, article: NewspaperIcon, link: LinkIcon, image: PhotoIcon, video: FilmIcon,
  selection: ChatBubbleBottomCenterTextIcon, thread: ChatBubbleLeftRightIcon, document: DocumentTextIcon,
  screenshot: CameraIcon, recording: VideoCameraIcon, file: PaperClipIcon, note: PencilSquareIcon,
}
const MAX_PROMPT_CHARS = 24_000
const field = 'w-full rounded-md border border-zinc-200 bg-white/70 px-2 py-1.5 text-xs text-ron-text outline-none focus:border-royal dark:border-white/10 dark:bg-white/5 dark:text-white'
const toolButton = 'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-raleway text-ron-text/70 hover:bg-zinc-100 disabled:opacity-40 dark:text-white/70 dark:hover:bg-white/5'

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
    <div className="flex flex-wrap items-center gap-1 px-3 py-2" role="toolbar" aria-label="Add context">
      <button type="button" className={toolButton} onClick={() => void captureScreenshot()} disabled={Boolean(busy)}><CameraIcon className="h-4 w-4" />Screenshot</button>
      {recordingSince
        ? <button type="button" className={cn(toolButton, 'text-red-600 dark:text-red-400')} onClick={() => void stopRecording()}><StopIcon className="h-4 w-4" />Stop {elapsed(recordingSince, now)}</button>
        : <button type="button" className={toolButton} onClick={() => void startRecording()}><VideoCameraIcon className="h-4 w-4" />Record screen</button>}
      <button type="button" className={toolButton} onClick={() => setForm(form === 'link' ? null : 'link')}><LinkIcon className="h-4 w-4" />Link</button>
      <button type="button" className={toolButton} onClick={() => setForm(form === 'note' ? null : 'note')}><PencilSquareIcon className="h-4 w-4" />Note</button>
      <button type="button" className={toolButton} onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}><ArrowUpTrayIcon className="h-4 w-4" />Upload</button>
      <input ref={fileInput} type="file" multiple hidden aria-label="Upload files to context" accept="image/*,video/*,.pdf,.txt,.md,.csv,.json"
        onChange={(event) => void upload(event.target.files)} />
    </div>

    {form && <form onSubmit={(event) => void submit(event)} className="mx-3 mb-2 space-y-1.5 rounded-lg border border-zinc-200 p-2 dark:border-white/10">
      {form === 'link'
        ? <input aria-label="Link URL" className={field} placeholder="https://…" value={url} onChange={(event) => setUrl(event.target.value)} autoFocus />
        : <textarea aria-label="Note" className={cn(field, 'h-16 resize-none')} placeholder="What should Ren know?" value={text} onChange={(event) => setText(event.target.value)} autoFocus />}
      <div className="flex gap-1.5">
        <input aria-label="Title" className={field} placeholder="Title (optional)" value={title} onChange={(event) => setTitle(event.target.value)} />
        <button type="submit" disabled={Boolean(busy) || (form === 'link' ? !/^https?:\/\//i.test(url.trim()) : !text.trim())}
          className="rounded-md bg-royal px-3 text-xs font-raleway font-raleway-bold text-white disabled:opacity-40 dark:bg-royal-light">Add</button>
      </div>
    </form>}

    {sending && <div className="mx-3 mb-2"><SendToIssue items={sending} onCancel={() => setSending(null)}
      onDone={(message) => { setSending(null); setSelected([]); useContextAgentStore.setState({ notice: message }) }} /></div>}

    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-2" aria-label="Your context">
      {itemsLoaded && !items.length && <p className="px-1 py-6 text-center text-xs text-ron-text/50 dark:text-white/50">
        Nothing here yet. Capture this page, record your screen, add a link or a note, or right-click any page → Add to Ren context.</p>}
      {items.map((item) => {
        const Icon = KIND_ICONS[item.kind] ?? DocumentTextIcon
        const isSelected = selected.includes(item.id)
        const visual = item.file && (item.file.media_type.startsWith('image/'))
        return <div key={item.id} data-testid="context-item" className={cn('group flex gap-2 rounded-lg p-2', isSelected ? 'bg-royal/10' : 'hover:bg-zinc-100/70 dark:hover:bg-white/5')}>
          <input type="checkbox" aria-label={`Select ${item.title}`} checked={isSelected} className="mt-1 accent-[#6b3420]"
            onChange={() => setSelected(isSelected ? selected.filter((id) => id !== item.id) : [...selected, item.id])} />
          {visual
            ? <img src={client.fileUrl(item.id)} alt="" className="h-10 w-14 flex-shrink-0 rounded object-cover" loading="lazy" />
            : <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-royal dark:text-royal-light" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-raleway font-raleway-bold text-ron-text dark:text-white" title={item.title}>{item.title || item.id}</p>
            <p className="truncate text-[10px] text-ron-text/50 dark:text-white/50">
              {kindLabel(item.kind)}{hostOf(item.source) ? ` · ${hostOf(item.source)}` : ''}{item.file ? ` · ${formatBytes(item.file.size)}` : ''} · {new Date(item.added).toLocaleString()}
            </p>
            {item.preview && !item.file && <p className="line-clamp-2 text-[10px] text-ron-text/60 dark:text-white/60">{item.preview}</p>}
          </div>
          <div className="flex flex-shrink-0 items-start gap-1 opacity-60 focus-within:opacity-100 group-hover:opacity-100">
            {item.file && <a href={client.fileUrl(item.id)} target="_blank" rel="noreferrer" className="rounded p-1.5 text-[10px] text-ron-text/70 hover:bg-zinc-200 dark:text-white/70 dark:hover:bg-white/10" title="Open file">Open</a>}
            <button type="button" title="Send to an issue" aria-label={`Send ${item.title} to an issue`} onClick={() => setSending([item])} className="rounded p-1.5 text-[10px] text-ron-text/70 hover:bg-zinc-200 dark:text-white/70 dark:hover:bg-white/10">Issue</button>
            <button type="button" title="Ask Ren about this" aria-label={`Ask Ren about ${item.title}`} onClick={() => void askRon([item])} className="rounded p-1.5 text-ron-text/70 hover:bg-zinc-200 dark:text-white/70 dark:hover:bg-white/10"><ChatBubbleLeftRightIcon className="h-3.5 w-3.5" /></button>
            {/* One element in both states, so focus stays on it between the two clicks. */}
            {confirmDelete === item.id
              ? <button type="button" title="Click again to delete it" onClick={() => { setConfirmDelete(null); void removeContext(item.id) }}
                  onBlur={() => setConfirmDelete(null)}
                  className="rounded px-1.5 py-1 text-[10px] font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">
                  Delete<span className="sr-only"> {item.title || item.id}</span>?
                </button>
              : <button type="button" title="Remove" aria-label={`Remove ${item.title}`} onClick={() => setConfirmDelete(item.id)}
                  className="rounded p-1.5 text-ron-text/70 hover:bg-zinc-200 hover:text-red-600 dark:text-white/70 dark:hover:bg-white/10"><TrashIcon className="h-3.5 w-3.5" /></button>}
          </div>
        </div>
      })}
    </div>

    {chosen.length > 0 && !sending && <div className="flex items-center justify-between gap-2 border-t border-zinc-200/60 px-3 py-2 dark:border-white/10">
      <span className="text-[11px] text-ron-text/60 dark:text-white/60">{chosen.length} selected</span>
      <div className="flex gap-1.5">
        <button type="button" onClick={() => void askRon(chosen)} className="rounded-md px-2 py-1 text-[11px] text-royal hover:bg-royal/10 dark:text-royal-light">Ask Ren</button>
        <button type="button" onClick={() => setSending(chosen)} className="rounded-md bg-royal px-2 py-1 text-[11px] font-raleway font-raleway-bold text-white dark:bg-royal-light">Send to issue</button>
      </div>
    </div>}
  </div>
}
