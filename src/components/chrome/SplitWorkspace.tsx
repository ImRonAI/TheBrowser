/**
 * Clear architectural multi-pane split workspace (`split-2`, `split-3-left`, `split-3-right`, `split-4`).
 *
 * Geometry matches `computeSplitLayoutBounds` in `tab-split.ts` to the integer pixel:
 * - Outer shell stays 100% clear (`bg-transparent`) with `SPLIT_SHELL_PADDING_PX` (8px) margin
 *   and `SPLIT_PANE_GAP_PX` (8px) clear channels between columns and stacked quadrants
 * - Each split pane is a `12px`-rounded clear-framed window card with a `34px` tactile header
 *   (favicon badge, title, host/route origin, subtle top hover grabber bar, "Return to grouped tabs",
 *   and "Close") and a concentric `9px`-rounded inner viewport inset by `3px`
 * - External tabs render a clear `pointer-events-none` viewport slot over which Electron composites
 *   the native `WebContentsView` (`setBorderRadius(9 * zoom)`); internal `ron://` tabs render
 *   `<TabRouteContent />` inside their isolated scroll viewport.
 */
import { X } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { TabFavicon, measureShellSplitRegions, useTabActions } from '@/components/chrome/TabBar'
import { TabRouteContent } from '@/components/chrome/TabRouteContent'
import { TabPaneProvider } from '@/context/TabPaneContext'
import {
  SPLIT_PANE_GAP_PX,
  SPLIT_PANE_HEADER_HEIGHT,
  SPLIT_SHELL_PADDING_PX,
  SPLIT_VIEWPORT_INSET_PX,
  SPLIT_VIEWPORT_RADIUS_PX,
  computeSplitAxisSizes,
  getSplitPaneEntries,
  hitTestSplitDropZone,
  type SplitDropZone,
  type SplitPaneSlot,
  type SplitState,
} from '@/lib/tab-split'
import { useTabStore, type Tab } from '@/stores/tabStore'
import { cn } from '@/utils/cn'

const DRAG_THRESHOLD_PX = 6

function gridPositionStyle(mode: Exclude<SplitState['mode'], 'single'>, slot: SplitPaneSlot): CSSProperties {
  if (mode === 'split-2') {
    return slot === 'left' ? { gridColumn: '1', gridRow: '1' } : { gridColumn: '2', gridRow: '1' }
  }
  if (mode === 'split-3-left') {
    if (slot === 'topLeft') return { gridColumn: '1', gridRow: '1' }
    if (slot === 'bottomLeft') return { gridColumn: '1', gridRow: '2' }
    return { gridColumn: '2', gridRow: '1 / 3' }
  }
  if (mode === 'split-3-right') {
    if (slot === 'left') return { gridColumn: '1', gridRow: '1 / 3' }
    if (slot === 'topRight') return { gridColumn: '2', gridRow: '1' }
    return { gridColumn: '2', gridRow: '2' }
  }
  switch (slot) {
    case 'topLeft':
      return { gridColumn: '1', gridRow: '1' }
    case 'topRight':
      return { gridColumn: '2', gridRow: '1' }
    case 'bottomLeft':
      return { gridColumn: '1', gridRow: '2' }
    default:
      return { gridColumn: '2', gridRow: '2' }
  }
}

