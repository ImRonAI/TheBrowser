import { ReactNode, useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { ChromeToolbar } from '@/components/chrome/ChromeToolbar'
import { SplitWorkspace } from '@/components/chrome/SplitWorkspace'
import { TabBar, useTabSync } from '@/components/chrome/TabBar'
import { AgentPanel } from '@/components/agent-panel/AgentPanel'
import { MusicSidePanel } from '@/components/agent-panel/MusicSidePanel'
import { ScreenVisionOverlay } from '@/components/agent-panel/ScreenVisionOverlay'
import { ContextBridge } from '@/components/interests/ContextBridge'
import { ContextSurfaceBridge } from '@/components/interests/ContextSurfaceBridge'
import { InterestMenuSync } from '@/components/interests/InterestMenuSync'
import { InterestsWidget } from '@/components/interests/InterestsWidget'
import { RepairBridge } from '@/components/agent-panel/RepairBridge'
import { ContextMenu, pasteTargetOf } from '@/components/shared/ContextMenu'
import { BrowserGlowBorder } from '@/components/shared/BrowserGlowBorder'
import { AgentCursor } from '@/components/shared/AgentCursor'
import { Sidebar } from '@/components/navigation/Sidebar'
import { AgentUiProvider, useAgentUi } from '@/context/AgentUiContext'
import { shouldShowMusicDeck, useLiveMusicStore } from '@/stores/liveMusicStore'
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
  const split = useTabStore((state) => state.split)
  const activeTabUrl = useTabStore((state) => state.tabs.find((t) => t.id === state.activeTabId)?.url)
  const panelWidth = usePanelAgentStore((state) => state.panelWidth)
  const teachingInset = usePanelAgentStore((state) => state.teachingInset)
  const showMusic = useLiveMusicStore(shouldShowMusicDeck)
  const musicOpen = useLiveMusicStore((state) => state.open)
  const musicInset = showMusic && musicOpen ? Math.min(panelWidth, 420) : 0
  const sideInset = Math.max(isPanelOpen ? panelWidth : 0, teachingInset, musicInset)
  const [isExternalMode, setIsExternalMode] = useState(false)
  const chromeRef = useRef<HTMLDivElement>(null)
  const hasNativeContextSurface =
    typeof window !== 'undefined' && Boolean(window.electron?.browser?.setContextSurface)
  const isSplitMode = split.mode !== 'single'
  const activeTabIsExternal = Boolean(
    activeTabUrl && !activeTabUrl.startsWith('ron://') && activeTabUrl !== 'about:blank',
  )

  // Detach native WebContentsViews while `#signin` / `#onboarding` / `#showcase` unmounts BrowserLayout.
  useEffect(() => {
    void window.electron?.browser?.setShellMounted?.(true)
    return () => {
      document.documentElement.removeAttribute('data-split-shell')
      void window.electron?.browser?.setShellMounted?.(false)
    }
  }, [])

  // Keep the split shell stage genuinely clear across Light, Dark, System, and Glass themes.
  useEffect(() => {
    if (isSplitMode) {
      document.documentElement.setAttribute('data-split-shell', 'true')
    } else {
      document.documentElement.removeAttribute('data-split-shell')
    }
  }, [isSplitMode])

  // Unified right-rail inset across AgentPanel, TeachSkill, and MusicSidePanel.
  useEffect(() => {
    const browser = window.electron?.browser
    if (!browser) return
    if (browser.setSideInset) {
      void browser.setSideInset(sideInset)
    } else {
      void browser.setPanelOpen?.(sideInset > 0)
    }
  }, [sideInset])

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    isOpen: boolean
    selectedText?: string
    pasteTarget?: HTMLElement | null
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

  // Global shortcuts: ⌘J Ask Ron, ⌘K Search, ⌘\ sidebar, ⌘L address bar.
  const runShortcut = useRef<(shortcut: ChromeShortcut, selectionText?: string, sourceUrl?: string) => void>(() => {})
  runShortcut.current = (shortcut, selectionText, sourceUrl) => {
    const nav = useNavigationStore.getState()
    if (shortcut === 'search') { nav.requestSearchFocus(); return }
    if (shortcut === 'toggle-sidebar') { nav.toggleSidebar(); return }
    if (shortcut === 'focus-url') { nav.requestUrlFocus(); return }
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
    window.setTimeout(() => {
      const composer = document.querySelector<HTMLTextAreaElement>('section textarea[aria-label="Message Ren"], section textarea[aria-label="Steer the active run"]')
      composer?.focus()
    }, 320)
  }

  useEffect(() => {
    const off = window.electron?.browser?.onChromeShortcut?.(({ shortcut, selectionText, sourceUrl }) => {
      runShortcut.current(shortcut, selectionText, sourceUrl)
    })
    if (off) return off
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutFor(event)
      if (!shortcut) return
      event.preventDefault()
      runShortcut.current(shortcut)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Keep native WebContentsViews below the real chrome + open toolbar dropdowns.
  useEffect(() => {
    const header = chromeRef.current
    const setChromeHeight = window.electron?.browser?.setChromeHeight
    if (!header || !setChromeHeight) return
    const report = () => {
      const chromeBottom = header.getBoundingClientRect().height
      let bottom = chromeBottom
      const overlays = document.querySelectorAll<HTMLElement>(
        '[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-chrome-overlay="true"]',
      )
      for (const el of overlays) {
        if (el.closest('[data-agent-panel], .teaching-studio, [data-panel-overlay]')) continue
        const rect = el.getBoundingClientRect()
        if (rect.top > chromeBottom + 24) continue
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

  // Handle right-click and double-click on renderer content
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
        pasteTarget: pasteTargetOf(e),
      })
    }

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
      <BrowserGlowBorder />
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={chromeRef} className="ron-toolbar relative z-[100] flex-shrink-0 border-b border-surface-200 dark:border-surface-800">
          <ChromeToolbar />
          {!isSidebarOpen && <TabBar />}
        </div>

        {/* Clear shell (`bg-transparent`) whenever split view or an external website is displayed */}
        <div
          data-side-inset={sideInset}
          className={cn(
            'ron-content relative min-h-0 flex-1 overflow-clip',
            isSplitMode || isExternalMode ? 'bg-transparent' : 'bg-surface-0 dark:bg-surface-900',
          )}
        >
          {isSplitMode ? (
            <SplitWorkspace sideInset={sideInset} />
          ) : (
            !isExternalMode && (
              <motion.div
                className="h-full overflow-auto scrollbar-thin"
                animate={{
                  marginRight: sideInset,
                }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              >
                {children}
              </motion.div>
            )
          )}

          <AgentPanel />
          <AgentCursor suppressOverlay={activeTabIsExternal} />
          <div id="ron-teaching-slot" className="pointer-events-none absolute inset-0 z-[60]" />
          <MusicSidePanel />
          <ScreenVisionOverlay />

          <InterestMenuSync />
          <ContextBridge />
          {hasNativeContextSurface ? <ContextSurfaceBridge /> : <InterestsWidget />}
          <RepairBridge />
        </div>
      </div>

      <ContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        isOpen={contextMenu.isOpen}
        selectedText={contextMenu.selectedText}
        pasteTarget={contextMenu.pasteTarget}
        onClose={() => setContextMenu(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  )
}
