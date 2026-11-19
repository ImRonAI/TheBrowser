/**
 * Pure multi-pane split-view state machine and DIP layout geometry for Electron tabs.
 *
 * Supported topologies (up to 4 panes in a clear shell):
 *   - `single`: standard full-content single view
 *   - `split-2`: 50/50 side-by-side columns (`left | right`)
 *   - `split-3-left`: 2x1 with two stacked on the left and one full-height on the right
 *   - `split-3-right`: 2x1 with one full-height on the left and two stacked on the right
 *   - `split-4`: 2x2 grid (`topLeft | topRight` over `bottomLeft | bottomRight`)
 *
 * Invariant: two horizontal rows stacked on top of each other (`1x2`) are NEVER produced
 * by any drag, unsplit, close, or agent action. Every non-single state tracks one
 * `groupedSlot` (representing the grouped tab strip) and 1-3 detached slots.
 *
 * Pure TypeScript (no React, DOM, or `@/` imports) so both Electron's main process and
 * `node --experimental-strip-types --test` execute this module directly.
 */

export type SplitPaneSlot =
  | 'left'
  | 'right'
  | 'topLeft'
  | 'bottomLeft'
  | 'topRight'
  | 'bottomRight'

export type SplitDropZone = SplitPaneSlot | 'regroup'

export type SplitLayoutPreset = '50-50' | '2x1-left' | '2x1-right' | '2x2'

export type SplitState =
  | { mode: 'single' }
  | {
      mode: 'split-2'
      panes: { left: string; right: string }
      groupedSlot: 'left' | 'right'
    }
  | {
      mode: 'split-3-left'
      panes: { topLeft: string; bottomLeft: string; right: string }
      groupedSlot: 'topLeft' | 'bottomLeft' | 'right'
    }
  | {
      mode: 'split-3-right'
      panes: { left: string; topRight: string; bottomRight: string }
      groupedSlot: 'left' | 'topRight' | 'bottomRight'
    }
  | {
      mode: 'split-4'
      panes: { topLeft: string; topRight: string; bottomLeft: string; bottomRight: string }
      groupedSlot: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
    }

export interface SplitRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SplitPaneBounds {
  slot: SplitPaneSlot
  tabId: string
  /** Full pane rectangle (including the clear header bar), used for internal panes and screenshot crops. */
  cellBounds: SplitRect
  /** Native WebContentsView rectangle below the clear pane header. */
  webContentsBounds: SplitRect
}

export const SINGLE_SPLIT_STATE: SplitState = { mode: 'single' }

/** Height in CSS px of the compact clear header rendered above each split pane. */
export const SPLIT_PANE_HEADER_HEIGHT = 30

/** Legacy hairline divider constant (1 DIP). */
export const SPLIT_DIVIDER_DIP = 1

/** Outer clear-shell breathing room (CSS px) around the split pane grid. */
export const SPLIT_SHELL_PADDING_PX = 8

/** Clear channel gap (CSS px) between split columns and stacked quadrants. */
export const SPLIT_PANE_GAP_PX = 10

/** Clear frame inset (CSS px) around left, right, and bottom of each pane's inner viewport. */
export const SPLIT_VIEWPORT_INSET_PX = 0

/** Outer pane card corner radius (CSS px). */
export const SPLIT_PANE_RADIUS_PX = 10

/** Concentric inner viewport corner radius (`SPLIT_PANE_RADIUS_PX - SPLIT_VIEWPORT_INSET_PX`). */
export const SPLIT_VIEWPORT_RADIUS_PX = 10

export interface SplitLayoutGeometryOptions {
  shellPaddingDip?: number
  viewportInsetDip?: number
}

const VALID_LAYOUTS = new Set<string>(['50-50', '2x1-left', '2x1-right', '2x2'])

export function isValidSplitLayoutPreset(value: unknown): value is SplitLayoutPreset {
  return typeof value === 'string' && VALID_LAYOUTS.has(value)
}

/** Map CLI / MCP position strings onto canonical `SplitPaneSlot`. Rejects horizontal row positions. */
export function positionToSplitSlot(position?: string): SplitPaneSlot {
  if (!position) return 'right'
  switch (position) {
    case 'left':
      return 'left'
    case 'right':
      return 'right'
    case 'top-left':
    case 'topLeft':
      return 'topLeft'
    case 'bottom-left':
    case 'bottomLeft':
      return 'bottomLeft'
    case 'top-right':
    case 'topRight':
      return 'topRight'
    case 'bottom-right':
    case 'bottomRight':
      return 'bottomRight'
    default:
      throw new Error(
        `Invalid split position "${position}". Horizontal row stacking is not supported; use left, right, top-left, bottom-left, top-right, or bottom-right.`,
      )
  }
}

