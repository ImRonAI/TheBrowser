import { Component, Suspense, useEffect, useState, type ReactNode } from 'react'
import { SIGN_IN_HASH, closeSignIn, isFirstRun, markLaunched, openSignIn } from '@/lib/sign-in'
import { useTheme } from '@/hooks/useTheme'
import { handleDeepLinkCallback, useAuthStore } from '@/stores/authStore'
import { useTabStore } from '@/stores/tabStore'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useAccountProfileReady, useAccountProfileSync } from '@/stores/accountProfileStore'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { useInterestDiscoveryStore } from '@/stores/interestDiscoveryStore'
import { useInterestsStore } from '@/stores/interestsStore'
import { useSearchStore } from '@/stores/searchStore'
import { getSearchContextFromRonUrl, getSearchLevelFromRonUrl, getSearchQueryFromRonUrl } from '@/components/chrome/UrlBar'
import { SEARCH_LEVELS, type SearchLevel } from '@/lib/search-api'
import { BrowserLayout } from '@/layouts/BrowserLayout'
import { AuthPageLayout } from '@/layouts/AuthPageLayout'
import { TabRouteContent } from '@/components/chrome/TabRouteContent'
import { SignInPage } from '@/pages/SignInPage'
import { OnboardingPage } from '@/pages/OnboardingPage'
import { AIElementsShowcase } from '@/pages/AIElementsShowcase'
import { TabPaneProvider, navigateTabByIdOrActive } from '@/context/TabPaneContext'

// ============================================
// DEV MODE FLAGS
// ============================================
const RESET_APP_ON_LAUNCH = false // Disabled to test showcase

// Clear storage AND reset Zustand stores
function resetAppStorage() {
  localStorage.clear()
  useAuthStore.persist.clearStorage()
  useTabStore.persist.clearStorage()
  useOnboardingStore.persist.clearStorage()
  useInterestsStore.persist.clearStorage()
  useContextAgentStore.persist.clearStorage()
  useInterestDiscoveryStore.getState().resetDiscovery()
  console.log('All storage cleared!')
}

