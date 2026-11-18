import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SINGLE_SPLIT_STATE,
  SPLIT_PANE_GAP_PX,
  SPLIT_PANE_HEADER_HEIGHT,
  SPLIT_SHELL_PADDING_PX,
  SPLIT_VIEWPORT_INSET_PX,
  applySplitLayout,
  computeDropZonePreviewBounds,
  computeSplitLayoutBounds,
  getSlotForTab,
  getSplitTabIds,
  hitTestSplitDropZone,
  isTabSplitDetached,
  positionToSplitSlot,
  removeTabFromSplit,
  resolveDropTargetTopology,
  selectTabInSplit,
  splitTabIntoZone,
  toSplitSummary,
  type SplitState,
} from './tab-split.ts'

function assertValidSplitInvariants(state: SplitState, allTabs: readonly string[]) {
  const validModes = new Set(['single', 'split-2', 'split-3-left', 'split-3-right', 'split-4'])
  assert.ok(validModes.has(state.mode), `unexpected mode ${state.mode}`)
  const ids = getSplitTabIds(state)
  assert.equal(new Set(ids).size, ids.length, 'every split pane must hold a unique tabId')
  if (state.mode !== 'single') {
    assert.ok(ids.length >= 2 && ids.length <= 4)
    const groupedTab = state.panes[state.groupedSlot as keyof typeof state.panes]
    assert.ok(groupedTab, 'groupedSlot must exist in panes')
    assert.equal(isTabSplitDetached(state, groupedTab), false, 'groupedSlot tab remains in grouped strip')
    const detached = allTabs.filter((id) => isTabSplitDetached(state, id))
    assert.equal(detached.length, ids.length - 1, 'exactly K - 1 tabs are detached from grouped strip')
  }
}

test('single -> 50/50 -> 2x1 (left & right) -> 2x2 and 5th-tab quadrant swap', () => {
  const tabs = ['t1', 't2', 't3', 't4', 't5']

  // Single tab alone cannot split
  assert.equal(splitTabIntoZone(SINGLE_SPLIT_STATE, 't1', 'right', ['t1'], 't1').state.mode, 'single')

  // Drag t2 to right -> 50/50 with t1 anchored in groupedSlot ('left')
  const s2 = splitTabIntoZone(SINGLE_SPLIT_STATE, 't2', 'right', tabs, 't1')
  assert.deepEqual(s2.state, {
    mode: 'split-2',
    panes: { left: 't1', right: 't2' },
    groupedSlot: 'left',
  })
  assert.equal(s2.activeTabId, 't2')
  assertValidSplitInvariants(s2.state, tabs)

  // Drag t3 to bottomLeft -> 2x1 left-stacked (`split-3-left`)
  const s3Left = splitTabIntoZone(s2.state, 't3', 'bottomLeft', tabs, s2.activeTabId)
  assert.deepEqual(s3Left.state, {
    mode: 'split-3-left',
    panes: { topLeft: 't1', bottomLeft: 't3', right: 't2' },
    groupedSlot: 'topLeft',
  })
  assertValidSplitInvariants(s3Left.state, tabs)

  // Alternatively drag t3 to topRight from s2 -> 2x1 right-stacked (`split-3-right`)
  const s3Right = splitTabIntoZone(s2.state, 't3', 'topRight', tabs, s2.activeTabId)
  assert.deepEqual(s3Right.state, {
    mode: 'split-3-right',
    panes: { left: 't1', topRight: 't3', bottomRight: 't2' },
    groupedSlot: 'left',
  })
  assertValidSplitInvariants(s3Right.state, tabs)

  // Drag t4 to topRight from s3Left -> 2x2 (`split-4`)
  const s4 = splitTabIntoZone(s3Left.state, 't4', 'topRight', tabs, s3Left.activeTabId)
  assert.deepEqual(s4.state, {
    mode: 'split-4',
    panes: { topLeft: 't1', topRight: 't4', bottomLeft: 't3', bottomRight: 't2' },
    groupedSlot: 'topLeft',
  })
  assertValidSplitInvariants(s4.state, tabs)

  // Dragging 5th tab t5 into bottomRight swaps out t2 back to grouped tabs, keeping max 4 panes
  const s4Swap = splitTabIntoZone(s4.state, 't5', 'bottomRight', tabs, s4.activeTabId)
  assert.deepEqual(s4Swap.state, {
    mode: 'split-4',
    panes: { topLeft: 't1', topRight: 't4', bottomLeft: 't3', bottomRight: 't5' },
    groupedSlot: 'topLeft',
  })
  assert.equal(isTabSplitDetached(s4Swap.state, 't2'), false, 't2 returned to grouped strip')
  assert.equal(isTabSplitDetached(s4Swap.state, 't5'), true, 't5 detached into bottomRight')
  assertValidSplitInvariants(s4Swap.state, tabs)
})

