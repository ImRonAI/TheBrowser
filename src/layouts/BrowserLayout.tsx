import { ReactNode, useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { ChromeToolbar } from '@/components/chrome/ChromeToolbar'
import { TabBar, useTabSync } from '@/components/chrome/TabBar'
import { AgentPanel } from '@/components/agent-panel/AgentPanel'
import { MusicSidePanel } from '@/components/agent-panel/MusicSidePanel'
import { ScreenVisionOverlay } from '@/components/agent-panel/ScreenVisionOverlay'
import { ContextBridge } from '@/components/interests/ContextBridge'
import { InterestMenuSync } from '@/components/interests/InterestMenuSync'
import { InterestsWidget } from '@/components/interests/InterestsWidget'
import { RepairBridge } from '@/components/agent-panel/RepairBridge'
import { ContextMenu } from '@/components/shared/ContextMenu'
import { BrowserGlowBorder } from '@/components/shared/BrowserGlowBorder'
import { AgentCursor } from '@/components/shared/AgentCursor'
import { Sidebar } from '@/components/navigation/Sidebar'
import { AgentUiProvider, useAgentUi } from '@/context/AgentUiContext'
import { usePanelAgentStore } from '@/stores/panelAgentStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { useTabStore } from '@/stores/tabStore'
import { shortcutFor, type ChromeShortcut } from '@/lib/shortcuts'
import { cn } from '@/utils/cn'

interface BrowserLayoutProps {
  children: ReactNode
}

export function BrowserLayout({ children }: BrowserLayoutProps) {
  return (
    <AgentUiProvider>
      <BrowserLayoutContent>{children}</BrowserLayoutContent>
    </AgentUiProvider>
  )
}

function BrowserLayoutContent({ children }: BrowserLayoutProps) {
  const { isPanelOpen, startAskRon, openPanel } = useAgentUi()
  const isSidebarOpen = useNavigationStore((state) => state.isSidebarOpen)
  useTabSync()
  const panelWidth = usePanelAgentStore((state) => state.panelWidth)
  const teachingInset = usePanelAgentStore((state) => state.teachingInset)
  const sideInset = Math.max(isPanelOpen ? panelWidth : 0, teachingInset)
  const [isExternalMode, setIsExternalMode] = useState(false)
  const chromeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.electron?.browser?.setPanelOpen?.(sideInset > 0)
  }, [sideInset])
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    isOpen: boolean
    selectedText?: string
  }>({
    x: 0,
    y: 0,
    isOpen: false,
  })

  // Listen for external mode changes and Ask Ron events from main process
  useEffect(() => {
    if (typeof window !== 'undefined' && window.electron?.browser) {
      const modeCleanup = window.electron.browser.onExternalMode((isExternal: boolean) => {
        setIsExternalMode(isExternal)
      })

      const askRonCleanup = window.electron.browser.onAskRon(({ selectionText, sourceUrl, x, y }) => {
        startAskRon(selectionText, sourceUrl)
        setContextMenu({
          x: x ?? 0,
          y: y ?? 0,
          isOpen: true,
          selectedText: selectionText,
        })
      })

      return () => {
        modeCleanup()
        askRonCleanup()
      }
    }
  }, [startAskRon])

  // Global shortcuts: ⌘J Ask Ron, ⌘K Search, ⌘\ sidebar, ⌘L address bar. In Electron
  // the main process catches them (also while a website has focus) and sends
  // `chrome:shortcut`; in a plain browser the renderer's own keydown handles them.
  const runShortcut = useRef<(shortcut: ChromeShortcut, selectionText?: string, sourceUrl?: string) => void>(() => {})
  runShortcut.current = (shortcut, selectionText, sourceUrl) => {
    const nav = useNavigationStore.getState()
    if (shortcut === 'search') { nav.requestSearchFocus(); return }
    if (shortcut === 'toggle-sidebar') { nav.toggleSidebar(); return }
    if (shortcut === 'focus-url') { nav.requestUrlFocus(); return }
    // Ask Ron: with a selection, the same Ask Ron menu as the context menu;
    // otherwise open the agent panel and put the cursor in its composer.
    const selected = (selectionText ?? window.getSelection()?.toString() ?? '').trim()
    if (selected) {
      const url = sourceUrl || useTabStore.getState().getActiveTab()?.url || window.location.href
      void startAskRon(selected, url)
      const rect = chromeRef.current?.getBoundingClientRect()
      setContextMenu({
        x: Math.round(window.innerWidth / 2 - 160),
        y: Math.round((rect?.bottom ?? 88) + 16),
        isOpen: true,
        selectedText: selected,
      })
      return
    }
    openPanel()
    // Already open: the panel's own open-effect will not run again, so focus directly.
    // The composer's label reads "Message Ren" since the rename; "Message Ron" is kept so focus
    // still lands whichever label the panel ships with.
    window.setTimeout(() => {
      const composer = document.querySelector<HTMLTextAreaElement>('section textarea[aria-label="Message Ren"], section textarea[aria-label="Message Ren"], section textarea[aria-label="Steer the active run"]')
      composer?.focus()
    }, 320)
  }

  useEffect(() => {
    const off = window.electron?.browser?.onChromeShortcut?.(({ shortcut, selectionText, sourceUrl }) => {
      runShortcut.current(shortcut, selectionText, sourceUrl)
    })
    if (off) return off
    // No Electron bridge (plain browser preview): read the keys in the renderer.
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutFor(event)
      if (!shortcut) return
      event.preventDefault()
      runShortcut.current(shortcut)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Keep the native WebContentsView below the real chrome: report the measured
  // header height on layout changes and on shell zoom (which fires `resize`),
  // plus any open toolbar/chrome dropdowns or popovers so native WebContentsViews
  // never occlude menus over external websites.
  useEffect(() => {
    const header = chromeRef.current
    const setChromeHeight = window.electron?.browser?.setChromeHeight
    if (!header || !setChromeHeight) return
    const report = () => {
      let bottom = header.getBoundingClientRect().height
      const overlays = document.querySelectorAll<HTMLElement>(
        '[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-chrome-overlay="true"]',
      )
      for (const el of overlays) {
        if (el.closest('section[aria-label]')) continue
        const rect = el.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0 && rect.bottom > bottom) {
          bottom = Math.min(window.innerHeight, Math.ceil(rect.bottom + 8))
        }
      }
      void setChromeHeight(bottom)
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(header)
    const mutationObserver = new MutationObserver(() => requestAnimationFrame(report))
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'data-state', 'data-open', 'hidden'],
    })
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [])

  // Handle right-click to show context menu
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault()

      const selection = window.getSelection()
      const selectedText = selection?.toString().trim()

      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        isOpen: true,
        selectedText,
      })
    }

    // Double-click on renderer content (home, reader, projects) opens the same
    // menu when a word/phrase is selected. Nothing is sent until the user picks
    // "Ask Ron" there; the native WebContentsView path is handled in Electron.
    const handleDoubleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target || target.closest('input, textarea, [contenteditable="true"], button, a, [data-no-ask-ron]')) return
      const selectedText = window.getSelection()?.toString().trim()
      if (!selectedText) return
      setContextMenu({ x: e.clientX, y: e.clientY, isOpen: true, selectedText })
    }

    document.addEventListener('contextmenu', handleContextMenu)
    document.addEventListener('dblclick', handleDoubleClick)
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu)
      document.removeEventListener('dblclick', handleDoubleClick)
    }
  }, [])

  return (
    <div className={cn(
      'flex h-screen overflow-hidden text-ink dark:text-ink-inverse',
      'ron-chrome',
      'selection:bg-blurple-600/20 dark:selection:bg-blurple-400/30',
    )}>
      {/* Agent activity frame (volt hairline) - persists across entire app */}
      <BrowserGlowBorder />

      {/* Persistent left sidebar: search, destinations, tabs (⌘\ to toggle) */}
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Browser chrome: toolbar, plus the tab strip while the sidebar is closed */}
        <div ref={chromeRef} className="ron-toolbar relative z-[100] flex-shrink-0 border-b border-surface-200 dark:border-surface-800">
          <ChromeToolbar />
          {!isSidebarOpen && <TabBar />}
        </div>

        {/* Main Content Area (`ron-content`: the Glass theme's see-through content layer). `overflow-clip`, not
            `-hidden`: a hidden box can still be scrolled by focus()/scrollIntoView, which shifted the page and the
            panel up under the toolbar with no way back; a clipped box cannot be scrolled at all. A clipped box is
            not a scroll container, so `min-h-0` is required: without it the flex item grows to its content. */}
        <div className="ron-content relative min-h-0 flex-1 overflow-clip bg-surface-0 dark:bg-surface-900">
          {/* React content - hidden when WebContentsView is showing external websites */}
          {!isExternalMode && (
            <motion.div
              className="h-full overflow-auto scrollbar-thin"
              animate={{
                marginRight: sideInset,
              }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              {children}
            </motion.div>
          )}

          {/* Agent Panel - positioned within the content area */}
          <AgentPanel />
          <AgentCursor />
          <div id="ron-teaching-slot" className="pointer-events-none absolute inset-0 z-[60]" />
          {/* Music side tab + deck: visible only while Lyria RealTime is playing or a take awaits saving. */}
          <MusicSidePanel />

          {/* Screen Vision Overlay */}
          <ScreenVisionOverlay />

          <InterestMenuSync />
          <ContextBridge />
          <InterestsWidget />
          {/* Native repair surface bridge: mirrors the current investigation into Electron's WebContentsView. */}
          <RepairBridge />
        </div>
      </div>

      {/* Context Menu */}
      <ContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        isOpen={contextMenu.isOpen}
        selectedText={contextMenu.selectedText}
        onClose={() => setContextMenu(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  )
}
