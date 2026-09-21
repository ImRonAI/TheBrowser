import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence, useDragControls } from 'framer-motion'
import { XMarkIcon, SparklesIcon } from '@heroicons/react/24/outline'
import { useInterestsStore } from '@/stores/interestsStore'
import { NeuralCanvas } from './NeuralCanvas'
import { InterestDiscoveryPanel } from './InterestDiscoveryPanel'
import { cn } from '@/utils/cn'

// Pin icon component
function PinIcon({ isPinned, className }: { isPinned: boolean; className?: string }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill={isPinned ? "currentColor" : "none"}
      stroke="currentColor" 
      strokeWidth={1.5}
      className={className}
    >
      <path 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        d="M16 4v4l2 2v2h-5v8l-1 1-1-1v-8H6v-2l2-2V4h8z" 
      />
    </svg>
  )
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

export function InterestsWidget() {
  const {
    nodes,
    isExpanded,
    isInitialized,
    toggleExpanded,
    setExpanded,
    initializeFromOnboarding,
    getTopInterests
  } = useInterestsStore()
  
  const [isPinned, setIsPinned] = useState(false)

  // Initialize from onboarding on mount
  useEffect(() => {
    if (!isInitialized) {
      initializeFromOnboarding()
    }
  }, [isInitialized, initializeFromOnboarding])

  // Don't render if no interests
  if (nodes.length === 0) {
    return null
  }

  const topInterests = getTopInterests(3)
  
  const handleClose = () => {
    if (!isPinned) {
      setExpanded(false)
    }
  }

  return (
    <>
      {/* Collapsed Orb - bottom right (hidden when pinned open) */}
      <AnimatePresence>
        {!isExpanded && (
          <div className="fixed bottom-6 right-6 z-40">
            <CollapsedOrb
              key="collapsed"
              topInterests={topInterests}
              onClick={toggleExpanded}
            />
          </div>
        )}
      </AnimatePresence>

      {/* Expanded Panel - draggable utility panel */}
      <AnimatePresence>
        {isExpanded && (
          <ExpandedPanel
            key="expanded"
            onClose={handleClose}
            isPinned={isPinned}
            onTogglePin={() => setIsPinned(!isPinned)}
          />
        )}
      </AnimatePresence>

      {/* Discovery Panel - appears when interest is clicked */}
      <InterestDiscoveryPanel />
    </>
  )
}

// ============================================
// Collapsed Orb Component
// ============================================

interface CollapsedOrbProps {
  topInterests: ReturnType<typeof useInterestsStore.getState>['nodes']
  onClick: () => void
}

function CollapsedOrb({ topInterests, onClick }: CollapsedOrbProps) {
  return (
    <motion.button
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.8, opacity: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      onClick={onClick}
      className={cn(
        "pointer-events-auto",
        "relative group",
        "w-16 h-16 rounded-full",
        "glass-ultra",
        "shadow-glass hover:shadow-glass-hover",
        "transition-all duration-500 ease-smooth",
        "hover:scale-105",
        "cursor-pointer",
        "overflow-hidden"
      )}
    >
      {/* Animated gradient background */}
      <motion.div
        className="absolute inset-0 rounded-full opacity-30"
        style={{
          background: 'conic-gradient(from 0deg, rgba(45, 59, 135, 0.4), rgba(74, 59, 135, 0.4), rgba(45, 59, 135, 0.4))'
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
      />

      {/* Inner glow */}
      <div className="absolute inset-2 rounded-full bg-gradient-to-br from-royal/20 to-royal-purple/20 dark:from-royal-light/20 dark:to-royal-purple/20" />

      {/* Pulse ring */}
      <motion.div
        className="absolute inset-0 rounded-full border-2 border-royal/30 dark:border-royal-light/30"
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.5, 0, 0.5]
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: 'easeInOut'
        }}
      />

      {/* Center icon */}
      <div className="absolute inset-0 flex items-center justify-center">
        <SparklesIcon className="w-6 h-6 text-royal dark:text-royal-light" />
      </div>

      {/* Floating labels on hover */}
      <AnimatePresence>
        <motion.div
          className="absolute -top-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex gap-1 whitespace-nowrap">
            {topInterests.slice(0, 2).map((interest, i) => (
              <motion.span
                key={interest.id}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: i * 0.1 }}
                className={cn(
                  "px-2 py-0.5 rounded-sm text-xs",
                  "glass-frosted",
                  "font-raleway font-raleway-bold",
                  "text-ron-text/80 dark:text-white/80 glass:text-zinc-700"
                )}
              >
                {interest.label}
              </motion.span>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Node count indicator */}
      <motion.div
        className={cn(
          "absolute -bottom-1 -right-1",
          "w-5 h-5 rounded-full",
          "bg-royal dark:bg-royal-light",
          "flex items-center justify-center",
          "text-white text-xs font-raleway font-raleway-bold",
          "shadow-lg"
        )}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.3, type: 'spring', stiffness: 500 }}
      >
        {useInterestsStore.getState().nodes.length}
      </motion.div>
    </motion.button>
  )
}

