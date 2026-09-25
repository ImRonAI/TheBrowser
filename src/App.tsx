import { Component, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useTheme } from '@/hooks/useTheme'
import { handleDeepLinkCallback, useAuthStore } from '@/stores/authStore'
import { useTabStore } from '@/stores/tabStore'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useInterestsStore } from '@/stores/interestsStore'
import { useSearchStore, selectShowFullResults, selectShowChat } from '@/stores/searchStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { getSearchQueryFromRonUrl } from '@/components/chrome/UrlBar'
import { BrowserLayout } from '@/layouts/BrowserLayout'
import { AuthPageLayout } from '@/layouts/AuthPageLayout'
import { HomePage } from '@/pages/HomePage'
import { ExecutePage } from '@/pages/ExecutePage'
import { ProjectsIndexPage } from '@/pages/ProjectsIndexPage'
import { ProjectHomePage } from '@/pages/ProjectHomePage'
import { BuildWorkbenchPage } from '@/components/build'
import { SignInPage } from '@/pages/SignInPage'
import { OnboardingPage } from '@/pages/OnboardingPage'
import { AIElementsShowcase } from '@/pages/AIElementsShowcase'
import { SearchThinkingOverlay, SearchChat, SearchAgentDisplay } from '@/components/search-results'

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
  const [showSignIn, setShowSignIn] = useState(() => window.location.hash === '#signin')
  const { activeTab } = useNavigationStore()
  const searchStore = useSearchStore()
  const { 
    phase: searchPhase, 
    query: searchQuery, 
    quickResult,
    isStreaming,
    setPhase,
    clearSearch,
  } = searchStore
  
  const showFullResults = selectShowFullResults(searchStore)
  const showChat = selectShowChat(searchStore)
  const showThinking = searchPhase === 'thinking'
  
  // Check URL hash for showcase mode
  const [showShowcase, setShowShowcase] = useState(() => {
    return window.location.hash === '#showcase'
  })

  // Check URL hash for search results mode (DEV override)
  const [showSearchResultsDev, setShowSearchResultsDev] = useState(() => {
    return window.location.hash === '#search' || window.location.hash === '#results'
  })
  const [searchRouteQuery, setSearchRouteQuery] = useState<string | null>(null)
  
  useEffect(() => {
    return window.electron?.onDeepLink?.((url) => {
      handleDeepLinkCallback(url).catch(console.error)
    })
  }, [])

  useEffect(() => {
    const update = () => setShowSignIn(window.location.hash === '#signin')
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

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
      // ESC to clear search
      if (e.key === 'Escape' && searchPhase !== 'idle') {
        e.preventDefault()
        clearSearch()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [searchPhase, clearSearch])

  useEffect(() => {
    const updateSearchRoute = () => {
      const queryParams = new URLSearchParams(window.location.search)
      const query = queryParams.get('q')
      setSearchRouteQuery(query && query.trim() ? query : null)
    }

    const handleUrlChanged = (newUrl: string) => {
      if (!newUrl.startsWith('ron://search')) {
        setSearchRouteQuery(null)
        return
      }
      const query = getSearchQueryFromRonUrl(newUrl)
      setSearchRouteQuery(query && query.trim() ? query : null)
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

  // DEV: Show Search Results Page (accessible from any state via #search or #results hash, or Cmd/Ctrl + Shift + R)
  // Also show when full results phase is active
  if (showSearchResultsDev || showFullResults || searchRouteQuery) {
    return (
      <RouteShell>
        <BrowserLayout>
          <div className="min-h-screen bg-surface-0 dark:bg-surface-900 p-8">
            <SearchAgentDisplay
              query={searchRouteQuery || searchQuery || "The Buffalo Bills"}
              sessionId="search-page"
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
          <SignInPage />
          <button type="button" onClick={() => { window.location.hash = ''; setShowSignIn(false) }}>Continue without an account</button>
        </AuthPageLayout>
      </RouteShell>
    )
  }

  // If not onboarded, show onboarding page
  if (isAuthenticated && !isComplete) {
    return (
      <RouteShell>
        <OnboardingPage />
      </RouteShell>
    )
  }

  // Main browser interface with search overlays
  return (
    <RouteShell>
      <>
        <BrowserLayout>
        {/* If there's an active search, show SearchAgentDisplay */}
        {searchQuery && searchPhase !== 'idle' ? (
          <div className="h-full overflow-auto bg-surface-0 dark:bg-surface-900 p-8">
            <SearchAgentDisplay
              query={searchQuery}
              sessionId="search-session"
            />
          </div>
        ) : (
          <MainContent activeTab={activeTab} />
        )}
      </BrowserLayout>

      {/* Thinking overlay - shows during initial search animation */}
        <SearchThinkingOverlay
          isVisible={showThinking}
          query={searchQuery}
        />
      </>
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
  const projectRoute = url?.match(/^ron:\/\/project\/([^/?#]+)\/?$/)
  if (projectRoute) return <ProjectHomePage key={`${userId}:${projectRoute[1]}`} projectKey={projectRoute[1]} />
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

