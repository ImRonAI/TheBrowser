import { motion } from 'framer-motion'
import { Sun, Moon } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'

export function ThemeToggle() {
  const { theme, setTheme, isDark } = useTheme()

  // Simple toggle between light and dark (no glass mode per requirements)
  const toggleTheme = () => {
    if (theme === 'dark') {
      setTheme('light')
    } else {
      setTheme('dark')
    }
  }

  return (
    <motion.button
      onClick={toggleTheme}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="
        relative
        w-14 h-8
        rounded-full
        p-1
        bg-surface-100 dark:bg-surface-800
        border border-surface-200 dark:border-surface-700
        transition-all duration-300
        hover:shadow-soft dark:hover:shadow-dark-soft
      "
      title={`Theme: ${theme} (click to toggle)`}
    >
      {/* Sliding indicator */}
      <motion.div
        className="
          absolute top-1 bottom-1
          w-6 h-6
          rounded-full
          bg-accent dark:bg-accent-light
          shadow-md
        "
        animate={{
          left: isDark ? 'calc(100% - 28px)' : 4,
        }}
        transition={{
          duration: 0.3,
          ease: [0.16, 1, 0.3, 1],
        }}
      />

      {/* Icons */}
      <div className="relative flex items-center justify-between h-full px-1">
        <motion.div
          animate={{
            opacity: !isDark ? 1 : 0.4,
            scale: !isDark ? 1 : 0.85,
          }}
          transition={{ duration: 0.2 }}
          className="z-10"
        >
          <Sun className={`w-4 h-4 ${!isDark ? 'text-white' : 'text-ink-muted dark:text-ink-inverse-muted'}`} />
        </motion.div>
        <motion.div
          animate={{
            opacity: isDark ? 1 : 0.4,
            scale: isDark ? 1 : 0.85,
          }}
          transition={{ duration: 0.2 }}
          className="z-10"
        >
          <Moon className={`w-4 h-4 ${isDark ? 'text-white' : 'text-ink-muted dark:text-ink-inverse-muted'}`} />
        </motion.div>
      </div>
    </motion.button>
  )
}
