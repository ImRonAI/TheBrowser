import { ReactNode, useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { ChromeToolbar } from '@/components/chrome/ChromeToolbar'
import { TabBar } from '@/components/chrome/TabBar'
import { AgentPanel } from '@/components/agent-panel/AgentPanel'
import { ScreenVisionOverlay } from '@/components/agent-panel/ScreenVisionOverlay'
import { InterestMenuSync } from '@/components/interests/InterestMenuSync'
import { InterestsWidget } from '@/components/interests/InterestsWidget'
import { ContextMenu } from '@/components/shared/ContextMenu'
import { BrowserGlowBorder } from '@/components/shared/BrowserGlowBorder'
import { AgentCursor } from '@/components/shared/AgentCursor'
import { NavigationDrawer } from '@/components/navigation/NavigationDrawer'
import { AgentUiProvider, useAgentUi } from '@/context/AgentUiContext'
import { usePanelAgentStore } from '@/stores/panelAgentStore'
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
  const { isPanelOpen, startAskRon } = useAgentUi()
  const panelWidth = usePanelAgentStore((state) => state.panelWidth)
  const teachingInset = usePanelAgentStore((state) => state.teachingInset)
  const sideInset = Math.max(isPanelOpen ? panelWidth : 0, teachingInset)
  const [isExternalMode, setIsExternalMode] = useState(false)
  const chromeRef = useRef<HTMLDivElement>(null)
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

  // Keep the native WebContentsView below the real chrome: report the measured
  // header height on layout changes and on shell zoom (which fires `resize`).
  useEffect(() => {
    const header = chromeRef.current
    const setChromeHeight = window.electron?.browser?.setChromeHeight
    if (!header || !setChromeHeight) return
    const report = () => { void setChromeHeight(header.getBoundingClientRect().height) }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(header)
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
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
      "flex flex-col h-screen overflow-hidden",
      "bg-surface-50 dark:bg-surface-950", // Deeper background
      "selection:bg-accent/20 selection:text-accent dark:selection:bg-accent-light/20 dark:selection:text-accent-light"
    )}>
      {/* Browser Tool Glow Effect - persists across entire app */}
      <BrowserGlowBorder />
      {/* Browser Chrome - Elevated Header */}
      <div ref={chromeRef} className={cn(
        "flex-shrink-0 relative z-[100]",
        // Background
        "bg-surface-0/95 dark:bg-surface-900/95",
        "backdrop-blur-xl",
        // Border
        "border-b border-surface-200/50 dark:border-surface-700/50",
        // Shadow
        "shadow-sm dark:shadow-none"
      )}>
        {/* Subtle inner glow at top */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-surface-200 dark:via-surface-700 to-transparent" />
        
        <ChromeToolbar />
        <TabBar />
        
        {/* Bottom accent line */}
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/10 dark:via-accent-light/10 to-transparent" />
      </div>

      {/* Navigation Drawer - OUTSIDE the relative container */}
      <NavigationDrawer />

      {/* Main Content Area - Below NavigationDrawer */}
      <div className="flex-1 relative overflow-hidden">
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

        {/* Agent Panel - positioned within THIS container, below NavigationDrawer */}
        <AgentPanel />
        <AgentCursor />
        <div id="ron-teaching-slot" className="pointer-events-none absolute inset-0 z-[60]" />

        {/* Screen Vision Overlay */}
        <ScreenVisionOverlay />

        <InterestMenuSync />
        <InterestsWidget />
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
