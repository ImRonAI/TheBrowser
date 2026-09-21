import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Home, RotateCcw, MessageSquare, Plus } from 'lucide-react'
import { UrlBar } from './UrlBar'
import { UserMenu } from './UserMenu'
import { ThemeToggle } from './ThemeToggle'
import { useAgentUi } from '@/context/AgentUiContext'
import { useTabStore } from '@/stores/tabStore'
import { cn } from '@/utils/cn'
import { useState, useEffect } from 'react'

// Navigation button component
function NavButton({ 
  onClick, 
  label, 
  children,
  disabled = false 
}: { 
  onClick: () => void
  label: string
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className={cn(
        "p-2.5 rounded-lg transition-all duration-200",
        "hover:bg-surface-100 dark:hover:bg-surface-800",
        "active:bg-surface-200 dark:active:bg-surface-700",
        "disabled:opacity-30 disabled:cursor-not-allowed",
        "group"
      )}
      aria-label={label}
    >
      <div className={cn(
        "text-ink-muted dark:text-ink-inverse-muted group-hover:text-ink dark:group-hover:text-ink-inverse transition-colors",
        disabled && "opacity-30"
      )}>
        {children}
      </div>
    </motion.button>
  )
}

export function ChromeToolbar() {
  const { togglePanel, isPanelOpen } = useAgentUi()
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)

  // Listen for navigation state changes
  useEffect(() => {
    if (typeof window !== 'undefined' && window.electron?.browser) {
      // Get initial state
      const initializeNavigationState = async () => {
        try {
          const [back, forward] = await Promise.all([
            window.electron.browser.canGoBack(),
            window.electron.browser.canGoForward(),
          ])
          setCanGoBack(back)
          setCanGoForward(forward)
        } catch (error) {
          console.error('Failed to get navigation state:', error)
        }
      }

      initializeNavigationState()

      // Listen for URL changes
      const unsubscribe = window.electron.browser.onUrlChanged(() => {
        // Update navigation button states
        window.electron.browser.canGoBack().then(setCanGoBack).catch(console.error)
        window.electron.browser.canGoForward().then(setCanGoForward).catch(console.error)
      })

      return unsubscribe
    }
  }, [])

  const handleHome = async () => {
    if (typeof window !== 'undefined' && window.electron?.browser) {
      await window.electron.browser.navigate('ron://home')
    }
  }

  const handleBack = async () => {
    if (typeof window !== 'undefined' && window.electron?.browser) {
      await window.electron.browser.goBack()
    }
  }

  const handleForward = async () => {
    if (typeof window !== 'undefined' && window.electron?.browser) {
      await window.electron.browser.goForward()
    }
  }

  const handleReload = async () => {
    if (typeof window !== 'undefined' && window.electron?.browser) {
      await window.electron.browser.reload()
    }
  }

  const handleNewTab = async () => {
    const id = useTabStore.getState().createTab('ron://home', true)
    try {
      await window.electron?.tabs.create('ron://home', id)
      await window.electron?.tabs.switch(id)
    } catch (e) {
      console.error('Failed to create tab', e)
    }
  }

  return (
    <div className="flex items-center h-16 px-5 drag-region">
      {/* Traffic lights space (macOS) */}
      <div className="w-20 flex-shrink-0" />

      {/* Navigation Buttons */}
      <div className="flex items-center gap-0.5 no-drag">
        <NavButton onClick={handleHome} label="Home">
          <Home className="w-[18px] h-[18px]" />
        </NavButton>
        <NavButton onClick={handleBack} label="Go back" disabled={!canGoBack}>
          <ArrowLeft className="w-[18px] h-[18px]" />
        </NavButton>
        <NavButton onClick={handleForward} label="Go forward" disabled={!canGoForward}>
          <ArrowRight className="w-[18px] h-[18px]" />
        </NavButton>
        <NavButton onClick={handleReload} label="Reload page">
          <RotateCcw className="w-[18px] h-[18px]" />
        </NavButton>
      </div>

      {/* URL Bar */}
      <div className="flex-1 mx-6 no-drag">
        <UrlBar />
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-3 no-drag">
        {/* Theme Toggle */}
        <ThemeToggle />

        {/* New Tab (requirement: plus icon top-right) */}
        <motion.button
          onClick={handleNewTab}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={cn(
            'p-2.5 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors'
          )}
          aria-label="New Tab"
        >
          <Plus className="w-5 h-5 text-ink-muted dark:text-ink-inverse-muted" />
        </motion.button>

        {/* Divider */}
        <div className="w-px h-6 bg-surface-200 dark:bg-surface-700" />

        {/* Agent Panel Trigger */}
        <motion.button
          onClick={togglePanel}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={cn(
            "relative p-2.5 rounded-xl transition-all duration-300",
            isPanelOpen
              ? "bg-accent dark:bg-accent-light shadow-glow-accent"
              : "hover:bg-surface-100 dark:hover:bg-surface-800"
          )}
          aria-label="Open Agent Panel"
        >
          <MessageSquare 
            className={cn(
              "w-5 h-5 transition-colors",
              isPanelOpen
                ? "text-white"
                : "text-accent dark:text-accent-light"
            )} 
          />
          {/* Glow effect when active */}
          {isPanelOpen && (
            <motion.div
              className="absolute inset-0 rounded-xl bg-accent/20 dark:bg-accent-light/20"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1.3 }}
              transition={{ duration: 0.3 }}
              style={{ filter: 'blur(12px)', zIndex: -1 } as any}
            />
          )}
        </motion.button>

        {/* User Menu */}
        <UserMenu />
      </div>
    </div>
  )
}