/** Deterministic slot order for rendering and iteration. */
export function getSplitPaneEntries(state: SplitState): Array<[SplitPaneSlot, string]> {
  switch (state.mode) {
    case 'single':
      return []
    case 'split-2':
      return [
        ['left', state.panes.left],
        ['right', state.panes.right],
      ]
    case 'split-3-left':
      return [
        ['topLeft', state.panes.topLeft],
        ['bottomLeft', state.panes.bottomLeft],
        ['right', state.panes.right],
      ]
    case 'split-3-right':
      return [
        ['left', state.panes.left],
        ['topRight', state.panes.topRight],
        ['bottomRight', state.panes.bottomRight],
      ]
    case 'split-4':
      return [
        ['topLeft', state.panes.topLeft],
        ['topRight', state.panes.topRight],
        ['bottomLeft', state.panes.bottomLeft],
        ['bottomRight', state.panes.bottomRight],
      ]
  }
}

export function getSplitTabIds(state: SplitState): string[] {
  return getSplitPaneEntries(state).map(([, id]) => id)
}

export function getSlotForTab(state: SplitState, tabId: string): SplitPaneSlot | null {
  for (const [slot, id] of getSplitPaneEntries(state)) {
    if (id === tabId) return slot
  }
  return null
}

export function isTabInSplit(state: SplitState, tabId: string): boolean {
  return getSlotForTab(state, tabId) !== null
}

/**
 * Detached tabs are removed from the visual grouped tab strip (`TabBar` / `VerticalTabList`)
 * while remaining in `TabsManager` and `useTabStore.tabs`. The tab occupying `groupedSlot`
 * stays visible in the grouped tab strip as its active representative.
 */
export function isTabSplitDetached(state: SplitState, tabId: string): boolean {
  if (state.mode === 'single') return false
  const slot = getSlotForTab(state, tabId)
  return slot !== null && slot !== state.groupedSlot
}

export function getGroupedSlotTabId(state: SplitState): string | null {
  switch (state.mode) {
    case 'single':
      return null
    case 'split-2':
      return state.panes[state.groupedSlot]
    case 'split-3-left':
      return state.panes[state.groupedSlot]
    case 'split-3-right':
      return state.panes[state.groupedSlot]
    case 'split-4':
      return state.panes[state.groupedSlot]
  }
}

export function toSplitSummary(state: SplitState): {
  mode: SplitState['mode']
  panes: Record<string, string>
  groupedSlot: SplitPaneSlot | null
} {
  if (state.mode === 'single') {
    return { mode: 'single', panes: {}, groupedSlot: null }
  }
  const panes: Record<string, string> = {}
  for (const [slot, id] of getSplitPaneEntries(state)) {
    panes[slot] = id
  }
  return { mode: state.mode, panes, groupedSlot: state.groupedSlot }
}

function pickAnchorTab(
  tabId: string,
  orderedTabIds: readonly string[],
  activeTabId: string | null,
  excludeIds: ReadonlySet<string> = new Set([tabId]),
): string | null {
  if (activeTabId && !excludeIds.has(activeTabId) && orderedTabIds.includes(activeTabId)) {
    return activeTabId
  }
  const idx = orderedTabIds.indexOf(tabId)
  if (idx >= 0) {
    for (let offset = 1; offset < orderedTabIds.length; offset++) {
      const prev = idx - offset >= 0 ? orderedTabIds[idx - offset] : undefined
      if (prev && !excludeIds.has(prev)) return prev
      const next = idx + offset < orderedTabIds.length ? orderedTabIds[idx + offset] : undefined
      if (next && !excludeIds.has(next)) return next
    }
  }
  for (const candidate of orderedTabIds) {
    if (!excludeIds.has(candidate)) return candidate
  }
  return null
}

function setSlotTab<S extends Exclude<SplitState, { mode: 'single' }>>(
  state: S,
  slot: SplitPaneSlot,
  tabId: string,
): S {
  return {
    ...state,
    panes: {
      ...state.panes,
      [slot]: tabId,
    },
  }
}

