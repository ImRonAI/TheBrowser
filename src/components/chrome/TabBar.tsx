import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X } from 'lucide-react'
import { useTabStore } from '@/stores/tabStore'
import { cn } from '@/utils/cn'
import { useEffect } from 'react'

export function TabBar() {
  const { tabs, activeTabId, createTab, closeTab, setActiveTab, setTabs } = useTabStore()

  // Initial load + live updates from main
  useEffect(() => {
    const init = async () => {
      try {
        const list = await window.electron?.tabs.list?.()
        if (Array.isArray(list)) {
          setTabs(
            list.map(t => ({
              id: t.id,
              url: t.url,
              title: t.title,
              favicon: t.favicon,
              isLoading: false,
              canGoBack: false,
              canGoForward: false,
              createdAt: Date.now(),
              lastAccessed: Date.now(),
            })),
            list.find(t => t.isActive)?.id || list[0]?.id
          )
        }
      } catch (e) {
        console.error('Failed to load tabs from main', e)
      }
    }
    init()

    const off = window.electron?.tabs.onUpdated?.((list) => {
      // Overwrite store with canonical list from main
      setTabs(
        list.map(t => ({
          id: t.id,
          url: t.url,
          title: t.title,
          favicon: t.favicon,
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          createdAt: Date.now(),
          lastAccessed: Date.now(),
        })),
        list.find(t => t.isActive)?.id
      )
    })
    return () => { if (off) off() }
  }, [setTabs])

  const handleCreateTab = async () => {
    const id = createTab('ron://home', true)
    try {
      await window.electron?.tabs.create('ron://home', id)
      await window.electron?.tabs.switch(id)
    } catch (e) {
      console.error('Failed to create tab', e)
    }
  }

  const handleSwitch = async (id: string) => {
    setActiveTab(id)
    try { await window.electron?.tabs.switch(id) } catch (e) { console.error('Failed to switch tab', e) }
  }

  const handleClose = async (id: string) => {
    closeTab(id)
    try { await window.electron?.tabs.close(id) } catch (e) { console.error('Failed to close tab', e) }
  }

  return (
    <div className="flex items-center h-11 px-5 border-t border-surface-200/50 dark:border-surface-700/50">
      {/* New Tab Button */}
      <motion.button
        onClick={handleCreateTab}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        className={cn(
          "flex items-center justify-center w-8 h-8 mr-3",
          "rounded-lg transition-colors duration-200",
          "hover:bg-surface-100 dark:hover:bg-surface-800",
          "active:bg-surface-200 dark:active:bg-surface-700"
        )}
        aria-label="New Tab"
      >
        <Plus className="w-4 h-4 text-ink-muted dark:text-ink-inverse-muted" />
      </motion.button>

      {/* Tabs */}
      <div className="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
        <AnimatePresence mode="popLayout">
          {tabs.map((tab) => {
            const isActive = activeTabId === tab.id
            const isRonTab = tab.url?.startsWith('ron://')
            
            return (
              <motion.div
                key={tab.id}
                layout
                initial={{ opacity: 0, scale: 0.9, x: -16 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9, x: -16 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => handleSwitch(tab.id)}
                className={cn(
                  "group relative flex items-center gap-2.5 px-4 py-2 cursor-pointer",
                  "min-w-[140px] max-w-[240px]",
                  "rounded-lg transition-all duration-200",
                  isActive
                    ? "bg-surface-0 dark:bg-surface-800 shadow-soft dark:shadow-dark-soft border border-surface-200 dark:border-surface-700"
                    : "hover:bg-surface-100 dark:hover:bg-surface-800/50 bg-transparent"
                )}
              >
                {/* Active indicator */}
                {isActive && (
                  <motion.div
                    layoutId="activeTabIndicator"
                    className="absolute bottom-0 left-3 right-3 h-0.5 bg-accent dark:bg-accent-light rounded-full"
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  />
                )}

                {/* Tab favicon */}
                {tab.favicon ? (
                  <img src={tab.favicon} alt="" className="w-4 h-4 flex-shrink-0 rounded-sm" />
                ) : isRonTab ? (
                  <img src="/favicon.png" alt="Ron" className={cn(
                    "w-4 h-4 flex-shrink-0",
                    isActive 
                      ? "opacity-100" 
                      : "opacity-70 grayscale"
                  )} />
                ) : (
                  <div className={cn(
                    "w-4 h-4 rounded-full flex-shrink-0",
                    isActive
                      ? "bg-accent dark:bg-accent-light"
                      : "bg-surface-200 dark:bg-surface-700"
                  )} />
                )}

                {/* Tab title */}
                <span className={cn(
                  "flex-1 text-body-xs truncate transition-colors",
                  isActive
                    ? "text-ink dark:text-ink-inverse font-medium"
                    : "text-ink-secondary dark:text-ink-inverse-secondary"
                )}>
                  {tab.title}
                </span>

                {/* Close button */}
                <motion.button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleClose(tab.id)
                  }}
                  whileHover={{ scale: 1.2 }}
                  whileTap={{ scale: 0.9 }}
                  className={cn(
                    "p-1 rounded-md transition-all duration-200",
                    "opacity-0 group-hover:opacity-100",
                    "hover:bg-surface-200 dark:hover:bg-surface-700"
                  )}
                  aria-label="Close Tab"
                >
                  <X className="w-3 h-3 text-ink-muted dark:text-ink-inverse-muted" />
                </motion.button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
