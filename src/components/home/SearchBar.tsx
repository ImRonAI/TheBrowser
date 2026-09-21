import { useState } from 'react'
import { motion } from 'framer-motion'
import { useSearchStore } from '@/stores/searchStore'

const EASE = [0.16, 1, 0.3, 1] as const

export function SearchBar() {
  const [query, setQuery] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const { search } = useSearchStore()

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return

    console.log('Searching:', trimmed)

    // Trigger the search results page
    search(trimmed)

    if (typeof window !== 'undefined' && window.electron?.browser?.search) {
      try {
        await window.electron.browser.search(trimmed)
      } catch (error) {
        console.error('Search error:', error)
      }
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE }}
      className="w-full max-w-3xl mx-auto"
    >
      <form onSubmit={handleSearch}>
        <motion.div
          className={`
            relative overflow-hidden
            rounded-2xl
            transition-all duration-400 ease-smooth
            ${isFocused 
              ? 'bg-surface-0 dark:bg-surface-850 shadow-bold dark:shadow-dark-bold ring-2 ring-accent/20 dark:ring-accent-light/20' 
              : 'bg-surface-50 dark:bg-surface-800 shadow-soft dark:shadow-dark-soft'
            }
            border border-surface-200 dark:border-surface-700
            ${isFocused ? 'border-accent/30 dark:border-accent-light/30' : ''}
          `}
        >
          {/* Glow effect on focus */}
          {isFocused && (
            <motion.div
              className="absolute inset-0 -z-10"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              style={{
                background: 'radial-gradient(circle at center, rgba(99, 102, 241, 0.08), transparent 70%)',
                filter: 'blur(24px)',
              }}
            />
          )}

          {/* Search icon */}
          <div className="absolute left-6 top-1/2 -translate-y-1/2">
            <motion.svg 
              className="w-5 h-5 text-ink-muted dark:text-ink-inverse-muted"
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
              animate={{
                scale: isFocused ? 1.1 : 1,
                color: isFocused ? 'rgb(99, 102, 241)' : undefined,
              }}
              transition={{ duration: 0.2 }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </motion.svg>
          </div>

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            id="main-search-bar"
            data-testid="ask-anything-input"
            placeholder="Ask anything..."
            className="
              w-full pl-16 pr-8 py-5
              bg-transparent
              outline-none
              text-body-lg
              text-ink dark:text-ink-inverse
              font-sans font-light
              placeholder:text-ink-muted dark:placeholder:text-ink-inverse-muted
              placeholder:font-sans placeholder:font-light
              transition-all duration-300
            "
            autoComplete="off"
          />

          {/* Subtle underline indicator */}
          <motion.div
            className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-accent dark:via-accent-light to-transparent"
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{
              scaleX: isFocused ? 1 : 0,
              opacity: isFocused ? 1 : 0,
            }}
            transition={{ duration: 0.4, ease: EASE }}
          />
        </motion.div>

      </form>
    </motion.div>
  )
}
