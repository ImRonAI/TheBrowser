/**
 * Context Picker: the agent chat's context menu (the link button in the composer) and the `@` mention list.
 *
 * Every entry is real: open tabs, previous chats, issues, projects, dates that matter, interests, project pages
 * and saved context, loaded by `useContextSources` each time the menu opens. What a selected item contributes to
 * the message is read at send time and sent as an attachment (`src/lib/context-attachments.ts`). Rendered in a portal so scrolling
 * containers never clip it.
 */

import { useEffect, useId, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { RenIcon } from '@/components/brand'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { DocumentIcon, DocumentTextIcon, GlobeAltIcon, ChatBubbleLeftRightIcon, FolderIcon, ClipboardDocumentListIcon, CalendarDaysIcon, ArrowUpTrayIcon, ChevronLeftIcon, ChevronRightIcon, MagnifyingGlassIcon, XMarkIcon, CheckIcon, LinkIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { cn } from '@/utils/cn'
import { API_BASE_URL } from '@/lib/api-base'
import { createContextClient, formatBytes } from '@/lib/context-api'
import { savedContextItem, searchContexts, type CategoryId, type ContextCategory, type ContextItem, type ContextType } from '@/lib/chat-context'
import { useContextSources } from './useContextSources'

export type { ContextItem } from '@/lib/chat-context'

type Icon = ComponentType<{ className?: string }>

const TYPE_ICON: Record<ContextType, Icon> = {
  tab: GlobeAltIcon,
  conversation: ChatBubbleLeftRightIcon,
  project: FolderIcon,
  issue: ClipboardDocumentListIcon,
  task: ClipboardDocumentListIcon,
  interest: RenIcon,
  event: CalendarDaysIcon,
  document: DocumentTextIcon,
  file: DocumentIcon,
}
const CATEGORY_ICON: Record<CategoryId, Icon> = {
  tabs: GlobeAltIcon,
  conversations: ChatBubbleLeftRightIcon,
  issues: ClipboardDocumentListIcon,
  projects: FolderIcon,
  dates: CalendarDaysIcon,
  interests: RenIcon,
  documents: DocumentTextIcon,
}
const CATEGORY_TYPES: Record<CategoryId, ContextType[]> = {
  tabs: ['tab'], conversations: ['conversation'], issues: ['issue', 'task'], projects: ['project'],
  dates: ['event'], interests: ['interest'], documents: ['document', 'file'],
}
const MAX_ROWS = 100

export const contextIcon = (type: ContextType): Icon => TYPE_ICON[type] ?? DocumentIcon

const META_TONE: Record<string, string> = {
  Active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  Overdue: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  Today: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  Now: 'bg-accent/10 text-accent dark:text-accent-light',
  Critical: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  High: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
}

/** One selectable row: favicon, status dot or type icon, name, description, meta badge and a check when chosen. */
function ContextRow({ id, item, selected, active, label, onPick, onHover }: {
  id: string; item: ContextItem; selected: boolean; active: boolean; label?: string; onPick: () => void; onHover: () => void
}) {
  const TypeIcon = contextIcon(item.type)
  return (
    <button type="button" id={id} role="option" aria-selected={selected} data-active={active || undefined}
      onMouseDown={(event) => event.preventDefault()} onClick={onPick} onMouseEnter={onHover}
      className={cn('w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors duration-100',
        active ? 'bg-surface-100 dark:bg-surface-700' : 'hover:bg-surface-100 dark:hover:bg-surface-700',
        selected && 'ring-1 ring-inset ring-accent/30 dark:ring-accent-light/30')}>
      {item.favicon ? <img src={item.favicon} alt="" className="w-4 h-4 rounded flex-shrink-0" />
        : item.color ? <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0 mx-[3px]', item.color)} />
          : <TypeIcon className="w-4 h-4 text-ink-muted dark:text-ink-inverse-muted flex-shrink-0" />}
      <span className="flex-1 min-w-0">
        <span className={cn('block text-body-sm font-medium truncate', selected ? 'text-accent dark:text-accent-light' : 'text-ink dark:text-ink-inverse')}>{item.name}</span>
        {(label || item.description) && <span className="block text-body-xs text-ink-muted dark:text-ink-inverse-muted truncate">
          {label && <span className="font-medium">{label}{item.description ? ' · ' : ''}</span>}{item.description}
        </span>}
      </span>
      {item.meta && <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0',
        META_TONE[item.meta] ?? 'bg-surface-200 dark:bg-surface-700 text-ink-muted dark:text-ink-inverse-muted')}>{item.meta}</span>}
      {selected && <CheckIcon className="w-4 h-4 text-accent dark:text-accent-light flex-shrink-0" />}
    </button>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-3 text-body-xs text-ink-muted dark:text-ink-inverse-muted">{children}</p>
}

/** As the menu closes, focus returns to its trigger when it was inside the menu (or nowhere), never when it moved on. */
function restoreFocus(trigger: HTMLElement | null, menu: HTMLElement | null) {
  const focused = document.activeElement
  if (focused && focused !== document.body && !menu?.contains(focused)) return
  requestAnimationFrame(() => trigger?.focus())
}

// ─────────────────────────────────────────────────────────────────────────────
// PICKER (link button)
// ─────────────────────────────────────────────────────────────────────────────

interface ContextPickerProps {
  selectedContexts: ContextItem[]
  onContextsChange: (contexts: ContextItem[]) => void
  className?: string
  /** Where the dropdown anchors relative to the button. 'top' opens upward, 'bottom' opens downward. */
  anchor?: 'top' | 'bottom'
  /** The trigger stays in place but does not open (e.g. while a run is active). */
  disabled?: boolean
  /** Width of the dropdown in px. */
  width?: number
  /** The dropdown's right edge never passes this x (px); defaults to 8px inside the window. */
  boundsRight?: number
}

export function ContextPicker({ selectedContexts, onContextsChange, className, anchor = 'top', disabled = false, width = 336, boundsRight }: ContextPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<CategoryId | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [upload, setUpload] = useState<{ busy: boolean; error?: string }>({ busy: false })
  const { categories, reload, userId } = useContextSources(isOpen)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const [coords, setCoords] = useState({ bottom: 0, left: 0 })

  const handleOpen = () => {
    if (disabled) return
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      const right = boundsRight ?? window.innerWidth - 8
      const left = Math.max(8, Math.min(rect.left, right - width))
      setCoords(anchor === 'bottom' ? { bottom: -(rect.bottom + 8), left } : { bottom: window.innerHeight - rect.top + 8, left })
    }
    setIsOpen(true)
  }
  /** Close; focus goes back to the trigger unless it already moved somewhere else. */
  const handleClose = (returnFocus = true) => {
    if (returnFocus) restoreFocus(buttonRef.current, dialogRef.current)
    setIsOpen(false)
    setActiveCategory(null)
    setSearchQuery('')
    setUpload({ busy: false })
  }

  const category = categories.find((candidate) => candidate.id === activeCategory) ?? null
  const rows = useMemo<{ item: ContextItem; label?: string }[]>(() => {
    const needle = searchQuery.trim().toLowerCase()
    if (category) {
      const matches = needle ? searchContexts([category], needle, MAX_ROWS) : category.items.slice(0, MAX_ROWS).map((item) => ({ item }))
      return matches.map(({ item }) => ({ item }))
    }
    return needle ? searchContexts(categories, needle, 40).map(({ item, category: from }) => ({ item, label: from.name })) : []
  }, [category, categories, searchQuery])

  useEffect(() => { setActiveIndex(0) }, [activeCategory, searchQuery])
  // Escape closes the menu even when focus has left it (the dialog's own handler steps back first when it has focus).
  useEffect(() => {
    if (!isOpen) return
    const onWindowKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      restoreFocus(buttonRef.current, dialogRef.current)
      setIsOpen(false); setActiveCategory(null); setSearchQuery(''); setUpload({ busy: false })
    }
    window.addEventListener('keydown', onWindowKey)
    return () => window.removeEventListener('keydown', onWindowKey)
  }, [isOpen])
  // The menu closes when the trigger becomes disabled (a run started).
  useEffect(() => {
    if (!disabled || !isOpen) return
    restoreFocus(buttonRef.current, dialogRef.current)
    setIsOpen(false); setActiveCategory(null); setSearchQuery(''); setUpload({ busy: false })
  }, [disabled, isOpen])
  // Typing goes to the search box when the menu opens and whenever it moves between categories.
  useEffect(() => {
    if (isOpen) searchRef.current?.focus()
  }, [isOpen, activeCategory])
  useEffect(() => {
    listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const isSelected = (id: string) => selectedContexts.some((context) => context.id === id)
  const toggleContext = (item: ContextItem) => {
    onContextsChange(isSelected(item.id) ? selectedContexts.filter((context) => context.id !== item.id) : [...selectedContexts, item])
  }

  const uploadFile = async (file: File) => {
    setUpload({ busy: true })
    try {
      const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file'
      // A text file's own words go in the entry's Markdown (`text`, at most 20,000 characters on the server).
      const textual = file.type.startsWith('text/') || /\.(md|markdown|txt|csv|tsv|json|ya?ml|xml|html?|log|ini|toml)$/i.test(file.name)
      const text = textual ? (await file.text()).slice(0, 20_000) : undefined
      const saved = await createContextClient(API_BASE_URL, userId).upload({ kind, blob: file, name: file.name, title: file.name, text })
      onContextsChange([...selectedContexts, savedContextItem(saved)])
      setUpload({ busy: false })
      reload()
    } catch (error) {
      setUpload({ busy: false, error: `Upload failed: ${error instanceof Error ? error.message : String(error)}` })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const rootRows = !category && !searchQuery.trim()
  const optionCount = rootRows ? categories.length : rows.length
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (searchQuery) setSearchQuery('')
      else if (category) setActiveCategory(null)
      else handleClose()
      return
    }
    const count = optionCount
    if (!count) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (rootRows) setActiveCategory(categories[activeIndex]?.id ?? null)
      else if (rows[activeIndex]) toggleContext(rows[activeIndex].item)
    } else if (event.key === 'ArrowLeft' && category && !searchQuery) {
      event.preventDefault(); setActiveCategory(null)
    }
  }

  const selectedIn = (candidate: ContextCategory) => selectedContexts.filter((context) => CATEGORY_TYPES[candidate.id].includes(context.type)).length

  return (
    <div className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => { if (disabled) return; if (isOpen) handleClose(); else handleOpen() }}
        aria-label="Add context"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-disabled={disabled || undefined}
        title={disabled ? 'Add context after this run finishes' : 'Add context (or type @)'}
        className={cn(
          'flex shrink-0 items-center justify-center w-8 h-8 rounded-full',
          'text-ink-muted dark:text-ink-inverse-muted transition-all duration-200',
          disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-ink dark:hover:text-ink-inverse',
          selectedContexts.length > 0 && 'text-accent dark:text-accent-light',
        )}
      >
        <LinkIcon className="w-4 h-4" />
      </button>

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {isOpen && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[9998]" onClick={() => handleClose()} />
              <motion.div
                ref={dialogRef}
                role="dialog"
                aria-label="Add context"
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                onKeyDown={onKeyDown}
                onBlur={(event) => {
                  // Tabbing or clicking out of the menu closes it; focus leaving the window (the file chooser) does not.
                  const next = event.relatedTarget
                  if (next instanceof Node && !event.currentTarget.contains(next)) handleClose(false)
                }}
                style={{ position: 'fixed', ...(anchor === 'bottom' ? { top: -coords.bottom } : { bottom: coords.bottom }), left: coords.left, width }}
                className="z-[9999] max-w-[calc(100vw-16px)] py-2 bg-surface-0 dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 shadow-bold dark:shadow-dark-bold overflow-hidden"
              >
                <input type="file" ref={fileRef} className="hidden" aria-hidden tabIndex={-1}
                  onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file) }} />

                <div className="px-3 py-2 border-b border-surface-100 dark:border-surface-700 flex items-center gap-2">
                  {category ? <>
                    <button type="button" onClick={() => { setActiveCategory(null); setSearchQuery('') }} aria-label="Back to categories"
                      className="p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-ink-muted dark:text-ink-inverse-muted">
                      <ChevronLeftIcon className="w-4 h-4" />
                    </button>
                    <p className="flex-1 text-body-sm font-medium text-ink dark:text-ink-inverse">{category.name}</p>
                  </> : <p className="flex-1 text-label text-ink-muted dark:text-ink-inverse-muted">Add context</p>}
                  <button type="button" onClick={reload} aria-label="Refresh" title="Refresh"
                    className="p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-ink-muted dark:text-ink-inverse-muted">
                    <ArrowPathIcon className={cn('w-4 h-4', categories.some((candidate) => candidate.loading) && 'animate-spin')} />
                  </button>
                </div>

                <div className="px-3 py-2 border-b border-surface-100 dark:border-surface-700">
                  <div className="ron-field flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-50 dark:bg-surface-850 border border-surface-200 dark:border-surface-700">
                    <MagnifyingGlassIcon className="w-4 h-4 text-ink-muted dark:text-ink-inverse-muted" />
                    <input
                      ref={searchRef}
                      type="text"
                      role="combobox"
                      aria-expanded="true"
                      aria-controls={listId}
                      aria-autocomplete="list"
                      aria-activedescendant={optionCount ? `${listId}-${activeIndex}` : undefined}
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={category ? `Search ${category.name.toLowerCase()}…` : 'Search chats, issues, tabs, dates…'}
                      aria-label={category ? `Search ${category.name}` : 'Search all context'}
                      className="flex-1 bg-transparent text-body-sm text-ink dark:text-ink-inverse placeholder:text-ink-muted/50 outline-none"
                      autoFocus
                    />
                    {searchQuery && <button type="button" onClick={() => { setSearchQuery(''); searchRef.current?.focus() }} aria-label="Clear search"
                      className="text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse"><XMarkIcon className="w-3.5 h-3.5" /></button>}
                  </div>
                </div>

                <div ref={listRef} role="listbox" aria-multiselectable className="max-h-80 overflow-y-auto scrollbar-thin px-1 py-1">
                  {rootRows ? categories.map((candidate, index) => {
                    const CategoryIcon = CATEGORY_ICON[candidate.id]
                    const count = selectedIn(candidate)
                    return (
                      <button key={candidate.id} type="button" data-active={index === activeIndex || undefined}
                        onClick={() => setActiveCategory(candidate.id)} onMouseEnter={() => setActiveIndex(index)}
                        className={cn('w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left group transition-colors duration-100',
                          index === activeIndex ? 'bg-surface-100 dark:bg-surface-700' : 'hover:bg-surface-100 dark:hover:bg-surface-700')}>
                        <span className={cn('flex items-center justify-center w-8 h-8 rounded-lg bg-surface-100 dark:bg-surface-700', count > 0 && 'bg-accent/10 dark:bg-accent-light/10')}>
                          <CategoryIcon className={cn('w-4 h-4', count > 0 ? 'text-accent dark:text-accent-light' : 'text-ink-muted dark:text-ink-inverse-muted')} />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="text-body-sm font-medium text-ink dark:text-ink-inverse">{candidate.name}</span>
                            {count > 0 && <span className="px-1.5 py-0.5 rounded-full bg-accent/10 dark:bg-accent-light/10 text-accent dark:text-accent-light text-[10px] font-semibold">{count}</span>}
                          </span>
                          <span className="block text-body-xs text-ink-muted dark:text-ink-inverse-muted truncate">
                            {candidate.loading ? 'Loading…' : candidate.items.length ? candidate.description : candidate.note ?? candidate.description}
                          </span>
                        </span>
                        <ChevronRightIcon className="w-4 h-4 text-ink-muted dark:text-ink-inverse-muted opacity-60 group-hover:opacity-100" />
                      </button>
                    )
                  }) : <>
                    {category?.id === 'documents' && !searchQuery && <>
                      <button type="button" disabled={upload.busy} onClick={() => fileRef.current?.click()}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-60 border-b border-surface-100 dark:border-surface-700 mb-1">
                        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/10 dark:bg-accent-light/10">
                          <ArrowUpTrayIcon className="w-4 h-4 text-accent dark:text-accent-light" />
                        </span>
                        <span className="flex-1">
                          <span className="block text-body-sm font-medium text-accent dark:text-accent-light">{upload.busy ? 'Uploading…' : 'Upload a file'}</span>
                          <span className="block text-body-xs text-ink-muted dark:text-ink-inverse-muted">Saved to your Ren context (up to {formatBytes(100 * 1024 * 1024)})</span>
                        </span>
                      </button>
                      {upload.error && <p role="alert" className="px-3 pb-2 text-body-xs text-rose-600 dark:text-rose-400">{upload.error}</p>}
                    </>}
                    {rows.map(({ item, label }, index) => (
                      <ContextRow key={item.id} id={`${listId}-${index}`} item={item} label={label} selected={isSelected(item.id)} active={index === activeIndex}
                        onPick={() => toggleContext(item)} onHover={() => setActiveIndex(index)} />
                    ))}
                    {!rows.length && (category?.loading ? <Note>Loading…</Note>
                      : <Note>{searchQuery ? `Nothing matches “${searchQuery}”.` : category?.note ?? 'Nothing here yet.'}</Note>)}
                    {!!rows.length && category?.note && <Note>{category.note}</Note>}
                    {category && !searchQuery && category.items.length > MAX_ROWS && <Note>{category.items.length - MAX_ROWS} more · search to find them</Note>}
                  </>}
                </div>
                <p className="px-4 pt-2 border-t border-surface-100 dark:border-surface-700 text-[10px] text-ink-muted dark:text-ink-inverse-muted">
                  Tip: type <kbd className="font-semibold">@</kbd> in the message to mention anything here.
                </p>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// @ MENTION LIST (rendered by the composer while an @query is being typed)
