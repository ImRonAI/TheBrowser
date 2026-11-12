/**
 * Sidebar — the persistent left rail that replaced the top navigation drawer.
 *
 * Full window height (the macOS traffic lights sit in its top row), it stays
 * open across every page — including websites, whose WebContentsView is inset
 * by the measured sidebar width — until the user closes it (⌘\ or the toolbar).
 *
 * It carries exactly what the drawer did, plus the vertical tab list:
 * - the search composer (context picker, article/text attachments, Brave
 *   assist, search depth, submit → ron://search?q=…&level=…), focused by ⌘K
 * - the six destinations (Discover, Execute, Documents, Calendar, Vibe, Build);
 *   Documents opens the library (ron://documents) and is the one lit while it shows
 * - open tabs
 */
import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUp, Check, ChevronDown, Compass, Calendar, Columns3, FileText, Hammer, Music2, Search, X } from 'lucide-react'
import { RenWordmark } from '@/components/brand'
import { useNavigationStore, type HomeTab } from '@/stores/navigationStore'
import { useTabStore } from '@/stores/tabStore'
import { documentsLibraryUrl, parseDocumentsLibraryUrl } from '@/lib/project-documents'
import { openInternalUrl } from '@/components/board/task-detail/editor/extensions/blocks/workspace'
import { useTextAssist } from '@/hooks/useTextAssist'
import { TextAssist, handleAssistKey } from '@/components/shared/TextAssist'
import { useSearchStore } from '@/stores/searchStore'
import { useAuthStore } from '@/stores/authStore'
import { articleDraftKey, EMPTY_ARTICLE_DRAFT, useArticleDraftStore } from '@/stores/articleDraftStore'
import { ArticleAttachmentCard } from '@/components/interests/ArticleAttachmentCard'
import { ContextPicker, type ContextItem } from '@/components/agent-panel/ContextPicker'
import { TextAttachmentCard } from '@/components/ai-elements/text-attachment-card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { buildSearchRonUrl } from '@/components/chrome/UrlBar'
import { VerticalTabList } from '@/components/chrome/TabBar'
import { LEVEL_INFO } from '@/lib/search-api'
import { MOD_KEY } from '@/lib/shortcuts'
import { fileToDataUrl, makePastedTextFilename } from '@/utils/file-utils'
import type { TextAttachment } from '@/components/ai-elements/types'
import { cn } from '@/utils/cn'

/** Sidebar width in CSS px. Wide enough that the 288px context picker stays inside it. */
export const SIDEBAR_WIDTH = 304
const EASE = [0.16, 1, 0.3, 1] as const
const LARGE_PASTE_THRESHOLD_CHARS = 2000

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH DEPTH SELECTOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The search level: every search runs the Perplexity Agent API at this preset
 * (fast/low/medium/high/xhigh). Persisted in the search store.
 */
