import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { BookOpen, Calendar, Columns3, Compass, FileText, Globe, Hammer, House, Microscope, Music2, Plus, Search, X, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { RenMark, RenWordmark } from '@/components/brand'
import {
  getGroupedSlotTabId,
  hitTestSplitDropZone,
  type SplitDropZone,
  type SplitPaneSlot,
  type SplitRect,
  type SplitState,
} from '@/lib/tab-split'
import { shouldShowMusicDeck, useLiveMusicStore } from '@/stores/liveMusicStore'
import { usePanelAgentStore } from '@/stores/panelAgentStore'
import { useTabStore, type Tab } from '@/stores/tabStore'
import { cn } from '@/utils/cn'

/** Hover wash for controls sitting directly on the chrome (reads on paper, ink and glass alike). */
const CHROME_HOVER = 'hover:bg-ink/[0.06] hover:text-ink dark:hover:bg-ink-inverse/[0.07] dark:hover:text-ink-inverse'
const DRAG_THRESHOLD_PX = 6

type TabSummary = {
  id: string
  url: string
  title: string
  favicon?: string
  isActive: boolean
  isDisplayed?: boolean
  isSplitDetached?: boolean
  splitPane?: SplitPaneSlot | null
}

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
  isDisplayed: t.isDisplayed,
  isSplitDetached: t.isSplitDetached,
  splitPane: t.splitPane ?? null,
})

export function measureShellSplitRegions(): {
  chromeBottom: number
  sidebarRight: number
  contentArea: SplitRect
} {
  const toolbarEl = document.querySelector<HTMLElement>('.ron-toolbar')
  const sidebarEl = document.querySelector<HTMLElement>('.ron-sidebar')
  const contentEl = document.querySelector<HTMLElement>('.ron-content')
  const panelEl = contentEl?.querySelector<HTMLElement>('[data-agent-panel="true"]')

  const chromeBottom = toolbarEl?.getBoundingClientRect().bottom ?? 88
  const sidebarRight = sidebarEl?.getBoundingClientRect().right ?? 0

  const panelState = usePanelAgentStore.getState()
  const musicState = useLiveMusicStore.getState()
  const musicInset =
    shouldShowMusicDeck(musicState) && musicState.open ? Math.min(panelState.panelWidth, 420) : 0
  const domPanelWidth = panelEl ? panelEl.getBoundingClientRect().width : 0
  const explicitSideInset =
    contentEl?.dataset.sideInset !== undefined ? Number(contentEl.dataset.sideInset) : NaN
  const rightInset = Number.isFinite(explicitSideInset)
    ? Math.max(0, explicitSideInset)
    : Math.max(domPanelWidth, panelState.teachingInset, musicInset)

  if (!contentEl) {
    return {
      chromeBottom,
      sidebarRight,
      contentArea: {
        x: sidebarRight,
        y: chromeBottom,
        width: Math.max(0, window.innerWidth - sidebarRight - rightInset),
        height: Math.max(0, window.innerHeight - chromeBottom),
      },
    }
  }

  const rect = contentEl.getBoundingClientRect()
  return {
    chromeBottom,
    sidebarRight,
    contentArea: {
      x: rect.left,
      y: rect.top,
      width: Math.max(0, rect.width - rightInset),
      height: Math.max(0, rect.height),
    },
  }
}

/**
 * Keep the tab store in sync with Electron's TabsManager (initial list, split state, and live updates).
 * Mounted once by BrowserLayout so the horizontal strip, vertical sidebar list, and SplitWorkspace
 * all render from one consistent store.
 */
export function useTabSync() {
  const setTabs = useTabStore((state) => state.setTabs)
  const setSplit = useTabStore((state) => state.setSplit)

  useEffect(() => {
    let liveTabs = false
    let liveSplit = false

    const offTabs = window.electron?.tabs.onUpdated?.((list) => {
      liveTabs = true
      setTabs(list.map(toTab), list.find((t) => t.isActive)?.id)
    })

    const offSplit = window.electron?.tabs.onSplitUpdated?.((split: SplitState) => {
      liveSplit = true
      setSplit(split)
    })

    const init = async () => {
      try {
        const [list, split] = await Promise.all([
          window.electron?.tabs.list?.(),
          window.electron?.tabs.getSplit?.(),
        ])
        if (!liveSplit && split && typeof split === 'object' && 'mode' in split) {
          setSplit(split)
        }
        if (!liveTabs && Array.isArray(list)) {
          setTabs(list.map(toTab), list.find((t) => t.isActive)?.id || list[0]?.id)
        }
      } catch (e) {
        console.error('Failed to load tabs from main', e)
      }
    }

    void init()
    return () => {
      offTabs?.()
      offSplit?.()
    }
  }, [setTabs, setSplit])
}

