import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Calendar, Columns3, Compass, Globe, Hammer, House, Music2, Plus, Search, X, type LucideIcon } from 'lucide-react'
import { useTabStore, type Tab } from '@/stores/tabStore'
import { RenMark, RenWordmark } from '@/components/brand'
import { cn } from '@/utils/cn'
import { useEffect, useState } from 'react'

/** Hover wash for controls sitting directly on the chrome (reads on paper, ink and glass alike). */
const CHROME_HOVER = 'hover:bg-ink/[0.06] hover:text-ink dark:hover:bg-ink-inverse/[0.07] dark:hover:text-ink-inverse'

type TabSummary = { id: string; url: string; title: string; favicon?: string; isActive: boolean }

const toTab = (t: TabSummary): Tab => ({
  id: t.id,
  url: t.url,
  title: t.title,
  favicon: t.favicon,
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  createdAt: Date.now(),
  lastAccessed: Date.now(),
})

/**
 * Keep the tab store in sync with Electron's TabsManager (initial list + live
 * updates). Mounted exactly once by BrowserLayout so the horizontal strip and
 * the sidebar's vertical list can both render from the same store.
 */
export function useTabSync() {
  const setTabs = useTabStore((state) => state.setTabs)
  useEffect(() => {
    // A live update from the main process wins over an in-flight list() that started earlier
    // (sign-in opens a provider tab in the same turn the browser shell mounts).
    let live = false
    const off = window.electron?.tabs.onUpdated?.((list) => {
      live = true
      setTabs(list.map(toTab), list.find(t => t.isActive)?.id)
    })
    const init = async () => {
      try {
        const list = await window.electron?.tabs.list?.()
        if (live || !Array.isArray(list)) return
        setTabs(list.map(toTab), list.find(t => t.isActive)?.id || list[0]?.id)
      } catch (e) {
        console.error('Failed to load tabs from main', e)
      }
    }
    void init()
    return () => { if (off) off() }
  }, [setTabs])
}

/** Tab actions shared by every tab surface. */
export function useTabActions() {
  const { createTab, closeTab, setActiveTab } = useTabStore()

  const create = async () => {
    const id = createTab('ron://home', true)
    try {
      await window.electron?.tabs.create('ron://home', id)
      await window.electron?.tabs.switch(id)
    } catch (e) {
      console.error('Failed to create tab', e)
    }
  }

  const select = async (id: string) => {
    setActiveTab(id)
    try { await window.electron?.tabs.switch(id) } catch (e) { console.error('Failed to switch tab', e) }
  }

  const close = async (id: string) => {
    closeTab(id)
    try { await window.electron?.tabs.close(id) } catch (e) { console.error('Failed to close tab', e) }
  }

  return { create, select, close }
}

/** The icon of one of Ren's own pages (`ron://<page>`), matching the sidebar's destinations; null when unknown. */
const INTERNAL_PAGE_ICONS: Record<string, LucideIcon> = {
  home: House, discover: Compass, execute: Columns3, board: Columns3, projects: Columns3, calendar: Calendar,
  vibe: Music2, build: Hammer, search: Search,
}
function internalPageIcon(url: string): LucideIcon | null {
  const page = url.slice('ron://'.length).split(/[/?#]/, 1)[0].toLowerCase()
  return INTERNAL_PAGE_ICONS[page] ?? null
}

function TabFavicon({ tab, active }: { tab: Tab; active: boolean }) {
  const [broken, setBroken] = useState(false)
  if (tab.favicon && !broken) {
    return <img src={tab.favicon} alt="" onError={() => setBroken(true)} className="h-4 w-4 flex-shrink-0 rounded-[3px]" />
  }
  // Ren's own pages wear their page's icon (volt on the active tab); unknown internal pages wear the tile.
  if (tab.url?.startsWith('ron://')) {
    const Icon = internalPageIcon(tab.url)
    if (!Icon) return <RenMark className="h-4 w-4" />
    return <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', active ? 'text-volt' : 'text-ink-muted dark:text-ink-inverse-muted')} strokeWidth={2} />
  }
  return <Globe className="h-3.5 w-3.5 flex-shrink-0 text-ink-muted dark:text-ink-inverse-muted" strokeWidth={1.75} />
}

function CloseButton({ onClose, title, className }: { onClose: () => void; title: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClose() }}
      className={cn(
        'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md transition-[color,background-color,opacity] duration-150 ease-out',
        'text-ink-muted hover:bg-ink/[0.08] hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-ink-inverse/10 dark:hover:text-ink-inverse',
        'focus-visible:ring-offset-0',
        className,
      )}
      aria-label={`Close tab ${title}`}
      title="Close tab"
    >
      <X className="h-3 w-3" strokeWidth={2.25} />
    </button>
  )
}

