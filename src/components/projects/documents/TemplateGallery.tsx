import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { RenIcon } from '@/components/brand'
import type { Extensions } from '@tiptap/core'
import { Activity, BookOpen, Bug, ClipboardList, Cpu, File, Flag, RefreshCcw, Scale, Search, Sun, Target, Users, type LucideIcon } from 'lucide-react'
import { NotionEditor } from '@/components/board/task-detail/editor/NotionEditor'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  DOCUMENT_TEMPLATES, TEMPLATE_CATEGORIES, instantiateTemplate, searchTemplates, type DocumentTemplate, type TemplateIcon,
} from '@/lib/document-templates'
import { cn } from '@/lib/utils'

const ICONS: Record<TemplateIcon, LucideIcon> = {
  file: File, users: Users, target: Target, clipboard: ClipboardList, cpu: Cpu, refresh: RefreshCcw, activity: Activity,
  scale: Scale, bug: Bug, search: Search, sun: Sun, flag: Flag, book: BookOpen, ren: RenIcon,
}
const noop = () => undefined

/**
 * Choose how a page starts: blank or from a template (`src/lib/document-templates.ts`). A searchable list with a
 * live, read-only preview rendered by the same editor the page uses. The search field drives the list as a
 * combobox: ↑/↓ move, Enter uses the highlighted template, double-click uses one directly.
 */
