/**
 * LoadingOverlay
 * 
 * A reusable full-screen loading overlay with rotating SVG illustrations
 * and quirky loading messages. Used for search thinking state and page transitions.
 */

import { useState, useEffect, useCallback } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Quirky Loading Messages - The user LOVED "Herding digital cats"
// ─────────────────────────────────────────────────────────────────────────────
const QUIRKY_MESSAGES = [
  // Cat-themed
  "Herding digital cats...",
  "Convincing cats to cooperate...",
  "Negotiating with stubborn pixels...",
  
  // Oracle/mystical
  "Consulting the digital oracle...",
  "Asking the void (politely)...",
  "Reading the silicon tea leaves...",
  "Summoning knowledge spirits...",
  "Channeling the algorithm gods...",
  "Divining answers from the ether...",
  
  // Tech humor
  "Teaching electrons to dance...",
  "Wrangling data gremlins...",
  "Bribing the algorithm...",
  "Caffeinating the servers...",
  "Untangling the web...",
  "Poking sleeping APIs...",
  "Negotiating with timeouts...",
  "Warming up the flux capacitor...",
  "Defragmenting reality...",
  "Compiling your thoughts...",
  "Debugging the universe...",
  "Rebooting the matrix...",
  "Overclocking curiosity...",
  
  // Whimsical actions
  "Gathering scattered thoughts...",
  "Rounding up rogue bits...",
  "Polishing the results...",
  "Organizing chaos...",
  "Connecting dots...",
  "Following breadcrumbs...",
  "Chasing rabbits down holes...",
  "Herding ones and zeros...",
  "Corralling knowledge...",
  "Spinning up hamster wheels...",
  
  // Space/cosmic
  "Exploring the datasphere...",
  "Scanning the infosphere...",
  "Traversing information highways...",
  "Mining digital gold...",
  "Probing the knowledge mines...",
  "Charting unknown territories...",
  "Navigating the neural pathways...",
  
  // Food/coffee themed
  "Brewing up some answers...",
  "Cooking with data...",
  "Letting ideas simmer...",
  "Marinating in information...",
  "Distilling knowledge...",
  
  // Adventure themed
  "Embarking on a quest...",
  "Seeking wisdom...",
  "On an epic fetch quest...",
  "Rolling for intelligence...",
  "Casting search spell...",
  "Summoning the answer dragon...",
  
  // Office/work humor
  "Filing TPS reports...",
  "Attending meetings about meetings...",
  "Synergizing synergies...",
  "Leveraging leverage...",
  "Optimizing optimizations...",
  
  // Cute/silly
  "Asking nicely...",
  "Saying please and thank you...",
  "Being patient (for a computer)...",
  "Thinking really hard...",
  "Doing the thing...",
  "Making magic happen...",
  "Sprinkling digital fairy dust...",
]