test('dragging the active tab from single mode picks nearest remaining tab as grouped anchor', () => {
  const res = splitTabIntoZone(SINGLE_SPLIT_STATE, 't1', 'left', ['t1', 't2', 't3'], 't1')
  assert.deepEqual(res.state, {
    mode: 'split-2',
    panes: { left: 't1', right: 't2' },
    groupedSlot: 'right',
  })
  assertValidSplitInvariants(res.state, ['t1', 't2', 't3'])
})

test('dragging groupedSlot tab from strip while another grouped tab exists re-anchors groupedSlot and expands split', () => {
  const tabs = ['t1', 't2', 't3']
  const s2 = splitTabIntoZone(SINGLE_SPLIT_STATE, 't2', 'right', tabs, 't1')
  // t1 is in groupedSlot ('left'), t3 is waiting in TabBar. User drags t1 from TabBar to bottomRight:
  const s3 = splitTabIntoZone(s2.state, 't1', 'bottomRight', tabs, 't1', 'strip')
  assert.deepEqual(s3.state, {
    mode: 'split-3-right',
    panes: { left: 't3', topRight: 't2', bottomRight: 't1' },
    groupedSlot: 'left',
  })
  assertValidSplitInvariants(s3.state, tabs)
})

test('selecting grouped vs detached tabs preserves pinned split panes via groupedSlot', () => {
  const tabs = ['t1', 't2', 't3']
  const { state } = splitTabIntoZone(SINGLE_SPLIT_STATE, 't2', 'right', tabs, 't1')
  // Selecting detached t2 keeps panes unchanged
  assert.deepEqual(selectTabInSplit(state, 't2'), state)
  // Selecting grouped t3 swaps t3 into groupedSlot ('left'), keeping t2 pinned on right
  const afterSelect = selectTabInSplit(state, 't3')
  assert.deepEqual(afterSelect, {
    mode: 'split-2',
    panes: { left: 't3', right: 't2' },
    groupedSlot: 'left',
  })
  assertValidSplitInvariants(afterSelect, tabs)
})

test('removing or closing ANY pane collapses 4 -> 3 -> 2 -> single and NEVER creates 2 horizontal rows', () => {
  const tabs = ['t1', 't2', 't3', 't4']
  const { state: s4 } = applySplitLayout(SINGLE_SPLIT_STATE, {
    layout: '2x2',
    tabIds: tabs,
    activeTabId: 't1',
    orderedTabIds: tabs,
  })

  // Remove topRight -> split-3-left
  const r1 = removeTabFromSplit(s4, 't2')
  assert.equal(r1.state.mode, 'split-3-left')
  assertValidSplitInvariants(r1.state, tabs)

  // CRITICAL: Remove `right` ('t4') from split-3-left -> MUST become 50/50 columns (`split-2`), NEVER 2 stacked rows!
  const r2 = removeTabFromSplit(r1.state, 't4')
  assert.deepEqual(r2.state, {
    mode: 'split-2',
    panes: { left: 't1', right: 't3' },
    groupedSlot: 'left',
  })
  assertValidSplitInvariants(r2.state, tabs)

  // Similarly, removing `left` from split-3-right -> MUST become 50/50 columns (`split-2`)!
  const { state: s3Right } = applySplitLayout(SINGLE_SPLIT_STATE, {
    layout: '2x1-right',
    tabIds: ['t1', 't2', 't3'],
    activeTabId: 't1',
    orderedTabIds: tabs,
  })
  const rRight = removeTabFromSplit(s3Right, 't1')
  assert.deepEqual(rRight.state, {
    mode: 'split-2',
    panes: { left: 't2', right: 't3' },
    groupedSlot: 'left',
  })
  assertValidSplitInvariants(rRight.state, tabs)

  // Removing from split-2 -> single
  const rSingle = removeTabFromSplit(r2.state, 't3')
  assert.deepEqual(rSingle.state, SINGLE_SPLIT_STATE)
  assert.equal(rSingle.survivingActiveTabId, 't1')

  // Removing a background tab not in split leaves split untouched
  assert.deepEqual(removeTabFromSplit(r2.state, 't4').state, r2.state)
})

