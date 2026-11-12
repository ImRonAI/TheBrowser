import { useState, KeyboardEvent, useEffect, useCallback, useRef } from 'react'
import { Search, Lock, LockOpen, Globe, ArrowRight } from 'lucide-react'
import { RenMark } from '@/components/brand'
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
    if (handleAssistKey(e, assist, (text) => { setUrl(text); assist.dismiss(); void commitInput(text) }, (text) => { setUrl(text); assist.dismiss() })) return
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
  // Display only: at rest an https address is drawn as an emphasised host + quiet path over the
  // (transparent) input text, so the field's value, focus and selection behave exactly as before.
  const restingPath = restingHost !== null && restingText.startsWith(restingHost) ? restingText.slice(restingHost.length) : null
  const showIdentity = !isFocused && restingPath !== null
  const isPlainHttp = url.startsWith('http://')
  const securityHint = isRonProtocol ? 'Ren page' : isSecure ? 'Secure connection (HTTPS)' : isPlainHttp ? 'Not secure: this page uses plain HTTP' : undefined

  return (
    <div className="relative">
      <div
        className={cn(
          'ron-field group relative flex h-8 items-center overflow-hidden rounded-full border transition-[background-color,border-color,box-shadow] duration-150 ease-out',
          isFocused
            ? 'border-blurple-500 bg-surface-0 ring-[3px] ring-blurple-500/15 dark:border-blurple-400 dark:bg-surface-850 dark:ring-blurple-400/20'
            : 'border-surface-200 bg-surface-0 hover:border-surface-300 dark:border-surface-800 dark:bg-surface-850 dark:hover:border-surface-700',
        )}
      >
        {/* Left — page identity and security */}
        <span className="flex h-full w-9 flex-shrink-0 items-center justify-center pl-1" aria-hidden title={securityHint}>
          {isRonProtocol ? (
            <RenMark className="h-4 w-4" />
          ) : isSecure ? (
            <Lock className="h-3.5 w-3.5 text-ink-secondary dark:text-ink-inverse-secondary" strokeWidth={2} />
          ) : isPlainHttp ? (
            <LockOpen className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" strokeWidth={2} />
          ) : (
            <Globe className="h-3.5 w-3.5 text-ink-muted dark:text-ink-inverse-muted" strokeWidth={1.75} />
          )}
        </span>

        {showIdentity && (
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-9 right-9 flex items-center justify-center text-[13px]">
            <span className="min-w-0 truncate">
              <span className="font-medium text-ink dark:text-ink-inverse">{restingHost}</span>
              <span className="text-ink-muted transition-colors duration-150 group-hover:text-ink-secondary dark:text-ink-inverse-muted dark:group-hover:text-ink-inverse-secondary">{restingPath}</span>
            </span>
          </span>
        )}

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
            showIdentity && 'text-transparent group-hover:text-transparent dark:text-transparent dark:group-hover:text-transparent',
          )}
          placeholder="Search or enter address"
        />

        {/* Right — hint at rest, go when focused */}
        {isFocused ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            className="mr-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors duration-150 hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse"
            onClick={handleSearchClick}
            aria-label="Search or navigate"
            title="Search or navigate"
          >
            {looksLikeUrl(url.trim()) ? <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} /> : <Search className="h-3.5 w-3.5" strokeWidth={2} />}
          </button>
        ) : (
          <kbd className="mr-2 hidden h-[18px] min-w-[18px] flex-shrink-0 items-center justify-center rounded-[5px] border border-b-2 border-surface-200 px-1 font-mono text-[10px] font-medium leading-none text-ink-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 dark:border-surface-700 dark:text-ink-inverse-muted sm:inline-flex">
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
