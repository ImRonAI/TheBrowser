import { useEffect } from 'react'
import { useUserPreferencesStore } from '@/stores/userPreferencesStore'

/**
 * Hook for managing theme (light/dark mode only)
 * Integrates with userPreferencesStore and handles DOM class management
 */
export function useTheme() {
  const { theme, setTheme } = useUserPreferencesStore()

  useEffect(() => {
    const root = document.documentElement

    const applyTheme = (themeValue: typeof theme) => {
      // Remove all theme classes first
      root.classList.remove('dark', 'glass')

      if (themeValue === 'dark') {
        root.classList.add('dark')
        localStorage.setItem('theme', 'dark')
      } else if (themeValue === 'light') {
        localStorage.setItem('theme', 'light')
      } else {
        // System preference
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        if (isDark) {
          root.classList.add('dark')
        }
        localStorage.setItem('theme', 'system')
      }
    }

    applyTheme(theme)

    // Listen for system theme changes when in system mode
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      if (theme === 'system') {
        root.classList.remove('dark', 'glass')
        if (e.matches) {
          root.classList.add('dark')
        }
      }
    }

    mediaQuery.addEventListener('change', handleSystemThemeChange)

    return () => {
      mediaQuery.removeEventListener('change', handleSystemThemeChange)
    }
  }, [theme])

  // Toggle between light and dark only
  const toggleTheme = () => {
    const currentTheme = theme
    if (currentTheme === 'dark') {
      setTheme('light')
    } else {
      setTheme('dark')
    }
  }

  return {
    theme,
    setTheme,
    toggleTheme,
    isDark: theme === 'dark' ||
           (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches),
    isGlass: false // Disabled per requirements
  }
}
