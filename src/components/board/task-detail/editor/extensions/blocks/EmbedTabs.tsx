import { useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Clapperboard, ExternalLink, Figma, FileText, Film, Globe, HardDrive, Loader2, MapPin, Music, Plus, Trash2, Upload, Video, Workflow, Youtube, X } from 'lucide-react'
import { EMBED_PROVIDERS, pdfSource, safeEmbedSrc } from '@/lib/editor-blocks'
import { EMBEDS_FENCE, TAB_KINDS, embedTabsMarkdown, tabNode, tabSummary, tabsFromFence, youtubeEmbedUrl, type DocNode, type TabKind } from '@/lib/document-ron'
import { starterWorkflow } from '@/lib/workflow'
import { cn } from '@/lib/utils'
import { pdfDataUrl } from '../../SlashCommandMenu'
import { placeBlock } from './commands'
import { openExternalUrl } from './workspace'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embedTabs: {
      /** An Embed tabs block where the cursor's block is; it opens on its Add row. */
      insertEmbedTabs: () => ReturnType
    }
  }
}

const ICONS: Record<TabKind, typeof Globe> = {
  web: Globe, maps: MapPin, figma: Figma, loom: Video, vimeo: Film, drive: HardDrive,
  youtube: Youtube, video: Clapperboard, audio: Music, pdf: FileText, workflow: Workflow,
}
const PLACEHOLDERS: Record<Exclude<TabKind, 'workflow'>, string> = {
  web: EMBED_PROVIDERS.web.placeholder, maps: EMBED_PROVIDERS.maps.placeholder, figma: EMBED_PROVIDERS.figma.placeholder,
  loom: EMBED_PROVIDERS.loom.placeholder, vimeo: EMBED_PROVIDERS.vimeo.placeholder, drive: EMBED_PROVIDERS.drive.placeholder,
  youtube: 'https://www.youtube.com/watch?v=…',
  video: 'https://example.com/clip.mp4',
  audio: 'https://example.com/episode.mp3',
  pdf: 'https://example.com/report.pdf',
}

/** The ```embeds fence a `<pre>` holds (Markdown written by an agent and stored as HTML), or null. */
function fenceBody(element: HTMLElement): string | null {
  const code = element.querySelector(':scope > code')
  return code && code.classList.contains(`language-${EMBEDS_FENCE}`) ? code.textContent ?? '' : null
}

/** Where a tab's own content points, for Open in new tab. */
function tabHref(child: PMNode): string {
  if (child.type.name === 'embed') return safeEmbedSrc(child.attrs["url"]) || safeEmbedSrc(child.attrs["src"])
  if (child.type.name === 'youtube') return youtubeEmbedUrl(String(child.attrs["src"] ?? '')) ?? ''
  if (child.type.name === 'media') return safeEmbedSrc(child.attrs["src"])
  if (child.type.name === 'pdf') { const source = pdfSource(child.attrs["src"]); return source?.kind === 'url' ? source.src : '' }
  return ''
}

/**
 * NOT NATIVE: Embed tabs, from "/" Embed tabs. Any number of embeds (pages, maps, Figma, Loom, Vimeo, Google
 * Drive), YouTube videos, video and audio files, PDFs and workflows in one frame with a tab each; only the open
 * tab shows. Every tab is the block it would be on its own (nodes in the `embedTab` group), so the saved HTML is
 * `<div data-type="embed-tabs">` around their own elements and nothing is hidden from a reader without the editor.
 * Markdown, both ways, is one ```embeds fence (`embedTabsMarkdown`, `tabsFromFence`): agents read it from the page
 * and write it, and HTML an agent's Markdown became (`<pre><code class="language-embeds">`) opens as this block.
 */
