import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import { useAuthStore } from '@/stores/authStore'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { KanbanBoard, CalendarView } from '@/components/board'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { BuildWorkbenchPage } from '@/components/build'
import { SuperAgentInterface } from '@/components/superagent/SuperAgentInterface'

// Import Brave Search JSON data
import billsData from '../../data/bills.json'
import rollercoastData from '../../data/rollercoast.json'
import travelData from '../../data/travel.json'
import recipesData from '../../data/recipes.json'
import videoData from '../../data/video.json'
import umData from '../../data/um.json'
import localData from '../../data/local.json'

import { InterestsPreviewModal } from '@/components/interests/InterestInteraction'


type CalendarMode = 'day' | 'week' | 'month' | 'quarter'

// Sophisticated easing curve
const EASE = [0.16, 1, 0.3, 1] as const

export function HomePage() {
  useAuthStore() // Auth state available if needed
  const { answers } = useOnboardingStore() || { answers: [] }
  const { activeTab } = useNavigationStore()
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('week')

  // Derive interests from onboarding answers
  const interests = answers?.find(a => a.question.includes('topics'))?.answer || 'Technology, AI, Design'
  const topics = interests.split(',').map(t => t.trim()).slice(0, 4)

  return (
    <div className="h-full flex flex-col bg-surface-0 dark:bg-surface-900 relative overflow-hidden">
      {/* Sophisticated background treatment */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {/* Light mode - subtle geometric accents */}
        <div className="dark:hidden">
          <div 
            className="absolute top-0 right-0 w-[600px] h-[600px] bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.04)_0%,transparent_50%)]"
          />
          <div 
            className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-[radial-gradient(circle_at_bottom_left,rgba(55,48,163,0.03)_0%,transparent_50%)]"
          />
          {/* Subtle grid */}
          <div 
            className="absolute inset-0 opacity-[0.02] bg-[linear-gradient(rgba(0,0,0,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.1)_1px,transparent_1px)] bg-[length:48px_48px]"
          />
        </div>
        
        {/* Dark mode - dramatic gradient */}
        <div className="hidden dark:block">
        <motion.div
            className="absolute top-1/4 right-1/4 w-[500px] h-[500px] rounded-full"
          style={{
              background: 'radial-gradient(circle, rgba(99, 102, 241, 0.06) 0%, transparent 60%)',
              filter: 'blur(80px)',
          }}
          animate={{
              x: [0, 20, 0],
              y: [0, -15, 0],
          }}
          transition={{
              duration: 25,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
        <motion.div
            className="absolute bottom-1/4 left-1/4 w-[400px] h-[400px] rounded-full"
          style={{
              background: 'radial-gradient(circle, rgba(76, 29, 149, 0.05) 0%, transparent 60%)',
              filter: 'blur(80px)',
          }}
          animate={{
              x: [0, -20, 0],
              y: [0, 15, 0],
          }}
          transition={{
              duration: 30,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
        </div>
      </div>

      {/* Content Section - No more duplicate tabs */}
      <div className="flex-1 overflow-hidden z-10">
        <LayoutGroup>
          <AnimatePresence mode="wait" initial={false}>
            {activeTab === 'discover' && (
              <motion.div
                key="discover"
                initial={{ opacity: 0, scale: 0.98, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: -20 }}
                transition={{ duration: 0.5, ease: EASE }}
                className="h-full px-8 pb-12 overflow-auto scrollbar-thin"
              >
                <DiscoverContent topics={topics} />
              </motion.div>
            )}
            {activeTab === 'execute' && (
              <motion.div
                key="execute"
                initial={{ opacity: 0, scale: 0.98, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: -20 }}
                transition={{ duration: 0.5, ease: EASE }}
                className="h-full px-8 pb-8"
              >
                <ErrorBoundary componentName="KanbanBoard">
                  <KanbanBoard />
                </ErrorBoundary>
              </motion.div>
            )}
            {activeTab === 'calendar' && (
              <motion.div
                key="calendar"
                initial={{ opacity: 0, scale: 0.98, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: -20 }}
                transition={{ duration: 0.5, ease: EASE }}
                className="h-full px-8 pb-8"
              >
                <CalendarView mode={calendarMode} onModeChange={setCalendarMode} />
              </motion.div>
            )}
            {activeTab === 'vibe' && (
              <motion.div
                key="vibe"
                initial={{ opacity: 0, scale: 0.98, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: -20 }}
                transition={{ duration: 0.5, ease: EASE }}
                className="h-full"
              >
                <ErrorBoundary componentName="SuperAgentInterface">
                  <SuperAgentInterface />
                </ErrorBoundary>
              </motion.div>
            )}
            {activeTab === 'build' && (
              <motion.div
                key="build"
                initial={{ opacity: 0, scale: 0.98, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: -20 }}
                transition={{ duration: 0.5, ease: EASE }}
                className="h-full"
              >
                <BuildWorkbenchPage />
              </motion.div>
            )}
          </AnimatePresence>
        </LayoutGroup>
      </div>
    </div>
  )
}



// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

// function VibePlaceholder() {
//   return (
//     <motion.div
//       initial={{ opacity: 0, scale: 0.9 }}
//       animate={{ opacity: 1, scale: 1 }}
//       className="text-center space-y-6"
//     >
//       <motion.div
//         className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center"
//         animate={{
//           y: [0, -8, 0],
//           rotate: [0, -3, 3, 0]
//         }}
//         transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
//       >
//         <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" className="w-12 h-12">
//           <path d="M9 18V5l12-2v13" />
//           <circle cx="6" cy="18" r="3" />
//           <circle cx="18" cy="16" r="3" />
//         </svg>
//       </motion.div>
//       <div>
//         <h2 className="text-display-sm font-display text-ink dark:text-ink-inverse">Vibe</h2>
//         <p className="text-body-md text-ink-muted dark:text-ink-inverse-muted mt-2">
//           Your personalized atmosphere
//         </p>
//       </div>
//     </motion.div>
//   )
// }

// ─────────────────────────────────────────────────────────────────────────────
// DISCOVER CONTENT - Curated content cards
// ─────────────────────────────────────────────────────────────────────────────
// INTERESTS DASHBOARD - Stories from Brave Search JSON files
// ─────────────────────────────────────────────────────────────────────────────
// DISCOVER CONTENT - Curated content cards
// ─────────────────────────────────────────────────────────────────────────────
// INTERESTS DASHBOARD - Stories from Brave Search JSON files
// ─────────────────────────────────────────────────────────────────────────────

interface Story {
  title: string
  url: string
  description: string
  age: string
  topic: string
  hostname: string
  thumbnail: string
}

// Build stories grouped by topic - each card shows ONE topic
function buildTopicGroups(): Story[][] {
  const datasets = [
    { data: videoData, topic: 'AI Video' }, // Slot 0: Video (Vertical)
    { data: billsData, topic: (billsData as any).query?.original || 'Bills' }, // Slot 1
    { data: rollercoastData, topic: (rollercoastData as any).query?.original || 'Rollercoasters' }, // Slot 2
    { data: recipesData, topic: (recipesData as any).query?.original || 'Recipes' }, // Slot 3
    { data: travelData, topic: (travelData as any).query?.original || 'Travel' }, // Slot 4
    { data: localData, topic: (localData as any).query?.original || 'Local' }, // Slot 5: Local (Wide)
    { data: umData, topic: (umData as any).query?.original || 'Health' }, // Slot 6: UM (Vertical) - NEW
  ]

  return datasets.map(({ data, topic }) => {
    const stories: Story[] = []
    // Handle nested results or web.results structure
    let results = (data as any).results || (data as any).web?.results || []
    
    // Quick normalize for different json shapes
    if (!Array.isArray(results) && (data as any).web?.results) {
        results = (data as any).web.results
    }
    
    for (const r of results) {
      if (r.thumbnail?.src) {
        stories.push({
          title: r.title || '',
          url: r.url || '',
          description: r.description || '',
          age: r.age || '',
          topic,
          hostname: r.meta_url?.hostname || '',
          thumbnail: r.thumbnail.src,
        })
      }
    }
    return stories
  })
}

const TOPIC_GROUPS = buildTopicGroups()
const ALL_STORIES = TOPIC_GROUPS.flat()

function StoryCard({ story, index, onCycle, onRead }: { story: Story; index: number; onCycle: () => void; onRead: (s: Story) => void }) {

  return (
    <motion.div
      key={story.url}
      initial={{ opacity: 0, y: -300, scale: 0.7, rotateX: -15 }}
      animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
      exit={{ opacity: 0, y: 400, scale: 0.6, rotateX: 15 }}
      transition={{
        type: "spring",
        stiffness: 35,
        damping: 10,
        mass: 2,
        delay: index * 0.5,
      }}
      className="relative w-full h-full cursor-pointer overflow-hidden rounded-2xl group"
      onClick={onCycle}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      {/* Background gradient fallback */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 via-purple-900 to-black" />

      {/* Image with smooth fade-in and hover zoom */}
      <motion.img
        key={story.thumbnail}
        src={story.thumbnail}
        alt={story.title}
        loading="eager"
        initial={{ opacity: 0, scale: 1.1 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8 }}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
        onError={(e) => { e.currentTarget.style.opacity = '0' }}
      />

      {/* Rich dark overlay for text readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/30" />

      {/* Content */}
      <div className="absolute inset-0 p-5 flex flex-col justify-between">
        <div className="flex items-start justify-between">
          <motion.span
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 + index * 0.08 }}
            className="px-3 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-widest bg-white/15 backdrop-blur-sm text-white border border-white/10"
          >
            {story.topic}
          </motion.span>
          <motion.span
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 + index * 0.08 }}
            className="px-2.5 py-1 rounded-full text-[9px] font-medium bg-black/40 backdrop-blur-sm text-white/90"
          >
            {story.age}
          </motion.span>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 + index * 0.08, duration: 0.5 }}
          className="space-y-3"
        >
          <h3 className="text-white font-semibold leading-tight text-body-lg line-clamp-2 drop-shadow-lg">
            {story.title}
          </h3>
          <p className="text-white/75 text-body-sm leading-relaxed line-clamp-2">
            {story.description}
          </p>
          <div className="flex items-center justify-between pt-2">
            <span className="text-[10px] text-white/50 font-medium">{story.hostname}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onRead(story) }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wide bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 transition-all duration-300 border border-white/10 hover:border-white/20"
            >
              Read
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
        </motion.div>
      </div>
    </motion.div>
  )
}

