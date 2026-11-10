import { useId } from 'react'
import { cn } from '@/utils/cn'
import { LOGOTYPE_DOT, LOGOTYPE_HEIGHT, LOGOTYPE_REN, LOGOTYPE_TOP, LOGOTYPE_WIDTH } from './logotype'

/** Fits the logotype into a 48-unit square: `share` of the width, centred on the x-height. */
function fitted(share: number) {
  const scale = (48 * share) / LOGOTYPE_WIDTH
  const x = (48 - LOGOTYPE_WIDTH * scale) / 2
  const y = 24 - (LOGOTYPE_TOP + LOGOTYPE_HEIGHT / 2) * scale
  return `translate(${x.toFixed(3)} ${y.toFixed(3)}) scale(${scale.toFixed(5)})`
}

/**
 * The square Ren mark: the ren. logotype on a volt tile (`tile`, white on blurple in every theme), or the logotype
 * alone fitted to the box (`glyph`: ink in `currentColor`, volt full stop). Use it where a square is needed (app
 * icon, avatars, favicons, the URL bar); use `RenWordmark` where the name sits in a line. See docs/brand.md § Logo.
 */
export function RenMark({ variant = 'tile', className, title }: {
  variant?: 'tile' | 'glyph'
  className?: string
  /** Accessible name. Omit for a decorative mark. */
  title?: string
}) {
  const gradient = `ren-tile-${useId().replace(/:/g, '')}`
  return (
    <svg viewBox="0 0 48 48" className={cn('shrink-0', className)} role={title ? 'img' : undefined}
      aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      {variant === 'tile' ? <>
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#7A73FF" />
            <stop offset="0.55" stopColor="#5543FF" />
            <stop offset="1" stopColor="#4533D8" />
          </linearGradient>
        </defs>
        <rect width="48" height="48" rx="10.8" fill={`url(#${gradient})`} />
        <g transform={fitted(0.8)} fill="#FFFFFF">
          <path d={LOGOTYPE_REN} />
          <path d={LOGOTYPE_DOT} />
        </g>
      </> : <g transform={fitted(1)}>
        <path d={LOGOTYPE_REN} fill="currentColor" />
        <path d={LOGOTYPE_DOT} className="text-volt" fill="currentColor" />
      </g>}
    </svg>
  )
}