export const EmbedTabs = Node.create({
  name: 'embedTabs',
  group: 'block',
  content: 'embedTab*',
  draggable: true,
  isolating: true,

  parseHTML() {
    return [
      { tag: 'div[data-type="embed-tabs"]' },
      {
        tag: 'pre',
        priority: 60,
        getAttrs: (element) => (fenceBody(element) === null ? false : null),
        getContent: (element, schema) => Fragment.fromArray(tabsFromFence(fenceBody(element as HTMLElement) ?? '')
          .filter((tab) => !!tab.type && !!schema.nodes[tab.type])
          .map((tab) => schema.nodeFromJSON(tab))),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'embed-tabs' }), 0]
  },

  renderMarkdown: (node) => embedTabsMarkdown((node.content ?? []).map(({ type, attrs }) => ({
    ...(type !== undefined ? { type } : {}),
    ...(attrs !== undefined ? { attrs } : {}),
  }))),

  addCommands() {
    return {
      insertEmbedTabs: () => placeBlock((schema) => schema.nodes["embedTabs"]?.create() ?? null),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedTabsView)
  },
})

let views = 0

function EmbedTabsView({ node, editor, getPos, selected, deleteNode }: NodeViewProps) {
  const [scope] = useState(() => `t${(views += 1)}`)
  const [active, setActive] = useState(0)
  const [adding, setAdding] = useState(node.childCount === 0)
  const tabList = useRef<HTMLDivElement>(null)
  const editable = editor.isEditable
  const children: PMNode[] = []
  node.forEach((child) => { children.push(child) })
  const open = Math.min(active, Math.max(0, children.length - 1))
  const current = children[open]
  const href = current ? tabHref(current) : ''
  const showForm = editable && (adding || children.length === 0)

  /** Document position of the tab at `index` (the block's start, its opening token, then the tabs before it). */
  const tabPos = (index: number): number | null => {
    const start = getPos()
    if (typeof start !== 'number') return null
    return children.slice(0, index).reduce((at, child) => at + child.nodeSize, start + 1)
  }

  const add = (tab: DocNode) => {
    const at = tabPos(children.length)
    if (at === null) return
    editor.chain().insertContentAt(at, tab).run()
    setActive(children.length)
    setAdding(false)
  }

  const remove = () => {
    const at = tabPos(open)
    if (at === null || !current) return
    editor.chain().deleteRange({ from: at, to: at + current.nodeSize }).run()
    setActive(Math.max(0, open - 1))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' || children.length < 2) return
    event.preventDefault()
    const next = (open + (event.key === 'ArrowRight' ? 1 : -1) + children.length) % children.length
    setActive(next)
    tabList.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  return <NodeViewWrapper data-embed-tabs={scope} data-selected={selected ? 'true' : undefined}
    className={cn('ren-embed-tabs ren-glass group/tabs not-prose my-5 overflow-hidden rounded-2xl', selected && 'ren-glass-selected')}>
    {/* Only the open tab shows; the others stay in the document (and their iframes keep their state). */}
    <style>{`[data-embed-tabs="${scope}"] [data-node-view-content-react] > :not(:nth-child(${open + 1})) { display: none; }`}</style>
    <div contentEditable={false} className="flex items-center gap-2 px-2 pt-2">
      <div ref={tabList} role="tablist" aria-label="Embeds" onKeyDown={onKeyDown}
        className="ren-tab-rail flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-xl p-1 [scrollbar-width:none]">
        {children.map((child, index) => {
          const { kind, title } = tabSummary({ type: child.type.name, attrs: child.attrs })
          const Icon = ICONS[kind]
          const label = TAB_KINDS.find((entry) => entry.kind === kind)?.label ?? 'Embed'
          const selectedTab = index === open && !showForm
          return <button key={index} type="button" role="tab" aria-selected={selectedTab} tabIndex={index === open ? 0 : -1}
            title={title ? `${label}: ${title}` : label} onClick={() => { setActive(index); setAdding(false) }}
            className={cn('ren-tab flex h-8 max-w-[14rem] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium', selectedTab && 'is-active')}>
            <Icon className="size-3.5 shrink-0" strokeWidth={2} />
            <span className="truncate">{title || label}</span>
          </button>
        })}
        {children.length === 0 && <span className="px-2 text-[12.5px] font-medium text-ink-muted dark:text-ink-inverse-muted">Embed tabs: pick what to show first</span>}
        {editable && children.length > 0 && <button type="button" aria-label="Add a tab" title="Add a tab" aria-pressed={showForm}
          onClick={() => setAdding((value) => !value || children.length === 0)}
          className={cn('ren-tab flex size-8 shrink-0 items-center justify-center rounded-lg', showForm && 'is-active')}>
          <Plus className="size-4" strokeWidth={2} />
        </button>}
      </div>
      <div className={cn('flex shrink-0 items-center gap-0.5 transition-opacity duration-150', children.length > 0 && 'opacity-0 focus-within:opacity-100 group-hover/tabs:opacity-100 group-data-[selected=true]/tabs:opacity-100')}>
        {href && !showForm && <TabAction label="Open in new tab" onClick={() => openExternalUrl(href)}><ExternalLink className="size-4" /></TabAction>}
        {editable && current && !showForm && <TabAction label="Remove this tab" onClick={remove}><Trash2 className="size-4" /></TabAction>}
        {editable && <TabAction label="Remove all tabs" onClick={() => deleteNode()}><X className="size-4" /></TabAction>}
      </div>
    </div>
    {showForm && <AddTab editor={editor} autoFocus={children.length === 0} onAdd={add} />}
    <div className={cn('ren-tab-panel m-2 mt-2 overflow-hidden rounded-xl', (showForm || children.length === 0) && 'hidden')} role="tabpanel">
      <NodeViewContent />
    </div>
  </NodeViewWrapper>
}

function TabAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick}
    className="flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-[rgb(var(--ren-volt)/0.1)] hover:text-volt dark:text-ink-inverse-muted">
    {children}
  </button>
}