/** Shared row recipe: a paper capsule for the active tab (a glass capsule in the Glass theme), a
 *  quiet wash on hover. The focus ring is drawn inset so the scrolling strip never clips it. */
const tabRowClass = (isActive: boolean) => cn(
  'group relative flex cursor-default items-center rounded-lg border transition-colors duration-150 ease-out',
  'focus-visible:ring-inset focus-visible:ring-offset-0',
  isActive
    ? 'border-surface-200 bg-surface-0 text-ink dark:border-surface-700/70 dark:bg-surface-800 dark:text-ink-inverse'
    : cn('border-transparent text-ink-secondary dark:text-ink-inverse-secondary', CHROME_HOVER),
)

/** Horizontal tab strip — shown under the toolbar while the sidebar is closed. */
export function TabBar() {
  const { tabs, activeTabId } = useTabStore()
  const { create, select, close } = useTabActions()
  const reduced = useReducedMotion()

  return (
    <div className="flex h-9 items-center gap-1.5 px-3 pb-1.5" role="tablist" aria-label="Open tabs">
      {/* Brand anchor while the sidebar (which carries the wordmark) is closed. */}
      <RenWordmark className="mr-1.5 text-[20px] text-ink dark:text-ink-inverse" />
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
        <AnimatePresence mode="popLayout" initial={false}>
          {tabs.map((tab) => {
            const isActive = activeTabId === tab.id
            return (
              <motion.div
                key={tab.id}
                layout={!reduced}
                initial={reduced ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
                onClick={() => select(tab.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void select(tab.id) } }}
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); void close(tab.id) } }}
                title={tab.title}
                className={cn(tabRowClass(isActive), 'h-7 min-w-[120px] max-w-[220px] flex-1 basis-[180px] gap-2 pl-2.5 pr-1')}
              >
                <TabFavicon tab={tab} active={isActive} />
                <span className={cn('flex-1 truncate text-[13px]', isActive ? 'font-medium' : 'font-normal')}>
                  {tab.title}
                </span>
                <CloseButton
                  onClose={() => void close(tab.id)}
                  title={tab.title}
                  className={cn(isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100')}
                />
                {/* Active indicator: a 2px volt rule along the foot of the tab. */}
                {isActive && <span aria-hidden className="pointer-events-none absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-volt" />}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
      <button
        type="button"
        onClick={() => void create()}
        className={cn(
          'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-ink-secondary transition-colors duration-150 ease-out dark:text-ink-inverse-secondary',
          CHROME_HOVER,
        )}
        aria-label="New tab"
        title="New tab"
      >
        <Plus className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
  )
}

/** Vertical tab list — rendered inside the sidebar while it is open. */
export function VerticalTabList() {
  const { tabs, activeTabId } = useTabStore()
  const { create, select, close } = useTabActions()
  const reduced = useReducedMotion()

  return (
    <div className="flex flex-col gap-px" role="tablist" aria-label="Open tabs" aria-orientation="vertical">
      <AnimatePresence initial={false}>
        {tabs.map((tab) => {
          const isActive = activeTabId === tab.id
          return (
            <motion.div
              key={tab.id}
              layout={!reduced}
              initial={reduced ? false : { opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? undefined : { opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              onClick={() => select(tab.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void select(tab.id) } }}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); void close(tab.id) } }}
              title={tab.title}
              className={cn(tabRowClass(isActive), 'h-8 gap-2.5 pl-2.5 pr-1')}
            >
              <TabFavicon tab={tab} active={isActive} />
              <span className={cn('flex-1 truncate text-[13px]', isActive ? 'font-medium' : 'font-normal')}>{tab.title}</span>
              <CloseButton onClose={() => void close(tab.id)} title={tab.title} className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" />
            </motion.div>
          )
        })}
      </AnimatePresence>
      <button
        type="button"
        onClick={() => void create()}
        className={cn(
          'flex h-8 items-center gap-2.5 rounded-lg border border-transparent px-2.5 text-[13px] text-ink-secondary transition-colors duration-150 ease-out dark:text-ink-inverse-secondary',
          'focus-visible:ring-inset focus-visible:ring-offset-0',
          CHROME_HOVER,
        )}
        aria-label="New tab"
      >
        <Plus className="h-4 w-4" strokeWidth={1.75} />
        New tab
      </button>
    </div>
  )
}