function swapOrMoveExistingPane(
  state: Exclude<SplitState, { mode: 'single' }>,
  fromSlot: SplitPaneSlot,
  zone: SplitPaneSlot,
): SplitState {
  if (fromSlot === zone) return state

  const entries = new Map<SplitPaneSlot, string>(getSplitPaneEntries(state))
  const movingTabId = entries.get(fromSlot)
  if (!movingTabId) return state

  // Direct swap when `zone` is an active slot in the current topology.
  if (entries.has(zone)) {
    const targetTabId = entries.get(zone)!
    let nextGrouped: SplitPaneSlot = state.groupedSlot
    if (state.groupedSlot === fromSlot) nextGrouped = zone
    else if (state.groupedSlot === zone) nextGrouped = fromSlot

    const nextEntries = new Map(entries)
    nextEntries.set(fromSlot, targetTabId)
    nextEntries.set(zone, movingTabId)

    switch (state.mode) {
      case 'split-2':
        return {
          mode: 'split-2',
          panes: { left: nextEntries.get('left')!, right: nextEntries.get('right')! },
          groupedSlot: nextGrouped as 'left' | 'right',
        }
      case 'split-3-left':
        return {
          mode: 'split-3-left',
          panes: {
            topLeft: nextEntries.get('topLeft')!,
            bottomLeft: nextEntries.get('bottomLeft')!,
            right: nextEntries.get('right')!,
          },
          groupedSlot: nextGrouped as 'topLeft' | 'bottomLeft' | 'right',
        }
      case 'split-3-right':
        return {
          mode: 'split-3-right',
          panes: {
            left: nextEntries.get('left')!,
            topRight: nextEntries.get('topRight')!,
            bottomRight: nextEntries.get('bottomRight')!,
          },
          groupedSlot: nextGrouped as 'left' | 'topRight' | 'bottomRight',
        }
      case 'split-4':
        return {
          mode: 'split-4',
          panes: {
            topLeft: nextEntries.get('topLeft')!,
            topRight: nextEntries.get('topRight')!,
            bottomLeft: nextEntries.get('bottomLeft')!,
            bottomRight: nextEntries.get('bottomRight')!,
          },
          groupedSlot: nextGrouped as 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight',
        }
    }
  }

  // Cross-topology 3-pane move (e.g. moving topLeft/bottomLeft onto topRight/bottomRight in split-3-left).
  if (state.mode === 'split-3-left' && (fromSlot === 'topLeft' || fromSlot === 'bottomLeft')) {
    const remainingLeft = fromSlot === 'topLeft' ? state.panes.bottomLeft : state.panes.topLeft
    const putTop = zone === 'topRight'
    let nextGrouped: 'left' | 'topRight' | 'bottomRight' = 'left'
    if (state.groupedSlot === fromSlot) nextGrouped = putTop ? 'topRight' : 'bottomRight'
    else if (state.groupedSlot === 'right') nextGrouped = putTop ? 'bottomRight' : 'topRight'
    else nextGrouped = 'left'
    return {
      mode: 'split-3-right',
      panes: {
        left: remainingLeft,
        topRight: putTop ? movingTabId : state.panes.right,
        bottomRight: putTop ? state.panes.right : movingTabId,
      },
      groupedSlot: nextGrouped,
    }
  }

  if (state.mode === 'split-3-right' && (fromSlot === 'topRight' || fromSlot === 'bottomRight')) {
    const remainingRight = fromSlot === 'topRight' ? state.panes.bottomRight : state.panes.topRight
    const putTop = zone === 'topLeft'
    let nextGrouped: 'topLeft' | 'bottomLeft' | 'right' = 'right'
    if (state.groupedSlot === fromSlot) nextGrouped = putTop ? 'topLeft' : 'bottomLeft'
    else if (state.groupedSlot === 'left') nextGrouped = putTop ? 'bottomLeft' : 'topLeft'
    else nextGrouped = 'right'
    return {
      mode: 'split-3-left',
      panes: {
        topLeft: putTop ? movingTabId : state.panes.left,
        bottomLeft: putTop ? state.panes.left : movingTabId,
        right: remainingRight,
      },
      groupedSlot: nextGrouped,
    }
  }

  // In split-2, dropping `left` onto `topRight`/`bottomRight` or `right` onto `topLeft`/`bottomLeft` swaps columns.
  if (state.mode === 'split-2') {
    const targetSlot: 'left' | 'right' = fromSlot === 'left' ? 'right' : 'left'
    return swapOrMoveExistingPane(state, fromSlot, targetSlot)
  }

  return state
}

