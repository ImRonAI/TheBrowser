import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Pause, Play, RefreshCw, Sparkles } from 'lucide-react'
import { useDiscoverProfile } from '@/stores/discoverProfileStore'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useDiscoverFeedStore } from '@/stores/discoverFeedStore'
import { useInterestsStore } from '@/stores/interestsStore'
import { useTabStore } from '@/stores/tabStore'
import { failedSections, formatRelative, richAnswers, sectionsToStoryGroups } from '@/lib/discover-feed'
import { RichAnswerCard } from '@/components/home/RichAnswerCard'
import { StoryCard } from '@/components/home/StoryCard'
import { FavoriteLinks } from '@/components/home/FavoriteLinks'
import { useNavigationStore } from '@/stores/navigationStore'
import { KanbanBoard, CalendarView } from '@/components/board'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { BuildWorkbenchPage } from '@/components/build'
import { SuperAgentInterface } from '@/components/superagent/SuperAgentInterface'
import { plainDescription, readStoryUrl, type Story } from '@/lib/articles'
import {
  ROTATE_EVERY_MS, cardTilt, hashString, nextSlotToRotate, pickAnimation, stickerHue, swapVariants,
  type SwapAnimationName, type SwapCustom, type SwapDirection,
} from '@/lib/story-animations'
import { cn } from '@/utils/cn'
import billsData from '../../data/bills.json'
import rollercoastData from '../../data/rollercoast.json'
import travelData from '../../data/travel.json'
import recipesData from '../../data/recipes.json'
import videoData from '../../data/video.json'
import umData from '../../data/um.json'
import localData from '../../data/local.json'

type CalendarMode = 'day' | 'week' | 'month' | 'quarter'
export function HomePage() {
  const activeTab = useNavigationStore((state) => state.activeTab)
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('week')
  return <div className="glass-page h-full overflow-auto bg-surface-0 text-ink dark:bg-surface-900 dark:text-ink-inverse">
    {activeTab === 'discover' && <ErrorBoundary componentName="Discover"><DiscoverContent /></ErrorBoundary>}
    {activeTab === 'execute' && <ErrorBoundary componentName="KanbanBoard"><KanbanBoard /></ErrorBoundary>}
    {activeTab === 'calendar' && <CalendarView mode={calendarMode} onModeChange={setCalendarMode} />}
    {activeTab === 'vibe' && <ErrorBoundary componentName="SuperAgentInterface"><SuperAgentInterface /></ErrorBoundary>}
    {activeTab === 'build' && <BuildWorkbenchPage />}
  </div>
}

