import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { useDiscoverProfile } from '@/stores/discoverProfileStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { KanbanBoard, CalendarView } from '@/components/board'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { BuildWorkbenchPage } from '@/components/build'
import { SuperAgentInterface } from '@/components/superagent/SuperAgentInterface'
import { InterestsPreviewModal } from '@/components/interests/InterestInteraction'
import { plainDescription, type Story } from '@/lib/articles'
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
  const profile = useDiscoverProfile()
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('week')
  const topics = profile.topics.slice(0, 4)
  return <div className="h-full overflow-auto bg-surface-0 text-ink dark:bg-surface-900 dark:text-ink-inverse">
    {activeTab === 'discover' && <DiscoverContent topics={topics} />}
    {activeTab === 'execute' && <ErrorBoundary componentName="KanbanBoard"><KanbanBoard /></ErrorBoundary>}
    {activeTab === 'calendar' && <CalendarView mode={calendarMode} onModeChange={setCalendarMode} />}
    {activeTab === 'vibe' && <ErrorBoundary componentName="SuperAgentInterface"><SuperAgentInterface /></ErrorBoundary>}
    {activeTab === 'build' && <BuildWorkbenchPage />}
  </div>
}

interface SearchDataset { results?: SearchResult[]; web?: { results?: SearchResult[] } }
interface SearchResult { title?: string; url?: string; description?: string; age?: string; thumbnail?: { src?: string }; meta_url?: { hostname?: string } }
const TOPIC_GROUPS: Story[][] = [
  { data: videoData, topic: 'AI & moving images' }, { data: billsData, topic: 'On the field' },
  { data: rollercoastData, topic: 'The thrill of it' }, { data: recipesData, topic: 'At the table' },
  { data: travelData, topic: 'Somewhere new' }, { data: localData, topic: 'Closer to home' },
  { data: umData, topic: 'Health & discovery' },
].map(({ data, topic }) => {
  const dataset = data as SearchDataset
  return (dataset.results || dataset.web?.results || []).filter((result) => result.title && /^https?:\/\//.test(result.url || '')).map((result) => ({
    title: result.title!, url: result.url!, description: plainDescription(result.description || ''), age: result.age || '', topic,
    hostname: result.meta_url?.hostname || new URL(result.url!).hostname, thumbnail: result.thumbnail?.src || '',
  }))
}).filter((group) => group.length > 0)

function StoryCard({ story, featured, onRead }: { story: Story; featured: boolean; onRead: () => void }) {
  const [imageFailed, setImageFailed] = useState(false)
  return <button onClick={onRead} className="group flex h-full w-full flex-col text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500">
    <div className={`relative w-full overflow-hidden rounded-xl bg-surface-100 dark:bg-surface-800 ${featured ? 'aspect-[16/10]' : 'aspect-[16/9]'}`}>
      {!imageFailed && story.thumbnail ? <img src={story.thumbnail} alt="" loading={featured ? 'eager' : 'lazy'} onError={() => setImageFailed(true)} className="h-full w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-[1.03]" /> :
        <div className="flex h-full items-center justify-center bg-gradient-to-br from-indigo-100 to-surface-100 p-6 dark:from-indigo-950 dark:to-surface-800"><span className="font-display text-3xl text-indigo-500/60">{story.topic}</span></div>}
      <span className="absolute bottom-3 left-3 rounded-full bg-white/95 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-ink">{story.topic}</span>
    </div>
    <div className="flex flex-1 flex-col pt-4">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-ink-muted dark:text-ink-inverse-muted">{story.hostname}{story.age ? ` · ${story.age}` : ''}</p>
      <h3 className={`line-clamp-3 font-display leading-tight tracking-tight transition-colors group-hover:text-indigo-600 dark:group-hover:text-indigo-300 ${featured ? 'text-3xl lg:text-4xl' : 'text-xl'}`}>{story.title}</h3>
      <p className={`mt-3 text-sm leading-relaxed text-ink-muted dark:text-ink-inverse-muted ${featured ? 'line-clamp-3' : 'line-clamp-2'}`}>{story.description}</p>
      <span className="mt-auto flex items-center gap-2 pt-5 text-xs font-semibold text-indigo-600 dark:text-indigo-300">Read story <ArrowRight size={14} /></span>
    </div>
  </button>
}

