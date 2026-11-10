import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronLeft, ChevronRight, MapPin, Pause, Play, RefreshCw, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import { Marker } from '@/components/brand'
import { useDiscoverProfile } from '@/stores/discoverProfileStore'
import { discoverTopics } from '@/lib/context-api'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { STORY_GRID_SLOTS } from '@/lib/discover-profile'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useDiscoverFeedStore } from '@/stores/discoverFeedStore'
import { useInterestsStore } from '@/stores/interestsStore'
import { useTabStore } from '@/stores/tabStore'
import { failedSections, formatRelative, richAnswers, sectionsToStoryGroups } from '@/lib/discover-feed'
import { RichAnswerCard } from '@/components/home/RichAnswerCard'
import { StoryCard, STORY_CARD_HEIGHT, type StoryCardSize } from '@/components/home/StoryCard'
import { FavoriteLinks } from '@/components/home/FavoriteLinks'
import { useNavigationStore } from '@/stores/navigationStore'
import { ExecutePage } from '@/pages/ExecutePage'
import { CalendarPage } from '@/pages/CalendarPage'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { BuildWorkbenchPage } from '@/components/build'
import { SuperAgentInterface } from '@/components/superagent/SuperAgentInterface'
import { plainDescription, readStoryUrl, type Story } from '@/lib/articles'
import {
  ROTATE_EVERY_MS, cardTilt, hashString, nextSlotToRotate, pickAnimation, stickerHue, swapVariants,
  type SwapAnimationName, type SwapCustom, type SwapDirection,
} from '@/lib/story-animations'
import { cn } from '@/utils/cn'
import aiData from '../../data/ai.json'
import billsData from '../../data/bills.json'
import rollercoastData from '../../data/rollercoast.json'
import travelData from '../../data/travel.json'
import recipesData from '../../data/recipes.json'
import videoData from '../../data/video.json'
import umData from '../../data/um.json'
import localData from '../../data/local.json'

export function HomePage() {
  const activeTab = useNavigationStore((state) => state.activeTab)
  return <div className="h-full overflow-auto bg-surface-0 text-ink dark:bg-surface-900 dark:text-ink-inverse">
    {activeTab === 'discover' && <ErrorBoundary componentName="Discover"><DiscoverContent /></ErrorBoundary>}
    {/* App routes 'execute' to ExecutePage directly; if HomePage is ever shown on that tab it renders the same real view. */}
    {activeTab === 'execute' && <ErrorBoundary componentName="ExecutePage"><ExecutePage /></ErrorBoundary>}
    {activeTab === 'calendar' && <ErrorBoundary componentName="Calendar"><CalendarPage /></ErrorBoundary>}
    {activeTab === 'vibe' && <ErrorBoundary componentName="SuperAgentInterface"><SuperAgentInterface /></ErrorBoundary>}
    {activeTab === 'build' && <BuildWorkbenchPage />}
  </div>
}

interface SearchDataset { results?: SearchResult[]; web?: { results?: SearchResult[] } }
interface SearchResult { title?: string; url?: string; description?: string; age?: string; page_age?: string; thumbnail?: { src?: string }; meta_url?: { hostname?: string; favicon?: string } }
/** Bundled editorial datasets: 8 groups to fill all 3 rows (2 + 3 + 3) of the desktop Discover grid. */
const FALLBACK_GROUPS: Story[][] = [
  { data: videoData, topic: 'AI & moving images' }, { data: billsData, topic: 'On the field' },
  { data: rollercoastData, topic: 'The thrill of it' }, { data: recipesData, topic: 'At the table' },
  { data: travelData, topic: 'Somewhere new' }, { data: localData, topic: 'Closer to home' },
  { data: umData, topic: 'Health & discovery' }, { data: aiData, topic: 'Artificial intelligence' },
].map(({ data, topic }) => {
  const dataset = data as SearchDataset
  return (dataset.results || dataset.web?.results || []).filter((result) => result.title && /^https?:\/\//.test(result.url || '')).map((result) => {
    const hostname = result.meta_url?.hostname || new URL(result.url!).hostname
    return {
      title: result.title!, url: result.url!, description: plainDescription(result.description || ''), age: result.age || '', topic,
      hostname, thumbnail: result.thumbnail?.src || '',
      source: hostname, favicon: result.meta_url?.favicon || '', published: result.page_age || '', kind: 'article' as const,
    }
  })
}).filter((group) => group.length > 0)

