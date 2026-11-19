import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  SINGLE_SPLIT_STATE,
  getSlotForTab,
  getSplitTabIds,
  isTabSplitDetached,
  removeTabFromSplit,
  selectTabInSplit,
  splitTabIntoZone,
  type SplitDropZone,
  type SplitPaneSlot,
  type SplitState,
} from '@/lib/tab-split'

export interface Tab {
  id: string
  url: string
  title: string
  favicon?: string | undefined
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  createdAt: number
  lastAccessed: number
  isDisplayed?: boolean | undefined
  isSplitDetached?: boolean | undefined
  splitPane?: SplitPaneSlot | null | undefined
}

interface TabState {
  tabs: Tab[]
  activeTabId: string | null
  split: SplitState

  // Actions
  createTab: (url?: string, makeActive?: boolean) => string
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  updateTab: (tabId: string, updates: Partial<Tab>) => void
  setTabs: (tabs: Tab[], activeTabId?: string | null) => void
  setSplit: (split: SplitState) => void
  splitTabLocal: (tabId: string, zone: SplitDropZone, source?: 'strip' | 'pane') => void
  unsplitTabLocal: (tabId?: string, all?: boolean) => void
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

function decorateTabsWithSplit(tabs: Tab[], split: SplitState, activeTabId: string | null): Tab[] {
  const splitIds = new Set(getSplitTabIds(split))
  return tabs.map((tab) => {
    const splitPane = getSlotForTab(split, tab.id)
    const isDisplayed = split.mode === 'single' ? tab.id === activeTabId : splitIds.has(tab.id)
    const isSplitDetached = isTabSplitDetached(split, tab.id)
    return {
      ...tab,
      isDisplayed,
      isSplitDetached,
      splitPane,
    }
  })
}

export const useTabStore = create<TabState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      split: SINGLE_SPLIT_STATE,

      createTab: (url = DEFAULT_TAB_URL, makeActive = true) => {
        const newTab: Tab = {
          id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          url,
          title: RON_URL_TITLES[url] || 'New Tab',
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          createdAt: Date.now(),
          lastAccessed: Date.now(),
        }

        set((state) => {
          const nextActive = makeActive ? newTab.id : state.activeTabId
          const nextSplit = makeActive ? selectTabInSplit(state.split, newTab.id) : state.split
          const nextTabs = decorateTabsWithSplit([...state.tabs, newTab], nextSplit, nextActive)
          return {
            tabs: nextTabs,
            activeTabId: nextActive,
            split: nextSplit,
          }
        })

        return newTab.id
      },

      closeTab: (tabId: string) => {
        set((state) => {
          const remaining = state.tabs.filter((tab) => tab.id !== tabId)
          const removed = removeTabFromSplit(state.split, tabId)
          let activeTabId = state.activeTabId

          if (activeTabId === tabId) {
            const closedTabIndex = state.tabs.findIndex((tab) => tab.id === tabId)
            if (removed.survivingActiveTabId && remaining.some((t) => t.id === removed.survivingActiveTabId)) {
              activeTabId = removed.survivingActiveTabId
            } else if (remaining.length > 0) {
              const fallbackTab =
                closedTabIndex >= 0 && closedTabIndex < remaining.length
                  ? remaining[closedTabIndex]
                  : remaining[remaining.length - 1]
              activeTabId = fallbackTab?.id ?? null
            } else {
              activeTabId = null
            }
          }

          const nextSplit =
            activeTabId && removed.state.mode !== 'single'
              ? selectTabInSplit(removed.state, activeTabId)
              : removed.state

          return {
            tabs: decorateTabsWithSplit(remaining, nextSplit, activeTabId),
            activeTabId,
            split: remaining.length < 2 ? SINGLE_SPLIT_STATE : nextSplit,
          }
        })
      },

      setActiveTab: (tabId: string) => {
        set((state) => {
          const tab = state.tabs.find((t) => t.id === tabId)
          if (!tab) return state
          const nextSplit = selectTabInSplit(state.split, tabId)
          const updatedTabs = state.tabs.map((t) =>
            t.id === tabId ? { ...t, lastAccessed: Date.now() } : t,
          )
          return {
            activeTabId: tabId,
            split: nextSplit,
            tabs: decorateTabsWithSplit(updatedTabs, nextSplit, tabId),
          }
        })
      },

      updateTab: (tabId: string, updates: Partial<Tab>) => {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, ...updates, lastAccessed: Date.now() } : tab,
          ),
        }))
      },

      setTabs: (tabs: Tab[], activeTabId?: string | null) => {
        set((state) => {
          const nextActive =
            activeTabId !== undefined
              ? activeTabId
              : tabs.length
                ? tabs.find((t) => t.id === state.activeTabId)?.id || tabs[0]?.id || null
                : null
          const hasAuthoritativeSplitFlags = tabs.some((t) => t.splitPane !== undefined)
          const finalTabs = hasAuthoritativeSplitFlags
            ? tabs
            : decorateTabsWithSplit(tabs, state.split, nextActive)
          return {
            tabs: finalTabs,
            activeTabId: nextActive,
          }
        })
      },

      setSplit: (split: SplitState) => {
        set((state) => ({
          split,
          tabs: decorateTabsWithSplit(state.tabs, split, state.activeTabId),
        }))
      },

      splitTabLocal: (tabId: string, zone: SplitDropZone, source = 'strip') => {
        set((state) => {
          const orderedIds = state.tabs.map((t) => t.id)
          const res = splitTabIntoZone(state.split, tabId, zone, orderedIds, state.activeTabId, source)
          const nextActive = res.activeTabId ?? state.activeTabId
          return {
            split: res.state,
            activeTabId: nextActive,
            tabs: decorateTabsWithSplit(state.tabs, res.state, nextActive),
          }
        })
      },

      unsplitTabLocal: (tabId?: string, all = false) => {
        set((state) => {
          if (all || !tabId) {
            return {
              split: SINGLE_SPLIT_STATE,
              tabs: decorateTabsWithSplit(state.tabs, SINGLE_SPLIT_STATE, state.activeTabId),
            }
          }
          const removed = removeTabFromSplit(state.split, tabId)
          const nextActive =
            state.activeTabId === tabId && removed.survivingActiveTabId
              ? removed.survivingActiveTabId
              : state.activeTabId
          return {
            split: removed.state,
            activeTabId: nextActive,
            tabs: decorateTabsWithSplit(state.tabs, removed.state, nextActive),
          }
        })
      },

      reorderTabs: (fromIndex: number, toIndex: number) => {
        set((state) => {
          const tabs = [...state.tabs]
          const [movedTab] = tabs.splice(fromIndex, 1)
          if (!movedTab) return state
          tabs.splice(toIndex, 0, movedTab)
          return { tabs }
        })
      },

      closeAllTabs: () => {
        set({ tabs: [], activeTabId: null, split: SINGLE_SPLIT_STATE })
      },

      getActiveTab: () => {
        const state = get()
        return state.tabs.find((tab) => tab.id === state.activeTabId) || null
      },
    }),
    {
      name: 'tab-storage',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        tabs: state.tabs.map((tab) => ({
          ...tab,
          isLoading: false,
          isDisplayed: undefined,
          isSplitDetached: undefined,
          splitPane: undefined,
        })),
        activeTabId: state.activeTabId,
      }),
      migrate: (persisted) => persisted as Partial<TabState>,
    },
  ),
)