function SearchDepthSelector() {
  const { level, setLevel } = useSearchStore()
  const [open, setOpen] = useState(false)
  const active = LEVEL_INFO.find((info) => info.id === level)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Search depth: ${active?.label ?? level}`}
          title="Search depth"
          className={cn(
            'flex h-6 flex-shrink-0 items-center gap-1 rounded-full pl-2 pr-1.5',
            'text-[12px] font-medium text-ink-secondary transition-colors duration-150 ease-out hover:bg-surface-100 hover:text-ink data-[state=open]:bg-surface-100 data-[state=open]:text-ink',
            'dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse dark:data-[state=open]:bg-surface-800 dark:data-[state=open]:text-ink-inverse',
          )}
        >
          <span>{active?.label ?? level}</span>
          <ChevronDown className={cn('h-3 w-3 opacity-70 transition-transform duration-200', open && 'rotate-180')} />
        </button>
      </PopoverTrigger>
      {/* `data-[state=open]:shadow-float`: outranks the primitive's own shadow-md, still yields to Glass. */}
      <PopoverContent align="end" sideOffset={8} className="z-[200] w-72 rounded-xl border-border p-1 data-[state=open]:shadow-float">
        <p className="px-2.5 pb-1.5 pt-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Search depth</p>
        {LEVEL_INFO.map((info) => {
          const isActive = info.id === level
          return (
            <button
              key={info.id}
              type="button"
              onClick={() => {
                setLevel(info.id)
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 ease-out focus-visible:ring-inset focus-visible:ring-offset-0',
                isActive ? 'bg-muted' : 'hover:bg-muted/70',
              )}
            >
              <span className={cn('mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center', !isActive && 'opacity-0')}>
                <Check className="h-3.5 w-3.5 text-volt" strokeWidth={2.5} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5 text-[13px] font-semibold text-popover-foreground">
                  {info.label}
                  <span className="font-mono text-[10px] font-normal uppercase tracking-[0.08em] text-muted-foreground">
                    {info.id}
                  </span>
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
                  {info.description}
                </span>
              </span>
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DESTINATIONS
// ─────────────────────────────────────────────────────────────────────────────

const DESTINATIONS: { id: HomeTab; label: string; icon: typeof Compass }[] = [
  { id: 'discover', label: 'Discover', icon: Compass },
  { id: 'execute', label: 'Execute', icon: Columns3 },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'vibe', label: 'Vibe', icon: Music2 },
  { id: 'build', label: 'Build', icon: Hammer },
]

/** Mono micro-label. Secondary ink (not muted) so it keeps 4.5:1 on the light chrome. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2.5 pb-2 pt-5 font-mono text-[11px] font-medium uppercase leading-none tracking-[0.08em] text-ink-secondary dark:text-ink-inverse-muted">{children}</p>
  )
}

/** Hover wash for rows sitting directly on the chrome (reads on paper, ink and glass alike). */
const ROW_HOVER = 'hover:bg-ink/[0.06] hover:text-ink dark:hover:bg-ink-inverse/[0.07] dark:hover:text-ink-inverse'

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function Sidebar() {
  const { isSidebarOpen, searchFocusRequest, activeTab, setActiveTab } = useNavigationStore()
  // The library is routed by the tab's URL, so Documents is lit exactly while it shows. Off the library a
  // leftover 'documents' destination lights Discover, the page MainContent shows for it.
  const onDocuments = useTabStore((state) => parseDocumentsLibraryUrl(state.tabs.find((tab) => tab.id === state.activeTabId)?.url) !== null)
  const currentDestination: HomeTab = onDocuments ? 'documents' : activeTab === 'documents' ? 'discover' : activeTab
  const { level } = useSearchStore()
  const reduced = useReducedMotion()
  const user = useAuthStore((state) => state.user?.id || 'default')
  const draftKey = articleDraftKey(user, 'search')
  const articles = useArticleDraftStore((state) => (state.drafts[draftKey] || EMPTY_ARTICLE_DRAFT).articles)

  // Input state
  const [query, setQuery] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  // Brave Suggest + Spellcheck for the search bar (both plans; one request per typing pause).
  const assist = useTextAssist(query, { enabled: isFocused, count: 8 })
  const [selectedContexts, setSelectedContexts] = useState<ContextItem[]>([])
  const [textAttachments, setTextAttachments] = useState<TextAttachment[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const railRef = useRef<HTMLElement>(null)

  // An article attached for search lands here: focus the field so the user can add a query.
  useEffect(() => {
    if (!isSidebarOpen || !articles.length) return
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [isSidebarOpen, articles])

  // ⌘K (or any requestSearchFocus): the store opens the sidebar; focus once React has
  // committed the open state (the rail is `inert` while closed, which blocks focus).
  useEffect(() => {
    if (!searchFocusRequest || !isSidebarOpen) return
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [searchFocusRequest, isSidebarOpen])

  // Report the rail's width on every change (open/close animation, shell zoom) so
  // Electron insets the website's WebContentsView and never covers the sidebar.
  useEffect(() => {
    const rail = railRef.current
    const setSidebarWidth = window.electron?.browser?.setSidebarWidth
    if (!rail || !setSidebarWidth) return
    const report = () => { void setSidebarWidth(rail.getBoundingClientRect().width) }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(rail)
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
      void setSidebarWidth(0)
    }
  }, [])

  // Handle search submission: the active tab becomes the search results site.
  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const trimmed = query.trim()
    if (!trimmed && textAttachments.length === 0) return

    if (articles.length) useArticleDraftStore.getState().setText(draftKey, trimmed)

    if (typeof window !== 'undefined' && window.electron?.browser?.navigate) {
      try {
        await window.electron.browser.navigate(buildSearchRonUrl(trimmed, level))
      } catch (error) {
        console.error('Search error:', error)
      }
    }

    setQuery('')
    setTextAttachments([])
    setSelectedContexts([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (handleAssistKey(e, assist, (text) => { setQuery(text); assist.dismiss() })) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      assist.dismiss()
      handleSearch()
    }
    if (e.key === 'Escape') inputRef.current?.blur()
  }

  // Handle large paste → attachment
  const handlePaste = async (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text/plain')
    if (text && text.length >= LARGE_PASTE_THRESHOLD_CHARS) {
      e.preventDefault()
      const file = new File([text], makePastedTextFilename(), {
        type: 'text/plain',
      })
      const dataUrl = await fileToDataUrl(file)
      const newAttachment: TextAttachment = {
        id: Math.random().toString(36).substr(2, 9),
        file,
        dataUrl,
        preview: dataUrl,
      }
      setTextAttachments(prev => [...prev, newAttachment])
    }
  }

  const handleTextAttachmentRemove = (id: string) => {
    setTextAttachments(prev => prev.filter(att => att.id !== id))
  }

  const handleTextAttachmentUpdate = (
    id: string,
    next: Pick<TextAttachment, 'file' | 'dataUrl' | 'preview'>
  ) => {
    setTextAttachments(prev => prev.map(att =>
      att.id === id ? { ...att, ...next } : att
    ))
  }

  const navigateInternal = (url: string) => {
    if (typeof window !== 'undefined' && window.electron?.browser?.navigate) {
      window.electron.browser.navigate(url)
    }
  }

  const handleTabClick = (tabId: HomeTab) => {
    setActiveTab(tabId)
    if (tabId === 'execute') {
      navigateInternal('ron://execute')
      return
    }
    if (tabId === 'documents') {
      openInternalUrl(documentsLibraryUrl())
      return
    }
    if (tabId === 'build') {
      navigateInternal('ron://build')
      return
    }
    navigateInternal('ron://home')
  }

  const canSubmit = Boolean(query.trim()) || textAttachments.length > 0

  return (
    <motion.aside
      ref={railRef}
      aria-label="Sidebar"
      aria-hidden={!isSidebarOpen}
      inert={!isSidebarOpen}
      initial={false}
      animate={{ width: isSidebarOpen ? SIDEBAR_WIDTH : 0 }}
      transition={{ duration: reduced ? 0 : 0.28, ease: EASE }}
      className="ron-sidebar relative z-[95] h-full flex-shrink-0 overflow-hidden"
    >
      <div
        className="flex h-full flex-col border-r border-surface-200 dark:border-surface-800"
        style={{ width: SIDEBAR_WIDTH }}
      >
        {/* Top row: traffic lights + window drag area, with the wordmark as the brand anchor */}
        <div className="flex h-11 flex-shrink-0 items-center pl-[84px] pr-3 drag-region">
          <RenWordmark className="text-[22px] text-ink dark:text-ink-inverse" />
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-2.5 pt-1">
          {/* ── Search composer ───────────────────────────────────────────── */}
          <div className="no-drag">
            {articles.map((article) => <ArticleAttachmentCard key={article.id} article={article}
              onRemove={() => useArticleDraftStore.getState().remove(draftKey, article.id)} />)}

            {/* Text Attachments */}
            {textAttachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {textAttachments.map(attachment => (
                  <TextAttachmentCard
                    key={attachment.id}
                    attachment={attachment}
                    onRemove={handleTextAttachmentRemove}
                    onUpdate={handleTextAttachmentUpdate}
                  />
                ))}
              </div>
            )}

            {/* Selected Context Chips */}
            {selectedContexts.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {selectedContexts.map(context => (
                  <span
                    key={context.id}
                    className="inline-flex h-6 max-w-full items-center gap-1 rounded-full border border-surface-200 bg-surface-0 pl-2.5 pr-1 text-[12px] font-medium text-ink-secondary dark:border-surface-700 dark:bg-surface-850 dark:text-ink-inverse-secondary"
                  >
                    <span className="truncate">{context.name}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedContexts(prev => prev.filter(c => c.id !== context.id))}
                      className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-surface-100 hover:text-ink focus-visible:ring-offset-0 dark:text-ink-inverse-muted dark:hover:bg-surface-700 dark:hover:text-ink-inverse"
                      aria-label={`Remove ${context.name}`}
                    >
                      <X className="h-3 w-3" strokeWidth={2.25} aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <form onSubmit={handleSearch} className="relative" role="search">
              <div className={cn(
                'ron-field rounded-xl border transition-[border-color,box-shadow,background-color] duration-150 ease-out',
                isFocused
                  ? 'border-blurple-500 bg-surface-0 ring-[3px] ring-blurple-500/15 dark:border-blurple-400 dark:bg-surface-850 dark:ring-blurple-400/20'
                  : 'border-surface-200 bg-surface-0 hover:border-surface-300 dark:border-surface-800 dark:bg-surface-850 dark:hover:border-surface-700',
              )}>
                <label className="flex h-10 items-center gap-2 px-3">
                  <Search className={cn('h-4 w-4 flex-shrink-0 transition-colors duration-150', isFocused ? 'text-volt' : 'text-ink-muted dark:text-ink-inverse-muted')} strokeWidth={1.75} aria-hidden />
                  <span className="sr-only">Search or ask anything</span>
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    id="nav-search-bar"
                    data-testid="nav-search-input"
                    placeholder="Search or ask anything"
                    className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-ink-muted dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted"
                    autoComplete="off"
                  />
                  {!isFocused && !query && <kbd className="kbd" aria-hidden>{MOD_KEY}K</kbd>}
                </label>
                <div className="flex items-center gap-1 border-t border-surface-100 px-1.5 py-1 dark:border-surface-800">
                  {/* Context Picker - opens downward */}
                  <ContextPicker
                    selectedContexts={selectedContexts}
                    onContextsChange={setSelectedContexts}
                    anchor="bottom"
                    className="flex-shrink-0"
                  />
                  <div className="flex-1" />
                  <SearchDepthSelector />
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    aria-label="Search"
                    title="Search"
                    className={cn(
                      'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg transition-colors duration-150 ease-out',
                      canSubmit
                        ? 'bg-blurple-600 text-white hover:bg-blurple-700 active:bg-blurple-800 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300'
                        : 'bg-surface-100 text-ink-muted opacity-60 dark:bg-surface-800 dark:text-ink-inverse-muted',
                    )}
                  >
                    <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.25} />
                  </button>
                </div>
              </div>
              {/* Suggestions stay inside the rail, so a website's view can never cover them. */}
              {isFocused && <TextAssist assist={assist} placement="below"
                onPick={(text) => { setQuery(text); assist.dismiss(); inputRef.current?.focus() }}
                onCorrect={(text) => { setQuery(text); assist.dismiss(); inputRef.current?.focus() }} />}
            </form>
          </div>

          {/* ── Destinations ──────────────────────────────────────────────── */}
          <nav aria-label="Destinations" className="no-drag">
            <SectionLabel>Ren</SectionLabel>
            <ul className="flex flex-col gap-px">
              {DESTINATIONS.map(({ id, label, icon: Icon }) => {
                const isActive = currentDestination === id
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => handleTabClick(id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'relative flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors duration-150 ease-out focus-visible:ring-offset-0',
                        isActive
                          ? 'bg-ink/[0.045] font-semibold text-ink dark:bg-ink-inverse/[0.06] dark:text-ink-inverse'
                          : cn('text-ink-secondary dark:text-ink-inverse-secondary', ROW_HOVER),
                      )}
                    >
                      {/* Active: a volt bar on the leading edge */}
                      {isActive && <span aria-hidden className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-volt" />}
                      <Icon className={cn('h-4 w-4 flex-shrink-0', isActive ? 'text-volt' : 'opacity-80')} strokeWidth={isActive ? 2 : 1.75} />
                      {label}
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>

          {/* ── Open tabs ─────────────────────────────────────────────────── */}
          <div className="mt-1 flex min-h-0 flex-1 flex-col no-drag">
            <SectionLabel>Tabs</SectionLabel>
            <div className="min-h-0 flex-1 overflow-y-auto pb-2 scrollbar-thin">
              <VerticalTabList />
            </div>
          </div>
        </div>

        {/* ── Shortcut legend ─────────────────────────────────────────────── */}
        <div className="flex flex-shrink-0 items-center gap-3 border-t border-surface-200 px-4 py-2.5 text-[11px] font-medium text-ink-secondary dark:border-surface-800 dark:text-ink-inverse-muted">
          <span className="flex items-center gap-1.5"><kbd className="kbd">{MOD_KEY}J</kbd>Ask Ren</span>
          <span className="flex items-center gap-1.5"><kbd className="kbd">{MOD_KEY}K</kbd>Search</span>
          <span className="ml-auto flex items-center gap-1.5" title="Toggle sidebar"><kbd className="kbd">{MOD_KEY}\</kbd></span>
        </div>
      </div>
    </motion.aside>
  )
}

export default Sidebar