// ============================================
// Expanded Panel Component
// ============================================

interface ExpandedPanelProps {
  onClose: () => void
  isPinned: boolean
  onTogglePin: () => void
}

function ExpandedPanel({ onClose, isPinned, onTogglePin }: ExpandedPanelProps) {
  const { nodes, resetInterests, initializeFromOnboarding } = useInterestsStore()
  const dragControls = useDragControls()
  const constraintsRef = useRef<HTMLDivElement>(null)
  
  const handleReset = () => {
    resetInterests()
    setTimeout(() => {
      initializeFromOnboarding()
    }, 100)
  }

  return (
    <>
      {/* Invisible constraint boundary for dragging */}
      <div 
        ref={constraintsRef} 
        className="fixed inset-4 pointer-events-none z-40"
      />
      
      {/* Draggable Panel - no backdrop blocking */}
      <motion.div
        drag
        dragControls={dragControls}
        dragMomentum={false}
        dragElastic={0.1}
        dragConstraints={constraintsRef}
        initial={{ scale: 0.9, opacity: 0, x: 0, y: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          "fixed bottom-20 right-6 z-50",
          "w-[520px] h-[480px]",
          "glass-ultra",
          "shadow-glass dark:shadow-glass-dark",
          "rounded-xl",
          "flex flex-col",
          "overflow-hidden",
          "border border-zinc-200/50 dark:border-white/10 glass:border-white/40",
          "cursor-default"
        )}
      >
        {/* Drag Handle Header */}
        <div 
          className="flex-shrink-0 px-4 py-3 flex items-center justify-between cursor-grab active:cursor-grabbing select-none"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <div className="flex items-center gap-3">
            {/* Drag indicator */}
            <DragHandleIcon className="w-4 h-4 text-ron-text/30 dark:text-white/30 glass:text-zinc-500/50" />
            
            <div className="relative">
              <SparklesIcon className="w-4 h-4 text-royal dark:text-royal-light glass:text-royal" />
            </div>
            <div>
              <h2 className="text-sm font-georgia text-ron-text dark:text-white glass:text-zinc-800">
                Interest Graph
              </h2>
              <p className="text-[10px] font-raleway text-ron-text/50 dark:text-white/50 glass:text-zinc-500">
                {nodes.length} topics
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* Pin button */}
            <motion.button
              onClick={onTogglePin}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                isPinned 
                  ? "bg-royal/20 text-royal dark:bg-royal-light/20 dark:text-royal-light glass:bg-royal/15 glass:text-royal" 
                  : "hover:bg-zinc-100 dark:hover:bg-white/5 glass:hover:bg-white/30 text-ron-text/40 dark:text-white/40 glass:text-zinc-500"
              )}
              title={isPinned ? "Unpin panel" : "Pin panel open"}
            >
              <PinIcon isPinned={isPinned} className="w-4 h-4" />
            </motion.button>
            
            {/* Close button */}
            <motion.button
              onClick={onClose}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-white/5 glass:hover:bg-white/30 transition-colors"
            >
              <XMarkIcon className="w-4 h-4 text-ron-text/60 dark:text-white/60 glass:text-zinc-600" />
            </motion.button>
          </div>
        </div>

        {/* Subtle separator */}
        <div className="h-px bg-gradient-to-r from-transparent via-zinc-200/50 dark:via-white/5 glass:via-white/40 to-transparent" />

        {/* Neural Canvas */}
        <div className="flex-1 relative overflow-hidden">
          <NeuralCanvas />
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-4 py-2">
          <div className="h-px bg-gradient-to-r from-transparent via-zinc-200/50 dark:via-white/5 glass:via-white/40 to-transparent mb-2" />
          <div className="flex items-center justify-between text-[10px] font-raleway text-ron-text/40 dark:text-white/40 glass:text-zinc-500">
            <span>Click nodes to explore</span>
            <motion.button
              onClick={handleReset}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="px-2 py-0.5 rounded-md hover:bg-zinc-100 dark:hover:bg-white/5 glass:hover:bg-white/30 transition-colors text-royal dark:text-royal-light glass:text-royal"
            >
              Regenerate
            </motion.button>
          </div>
        </div>
      </motion.div>
    </>
  )
}