interface SearchDataset { results?: SearchResult[]; web?: { results?: SearchResult[] } }
interface SearchResult { title?: string; url?: string; description?: string; age?: string; page_age?: string; thumbnail?: { src?: string }; meta_url?: { hostname?: string; favicon?: string } }
/** Bundled editorial datasets: shown until the Brave feed loads, and when the backend is unavailable. */
const FALLBACK_GROUPS: Story[][] = [
  { data: videoData, topic: 'AI & moving images' }, { data: billsData, topic: 'On the field' },
  { data: rollercoastData, topic: 'The thrill of it' }, { data: recipesData, topic: 'At the table' },
  { data: travelData, topic: 'Somewhere new' }, { data: localData, topic: 'Closer to home' },
  { data: umData, topic: 'Health & discovery' },
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

function DiscoverContent() {
  const reducedMotion = useReducedMotion()
  const profile = useDiscoverProfile()
  const topics = profile.topics.slice(0, 4)
  const { sections, loading, error, fetchedAt, load } = useDiscoverFeedStore()
  const recordInteraction = useInterestsStore((state) => state.recordInteraction)
  const hasAnswers = useOnboardingStore((state) => state.answers.length > 0)
  const resetOnboarding = useOnboardingStore((state) => state.resetOnboarding)
  // Re-run the interview: clear answers, then route via #onboarding (App.tsx shows the page for guests too).
  const personalize = () => { resetOnboarding(); window.location.hash = '#onboarding' }
  useEffect(() => { void load(profile) }, [profile, load])
  const liveGroups = useMemo(() => sectionsToStoryGroups(sections), [sections])
  const groups = liveGroups.length ? liveGroups : FALLBACK_GROUPS
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
    : error.code === 'unreachable' ? 'Live feed off: the Ron API is not running.' : `Live feed error: ${error.message}`)
    : loading && !live ? 'Loading your feed…' : live && fetchedAt ? `Updated ${formatRelative(fetchedAt)}` : ''
  return <main className="mx-auto max-w-7xl px-6 pb-24 pt-10 sm:px-10">
    <header className="mb-8 border-b border-surface-200/80 pb-7 dark:border-surface-800">
      <div className="mb-5 flex items-center justify-between gap-4 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted dark:text-ink-inverse-muted"><span>Ron <span aria-hidden className="mx-1 opacity-50">/</span> Discover</span><span className="flex items-center gap-1.5">{live && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />}{live ? 'Live from your interests' : 'Selected for the curious'}</span></div>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div><h1 className="font-display text-[2.6rem] font-normal leading-[1.05] tracking-[-0.02em] sm:text-[3.25rem]">A little more <em className="italic">perspective.</em></h1><p className="mt-3 max-w-md text-[14px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">Your interests, worth a closer look. Read something. Make something of it.</p></div>
        <div className="flex items-center gap-2">
          <button onClick={personalize} aria-label={hasAnswers ? 'Redo the interests interview' : 'Personalize your feed'} className="flex h-8 items-center gap-1.5 rounded-lg border border-surface-200 px-3 text-[12.5px] font-medium text-ink-secondary transition-colors hover:border-surface-300 hover:bg-surface-50 hover:text-ink disabled:opacity-50 dark:border-surface-800 dark:text-ink-inverse-secondary dark:hover:border-surface-700 dark:hover:bg-surface-850 dark:hover:text-ink-inverse"><Sparkles size={13} strokeWidth={1.75} />{hasAnswers ? 'Redo interview' : 'Personalize'}</button>
          <button onClick={() => void load(profile, { force: true })} disabled={loading} aria-label="Refresh feed" className="flex h-8 items-center gap-1.5 rounded-lg border border-surface-200 px-3 text-[12.5px] font-medium text-ink-secondary transition-colors hover:border-surface-300 hover:bg-surface-50 hover:text-ink disabled:opacity-50 dark:border-surface-800 dark:text-ink-inverse-secondary dark:hover:border-surface-700 dark:hover:bg-surface-850 dark:hover:text-ink-inverse"><RefreshCw size={13} strokeWidth={1.75} className={loading ? 'animate-spin' : ''} />Refresh</button>
          <button onClick={() => setPaused((value) => !value)} disabled={Boolean(reducedMotion)} aria-pressed={!paused && !reducedMotion} className="flex h-8 items-center gap-1.5 rounded-lg border border-surface-200 px-3 text-[12.5px] font-medium text-ink-secondary transition-colors hover:border-surface-300 hover:bg-surface-50 hover:text-ink disabled:opacity-50 dark:border-surface-800 dark:text-ink-inverse-secondary dark:hover:border-surface-700 dark:hover:bg-surface-850 dark:hover:text-ink-inverse">{paused || reducedMotion ? <Play size={13} strokeWidth={1.75} /> : <Pause size={13} strokeWidth={1.75} />}{paused || reducedMotion ? 'Auto-play off' : 'Pause stories'}</button>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {topics.map((topic) => <span key={topic} className="rounded-md border border-surface-200 px-2.5 py-1 text-[12px] text-ink-secondary dark:border-surface-800 dark:text-ink-inverse-secondary">{topic}</span>)}
        {profile.location && <span className="rounded-md border border-surface-200 px-2.5 py-1 text-[12px] text-ink-secondary dark:border-surface-800 dark:text-ink-inverse-secondary">{profile.location}</span>}
        {status && <span role="status" className="ml-auto text-[11px] text-ink-muted dark:text-ink-inverse-muted">{status}</span>}
      </div>
    </header>
    <FavoriteLinks />
    {answers.length > 0 && <section aria-label="At a glance" className="mb-10 flex gap-4 overflow-x-auto pb-2 scrollbar-thin">{answers.map((answer, index) => <RichAnswerCard key={`${answer.subtype}-${index}`} answer={answer} />)}</section>}
    {failed.length > 0 && <p className="mb-6 text-[11px] text-ink-muted dark:text-ink-inverse-muted">Couldn’t load {failed.map((section) => `${section.q || section.kind}${section.error?.code === 'not_in_plan' ? ' (not in plan)' : ''}`).join(', ')}.</p>}
    <section aria-label="Stories by interest" className="grid grid-cols-1 gap-x-6 gap-y-10 md:grid-cols-2 xl:grid-cols-3" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
      {groups.map((group, slot) => {
        const story = group[at(slot)]
        const featured = slot === 0
        const custom: SwapCustom = { name: swaps[slot]?.name ?? 'fall', direction: swaps[slot]?.direction ?? 1, reducedMotion: Boolean(reducedMotion) }
        return <div key={group[0].topic} className={cn('[perspective:1200px]', featured && 'md:col-span-2 xl:col-span-2')}>
          <div className={cn('relative', featured ? 'h-[268px]' : 'h-[136px]')}>
            <AnimatePresence mode="wait" initial={false} custom={custom}>
              <motion.div key={story.url} custom={custom} variants={swapVariants} initial="initial" animate="animate" exit="exit"
                style={{ transformStyle: 'preserve-3d' }} data-swap-animation={custom.name} data-swap-direction={custom.direction} className="h-full will-change-transform">
                <StoryCard story={story} featured={featured} tilt={cardTilt(story.url)} hue={stickerHue(group[0].topic)} onRead={() => open(story)} />
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-ink-muted dark:text-ink-inverse-muted">
            <span><span className="font-mono font-medium tabular-nums text-ink-secondary dark:text-ink-inverse-secondary">{String(at(slot) + 1).padStart(2, '0')} / {group.length}</span> <span className="opacity-70">in {group[0].topic}</span></span>
            <div className="flex gap-1">
              <button aria-label={`Previous ${group[0].topic} story`} onClick={() => swap(slot, -1, slotAnimation(slot))} className="flex h-7 w-7 items-center justify-center rounded-md border border-surface-200 text-ink-secondary transition-colors hover:border-surface-300 hover:bg-surface-50 hover:text-ink dark:border-surface-800 dark:text-ink-inverse-secondary dark:hover:border-surface-700 dark:hover:bg-surface-850 dark:hover:text-ink-inverse"><ChevronLeft size={14} /></button>
              <button aria-label={`Next ${group[0].topic} story`} onClick={() => swap(slot, 1, slotAnimation(slot))} className="flex h-7 w-7 items-center justify-center rounded-md border border-surface-200 text-ink-secondary transition-colors hover:border-surface-300 hover:bg-surface-50 hover:text-ink dark:border-surface-800 dark:text-ink-inverse-secondary dark:hover:border-surface-700 dark:hover:bg-surface-850 dark:hover:text-ink-inverse"><ChevronRight size={14} /></button>
            </div>
          </div>
        </div>
      })}
    </section>
  </main>
}
