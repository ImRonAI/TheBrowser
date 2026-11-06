import type { WorkflowStepKind } from '@/lib/workflow'
import { cn } from '@/lib/utils'

/**
 * Flowchart symbols drawn in SVG. One geometry per kind serves the canvas nodes (full size) and the
 * builder's shape palette (thumbnails). `step` is drawn by the AI Elements Node card, not here.
 */

/** Colour of each symbol's outline and tint (text colour; the SVG uses currentColor). */
export const KIND_TONE: Record<WorkflowStepKind, string> = {
  start: 'text-success',
  end: 'text-ink-secondary dark:text-ink-inverse-secondary',
  step: 'text-ink-muted dark:text-ink-inverse-muted',
  decision: 'text-accent dark:text-accent-light',
  delay: 'text-warning',
  subprocess: 'text-ink-secondary dark:text-ink-inverse-secondary',
  manual: 'text-warning',
  automation: 'text-accent dark:text-accent-light',
  io: 'text-info',
  document: 'text-info',
  data: 'text-info',
}

/** Horizontal inset of the left/right connection points for slanted symbols, so arrows touch the outline. */
export function handleInset(kind: WorkflowStepKind, width: number, height: number): number {
  if (kind === 'io') return slant(height) / 2
  if (kind === 'manual') return Math.round(width * 0.09) / 2
  return 0
}

const slant = (height: number) => Math.round(height * 0.28)
const CYLINDER_RY = 0.11

/** Path data for a symbol in a width × height box, inset by half the stroke. */
export function shapePaths(kind: WorkflowStepKind, width: number, height: number): { body: string; detail?: string } {
  const w = width, h = height, i = 1
  switch (kind) {
    case 'start':
    case 'end': {
      const r = (h - 2 * i) / 2
      return { body: `M${i + r} ${i} H${w - i - r} A${r} ${r} 0 0 1 ${w - i - r} ${h - i} H${i + r} A${r} ${r} 0 0 1 ${i + r} ${i} Z` }
    }
    case 'decision':
      return { body: `M${w / 2} ${i} L${w - i} ${h / 2} L${w / 2} ${h - i} L${i} ${h / 2} Z` }
    case 'delay': {
      const r = (h - 2 * i) / 2
      return { body: `M${i} ${i} H${w - i - r} A${r} ${r} 0 0 1 ${w - i - r} ${h - i} H${i} Z` }
    }
    case 'subprocess': {
      const bar = Math.max(8, Math.round(w * 0.06))
      return {
        body: `M${i + 4} ${i} H${w - i - 4} Q${w - i} ${i} ${w - i} ${i + 4} V${h - i - 4} Q${w - i} ${h - i} ${w - i - 4} ${h - i} H${i + 4} Q${i} ${h - i} ${i} ${h - i - 4} V${i + 4} Q${i} ${i} ${i + 4} ${i} Z`,
        detail: `M${bar} ${i} V${h - i} M${w - bar} ${i} V${h - i}`,
      }
    }
    case 'manual': {
      const s = Math.round(w * 0.09)
      return { body: `M${i} ${i} H${w - i} L${w - i - s} ${h - i} H${i + s} Z` }
    }
    case 'automation': {
      const s = Math.round(h * 0.32)
      return { body: `M${i + s} ${i} H${w - i - s} L${w - i} ${h / 2} L${w - i - s} ${h - i} H${i + s} L${i} ${h / 2} Z` }
    }
    case 'io': {
      const s = slant(h)
      return { body: `M${i + s} ${i} H${w - i} L${w - i - s} ${h - i} H${i} Z` }
    }
    case 'document': {
      const wave = Math.round(h * 0.14)
      return { body: `M${i} ${i} H${w - i} V${h - wave - i} C${w * 0.72} ${h - 2.6 * wave} ${w * 0.3} ${h + 0.6 * wave} ${i} ${h - wave * 1.2} Z` }
    }
    case 'data': {
      const rx = (w - 2 * i) / 2, ry = Math.round(h * CYLINDER_RY)
      return {
        body: `M${i} ${ry + i} A${rx} ${ry} 0 0 1 ${w - i} ${ry + i} V${h - ry - i} A${rx} ${ry} 0 0 1 ${i} ${h - ry - i} Z`,
        detail: `M${i} ${ry + i} A${rx} ${ry} 0 0 0 ${w - i} ${ry + i}`,
      }
    }
    default:
      return { body: `M${i + 8} ${i} H${w - i - 8} Q${w - i} ${i} ${w - i} ${i + 8} V${h - i - 8} Q${w - i} ${h - i} ${w - i - 8} ${h - i} H${i + 8} Q${i} ${h - i} ${i} ${h - i - 8} V${i + 8} Q${i} ${i} ${i + 8} ${i} Z` }
  }
}

/** Padding that keeps a symbol's label inside its outline (CSS px at full size). */
export function labelInset(kind: WorkflowStepKind, width: number, height: number): { top: number; right: number; bottom: number; left: number } {
  switch (kind) {
    case 'decision': return { top: height * 0.2, right: width * 0.2, bottom: height * 0.2, left: width * 0.2 }
    case 'delay': return { top: 8, right: height * 0.35, bottom: 8, left: 14 }
    case 'subprocess': return { top: 8, right: Math.max(8, width * 0.06) + 8, bottom: 8, left: Math.max(8, width * 0.06) + 8 }
    case 'manual': return { top: 8, right: width * 0.1 + 6, bottom: 8, left: width * 0.1 + 6 }
    case 'automation': return { top: 8, right: height * 0.32 + 4, bottom: 8, left: height * 0.32 + 4 }
    case 'io': return { top: 8, right: slant(height) + 6, bottom: 8, left: slant(height) + 6 }
    case 'document': return { top: 8, right: 12, bottom: height * 0.2, left: 12 }
    case 'data': return { top: height * CYLINDER_RY * 2 + 4, right: 12, bottom: height * CYLINDER_RY + 4, left: 12 }
    default: return { top: 6, right: 16, bottom: 6, left: 16 }
  }
}

/** The symbol itself: tinted fill, outline in the kind's tone (thicker when selected). */
export function ShapeSymbol({ kind, width, height, selected, className }: {
  kind: WorkflowStepKind; width: number; height: number; selected?: boolean; className?: string
}) {
  const { body, detail } = shapePaths(kind, width, height)
  return (
    <svg aria-hidden width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn('absolute inset-0 overflow-visible', KIND_TONE[kind], className)}>
      <path d={body} className="fill-surface-0 dark:fill-surface-900" />
      <path d={body} fill="currentColor" fillOpacity={selected ? 0.16 : 0.08} stroke="currentColor" strokeWidth={selected ? 2.5 : 1.5} strokeLinejoin="round" />
      {detail && <path d={detail} fill="none" stroke="currentColor" strokeWidth={selected ? 2 : 1.25} />}
    </svg>
  )
}

/** A small preview of a symbol for menus and the palette. */
export function ShapeThumbnail({ kind, className }: { kind: WorkflowStepKind; className?: string }) {
  const [width, height] = kind === 'decision' ? [34, 24] : kind === 'data' ? [28, 26] : [38, 22]
  return (
    <span className={cn('relative inline-block shrink-0', className)} style={{ width: 40, height: 28 }}>
      <span className="absolute" style={{ left: (40 - width) / 2, top: (28 - height) / 2, width, height }}>
        <ShapeSymbol kind={kind} width={width} height={height} />
      </span>
    </span>
  )
}