function insertFreshTabIntoSplit(
  state: Exclude<SplitState, { mode: 'single' }>,
  tabId: string,
  zone: SplitPaneSlot,
): SplitState {
  switch (state.mode) {
    case 'split-2': {
      const { left, right } = state.panes
      if (zone === 'topLeft') {
        return {
          mode: 'split-3-left',
          panes: { topLeft: tabId, bottomLeft: left, right },
          groupedSlot: state.groupedSlot === 'left' ? 'bottomLeft' : 'right',
        }
      }
      if (zone === 'bottomLeft' || zone === 'left') {
        return {
          mode: 'split-3-left',
          panes: { topLeft: left, bottomLeft: tabId, right },
          groupedSlot: state.groupedSlot === 'left' ? 'topLeft' : 'right',
        }
      }
      if (zone === 'topRight') {
        return {
          mode: 'split-3-right',
          panes: { left, topRight: tabId, bottomRight: right },
          groupedSlot: state.groupedSlot === 'right' ? 'bottomRight' : 'left',
        }
      }
      // zone === 'bottomRight' || zone === 'right'
      return {
        mode: 'split-3-right',
        panes: { left, topRight: right, bottomRight: tabId },
        groupedSlot: state.groupedSlot === 'right' ? 'topRight' : 'left',
      }
    }

    case 'split-3-left': {
      const { topLeft, bottomLeft, right } = state.panes
      if (zone === 'topRight') {
        return {
          mode: 'split-4',
          panes: { topLeft, topRight: tabId, bottomLeft, bottomRight: right },
          groupedSlot: state.groupedSlot === 'right' ? 'bottomRight' : state.groupedSlot,
        }
      }
      if (zone === 'bottomRight' || zone === 'right') {
        return {
          mode: 'split-4',
          panes: { topLeft, topRight: right, bottomLeft, bottomRight: tabId },
          groupedSlot: state.groupedSlot === 'right' ? 'topRight' : state.groupedSlot,
        }
      }
      // Dropping onto topLeft/bottomLeft replaces that left-quadrant tab.
      const replaceSlot: 'topLeft' | 'bottomLeft' = zone === 'topLeft' ? 'topLeft' : 'bottomLeft'
      return setSlotTab(state, replaceSlot, tabId)
    }

    case 'split-3-right': {
      const { left, topRight, bottomRight } = state.panes
      if (zone === 'topLeft') {
        return {
          mode: 'split-4',
          panes: { topLeft: tabId, topRight, bottomLeft: left, bottomRight },
          groupedSlot: state.groupedSlot === 'left' ? 'bottomLeft' : state.groupedSlot,
        }
      }
      if (zone === 'bottomLeft' || zone === 'left') {
        return {
          mode: 'split-4',
          panes: { topLeft: left, topRight, bottomLeft: tabId, bottomRight },
          groupedSlot: state.groupedSlot === 'left' ? 'topLeft' : state.groupedSlot,
        }
      }
      const replaceSlot: 'topRight' | 'bottomRight' = zone === 'topRight' ? 'topRight' : 'bottomRight'
      return setSlotTab(state, replaceSlot, tabId)
    }

    case 'split-4': {
      const targetSlot: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' =
        zone === 'left'
          ? 'topLeft'
          : zone === 'right'
            ? 'topRight'
            : zone
      return setSlotTab(state, targetSlot, tabId)
    }
  }
}

/**
 * Place `tabId` into `zone` (or return it to grouped tabs when `zone === 'regroup'`).
 *
 * - From `single`, requires `>= 2` tabs in `orderedTabIds`.
 * - If `tabId` currently occupies `groupedSlot` and is dragged from the grouped tab strip
 *   (`source === 'strip'`) while another grouped tab exists, that next grouped tab anchors
 *   `groupedSlot` so `tabId` detaches cleanly into the requested split zone.
 */
export function splitTabIntoZone(
  state: SplitState,
  tabId: string,
  zone: SplitDropZone,
  orderedTabIds: readonly string[],
  activeTabId: string | null,
  source: 'strip' | 'pane' = 'strip',
): { state: SplitState; activeTabId: string | null } {
  if (!orderedTabIds.includes(tabId)) {
    return { state, activeTabId }
  }

  if (zone === 'regroup') {
    const removed = removeTabFromSplit(state, tabId)
    return {
      state: removed.state,
      activeTabId: removed.survivingActiveTabId ?? activeTabId ?? tabId,
    }
  }

  if (state.mode === 'single') {
    const anchor = pickAnchorTab(tabId, orderedTabIds, activeTabId)
    if (!anchor) return { state, activeTabId }
    const placeLeft = zone === 'left' || zone === 'topLeft' || zone === 'bottomLeft'
    const nextState: SplitState = placeLeft
      ? { mode: 'split-2', panes: { left: tabId, right: anchor }, groupedSlot: 'right' }
      : { mode: 'split-2', panes: { left: anchor, right: tabId }, groupedSlot: 'left' }
    return { state: nextState, activeTabId: tabId }
  }

  const existingSlot = getSlotForTab(state, tabId)
  if (existingSlot !== null) {
    if (source === 'strip' && existingSlot === state.groupedSlot && state.mode !== 'split-4') {
      const inSplit = new Set(getSplitTabIds(state))
      const replacementGrouped = pickAnchorTab(tabId, orderedTabIds, null, inSplit)
      if (replacementGrouped) {
        const reanchored = setSlotTab(state, existingSlot, replacementGrouped)
        return {
          state: insertFreshTabIntoSplit(reanchored, tabId, zone),
          activeTabId: tabId,
        }
      }
    }
    return {
      state: swapOrMoveExistingPane(state, existingSlot, zone),
      activeTabId: tabId,
    }
  }

  return {
    state: insertFreshTabIntoSplit(state, tabId, zone),
    activeTabId: tabId,
  }
}

