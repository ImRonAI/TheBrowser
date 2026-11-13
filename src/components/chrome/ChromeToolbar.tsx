import { ArrowLeft, ArrowRight, Home, RotateCcw, PanelLeft, Plus } from 'lucide-react'
import { UrlBar } from './UrlBar'
import { UserMenu } from './UserMenu'
import { ThemeToggle } from './ThemeToggle'
import { useAgentUi } from '@/context/AgentUiContext'
import { useTabStore } from '@/stores/tabStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { cn } from '@/utils/cn'
import { useState, useEffect, type ReactNode } from 'react'
import { TeachSkill } from '@/components/agent-panel/TeachSkill'
import { useAuthStore } from '@/stores/authStore'
import { MOD_KEY } from '@/lib/shortcuts'

// Quiet 32px icon button used across the chrome. Hover is a translucent ink wash, so it reads on
// the paper chrome, the ink chrome and the Glass shell alike.
export function ChromeIconButton({
  onClick,
  label,
  children,
  disabled = false,
  pressed,
  title,
  className,
}: {
  onClick: () => void
  label: string
  children: ReactNode
  disabled?: boolean
  pressed?: boolean
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      className={cn(
        'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors duration-150 ease-out',
        'text-ink-secondary hover:bg-ink/[0.06] hover:text-ink active:bg-ink/[0.1]',
        'dark:text-ink-inverse-secondary dark:hover:bg-ink-inverse/[0.07] dark:hover:text-ink-inverse dark:active:bg-ink-inverse/[0.11]',
        'disabled:pointer-events-none disabled:opacity-40',
        pressed && 'bg-ink/[0.07] text-ink dark:bg-ink-inverse/[0.09] dark:text-ink-inverse',
        className,
      )}
    >
      {children}
    </button>
  )
}

const ICON = 'h-4 w-4'
const STROKE = 1.75

export function ChromeToolbar() {
  const { togglePanel, isPanelOpen } = useAgentUi()
  const user = useAuthStore((state) => state.user?.id || 'default')
  const isSidebarOpen = useNavigationStore((state) => state.isSidebarOpen)
  const toggleSidebar = useNavigationStore((state) => state.toggleSidebar)
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
    <div className="flex h-11 items-center gap-1 pl-3 pr-2.5 drag-region">
      {/* Traffic lights space (macOS) — they live in the sidebar's top row while it is open */}
      {!isSidebarOpen && <div className="w-[68px] flex-shrink-0" />}

      <div className="flex items-center gap-0.5 no-drag">
        <ChromeIconButton
          onClick={toggleSidebar}
          label={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          title={`${isSidebarOpen ? 'Hide' : 'Show'} sidebar  ${MOD_KEY}\\`}
          pressed={isSidebarOpen}
        >
          <PanelLeft className={ICON} strokeWidth={STROKE} />
        </ChromeIconButton>
        <div className="mx-1.5 h-4 w-px bg-surface-300 dark:bg-surface-700" aria-hidden />
        <ChromeIconButton onClick={handleBack} label="Go back" disabled={!canGoBack}>
          <ArrowLeft className={ICON} strokeWidth={STROKE} />
        </ChromeIconButton>
        <ChromeIconButton onClick={handleForward} label="Go forward" disabled={!canGoForward}>
          <ArrowRight className={ICON} strokeWidth={STROKE} />
        </ChromeIconButton>
        <ChromeIconButton onClick={handleReload} label="Reload page">
          <RotateCcw className="h-[15px] w-[15px]" strokeWidth={STROKE} />
        </ChromeIconButton>
        <ChromeIconButton onClick={handleHome} label="Home">
          <Home className={ICON} strokeWidth={STROKE} />
        </ChromeIconButton>
      </div>

      {/* URL Bar — centred, comfortable measure */}
      <div className="mx-3 flex min-w-0 flex-1 justify-center no-drag">
        <div className="w-full max-w-[720px]">
          <UrlBar />
        </div>
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-1 no-drag">
        <ChromeIconButton onClick={handleNewTab} label="New tab">
          <Plus className={ICON} strokeWidth={STROKE} />
        </ChromeIconButton>
        <ThemeToggle />
        <TeachSkill key={user} userId={user} agentId="panel" chrome />

        {/* Agent Panel trigger — styled like the ren. logo: display font, ink ground/text, volt dot. */}
        <button
          type="button"
          onClick={togglePanel}
          aria-label="Open Agent Panel"
          aria-pressed={isPanelOpen}
          title={`ask ren.  ${MOD_KEY}J`}
          className={cn(
            'ml-1 flex h-8 items-center gap-1.5 rounded-lg pl-2.5 pr-1.5 font-display text-[13.5px] font-extrabold tracking-[-0.03em] transition-colors duration-150 ease-out',
            isPanelOpen
              ? 'bg-ink text-white hover:bg-surface-800 dark:bg-ink-inverse dark:text-ink dark:hover:bg-white'
              : 'border border-surface-200 bg-surface-0 text-ink hover:bg-surface-100 dark:border-surface-700 dark:bg-surface-850 dark:text-ink-inverse dark:hover:bg-surface-800',
          )}
        >
          <span>ask ren<span className="text-volt">.</span></span>
          <kbd className={cn(
            'ml-0.5 rounded-[5px] px-1 font-mono text-[10px] font-medium leading-4 tracking-normal',
            isPanelOpen
              ? 'bg-white/15 text-white dark:bg-ink/10 dark:text-ink'
              : 'bg-ink/5 text-ink-muted dark:bg-white/10 dark:text-ink-inverse-muted',
          )}>
            {MOD_KEY}J
          </kbd>
        </button>

        <div className="ml-1">
          <UserMenu />
        </div>
      </div>
    </div>
  )
}
