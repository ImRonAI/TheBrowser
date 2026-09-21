/**
 * RonExtraction Component
 *
 * Animated blob visualization for the "Ask Ron" feature.
 * Shows a thinking thought bubble when processing.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/cn'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface RonExtractionProps {
  /** Whether Ron is currently thinking/processing */
  isThinking?: boolean
  /** Dynamic text to show in thought bubble (changes as Ron thinks) */
  thinkingText?: string
  /** Size of the blob */
  size?: 'sm' | 'md' | 'lg'
  /** Additional class names */
  className?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// ThoughtBubble - Glass morphism thought cloud with dynamic text
// ─────────────────────────────────────────────────────────────────────────────

interface ThoughtBubbleProps {
  text: string
  className?: string
}

function ThoughtBubble({ text, className }: ThoughtBubbleProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: 10 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={cn('absolute pointer-events-none', className)}
    >
      <svg viewBox="0 0 400 300" className="w-full h-full">
        <defs>
          {/* Glass gradients */}
          <linearGradient id="tb-glassBody" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#5A7FBA" stopOpacity="0.58"/>
            <stop offset="18%" stopColor="#3E5E94" stopOpacity="0.52"/>
            <stop offset="52%" stopColor="#2A4470" stopOpacity="0.50"/>
            <stop offset="86%" stopColor="#1E3355" stopOpacity="0.52"/>
            <stop offset="100%" stopColor="#162848" stopOpacity="0.58"/>
          </linearGradient>

          <linearGradient id="tb-glassShine" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#E6F4FF" stopOpacity="0.38"/>
            <stop offset="18%" stopColor="#A8C8F0" stopOpacity="0.16"/>
            <stop offset="42%" stopColor="#6A9AD8" stopOpacity="0.06"/>
            <stop offset="100%" stopColor="#6A9AD8" stopOpacity="0"/>
          </linearGradient>

          <linearGradient id="tb-glassEdge" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#B8D4F8" stopOpacity="0.72"/>
            <stop offset="6%" stopColor="#8AB4E8" stopOpacity="0.38"/>
            <stop offset="14%" stopColor="#6A9AD8" stopOpacity="0.15"/>
            <stop offset="55%" stopColor="#5080C0" stopOpacity="0.20"/>
            <stop offset="92%" stopColor="#4070B0" stopOpacity="0.14"/>
            <stop offset="100%" stopColor="#64FFDA" stopOpacity="0.26"/>
          </linearGradient>

          {/* Filters */}
          <filter id="tb-shadow" x="-120%" y="-120%" width="340%" height="340%">
            <feDropShadow dx="0" dy="8" stdDeviation="12" floodColor="#000A14" floodOpacity="0.6"/>
            <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#64FFDA" floodOpacity="0.2"/>
          </filter>

          <filter id="tb-bubbleShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000A14" floodOpacity="0.6"/>
            <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#64FFDA" floodOpacity="0.3"/>
          </filter>

          <filter id="tb-textGlow" x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="0.9" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>

          {/* Thought cloud path */}
          <path id="tb-bubblePath" d="M 60 60 H 340 A 25 25 0 0 1 365 85 V 195 A 25 25 0 0 1 340 220 H 60 A 25 25 0 0 1 35 195 V 85 A 25 25 0 0 1 60 60 Z" />
        </defs>

        {/* Thought bubbles trailing to bottom-right */}
        <g filter="url(#tb-bubbleShadow)">
          <ellipse cx="340" cy="245" rx="18" ry="15" fill="url(#tb-glassBody)"/>
          <ellipse cx="340" cy="245" rx="18" ry="15" fill="url(#tb-glassShine)"/>
          <ellipse cx="340" cy="245" rx="18" ry="15" fill="none" stroke="url(#tb-glassEdge)" strokeWidth="1.2"/>

          <ellipse cx="362" cy="265" rx="11" ry="9" fill="url(#tb-glassBody)"/>
          <ellipse cx="362" cy="265" rx="11" ry="9" fill="url(#tb-glassShine)"/>
          <ellipse cx="362" cy="265" rx="11" ry="9" fill="none" stroke="url(#tb-glassEdge)" strokeWidth="1"/>

          <ellipse cx="378" cy="280" rx="6" ry="5" fill="url(#tb-glassBody)"/>
          <ellipse cx="378" cy="280" rx="6" ry="5" fill="url(#tb-glassShine)"/>
          <ellipse cx="378" cy="280" rx="6" ry="5" fill="none" stroke="url(#tb-glassEdge)" strokeWidth="0.8"/>
        </g>

        {/* Main thought cloud */}
        <g filter="url(#tb-shadow)">
          <use href="#tb-bubblePath" fill="url(#tb-glassBody)"/>
          <use href="#tb-bubblePath" fill="url(#tb-glassShine)"/>
          <use href="#tb-bubblePath" fill="none" stroke="url(#tb-glassEdge)" strokeWidth="1.5"/>
        </g>

        {/* Dynamic text */}
        <g filter="url(#tb-textGlow)">
          <text
            x="50"
            y="140"
            fontFamily="'Inter', sans-serif"
            fontSize="14"
            fill="#E6F4FF"
            opacity="0.95"
          >
            {text.split('\n').map((line, i) => (
              <tspan key={i} x="50" dy={i === 0 ? 0 : 20}>{line}</tspan>
            ))}
          </text>
          {/* Blinking cursor */}
          <rect x="50" y="148" width="8" height="14" fill="#64FFDA" opacity="0.8">
            <animate attributeName="opacity" values="0.8;0;0.8" dur="1s" repeatCount="indefinite"/>
          </rect>
        </g>
      </svg>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// RonExtraction - Main component
// ─────────────────────────────────────────────────────────────────────────────

const sizeMap = {
  sm: { width: 120, height: 90 },
  md: { width: 200, height: 150 },
  lg: { width: 300, height: 225 },
}

export function RonExtraction({
  isThinking = false,
  thinkingText = 'Processing...',
  size = 'md',
  className
}: RonExtractionProps) {
  const dimensions = sizeMap[size]

  return (
    <div
      className={cn('relative', className)}
      style={{ width: dimensions.width, height: dimensions.height }}
    >
      {/* Thought bubble - positioned to top-left when thinking */}
      <AnimatePresence>
        {isThinking && (
          <ThoughtBubble
            text={thinkingText}
            className="-top-[140px] -left-[80px] w-[280px] h-[210px]"
          />
        )}
      </AnimatePresence>

      {/* Main extraction blob */}
      <motion.div
        animate={isThinking ? {
          scale: [1, 1.05, 1],
        } : {}}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        className="w-full h-full"
      >
        <img
          src="/ron-extraction-blob.svg"
          alt="Ron"
          className="w-full h-full object-contain"
        />
      </motion.div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// RonExtractionInline - Smaller inline version for context menus
// ─────────────────────────────────────────────────────────────────────────────

interface RonExtractionInlineProps {
  isThinking?: boolean
  thinkingText?: string
  className?: string
}

export function RonExtractionInline({
  isThinking = false,
  thinkingText = 'Analyzing selection...',
  className
}: RonExtractionInlineProps) {
  return (
    <div className={cn('relative inline-flex items-center gap-3', className)}>
      <motion.div
        animate={isThinking ? {
          rotate: [0, 5, -5, 0],
          scale: [1, 1.1, 1],
        } : {}}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        className="w-8 h-8 flex-shrink-0"
      >
        <img
          src="/ron-extraction-blob.svg"
          alt="Ron"
          className="w-full h-full object-contain"
        />
      </motion.div>

      <AnimatePresence>
        {isThinking && (
          <motion.span
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            className="text-sm text-ink-muted dark:text-ink-inverse-muted"
          >
            {thinkingText}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

export default RonExtraction
