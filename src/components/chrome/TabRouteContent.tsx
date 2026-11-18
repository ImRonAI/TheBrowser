import { navigateTabByIdOrActive, useTabPane } from '@/context/TabPaneContext'
import {
  getSearchContextFromRonUrl,
  getSearchLevelFromRonUrl,
  getSearchQueryFromRonUrl,
} from '@/components/chrome/UrlBar'
import { BuildWorkbenchPage } from '@/components/build'
import { SearchChat } from '@/components/search-results'
import { parseResearchUrl } from '@/lib/deep-research-api'
import { parseDocumentsLibraryUrl } from '@/lib/project-documents'
import { DEFAULT_SEARCH_LEVEL, type SearchLevel } from '@/lib/search-api'
import { ArticleReaderPage } from '@/pages/ArticleReaderPage'
import { DeepResearchPage } from '@/pages/DeepResearchPage'
import { DocumentsPage } from '@/pages/DocumentsPage'
import { ExecutePage } from '@/pages/ExecutePage'
import { HomePage } from '@/pages/HomePage'
import { ProjectHomePage } from '@/pages/ProjectHomePage'
import { ProjectsIndexPage } from '@/pages/ProjectsIndexPage'
import { SearchResultsPage } from '@/pages/SearchResultsPage'
import { useAuthStore } from '@/stores/authStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { selectShowChat, selectShowFullResults, useSearchStore } from '@/stores/searchStore'

export interface TabRouteContentProps {
  tabId: string | null
  url: string | undefined
  /** Optional dev/hash overrides active only for single-pane top-level view. */
  singleSearchOverride?: {
    forceResults?: boolean
    query?: string | null
    level?: SearchLevel | null
    contextId?: string | null
  }
}

export function TabRouteContent({ tabId, url, singleSearchOverride }: TabRouteContentProps) {
  const { isSplitPane } = useTabPane()
  const userId = useAuthStore((state) => state.user?.id)
  const activeNavTab = useNavigationStore((state) => state.activeTab)
  const searchStore = useSearchStore()
  const preferredSearchLevel = searchStore.level

  const isRonSearchUrl = Boolean(url?.startsWith('ron://search'))
  const urlSearchQuery = url ? getSearchQueryFromRonUrl(url) : null
  const urlSearchLevel = url ? getSearchLevelFromRonUrl(url) : null
  const urlSearchContext = url ? getSearchContextFromRonUrl(url) : null

  const showSingleOverrideSearch =
    !isSplitPane &&
    Boolean(
      singleSearchOverride?.forceResults ||
        selectShowFullResults(searchStore) ||
        singleSearchOverride?.query,
    )

  if (isRonSearchUrl || showSingleOverrideSearch) {
    const query =
      (urlSearchQuery && urlSearchQuery.trim() ? urlSearchQuery : null) ||
      singleSearchOverride?.query ||
      (!isSplitPane ? searchStore.query : '') ||
      ''
    const level =
      urlSearchLevel ??
      singleSearchOverride?.level ??
      preferredSearchLevel ??
      DEFAULT_SEARCH_LEVEL
    const contextId = urlSearchContext ?? singleSearchOverride?.contextId ?? null

    return (
      <div className="h-full overflow-y-auto">
        <SearchResultsPage
          query={query}
          level={level}
          contextId={contextId}
          onBack={() => {
            if (!isSplitPane) searchStore.clearSearch()
            navigateTabByIdOrActive(tabId, 'ron://home')
          }}
        />
      </div>
    )
  }

  if (!isSplitPane && selectShowChat(searchStore) && searchStore.query) {
    return (
      <SearchChat
        searchResult={{
          query: searchStore.query,
          answer: searchStore.quickResult?.answer,
          sources: searchStore.quickResult?.sources,
        }}
        onBack={() => {
          searchStore.setPhase(searchStore.isStreaming ? 'answering' : 'complete')
        }}
      />
    )
  }

  if (url === 'ron://projects' || url === 'ron://projects/') {
    return <ProjectsIndexPage key={userId} />
  }

  const projectRoute = url?.match(/^ron:\/\/project\/([^/?#]+)(?:\/docs\/([^/?#]+))?\/?$/)
  if (projectRoute) {
    return (
      <ProjectHomePage
        key={`${userId}:${projectRoute[1]}`}
        projectKey={projectRoute[1]}
        documentId={projectRoute[2]}
      />
    )
  }

  const documentsRoute = parseDocumentsLibraryUrl(url)
  if (documentsRoute) {
    return (
      <DocumentsPage
        key={`${userId}:${tabId ?? 'single'}`}
        documentId={documentsRoute.documentId}
      />
    )
  }

  const researchRoute = parseResearchUrl(url)
  if (researchRoute) {
    return (
      <DeepResearchPage
        key={`${userId}:${tabId ?? 'single'}`}
        sessionId={researchRoute.sessionId}
      />
    )
  }

  if (url?.startsWith('ron://read?')) {
    return <ArticleReaderPage key={url} href={url} />
  }

  if (url === 'ron://build' || url === 'ron://build/') {
    return <BuildWorkbenchPage />
  }

  if (url === 'ron://execute' || url === 'ron://execute/') {
    return <ExecutePage />
  }

  // In single-pane mode, preserve legacy navigationStore fallback on `ron://home`.
  if (!isSplitPane) {
    switch (activeNavTab) {
      case 'execute':
        return <ExecutePage />
      case 'build':
        return <BuildWorkbenchPage />
      case 'research':
        return <DeepResearchPage key={userId} sessionId={null} />
      default:
        return <HomePage />
    }
  }

  return <HomePage />
}
