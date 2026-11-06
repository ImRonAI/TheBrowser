import { Component, Suspense, useEffect, useState, type ReactNode } from 'react'
import { SIGN_IN_HASH, closeSignIn, isFirstRun, markLaunched, openSignIn } from '@/lib/sign-in'
import { useTheme } from '@/hooks/useTheme'
import { handleDeepLinkCallback, useAuthStore } from '@/stores/authStore'
import { useTabStore } from '@/stores/tabStore'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useInterestsStore } from '@/stores/interestsStore'
import { useSearchStore, selectShowFullResults, selectShowChat } from '@/stores/searchStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { getSearchLevelFromRonUrl, getSearchQueryFromRonUrl } from '@/components/chrome/UrlBar'
import { DEFAULT_SEARCH_LEVEL, SEARCH_LEVELS, type SearchLevel } from '@/lib/search-api'
import { BrowserLayout } from '@/layouts/BrowserLayout'
import { AuthPageLayout } from '@/layouts/AuthPageLayout'
import { HomePage } from '@/pages/HomePage'
import { ArticleReaderPage } from '@/pages/ArticleReaderPage'
import { ExecutePage } from '@/pages/ExecutePage'
import { ProjectsIndexPage } from '@/pages/ProjectsIndexPage'
import { ProjectHomePage } from '@/pages/ProjectHomePage'
import { BuildWorkbenchPage } from '@/components/build'
import { SignInPage } from '@/pages/SignInPage'
import { OnboardingPage } from '@/pages/OnboardingPage'
import { AIElementsShowcase } from '@/pages/AIElementsShowcase'
import { SearchResultsPage } from '@/pages/SearchResultsPage'
import { SearchChat } from '@/components/search-results'

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
  console.log('All storage cleared!')
}

