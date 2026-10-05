/**
 * Blurred royal frame shown while Electron browser automation or screen capture is active.
 */

import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import type { CSSProperties } from 'react'
import { agentFrameOn, useAgentPresenceStore } from '@/stores/agentPresenceStore'

const EDGE: CSSProperties = { filter: 'blur(18px)' }

export function BrowserGlowBorder() {
  const show = useAgentPresenceStore(agentFrameOn)
  const prefersReducedMotion = useReducedMotion()

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="pointer-events-none fixed inset-0 z-[120]"
        >
          <motion.div
            className="absolute inset-0"
            animate={prefersReducedMotion ? { opacity: 0.55 } : { opacity: [0.35, 0.7, 0.35] }}
            transition={prefersReducedMotion ? { duration: 0 } : { duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
          >
            <div className="absolute inset-x-0 top-0 h-16" style={{ ...EDGE, background: 'linear-gradient(to bottom, rgba(49, 46, 129, 0.9), rgba(45, 59, 135, 0.45), transparent)' }} />
            <div className="absolute inset-y-0 right-0 w-16" style={{ ...EDGE, background: 'linear-gradient(to left, rgba(76, 29, 149, 0.85), rgba(74, 59, 135, 0.4), transparent)' }} />
            <div className="absolute inset-x-0 bottom-0 h-16" style={{ ...EDGE, background: 'linear-gradient(to top, rgba(49, 46, 129, 0.9), rgba(45, 59, 135, 0.45), transparent)' }} />
            <div className="absolute inset-y-0 left-0 w-16" style={{ ...EDGE, background: 'linear-gradient(to right, rgba(76, 29, 149, 0.85), rgba(74, 59, 135, 0.4), transparent)' }} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
