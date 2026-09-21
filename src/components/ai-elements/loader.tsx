/**
 * Loader Component
 * 
 * Animated loading indicators for AI processing states.
 */

import { motion } from 'framer-motion'
import { cn } from '@/utils/cn'

// ─────────────────────────────────────────────────────────────────────────────
// Loader (Spinner)
// ─────────────────────────────────────────────────────────────────────────────

interface LoaderProps {
  size?: number
  className?: string
}

export function Loader({ size = 16, className }: LoaderProps) {
  return (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      style={{ width: size, height: size }}
      className={className}
    >
      <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
        <circle 
          cx="12" 
          cy="12" 
          r="10" 
          stroke="currentColor" 
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="60"
          strokeDashoffset="20"
          className="text-accent dark:text-accent-light"
        />
      </svg>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LoaderDots
// ─────────────────────────────────────────────────────────────────────────────

interface LoaderDotsProps {
  className?: string
}

export function LoaderDots({ className }: LoaderDotsProps) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          animate={{ 
            y: [0, -4, 0],
            opacity: [0.5, 1, 0.5]
          }}
          transition={{ 
            duration: 0.6, 
            repeat: Infinity, 
            delay: i * 0.15,
            ease: 'easeInOut'
          }}
          className="w-1.5 h-1.5 rounded-full bg-accent dark:bg-accent-light"
        />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LoaderPulse
// ─────────────────────────────────────────────────────────────────────────────

interface LoaderPulseProps {
  size?: number
  className?: string
}

export function LoaderPulse({ size = 24, className }: LoaderPulseProps) {
  return (
    <div 
      className={cn('relative', className)}
      style={{ width: size, height: size }}
    >
      <motion.div
        animate={{ 
          scale: [1, 1.5, 1],
          opacity: [0.5, 0, 0.5]
        }}
        transition={{ 
          duration: 1.5, 
          repeat: Infinity, 
          ease: 'easeInOut'
        }}
        className="absolute inset-0 rounded-full bg-accent dark:bg-accent-light"
      />
      <div className="absolute inset-1 rounded-full bg-accent dark:bg-accent-light" />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LoaderBar (Progress)
// ─────────────────────────────────────────────────────────────────────────────

interface LoaderBarProps {
  progress?: number // 0-100
  indeterminate?: boolean
  className?: string
}

export function LoaderBar({ progress, indeterminate = false, className }: LoaderBarProps) {
  return (
    <div className={cn('w-full h-1 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden', className)}>
      {indeterminate ? (
        <motion.div
          animate={{ x: ['-100%', '100%'] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          className="w-1/3 h-full bg-accent dark:bg-accent-light rounded-full"
        />
      ) : (
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress || 0}%` }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="h-full bg-accent dark:bg-accent-light rounded-full"
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ThinkingIndicator
// ─────────────────────────────────────────────────────────────────────────────

interface ThinkingIndicatorProps {
  text?: string
  className?: string
}

export function ThinkingIndicator({ text = 'Thinking...', className }: ThinkingIndicatorProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={cn(
        'flex items-center gap-2',
        'px-4 py-3 rounded-2xl',
        'bg-surface-100 dark:bg-surface-800',
        className
      )}
    >
      <Loader size={14} />
      <span className="text-body-sm text-ink-muted dark:text-ink-inverse-muted">
        {text}
      </span>
    </motion.div>
  )
}
