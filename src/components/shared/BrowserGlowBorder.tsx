/**
 * Agent-activity frame: a crisp 2px volt hairline around the window while Electron browser
 * automation or screen capture is active. No glow, no pulse; it fades in and out with the state.
 */

import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { agentFrameOn, useAgentPresenceStore } from '@/stores/agentPresenceStore'

export function BrowserGlowBorder() {
  const show = useAgentPresenceStore(agentFrameOn)
  const prefersReducedMotion = useReducedMotion()

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.2, ease: 'easeOut' }}
          className="pointer-events-none fixed inset-0 z-[120] border-2 border-blurple-600 dark:border-blurple-400"
        />
      )}
    </AnimatePresence>
  )
}
