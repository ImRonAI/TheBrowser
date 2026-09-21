import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

type Theme = 'light' | 'dark' | 'glass' | 'system'
type InteractionMode = 'talk' | 'type'
type ContentDensity = 'compact' | 'comfortable' | 'spacious'
type SearchMode = 'ai-web' | 'deep-research' | 'chat'

interface UserPreferences {
  // Appearance
  theme: Theme
  contentDensity: ContentDensity
  showAnimations: boolean
  reduceMotion: boolean

  // Interaction
  defaultInteractionMode: InteractionMode
  defaultSearchMode: SearchMode
  autoPlayVideos: boolean
  openLinksInNewTab: boolean

  // Privacy
  doNotTrack: boolean
  blockTrackers: boolean
  clearBrowsingDataOnExit: boolean

  // Content
  showBiasIndicators: boolean
  showHypeScores: boolean
  preferSummaries: boolean
  articleViewMode: 'synthesis' | 'source' | 'counterpoint'

  // Notifications
  enableNotifications: boolean
  notifyOnBreakingNews: boolean
  notifyOnAgentMessages: boolean

  // Advanced
  developerMode: boolean
  experimentalFeatures: boolean
}

interface UserPreferencesState extends UserPreferences {
  // Actions
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setContentDensity: (density: ContentDensity) => void
  setInteractionMode: (mode: InteractionMode) => void
  setSearchMode: (mode: SearchMode) => void
  updatePreferences: (updates: Partial<UserPreferences>) => void
  resetToDefaults: () => void
}

const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'dark',
  contentDensity: 'comfortable',
  showAnimations: true,
  reduceMotion: false,
  defaultInteractionMode: 'type',
  defaultSearchMode: 'ai-web',
  autoPlayVideos: false,
  openLinksInNewTab: true,
  doNotTrack: true,
  blockTrackers: true,
  clearBrowsingDataOnExit: false,
  showBiasIndicators: true,
  showHypeScores: true,
  preferSummaries: true,
  articleViewMode: 'synthesis',
  enableNotifications: true,
  notifyOnBreakingNews: false,
  notifyOnAgentMessages: true,
  developerMode: false,
  experimentalFeatures: false
}

export const useUserPreferencesStore = create<UserPreferencesState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_PREFERENCES,

      setTheme: (theme: Theme) => {
        set({ theme })
        // Apply theme to document
        if (typeof window !== 'undefined') {
          const root = document.documentElement
          // Remove theme classes first
          root.classList.remove('dark', 'glass')

          if (theme === 'dark') {
            root.classList.add('dark')
            localStorage.setItem('theme', 'dark')
          } else if (theme === 'light') {
            localStorage.setItem('theme', 'light')
          } else if (theme === 'glass') {
            root.classList.add('dark', 'glass')
            localStorage.setItem('theme', 'glass')
          } else {
            // System preference fallback: default to dark to preserve Ron's DS
            root.classList.add('dark')
            localStorage.setItem('theme', 'dark')
          }

          // Notify Electron main process
          window.electron?.setTheme(theme)
        }
      },

      toggleTheme: () => {
        const currentTheme = get().theme
        // Cycle: system -> dark -> light -> system
        const themeOrder: Theme[] = ['system', 'dark', 'light']
        const currentIndex = themeOrder.indexOf(currentTheme)
        const nextIndex = (currentIndex + 1) % themeOrder.length
        get().setTheme(themeOrder[nextIndex])
      },

      setContentDensity: (density: ContentDensity) => {
        set({ contentDensity: density })
      },

      setInteractionMode: (mode: InteractionMode) => {
        set({ defaultInteractionMode: mode })
      },

      setSearchMode: (mode: SearchMode) => {
        set({ defaultSearchMode: mode })
      },

      updatePreferences: (updates: Partial<UserPreferences>) => {
        set(state => ({ ...state, ...updates }))
        // Handle theme changes
        if (updates.theme) {
          get().setTheme(updates.theme)
        }
      },

      resetToDefaults: () => {
        set(DEFAULT_PREFERENCES)
        get().setTheme(DEFAULT_PREFERENCES.theme)
      }
    }),
    {
      name: 'user-preferences-storage',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        theme: state.theme,
        defaultInteractionMode: state.defaultInteractionMode,
        defaultSearchMode: state.defaultSearchMode,
        contentDensity: state.contentDensity,
        showAnimations: state.showAnimations,
        reduceMotion: state.reduceMotion,
      }),
      migrate: (persisted) => persisted as Partial<UserPreferencesState>,
      onRehydrateStorage: () => (state, error) => {
        if (error || !state || typeof window === 'undefined') return
        const storedTheme = localStorage.getItem('theme') as Theme | null
        if (storedTheme === 'dark') {
          state.setTheme('dark')
          return
        }
        if (storedTheme === 'light') {
          state.setTheme('light')
          return
        }
        if (storedTheme === 'glass') {
          state.setTheme('glass')
          return
        }
        // No stored theme or system: force dark
        state.setTheme('dark')
      }
    }
  )
)

// Initialize theme on app load
if (typeof window !== 'undefined') {
  const store = useUserPreferencesStore.getState()
  const storedTheme = localStorage.getItem('theme')
  if (storedTheme === 'dark') {
    store.setTheme('dark')
  } else if (storedTheme === 'light') {
    store.setTheme('light')
  } else if (storedTheme === 'glass') {
    store.setTheme('glass')
  } else {
    store.setTheme('dark')
  }

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const store = useUserPreferencesStore.getState()
    if (store.theme === 'system') {
      const root = document.documentElement
      if (e.matches) {
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
      }
    }
  })
}
