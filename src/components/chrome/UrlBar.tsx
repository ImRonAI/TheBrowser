import { useState, KeyboardEvent, useEffect, useCallback, useRef } from 'react'
import { Search, Lock, Globe, ArrowRight } from 'lucide-react'
import { useNavigationStore } from '@/stores/navigationStore'
import { MOD_KEY } from '@/lib/shortcuts'
import { cn } from '@/utils/cn'
import { useSearchStore } from '@/stores/searchStore'
import { SEARCH_LEVELS, type SearchLevel } from '@/lib/search-api'
import { useTextAssist } from '@/hooks/useTextAssist'
import { TextAssist, handleAssistKey } from '@/components/shared/TextAssist'

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

export function getSearchLevelFromRonUrl(value: string): SearchLevel | null {
  if (!value.startsWith(SEARCH_PROTOCOL_PREFIX)) return null
  try {
    const level = new URL(value).searchParams.get('level')
    return level && (SEARCH_LEVELS as readonly string[]).includes(level) ? (level as SearchLevel) : null
  } catch {
    return null
  }
}

export function buildSearchRonUrl(query: string, level: SearchLevel): string {
  return `${SEARCH_PROTOCOL_PREFIX}?q=${encodeURIComponent(query)}&level=${level}`
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
  const inputRef = useRef<HTMLInputElement>(null)
  const urlFocusRequest = useNavigationStore((state) => state.urlFocusRequest)
  const { search, clearSearch, level } = useSearchStore()
  // Brave Suggest + Spellcheck while the user types a query. URLs (and ron:// addresses) are not
  // search phrases, so assist stays off for anything that looks like an address; it also waits for
  // focus so the synced tab URL never triggers a request.
  const skipAssist = useCallback((value: string) => looksLikeUrl(value.trim()) || value.trim().startsWith('ron://'), [])
  const assist = useTextAssist(url, { enabled: isFocused, skip: skipAssist, count: 6 })

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

  // ⌘L: focus and select the address.
  useEffect(() => {
    if (!urlFocusRequest) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [urlFocusRequest])

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
        } else if (ronQuery !== null) {
          await window.electron.browser.navigate(trimmed)
        } else {
          // A plain query becomes the search page: the active tab moves to
          // ron://search, which renders the full results site.
          await window.electron.browser.navigate(buildSearchRonUrl(query, level))
          console.log('Search initiated:', query)
        }
      } catch (error) {
        console.error('Url bar action error:', error)
      }
      return
    }

    if (!shouldNavigate) {
      search(query)
      setUrl(buildSearchRonUrl(query, level))
    }
  }

  const handleSubmit = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (handleAssistKey(e, assist, (text) => { setUrl(text); assist.dismiss(); void commitInput(text) })) return
    if (e.key === 'Enter') {
      assist.dismiss()
      await commitInput(url)
    }
    if (e.key === 'Escape') inputRef.current?.blur()
  }

  const handleSearchClick = async () => {
    await commitInput(url)
  }

  const isRonProtocol = url.startsWith('ron://')
  const isSecure = url.startsWith('https://') || isRonProtocol
  const ronQuery = getSearchQueryFromRonUrl(url)
  // At rest, show the page's identity rather than raw plumbing: a search reads as its
  // query, an https page as host + path. Focus always reveals the exact address.
  const restingText = (() => {
    if (ronQuery !== null && ronQuery) return ronQuery
    if (url.startsWith('https://')) {
      try {
        const parsed = new URL(url)
        const host = parsed.hostname.replace(/^www\./, '')
        const path = parsed.pathname === '/' ? '' : parsed.pathname
        return `${host}${path}${parsed.search}`
      } catch {
        return url
      }
    }
    return url
  })()
  const restingHost = (() => {
    if (!url.startsWith('https://')) return null
    try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
  })()

  return (
    <div className="relative">
      <div
        className={cn(
          'group relative flex h-8 items-center overflow-hidden rounded-lg transition-[background-color,box-shadow] duration-150',
          isFocused
            ? 'bg-surface-0 shadow-[0_0_0_1px_rgb(169_83_46/0.45),0_0_0_4px_rgb(169_83_46/0.10)] dark:bg-surface-850 dark:shadow-[0_0_0_1px_rgb(214_130_90/0.5),0_0_0_4px_rgb(214_130_90/0.12)]'
            : 'bg-surface-200/45 hover:bg-surface-200/70 dark:bg-surface-800/70 dark:hover:bg-surface-800',
        )}
      >
        {/* Left — page identity */}
        <span className="flex h-full w-8 flex-shrink-0 items-center justify-center" aria-hidden>
          {isRonProtocol ? (
            <img src="/favicon.png" alt="" className="h-3.5 w-3.5" />
          ) : isSecure ? (
            <Lock className="h-3 w-3 text-ink-muted dark:text-ink-inverse-muted" strokeWidth={2} />
          ) : (
            <Globe className="h-3.5 w-3.5 text-ink-muted dark:text-ink-inverse-muted" strokeWidth={1.75} />
          )}
        </span>

        {/* URL input */}
        <input
          ref={inputRef}
          type="text"
          value={isFocused ? url : restingText}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleSubmit}
          onFocus={(e) => { setIsFocused(true); requestAnimationFrame(() => e.target.select()) }}
          onBlur={() => setIsFocused(false)}
          aria-label="Search or enter address"
          spellCheck={false}
          className={cn(
            'h-full min-w-0 flex-1 bg-transparent pr-2 text-[13px] outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
            'text-ink placeholder:text-ink-muted dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted',
            !isFocused && restingHost && 'text-ink-secondary dark:text-ink-inverse-secondary',
            !isFocused && 'text-center group-hover:text-ink dark:group-hover:text-ink-inverse',
          )}
          placeholder="Search or enter address"
        />

        {/* Right — hint at rest, go when focused */}
        {isFocused ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            className="mr-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse"
            onClick={handleSearchClick}
            aria-label="Search or navigate"
            title="Search or navigate"
          >
            {looksLikeUrl(url.trim()) ? <ArrowRight className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <kbd className="mr-1.5 hidden flex-shrink-0 rounded px-1 text-[10px] leading-4 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100 dark:text-ink-inverse-muted sm:block">
            {MOD_KEY}L
          </kbd>
        )}
      </div>
      {isFocused && <TextAssist assist={assist} placement="below" compact
        onPick={(text) => { setUrl(text); assist.dismiss(); void commitInput(text) }}
        onCorrect={(text) => { setUrl(text); assist.dismiss() }} />}
    </div>
  )
}
