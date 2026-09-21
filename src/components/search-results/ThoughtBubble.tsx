/**
 * ThoughtBubble Component
 * 
 * A glass-morphism thought bubble with animated thinking indicator.
 * Used alongside the ThinkingBlob to show AI is processing.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/cn'

interface ThoughtBubbleProps {
  className?: string
  isThinking?: boolean
  thinkingText?: string
  children?: React.ReactNode
}

export function ThoughtBubble({ 
  className, 
  isThinking = true,
  thinkingText,
  children 
}: ThoughtBubbleProps) {
  return (
    <div className={cn('relative', className)}>
      {/* Main thought cloud SVG with content area */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 400 300"
        width="400"
        height="300"
        className="w-full h-auto"
      >
        <defs>
          {/* Glass + neon system */}
          <linearGradient id="glassBody" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#5A7FBA" stopOpacity="0.58" />
            <stop offset="18%" stopColor="#3E5E94" stopOpacity="0.52" />
            <stop offset="52%" stopColor="#2A4470" stopOpacity="0.50" />
            <stop offset="86%" stopColor="#1E3355" stopOpacity="0.52" />
            <stop offset="100%" stopColor="#162848" stopOpacity="0.58" />
          </linearGradient>

          <linearGradient id="glassShineTop" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#E6F4FF" stopOpacity="0.38" />
            <stop offset="18%" stopColor="#A8C8F0" stopOpacity="0.16" />
            <stop offset="42%" stopColor="#6A9AD8" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#6A9AD8" stopOpacity="0" />
          </linearGradient>

          <linearGradient id="glassEdge" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#B8D4F8" stopOpacity="0.72" />
            <stop offset="6%" stopColor="#8AB4E8" stopOpacity="0.38" />
            <stop offset="14%" stopColor="#6A9AD8" stopOpacity="0.15" />
            <stop offset="55%" stopColor="#5080C0" stopOpacity="0.20" />
            <stop offset="92%" stopColor="#4070B0" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#64FFDA" stopOpacity="0.26" />
          </linearGradient>

          <radialGradient id="holoCore" cx="50%" cy="45%" r="70%">
            <stop offset="0%" stopColor="#9EDBFF" stopOpacity="0.14" />
            <stop offset="45%" stopColor="#64FFDA" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#7C4DFF" stopOpacity="0" />
          </radialGradient>

          {/* Filters */}
          <filter id="megaShadow" x="-120%" y="-120%" width="340%" height="340%">
            <feDropShadow dx="0" dy="20" stdDeviation="28" floodColor="#000A14" floodOpacity="0.92" />
            <feDropShadow dx="0" dy="8" stdDeviation="14" floodColor="#1A3A6B" floodOpacity="0.55" />
            <feDropShadow dx="0" dy="2" stdDeviation="6" floodColor="#3B7DD8" floodOpacity="0.28" />
            <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#64FFDA" floodOpacity="0.22" />
            <feDropShadow dx="0" dy="0" stdDeviation="3.8" floodColor="#7C4DFF" floodOpacity="0.18" />
          </filter>

          <filter id="ultraGlow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="2" result="b1" />
            <feGaussianBlur stdDeviation="6" result="b2" />
            <feGaussianBlur stdDeviation="12" result="b3" />
            <feGaussianBlur stdDeviation="24" result="b4" />
            <feMerge>
              <feMergeNode in="b4" />
              <feMergeNode in="b3" />
              <feMergeNode in="b2" />
              <feMergeNode in="b1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="softGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="bubbleShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000A14" floodOpacity="0.6" />
            <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#64FFDA" floodOpacity="0.3" />
          </filter>

          {/* Thought cloud main body */}
          <path id="bubblePath" d="M 60 60 H 340 A 25 25 0 0 1 365 85 V 195 A 25 25 0 0 1 340 220 H 60 A 25 25 0 0 1 35 195 V 85 A 25 25 0 0 1 60 60 Z" />
        </defs>

        {/* Transparent background */}
        <rect width="400" height="300" fill="transparent" />

        {/* Soft ambient glow */}
        <g filter="url(#ultraGlow)" opacity="0.85">
          <ellipse cx="200" cy="140" rx="210" ry="150" fill="url(#holoCore)" />
        </g>

        {/* Decorative particles */}
        <g filter="url(#softGlow)">
          <circle r="2.0" fill="#64FFDA" opacity="0">
            <animate attributeName="cx" values="350;370;350" dur="4s" repeatCount="indefinite" />
            <animate attributeName="cy" values="260;240;260" dur="4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;0.6;0" dur="4s" repeatCount="indefinite" />
          </circle>
          <circle r="1.5" fill="#7C4DFF" opacity="0">
            <animate attributeName="cx" values="40;60;40" dur="5s" repeatCount="indefinite" begin="1s" />
            <animate attributeName="cy" values="70;90;70" dur="5s" repeatCount="indefinite" begin="1s" />
            <animate attributeName="opacity" values="0;0.5;0" dur="5s" repeatCount="indefinite" begin="1s" />
          </circle>
        </g>

        {/* THOUGHT CLOUD BUBBLES (trailing to bottom-right) */}
        <g filter="url(#bubbleShadow)">
          {/* Large bubble */}
          <ellipse cx="340" cy="245" rx="18" ry="15" fill="url(#glassBody)" />
          <ellipse cx="340" cy="245" rx="18" ry="15" fill="url(#glassShineTop)" />
          <ellipse cx="340" cy="245" rx="18" ry="15" fill="none" stroke="url(#glassEdge)" strokeWidth="1.2" />

          {/* Medium bubble */}
          <ellipse cx="362" cy="265" rx="11" ry="9" fill="url(#glassBody)" />
          <ellipse cx="362" cy="265" rx="11" ry="9" fill="url(#glassShineTop)" />
          <ellipse cx="362" cy="265" rx="11" ry="9" fill="none" stroke="url(#glassEdge)" strokeWidth="1" />

          {/* Small bubble */}
          <ellipse cx="378" cy="280" rx="6" ry="5" fill="url(#glassBody)" />
          <ellipse cx="378" cy="280" rx="6" ry="5" fill="url(#glassShineTop)" />
          <ellipse cx="378" cy="280" rx="6" ry="5" fill="none" stroke="url(#glassEdge)" strokeWidth="0.8" />
        </g>

        {/* Connector beams */}
        <g filter="url(#ultraGlow)" opacity="0.2">
          <path d="M 340 220 Q 350 235 340 245" fill="none" stroke="#64FFDA" strokeWidth="2" strokeLinecap="round" />
        </g>

        {/* MAIN THOUGHT CLOUD */}
        <g filter="url(#megaShadow)">
          {/* Body Fill */}
          <use href="#bubblePath" fill="url(#glassBody)" />

          {/* Shine Overlay */}
          <use href="#bubblePath" fill="url(#glassShineTop)" />

          {/* Glass Edge Stroke */}
          <use href="#bubblePath" fill="none" stroke="url(#glassEdge)" strokeWidth="1.5" />

          {/* Inner Border Highlight */}
          <use href="#bubblePath" fill="none" stroke="#A8C8F0" strokeWidth="0.6" opacity="0.15" transform="translate(1,1)" />
        </g>
      </svg>

      {/* Content overlay - positioned inside the bubble */}
      <div className="absolute inset-0 flex items-center justify-center" style={{ top: '20%', bottom: '30%', left: '10%', right: '10%' }}>
        <AnimatePresence mode="wait">
          {isThinking ? (
            <motion.div
              key="thinking"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center gap-3"
            >
              <ThinkingAnimation />
              {thinkingText && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="text-body-sm text-white/80 font-light tracking-wide"
                >
                  {thinkingText}
                </motion.p>
              )}
            </motion.div>
          ) : children ? (
            <motion.div
              key="content"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3 }}
              className="text-center"
            >
              {children}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}

