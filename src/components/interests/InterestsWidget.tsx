import { useEffect, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { motion, AnimatePresence, useDragControls } from 'framer-motion'
import { Network, Pin, X } from 'lucide-react'
import { RenMark } from '@/components/brand'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { BRAND } from '@/lib/brand'
import { useContextAgentStore, type ContextTab } from '@/stores/contextAgentStore'
import { useInterestDiscoveryStore } from '@/stores/interestDiscoveryStore'
import { useInterestsStore } from '@/stores/interestsStore'
import { cn } from '@/utils/cn'
import { NeuralCanvas } from './NeuralCanvas'
import { InterestDiscoveryPanel } from './InterestDiscoveryPanel'
import { ContextTray } from './ContextTray'
import { ContextAgents } from './ContextAgents'
import { ContextAsk } from './ContextAsk'
import { AgentRunNotice } from './AgentRuns'
import { runNotifications } from '@/lib/context-api'

interface SurfaceBridgeWindow {
  contextSurface?: {
    reportMetrics?: (metrics: { pillWidth?: number; noticeHeight?: number; orbHovered?: boolean }) => void
    dragStart?: (surface: 'widget' | 'discovery') => void
    dragMove?: (surface: 'widget' | 'discovery') => void
    dragEnd?: (surface: 'widget' | 'discovery') => void
  }
}

function getContextSurface() {
  return typeof window !== 'undefined' ? (window as unknown as SurfaceBridgeWindow).contextSurface : undefined
}

const TABS: { id: ContextTab; label: string }[] = [
  { id: 'interests', label: 'Interests' },
  { id: 'context', label: 'Context' },
  { id: 'agents', label: 'Agents' },
  { id: 'ask', label: 'Ask' },
]

// Ren's house curve (docs/brand.md § Shape and depth: ease-out-expo)
const EASE = [0.19, 1, 0.22, 1] as const

// Shimmer (AI Elements) reads shadcn v4 colour variables; map them onto Ren's tokens.
const SHIMMER_VARS = {
  '--color-muted-foreground': 'hsl(var(--foreground) / 0.72)',
  '--color-background': 'hsl(var(--background))',
} as CSSProperties

const iconButton = 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-secondary transition-colors duration-150 hover:bg-surface-100 hover:text-ink disabled:pointer-events-none disabled:opacity-40 dark:text-ink-inverse-secondary dark:hover:bg-surface-850 dark:hover:text-ink-inverse'

/**
 * Focus hand-off between the orb and the panel (opening one unmounts the other). The panel takes focus
 * only when the person opened it from the orb, never when an add or capture opens it in the background,
 * and the orb takes it back only when the person closed the panel (Close or Escape).
 */
let focusPanel = false
let refocusOrb = false

/**
 * Widget surface body (`CollapsedOrb`, `AgentRunNotice`, and `ExpandedPanel`), rendered inside
 * Electron's `ContextSurface.widgetView` (and inline inside `<InterestsWidget />` in browser previews).
 */
export function InterestsWidgetSurface() {
  const isExpanded = useInterestsStore((state) => state.isExpanded)
  const isInitialized = useInterestsStore((state) => state.isInitialized)
  const { toggleExpanded, setExpanded, initializeFromOnboarding } = useInterestsStore.getState()

  useEffect(() => {
    if (!isInitialized && !getContextSurface()) initializeFromOnboarding()
  }, [isInitialized, initializeFromOnboarding])

  const open = () => {
    focusPanel = true
    getContextSurface()?.reportMetrics?.({ orbHovered: false })
    toggleExpanded()
  }
  // Pin only keeps the panel open when work is handed to the Agent Panel (`yieldToPanel`); Close always closes it.
  const close = () => {
    const surface = getContextSurface()
    if (!surface) {
      refocusOrb = true
    } else {
      surface.reportMetrics?.({ orbHovered: false })
    }
    useInterestDiscoveryStore.getState().clearSelection()
    setExpanded(false)
  }

  return (
    <>
      <AnimatePresence>
        {!isExpanded && (
          <div className="fixed bottom-5 right-5 z-40">
            <CollapsedOrb key="collapsed" onClick={open} />
          </div>
        )}
      </AnimatePresence>
      {/* A specialist's finished run (scheduled or Run now): Review opens its session in the Agent Panel. */}
      {!isExpanded && <AgentRunNotice />}
      <AnimatePresence>
        {isExpanded && <ExpandedPanel key="expanded" onClose={close} />}
      </AnimatePresence>
    </>
  )
}

/**
 * Full Context widget for inline rendering when not hosted in Electron's native `ContextSurface`.
 */
export function InterestsWidget() {
  return (
    <>
      <InterestsWidgetSurface />
      <InterestDiscoveryPanel />
    </>
  )
}

function CollapsedOrb({ onClick }: { onClick: () => void }) {
  const status = useContextAgentStore((state) => state.status)
  const unseen = useContextAgentStore((state) => state.unseen)
  const recordingSince = useContextAgentStore((state) => state.recordingSince)
  // An add, upload or capture in flight ("Adding to your context…") counts as work too.
  const busy = useContextAgentStore((state) => state.busy)
  const finishedRuns = useContextAgentStore((state) => runNotifications(state.runs).length)
  const top = useInterestsStore((state) => [...state.nodes].sort((a, b) => b.weight - a.weight).slice(0, 2).map((node) => node.label).join('|'))
  const labels = top ? top.split('|') : []
  const showHoverPills = labels.length > 0 && finishedRuns === 0
  const pillRowRef = useRef<HTMLDivElement>(null)
  const working = status === 'running' || Boolean(busy)
  const state = recordingSince ? 'recording your screen'
    : busy ? busy.replace(/…$/, '')
    : finishedRuns ? `${finishedRuns} agent run${finishedRuns === 1 ? '' : 's'} to review`
    : unseen ? 'new agent recommendation'
    : working ? 'agent working'
    : null

  useLayoutEffect(() => {
    const surface = getContextSurface()
    const row = pillRowRef.current
    if (!surface?.reportMetrics || !row) return
    surface.reportMetrics({ pillWidth: Math.ceil(row.scrollWidth) })
  }, [top, showHoverPills])

  const setHovered = (hovered: boolean) => {
    const surface = getContextSurface()
    if (!surface?.reportMetrics) return
    const pillWidth = pillRowRef.current ? Math.ceil(pillRowRef.current.scrollWidth) : undefined
    surface.reportMetrics({ orbHovered: hovered && showHoverPills, ...(pillWidth !== undefined ? { pillWidth } : {}) })
  }

  const refocus = (node: HTMLButtonElement | null) => {
    if (node && refocusOrb) {
      refocusOrb = false
      node.focus()
    }
  }

  return (
    <motion.button
      ref={refocus}
      type="button"
      aria-label={state ? `Open Context (${state})` : 'Open Context'}
      data-testid="context-orb"
      title={busy || (status === 'running' ? 'Context Agent is working' : undefined)}
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.9, opacity: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className={cn(
        'pointer-events-auto group relative block h-[52px] w-[52px] cursor-pointer rounded-[12px] shadow-float transition-shadow duration-200 ease-out',
        'hover:ring-4 hover:ring-blurple-500/25 dark:hover:ring-blurple-400/30',
        // Agent at work: a steady volt ring (no pulsing).
        working && 'ring-2 ring-blurple-600 ring-offset-2 ring-offset-surface-0 hover:ring-2 hover:ring-blurple-600 dark:ring-blurple-400 dark:ring-offset-surface-900 dark:hover:ring-blurple-400',
      )}
    >
      <RenMark className="h-[52px] w-[52px]" />
      {showHoverPills && (
        <div ref={pillRowRef} className="pointer-events-none absolute -top-9 right-0 flex gap-1 whitespace-nowrap opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
          {labels.map((label) => <span key={label} className="inline-flex h-6 items-center rounded-full border border-border bg-popover px-2.5 text-[12px] font-medium text-popover-foreground shadow-float">{label}</span>)}
        </div>
      )}
      {recordingSince
        ? <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-danger ring-2 ring-surface-0 dark:ring-surface-900" title="Recording your screen" />
        : (unseen || finishedRuns > 0) && <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-blurple-600 ring-2 ring-surface-0 dark:bg-blurple-400 dark:ring-surface-900" title={finishedRuns ? 'Agent runs to review' : 'New agent recommendation'} />}
    </motion.button>
  )
}

function ExpandedPanel({ onClose }: { onClose: () => void }) {
  const inNativeSurface = Boolean(getContextSurface())
  const dragControls = useDragControls()
  const constraintsRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const nativeDraggingRef = useRef(false)
  const tabRefs = useRef<Partial<Record<ContextTab, HTMLButtonElement | null>>>({})
  const tab = useContextAgentStore((state) => state.tab)
  const pinned = useContextAgentStore((state) => state.pinned)
  const status = useContextAgentStore((state) => state.status)
  const activity = useContextAgentStore((state) => state.activity)
  const unseen = useContextAgentStore((state) => state.unseen || runNotifications(state.runs).length > 0)
  const itemCount = useContextAgentStore((state) => state.items.length)
  const recordingSince = useContextAgentStore((state) => state.recordingSince)
  const { setTab, setPinned } = useContextAgentStore.getState()

  // The header says what is happening only while something is; the browsing switch lives on the Interests tab.
  const subtitle = recordingSince ? 'Recording your screen' : status === 'running' ? `${activity || 'Working'}…` : ''
  const working = !recordingSince && status === 'running'

  useEffect(() => {
    if (!focusPanel) return
    focusPanel = false
    panelRef.current?.focus({ preventScroll: true })
  }, [])

  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const surface = getContextSurface()
    if (surface?.dragStart) {
      nativeDraggingRef.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
      surface.dragStart('widget')
      return
    }
    dragControls.start(event)
  }

  const onHeaderPointerMove = () => {
    if (!nativeDraggingRef.current) return
    getContextSurface()?.dragMove?.('widget')
  }

  const endNativeDrag = () => {
    if (!nativeDraggingRef.current) return
    nativeDraggingRef.current = false
    getContextSurface()?.dragEnd?.('widget')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Inner widgets that use Escape themselves (suggestion lists, pickers) mark it handled.
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.stopPropagation()
    // The interest panel opened from the graph sits on top of this one: Escape closes it first.
    const discovery = useInterestDiscoveryStore.getState()
    if (discovery.selectedInterestLabel) discovery.clearSelection()
    else onClose()
  }

  /** WAI-ARIA tabs: one Tab stop for the row, arrow keys, Home and End move between sections. */
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((entry) => entry.id === tab)
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = TABS.length - 1
    else return
    event.preventDefault()
    const id = TABS[next].id
    setTab(id)
    tabRefs.current[id]?.focus()
  }

  return (
    <>
      {!inNativeSurface && <div ref={constraintsRef} className="pointer-events-none fixed inset-4 z-40" />}
      <motion.div
        drag={!inNativeSurface}
        dragControls={inNativeSurface ? undefined : dragControls}
        dragListener={false}
        dragMomentum={false}
        dragElastic={0.1}
        dragConstraints={inNativeSurface ? undefined : constraintsRef}
        initial={{ scale: 0.96, opacity: 0, x: 0, y: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.22, ease: EASE }}
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-label="Context"
        data-testid="context-panel"
        className={cn(
          inNativeSurface
            ? 'fixed inset-2 z-50'
            : 'fixed bottom-6 right-6 z-50 h-[560px] w-[520px]',
          'origin-bottom-right cursor-default focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
        )}
      >
        {/* The surface lives on an inner layer: `ron-glass-panel` positions itself relatively in Glass. */}
        <div className="ron-glass-panel flex h-full w-full flex-col overflow-hidden rounded-2xl border border-surface-200 bg-surface-0 text-ink shadow-float dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse">
          <div
            className="flex h-12 flex-shrink-0 cursor-grab select-none items-center justify-between gap-3 pl-4 pr-2.5 active:cursor-grabbing"
            onPointerDown={onHeaderPointerDown}
            onPointerMove={onHeaderPointerMove}
            onPointerUp={endNativeDrag}
            onPointerCancel={endNativeDrag}
            onLostPointerCapture={endNativeDrag}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <RenMark className="h-6 w-6 flex-shrink-0" title={BRAND.name} />
              <h2 className="font-display text-[15px] font-bold leading-tight tracking-tight text-ink dark:text-ink-inverse">Context</h2>
              <p className="flex min-w-0 items-center gap-1.5 text-[12px] leading-tight text-ink-secondary dark:text-ink-inverse-secondary" aria-live="polite">
                {recordingSince && <span aria-hidden className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-danger" />}
                {working
                  ? <span className="truncate" style={SHIMMER_VARS}><Shimmer as="span">{subtitle}</Shimmer></span>
                  : <span className="truncate">{subtitle}</span>}
              </p>
            </div>
            <div className="flex items-center gap-0.5" onPointerDown={(event) => event.stopPropagation()}>
              <button type="button" onClick={() => setPinned(!pinned)} title={pinned ? 'Unpin panel' : 'Keep panel open'} aria-pressed={pinned}
                className={cn(iconButton, pinned && 'bg-blurple-600/10 text-blurple-700 hover:bg-blurple-600/15 hover:text-blurple-700 dark:bg-blurple-400/15 dark:text-blurple-300 dark:hover:bg-blurple-400/20 dark:hover:text-blurple-300')}>
                <Pin className="h-4 w-4" fill={pinned ? 'currentColor' : 'none'} />
              </button>
              <button type="button" onClick={onClose} aria-label="Close Context" title="Close" className={iconButton}>
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex flex-shrink-0 items-end gap-5 border-b border-surface-200 px-4 dark:border-surface-800" role="tablist" aria-label="Context sections" onKeyDown={onTabKeyDown}>
            {TABS.map((entry) => (
              <button key={entry.id} ref={(node) => { tabRefs.current[entry.id] = node }} type="button" role="tab"
                id={`context-tab-${entry.id}`} aria-selected={tab === entry.id} aria-controls="context-tabpanel"
                tabIndex={tab === entry.id ? 0 : -1} onClick={() => setTab(entry.id)}
                className={cn('relative -mb-px inline-flex h-9 items-center gap-1.5 border-b-2 text-[13px] font-medium transition-colors duration-150',
                  tab === entry.id
                    ? 'border-blurple-600 text-ink dark:border-blurple-400 dark:text-ink-inverse'
                    : 'border-transparent text-ink-secondary hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse')}>
                {entry.label}
                {entry.id === 'context' && itemCount > 0 && <span className="font-mono text-[11px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">{itemCount}</span>}
                {entry.id === 'agents' && unseen && <span className="absolute -right-2 top-2 h-1.5 w-1.5 rounded-full bg-blurple-600 dark:bg-blurple-400" />}
              </button>
            ))}
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden" role="tabpanel" id="context-tabpanel" aria-labelledby={`context-tab-${tab}`}>
            {tab === 'interests' && <InterestsTab />}
            {tab === 'context' && <ContextTray />}
            {tab === 'agents' && <ContextAgents />}
            {tab === 'ask' && <ContextAsk />}
          </div>

          <StatusLine />
        </div>
      </motion.div>
    </>
  )
}

function InterestsTab() {
  const nodeCount = useInterestsStore((state) => state.nodes.length)
  const watchBrowsing = useContextAgentStore((state) => state.watchBrowsing)
  const pending = useContextAgentStore((state) => state.visits.length)
  const status = useContextAgentStore((state) => state.status)
  const { setWatchBrowsing, flushBrowsing } = useContextAgentStore.getState()

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {nodeCount > 0 ? <NeuralCanvas /> : (
          <div className="flex h-full flex-col items-center justify-center px-10 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-100 text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary">
              <Network className="h-5 w-5" />
            </span>
            <h3 className="mt-4 font-display text-lg font-bold tracking-tight text-ink dark:text-ink-inverse">Nothing mapped yet</h3>
            <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
              Ren builds your interest graph from the pages you visit and the context you save. Browse for a while, or add something in Context.
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-surface-200 px-4 py-2 text-[12px] text-ink-secondary dark:border-surface-800 dark:text-ink-inverse-secondary">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={watchBrowsing} onChange={(event) => setWatchBrowsing(event.target.checked)} className="h-3.5 w-3.5 accent-blurple-600 dark:accent-blurple-400" />
          Learn from my browsing
        </label>
        <div className="flex items-center gap-2">
          {watchBrowsing && <span className="tabular-nums">{pending ? `${pending} new page${pending === 1 ? '' : 's'}` : 'Up to date'}</span>}
          <button type="button" disabled={!pending || status === 'running'} onClick={() => void flushBrowsing(true)}
            className="inline-flex h-7 items-center rounded-lg px-2.5 text-[12px] font-semibold text-blurple-700 transition-colors duration-150 hover:bg-blurple-600/10 disabled:pointer-events-none disabled:opacity-40 dark:text-blurple-300 dark:hover:bg-blurple-400/15">Update now</button>
        </div>
      </div>
    </div>
  )
}

function StatusLine() {
  const error = useContextAgentStore((state) => state.error)
  const notice = useContextAgentStore((state) => state.notice)
  const busy = useContextAgentStore((state) => state.busy)
  const clearMessages = useContextAgentStore((state) => state.clearMessages)
  const text = error || busy || notice
  if (!text) return null
  return (
    <div className={cn('flex flex-shrink-0 items-start justify-between gap-3 border-t px-4 py-2 text-[12px] leading-relaxed',
      error ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300' : 'border-surface-200 text-ink-secondary dark:border-surface-800 dark:text-ink-inverse-secondary')}
      role={error ? 'alert' : 'status'}>
      <span className="line-clamp-3">{text}</span>
      {!busy && <button type="button" onClick={clearMessages} aria-label="Dismiss message" className="-mr-1 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity duration-150 hover:opacity-100"><X className="h-3.5 w-3.5" /></button>}
    </div>
  )
}