/**
 * Deterministic multi-pane layout builder for agent `playwright_Manage_tabs` calls.
 */
export function applySplitLayout(
  _state: SplitState,
  options: {
    layout: SplitLayoutPreset
    tabIds?: readonly string[] | undefined
    activeTabId: string | null
    orderedTabIds: readonly string[]
  },
): { state: SplitState; activeTabId: string | null } {
  const { layout, tabIds = [], activeTabId, orderedTabIds } = options
  if (!isValidSplitLayoutPreset(layout)) {
    throw new Error(
      `Invalid split layout "${String(layout)}". Supported layouts are 50-50, 2x1-left, 2x1-right, and 2x2 (horizontal stacked rows are not allowed).`,
    )
  }

  const needed = layout === '50-50' ? 2 : layout === '2x2' ? 4 : 3
  const chosen: string[] = []
  const addCandidate = (id: string | null | undefined) => {
    if (!id || chosen.includes(id)) return
    if (!orderedTabIds.includes(id)) {
      throw new Error(`No tab with id ${id}`)
    }
    chosen.push(id)
  }

  for (const id of tabIds) addCandidate(id)
  if (chosen.length < needed && activeTabId && orderedTabIds.includes(activeTabId)) {
    addCandidate(activeTabId)
  }
  for (const id of orderedTabIds) {
    if (chosen.length >= needed) break
    addCandidate(id)
  }

  if (chosen.length < needed) {
    throw new Error(
      `Cannot apply ${layout} split: requires at least ${needed} open tabs, but only ${orderedTabIds.length} open.`,
    )
  }

  const [c0 = '', c1 = '', c2 = '', c3 = ''] = chosen
  const nextActive = activeTabId && chosen.includes(activeTabId) ? activeTabId : c0

  switch (layout) {
    case '50-50':
      return {
        state: { mode: 'split-2', panes: { left: c0, right: c1 }, groupedSlot: 'left' },
        activeTabId: nextActive,
      }
    case '2x1-left':
      return {
        state: {
          mode: 'split-3-left',
          panes: { topLeft: c0, bottomLeft: c1, right: c2 },
          groupedSlot: 'topLeft',
        },
        activeTabId: nextActive,
      }
    case '2x1-right':
      return {
        state: {
          mode: 'split-3-right',
          panes: { left: c0, topRight: c1, bottomRight: c2 },
          groupedSlot: 'left',
        },
        activeTabId: nextActive,
      }
    case '2x2':
      return {
        state: {
          mode: 'split-4',
          panes: { topLeft: c0, topRight: c1, bottomLeft: c2, bottomRight: c3 },
          groupedSlot: 'topLeft',
        },
        activeTabId: nextActive,
      }
  }
}

/**
 * Selecting a tab while split:
 * - If `tabId` is already displayed in one of the split panes, keep the layout untouched.
 * - Otherwise `tabId` belongs to the grouped tab strip, so swap it into `groupedSlot`.
 */
export function selectTabInSplit(state: SplitState, tabId: string): SplitState {
  if (state.mode === 'single') return state
  if (isTabInSplit(state, tabId)) return state
  return setSlotTab(state, state.groupedSlot, tabId)
}

/**
 * Remove `tabId` from the split grid (used for both "Return to grouped tabs" and closing a tab).
 * Collapses `4 -> 3 -> 2 -> single` and NEVER produces a 2-row horizontal stack:
 *   - Removing `right` from `split-3-left` expands `topLeft` & `bottomLeft` into 50/50 `left | right`.
 *   - Removing `left` from `split-3-right` expands `topRight` & `bottomRight` into 50/50 `left | right`.
 */