function DiscoverContent({ topics }: { topics: string[] }) {
  // Each card tracks which story index it's showing within its topic
  const [indices, setIndices] = useState<number[]>(() => TOPIC_GROUPS.map(() => 0))

  // Interaction State
  const [previewOpen, setPreviewOpen] = useState(false)
  const [selectedStory, setSelectedStory] = useState<Story | null>(null)

  const handleRead = (story: Story) => {
    setSelectedStory(story)
    setPreviewOpen(true)
  }

  // Cycle a single card to next story in its topic
  const cycleCard = useCallback((cardIndex: number) => {
    setIndices(prev => {
      const next = [...prev]
      if (cardIndex >= TOPIC_GROUPS.length) return next // Safety check
      const topicStories = TOPIC_GROUPS[cardIndex]
      if (topicStories.length === 0) return next
      next[cardIndex] = (next[cardIndex] + 1) % topicStories.length
      return next
    })
  }, [])

  // Staggered timers - each card cycles 12+ seconds apart from others
  useEffect(() => {
    const intervals: ReturnType<typeof setInterval>[] = []
    const timers = TOPIC_GROUPS.map((_, i) => {
      const timeout = setTimeout(() => {
        cycleCard(i)
        intervals.push(setInterval(() => cycleCard(i), 90000))
      }, i * 15000)
      return timeout
    })

    return () => {
      timers.forEach(clearTimeout)
      intervals.forEach(clearInterval)
    }
  }, [cycleCard])

  return (
    <div className="max-w-7xl mx-auto pt-8 pb-24 overflow-visible">
      <div className="flex items-center justify-between mb-10 px-4">
        <div>
          <h2 className="text-display-sm font-display text-ink dark:text-ink-inverse">
            Your Interests
          </h2>
          <p className="mt-1 text-body-sm text-ink-muted dark:text-ink-inverse-muted">
            {ALL_STORIES.length} stories • Click to cycle
          </p>
        </div>
        {topics.length > 0 && (
          <div className="flex gap-2">
            {topics.map((topic, i) => (
              <motion.span
                key={topic}
                initial={{ opacity: 0, scale: 0.9, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ delay: 0.1 * i, duration: 0.4, ease: EASE }}
                className="pill"
              >
                {topic}
              </motion.span>
            ))}
          </div>
        )}
      </div>

      <LayoutGroup>
        <div
          className="px-4 overflow-visible grid grid-cols-4 grid-rows-[210px_210px_210px] gap-[10px] [perspective:1000px]"
        >
          <AnimatePresence mode="popLayout">
            {/* Card 0: Left Vertical (Was Huge) */}
            <div key={`card-0-${indices[0]}`} className="overflow-visible col-[1/2] row-[1/4]">
              <StoryCard story={TOPIC_GROUPS[0][indices[0]] || TOPIC_GROUPS[0][0]} index={0} onCycle={() => cycleCard(0)} onRead={handleRead} />
            </div>
             {/* Card 6: Right Vertical (New Split) */}
            <div key={`card-6-${indices[6]}`} className="overflow-visible col-[2/3] row-[1/4]">
              <StoryCard story={TOPIC_GROUPS[6][indices[6]] || TOPIC_GROUPS[6][0]} index={6} onCycle={() => cycleCard(6)} onRead={handleRead} />
            </div>

            <div key={`card-1-${indices[1]}`} className="overflow-visible col-[3/4] row-[1/2]">
              <StoryCard story={TOPIC_GROUPS[1][indices[1]] || TOPIC_GROUPS[1][0]} index={1} onCycle={() => cycleCard(1)} onRead={handleRead} />
            </div>
            <div key={`card-2-${indices[2]}`} className="overflow-visible col-[4/5] row-[1/2]">
              <StoryCard story={TOPIC_GROUPS[2][indices[2]] || TOPIC_GROUPS[2][0]} index={2} onCycle={() => cycleCard(2)} onRead={handleRead} />
            </div>
            {/* Middle Row */}
            <div key={`card-3-${indices[3]}`} className="overflow-visible col-[3/4] row-[2/3]">
              <StoryCard story={TOPIC_GROUPS[3][indices[3]] || TOPIC_GROUPS[3][0]} index={3} onCycle={() => cycleCard(3)} onRead={handleRead} />
            </div>
            <div key={`card-4-${indices[4]}`} className="overflow-visible col-[4/5] row-[2/3]">
              <StoryCard story={TOPIC_GROUPS[4][indices[4]] || TOPIC_GROUPS[4][0]} index={4} onCycle={() => cycleCard(4)} onRead={handleRead} />
            </div>
            {/* Bottom Row - Wide */}
            <div key={`card-5-${indices[5]}`} className="overflow-visible col-[3/5] row-[3/4]">
              <StoryCard story={TOPIC_GROUPS[5][indices[5]] || TOPIC_GROUPS[5][0]} index={5} onCycle={() => cycleCard(5)} onRead={handleRead} />
            </div>
          </AnimatePresence>
        </div>
      </LayoutGroup>

      <InterestsPreviewModal 
        isOpen={previewOpen} 
        onClose={() => setPreviewOpen(false)} 
        story={selectedStory} 
      />
    </div>
  )
}
