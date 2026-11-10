import { forwardRef } from 'react'
import type { LucideProps } from 'lucide-react'

/**
 * The Ren icon: a capital R drawn on the 24-unit icon grid with the same stroke as the app's line icons, in
 * `currentColor`. Marks anything Ren does (Ask Ren, Ren's suggestions, interests it learned). Takes the same props
 * as a lucide or heroicons icon (`className`, `size`, `strokeWidth`, `style`).
 */
export const RenIcon = forwardRef<SVGSVGElement, LucideProps>(function RenIcon(
  { size = 24, strokeWidth = 2.25, absoluteStrokeWidth: _absolute, color = 'currentColor', ...props }, ref,
) {
  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true} focusable="false" {...props}>
      <path d="M7 20V4h6a4.5 4.5 0 0 1 0 9H7" />
      <path d="m12.5 13 5 7" />
    </svg>
  )
})