export function removeTabFromSplit(
  state: SplitState,
  tabId: string,
): { state: SplitState; survivingActiveTabId: string | null } {
  if (state.mode === 'single') {
    return { state, survivingActiveTabId: null }
  }

  const slot = getSlotForTab(state, tabId)
  if (!slot) {
    return { state, survivingActiveTabId: null }
  }

  switch (state.mode) {
    case 'split-2': {
      const survivor = slot === 'left' ? state.panes.right : state.panes.left
      return { state: SINGLE_SPLIT_STATE, survivingActiveTabId: survivor }
    }

    case 'split-3-left': {
      const { topLeft, bottomLeft, right } = state.panes
      if (slot === 'topLeft') {
        return {
          state: {
            mode: 'split-2',
            panes: { left: bottomLeft, right },
            groupedSlot: state.groupedSlot === 'right' ? 'right' : 'left',
          },
          survivingActiveTabId: bottomLeft,
        }
      }
      if (slot === 'bottomLeft') {
        return {
          state: {
            mode: 'split-2',
            panes: { left: topLeft, right },
            groupedSlot: state.groupedSlot === 'right' ? 'right' : 'left',
          },
          survivingActiveTabId: topLeft,
        }
      }
      // slot === 'right': NEVER stack 2 rows; promote topLeft | bottomLeft to 50/50 columns!
      return {
        state: {
          mode: 'split-2',
          panes: { left: topLeft, right: bottomLeft },
          groupedSlot: state.groupedSlot === 'bottomLeft' ? 'right' : 'left',
        },
        survivingActiveTabId: topLeft,
      }
    }

    case 'split-3-right': {
      const { left, topRight, bottomRight } = state.panes
      if (slot === 'topRight') {
        return {
          state: {
            mode: 'split-2',
            panes: { left, right: bottomRight },
            groupedSlot: state.groupedSlot === 'left' ? 'left' : 'right',
          },
          survivingActiveTabId: bottomRight,
        }
      }
      if (slot === 'bottomRight') {
        return {
          state: {
            mode: 'split-2',
            panes: { left, right: topRight },
            groupedSlot: state.groupedSlot === 'left' ? 'left' : 'right',
          },
          survivingActiveTabId: topRight,
        }
      }
      // slot === 'left': NEVER stack 2 rows; promote topRight | bottomRight to 50/50 columns!
      return {
        state: {
          mode: 'split-2',
          panes: { left: topRight, right: bottomRight },
          groupedSlot: state.groupedSlot === 'bottomRight' ? 'right' : 'left',
        },
        survivingActiveTabId: topRight,
      }
    }

    case 'split-4': {
      const { topLeft, topRight, bottomLeft, bottomRight } = state.panes
      if (slot === 'topRight') {
        return {
          state: {
            mode: 'split-3-left',
            panes: { topLeft, bottomLeft, right: bottomRight },
            groupedSlot:
              state.groupedSlot === 'topRight' || state.groupedSlot === 'bottomRight'
                ? 'right'
                : state.groupedSlot,
          },
          survivingActiveTabId: bottomRight,
        }
      }
      if (slot === 'bottomRight') {
        return {
          state: {
            mode: 'split-3-left',
            panes: { topLeft, bottomLeft, right: topRight },
            groupedSlot:
              state.groupedSlot === 'topRight' || state.groupedSlot === 'bottomRight'
                ? 'right'
                : state.groupedSlot,
          },
          survivingActiveTabId: topRight,
        }
      }
      if (slot === 'topLeft') {
        return {
          state: {
            mode: 'split-3-right',
            panes: { left: bottomLeft, topRight, bottomRight },
            groupedSlot:
              state.groupedSlot === 'topLeft' || state.groupedSlot === 'bottomLeft'
                ? 'left'
                : state.groupedSlot,
          },
          survivingActiveTabId: bottomLeft,
        }
      }
      // slot === 'bottomLeft'
      return {
        state: {
          mode: 'split-3-right',
          panes: { left: topLeft, topRight, bottomRight },
          groupedSlot:
            state.groupedSlot === 'topLeft' || state.groupedSlot === 'bottomLeft'
              ? 'left'
              : state.groupedSlot,
        },
        survivingActiveTabId: topLeft,
      }
    }
  }
}

function makePaneBounds(
  slot: SplitPaneSlot,
  tabId: string,
  cell: SplitRect,
  paneHeaderDipHeight: number,
  viewportInsetDip = 0,
): SplitPaneBounds {
  const headerH = Math.min(cell.height, Math.max(0, Math.round(paneHeaderDipHeight)))
  const rawInset = Math.max(0, Math.round(viewportInsetDip))
  const insetX = Math.min(Math.floor(cell.width / 2), rawInset)
  const insetBottom = Math.min(Math.max(0, cell.height - headerH), rawInset)
  return {
    slot,
    tabId,
    cellBounds: cell,
    webContentsBounds: {
      x: cell.x + insetX,
      y: cell.y + headerH,
      width: Math.max(0, cell.width - insetX * 2),
      height: Math.max(0, cell.height - headerH - insetBottom),
    },
  }
}

