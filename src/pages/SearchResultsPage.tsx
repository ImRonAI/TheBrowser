/**
 * Search Results Page — "Assembly"
 *
 * One query fans out to seven sources (Brave web/news/videos/images/places at maximum
 * counts + the Perplexity Agent API at the chosen depth + a domain-restricted shopping
 * agent) and the page assembles itself live around the results:
 *
 * - The Lens Bar: a floating, hue-keyed tab control with live counts and per-source
 *   status pips (AI Agent / Web / Local / News / Images / Videos / Shopping).
 * - The Web tab ranks by provenance: Consensus (agent ∩ Brave) first, then Agent
 *   picks, then the full breadth of Brave.
 * - The whole page quietly re-tints to whichever lens is active.
 *
 * Route: ron://search?q=<query>&level=<fast|low|medium|high|xhigh>
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
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
import { LensBar, type LensState } from '@/components/search/LensBar'
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

      <LensBar active={activeTab} onChange={setActiveTab} lenses={lenses} />

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-8">
        {fatal ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto flex max-w-md flex-col items-center py-24 text-center"
          >
            <SearchX className="h-8 w-8 text-ink-muted/50 dark:text-ink-inverse-muted/50" strokeWidth={1.5} />
            <p className="mt-4 text-lg font-light text-ink dark:text-ink-inverse">Search couldn't run</p>
            <p className="mt-1 text-sm font-light text-ink-muted dark:text-ink-inverse-muted">{fatal.message}</p>
            <span className="mt-2 rounded bg-surface-100 px-2 py-0.5 font-mono text-[10px] uppercase text-ink-muted dark:bg-surface-800 dark:text-ink-inverse-muted">
              {fatal.code}
            </span>
            <button
              onClick={fire}
              className={cn(
                'mt-6 rounded-xl px-5 py-2 text-sm font-light text-white',
                'bg-gradient-to-r from-accent-indigo to-accent-light shadow-glow-accent',
                'transition-transform hover:scale-[1.03] active:scale-[0.98]',
              )}
            >
              Try again
            </button>
          </motion.div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={PANEL_KEY[activeTab]}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              {activeTab === 'agent' && <AgentAnswer run={run.agent} hue={hue} onRetry={fire} />}
              {activeTab === 'web' && <WebResults state={run} hue={hue} onRetry={fire} />}
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