// ─────────────────────────────────────────────────────────────────────────────
// SVG Illustrations
// ─────────────────────────────────────────────────────────────────────────────
const ILLUSTRATIONS = [
  'chat-ui.svg',
  'coding-agent-building-v2.svg',
  'holographic-code-ui.svg',
  'holographic-message-bubble.svg',
  'kanban-board.svg',
  'ron-extraction-blob.svg',
]

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────
interface LoadingOverlayProps {
  /** Whether the overlay is visible */
  isVisible: boolean
  /** Optional query to display */
  query?: string
  /** How often to rotate messages (ms) */
  messageInterval?: number
  /** How often to rotate illustrations (ms) */
  illustrationInterval?: number
  /** Optional custom class name */
  className?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export function LoadingOverlay({
  isVisible,
  query,
  messageInterval = 3000,
  illustrationInterval = 8000,
  className = '',
}: LoadingOverlayProps) {
  const [currentMessage, setCurrentMessage] = useState(() => 
    QUIRKY_MESSAGES[Math.floor(Math.random() * QUIRKY_MESSAGES.length)]
  )
  const [currentIllustration, setCurrentIllustration] = useState(() =>
    ILLUSTRATIONS[Math.floor(Math.random() * ILLUSTRATIONS.length)]
  )
  const [isExiting, setIsExiting] = useState(false)
  const [shouldRender, setShouldRender] = useState(isVisible)

  // Get random item from array (avoiding repeats)
  const getRandomItem = useCallback(<T,>(arr: T[], current: T): T => {
    const filtered = arr.filter(item => item !== current)
    return filtered[Math.floor(Math.random() * filtered.length)]
  }, [])

  // Rotate messages
  useEffect(() => {
    if (!isVisible) return
    
    const interval = setInterval(() => {
      setCurrentMessage(prev => getRandomItem(QUIRKY_MESSAGES, prev))
    }, messageInterval)

    return () => clearInterval(interval)
  }, [isVisible, messageInterval, getRandomItem])

  // Rotate illustrations
  useEffect(() => {
    if (!isVisible) return
    
    const interval = setInterval(() => {
      setCurrentIllustration(prev => getRandomItem(ILLUSTRATIONS, prev))
    }, illustrationInterval)

    return () => clearInterval(interval)
  }, [isVisible, illustrationInterval, getRandomItem])

  // Handle visibility transitions
  useEffect(() => {
    if (isVisible) {
      setShouldRender(true)
      setIsExiting(false)
    } else {
      setIsExiting(true)
      const timer = setTimeout(() => setShouldRender(false), 500)
      return () => clearTimeout(timer)
    }
  }, [isVisible])

  if (!shouldRender) return null

  return (
    <div
      className={`
        fixed inset-0 z-50 flex flex-col items-center justify-center
        bg-gradient-to-br from-slate-900/98 via-slate-800/95 to-slate-900/98
        backdrop-blur-xl
        transition-all duration-500 ease-out
        ${isExiting ? 'opacity-0 scale-105' : 'opacity-100 scale-100'}
        ${className}
      `}
    >
      {/* Ambient background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-teal-500/10 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '0.5s' }} />
      </div>

      {/* Main content */}
      <div className="relative flex flex-col items-center gap-8 max-w-lg px-6">
        {/* Rotating SVG illustration */}
        <div 
          className="relative transition-opacity duration-700"
          key={currentIllustration}
          style={{
            animation: 'fadeSlideIn 0.7s ease-out forwards',
          }}
        >
          <img 
            src={`/${currentIllustration}`}
            alt="Loading illustration"
            className="w-[300px] h-[225px] object-contain drop-shadow-2xl"
          />
        </div>

        {/* Thought bubble with message */}
        <div className="relative">
          {/* Glass morphism bubble */}
          <div 
            className="
              relative px-8 py-4 rounded-2xl
              bg-white/5 backdrop-blur-md
              border border-white/10
              shadow-xl shadow-black/20
            "
          >
            {/* Quirky message */}
            <p 
              className="
                text-lg font-light tracking-wide text-center
                text-white/90
                font-['Raleway',_sans-serif]
                transition-opacity duration-300
              "
              key={currentMessage}
              style={{
                animation: 'messageRotate 0.4s ease-out forwards',
              }}
            >
              {currentMessage}
            </p>

            {/* Orbiting dots */}
            <div className="absolute -top-2 -right-2 w-4 h-4">
              <span className="absolute w-2 h-2 bg-teal-400/60 rounded-full animate-ping" />
              <span className="absolute w-2 h-2 bg-teal-400 rounded-full" />
            </div>
            <div className="absolute -bottom-1 -left-1 w-3 h-3">
              <span className="absolute w-1.5 h-1.5 bg-purple-400/60 rounded-full animate-ping" style={{ animationDelay: '0.5s' }} />
              <span className="absolute w-1.5 h-1.5 bg-purple-400 rounded-full" />
            </div>
          </div>

          {/* Thought bubble tail dots */}
          <div className="absolute -bottom-6 right-8 flex gap-2 items-end">
            <div className="w-3 h-3 bg-white/10 backdrop-blur-sm rounded-full border border-white/10" />
            <div className="w-2 h-2 bg-white/8 backdrop-blur-sm rounded-full border border-white/8" />
            <div className="w-1.5 h-1.5 bg-white/5 backdrop-blur-sm rounded-full" />
          </div>
        </div>

        {/* Query display (if provided) */}
        {query && (
          <div className="mt-4 text-center">
            <p className="text-sm text-white/40 mb-1">Searching for</p>
            <p className="text-base text-white/70 font-medium max-w-md truncate">
              "{query}"
            </p>
          </div>
        )}
      </div>

      {/* Inline keyframes */}
      <style>{`
        @keyframes fadeSlideIn {
          from {
            opacity: 0;
            transform: translateY(20px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes messageRotate {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}

export default LoadingOverlay