/** The Add row: pick a kind, paste its link (or upload a PDF); a workflow starts from the starter graph. */
function AddTab({ editor, autoFocus, onAdd }: { editor: NodeViewProps['editor']; autoFocus: boolean; onAdd: (tab: DocNode) => void }) {
  const kinds = TAB_KINDS.filter((entry) => entry.kind !== 'workflow' || !!editor.schema.nodes["workflow"])
  const [kind, setKind] = useState<TabKind>('web')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const upload = useRef<HTMLInputElement>(null)

  const submit = () => {
    if (kind === 'workflow') { onAdd({ type: 'workflow', attrs: { title: 'Workflow', graph: starterWorkflow() } }); return }
    if (!value.trim()) { setError('Paste a link first.'); return }
    const built = tabNode(kind, value)
    if (!built.ok) { setError(built.error); return }
    onAdd(built.value)
    setValue('')
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try {
      onAdd({ type: 'pdf', attrs: { src: await pdfDataUrl(file), name: file.name, size: file.size } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return <form contentEditable={false} className="space-y-3 px-3 pb-3.5 pt-3" onSubmit={(event) => { event.preventDefault(); submit() }}>
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What to embed">
      {kinds.map((entry) => {
        const Icon = ICONS[entry.kind]
        return <button key={entry.kind} type="button" role="radio" aria-checked={kind === entry.kind}
          onClick={() => { setKind(entry.kind); setError('') }}
          className={cn('ren-chip flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium', kind === entry.kind && 'is-active')}>
          <Icon className="size-3.5" strokeWidth={2} />{entry.chip}
        </button>
      })}
    </div>
    {kind === 'workflow'
      ? <button type="submit" className="ren-add-button flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold"><Plus className="size-4" />Add a workflow</button>
      : <div className="flex items-center gap-2">
          <input autoFocus={autoFocus} value={value} aria-label={`${TAB_KINDS.find((entry) => entry.kind === kind)?.label ?? 'Embed'} link`}
            placeholder={PLACEHOLDERS[kind]} aria-invalid={!!error}
            onChange={(event) => { setValue(event.target.value); setError('') }}
            className="ren-tab-input h-9 min-w-0 flex-1 rounded-lg px-3 text-[13px] outline-none" />
          {kind === 'pdf' && <>
            <input ref={upload} type="file" className="hidden" tabIndex={-1} aria-hidden="true" accept="application/pdf,.pdf" onChange={(event) => { void onFile(event) }} />
            <button type="button" disabled={busy} onClick={() => upload.current?.click()} title="Upload a PDF" aria-label="Upload a PDF"
              className="ren-chip flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium disabled:opacity-50">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}Upload
            </button>
          </>}
          <button type="submit" disabled={busy} className="ren-add-button flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold disabled:opacity-50">
            <Plus className="size-4" />Add tab
          </button>
        </div>}
    {error && <p role="alert" className="text-[12px] font-medium text-blurple-800 dark:text-blurple-300">{error}</p>}
  </form>
}
