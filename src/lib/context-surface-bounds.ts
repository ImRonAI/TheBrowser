/**
 * Pure DIP bounds math for the native `ContextSurface` WebContentsViews (`widgetView` and
 * `discoveryView`) and `RepairSurface` clearance.
 *
 * Keeping bounds tight around the visible widget state (84x84 idle orb, expanded hover pill box,
 * 332xH orb+notice stack, 536x576 Context panel, and separate lazy 616xH Discovery panel) allows
 * external websites (`WebContentsView`s) to render across 100% of the browser shell without a
 * blank right-hand column and without transparent overlay pixels swallowing website clicks.
 *
 * Pure TypeScript (no React, DOM, or `@/` imports).
 */

export interface SurfaceRect {
  x: number
  y: number
  width: number
  height: number
}

const IDLE_ORB_BOX_CSS = 84
const HOVER_ORB_HEIGHT_CSS = 120
const NOTICE_CARD_WIDTH_CSS = 332
const EXPANDED_PANEL_WIDTH_CSS = 536 // 520px panel + 8px shadow clearance on each side
const EXPANDED_PANEL_HEIGHT_CSS = 576 // 560px panel + 8px shadow clearance on each side
const DISCOVERY_PANEL_WIDTH_CSS = 616 // 600px panel + 8px shadow clearance on each side
const DEFAULT_ORB_CLEARANCE_CSS = 88

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * Anchor area for the Context Widget. Normally `contentArea` (left of an open narrow/wide AgentPanel),
 * falling back to the full window width (minus any open left sidebar) when `contentArea` collapses
 * below 96 DIPs (e.g. when AgentPanel is in fullscreen mode) so the widget persists in view.
 */
export function widgetAnchorBounds(
  contentArea: SurfaceRect,
  windowWidth: number,
  leftSidebarDip: number,
): SurfaceRect {
  if (contentArea.width >= 96) return contentArea
  const x = Math.max(0, Math.round(leftSidebarDip))
  return {
    x,
    y: contentArea.y,
    width: Math.max(0, Math.round(windowWidth) - x),
    height: contentArea.height,
  }
}

export interface WidgetSurfaceBoundsOptions {
  area: SurfaceRect
  zoom?: number
  isExpanded: boolean
  hasNotice: boolean
  noticeWidthCss?: number
  noticeHeightCss?: number
  orbHovered: boolean
  pillWidthCss?: number
  hasLabels: boolean
  dragOffset?: { x: number; y: number }
}