/**
 * ThinkingAnimation - Cute animated dots with orbital effect
 */
function ThinkingAnimation() {
  return (
    <div className="relative w-16 h-16">
      {/* Central pulsing core */}
      <motion.div
        className="absolute inset-0 m-auto w-4 h-4 rounded-full bg-gradient-to-br from-violet-400 to-purple-500"
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.6, 1, 0.6],
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
      
      {/* Orbiting dots */}
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute w-2.5 h-2.5 rounded-full"
          style={{
            background: i === 0 ? '#60A5FA' : i === 1 ? '#A855F7' : '#34D399',
            top: '50%',
            left: '50%',
            marginLeft: '-5px',
            marginTop: '-5px',
          }}
          animate={{
            rotate: 360,
          }}
          transition={{
            duration: 2 + i * 0.3,
            repeat: Infinity,
            ease: 'linear',
            delay: i * 0.2,
          }}
        >
          <motion.div
            className="w-2.5 h-2.5 rounded-full"
            style={{
              background: i === 0 ? '#60A5FA' : i === 1 ? '#A855F7' : '#34D399',
              transform: `translateX(${20 + i * 4}px)`,
            }}
            animate={{
              opacity: [0.4, 1, 0.4],
              scale: [0.8, 1.2, 0.8],
            }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: i * 0.15,
            }}
          />
        </motion.div>
      ))}
    </div>
  )
}

/**
 * QuirkyMessage - Displays cute loading messages
 */
const QUIRKY_MESSAGES = [
  "Consulting the digital oracle...",
  "Teaching electrons to dance...",
  "Asking the internet nicely...",
  "Brewing some search magic...",
  "Wrangling data gremlins...",
  "Polishing search crystals...",
  "Summoning relevant results...",
  "Decoding the universe...",
  "Charging my curiosity beam...",
  "Translating thoughts to queries...",
]

export function useQuirkyMessage() {
  const message = QUIRKY_MESSAGES[Math.floor(Math.random() * QUIRKY_MESSAGES.length)]
  return message
}

export default ThoughtBubble