function formatPaneOrigin(url: string | undefined): string | null {
  if (!url || url === 'about:blank') return null
  if (url.startsWith('ron://')) {
    const route = (url.slice('ron://'.length).split(/[/?#]/, 1)[0] ?? '').toLowerCase()
    if (!route || route === 'home') return 'ren'
    if (route === 'project' || route === 'projects' || route === 'execute' || route === 'board') {
      return 'ren · projects'
    }
    if (route === 'documents') return 'ren · docs'
    if (route === 'read') return 'ren · reader'
    return `ren · ${route}`
  }
  try {
    const parsed = new URL(url)
    return parsed.host.replace(/^www\./i, '')
  } catch {
    return null
  }
}

/** Custom crisp icon depicting lifting a split pane back up into the grouped tab strip. */
function DockToTabsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="2" y="2" width="12" height="3.2" rx="1.1" />
      <path d="M8 13.5V8.1" />
      <path d="M5.6 10.3L8 7.9L10.4 10.3" />
    </svg>
  )
}

export function SplitWorkspace({ sideInset }: { sideInset: number }) {
  const split = useTabStore((state) => state.split)
  const tabs = useTabStore((state) => state.tabs)
  const activeTabId = useTabStore((state) => state.activeTabId)
  const { select, close, splitTab, unsplitTab } = useTabActions()
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const nextW = el.clientWidth
      const nextH = el.clientHeight
      setSize((prev) => (prev.width === nextW && prev.height === nextH ? prev : { width: nextW, height: nextH }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [split.mode, sideInset])

  if (split.mode === 'single') return null

  const entries = getSplitPaneEntries(split)
  const tabMap = new Map(tabs.map((t) => [t.id, t]))
  const hasTwoRows = split.mode !== 'split-2'

  const innerW = Math.max(0, size.width - SPLIT_SHELL_PADDING_PX * 2)
  const innerH = Math.max(0, size.height - SPLIT_SHELL_PADDING_PX * 2)
  const cols = innerW > 0 ? computeSplitAxisSizes(innerW, SPLIT_PANE_GAP_PX) : null
  const rows = innerH > 0 ? computeSplitAxisSizes(innerH, SPLIT_PANE_GAP_PX) : null

  const gridTemplateColumns = cols ? `${cols.first}px ${cols.second}px` : 'minmax(0, 1fr) minmax(0, 1fr)'
  const gridTemplateRows = hasTwoRows
    ? rows
      ? `${rows.first}px ${rows.second}px`
      : 'minmax(0, 1fr) minmax(0, 1fr)'
    : innerH > 0
      ? `${innerH}px`
      : 'minmax(0, 1fr)'

  return (
    <div
      ref={containerRef}
      data-testid="split-workspace"
      data-split-mode={split.mode}
      className="grid h-full min-h-0 min-w-0 bg-transparent"
      style={{
        marginRight: sideInset,
        padding: SPLIT_SHELL_PADDING_PX,
        gap: SPLIT_PANE_GAP_PX,
        gridTemplateColumns,
        gridTemplateRows,
      }}
    >
      {entries.map(([slot, paneTabId]) => {
        const tab = tabMap.get(paneTabId)
        if (!tab) return null
        const isLeftColumn = slot === 'left' || slot === 'topLeft' || slot === 'bottomLeft'
        const paneWidthPx = cols ? (isLeftColumn ? cols.first : cols.second) : 0
        return (
          <SplitPaneCell
            key={`${slot}:${paneTabId}`}
            slot={slot}
            tab={tab}
            isActive={activeTabId === paneTabId}
            isGroupedSlot={split.groupedSlot === slot}
            paneWidthPx={paneWidthPx}
            style={gridPositionStyle(split.mode, slot)}
            onActivate={() => {
              if (useTabStore.getState().activeTabId !== paneTabId) {
                void select(paneTabId)
              }
            }}
            onReturnToGroup={() => void unsplitTab(paneTabId, false)}
            onClose={() => void close(paneTabId)}
            onRearrange={(zone) => {
              if (zone === 'regroup') void unsplitTab(paneTabId, false)
              else void splitTab(paneTabId, zone, 'pane')
            }}
          />
        )
      })}
    </div>
  )
}

interface SplitPaneCellProps {
  slot: SplitPaneSlot
  tab: Tab
  isActive: boolean
  isGroupedSlot: boolean
  paneWidthPx: number
  style: CSSProperties
  onActivate: () => void
  onReturnToGroup: () => void
  onClose: () => void
  onRearrange: (zone: SplitDropZone) => void
}

interface HeaderDragSession {
  pointerId: number
  target: HTMLElement
  startX: number
  startY: number
  dragging: boolean
  lastZone: SplitDropZone | null
}

function SplitPaneCell({
  slot,
  tab,
  isActive,
  isGroupedSlot,
  paneWidthPx,
  style,
  onActivate,
  onReturnToGroup,
  onClose,
  onRearrange,
}: SplitPaneCellProps) {
  const isExternal = !tab.url.startsWith('ron://') && tab.url !== 'about:blank'
  const origin = formatPaneOrigin(tab.url)
  const showOrigin =
    Boolean(origin) &&
    origin?.toLowerCase() !== tab.title.trim().toLowerCase() &&
    (paneWidthPx === 0 || paneWidthPx >= 280)
  const showDockLabel = paneWidthPx >= 410

  const dragRef = useRef<HeaderDragSession | null>(null)
  const rearrangeRef = useRef(onRearrange)
  rearrangeRef.current = onRearrange
  const slotRef = useRef(slot)
  slotRef.current = slot
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; zone: SplitDropZone | null } | null>(null)

  const clearPreview = () => {
    void window.electron?.tabs.previewSplitDrop?.(null)
  }

  const releaseCapture = (session: HeaderDragSession) => {
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
    setDragGhost(null)
    releaseCapture(session)
    if (session.dragging) clearPreview()
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
      }

      const { chromeBottom, sidebarRight, contentArea } = measureShellSplitRegions()
      const split = useTabStore.getState().split
      const zone = hitTestSplitDropZone(
        { x: e.clientX, y: e.clientY },
        chromeBottom,
        sidebarRight,
        contentArea,
        split,
        { allowRegroup: true, draggedSlot: slotRef.current },
      )
      setDragGhost({ x: e.clientX, y: e.clientY, zone })
      if (zone !== session.lastZone) {
        session.lastZone = zone
        void window.electron?.tabs.previewSplitDrop?.(zone)
      }
    }

    const onWindowPointerUp = (e: PointerEvent) => {
      const session = dragRef.current
      if (!session || session.pointerId !== e.pointerId) return
      dragRef.current = null
      setDragGhost(null)
      releaseCapture(session)
      if (!session.dragging) return
      clearPreview()
      if (session.lastZone) {
        rearrangeRef.current(session.lastZone)
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

  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    onActivate()
    if (e.button !== 0) return
    if ((e.target as HTMLElement | null)?.closest('button')) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
    dragRef.current = {
      pointerId: e.pointerId,
      target: e.currentTarget,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      lastZone: null,
    }
  }

  return (
    <div
      data-testid={`split-pane-${slot}`}
      data-active={isActive ? 'true' : 'false'}
      data-grouped-slot={isGroupedSlot ? 'true' : 'false'}
      style={style}
      onPointerDownCapture={onActivate}
      onFocusCapture={onActivate}
      className={cn(
        'group/pane flex min-h-0 min-w-0 flex-col bg-transparent transition-opacity duration-150 ease-out',
        dragGhost && 'opacity-[0.65]',
      )}
    >
      {/* Clear 30px floating pane header (26px frosted pill + 4px clear breathing gap above viewport) */}
      <div
        style={{ height: SPLIT_PANE_HEADER_HEIGHT }}
        className="flex flex-shrink-0 flex-col pb-1"
      >
        <div
          onPointerDown={onHeaderPointerDown}
          onLostPointerCapture={cancelDrag}
          title={`${tab.title} — Drag to rearrange or return to tabs`}
          className={cn(
            'group/header relative flex h-full w-full cursor-grab select-none items-center gap-2 rounded-[8px] px-2 backdrop-blur-md transition-[background-color,box-shadow,color] duration-150 active:cursor-grabbing',
            isActive
              ? 'bg-surface-0/[0.92] text-ink shadow-[inset_0_0_0_1px_rgb(var(--ren-volt)/0.48)] dark:bg-surface-900/[0.92] dark:text-ink-inverse dark:shadow-[inset_0_0_0_1px_rgb(var(--ren-volt)/0.48)]'
              : 'bg-surface-0/[0.82] text-ink-secondary shadow-[inset_0_0_0_1px_rgb(11_12_23/0.08)] group-hover/pane:bg-surface-0/[0.90] group-hover/pane:text-ink dark:bg-surface-900/[0.84] dark:text-ink-inverse-secondary dark:shadow-[inset_0_0_0_1px_rgb(245_245_245/0.11)] dark:group-hover/pane:bg-surface-900/[0.92] dark:group-hover/pane:text-ink-inverse',
          )}
        >
          {/* Subtle centered top grabber bar revealed on header hover */}
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute left-1/2 top-[2px] h-[2.5px] w-6 -translate-x-1/2 rounded-full transition-all duration-150',
              dragGhost
                ? 'w-8 bg-volt opacity-100'
                : 'bg-ink/[0.18] opacity-0 group-hover/header:opacity-100 dark:bg-ink-inverse/[0.24]',
            )}
          />

          <TabFavicon tab={tab} active={isActive} />

          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {isActive && (
              <span
                aria-hidden
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-volt"
              />
            )}
            <span
              className={cn(
                'min-w-0 truncate text-[12px] leading-tight tracking-[-0.01em]',
                isActive ? 'font-semibold' : 'font-medium',
              )}
            >
              {tab.title}
            </span>
            {showOrigin && (
              <span className="flex min-w-0 flex-shrink-0 items-baseline gap-1 font-mono text-[10.5px] leading-none text-ink-muted dark:text-ink-inverse-muted">
                <span aria-hidden className="opacity-45">·</span>
                <span className="max-w-[140px] truncate">{origin}</span>
              </span>
            )}
          </div>

          <div
            className={cn(
              'flex flex-shrink-0 items-center gap-0.5 transition-opacity duration-150',
              isActive ? 'opacity-100' : 'opacity-70 group-hover/pane:opacity-100 group-focus-within/pane:opacity-100',
            )}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onReturnToGroup()
              }}
              aria-label={`Return ${tab.title} to grouped tabs`}
              title="Return to grouped tabs"
              className="flex h-[20px] items-center justify-center gap-1 rounded-[5px] px-1.5 text-[11px] font-medium text-ink-muted transition-colors duration-150 hover:bg-ink/[0.08] hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-ink-inverse/[0.10] dark:hover:text-ink-inverse"
            >
              <DockToTabsIcon className="h-3.5 w-3.5 flex-shrink-0" />
              {showDockLabel && (
                <span className="hidden group-hover/pane:inline">Tabs</span>
              )}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onClose()
              }}
              aria-label={`Close split pane ${tab.title}`}
              title="Close tab"
              className="flex h-[20px] w-[20px] items-center justify-center rounded-[5px] text-ink-muted transition-colors duration-150 hover:bg-danger/[0.12] hover:text-danger dark:text-ink-inverse-muted dark:hover:bg-danger/20 dark:hover:text-red-300"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.1} />
            </button>
          </div>
        </div>
      </div>

      {/* Single crisp rounded viewport card (zero double border; native WebContentsView shares exact bounds & radius) */}
      <div
        className={cn(
          'relative flex min-h-0 flex-1 flex-col overflow-hidden transition-shadow duration-150 ease-out',
          isActive
            ? 'shadow-[0_0_0_1.5px_rgb(var(--ren-volt)/0.78),0_10px_28px_-14px_rgb(11_12_23/0.22)] dark:shadow-[0_0_0_1.5px_rgb(var(--ren-volt)/0.78),0_12px_32px_-14px_rgb(0_0_0/0.65)]'
            : 'shadow-[0_0_0_1px_rgb(11_12_23/0.11),0_4px_16px_-10px_rgb(11_12_23/0.12)] group-hover/pane:shadow-[0_0_0_1px_rgb(11_12_23/0.18)] dark:shadow-[0_0_0_1px_rgb(245_245_245/0.13),0_6px_20px_-10px_rgb(0_0_0/0.45)] dark:group-hover/pane:shadow-[0_0_0_1px_rgb(245_245_245/0.22)]',
        )}
        style={{
          borderRadius: SPLIT_VIEWPORT_RADIUS_PX,
          paddingLeft: SPLIT_VIEWPORT_INSET_PX,
          paddingRight: SPLIT_VIEWPORT_INSET_PX,
          paddingBottom: SPLIT_VIEWPORT_INSET_PX,
        }}
      >
        {isExternal ? (
          <div
            className="pointer-events-none min-h-0 flex-1 bg-transparent"
            style={{ borderRadius: SPLIT_VIEWPORT_RADIUS_PX }}
            aria-hidden
          />
        ) : (
          <div
            className="min-h-0 flex-1 overflow-auto bg-surface-0 scrollbar-thin dark:bg-surface-900"
            style={{ borderRadius: SPLIT_VIEWPORT_RADIUS_PX }}
          >
            <TabPaneProvider tabId={tab.id} url={tab.url} isSplitPane>
              <TabRouteContent tabId={tab.id} url={tab.url} />
            </TabPaneProvider>
          </div>
        )}
      </div>

      {dragGhost &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            aria-hidden
            style={{
              transform: `translate3d(${Math.round(dragGhost.x + 12)}px, ${Math.round(dragGhost.y + 12)}px, 0)`,
            }}
            className="pointer-events-none fixed left-0 top-0 z-[9999] flex max-w-[220px] items-center gap-2 rounded-lg border border-blurple-500/50 bg-surface-0/95 px-2.5 py-1.5 text-[12px] font-medium text-ink shadow-float backdrop-blur-md dark:border-blurple-400/50 dark:bg-surface-850/95 dark:text-ink-inverse"
          >
            <TabFavicon tab={tab} active />
            <span className="truncate">{tab.title}</span>
          </div>,
          document.body,
        )}
    </div>
  )
}