export function computeSplitAxisSizes(
  total: number,
  divider: number,
): { first: number; secondOffset: number; second: number } {
  if (total <= 0) return { first: 0, secondOffset: 0, second: 0 }
  const sep = total > divider ? divider : 0
  const first = Math.max(0, Math.floor((total - sep) / 2))
  const secondOffset = first + sep
  const second = Math.max(0, total - secondOffset)
  return { first, secondOffset, second }
}

/**
 * Compute exact integer DIP rectangles for each visible split pane.
 * Supports optional `shellPaddingDip` (clear outer shell margin) and `viewportInsetDip`
 * (clear frame inset around left, right, and bottom of each pane's inner viewport) while
 * keeping zero-padding defaults for direct 4-argument callers.
 */
export function computeSplitLayoutBounds(
  area: SplitRect,
  split: SplitState,
  paneHeaderDipHeight = SPLIT_PANE_HEADER_HEIGHT,
  dividerDip = SPLIT_DIVIDER_DIP,
  options?: SplitLayoutGeometryOptions,
): SplitPaneBounds[] {
  if (split.mode === 'single') return []

  const rawPad = Math.max(0, Math.round(options?.shellPaddingDip ?? 0))
  const padX = Math.min(Math.floor(Math.max(0, area.width) / 2), rawPad)
  const padY = Math.min(Math.floor(Math.max(0, area.height) / 2), rawPad)
  const innerX = area.x + padX
  const innerY = area.y + padY
  const innerWidth = Math.max(0, area.width - padX * 2)
  const innerHeight = Math.max(0, area.height - padY * 2)
  const viewportInset = options?.viewportInsetDip ?? 0

  const cols = computeSplitAxisSizes(innerWidth, dividerDip)
  const rows = computeSplitAxisSizes(innerHeight, dividerDip)

  const leftFull: SplitRect = { x: innerX, y: innerY, width: cols.first, height: innerHeight }
  const rightFull: SplitRect = { x: innerX + cols.secondOffset, y: innerY, width: cols.second, height: innerHeight }

  const topLeft: SplitRect = { x: innerX, y: innerY, width: cols.first, height: rows.first }
  const bottomLeft: SplitRect = { x: innerX, y: innerY + rows.secondOffset, width: cols.first, height: rows.second }
  const topRight: SplitRect = { x: innerX + cols.secondOffset, y: innerY, width: cols.second, height: rows.first }
  const bottomRight: SplitRect = {
    x: innerX + cols.secondOffset,
    y: innerY + rows.secondOffset,
    width: cols.second,
    height: rows.second,
  }

  switch (split.mode) {
    case 'split-2':
      return [
        makePaneBounds('left', split.panes.left, leftFull, paneHeaderDipHeight, viewportInset),
        makePaneBounds('right', split.panes.right, rightFull, paneHeaderDipHeight, viewportInset),
      ]
    case 'split-3-left':
      return [
        makePaneBounds('topLeft', split.panes.topLeft, topLeft, paneHeaderDipHeight, viewportInset),
        makePaneBounds('bottomLeft', split.panes.bottomLeft, bottomLeft, paneHeaderDipHeight, viewportInset),
        makePaneBounds('right', split.panes.right, rightFull, paneHeaderDipHeight, viewportInset),
      ]
    case 'split-3-right':
      return [
        makePaneBounds('left', split.panes.left, leftFull, paneHeaderDipHeight, viewportInset),
        makePaneBounds('topRight', split.panes.topRight, topRight, paneHeaderDipHeight, viewportInset),
        makePaneBounds('bottomRight', split.panes.bottomRight, bottomRight, paneHeaderDipHeight, viewportInset),
      ]
    case 'split-4':
      return [
        makePaneBounds('topLeft', split.panes.topLeft, topLeft, paneHeaderDipHeight, viewportInset),
        makePaneBounds('topRight', split.panes.topRight, topRight, paneHeaderDipHeight, viewportInset),
        makePaneBounds('bottomLeft', split.panes.bottomLeft, bottomLeft, paneHeaderDipHeight, viewportInset),
        makePaneBounds('bottomRight', split.panes.bottomRight, bottomRight, paneHeaderDipHeight, viewportInset),
      ]
  }
}

/**
 * Hit-test pointer coordinates (in CSS px of `mainWindow`) during a tab or pane drag.
 * Never returns a horizontal 2-row drop zone.
 */
