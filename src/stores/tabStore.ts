import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface Tab {
  id: string
  url: string
  title: string
  favicon?: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  createdAt: number
  lastAccessed: number
}

interface TabState {
  tabs: Tab[]
  activeTabId: string | null

  // Actions
  createTab: (url?: string, makeActive?: boolean) => string
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  updateTab: (tabId: string, updates: Partial<Tab>) => void
  setTabs: (tabs: Tab[], activeTabId?: string | null) => void
  reorderTabs: (fromIndex: number, toIndex: number) => void
  closeAllTabs: () => void
  getActiveTab: () => Tab | null
}

const DEFAULT_TAB_URL = 'ron://home'

// Map ron:// URLs to tab titles
const RON_URL_TITLES: Record<string, string> = {
  'ron://home': 'Home',
  'ron://board': 'Task Board',
  'ron://search': 'Search',
}

export const useTabStore = create<TabState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,

      createTab: (url = DEFAULT_TAB_URL, makeActive = true) => {
        const newTab: Tab = {
          id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          url,
          title: RON_URL_TITLES[url] || 'New Tab',
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          createdAt: Date.now(),
          lastAccessed: Date.now()
        }

        set(state => ({
          tabs: [...state.tabs, newTab],
          activeTabId: makeActive ? newTab.id : state.activeTabId
        }))

        return newTab.id
      },

      closeTab: (tabId: string) => {
        set(state => {
          const tabs = state.tabs.filter(tab => tab.id !== tabId)
          let activeTabId = state.activeTabId

          // If we're closing the active tab, switch to another one
          if (activeTabId === tabId) {
            const closedTabIndex = state.tabs.findIndex(tab => tab.id === tabId)

            // Try to activate the tab to the right, then left, then null
            if (tabs.length > 0) {
              if (closedTabIndex < tabs.length) {
                activeTabId = tabs[closedTabIndex].id
              } else {
                activeTabId = tabs[tabs.length - 1].id
              }
            } else {
              activeTabId = null
            }
          }

          return { tabs, activeTabId }
        })
      },

      setActiveTab: (tabId: string) => {
        set(state => {
          const tab = state.tabs.find(t => t.id === tabId)
          if (tab) {
            const updatedTabs = state.tabs.map(t =>
              t.id === tabId
                ? { ...t, lastAccessed: Date.now() }
                : t
            )
            return { activeTabId: tabId, tabs: updatedTabs }
          }
          return state
        })
      },

      updateTab: (tabId: string, updates: Partial<Tab>) => {
        set(state => ({
          tabs: state.tabs.map(tab =>
            tab.id === tabId
              ? { ...tab, ...updates, lastAccessed: Date.now() }
              : tab
          )
        }))
      },

      setTabs: (tabs: Tab[], activeTabId?: string | null) => {
        set(() => ({
          tabs,
          activeTabId: activeTabId !== undefined ? activeTabId : (tabs.length ? tabs.find(t => t.id === activeTabId)?.id || tabs[0].id : null)
        }))
      },

      reorderTabs: (fromIndex: number, toIndex: number) => {
        set(state => {
          const tabs = [...state.tabs]
          const [movedTab] = tabs.splice(fromIndex, 1)
          tabs.splice(toIndex, 0, movedTab)
          return { tabs }
        })
      },

      closeAllTabs: () => {
        set({ tabs: [], activeTabId: null })
      },

      getActiveTab: () => {
        const state = get()
        return state.tabs.find(tab => tab.id === state.activeTabId) || null
      }
    }),
    {
      name: 'tab-storage',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        tabs: state.tabs.map(tab => ({
          ...tab,
          isLoading: false // Don't persist loading state
        })),
        activeTabId: state.activeTabId
      }),
      migrate: (persisted) => persisted as Partial<TabState>,
    }
  )
)
