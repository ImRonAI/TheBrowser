import { useState, KeyboardEvent, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Lock } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useSearchStore } from '@/stores/searchStore'

const SEARCH_PROTOCOL_PREFIX = 'ron://search'

export function getSearchQueryFromRonUrl(value: string): string | null {
  if (!value.startsWith(SEARCH_PROTOCOL_PREFIX)) return null
  try {
    const parsed = new URL(value)
    const query = parsed.searchParams.get('q')
    return query ?? ''
  } catch {
    return null
  }
}

function looksLikeUrl(value: string): boolean {
  if (/^(https?:\/\/|ron:\/\/|file:\/\/|about:)/i.test(value)) return true
  if (/^localhost(:\d+)?(\/.*)?$/i.test(value)) return true
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(value)) return true
  return value.includes('.') && !/\s/.test(value)
}

export function UrlBar() {
  const [url, setUrl] = useState('ron://home')
  const [isFocused, setIsFocused] = useState(false)
  const { search, clearSearch } = useSearchStore()

  // Sync URL from browser when it changes
  useEffect(() => {
    if (typeof window !== 'undefined' && window.electron?.browser) {
      // Listen for URL changes from browser
      const cleanup = window.electron.browser.onUrlChanged((newUrl: string) => {
        setUrl(newUrl)
      })
      return cleanup
    }
  }, [])

  const commitInput = async (rawValue: string) => {
    const trimmed = rawValue.trim()
    if (!trimmed) return

    const ronQuery = getSearchQueryFromRonUrl(trimmed)
    const query = ronQuery ?? trimmed
    const shouldNavigate = ronQuery === null && looksLikeUrl(trimmed)

    if (typeof window !== 'undefined' && window.electron?.browser) {
      try {
        if (shouldNavigate) {
          clearSearch()
          await window.electron.browser.navigate(trimmed)
          console.log('Navigation initiated')
        } else {
          search(query)
          if (ronQuery !== null) {
            await window.electron.browser.navigate(trimmed)
          } else {
            await window.electron.browser.search(query)
          }
          console.log('Search initiated:', query)
        }
      } catch (error) {
        console.error('Url bar action error:', error)
      }
      return
    }

    if (!shouldNavigate) {
      search(query)
      setUrl(`ron://search?q=${encodeURIComponent(query)}`)
    }
  }

  const handleSubmit = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      await commitInput(url)
    }
  }

  const handleSearchClick = async () => {
    await commitInput(url)
  }

  const isSecure = url.startsWith('https://') || url.startsWith('ron://')
  const isRonProtocol = url.startsWith('ron://')

  return (
    <motion.div
      className={cn(
        "relative flex items-center h-11 rounded-xl overflow-hidden",
        "transition-all duration-300 ease-smooth",
        // Base styling
        "bg-surface-50 dark:bg-surface-800",
        "border border-surface-200 dark:border-surface-700",
        // Focus states
        isFocused && [
          "ring-2 ring-accent/20 dark:ring-accent-light/20",
          "border-accent/50 dark:border-accent-light/50",
          "bg-surface-0 dark:bg-surface-850",
          "shadow-soft dark:shadow-dark-soft"
        ]
      )}
      animate={{
        scale: isFocused ? 1.005 : 1,
      }}
      transition={{ duration: 0.2 }}
    >
      {/* Subtle gradient overlay on focus */}
      <AnimatePresence>
        {isFocused && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(90deg, rgba(99, 102, 241, 0.02) 0%, transparent 50%, rgba(99, 102, 241, 0.02) 100%)'
            } as any}
          />
        )}
      </AnimatePresence>

      {/* Left section - Protocol/Security indicator */}
      <div className="flex items-center pl-4 pr-2 h-full">
        {isRonProtocol ? (
          <motion.div
            className="flex items-center gap-1.5"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <img src="/favicon.png" alt="Ron" className="w-4 h-4" />
            <span className="text-label text-accent dark:text-accent-light tracking-wider">
              ron
            </span>
          </motion.div>
        ) : isSecure ? (
          <motion.div
            className="flex items-center gap-1.5"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <Lock className="w-4 h-4 text-success" />
          </motion.div>
        ) : null}
      </div>

      {/* Divider */}
      {(isSecure || isRonProtocol) && (
        <div className="w-px h-5 bg-surface-200 dark:bg-surface-700 mr-2" />
      )}

      {/* URL input */}
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={handleSubmit}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className={cn(
          "flex-1 bg-transparent outline-none",
          "text-body-sm tracking-wide",
          "text-ink dark:text-ink-inverse",
          "placeholder:text-ink-muted dark:placeholder:text-ink-inverse-muted",
          "selection:bg-accent/20 dark:selection:bg-accent-light/20"
        )}
        placeholder="Search or enter URL..."
      />

      {/* Right section - Search action */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        className={cn(
          "flex items-center justify-center",
          "w-9 h-9 mr-1 rounded-lg",
          "transition-colors duration-200",
          "hover:bg-accent/10 dark:hover:bg-accent-light/10",
          "active:bg-accent/20 dark:active:bg-accent-light/20"
        )}
        onClick={handleSearchClick}
        title="Search or navigate"
      >
        <Search className="w-4 h-4 text-ink-muted dark:text-ink-inverse-muted" />
      </motion.button>

      {/* Bottom accent line on focus */}
      <motion.div
        className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-accent dark:via-accent-light to-transparent"
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{
          scaleX: isFocused ? 1 : 0,
          opacity: isFocused ? 0.6 : 0,
        }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      />
    </motion.div>
  )
}