type SlotSwap = { name: SwapAnimationName; direction: SwapDirection }

const BUTTON = 'inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13px] font-semibold transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-40'
const BUTTON_PRIMARY = 'bg-blurple-600 text-white enabled:hover:bg-blurple-700 enabled:active:bg-blurple-800 dark:bg-blurple-400 dark:text-ink dark:enabled:hover:bg-blurple-300'
const BUTTON_SECONDARY = 'border border-surface-200 bg-surface-0 text-ink enabled:hover:bg-surface-50 dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:enabled:hover:bg-surface-850'
const ICON_BUTTON = 'flex h-8 w-8 items-center justify-center rounded-lg text-ink-secondary transition-colors duration-150 ease-out hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-850 dark:hover:text-ink-inverse'
const CHIP = 'inline-flex h-6 items-center gap-1 rounded-full bg-surface-100 px-2.5 text-[12px] font-medium text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary'
const MICRO = 'font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted'

/** A section's micro label on a hairline rule; decorative, the section itself carries the accessible name. */
function SectionRule({ label }: { label: string }) {
  return (
    <div aria-hidden className="mb-4 flex items-center gap-3">
      <span className={MICRO}>{label}</span>
      <span className="h-px flex-1 bg-surface-200 dark:bg-surface-800" />
    </div>
  )
}

