import { cn } from '@/utils/cn'
import { BRAND } from '@/lib/brand'
import { LOGOTYPE_DOT, LOGOTYPE_HEIGHT, LOGOTYPE_REN, LOGOTYPE_TOP, LOGOTYPE_WIDTH } from './logotype'

/**
 * The Ren logo: the "ren." logotype, ink in `currentColor` with a volt full stop. It is sized like text: the
 * letters are as tall as the x-height of the current font size, so `text-[22px]` reads like 22px display type.
 * `dotClassName` recolours the full stop where volt would vanish (e.g. `text-white` on a volt ground).
 */
export function RenWordmark({ className, dotClassName = 'text-volt' }: { className?: string; dotClassName?: string }) {
  return (
    <svg viewBox={`0 ${LOGOTYPE_TOP} ${LOGOTYPE_WIDTH} ${LOGOTYPE_HEIGHT}`} role="img" aria-label={BRAND.name} focusable="false"
      className={cn('inline-block shrink-0 select-none align-baseline', className)}
      style={{ height: `${LOGOTYPE_HEIGHT / 1000}em`, width: `${LOGOTYPE_WIDTH / 1000}em` }}>
      <path d={LOGOTYPE_REN} fill="currentColor" />
      <path d={LOGOTYPE_DOT} className={dotClassName} fill="currentColor" />
    </svg>
  )
}