export function App() {
  const { isDark } = useTheme()
  const { isAuthenticated, isInitialized, isLoading, initialize } = useAuthStore()
  const { tabs, activeTabId, createTab } = useTabStore()
  const activeTabUrl = useTabStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.url)
  const { isComplete } = useOnboardingStore()
  useAccountProfileSync()
  const profileReady = useAccountProfileReady()
  const [hasHydrated, setHasHydrated] = useState(false)
  // A fresh install (nothing in localStorage yet) launches on the sign-in page.
  const [showSignIn, setShowSignIn] = useState(() => {
    if (isFirstRun()) openSignIn()
    return window.location.hash === SIGN_IN_HASH
  })
  // `#onboarding` lets a guest (or a returning user via "Personalize") run the interview.
  const [showOnboarding, setShowOnboarding] = useState(() => window.location.hash === '#onboarding')
  const searchStore = useSearchStore()
  const { phase: searchPhase, clearSearch } = searchStore

  // Check URL hash for showcase mode
  const [showShowcase, setShowShowcase] = useState(() => {
    return window.location.hash === '#showcase'
  })

  // Check URL hash for search results mode (DEV override)
  const [showSearchResultsDev, setShowSearchResultsDev] = useState(() => {
    return window.location.hash === '#search' || window.location.hash === '#results'
  })
  const [searchRouteQuery, setSearchRouteQuery] = useState<string | null>(null)
  const [searchRouteLevel, setSearchRouteLevel] = useState<SearchLevel | null>(null)
  const [searchRouteContext, setSearchRouteContext] = useState<string | null>(null)

  useEffect(() => {
    return window.electron?.onDeepLink?.((url) => {
      handleDeepLinkCallback(url).catch(console.error)
    })
  }, [])

  useEffect(() => {
    const update = () => {
      setShowSignIn(window.location.hash === SIGN_IN_HASH)
      setShowOnboarding(window.location.hash === '#onboarding')
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  // A successful sign-in (password or OAuth loopback) while the sign-in page is up returns to the
  // browser; leaving `#signin` behind keeps a later sign-out in the browser, not the form.
  useEffect(() => {
    if (!isAuthenticated) return
    markLaunched()
    if (showSignIn) { closeSignIn(); setShowSignIn(false) }
  }, [isAuthenticated, showSignIn])

  useEffect(() => {
    void initialize()
    const updateHydration = () => {
      setHasHydrated(
        useAuthStore.persist.hasHydrated() && useOnboardingStore.persist.hasHydrated(),
      )
    }
    updateHydration()
    const offAuth = useAuthStore.persist.onFinishHydration(updateHydration)
    const offOnboarding = useOnboardingStore.persist.onFinishHydration(updateHydration)
    return () => {
      offAuth()
      offOnboarding()
    }
  }, [initialize])

  // DEV: Reset app on launch if flag is set
  useEffect(() => {
    if (RESET_APP_ON_LAUNCH) {
      const hasReset = sessionStorage.getItem('app-reset-this-session')
      if (!hasReset) {
        resetAppStorage()
        sessionStorage.setItem('app-reset-this-session', 'true')
        window.location.reload()
        return
      }
    }
  }, [])

  const handleSearchBack = () => {
    clearSearch()
    navigateTabByIdOrActive(activeTabId, 'ron://home')
  }

  // DEV shortcuts + ESC leaves search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'K') {
        e.preventDefault()
        resetAppStorage()
        sessionStorage.removeItem('app-reset-this-session')
        window.location.reload()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault()
        setShowShowcase(prev => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'R') {
        e.preventDefault()
        setShowSearchResultsDev(prev => !prev)
      }
      if (e.key === 'Escape' && (searchPhase !== 'idle' || searchRouteQuery || activeTabUrl?.startsWith('ron://search'))) {
        e.preventDefault()
        handleSearchBack()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [searchPhase, searchRouteQuery, activeTabUrl, activeTabId, clearSearch])

  useEffect(() => {
    const updateSearchRoute = () => {
      const queryParams = new URLSearchParams(window.location.search)
      const query = queryParams.get('q')
      const rawLevel = queryParams.get('level')
      setSearchRouteQuery(query && query.trim() ? query : null)
      setSearchRouteLevel(
        rawLevel && (SEARCH_LEVELS as readonly string[]).includes(rawLevel)
          ? (rawLevel as SearchLevel)
          : null,
      )
      setSearchRouteContext(queryParams.get('ctx') || null)
    }

    const handleUrlChanged = (newUrl: string) => {
      if (!newUrl.startsWith('ron://search')) {
        setSearchRouteQuery(null)
        setSearchRouteLevel(null)
        setSearchRouteContext(null)
        return
      }
      const query = getSearchQueryFromRonUrl(newUrl)
      setSearchRouteQuery(query && query.trim() ? query : null)
      setSearchRouteLevel(getSearchLevelFromRonUrl(newUrl))
      setSearchRouteContext(getSearchContextFromRonUrl(newUrl))
    }

    updateSearchRoute()
    window.addEventListener('popstate', updateSearchRoute)

    let cleanup: (() => void) | undefined
    if (typeof window !== 'undefined' && window.electron?.browser?.onUrlChanged) {
      cleanup = window.electron.browser.onUrlChanged(handleUrlChanged)
    }

    return () => {
      window.removeEventListener('popstate', updateSearchRoute)
      if (cleanup) cleanup()
    }
  }, [])

  useEffect(() => {
    if (!activeTabId || !activeTabUrl) return
    if (activeTabUrl.startsWith('ron://search')) {
      const query = getSearchQueryFromRonUrl(activeTabUrl)
      setSearchRouteQuery(query && query.trim() ? query : null)
      setSearchRouteLevel(getSearchLevelFromRonUrl(activeTabUrl))
      setSearchRouteContext(getSearchContextFromRonUrl(activeTabUrl))
    } else if (!window.location.search.includes('q=')) {
      setSearchRouteQuery(null)
      setSearchRouteLevel(null)
      setSearchRouteContext(null)
    }
  }, [activeTabId, activeTabUrl])

  // Initialize with at least one tab
  useEffect(() => {
    if (isInitialized && (!isAuthenticated || isComplete) && tabs.length === 0) {
      createTab('ron://home', true)
    }
  }, [isInitialized, isAuthenticated, isComplete, tabs.length, createTab])

  // Apply theme class to document
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [isDark])

  if (!hasHydrated || isLoading || !isInitialized || !profileReady) return <AppLoadingScreen />

  // DEV: Show AI Elements Showcase (accessible from any state via Cmd/Ctrl + Shift + S)
  if (showShowcase) {
    return (
      <RouteShell>
        <AIElementsShowcase />
      </RouteShell>
    )
  }

  // Signing in is optional; checked BEFORE search/browser routes so `#signin` works from any tab!
  if (showSignIn && !isAuthenticated) {
    return (
      <RouteShell>
        <AuthPageLayout>
          <SignInPage onContinueAsGuest={() => { markLaunched(); closeSignIn(); setShowSignIn(false) }} />
        </AuthPageLayout>
      </RouteShell>
    )
  }

  // If not onboarded (signed in), or explicitly requested via #onboarding, show the interview.
  if ((isAuthenticated && !isComplete) || showOnboarding) {
    return (
      <RouteShell>
        <OnboardingPage />
      </RouteShell>
    )
  }

  // Main browser interface (handles both single-tab and up-to-2x2 split-pane routing)
  return (
    <RouteShell>
      <BrowserLayout>
        <TabPaneProvider tabId={activeTabId} url={activeTabUrl ?? null} isSplitPane={false}>
          <TabRouteContent
            tabId={activeTabId}
            url={activeTabUrl}
            singleSearchOverride={{
              forceResults: showSearchResultsDev,
              query: searchRouteQuery,
              level: searchRouteLevel,
              contextId: searchRouteContext,
            }}
          />
        </TabPaneProvider>
      </BrowserLayout>
    </RouteShell>
  )
}

function AppLoadingScreen() {
  return <div role="status" aria-label="Loading application" />
}

type AppErrorBoundaryProps = { children: ReactNode }
type AppErrorBoundaryState = { hasError: boolean }

class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error('Route render error:', error)
  }

  render() {
    if (this.state.hasError) return <AppLoadingScreen />
    return this.props.children
  }
}

function RouteShell({ children }: { children: ReactNode }) {
  return (
    <AppErrorBoundary>
      <Suspense fallback={<AppLoadingScreen />}>
        {children}
      </Suspense>
    </AppErrorBoundary>
  )
}
