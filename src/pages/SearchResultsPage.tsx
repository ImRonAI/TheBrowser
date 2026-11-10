/**
 * Search Results Page — "Brief"
 *
 * One query fans out to seven sources (Brave web/news/videos/images/places at maximum
 * counts + the Perplexity Agent API at the chosen depth + a domain-restricted shopping
 * agent) and the page assembles itself live around the results:
 *
 * - The Lens Bar: a sticky underline tab row with live counts and per-source status
 *   (Answer / Web / News / Images / Videos / Places / Shopping).
 * - The Web tab ranks by provenance — Consensus (agent ∩ Brave), Agent picks, then
 *   the breadth of Brave — as truncated two-line rows beside an "At a glance" rail.
 * - One volt accent throughout; no per-lens tinting.
 *
 * Route: ron://search?q=<query>&level=<fast|low|medium|high|xhigh>
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Plus, RotateCw, SearchX } from 'lucide-react'
import { useSearchResultsStore } from '@/stores/searchResultsStore'
import { getDiscoverProfile, useDiscoverProfile, useDiscoverProfileStore } from '@/stores/discoverProfileStore'
import {
  SEARCH_LEVELS,
  levelLabel,
  mergedImages,
  mergedWebResults,
  searchRunKey,
  sectionItems,
  type SearchLevel,
} from '@/lib/search-api'
import { buildSearchRonUrl } from '@/components/chrome/UrlBar'
import { searchMarkdown } from '@/lib/context-api'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { SearchBackdrop } from '@/components/search/SearchBackdrop'
import { SearchHeader } from '@/components/search/SearchHeader'
import { LensBar, lensPanelId, lensTabId, type LensState } from '@/components/search/LensBar'
import { tabHue, type SearchTab } from '@/components/search/tabs-meta'
import { AgentAnswer } from '@/components/search/AgentAnswer'
import { WebResults } from '@/components/search/WebResults'
import { LocalResults } from '@/components/search/LocalResults'
import { NewsResults } from '@/components/search/NewsResults'
import { ImageMasonry } from '@/components/search/ImageMasonry'
import { VideoResults } from '@/components/search/VideoResults'
import { ShoppingResults } from '@/components/search/ShoppingResults'

export interface SearchResultsPageProps {
  query: string
  level: SearchLevel
  onBack: () => void
}

const PANEL_KEY: Record<SearchTab, string> = {
  agent: 'panel-agent', web: 'panel-web', local: 'panel-local', news: 'panel-news',
  images: 'panel-images', videos: 'panel-videos', shopping: 'panel-shopping',
}

export function SearchResultsPage({ query, level, onBack }: SearchResultsPageProps) {
  const { run, isRunning, followUpLoading, startedAt, fatal, start, sendFollowUp, refreshPlaces, cancel } = useSearchResultsStore()
  const [activeTab, setActiveTab] = useState<SearchTab>('agent')
  const reduced = useReducedMotion()
  const addContext = useContextAgentStore((state) => state.addContext)
  const contextBusy = useContextAgentStore((state) => state.busy)
  const profileLocation = useDiscoverProfile().location
  const saveSearch = () => void addContext({
    kind: 'search', title: query,
    text: searchMarkdown({ query, turns: run.turns, answer: run.agent.text, citations: run.agent.citations,
      results: mergedWebResults(run).slice(0, 10) }),
  })

  const fire = useCallback(() => {
    const profile = getDiscoverProfile()
    start(query, level, {
      country: profile.country,
      ...(profile.location ? { location: { location: profile.location } } : {}),
    })
  }, [query, level, start])

  const handleFollowUp = useCallback(
    async (message: string) => {
      const profile = getDiscoverProfile()
      await sendFollowUp(message, {
        country: profile.country,
        ...(profile.location ? { location: { location: profile.location } } : {}),
      })
    },
    [sendFollowUp],
  )

  // The run lives in the store, not the page: coming back to this tab shows it as it is
  // (finished, or still streaming) instead of searching again. Only a new query or level,
  // or a run that never got going (fatal), starts one.
  useEffect(() => {
    const stored = useSearchResultsStore.getState()
    if (stored.runKey !== searchRunKey(query, level) || stored.fatal) fire()
  }, [fire, query, level])

  /** Switch tabs from inside a panel and keep keyboard focus on the tab row. */
  const openTab = useCallback((tab: SearchTab) => {
    setActiveTab(tab)
    document.getElementById(lensTabId(tab))?.focus()
  }, [])
  const openWeb = useCallback(() => openTab('web'), [openTab])

  const levelIndex = SEARCH_LEVELS.indexOf(level)
  const deeperLevel: SearchLevel | undefined = levelIndex >= 0 ? SEARCH_LEVELS[levelIndex + 1] : undefined
  const searchDeeper = deeperLevel && window.electron?.browser?.navigate
    ? {
        label: `Search deeper (${levelLabel(deeperLevel)})`,
        onClick: () => {
          window.electron.browser.navigate(buildSearchRonUrl(query, deeperLevel))
            .catch((error: unknown) => console.error('Search deeper failed:', error))
        },
      }
    : null

  const updatePlacesLocation = useCallback((location: string) => {
    useDiscoverProfileStore.getState().setOverride('location', location)
    const profile = getDiscoverProfile()
    void refreshPlaces(query, { country: profile.country, location: profile.location })
  }, [query, refreshPlaces])

  const hue = tabHue(activeTab)

  const lenses = useMemo<Record<SearchTab, LensState>>(() => {
    const sectionLens = (kind: 'news' | 'videos' | 'places'): LensState => {
      const section = run.sections[kind]
      if (!section) return { status: 'pending', count: null }
      if (section.status === 'error') return { status: 'error', count: null }
      return { status: 'done', count: sectionItems(run, kind).length }
    }
    const webSection = run.sections.web
    const webCount = run.sections.web || run.agent.sources.length ? mergedWebResults(run).length : null
    const imagesSection = run.sections.images
    const imageCount = imagesSection || run.agent.images.length ? mergedImages(run).length : null
    return {
      agent: {
        status: run.agent.status === 'idle' ? 'pending' : run.agent.status,
        count: run.agent.citations.length || null,
      },
      web: {
        status: !webSection && run.agent.status !== 'done' && run.agent.status !== 'error'
          ? (run.agent.sources.length ? 'streaming' : 'pending')
          : webSection?.status === 'error' && run.agent.status === 'error'
            ? 'error'
            : run.agent.status === 'streaming' ? 'streaming' : 'done',
        count: webCount,
      },
      local: sectionLens('places'),
      news: sectionLens('news'),
      images: {
        status: !imagesSection && !run.agent.images.length
          ? 'pending'
          : imagesSection?.status === 'error' && run.agent.status === 'error'
            ? 'error'
            : run.agent.status === 'streaming' ? 'streaming' : imagesSection?.status === 'error' ? 'error' : 'done',
        count: imageCount,
      },
      videos: sectionLens('videos'),
      shopping: {
        status: run.shopping.status === 'idle' ? 'pending' : run.shopping.status,
        count: run.shopping.sources.length || null,
      },
    }
  }, [run])

  return (
    <div className="relative min-h-full bg-surface-0 dark:bg-surface-900">
      <SearchBackdrop hue={hue} />

      <SearchHeader
        query={query}
        level={level}
        model={run.meta?.model ?? null}
        hue={hue}
        isRunning={isRunning}
        startedAt={startedAt}
        durationMs={run.durationMs}
        onBack={onBack}
        onRefresh={fire}
      />

      <div className="relative z-10 mx-auto flex max-w-6xl px-6 pt-5 sm:px-10">
        <button
          type="button"
          onClick={saveSearch}
          disabled={(isRunning && !run.agent.text) || Boolean(contextBusy)}
          title="Save this search, its answer and top results to Ren’s context"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-surface-200 bg-surface-0 px-3 text-[12.5px] font-medium text-ink-secondary transition-colors duration-150 hover:border-surface-300 hover:text-ink disabled:pointer-events-none disabled:opacity-40 dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse-secondary dark:hover:border-surface-700 dark:hover:text-ink-inverse"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          Add search to Ren context
        </button>
      </div>

      <LensBar active={activeTab} onChange={setActiveTab} lenses={lenses} />

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-8 sm:px-10">
        {fatal ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto flex max-w-md flex-col items-center py-24 text-center"
            role="alert"
          >
            <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-danger dark:bg-red-950/40">
              <SearchX className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <p className="mt-4 font-display text-xl font-bold tracking-[-0.02em] text-ink dark:text-ink-inverse">Search couldn’t run</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">{fatal.message}</p>
            <span className="mt-3 inline-flex h-6 items-center rounded-full bg-surface-100 px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary">
              {fatal.code}
            </span>
            <button
              type="button"
              onClick={fire}
              className="mt-6 inline-flex h-9 items-center gap-1.5 rounded-lg bg-blurple-600 px-3.5 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-blurple-700 active:bg-blurple-800 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300"
            >
              <RotateCw className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              Try again
            </button>
          </motion.div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={PANEL_KEY[activeTab]}
              id={lensPanelId(activeTab)}
              role="tabpanel"
              aria-labelledby={lensTabId(activeTab)}
              tabIndex={-1}
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="focus:outline-none"
            >
              {activeTab === 'agent' && (
                <AgentAnswer
                  run={run.agent}
                  turns={run.turns}
                  activeQuestion={run.activeQuestion}
                  effort={run.effort}
                  hue={hue}
                  onRetry={fire}
                  onFollowUp={handleFollowUp}
                  onCancel={cancel}
                  followUpLoading={followUpLoading}
                />
              )}
              {activeTab === 'web' && (
                <WebResults state={run} hue={hue} onRetry={fire} onOpenAnswer={() => openTab('agent')} deeper={searchDeeper} />
              )}
              {activeTab === 'local' && (
                <LocalResults
                  state={run}
                  hue={hue}
                  onRetry={fire}
                  location={profileLocation}
                  onLocationChange={updatePlacesLocation}
                />
              )}
              {activeTab === 'news' && <NewsResults state={run} onRetry={fire} onOpenWeb={openWeb} />}
              {activeTab === 'images' && <ImageMasonry state={run} hue={hue} onRetry={fire} />}
              {activeTab === 'videos' && <VideoResults state={run} onRetry={fire} />}
              {activeTab === 'shopping' && (
                <ShoppingResults
                  run={run.shopping}
                  places={sectionItems(run, 'places')}
                  hue={hue}
                  onRetry={fire}
                  onOpenWeb={openWeb}
                />
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </main>
    </div>
  )
}

export default SearchResultsPage
