import { motion, AnimatePresence, useDragControls } from 'framer-motion'
import { useRef } from 'react'
import { 
  XMarkIcon, 
  NewspaperIcon, 
  CpuChipIcon, 
  SparklesIcon,
  ArrowTopRightOnSquareIcon,
  ChevronRightIcon,
  CodeBracketIcon,
  PaintBrushIcon,
  ShieldCheckIcon,
  ClockIcon,
  AcademicCapIcon,
  FilmIcon,
  GlobeAltIcon,
  LightBulbIcon,
  CommandLineIcon,
  BeakerIcon
} from '@heroicons/react/24/outline'
import { useInterestDiscoveryStore, DiscoveryStory, DiscoveryAgent, DiscoveryTopic } from '@/stores/interestDiscoveryStore'
import { getCategoryColor } from '@/stores/interestsStore'
import { cn } from '@/utils/cn'

// Icon mapping for agents
const AGENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'agent_dev_assistant': CodeBracketIcon,
  'agent_tech_researcher': BeakerIcon,
  'agent_ai_analyst': CpuChipIcon,
  'agent_prompt_engineer': CommandLineIcon,
  'agent_design_critic': PaintBrushIcon,
  'agent_privacy_guardian': ShieldCheckIcon,
  'agent_task_master': ClockIcon,
  'agent_tutor': AcademicCapIcon,
  'agent_curator': FilmIcon,
  'agent_news_digest': GlobeAltIcon,
  'agent_general': LightBulbIcon
}

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
    clearSelection
  } = useInterestDiscoveryStore()
  
  const dragControls = useDragControls()
  const constraintsRef = useRef<HTMLDivElement>(null)

  const isOpen = !!selectedInterestLabel

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
            dragMomentum={false}
            dragElastic={0.1}
            dragConstraints={constraintsRef}
            initial={{ opacity: 0, scale: 0.95, x: 0, y: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "fixed top-20 right-6 z-[70]",
              "w-[600px] max-h-[70vh]",
              "glass-ultra",
              "shadow-glass dark:shadow-glass-dark",
              "rounded-xl",
              "flex flex-col",
              "border border-zinc-200/50 dark:border-white/10 glass:border-white/40",
              "cursor-default"
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
                  <SparklesIcon 
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
                onClick={clearSelection}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-white/5 glass:hover:bg-white/30 transition-colors flex-shrink-0"
              >
                <XMarkIcon className="w-4 h-4 text-ron-text/60 dark:text-white/60 glass:text-zinc-600" />
              </motion.button>
            </div>

            {/* Content - scrollable area */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-6 space-y-8 min-h-0">
              {isLoading ? (
                <LoadingState />
              ) : content ? (
                <>
                  {/* Stories Section */}
                  <Section 
                    icon={<NewspaperIcon className="w-4 h-4" />}
                    title="Latest Stories"
                    description="Curated content about this topic"
                  >
                    <div className="space-y-3">
                      {content.stories.map((story, i) => (
                        <StoryCard key={story.id} story={story} index={i} />
                      ))}
                    </div>
                  </Section>

                  {/* Agents Section */}
                  <Section 
                    icon={<CpuChipIcon className="w-4 h-4" />}
                    title="Suggested Agents"
                    description="AI tools that can help with this topic"
                  >
                    <div className="grid grid-cols-2 gap-3">
                      {content.agents.map((agent, i) => (
                        <AgentCard key={agent.id} agent={agent} index={i} />
                      ))}
                    </div>
                  </Section>

                  {/* Related Topics */}
                  <Section 
                    icon={<SparklesIcon className="w-4 h-4" />}
                    title="Related Topics"
                    description="Explore connected interests"
                  >
                    <div className="flex flex-wrap gap-2">
                      {content.relatedTopics.map((topic, i) => (
                        <TopicPill key={topic.id} topic={topic} index={i} />
                      ))}
                    </div>
                  </Section>
                </>
              ) : null}
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
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.3 }}
      className={cn(
        "group p-4 rounded-lg cursor-pointer",
        "glass-frosted",
        "hover:bg-zinc-100/50 dark:hover:bg-white/5 glass:hover:bg-white/40",
        "transition-all duration-300"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <h4 className="text-sm font-georgia text-ron-text dark:text-white glass:text-zinc-800 group-hover:text-royal transition-colors">
            {story.title}
          </h4>
          <p className="text-xs font-raleway font-raleway-light text-ron-text/60 dark:text-white/60 glass:text-zinc-600 line-clamp-2">
            {story.description}
          </p>
          <div className="flex items-center gap-3 text-xs font-raleway text-ron-text/40 dark:text-white/40 glass:text-zinc-500">
            <span>{story.source}</span>
            <span>•</span>
            <span>{story.readTime}</span>
            <span>•</span>
            <span>{story.publishedAt}</span>
          </div>
        </div>
        <ArrowTopRightOnSquareIcon className="w-4 h-4 text-ron-text/20 dark:text-white/20 glass:text-zinc-400 group-hover:text-royal transition-colors flex-shrink-0" />
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
}

function AgentCard({ agent, index }: AgentCardProps) {
  // Get the appropriate icon component
  const IconComponent = AGENT_ICONS[agent.iconId] || LightBulbIcon
  
  return (
    <motion.button
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
      {/* Icon */}
      <div className="w-10 h-10 rounded-lg bg-royal/10 dark:bg-royal-light/10 glass:bg-royal/15 flex items-center justify-center mb-3">
        <IconComponent className="w-5 h-5 text-royal dark:text-royal-light glass:text-royal" />
      </div>
      
      {/* Content */}
      <div className="flex-1">
        <h4 className="text-sm font-raleway font-raleway-bold text-ron-text dark:text-white glass:text-zinc-800">
          {agent.name}
        </h4>
        <p className="text-xs font-raleway font-raleway-light text-ron-text/60 dark:text-white/60 glass:text-zinc-600 line-clamp-2 mt-1">
          {agent.description}
        </p>
      </div>
      
      {/* Capabilities */}
      <div className="flex flex-wrap gap-1 mt-3">
        {agent.capabilities.slice(0, 2).map((cap) => (
          <span 
            key={cap}
            className="px-2 py-0.5 rounded text-[10px] font-raleway bg-royal/10 dark:bg-royal-light/10 glass:bg-royal/15 text-royal dark:text-royal-light glass:text-royal"
          >
            {cap}
          </span>
        ))}
      </div>
      
      {/* Use agent link */}
      <div className="flex items-center gap-1 text-xs font-raleway text-royal dark:text-royal-light glass:text-royal opacity-0 group-hover:opacity-100 transition-opacity mt-3">
        <span>Use agent</span>
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

