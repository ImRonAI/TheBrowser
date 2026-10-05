import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { CURSOR_SVG, CURSOR_TIP, type CursorPoint } from '@/lib/agent-cursor'
import { useAgentPresenceStore } from '@/stores/agentPresenceStore'

const EASE = [0.16, 1, 0.3, 1] as const

/** Glowing pointer. Page coordinates are viewport CSS pixels of the content area. */
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
        opacity: reduced ? 1 : [0.78, 1, 0.78],
      }}
      transition={{
        x: { duration: jump ? 0 : 0.45, ease: EASE },
        y: { duration: jump ? 0 : 0.45, ease: EASE },
        opacity: reduced ? { duration: 0 } : { duration: 5.5, repeat: Infinity, ease: 'easeInOut' },
      }}
    >
      <div dangerouslySetInnerHTML={{ __html: CURSOR_SVG }} />
    </motion.div>
  )
}