export function computeWidgetSurfaceBounds(options: WidgetSurfaceBoundsOptions): {
  bounds: SurfaceRect
  orbClearance: number
  clampedDragOffset: { x: number; y: number }
} {
  const zoom = options.zoom && Number.isFinite(options.zoom) && options.zoom > 0 ? options.zoom : 1
  const { area } = options
  const rawDrag = { x: options.dragOffset?.x ?? 0, y: options.dragOffset?.y ?? 0 }

  if (area.width <= 0 || area.height <= 0) {
    return {
      bounds: { x: area.x, y: area.y, width: 0, height: 0 },
      orbClearance: Math.round(DEFAULT_ORB_CLEARANCE_CSS * zoom),
      clampedDragOffset: rawDrag,
    }
  }

  if (options.isExpanded) {
    const outerMargin = Math.round(16 * zoom)
    const minPad = Math.round(8 * zoom)
    const width = Math.min(Math.round(EXPANDED_PANEL_WIDTH_CSS * zoom), Math.max(0, area.width - minPad))
    const height = Math.min(Math.round(EXPANDED_PANEL_HEIGHT_CSS * zoom), Math.max(0, area.height - minPad))
    const baseX = area.x + area.width - width - outerMargin
    const baseY = area.y + area.height - height - outerMargin
    const x = clamp(Math.round(baseX + rawDrag.x), area.x, area.x + area.width - width)
    const y = clamp(Math.round(baseY + rawDrag.y), area.y, area.y + area.height - height)
    return {
      bounds: { x, y, width, height },
      orbClearance: Math.round(DEFAULT_ORB_CLEARANCE_CSS * zoom),
      clampedDragOffset: { x: x - baseX, y: y - baseY },
    }
  }

  // Collapsed states all align flush to `(area.x + area.width, area.y + area.height)` so `bottom-5 right-5`
  // inside `context-surface.html` keeps the 52x52 orb motionless at the exact same window pixel across
  // idle -> hover -> notice transitions.
  if (options.hasNotice) {
    const cardH = Math.max(96, Math.ceil(options.noticeHeightCss ?? 148))
    const widthCss = Math.max(NOTICE_CARD_WIDTH_CSS, Math.ceil(options.noticeWidthCss ?? NOTICE_CARD_WIDTH_CSS))
    const heightCss = 84 + cardH + 12
    const width = Math.min(area.width, Math.round(widthCss * zoom))
    const height = Math.min(area.height, Math.round(heightCss * zoom))
    return {
      bounds: {
        x: area.x + area.width - width,
        y: area.y + area.height - height,
        width,
        height,
      },
      orbClearance: height + Math.round(8 * zoom),
      clampedDragOffset: rawDrag,
    }
  }

  if (options.orbHovered && options.hasLabels) {
    const pillW = Math.max(52, Math.ceil(options.pillWidthCss ?? 160))
    const widthCss = Math.max(IDLE_ORB_BOX_CSS, 20 + pillW + 16)
    const width = Math.min(Math.max(0, area.width - Math.round(8 * zoom)), Math.round(widthCss * zoom))
    const height = Math.min(area.height, Math.round(HOVER_ORB_HEIGHT_CSS * zoom))
    return {
      bounds: {
        x: area.x + area.width - width,
        y: area.y + area.height - height,
        width,
        height,
      },
      orbClearance: Math.round(DEFAULT_ORB_CLEARANCE_CSS * zoom),
      clampedDragOffset: rawDrag,
    }
  }

  const size = Math.min(area.width, area.height, Math.round(IDLE_ORB_BOX_CSS * zoom))
  return {
    bounds: {
      x: area.x + area.width - size,
      y: area.y + area.height - size,
      width: size,
      height: size,
    },
    orbClearance: Math.round(DEFAULT_ORB_CLEARANCE_CSS * zoom),
    clampedDragOffset: rawDrag,
  }
}

export interface DiscoverySurfaceBoundsOptions {
  area: SurfaceRect
  windowHeight: number
  zoom?: number
  dragOffset?: { x: number; y: number }
}

export function computeDiscoverySurfaceLayout(options: DiscoverySurfaceBoundsOptions): {
  bounds: SurfaceRect
  clampedDragOffset: { x: number; y: number }
} {
  const zoom = options.zoom && Number.isFinite(options.zoom) && options.zoom > 0 ? options.zoom : 1
  const { area } = options
  const rawDrag = { x: options.dragOffset?.x ?? 0, y: options.dragOffset?.y ?? 0 }
  if (area.width <= 0 || area.height <= 0) {
    return { bounds: { x: area.x, y: area.y, width: 0, height: 0 }, clampedDragOffset: rawDrag }
  }

  const marginRight = Math.round(16 * zoom)
  const marginTop = Math.round(12 * zoom)
  const minPad = Math.round(8 * zoom)
  const width = Math.min(Math.round(DISCOVERY_PANEL_WIDTH_CSS * zoom), Math.max(0, area.width - minPad))
  const preferredHeight = Math.round(options.windowHeight * 0.7) + Math.round(16 * zoom)
  const height = Math.min(preferredHeight, Math.max(0, area.height - marginTop - minPad))

  const baseX = area.x + area.width - width - marginRight
  const baseY = area.y + marginTop
  const x = clamp(Math.round(baseX + rawDrag.x), area.x, area.x + area.width - width)
  const y = clamp(Math.round(baseY + rawDrag.y), area.y, area.y + area.height - height)

  return {
    bounds: { x, y, width, height },
    clampedDragOffset: { x: x - baseX, y: y - baseY },
  }
}

export function computeDiscoverySurfaceBounds(options: DiscoverySurfaceBoundsOptions): SurfaceRect {
  return computeDiscoverySurfaceLayout(options).bounds
}