/** Tab actions shared by every tab surface. */
export function useTabActions() {
  const { createTab, closeTab, setActiveTab, splitTabLocal, unsplitTabLocal } = useTabStore()

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
    try {
      await window.electron?.tabs.switch(id)
    } catch (e) {
      console.error('Failed to switch tab', e)
    }
  }

  const close = async (id: string) => {
    closeTab(id)
    try {
      await window.electron?.tabs.close(id)
    } catch (e) {
      console.error('Failed to close tab', e)
    }
  }

  const splitTab = async (id: string, zone: SplitDropZone, source: 'strip' | 'pane' = 'strip') => {
    if (window.electron?.tabs.split) {
      try {
        await window.electron.tabs.split(id, zone, source)
        return
      } catch (e) {
        console.error('Failed to split tab', e)
      }
    }
    splitTabLocal(id, zone, source)
  }

  const unsplitTab = async (id?: string, all = false) => {
    if (window.electron?.tabs.unsplit) {
      try {
        await window.electron.tabs.unsplit(id, all)
        return
      } catch (e) {
        console.error('Failed to unsplit tab', e)
      }
    }
    unsplitTabLocal(id, all)
  }

  return { create, select, close, splitTab, unsplitTab }
}

/** The icon of one of Ren's own pages (`ron://<page>`), matching the sidebar's destinations; null when unknown. */
const INTERNAL_PAGE_ICONS: Record<string, LucideIcon> = {
  home: House,
  discover: Compass,
  research: Microscope,
  execute: Columns3,
  board: Columns3,
  projects: Columns3,
  documents: FileText,
  read: BookOpen,
  calendar: Calendar,
  vibe: Music2,
  build: Hammer,
  search: Search,
}

