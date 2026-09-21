import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type HomeTab = 'discover' | 'execute' | 'calendar' | 'vibe' | 'build'

interface NavigationStore {
  // Drawer state
  isDrawerExpanded: boolean
  setDrawerExpanded: (expanded: boolean) => void
  toggleDrawer: () => void

  // Tab navigation
  activeTab: HomeTab
  setActiveTab: (tab: HomeTab) => void
}

export const useNavigationStore = create<NavigationStore>()(
  persist(
    (set) => ({
      // Drawer defaults to expanded
      isDrawerExpanded: true,
      setDrawerExpanded: (expanded) => set({ isDrawerExpanded: expanded }),
      toggleDrawer: () => set((state) => ({ isDrawerExpanded: !state.isDrawerExpanded })),

      // Default tab
      activeTab: 'discover',
      setActiveTab: (tab) => set({ activeTab: tab }),
    }),
    {
      name: 'ron-navigation',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        isDrawerExpanded: state.isDrawerExpanded,
        activeTab: state.activeTab,
      }),
      migrate: (persisted: any) => {
        if (persisted?.activeTab === 'tasks') {
          return { ...persisted, activeTab: 'execute' }
        }
        return persisted
      },
    }
  )
)