test('pane header rearrange swaps slots and regroups cleanly', () => {
  const tabs = ['t1', 't2', 't3']
  const { state: s2 } = splitTabIntoZone(SINGLE_SPLIT_STATE, 't2', 'right', tabs, 't1')
  const swapped = splitTabIntoZone(s2, 't2', 'left', tabs, 't2', 'pane')
  assert.deepEqual(swapped.state, {
    mode: 'split-2',
    panes: { left: 't2', right: 't1' },
    groupedSlot: 'right',
  })
  assert.equal(getSlotForTab(swapped.state, 't2'), 'left')

  const regrouped = splitTabIntoZone(swapped.state, 't2', 'regroup', tabs, 't2', 'pane')
  assert.deepEqual(regrouped.state, SINGLE_SPLIT_STATE)
  assert.equal(regrouped.activeTabId, 't1')
})

test('applySplitLayout and positionToSplitSlot reject horizontal row layouts and missing tabs', () => {
  assert.throws(() => positionToSplitSlot('top' as string), /Horizontal row stacking is not supported/)
  assert.throws(() => positionToSplitSlot('bottom' as string), /Horizontal row stacking is not supported/)
  assert.throws(
    () =>
      applySplitLayout(SINGLE_SPLIT_STATE, {
        layout: '1x2' as unknown as '50-50',
        activeTabId: 't1',
        orderedTabIds: ['t1', 't2'],
      }),
    /Invalid split layout/,
  )
  assert.throws(
    () =>
      applySplitLayout(SINGLE_SPLIT_STATE, {
        layout: '2x2',
        activeTabId: 't1',
        orderedTabIds: ['t1', 't2', 't3'],
      }),
    /Cannot apply 2x2 split: requires at least 4 open tabs/,
  )

  const summary = toSplitSummary(
    applySplitLayout(SINGLE_SPLIT_STATE, {
      layout: '50-50',
      orderedTabIds: ['a', 'b'],
      activeTabId: 'a',
    }).state,
  )
  assert.deepEqual(summary, { mode: 'split-2', panes: { left: 'a', right: 'b' }, groupedSlot: 'left' })
})

test('computeSplitLayoutBounds produces non-overlapping DIP rectangles across odd dimensions', () => {
  const area = { x: 304, y: 89, width: 1001, height: 713 }
  const { state: s4 } = applySplitLayout(SINGLE_SPLIT_STATE, {
    layout: '2x2',
    orderedTabIds: ['a', 'b', 'c', 'd'],
    activeTabId: 'a',
  })
  const bounds = computeSplitLayoutBounds(area, s4, SPLIT_PANE_HEADER_HEIGHT, 1)
  assert.equal(bounds.length, 4)

  const [tl, tr, bl, br] = bounds
  // Exact 1 DIP separator between columns and rows, spanning full width and height
  assert.equal(tl.cellBounds.width + 1 + tr.cellBounds.width, area.width)
  assert.equal(tl.cellBounds.height + 1 + bl.cellBounds.height, area.height)
  assert.equal(tr.cellBounds.x, tl.cellBounds.x + tl.cellBounds.width + 1)
  assert.equal(bl.cellBounds.y, tl.cellBounds.y + tl.cellBounds.height + 1)
  assert.equal(br.webContentsBounds.y, br.cellBounds.y + SPLIT_PANE_HEADER_HEIGHT)
  assert.equal(br.webContentsBounds.height, br.cellBounds.height - SPLIT_PANE_HEADER_HEIGHT)
})

test('hitTestSplitDropZone resolves regroup, 50/50 halves, and 2x1/2x2 quadrants', () => {
  const content = { x: 300, y: 88, width: 800, height: 600 }
  assert.equal(hitTestSplitDropZone({ x: 400, y: 40 }, 88, 300, content, SINGLE_SPLIT_STATE), 'regroup')
  assert.equal(hitTestSplitDropZone({ x: 120, y: 200 }, 88, 300, content, SINGLE_SPLIT_STATE), 'regroup')
  assert.equal(hitTestSplitDropZone({ x: 1200, y: 200 }, 88, 300, content, SINGLE_SPLIT_STATE), null)

  assert.equal(hitTestSplitDropZone({ x: 450, y: 300 }, 88, 300, content, SINGLE_SPLIT_STATE), 'left')
  assert.equal(hitTestSplitDropZone({ x: 900, y: 300 }, 88, 300, content, SINGLE_SPLIT_STATE), 'right')

  const { state: s2 } = splitTabIntoZone(SINGLE_SPLIT_STATE, 'b', 'right', ['a', 'b', 'c'], 'a')
  assert.equal(hitTestSplitDropZone({ x: 450, y: 150 }, 88, 300, content, s2), 'topLeft')
  assert.equal(hitTestSplitDropZone({ x: 450, y: 500 }, 88, 300, content, s2), 'bottomLeft')
  assert.equal(hitTestSplitDropZone({ x: 900, y: 150 }, 88, 300, content, s2), 'topRight')
  assert.equal(hitTestSplitDropZone({ x: 900, y: 500 }, 88, 300, content, s2), 'bottomRight')

  const preview = computeDropZonePreviewBounds(content, 'right')
  assert.ok(preview.width > 0 && preview.height > 0)
})