function internalPageIcon(url: string): LucideIcon | null {
  const page = url.slice('ron://'.length).split(/[/?#]/, 1)[0].toLowerCase()
  return INTERNAL_PAGE_ICONS[page] ?? null
}

export function TabFavicon({ tab, active }: { tab: Tab; active: boolean }) {
  const [broken, setBroken] = useState(false)
  if (tab.favicon && !broken) {
    return (
      <img
        src={tab.favicon}
        alt=""
        onError={() => setBroken(true)}
        className="h-4 w-4 flex-shrink-0 rounded-[3px]"
      />
    )
  }
  if (tab.url?.startsWith('ron://')) {
    const Icon = internalPageIcon(tab.url)
    if (!Icon) return <RenMark className="h-4 w-4" />
    return (
      <Icon
        className={cn(
          'h-3.5 w-3.5 flex-shrink-0',
          active ? 'text-volt' : 'text-ink-muted dark:text-ink-inverse-muted',
        )}
        strokeWidth={2}
      />
    )
  }
  return (
    <Globe
      className="h-3.5 w-3.5 flex-shrink-0 text-ink-muted dark:text-ink-inverse-muted"
      strokeWidth={1.75}
    />
  )
}

function CloseButton({
  onClose,
  title,
  className,
}: {
  onClose: () => void
  title: string
  className?: string
}) {
  return (
    <button
      type="button"
      data-tab-close="true"
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
      onPointerDown={(e) => e.stopPropagation()}
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

/** Miniature vector glyph showing which split slot the grouped-strip tab currently anchors. */
function SplitSlotGlyph({
  split,
  active,
}: {
  split: Exclude<SplitState, { mode: 'single' }>
  active: boolean
}) {
  const slot = split.groupedSlot
  const cell = (x: number, y: number, w: number, h: number, filled: boolean) => (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx={1}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.1}
      strokeOpacity={filled ? 1 : 0.45}
    />
  )

  return (
    <span
      aria-hidden
      title="Displayed in split view"
      className={cn(
        'flex flex-shrink-0 items-center justify-center transition-colors duration-150',
        active ? 'text-volt' : 'text-ink-muted dark:text-ink-inverse-muted',
      )}
    >
      <svg viewBox="0 0 14 11" className="h-[11px] w-[14px]" fill="none">
        {split.mode === 'split-2' && (
          <>
            {cell(1, 1, 5.2, 9, slot === 'left')}
            {cell(7.8, 1, 5.2, 9, slot === 'right')}
          </>
        )}
        {split.mode === 'split-3-left' && (
          <>
            {cell(1, 1, 5.2, 3.8, slot === 'topLeft')}
            {cell(1, 6.2, 5.2, 3.8, slot === 'bottomLeft')}
            {cell(7.8, 1, 5.2, 9, slot === 'right')}
          </>
        )}
        {split.mode === 'split-3-right' && (
          <>
            {cell(1, 1, 5.2, 9, slot === 'left')}
            {cell(7.8, 1, 5.2, 3.8, slot === 'topRight')}
            {cell(7.8, 6.2, 5.2, 3.8, slot === 'bottomRight')}
          </>
        )}
        {split.mode === 'split-4' && (
          <>
            {cell(1, 1, 5.2, 3.8, slot === 'topLeft')}
            {cell(7.8, 1, 5.2, 3.8, slot === 'topRight')}
            {cell(1, 6.2, 5.2, 3.8, slot === 'bottomLeft')}
            {cell(7.8, 6.2, 5.2, 3.8, slot === 'bottomRight')}
          </>
        )}
      </svg>
    </span>
  )
}

/** Shared row recipe: a paper capsule for the active tab (a glass capsule in the Glass theme),
 *  a soft live-anchor capsule when displayed in split view while another pane holds focus, and
 *  a quiet wash on hover. The focus ring is drawn inset so the scrolling strip never clips it. */
const tabRowClass = (isActive: boolean, isGroupedAnchor = false, isDragging = false) =>
  cn(
    'group relative flex cursor-default select-none items-center rounded-lg border transition-colors duration-150 ease-out',
    'focus-visible:ring-inset focus-visible:ring-offset-0',
    isDragging
      ? 'border-dashed border-blurple-500/45 bg-blurple-600/[0.04] text-ink-secondary dark:border-blurple-400/45 dark:bg-blurple-400/[0.06] dark:text-ink-inverse-secondary'
      : isActive
        ? 'border-surface-200 bg-surface-0 text-ink dark:border-surface-700/70 dark:bg-surface-800 dark:text-ink-inverse'
        : isGroupedAnchor
          ? 'border-surface-200/80 bg-surface-0/60 text-ink dark:border-surface-700/55 dark:bg-surface-800/55 dark:text-ink-inverse'
          : cn('border-transparent text-ink-secondary dark:text-ink-inverse-secondary', CHROME_HOVER),
  )

interface StripDragSession {
  tabId: string
  pointerId: number
  target: HTMLElement
  startX: number
  startY: number
  dragging: boolean
  lastZone: SplitDropZone | null
}

function useTabStripSplitDrag(onCommitSplit: (tabId: string, zone: SplitDropZone) => void) {
  const dragRef = useRef<StripDragSession | null>(null)
  const commitRef = useRef(onCommitSplit)
  commitRef.current = onCommitSplit
  const suppressClickTabRef = useRef<string | null>(null)
  const [draggingState, setDraggingState] = useState<{ tabId: string; x: number; y: number } | null>(null)

  const clearPreview = () => {
    void window.electron?.tabs.previewSplitDrop?.(null)
  }

  const scheduleClearSuppressClick = (tabId: string) => {
    setTimeout(() => {
      if (suppressClickTabRef.current === tabId) {
        suppressClickTabRef.current = null
      }
    }, 0)
  }

  const releaseCapture = (session: StripDragSession) => {
    try {
      if (session.target.hasPointerCapture(session.pointerId)) {
        session.target.releasePointerCapture(session.pointerId)
      }
    } catch {}
  }

  const cancelDrag = () => {
    if (!dragRef.current) return
    const session = dragRef.current
    dragRef.current = null
    setDraggingState(null)
    releaseCapture(session)
    if (session.dragging) {
      clearPreview()
      scheduleClearSuppressClick(session.tabId)
    }
  }

  useEffect(() => {
    const onWindowPointerMove = (e: PointerEvent) => {
      const session = dragRef.current
      if (!session || session.pointerId !== e.pointerId) return

      if (!session.dragging) {
        if (Math.hypot(e.clientX - session.startX, e.clientY - session.startY) < DRAG_THRESHOLD_PX) {
          return
        }
        session.dragging = true
        suppressClickTabRef.current = session.tabId
      }

      setDraggingState({ tabId: session.tabId, x: e.clientX, y: e.clientY })

      const { chromeBottom, sidebarRight, contentArea } = measureShellSplitRegions()
      const split = useTabStore.getState().split
      const rawZone = hitTestSplitDropZone(
        { x: e.clientX, y: e.clientY },
        chromeBottom,
        sidebarRight,
        contentArea,
        split,
        { allowRegroup: true },
      )
      const effectiveZone = rawZone === 'regroup' ? null : rawZone
      if (effectiveZone !== session.lastZone) {
        session.lastZone = effectiveZone
        void window.electron?.tabs.previewSplitDrop?.(effectiveZone)
      }
    }

    const onWindowPointerUp = (e: PointerEvent) => {
      const session = dragRef.current
      if (!session || session.pointerId !== e.pointerId) return
      dragRef.current = null
      setDraggingState(null)
      releaseCapture(session)
      if (!session.dragging) return
      clearPreview()
      scheduleClearSuppressClick(session.tabId)
      if (session.lastZone && session.lastZone !== 'regroup') {
        commitRef.current(session.tabId, session.lastZone)
      }
    }

    const onWindowPointerCancel = (e: PointerEvent) => {
      if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
        cancelDrag()
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragRef.current) cancelDrag()
    }
    const onBlur = () => cancelDrag()

    window.addEventListener('pointermove', onWindowPointerMove)
    window.addEventListener('pointerup', onWindowPointerUp)
    window.addEventListener('pointercancel', onWindowPointerCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove)
      window.removeEventListener('pointerup', onWindowPointerUp)
      window.removeEventListener('pointercancel', onWindowPointerCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const onPointerDown = (tabId: string, e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement | null)?.closest('[data-tab-close="true"]')) return
    const state = useTabStore.getState()
    if (state.tabs.length < 2 && state.split.mode === 'single') return

    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}

    dragRef.current = {
      tabId,
      pointerId: e.pointerId,
      target: e.currentTarget,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      lastZone: null,
    }
  }

  const shouldSuppressClick = (tabId: string): boolean => {
    if (suppressClickTabRef.current === tabId) {
      suppressClickTabRef.current = null
      return true
    }
    return false
  }

  return {
    draggingTabId: draggingState?.tabId ?? null,
    draggingPoint: draggingState ? { x: draggingState.x, y: draggingState.y } : null,
    onPointerDown,
    onCancel: cancelDrag,
    shouldSuppressClick,
  }
}

function DragTabGhost({ tab, point }: { tab: Tab | undefined; point: { x: number; y: number } | null }) {
  if (!tab || !point || typeof document === 'undefined') return null
  return createPortal(
    <div
      aria-hidden
      style={{
        transform: `translate3d(${Math.round(point.x + 12)}px, ${Math.round(point.y + 12)}px, 0)`,
      }}
      className="pointer-events-none fixed left-0 top-0 z-[9999] flex max-w-[220px] items-center gap-2 rounded-lg border border-blurple-500/50 bg-surface-0/95 px-2.5 py-1.5 text-[12px] font-medium text-ink shadow-float backdrop-blur-md dark:border-blurple-400/50 dark:bg-surface-850/95 dark:text-ink-inverse"
    >
      <TabFavicon tab={tab} active />
      <span className="truncate">{tab.title}</span>
    </div>,
    document.body,
  )
}

/** Horizontal tab strip — shown under the toolbar while the sidebar is closed. */
export function TabBar() {
  const { tabs, activeTabId, split } = useTabStore()
  const { create, select, close, splitTab } = useTabActions()
  const reduced = useReducedMotion()
  const groupedTabs = useMemo(() => tabs.filter((t) => !t.isSplitDetached), [tabs])
  const groupedSlotTabId = getGroupedSlotTabId(split)
  const drag = useTabStripSplitDrag((tabId, zone) => {
    void splitTab(tabId, zone, 'strip')
  })
  const draggedTab = drag.draggingTabId ? tabs.find((t) => t.id === drag.draggingTabId) : undefined

  return (
    <div className="flex h-9 items-center gap-1.5 px-3 pb-1.5" role="tablist" aria-label="Open tabs">
      {/* Brand anchor while the sidebar (which carries the wordmark) is closed. */}
      <RenWordmark className="mr-1.5 text-[20px] text-ink dark:text-ink-inverse" />
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
        <AnimatePresence mode="popLayout" initial={false}>
          {groupedTabs.map((tab) => {
            const isActive = activeTabId === tab.id
            const isGroupedAnchor = split.mode !== 'single' && groupedSlotTabId === tab.id
            const isDragging = drag.draggingTabId === tab.id
            return (
              <motion.div
                key={tab.id}
                layout={!reduced}
                initial={reduced ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: isDragging ? 0.52 : 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
                onPointerDown={(e) => drag.onPointerDown(tab.id, e)}
                onClick={() => {
                  if (drag.shouldSuppressClick(tab.id)) return
                  void select(tab.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    void select(tab.id)
                  }
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault()
                    void close(tab.id)
                  }
                }}
                title={tab.title}
                className={cn(
                  tabRowClass(isActive, isGroupedAnchor, isDragging),
                  'h-7 min-w-[120px] max-w-[220px] flex-1 basis-[180px] gap-2 pl-2.5 pr-1',
                )}
              >
                <TabFavicon tab={tab} active={isActive || isGroupedAnchor} />
                <span className={cn('flex-1 truncate text-[13px]', isActive || isGroupedAnchor ? 'font-medium' : 'font-normal')}>
                  {tab.title}
                </span>
                {split.mode !== 'single' && isGroupedAnchor && (
                  <span className={cn(!isActive && 'group-hover:hidden group-focus-within:hidden')}>
                    <SplitSlotGlyph split={split} active={isActive} />
                  </span>
                )}
                <CloseButton
                  onClose={() => void close(tab.id)}
                  title={tab.title}
                  className={cn(
                    isActive
                      ? 'opacity-100'
                      : isGroupedAnchor
                        ? 'hidden group-hover:flex group-focus-within:flex'
                        : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                  )}
                />
                {/* Active indicator: a 2px volt rule along the foot of the tab (muted when another split pane holds focus). */}
                {(isActive || isGroupedAnchor) && (
                  <span
                    aria-hidden
                    className={cn(
                      'pointer-events-none absolute inset-x-3 -bottom-px h-0.5 rounded-full',
                      isActive ? 'bg-volt' : 'bg-blurple-600/35 dark:bg-blurple-400/35',
                    )}
                  />
                )}
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
      <DragTabGhost tab={draggedTab} point={drag.draggingPoint} />
    </div>
  )
}

/** Vertical tab list — rendered inside the sidebar while it is open. */
export function VerticalTabList() {
  const { tabs, activeTabId, split } = useTabStore()
  const { create, select, close, splitTab } = useTabActions()
  const reduced = useReducedMotion()
  const groupedTabs = useMemo(() => tabs.filter((t) => !t.isSplitDetached), [tabs])
  const groupedSlotTabId = getGroupedSlotTabId(split)
  const drag = useTabStripSplitDrag((tabId, zone) => {
    void splitTab(tabId, zone, 'strip')
  })
  const draggedTab = drag.draggingTabId ? tabs.find((t) => t.id === drag.draggingTabId) : undefined

  return (
    <div className="flex flex-col gap-px" role="tablist" aria-label="Open tabs" aria-orientation="vertical">
      <AnimatePresence initial={false}>
        {groupedTabs.map((tab) => {
          const isActive = activeTabId === tab.id
          const isGroupedAnchor = split.mode !== 'single' && groupedSlotTabId === tab.id
          const isDragging = drag.draggingTabId === tab.id
          return (
            <motion.div
              key={tab.id}
              layout={!reduced}
              initial={reduced ? false : { opacity: 0, x: -6 }}
              animate={{ opacity: isDragging ? 0.52 : 1, x: 0 }}
              exit={reduced ? undefined : { opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              onPointerDown={(e) => drag.onPointerDown(tab.id, e)}
              onClick={() => {
                if (drag.shouldSuppressClick(tab.id)) return
                void select(tab.id)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  void select(tab.id)
                }
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  void close(tab.id)
                }
              }}
              title={tab.title}
              className={cn(tabRowClass(isActive, isGroupedAnchor, isDragging), 'h-8 gap-2.5 pl-2.5 pr-1')}
            >
              <TabFavicon tab={tab} active={isActive || isGroupedAnchor} />
              <span className={cn('flex-1 truncate text-[13px]', isActive || isGroupedAnchor ? 'font-medium' : 'font-normal')}>
                {tab.title}
              </span>
              {split.mode !== 'single' && isGroupedAnchor && (
                <SplitSlotGlyph split={split} active={isActive} />
              )}
              <CloseButton
                onClose={() => void close(tab.id)}
                title={tab.title}
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              />
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
      <DragTabGhost tab={draggedTab} point={drag.draggingPoint} />
    </div>
  )
}
