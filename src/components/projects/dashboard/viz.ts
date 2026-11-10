import type { IssueStatus } from '@/types/projects'

/**
 * Chart color roles as CSS custom properties on the dashboard root, light and dark.
 *
 * Every value is a Ren palette token resolved by Tailwind's `theme()`, so the charts
 * follow the brand scales instead of carrying their own colors. Status series map to
 * the app-wide status colors in stacking order (done = emerald, review = sky,
 * in progress = volt blurple, blocked = danger). That set was validated with the
 * dataviz `validate_palette.js` against surface-0 (light) and surface-900 (dark): the
 * lightness band, chroma floor, CVD separation (worst adjacent pair volt/sky, deutan
 * ΔE 11.8), normal-vision floor (worst sky/emerald, ΔE 16.9) and 3:1 contrast all
 * pass in both modes; every chart still ships a legend and a table view. Backlog and
 * context series use the neutral surface-500; at-risk work uses the reserved danger
 * color with a label. Chart chrome (grid, axis, ticks) uses the surface and ink scales.
 */
export const VIZ_VARS = [
  '[--viz-done:theme(colors.emerald.600)]',
  '[--viz-review:theme(colors.sky.600)]',
  '[--viz-progress:theme(colors.blurple.600)]',
  '[--viz-blocked:theme(colors.danger)]',
  '[--viz-neutral:theme(colors.surface.500)]',
  '[--viz-critical:theme(colors.danger)]',
  '[--viz-grid:theme(colors.surface.200)] dark:[--viz-grid:theme(colors.surface.800)]',
  '[--viz-axis:theme(colors.surface.300)] dark:[--viz-axis:theme(colors.surface.700)]',
  '[--viz-tick:theme(colors.ink.muted)] dark:[--viz-tick:theme(colors.ink.inverse-muted)]',
  '[--viz-ink:theme(colors.ink.secondary)] dark:[--viz-ink:theme(colors.ink.inverse-secondary)]',
  '[--viz-surface:theme(colors.surface.0)] dark:[--viz-surface:theme(colors.surface.900)]',
].join(' ')

export const STATUS_COLOR: Record<IssueStatus, string> = {
  done: 'var(--viz-done)',
  review: 'var(--viz-review)',
  'in-progress': 'var(--viz-progress)',
  blocked: 'var(--viz-blocked)',
  backlog: 'var(--viz-neutral)',
}

export const COLOR = {
  neutral: 'var(--viz-neutral)',
  critical: 'var(--viz-critical)',
  grid: 'var(--viz-grid)',
  axis: 'var(--viz-axis)',
  tick: 'var(--viz-tick)',
  ink: 'var(--viz-ink)',
  surface: 'var(--viz-surface)',
}

/** Shared axis/grid props: recessive hairlines, muted tabular ticks. */
export const AXIS = {
  tick: { fill: COLOR.tick, fontSize: 11, style: { fontVariantNumeric: 'tabular-nums' } },
  axisLine: { stroke: COLOR.axis },
  tickLine: false,
} as const

export const CHART_HEIGHT = 240
export const CHART_MARGIN = { top: 8, right: 12, bottom: 0, left: 0 }

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
export const formatNumber = (value: number) => number.format(value)

export const formatDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
export const formatDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export const plural = (count: number, word: string) => `${formatNumber(count)} ${word}${count === 1 ? '' : 's'}`
export const formatDays = (days: number) => plural(days, 'day')
