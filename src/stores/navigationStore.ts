import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/** The sidebar's destinations. `documents` is the Documents library (`ron://documents`), routed by its URL. */
export type HomeTab = 'discover' | 'execute' | 'documents' | 'calendar' | 'vibe' | 'build'

interface NavigationStore {
  /**
   * Persistent left sidebar (replaces the old top navigation drawer). It stays
   * open across every page, including websites, until the user closes it.
   */
  isSidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void

  /** Bumped by ⌘K (or the toolbar search button): the sidebar opens and focuses its search field. */
  searchFocusRequest: number
  requestSearchFocus: () => void

  /** Bumped by ⌘L: the address bar takes focus and selects its text. */
  urlFocusRequest: number
  requestUrlFocus: () => void

  /** @deprecated Drawer API kept for existing callers; maps to the sidebar. */
  isDrawerExpanded: boolean
  /** @deprecated Use setSidebarOpen. */
  setDrawerExpanded: (expanded: boolean) => void
  /** @deprecated Use toggleSidebar. */
  toggleDrawer: () => void

  // Tab navigation
  activeTab: HomeTab
  setActiveTab: (tab: HomeTab) => void
}

export const useNavigationStore = create<NavigationStore>()(
  persist(
    (set) => ({
      isSidebarOpen: true,
      setSidebarOpen: (open) => set({ isSidebarOpen: open, isDrawerExpanded: open }),
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen, isDrawerExpanded: !state.isSidebarOpen })),

      searchFocusRequest: 0,
      requestSearchFocus: () => set((state) => ({
        isSidebarOpen: true,
        isDrawerExpanded: true,
        searchFocusRequest: state.searchFocusRequest + 1,
      })),

      urlFocusRequest: 0,
      requestUrlFocus: () => set((state) => ({ urlFocusRequest: state.urlFocusRequest + 1 })),

      isDrawerExpanded: true,
      setDrawerExpanded: (expanded) => set({ isSidebarOpen: expanded, isDrawerExpanded: expanded }),
      toggleDrawer: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen, isDrawerExpanded: !state.isSidebarOpen })),

      // Default tab
      activeTab: 'discover',
      setActiveTab: (tab) => set({ activeTab: tab }),
    }),
    {
      name: 'ron-navigation',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      partialize: (state) => ({
        isSidebarOpen: state.isSidebarOpen,
        isDrawerExpanded: state.isSidebarOpen,
        activeTab: state.activeTab,
      }),
      migrate: (persisted: any, version) => {
        const next = { ...(persisted ?? {}) }
        if (next.activeTab === 'tasks') next.activeTab = 'execute'
        // v1 → v2: the drawer's expanded state becomes the sidebar's open state.
        if (version < 2) next.isSidebarOpen = next.isDrawerExpanded ?? true
        return next
      },
    }
  )
)
