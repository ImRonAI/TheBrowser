import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { CURSOR_TIP, type CursorPoint } from '@/lib/agent-cursor'
import { useAgentPresenceStore } from '@/stores/agentPresenceStore'

const EASE = [0.16, 1, 0.3, 1] as const

/** The pointer outline from `CURSOR_SVG` (lib/agent-cursor.ts), tip at (CURSOR_TIP, CURSOR_TIP). */
const POINTER_PATH = 'M4 4 L4 22 L10.2 16.4 L14.6 24 L18.2 22.4 L13.8 15 L22 15 Z'

/** Volt pointer with a paper outline, legible on any content. Page coordinates are viewport CSS
 *  pixels of the content area. Steady: it moves with the agent, it does not pulse. */
export function AgentCursor() {
  const points = useAgentPresenceStore((state) => state.cursorPoints)
  const seq = useAgentPresenceStore((state) => state.cursorSeq)
  const reduced = useReducedMotion()
  const [point, setPoint] = useState<CursorPoint | null>(null)
  const placed = useRef(false)

  useEffect(() => {
    if (!points.length) return
    let cancelled = false
    let timer = 0
    let index = 0
    const step = () => {
      if (cancelled) return
      const next = points[index]
      setPoint(next)
      void window.electron?.browser?.setAgentCursor?.(next)
      index += 1
      if (index < points.length) timer = window.setTimeout(step, reduced ? 0 : 450)
    }
    step()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [points, seq, reduced])

  useEffect(() => {
    if (point) placed.current = true
  }, [point])

  if (!point) return null
  const jump = !placed.current || reduced === true
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 z-40"
      initial={false}
      animate={{
        x: point.x - CURSOR_TIP,
        y: point.y - CURSOR_TIP,
      }}
      transition={{
        x: { duration: jump ? 0 : 0.45, ease: EASE },
        y: { duration: jump ? 0 : 0.45, ease: EASE },
      }}
    >
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" focusable="false" className="drop-shadow">
        <path
          d={POINTER_PATH}
          className="fill-blurple-600 stroke-surface-0 dark:fill-blurple-400"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </svg>
    </motion.div>
  )
}
