import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  computeDiscoverySurfaceBounds,
  computeDiscoverySurfaceLayout,
  computeWidgetSurfaceBounds,
  widgetAnchorBounds,
} from './context-surface-bounds.ts'

test('idle, hover-pill, and notice states keep bottom-right corner stationary while sizing tightly', () => {
  const area = { x: 0, y: 88, width: 1400, height: 812 }

  const idle = computeWidgetSurfaceBounds({
    area,
    isExpanded: false,
    hasNotice: false,
    orbHovered: false,
    hasLabels: true,
  })
  assert.deepEqual(idle.bounds, { x: 1316, y: 816, width: 84, height: 84 })
  assert.equal(idle.orbClearance, 88)

  const hovered = computeWidgetSurfaceBounds({
    area,
    isExpanded: false,
    hasNotice: false,
    orbHovered: true,
    pillWidthCss: 190,
    hasLabels: true,
  })
  // Bottom-right corner remains (1400, 900), so `bottom-5 right-5` inside surface never shifts 1px!
  assert.equal(hovered.bounds.x + hovered.bounds.width, 1400)
  assert.equal(hovered.bounds.y + hovered.bounds.height, 900)
  assert.ok(hovered.bounds.width >= 226)
  assert.equal(hovered.bounds.height, 120)

  const notice = computeWidgetSurfaceBounds({
    area,
    isExpanded: false,
    hasNotice: true,
    noticeHeightCss: 140,
    orbHovered: true, // suppressed by notice
    hasLabels: true,
  })
  assert.equal(notice.bounds.x + notice.bounds.width, 1400)
  assert.equal(notice.bounds.y + notice.bounds.height, 900)
  assert.equal(notice.bounds.width, 332)
  assert.equal(notice.bounds.height, 236)
  assert.ok(notice.orbClearance > notice.bounds.height, 'RepairSurface clears notice card')
})

test('expanded panel and discovery panel apply OS-DIP drag offsets and clamp cleanly without mutating offset', () => {
  const area = { x: 304, y: 88, width: 1096, height: 812 }
  const dragOffset = { x: -200, y: -120 }

  const expanded = computeWidgetSurfaceBounds({
    area,
    isExpanded: true,
    hasNotice: false,
    orbHovered: false,
    hasLabels: false,
    dragOffset,
  })
  assert.equal(expanded.bounds.width, 536)
  assert.equal(expanded.bounds.height, 576)
  assert.equal(expanded.bounds.x, 304 + 1096 - 536 - 16 - 200)
  assert.equal(expanded.bounds.y, 88 + 812 - 576 - 16 - 120)
  assert.deepEqual(dragOffset, { x: -200, y: -120 })

  // Extreme drag clamps inside `area` and reports exact clampedDragOffset so a subsequent drag has zero dead-zone
  const clamped = computeWidgetSurfaceBounds({
    area,
    isExpanded: true,
    hasNotice: false,
    orbHovered: false,
    hasLabels: false,
    dragOffset: { x: -9999, y: -9999 },
  })
  assert.equal(clamped.bounds.x, area.x)
  assert.equal(clamped.bounds.y, area.y)
  const afterReverse = computeWidgetSurfaceBounds({
    area,
    isExpanded: true,
    hasNotice: false,
    orbHovered: false,
    hasLabels: false,
    dragOffset: { x: clamped.clampedDragOffset.x + 150, y: clamped.clampedDragOffset.y + 80 },
  })
  assert.equal(afterReverse.bounds.x, area.x + 150)
  assert.equal(afterReverse.bounds.y, area.y + 80)

  const discoveryClamped = computeDiscoverySurfaceLayout({
    area,
    windowHeight: 900,
    dragOffset: { x: -9999, y: 9999 },
  })
  const discoveryReverse = computeDiscoverySurfaceLayout({
    area,
    windowHeight: 900,
    dragOffset: { x: discoveryClamped.clampedDragOffset.x + 100, y: discoveryClamped.clampedDragOffset.y - 60 },
  })
  assert.equal(discoveryReverse.bounds.x, discoveryClamped.bounds.x + 100)
  assert.equal(discoveryReverse.bounds.y, discoveryClamped.bounds.y - 60)

  const discovery = computeDiscoverySurfaceBounds({
    area,
    windowHeight: 900,
    dragOffset: { x: -40, y: 30 },
  })
  assert.equal(discovery.width, 616)
  assert.ok(discovery.height > 400 && discovery.height <= area.height - 20)
})

test('widgetAnchorBounds falls back to full window width when AgentPanel is fullscreen', () => {
  const fullscreenContent = { x: 304, y: 88, width: 0, height: 812 }
  const anchored = widgetAnchorBounds(fullscreenContent, 1400, 304)
  assert.deepEqual(anchored, { x: 304, y: 88, width: 1096, height: 812 })
})