export function TemplateGallery({ open, onOpenChange, onChoose, mode, extensions }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChoose: (template: DocumentTemplate) => void
  /** `new` creates a page; `apply` fills the empty page that is open. */
  mode: 'new' | 'apply'
  /** The page editor's extra blocks, so the preview renders workflows as the page will. */
  extensions: Extensions
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(mode === 'apply' ? DOCUMENT_TEMPLATES[1].id : DOCUMENT_TEMPLATES[0].id)
  const listRef = useRef<HTMLDivElement>(null)
  const templates = useMemo(() => searchTemplates(query).filter((template) => mode === 'new' || template.id !== 'blank'), [query, mode])
  const selected = templates.find((template) => template.id === selectedId) ?? templates[0]
  const groups = useMemo(() => TEMPLATE_CATEGORIES
    .map((category) => ({ category, items: templates.filter((template) => template.category === category) }))
    .filter((group) => group.items.length > 0), [templates])
  const ordered = useMemo(() => groups.flatMap((group) => group.items), [groups])
  const preview = useMemo(() => (selected ? instantiateTemplate(selected, new Date(), () => 'template-preview') : null), [selected])

  useEffect(() => { if (open) { setQuery(''); setSelectedId(mode === 'apply' ? DOCUMENT_TEMPLATES[1].id : DOCUMENT_TEMPLATES[0].id) } }, [open, mode])
  useEffect(() => {
    if (selected) listRef.current?.querySelector<HTMLElement>(`[data-template="${selected.id}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const use = (template: DocumentTemplate | undefined) => {
    if (!template) return
    onChoose(template)
    onOpenChange(false)
  }
  const move = (delta: number) => {
    if (!ordered.length) return
    const index = Math.max(0, ordered.findIndex((template) => template.id === selected?.id))
    setSelectedId(ordered[(index + delta + ordered.length) % ordered.length].id)
  }
  const optionId = (template: DocumentTemplate) => `${id}-template-${template.id}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent overlayClassName="z-[220] bg-surface-900/50 backdrop-blur-sm"
        className="z-[221] flex h-[min(760px,calc(100vh-2rem))] w-[calc(100%-2rem)] max-w-5xl flex-col gap-0 overflow-hidden rounded-2xl bg-surface-0 p-0 text-ink dark:bg-surface-900 dark:text-ink-inverse">
        <div className="border-b border-surface-200/70 px-6 pb-4 pt-5 dark:border-surface-700/70">
          <DialogTitle className="font-display text-xl">{mode === 'new' ? 'New page' : 'Use a template'}</DialogTitle>
          <DialogDescription className="mt-1 text-body-sm text-ink-secondary dark:text-ink-inverse-secondary">
            {mode === 'new' ? 'Start blank or from a template. Everything in a template can be edited.' : 'Fill this empty page with a template’s structure.'}
          </DialogDescription>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted dark:text-ink-inverse-muted" aria-hidden />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search templates"
              role="combobox" aria-label="Search templates" aria-expanded="true" aria-controls={`${id}-list`} aria-autocomplete="list"
              aria-activedescendant={selected ? optionId(selected) : undefined} autoFocus
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') { event.preventDefault(); move(1) }
                if (event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
                if (event.key === 'Enter') { event.preventDefault(); use(selected) }
              }}
              className="h-10 rounded-xl border-surface-200 pl-9 dark:border-surface-700" />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div ref={listRef} id={`${id}-list`} role="listbox" aria-label="Templates"
            className="max-h-[40%] shrink-0 overflow-y-auto border-surface-200/70 p-3 md:max-h-none md:w-80 md:border-r dark:border-surface-700/70">
            {groups.map((group) => (
              <div key={group.category} role="group" aria-labelledby={`${id}-${group.category}`} className="mb-3">
                <div id={`${id}-${group.category}`} className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted">{group.category}</div>
                {group.items.map((template) => {
                  const Icon = ICONS[template.icon]
                  const active = template.id === selected?.id
                  return (
                    <div key={template.id} id={optionId(template)} role="option" aria-selected={active} data-template={template.id} tabIndex={-1}
                      onClick={() => setSelectedId(template.id)} onDoubleClick={() => use(template)}
                      className={cn('flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2 transition-colors',
                        active ? 'bg-accent/10 text-accent dark:bg-accent-light/10 dark:text-accent-light' : 'hover:bg-surface-100 dark:hover:bg-surface-800')}>
                      <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
                        active ? 'bg-accent text-white dark:bg-accent-light dark:text-surface-900' : 'bg-surface-100 text-ink-muted dark:bg-surface-800 dark:text-ink-inverse-muted')}>
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-body-sm font-medium">{template.name}</span>
                        <span className="line-clamp-2 block text-body-xs text-ink-muted dark:text-ink-inverse-muted">{template.description}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
            {!templates.length && <p role="status" className="px-2 py-6 text-center text-body-sm text-ink-muted dark:text-ink-inverse-muted">No templates match “{query}”.</p>}
          </div>

          <section aria-label="Template preview" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-50/60 dark:bg-surface-950/40">
            {selected && preview ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-surface-200/70 px-6 py-4 dark:border-surface-700/70">
                  <div className="min-w-0">
                    <h3 className="text-body-md font-semibold">{selected.name}</h3>
                    <p className="mt-0.5 text-body-xs text-ink-secondary dark:text-ink-inverse-secondary">{selected.description}</p>
                    {selected.source && <p className="mt-1 text-[11px] text-ink-muted dark:text-ink-inverse-muted">Based on {selected.source}</p>}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                  <div className="rounded-xl border border-surface-200/70 bg-surface-0 px-6 py-5 shadow-sm dark:border-surface-700/70 dark:bg-surface-900">
                    <p className="font-display text-2xl text-ink dark:text-ink-inverse">{preview.title || <span className="text-ink-muted/70 dark:text-ink-inverse-muted/70">Untitled</span>}</p>
                    {preview.content
                      ? <NotionEditor key={selected.id} canonical preview readOnly content={preview.content} onChange={noop} extensions={extensions}
                          editorClassName="prose prose-sm dark:prose-invert max-w-none focus:outline-none py-3" />
                      : <p className="mt-3 text-body-sm text-ink-muted dark:text-ink-inverse-muted">An empty page. Type / in the page for headings, tables, a workflow and more, and @ to reference pages, tools and agents.</p>}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-body-sm text-ink-muted dark:text-ink-inverse-muted">Pick a template to preview it.</div>
            )}
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-surface-200/70 px-6 py-3 dark:border-surface-700/70">
          <span className="mr-auto hidden text-body-xs text-ink-muted sm:inline dark:text-ink-inverse-muted">↑ ↓ to choose · Enter to use</span>
          <Button type="button" variant="outline" className="rounded-full" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" className="rounded-full" disabled={!selected} onClick={() => use(selected)}>
            {selected?.id === 'blank' ? 'Create blank page' : 'Use template'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