function DiscoverContent({ topics }: { topics: string[] }) {
  const reducedMotion = useReducedMotion()
  const [indices, setIndices] = useState(() => TOPIC_GROUPS.map(() => 0))
  const [paused, setPaused] = useState(true)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(document.hidden)
  const [story, setStory] = useState<Story | null>(null)
  const cycle = (slot: number, direction = 1) => setIndices((current) => current.map((value, index) => index === slot ? (value + direction + TOPIC_GROUPS[index].length) % TOPIC_GROUPS[index].length : value))
  useEffect(() => {
    const update = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  useEffect(() => {
    if (paused || hovered || focused || hidden || story || reducedMotion) return
    const timer = setInterval(() => setIndices((current) => current.map((value, index) => (value + 1) % TOPIC_GROUPS[index].length)), 14000)
    return () => clearInterval(timer)
  }, [paused, hovered, focused, hidden, story, reducedMotion])
  return <main className="mx-auto max-w-7xl px-5 pb-24 pt-8 sm:px-10">
    <header className="mb-8 border-b border-surface-200 pb-7 dark:border-surface-700">
      <div className="mb-4 flex items-center justify-between gap-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-muted dark:text-ink-inverse-muted"><span>Ron / Discover</span><span>Selected for the curious</span></div>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div><h1 className="font-display text-4xl tracking-tight sm:text-5xl">A little more perspective.</h1><p className="mt-3 text-sm text-ink-muted dark:text-ink-inverse-muted">Your interests, worth a closer look. Read something. Make something of it.</p></div>
        <button onClick={() => setPaused((value) => !value)} disabled={Boolean(reducedMotion)} aria-pressed={!paused && !reducedMotion} className="flex items-center gap-2 rounded-full border border-surface-200 px-4 py-2 text-xs hover:bg-surface-100 disabled:opacity-50 dark:border-surface-700 dark:hover:bg-surface-800">{paused || reducedMotion ? <Play size={12} /> : <Pause size={12} />}{paused || reducedMotion ? 'Auto-play off' : 'Pause stories'}</button>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">{topics.map((topic) => <span key={topic} className="rounded-full bg-surface-100 px-3 py-1 text-[11px] text-ink-muted dark:bg-surface-800 dark:text-ink-inverse-muted">{topic}</span>)}</div>
    </header>
    <section aria-label="Stories by interest" className="grid grid-cols-1 gap-x-7 gap-y-9 md:grid-cols-2 xl:grid-cols-3" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
      {TOPIC_GROUPS.map((group, slot) => <div key={group[0].topic} className={slot === 0 ? 'md:col-span-2 xl:col-span-2 xl:row-span-2' : ''}>
        <div className={`overflow-hidden ${slot === 0 ? 'min-h-[500px]' : 'min-h-[340px]'}`}>
          <AnimatePresence mode="wait" initial={false}><motion.div key={indices[slot]} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.2 }}>
            <StoryCard story={group[indices[slot]]} featured={slot === 0} onRead={() => setStory(group[indices[slot]])} />
          </motion.div></AnimatePresence>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-surface-200 pt-3 text-[10px] uppercase tracking-wider text-ink-muted dark:border-surface-700 dark:text-ink-inverse-muted"><span>{String(indices[slot] + 1).padStart(2, '0')} / {group.length} in {group[0].topic}</span><div className="flex gap-1"><button aria-label={`Previous ${group[0].topic} story`} onClick={() => cycle(slot, -1)} className="rounded p-2 hover:bg-surface-100 dark:hover:bg-surface-800"><ChevronLeft size={14} /></button><button aria-label={`Next ${group[0].topic} story`} onClick={() => cycle(slot)} className="rounded p-2 hover:bg-surface-100 dark:hover:bg-surface-800"><ChevronRight size={14} /></button></div></div>
      </div>)}
    </section>
    <InterestsPreviewModal isOpen={Boolean(story)} story={story} onClose={() => setStory(null)} />
  </main>
}