export function hitTestSplitDropZone(
  point: { x: number; y: number },
  chromeBottom: number,
  sidebarRight: number,
  contentArea: SplitRect,
  split: SplitState,
  options?: { allowRegroup?: boolean; draggedSlot?: SplitPaneSlot | null },
): SplitDropZone | null {
  const allowRegroup = options?.allowRegroup ?? true

  // Above content area (over toolbar / tab strip) or over open left sidebar -> regroup.
  if (point.y < chromeBottom || point.x < sidebarRight) {
    return allowRegroup ? 'regroup' : null
  }

  // Outside the content area (e.g. over right-hand AgentPanel).
  if (
    point.x < contentArea.x ||
    point.x > contentArea.x + contentArea.width ||
    point.y < contentArea.y ||
    point.y > contentArea.y + contentArea.height ||
    contentArea.width <= 0 ||
    contentArea.height <= 0
  ) {
    return null
  }

  const isLeft = point.x < contentArea.x + contentArea.width / 2
  const isTop = point.y < contentArea.y + contentArea.height / 2

  if (split.mode === 'single') {
    return isLeft ? 'left' : 'right'
  }

  // When rearranging a pane in split-2 via its header, only left/right column swaps apply.
  if (split.mode === 'split-2' && options?.draggedSlot) {
    const slot: SplitPaneSlot = isLeft ? 'left' : 'right'
    return slot === options.draggedSlot ? null : slot
  }

  // From split-2 (adding 3rd tab) or split-3-* / split-4: quadrants expand to 2x1 or 2x2 (never 2 rows).
  const quadrant: SplitPaneSlot = isLeft
    ? isTop
      ? 'topLeft'
      : 'bottomLeft'
    : isTop
      ? 'topRight'
      : 'bottomRight'

  if (options?.draggedSlot && quadrant === options.draggedSlot) {
    return null
  }

  return quadrant
}

/**
 * Resolve the resulting topology preset that dropping into `zone` from `splitMode` produces,
 * so drop-zone HUD previews render an accurate miniature layout diagram.
 */
export function resolveDropTargetTopology(
  splitMode: SplitState['mode'],
  zone: SplitDropZone,
): SplitLayoutPreset | 'regroup' {
  if (zone === 'regroup') return 'regroup'
  if (splitMode === 'single') return '50-50'
  if (splitMode === 'split-2') {
    if (zone === 'left' || zone === 'right') return '50-50'
    return zone === 'topLeft' || zone === 'bottomLeft' ? '2x1-left' : '2x1-right'
  }
  if (splitMode === 'split-3-left') {
    return zone === 'topRight' || zone === 'bottomRight' || zone === 'right' ? '2x2' : '2x1-left'
  }
  if (splitMode === 'split-3-right') {
    return zone === 'topLeft' || zone === 'bottomLeft' || zone === 'left' ? '2x2' : '2x1-right'
  }
  return '2x2'
}

/**
 * Compute the preview highlight rectangle (relative to `area`, i.e. local `{ x: 0..w, y: 0..h }`)
 * for `SplitDropSurface` during an active pointer drag, matching exact split cell geometry.
 */
export function computeDropZonePreviewBounds(
  area: SplitRect,
  zone: SplitDropZone,
  options?: { shellPaddingDip?: number; gapDip?: number },
): SplitRect {
  const rawPad = Math.max(0, Math.round(options?.shellPaddingDip ?? SPLIT_SHELL_PADDING_PX))
  const gap = Math.max(1, Math.round(options?.gapDip ?? SPLIT_PANE_GAP_PX))
  const padX = Math.min(Math.floor(Math.max(0, area.width) / 2), rawPad)
  const padY = Math.min(Math.floor(Math.max(0, area.height) / 2), rawPad)

  if (zone === 'regroup') {
    return {
      x: padX,
      y: padY,
      width: Math.max(0, area.width - padX * 2),
      height: Math.min(44, Math.max(0, area.height - padY * 2)),
    }
  }

  const innerW = Math.max(0, area.width - padX * 2)
  const innerH = Math.max(0, area.height - padY * 2)
  const cols = computeSplitAxisSizes(innerW, gap)
  const rows = computeSplitAxisSizes(innerH, gap)

  switch (zone) {
    case 'left':
      return { x: padX, y: padY, width: cols.first, height: innerH }
    case 'right':
      return { x: padX + cols.secondOffset, y: padY, width: cols.second, height: innerH }
    case 'topLeft':
      return { x: padX, y: padY, width: cols.first, height: rows.first }
    case 'bottomLeft':
      return { x: padX, y: padY + rows.secondOffset, width: cols.first, height: rows.second }
    case 'topRight':
      return { x: padX + cols.secondOffset, y: padY, width: cols.second, height: rows.first }
    case 'bottomRight':
      return { x: padX + cols.secondOffset, y: padY + rows.secondOffset, width: cols.second, height: rows.second }
  }
}
