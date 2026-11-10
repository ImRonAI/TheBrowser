import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

/**
 * A hand-drawn volt underline under one word of a hero heading (docs/brand.md § Motifs: marker).
 * The stroke draws itself once (`ren-marker-draw` in index.css) and stays put under reduced motion.
 */
export function Marker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('relative inline-block whitespace-nowrap', className)}>
      <span className="relative z-10">{children}</span>
      <svg aria-hidden focusable="false" viewBox="0 0 200 16" preserveAspectRatio="none"
        className="ren-marker pointer-events-none absolute -bottom-[0.1em] left-[-3%] z-0 h-[0.34em] w-[106%] text-volt">
        <path d="M3 11.5C38 5 82 3.5 122 6.5S182 12 197 5" fill="none" stroke="currentColor" strokeWidth="5"
          strokeLinecap="round" pathLength={1}
          style={{ strokeDasharray: 1, animation: 'ren-marker-draw 700ms cubic-bezier(0.19, 1, 0.22, 1) 150ms both' }} />
      </svg>
    </span>
  )
}