// ─────────────────────────────────────────────────────────────────────────────

export function ContextMentionList({ query, results, activeIndex, loading, onPick, onHover, selectedIds }: {
  query: string
  results: { category: ContextCategory; item: ContextItem }[]
  activeIndex: number
  loading: boolean
  onPick: (item: ContextItem) => void
  onHover: (index: number) => void
  selectedIds: Set<string>
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  useEffect(() => { listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' }) }, [activeIndex])
  return (
    <div ref={listRef} role="listbox" aria-label="Mention context"
      className="absolute bottom-full left-0 right-0 mb-2 max-h-72 overflow-y-auto scrollbar-thin rounded-xl border border-surface-200 bg-surface-0 p-1 shadow-[0_18px_48px_-18px_rgb(26_25_23/0.28)] dark:border-surface-700 dark:bg-surface-850">
      <p className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
        {query ? `Context matching “${query}”` : 'Mention a chat, issue, tab, date or interest'}
      </p>
      {results.map(({ category, item }, index) => (
        <ContextRow key={item.id} id={`${listId}-${index}`} item={item} label={category.name} active={index === activeIndex} selected={selectedIds.has(item.id)}
          onPick={() => onPick(item)} onHover={() => onHover(index)} />
      ))}
      {!results.length && <Note>{loading ? 'Loading…' : query ? `Nothing matches “${query}”. Esc or Enter keeps it as text.` : 'Nothing to mention yet.'}</Note>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECTED CONTEXT CHIPS
// ─────────────────────────────────────────────────────────────────────────────

interface SelectedContextsProps {
  contexts: ContextItem[]
  onRemove: (id: string) => void
  className?: string
}

export function SelectedContexts({ contexts, onRemove, className }: SelectedContextsProps) {
  if (contexts.length === 0) return null
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
      className={cn('flex flex-wrap gap-1.5', className)} aria-label="Attached context">
      {contexts.map((context) => {
        const Icon = contextIcon(context.type)
        return (
          <motion.span key={context.id} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}
            title={[context.name, context.description].filter(Boolean).join(' · ')}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-accent/10 dark:bg-accent-light/10 text-accent dark:text-accent-light text-body-xs">
            {context.favicon ? <img src={context.favicon} alt="" className="w-3 h-3 rounded-sm" /> : <Icon className="w-3 h-3" />}
            <span className="max-w-[160px] truncate">{context.name}</span>
            <button type="button" onClick={() => onRemove(context.id)} aria-label={`Remove ${context.name}`}
              className="ml-0.5 hover:text-accent-light dark:hover:text-accent transition-colors">
              <XMarkIcon className="w-3 h-3" />
            </button>
          </motion.span>
        )
      })}
    </motion.div>
  )
}