test('framed clear-shell geometry aligns WebContentsView insets and drop-zone preview bounds pixel-for-pixel', () => {
  const area = { x: 304, y: 88, width: 1097, height: 811 }
  const { state: s4 } = applySplitLayout(SINGLE_SPLIT_STATE, {
    layout: '2x2',
    orderedTabIds: ['a', 'b', 'c', 'd'],
    activeTabId: 'a',
  })
  const bounds = computeSplitLayoutBounds(area, s4, SPLIT_PANE_HEADER_HEIGHT, SPLIT_PANE_GAP_PX, {
    shellPaddingDip: SPLIT_SHELL_PADDING_PX,
    viewportInsetDip: SPLIT_VIEWPORT_INSET_PX,
  })
  const [tl, tr, bl, br] = bounds

  // Outer clear shell margin + inner gap sum cleanly back to area dimensions
  assert.equal(tl.cellBounds.x, area.x + SPLIT_SHELL_PADDING_PX)
  assert.equal(tl.cellBounds.y, area.y + SPLIT_SHELL_PADDING_PX)
  assert.equal(
    tl.cellBounds.width + SPLIT_PANE_GAP_PX + tr.cellBounds.width + SPLIT_SHELL_PADDING_PX * 2,
    area.width,
  )
  assert.equal(
    tl.cellBounds.height + SPLIT_PANE_GAP_PX + bl.cellBounds.height + SPLIT_SHELL_PADDING_PX * 2,
    area.height,
  )

  // Inner WebContentsView bounds respect header height and left/right/bottom frame inset
  assert.equal(br.webContentsBounds.x, br.cellBounds.x + SPLIT_VIEWPORT_INSET_PX)
  assert.equal(br.webContentsBounds.y, br.cellBounds.y + SPLIT_PANE_HEADER_HEIGHT)
  assert.equal(br.webContentsBounds.width, br.cellBounds.width - SPLIT_VIEWPORT_INSET_PX * 2)
  assert.equal(
    br.webContentsBounds.height,
    br.cellBounds.height - SPLIT_PANE_HEADER_HEIGHT - SPLIT_VIEWPORT_INSET_PX,
  )

  // Drop-zone preview bounds match resulting pane cellBounds identically
  const localArea = { x: 0, y: 0, width: area.width, height: area.height }
  const previewBr = computeDropZonePreviewBounds(localArea, 'bottomRight', {
    shellPaddingDip: SPLIT_SHELL_PADDING_PX,
    gapDip: SPLIT_PANE_GAP_PX,
  })
  assert.equal(area.x + previewBr.x, br.cellBounds.x)
  assert.equal(area.y + previewBr.y, br.cellBounds.y)
  assert.equal(previewBr.width, br.cellBounds.width)
  assert.equal(previewBr.height, br.cellBounds.height)

  // Tiny / zero boundary dimensions clamp safely without negative sizes
  const tiny = computeSplitLayoutBounds({ x: 0, y: 0, width: 4, height: 10 }, s4, 34, 8, {
    shellPaddingDip: 8,
    viewportInsetDip: 3,
  })
  for (const p of tiny) {
    assert.ok(p.cellBounds.width >= 0 && p.cellBounds.height >= 0)
    assert.ok(p.webContentsBounds.width >= 0 && p.webContentsBounds.height >= 0)
  }

  // Topology resolution for drop HUD schematic
  assert.equal(resolveDropTargetTopology('single', 'right'), '50-50')
  assert.equal(resolveDropTargetTopology('split-2', 'topLeft'), '2x1-left')
  assert.equal(resolveDropTargetTopology('split-2', 'bottomRight'), '2x1-right')
  assert.equal(resolveDropTargetTopology('split-3-left', 'topRight'), '2x2')
  assert.equal(resolveDropTargetTopology('split-3-right', 'bottomLeft'), '2x2')
  assert.equal(resolveDropTargetTopology('split-4', 'regroup'), 'regroup')
})
