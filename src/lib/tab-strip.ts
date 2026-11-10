/**
 * Keyboard and scrolling rules for the tab strip and the sidebar's vertical tab list: the WAI-ARIA tabs pattern with
 * manual activation, plus keeping the active tab in view when the tabs overflow.
 *
 * Pure (no React, no DOM, no `@/` imports) so `node --experimental-strip-types` runs the colocated test.
 */

export type TabOrientation = 'horizontal' | 'vertical'

/**
 * The index of the tab that should take focus for `key`, or null when `key` does not move focus in a tablist.
 * Next and previous wrap around; Home and End go to the ends. Focus moves without selecting the tab (Enter or Space
 * selects it), because selecting a tab hands keyboard focus to the website it shows.
 */
export function tabFocusTarget(key: string, index: number, count: number, orientation: TabOrientation): number | null {
  if (count <= 0) return null
  const next = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
  const previous = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
  const from = Math.min(Math.max(index, 0), count - 1)
  if (key === next) return (from + 1) % count
  if (key === previous) return (from - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/** Delete and Backspace close the focused tab. */
export function isCloseTabKey(key: string): boolean {
  return key === 'Delete' || key === 'Backspace'
}

/**
 * The index (in the list before the close) of the tab that takes focus after the tab at `index` is closed: the next
 * one, or the previous one when the last tab was closed. -1 when no tab remains.
 */
export function focusAfterClose(index: number, count: number): number {
  if (count <= 1 || index < 0 || index >= count) return -1
  return index < count - 1 ? index + 1 : index - 1
}

/**
 * How far to scroll so the item spanning [start, start + size) is fully inside the view [viewStart, viewStart +
 * viewSize), keeping `margin` clear at both edges (where the overflow fade sits). 0 when it already is; an item larger
 * than the view is aligned to its start. Positions are in the scroller's content coordinates.
 */
export function revealDelta(start: number, size: number, viewStart: number, viewSize: number, margin = 0): number {
  const edge = Math.max(0, Math.min(margin, viewSize / 2))
  const low = viewStart + edge
  const high = viewStart + viewSize - edge
  if (start < low || size > high - low) return start - low
  if (start + size > high) return start + size - high
  return 0
}

/** Which ends of a scroller hide content (1px slack for sub-pixel layout). */
export function overflowEdges(scrollStart: number, viewSize: number, contentSize: number): { start: boolean; end: boolean } {
  return { start: scrollStart > 1, end: scrollStart + viewSize < contentSize - 1 }
}

/** A CSS mask that fades only the edges hiding content, `fade` px wide; undefined when nothing is hidden. */
export function edgeFadeMask(edges: { start: boolean; end: boolean }, fade: number): string | undefined {
  if (!edges.start && !edges.end) return undefined
  return `linear-gradient(to right, ${edges.start ? 'transparent' : '#000'} 0, #000 ${fade}px, #000 calc(100% - ${fade}px), ${edges.end ? 'transparent' : '#000'} 100%)`
}

/**
 * The sideways scroll for a wheel turn over a horizontal strip: a mostly vertical turn scrolls it (Chromium scrolls a
 * horizontal-only scroller with the wheel only while Shift is held); a horizontal one is left to the browser (0).
 * `deltaMode` 1 counts lines.
 */
export function horizontalWheelDelta(deltaX: number, deltaY: number, deltaMode = 0, lineHeight = 16): number {
  if (Math.abs(deltaY) <= Math.abs(deltaX)) return 0
  return deltaMode === 1 ? deltaY * lineHeight : deltaY
}