export function App() {
  const { isDark } = useTheme()
  const { isAuthenticated, isInitialized, isLoading, initialize } = useAuthStore()
  const { tabs, createTab } = useTabStore()
  const { isComplete } = useOnboardingStore()
  const [hasHydrated, setHasHydrated] = useState(false)
  // A fresh install (nothing in localStorage yet) launches on the sign-in page.
  const [showSignIn, setShowSignIn] = useState(() => {
    if (isFirstRun()) openSignIn()
    return window.location.hash === SIGN_IN_HASH
  })
  // `#onboarding` lets a guest (or a returning user via "Personalize") run the interview.
  const [showOnboarding, setShowOnboarding] = useState(() => window.location.hash === '#onboarding')
  const { activeTab } = useNavigationStore()
  const searchStore = useSearchStore()
  const { 
    phase: searchPhase, 
    query: searchQuery, 
    quickResult,
    isStreaming,
    level: preferredSearchLevel,
    setPhase,
    clearSearch,
  } = searchStore
  
  const showFullResults = selectShowFullResults(searchStore)
  const showChat = selectShowChat(searchStore)
  
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
      // Check if we've already reset this session (to avoid infinite reload loop)
      const hasReset = sessionStorage.getItem('app-reset-this-session')
      if (!hasReset) {
        resetAppStorage()
        sessionStorage.setItem('app-reset-this-session', 'true')
        // Force reload to apply cleared state
        window.location.reload()
        return
      }
    }
  }, [])

  // DEV: Keyboard shortcut to reset app (Cmd/Ctrl + Shift + K)
  // DEV: Keyboard shortcut to toggle showcase (Cmd/Ctrl + Shift + S)
  // DEV: Keyboard shortcut to toggle search results (Cmd/Ctrl + Shift + R)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'K') {
        e.preventDefault()
        resetAppStorage()
        sessionStorage.removeItem('app-reset-this-session')
        window.location.reload()
      }
      // Toggle AI Elements Showcase with Cmd/Ctrl + Shift + S
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault()
        setShowShowcase(prev => !prev)
      }
      // Toggle Search Results Page with Cmd/Ctrl + Shift + R
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'R') {
        e.preventDefault()
        setShowSearchResultsDev(prev => !prev)
      }
      // ESC leaves search: back to home (and clear any legacy phase state)
      if (e.key === 'Escape' && (searchPhase !== 'idle' || searchRouteQuery)) {
        e.preventDefault()
        handleSearchBack()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [searchPhase, searchRouteQuery, clearSearch])

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
    }

    const handleUrlChanged = (newUrl: string) => {
      if (!newUrl.startsWith('ron://search')) {
        setSearchRouteQuery(null)
        setSearchRouteLevel(null)
        return
      }
      const query = getSearchQueryFromRonUrl(newUrl)
      setSearchRouteQuery(query && query.trim() ? query : null)
      setSearchRouteLevel(getSearchLevelFromRonUrl(newUrl))
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

  // Search results page exit: return the tab to home and reset legacy search state.
  const handleSearchBack = () => {
    clearSearch()
    if (typeof window !== 'undefined' && window.electron?.browser?.navigate) {
      void window.electron.browser.navigate('ron://home')
    }
  }

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

  // SearchAgentDisplay handles its own fetching - no need to fetch here


  if (!hasHydrated || isLoading || !isInitialized) return <AppLoadingScreen />

  // DEV: Show AI Elements Showcase (accessible from any state via Cmd/Ctrl + Shift + S)
  if (showShowcase) {
    return (
      <RouteShell>
        <AIElementsShowcase />
      </RouteShell>
    )
  }

  // Search results site: ron://search?q=…&level=… (also #search/#results hash, or
  // the legacy full-results phase). The query/level in the tab URL win over prefs.
  if (showSearchResultsDev || showFullResults || searchRouteQuery) {
    return (
      <RouteShell>
        <BrowserLayout>
          <div className="h-full overflow-y-auto">
            <SearchResultsPage
              query={searchRouteQuery || searchQuery || ''}
              level={searchRouteLevel ?? preferredSearchLevel ?? DEFAULT_SEARCH_LEVEL}
              onBack={handleSearchBack}
            />
          </div>
        </BrowserLayout>
      </RouteShell>
    )
  }

  if (showChat && searchQuery) {
    return (
      <RouteShell>
        <BrowserLayout>
          <SearchChat
            searchResult={{
              query: searchQuery,
              answer: quickResult?.answer,
              sources: quickResult?.sources,
            }}
            onBack={() => {
              setPhase(isStreaming ? 'answering' : 'complete')
            }}
          />
        </BrowserLayout>
      </RouteShell>
    )
  }

  // Signing in is optional. A fresh install opens the browser and guest workspace.
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
  // Answers feed `useDiscoverProfile()` → Discover homepage + Interests orb.
  if ((isAuthenticated && !isComplete) || showOnboarding) {
    return (
      <RouteShell>
        <OnboardingPage />
      </RouteShell>
    )
  }

  // Main browser interface
  return (
    <RouteShell>
      <BrowserLayout>
        <MainContent activeTab={activeTab} />
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

// Route content based on navigation tab
function MainContent({ activeTab }: { activeTab: string }) {
  const url = useTabStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.url)
  const userId = useAuthStore((state) => state.user?.id)
  if (url === 'ron://projects' || url === 'ron://projects/') {
    return <ProjectsIndexPage key={userId} />
  }
  const projectRoute = url?.match(/^ron:\/\/project\/([^/?#]+)(?:\/docs\/([^/?#]+))?\/?$/)
  if (projectRoute) return <ProjectHomePage key={`${userId}:${projectRoute[1]}`} projectKey={projectRoute[1]} documentId={projectRoute[2]} />
  if (url?.startsWith('ron://read?')) return <ArticleReaderPage key={url} href={url} />
  switch (activeTab) {
    case 'execute':
      return <ExecutePage />
    case 'build':
      return <BuildWorkbenchPage />
    default:
      return <HomePage />
  }
}

// ============================================
// Search Agent Stream - Real Implementation with Strands
// ============================================
// Removed streamSonarReasoningPro - SearchAgentDisplay handles its own fetching

