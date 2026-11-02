import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { applyThemeClasses, nextTheme } from '@/lib/theme'

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
        // Apply theme to document (light / dark / glass / system — see lib/theme.ts)
        if (typeof window !== 'undefined') {
          applyThemeClasses(theme)
          // Notify Electron main process (window background + macOS vibrancy)
          window.electron?.setTheme(theme)
        }
      },

      toggleTheme: () => {
        // Cycle: light -> dark -> glass -> system -> light
        get().setTheme(nextTheme(get().theme))
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
        if (storedTheme === 'system') {
          state.setTheme('system')
          return
        }
        // No stored theme: dark is Ron's default
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
  } else if (storedTheme === 'system') {
    store.setTheme('system')
  } else {
    store.setTheme('dark')
  }

  // System and Glass both follow the OS appearance for their ink.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { theme } = useUserPreferencesStore.getState()
    if (theme === 'system' || theme === 'glass') applyThemeClasses(theme)
  })
}
