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
 * - One ember accent throughout; no per-lens tinting.
 *
 * Route: ron://search?q=<query>&level=<fast|low|medium|high|xhigh>
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { SearchX } from 'lucide-react'
import { useSearchResultsStore } from '@/stores/searchResultsStore'
import { getDiscoverProfile } from '@/stores/discoverProfileStore'
import {
  mergedImages,
  mergedWebResults,
  sectionItems,
  type SearchLevel,
} from '@/lib/search-api'
import { cn } from '@/utils/cn'
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
  const { run, isRunning, startedAt, fatal, start } = useSearchResultsStore()
  const [activeTab, setActiveTab] = useState<SearchTab>('agent')
  const reduced = useReducedMotion()

  const fire = useCallback(() => {
    const profile = getDiscoverProfile()
    start(query, level, {
      country: profile.country,
      ...(profile.location ? { location: { location: profile.location } } : {}),
    })
  }, [query, level, start])

  useEffect(() => {
    fire()
  }, [fire])

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
    <div className="glass-page relative min-h-full bg-surface-0 dark:bg-surface-900">
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

      <LensBar active={activeTab} onChange={setActiveTab} lenses={lenses} />

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-7 sm:px-10">
        {fatal ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto flex max-w-md flex-col items-center py-24 text-center"
            role="alert"
          >
            <SearchX className="h-7 w-7 text-ink-muted dark:text-ink-inverse-muted" strokeWidth={1.5} />
            <p className="mt-4 font-display text-2xl text-ink dark:text-ink-inverse">Search couldn’t run</p>
            <p className="mt-1.5 text-[13.5px] text-ink-muted dark:text-ink-inverse-muted">{fatal.message}</p>
            <span className="mt-2 rounded bg-surface-100 px-2 py-0.5 font-mono text-[10px] uppercase text-ink-muted dark:bg-surface-800 dark:text-ink-inverse-muted">
              {fatal.code}
            </span>
            <button
              onClick={fire}
              className={cn(
                'mt-6 h-9 rounded-lg px-4 text-[13px] font-medium transition-colors',
                'bg-ink text-surface-0 hover:bg-ink/85 dark:bg-ink-inverse dark:text-surface-900 dark:hover:bg-ink-inverse/85',
              )}
            >
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
              {activeTab === 'agent' && <AgentAnswer run={run.agent} hue={hue} onRetry={fire} />}
              {activeTab === 'web' && <WebResults state={run} hue={hue} onRetry={fire} onOpenAnswer={() => setActiveTab('agent')} />}
              {activeTab === 'local' && <LocalResults state={run} hue={hue} onRetry={fire} />}
              {activeTab === 'news' && <NewsResults state={run} onRetry={fire} />}
              {activeTab === 'images' && <ImageMasonry state={run} hue={hue} onRetry={fire} />}
              {activeTab === 'videos' && <VideoResults state={run} onRetry={fire} />}
              {activeTab === 'shopping' && <ShoppingResults run={run.shopping} hue={hue} onRetry={fire} />}
            </motion.div>
          </AnimatePresence>
        )}
      </main>
    </div>
  )
}

export default SearchResultsPage