function DiscoverContent() {
  const reducedMotion = useReducedMotion()
  const savedProfile = useDiscoverProfile()
  // Interests the Context Agent learned from browsing and saved context lead the feed (a string selector:
  // node positions change every animation frame, the topics do not).
  const learnedTopics = useInterestsStore((state) => discoverTopics(savedProfile.topics, state.nodes).join('\n'))
  const profile = useMemo(() => ({ ...savedProfile, topics: learnedTopics ? learnedTopics.split('\n') : savedProfile.topics }), [savedProfile, learnedTopics])
  const topics = profile.topics.slice(0, 7)
  const { sections, loading, error, fetchedAt, load } = useDiscoverFeedStore()
  const recordInteraction = useInterestsStore((state) => state.recordInteraction)
  const addContext = useContextAgentStore((state) => state.addContext)
  const hasAnswers = useOnboardingStore((state) => state.answers.length > 0)
  const resetOnboarding = useOnboardingStore((state) => state.resetOnboarding)
  // Re-run the interview: clear answers, then route via #onboarding (App.tsx shows the page for guests too).
  const personalize = () => { resetOnboarding(); window.location.hash = '#onboarding' }
  useEffect(() => { void load(profile) }, [profile, load])
  const liveGroups = useMemo(() => sectionsToStoryGroups(sections), [sections])
  const groups = useMemo(() => {
    if (!liveGroups.length) return FALLBACK_GROUPS.slice(0, STORY_GRID_SLOTS)
    if (liveGroups.length >= STORY_GRID_SLOTS) return liveGroups.slice(0, STORY_GRID_SLOTS)
    const usedTopics = new Set(liveGroups.map((g) => g[0]?.topic.toLowerCase()))
    const usedUrls = new Set(liveGroups.flatMap((g) => g.map((s) => s.url)))
    const padded = [...liveGroups]
    for (const fallback of FALLBACK_GROUPS) {
      if (padded.length >= STORY_GRID_SLOTS) break
      const topic = fallback[0]?.topic
      if (!topic || usedTopics.has(topic.toLowerCase())) continue
      const filtered = fallback.filter((s) => !usedUrls.has(s.url))
      if (filtered.length > 0) {
        usedTopics.add(topic.toLowerCase())
        padded.push(filtered)
      }
    }
    return padded
  }, [liveGroups])
  const answers = useMemo(() => richAnswers(sections), [sections])
  const failed = useMemo(() => failedSections(sections), [sections])
  const live = liveGroups.length > 0
  const [indices, setIndices] = useState<number[]>([])
  const [swaps, setSwaps] = useState<Record<number, SlotSwap>>({})
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(document.hidden)
  const lastSlot = useRef(-1)
  const tick = useRef(0)
  const at = (slot: number) => indices[slot] ?? 0
  const cycle = (slot: number, direction: SwapDirection) => setIndices((current) => groups.map((group, index) => index === slot ? ((current[index] ?? 0) + direction + group.length) % group.length : (current[index] ?? 0)))
  // Every swap remembers its motion so the arrows can replay it: next plays it forward, previous plays it in reverse.
  const swap = (slot: number, direction: SwapDirection, name: SwapAnimationName) => {
    setSwaps((current) => ({ ...current, [slot]: { name, direction } }))
    cycle(slot, direction)
  }
  const slotAnimation = (slot: number) => swaps[slot]?.name ?? pickAnimation(hashString(groups[slot]?.[0]?.topic ?? String(slot)))
  const open = (item: Story) => {
    recordInteraction(item.topic.replace(/ · Video$/, ''), 0.05)
    const target = readStoryUrl(item)
    const tabs = useTabStore.getState()
    if (tabs.activeTabId) tabs.updateTab(tabs.activeTabId, { url: target, title: item.title })
    void window.electron?.browser?.navigate(target)
  }
  useEffect(() => { setIndices([]); setSwaps({}) }, [groups])
  useEffect(() => {
    const update = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  // One box changes every five minutes, round-robin — never all slots at once.
  useEffect(() => {
    if (paused || hovered || focused || hidden || reducedMotion) return
    const timer = setInterval(() => {
      if (!groups.length) return
      const slot = nextSlotToRotate(lastSlot.current, groups.length)
      lastSlot.current = slot
      tick.current += 1
      swap(slot, 1, pickAnimation(tick.current * 7 + slot))
    }, ROTATE_EVERY_MS)
    return () => clearInterval(timer)
  }, [paused, hovered, focused, hidden, reducedMotion, groups])
  const status = error ? (error.code === 'not_configured' ? 'Live feed off: BRAVE_SEARCH_API_KEY is not set on the backend.'
    : error.code === 'unreachable' ? 'Live feed off: the Ren API is not running.' : `Live feed error: ${error.message}`)
    : loading && !live ? 'Loading your feed…' : live && fetchedAt ? `Updated ${formatRelative(fetchedAt)}` : ''
  return <main className="mx-auto max-w-7xl px-6 pb-24 pt-10 sm:px-10">
    <header className="mb-10 border-b border-surface-200 pb-8 dark:border-surface-800">
      <div className="mb-7 flex items-center justify-between gap-4">
        <span className="tag-label tag-label-slash">Discover</span>
        <span className={cn(MICRO, 'flex items-center gap-2')}>{live && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />}{live ? 'Live from your interests' : 'Selected for the curious'}</span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
        <div className="min-w-0 max-w-3xl">
          <h1 className="font-display text-display-md font-extrabold tracking-[-0.035em] text-ink sm:text-display-lg dark:text-ink-inverse">A little more <Marker>perspective</Marker>.</h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">Your interests, worth a closer look. Read something. Make something of it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={personalize} aria-label={hasAnswers ? 'Redo the interests interview' : 'Personalize your feed'} className={cn(BUTTON, hasAnswers ? BUTTON_SECONDARY : BUTTON_PRIMARY)}><SlidersHorizontal className="h-4 w-4" />{hasAnswers ? 'Redo interview' : 'Personalize'}</button>
          <button onClick={() => void load(profile, { force: true })} disabled={loading} aria-label="Refresh feed" className={cn(BUTTON, BUTTON_SECONDARY)}><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />Refresh</button>
          <button onClick={() => setPaused((value) => !value)} disabled={Boolean(reducedMotion)} aria-pressed={!paused && !reducedMotion} className={cn(BUTTON, BUTTON_SECONDARY)}>{paused || reducedMotion ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}{paused || reducedMotion ? 'Auto-play off' : 'Pause stories'}</button>
        </div>
      </div>
      <div className="mt-7 flex flex-wrap items-center gap-1.5">
        {topics.map((topic) => <span key={topic} className={CHIP}>{topic}</span>)}
        {profile.location && <span className={CHIP}><MapPin className="h-3 w-3" />{profile.location}</span>}
        {status && <span role="status" className={cn('ml-auto flex items-center gap-1.5 text-[12px]', error ? 'text-amber-800 dark:text-amber-300' : 'text-ink-muted dark:text-ink-inverse-muted')}>{error && <TriangleAlert className="h-3.5 w-3.5 shrink-0" />}{status}</span>}
      </div>
    </header>
    <FavoriteLinks />
    {/* At-a-glance cards fill the full content width: four across on desktop, every card stretched to the row's height. */}
    {answers.length > 0 && <section aria-label="At a glance" className="mb-12">
      <SectionRule label="At a glance" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{answers.map((answer, index) => <RichAnswerCard key={`${answer.subtype}-${index}`} answer={answer} />)}</div>
    </section>}
    {failed.length > 0 && <p className="mb-6 text-[12px] text-ink-muted dark:text-ink-inverse-muted">Couldn’t load {failed.map((section) => `${section.q || section.kind}${section.error?.code === 'not_in_plan' ? ' (not in plan)' : ''}`).join(', ')}.</p>}
    <SectionRule label="Stories by interest" />
    <section aria-label="Stories by interest" className="grid grid-cols-1 gap-x-6 gap-y-10 md:grid-cols-2 xl:grid-cols-3" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
      {groups.map((group, slot) => {
        const story = group[at(slot)]
        const featured = slot === 0
        // At xl the hero spans columns 1–2, so slot 1 shares its row: give it the hero's height instead of leaving a half-empty cell.
        const size: StoryCardSize = featured ? 'featured' : slot === 1 ? 'companion' : 'compact'
        const custom: SwapCustom = { name: swaps[slot]?.name ?? 'fall', direction: swaps[slot]?.direction ?? 1, reducedMotion: Boolean(reducedMotion) }
        return <div key={group[0].topic} className={cn('[perspective:1200px]', featured && 'md:col-span-2 xl:col-span-2')}>
          <div className={cn('relative', STORY_CARD_HEIGHT[size])}>
            <AnimatePresence mode="wait" initial={false} custom={custom}>
              <motion.div key={story.url} custom={custom} variants={swapVariants} initial="initial" animate="animate" exit="exit"
                style={{ transformStyle: 'preserve-3d' }} data-swap-animation={custom.name} data-swap-direction={custom.direction} className="h-full will-change-transform">
                <StoryCard story={story} featured={featured} size={size} tilt={cardTilt(story.url)} hue={stickerHue(group[0].topic)} onRead={() => open(story)} onAddContext={() => void addContext({ kind: 'article', url: story.url, title: story.title })} />
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-baseline gap-2 text-[12px] text-ink-muted dark:text-ink-inverse-muted"><span className="shrink-0 font-mono text-[11px] font-medium tabular-nums tracking-[0.04em]"><span className="text-ink dark:text-ink-inverse">{String(at(slot) + 1).padStart(2, '0')}</span> / {group.length}</span> <span className="truncate">in {group[0].topic}</span></span>
            <div className="flex shrink-0 gap-0.5">
              <button aria-label={`Previous ${group[0].topic} story`} onClick={() => swap(slot, -1, slotAnimation(slot))} className={ICON_BUTTON}><ChevronLeft className="h-4 w-4" /></button>
              <button aria-label={`Next ${group[0].topic} story`} onClick={() => swap(slot, 1, slotAnimation(slot))} className={ICON_BUTTON}><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      })}
    </section>
  </main>
}
