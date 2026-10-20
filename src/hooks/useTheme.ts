import { useEffect, useState } from 'react'
import { useUserPreferencesStore } from '@/stores/userPreferencesStore'
import { applyThemeClasses, prefersDark } from '@/lib/theme'

/**
 * Theme hook: light, dark, glass (translucent shell over the desktop) or system.
 * The DOM classes are owned by `applyThemeClasses`; this hook re-applies them when
 * the theme changes and tracks the OS appearance for `system` and `glass`.
 */
export function useTheme() {
  const { theme, setTheme } = useUserPreferencesStore()
  const [osDark, setOsDark] = useState(prefersDark)

  useEffect(() => {
    applyThemeClasses(theme)
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => {
      setOsDark(event.matches)
      if (theme === 'system' || theme === 'glass') applyThemeClasses(theme)
    }
    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [theme])

  // Toggle between light and dark (Glass/System are chosen from the theme menu)
  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return {
    theme,
    setTheme,
    toggleTheme,
    isDark: theme === 'dark' || ((theme === 'system' || theme === 'glass') && osDark),
    isGlass: theme === 'glass',
  }
}
