import { motion, AnimatePresence, useDragControls } from 'framer-motion'
import { RenIcon } from '@/components/brand'
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { XMarkIcon, NewspaperIcon, CpuChipIcon, ArrowTopRightOnSquareIcon, ChevronRightIcon, PlusIcon } from '@heroicons/react/24/outline'
import { useAgentUi } from '@/context/AgentUiContext'
import { openResult } from '@/components/search/open-result'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { chatWithSpecialist } from './ContextAgents'
import { useInterestDiscoveryStore, type DiscoveryStory, type DiscoveryAgent, type DiscoveryTopic } from '@/stores/interestDiscoveryStore'
import { getCategoryColor, useInterestsStore } from '@/stores/interestsStore'
import { cn } from '@/utils/cn'

// Drag handle icon
function DragHandleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  )
}

export function InterestDiscoveryPanel() {
  const {
    selectedInterestLabel,
    selectedInterestCategory,
    isLoading,
    content,
    error,
    clearSelection
  } = useInterestDiscoveryStore()
  
  const dragControls = useDragControls()
  const constraintsRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  /** What had focus when the panel opened (usually the interest node), so closing can return there. */
  const openerRef = useRef<HTMLElement | null>(null)

  const isOpen = !!selectedInterestLabel

  // Move focus into the panel when it opens or shows another interest; give it back on close.
  useEffect(() => {
    if (!selectedInterestLabel) {
      const opener = openerRef.current
      openerRef.current = null
      if (opener?.isConnected) opener.focus({ preventScroll: true })
      return
    }
    if (!openerRef.current) {
      const active = document.activeElement
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null
    }
    panelRef.current?.focus({ preventScroll: true })
  }, [selectedInterestLabel])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.stopPropagation()
    clearSelection()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Invisible constraint boundary for dragging */}
          <div 
            ref={constraintsRef} 
            className="fixed inset-4 pointer-events-none z-[60]"
          />

          {/* Draggable Panel - no blocking backdrop */}
          <motion.div
            drag
            dragControls={dragControls}
            // Only the header drags the panel; selecting text or scrolling inside it must not move it.
            dragListener={false}
            dragMomentum={false}
            dragElastic={0.1}
            dragConstraints={constraintsRef}
            initial={{ opacity: 0, scale: 0.95, x: 0, y: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            ref={panelRef}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            role="dialog"
            aria-label={selectedInterestLabel || 'Interest'}
            className={cn(
              "fixed top-20 right-6 z-[70]",
              "w-[600px] max-h-[70vh]",
              "glass-ultra",
              "shadow-glass dark:shadow-glass-dark",
              "rounded-xl",
              "flex flex-col",
              "border border-zinc-200/50 dark:border-white/10 glass:border-white/40",
              "cursor-default",
              "focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
            )}
          >
            {/* Drag Handle Header */}
            <div 
              className="flex-shrink-0 px-5 py-4 flex items-center justify-between cursor-grab active:cursor-grabbing select-none"
              style={{
                borderBottom: `2px solid ${selectedInterestCategory ? getCategoryColor(selectedInterestCategory) : '#3B82F6'}30`
              }}
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div className="flex items-center gap-3">
                {/* Drag indicator */}
                <DragHandleIcon className="w-4 h-4 text-ron-text/30 dark:text-white/30 glass:text-zinc-500/50 flex-shrink-0" />
                
                <div 
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ 
                    backgroundColor: `${selectedInterestCategory ? getCategoryColor(selectedInterestCategory) : '#3B82F6'}20` 
                  }}
                >
                  <RenIcon 
                    className="w-4 h-4" 
                    style={{ color: selectedInterestCategory ? getCategoryColor(selectedInterestCategory) : '#3B82F6' }}
                  />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-georgia text-ron-text dark:text-white glass:text-zinc-800 truncate">
                    {selectedInterestLabel}
                  </h2>
                  <p className="text-xs font-raleway text-ron-text/50 dark:text-white/50 glass:text-zinc-500">
                    Content, agents & topics
                  </p>
                </div>
              </div>
              
              <motion.button
                type="button"
                onClick={clearSelection}
                onPointerDown={(event) => event.stopPropagation()}
                aria-label="Close"
                title="Close"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-white/5 glass:hover:bg-white/30 transition-colors flex-shrink-0"
              >
                <XMarkIcon className="w-4 h-4 text-ron-text/60 dark:text-white/60 glass:text-zinc-600" />
              </motion.button>
            </div>

            {/* Content - scrollable area */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-6 space-y-8 min-h-0">
              {content && (
                <>
                  {/* Stories Section */}
                  <Section
                    icon={<NewspaperIcon className="w-4 h-4" />}
                    title="Latest Stories"
                    description="This week's news for this interest"
                  >
                    {isLoading ? <LoadingState /> : error ? (
                      <p className="text-xs font-raleway text-red-600 dark:text-red-400" role="alert">{error}</p>
                    ) : content.stories.length ? (
                      <div className="space-y-3">
                        {content.stories.map((story, i) => (
                          <StoryCard key={story.id} story={story} index={i} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs font-raleway text-ron-text/50 dark:text-white/50">No stories this week.</p>
                    )}
                  </Section>

                  {/* Agents Section */}
                  <Section
                    icon={<CpuChipIcon className="w-4 h-4" />}
                    title="Agents"
                    description="Recommended by Context Agent, and the agents you saved"
                  >
                    {content.agents.length ? (
                      <div className="grid grid-cols-2 gap-3">
                        {content.agents.map((agent, i) => (
                          <AgentCard key={agent.id} agent={agent} index={i} interest={selectedInterestLabel ?? ''} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs font-raleway text-ron-text/50 dark:text-white/50">
                        No agents for this interest yet. Context Agent recommends one when the interest keeps coming up.
                      </p>
                    )}
                  </Section>

                  {/* Related Topics */}
                  {content.relatedTopics.length > 0 && (
                    <Section
                      icon={<RenIcon className="w-4 h-4" />}
                      title="Related Topics"
                      description="Your other interests"
                    >
                      <div className="flex flex-wrap gap-2">
                        {content.relatedTopics.map((topic, i) => (
                          <TopicPill key={topic.id} topic={topic} index={i} />
                        ))}
                      </div>
                    </Section>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ============================================
// Section Component
// ============================================

interface SectionProps {
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}

function Section({ icon, title, description, children }: SectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-1.5 rounded-md bg-royal/10 dark:bg-royal-light/10 glass:bg-royal/15 text-royal dark:text-royal-light glass:text-royal">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-raleway font-raleway-bold text-ron-text dark:text-white glass:text-zinc-800">
            {title}
          </h3>
          <p className="text-xs font-raleway text-ron-text/40 dark:text-white/40 glass:text-zinc-500">
            {description}
          </p>
        </div>
      </div>
      {children}
    </div>
  )
}

// ============================================
// Story Card
// ============================================

interface StoryCardProps {
  story: DiscoveryStory
  index: number
}

function StoryCard({ story, index }: StoryCardProps) {
  const addContext = useContextAgentStore((state) => state.addContext)
  // One add at a time: a second click while the first is still being extracted would save a duplicate.
  const busy = useContextAgentStore((state) => state.busy)
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.3 }}
      className={cn(
        "group p-4 rounded-lg",
        "glass-frosted",
        "hover:bg-zinc-100/50 dark:hover:bg-white/5 glass:hover:bg-white/40",
        "transition-all duration-300"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <button type="button" onClick={() => openResult(story.url)} className="flex-1 space-y-2 text-left">
          <h4 className="text-sm font-georgia text-ron-text dark:text-white glass:text-zinc-800 group-hover:text-royal transition-colors">
            {story.title}
          </h4>
          <p className="text-xs font-raleway font-raleway-light text-ron-text/60 dark:text-white/60 glass:text-zinc-600 line-clamp-2">
            {story.description}
          </p>
          <div className="flex items-center gap-3 text-xs font-raleway text-ron-text/40 dark:text-white/40 glass:text-zinc-500">
            <span>{story.source}</span>
            {story.publishedAt && <><span>•</span><span>{story.publishedAt}</span></>}
          </div>
        </button>
        <div className="flex flex-col items-center gap-2 flex-shrink-0">
          <ArrowTopRightOnSquareIcon className="w-4 h-4 text-ron-text/20 dark:text-white/20 glass:text-zinc-400 group-hover:text-royal transition-colors" />
          <button type="button" title={busy || 'Add to context'} aria-label={`Add ${story.title} to context`}
            onClick={() => void addContext({ kind: 'article', url: story.url, title: story.title })}
            disabled={Boolean(busy)}
            className="rounded p-0.5 text-ron-text/40 hover:bg-royal/10 hover:text-royal disabled:cursor-default disabled:opacity-40 dark:text-white/40">
            <PlusIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.article>
  )
}

// ============================================
// Agent Card
// ============================================

interface AgentCardProps {
  agent: DiscoveryAgent
  index: number
  interest: string
}

function AgentCard({ agent, index, interest }: AgentCardProps) {
  const { sendToAgentPanel } = useAgentUi()
  const IconComponent = agent.saved ? CpuChipIcon : RenIcon
  const open = () => {
    const specialist = agent.saved ? useContextAgentStore.getState().agents.find((item) => item.id === agent.id) : undefined
    if (specialist) {
      useInterestDiscoveryStore.getState().clearSelection()
      chatWithSpecialist(specialist, `${interest ? `For ${interest}: ` : ''}${agent.description}`, sendToAgentPanel)
      return
    }
    useInterestDiscoveryStore.getState().clearSelection()
    useInterestsStore.getState().setExpanded(true)
    useContextAgentStore.getState().setTab('agents')
  }

  return (
    <motion.button
      type="button"
      onClick={open}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.1, duration: 0.3 }}
      className={cn(
        "group p-4 rounded-lg text-left w-full h-full",
        "glass-frosted",
        "hover:bg-zinc-100/50 dark:hover:bg-white/5 glass:hover:bg-white/40",
        "transition-all duration-300",
        "flex flex-col"
      )}
    >
      <div className="w-10 h-10 rounded-lg bg-royal/10 dark:bg-royal-light/10 glass:bg-royal/15 flex items-center justify-center mb-3">
        <IconComponent className="w-5 h-5 text-royal dark:text-royal-light glass:text-royal" />
      </div>
      <div className="flex-1">
        <h4 className="text-sm font-raleway font-raleway-bold text-ron-text dark:text-white glass:text-zinc-800">
          {agent.name}
        </h4>
        <p className="text-xs font-raleway font-raleway-light text-ron-text/60 dark:text-white/60 glass:text-zinc-600 line-clamp-2 mt-1">
          {agent.description}
        </p>
      </div>
      {agent.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {agent.capabilities.slice(0, 2).map((cap) => (
            <span key={cap} className="px-2 py-0.5 rounded text-[10px] font-raleway bg-royal/10 dark:bg-royal-light/10 glass:bg-royal/15 text-royal dark:text-royal-light glass:text-royal">
              {cap}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 text-xs font-raleway text-royal dark:text-royal-light glass:text-royal opacity-0 group-hover:opacity-100 transition-opacity mt-3">
        <span>{agent.saved ? 'Use agent' : 'Review recommendation'}</span>
        <ChevronRightIcon className="w-3 h-3" />
      </div>
    </motion.button>
  )
}

// ============================================
// Topic Pill
// ============================================

interface TopicPillProps {
  topic: DiscoveryTopic
  index: number
}

function TopicPill({ topic, index }: TopicPillProps) {
  const categoryColor = getCategoryColor(topic.category)

  return (
    <motion.button
      type="button"
      onClick={() => useInterestDiscoveryStore.getState().selectInterest(topic.id, topic.label, topic.category)}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.05, duration: 0.2 }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className={cn(
        "px-3 py-1.5 rounded-full",
        "text-xs font-raleway font-raleway-bold",
        "transition-all duration-200"
      )}
      style={{
        backgroundColor: `${categoryColor}15`,
        color: categoryColor,
        border: `1px solid ${categoryColor}30`
      }}
    >
      {topic.label}
    </motion.button>
  )
}

// ============================================
// Loading State
// ============================================

function LoadingState() {
  return (
    <div className="space-y-6">
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-3">
          <div className="h-4 w-32 rounded bg-zinc-200/50 dark:bg-white/5 glass:bg-white/30 animate-pulse" />
          <div className="h-20 rounded-lg bg-zinc-100/50 dark:bg-white/3 glass:bg-white/20 animate-pulse" />
        </div>
      ))}
    </div>
  )
}

