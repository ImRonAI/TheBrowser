/** Viewport point taken from a browser-tool input or a snapshot element. */
export interface CursorPoint {
  x: number
  y: number
}

/** Element box from a Playwright snapshot (`getBoundingClientRect`). */
export interface SnapshotElement {
  ref: string
  x: number
  y: number
  width: number
  height: number
}

/** Tip of the pointer path, in the SVG viewBox. */
export const CURSOR_TIP = 4

export const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><defs><filter id="ron-cursor-glow" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="2.2" flood-color="#6B3420" flood-opacity="0.45"/><feDropShadow dx="0" dy="0" stdDeviation="1" flood-color="#4E271A" flood-opacity="0.95"/></filter></defs><path filter="url(#ron-cursor-glow)" d="M4 4 L4 22 L10.2 16.4 L14.6 24 L18.2 22.4 L13.8 15 L22 15 Z" fill="#2C150D" stroke="#4E271A" stroke-width="1.25" stroke-linejoin="round"/></svg>`

const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const pair = (x: unknown, y: unknown): CursorPoint | null => {
  const px = number(x)
  const py = number(y)
  return px == null || py == null ? null : { x: px, y: py }
}

/** Electron MCP tools are namespaced `playwright`; the screenshot tool also says `screenshot`. */
export function browserToolFrame(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes('playwright') || lower.includes('screenshot')
}

export function elementCenter(element: SnapshotElement): CursorPoint {
  return { x: element.x + element.width / 2, y: element.y + element.height / 2 }
}

/** Points a tool input already names. Numeric `x`/`y` win; a `ref` uses the snapshot center. */
export function cursorTargets(input: unknown, elements: Readonly<Record<string, SnapshotElement>>): CursorPoint[] {
  if (!input || typeof input !== 'object') return []
  const record = input as Record<string, unknown>
  const points: CursorPoint[] = []
  const direct = pair(record.x, record.y)
  if (direct) points.push(direct)
  const target = record.targetCoordinates
  if (target && typeof target === 'object') {
    const drop = pair((target as Record<string, unknown>).x, (target as Record<string, unknown>).y)
    if (drop) points.push(drop)
  }
  if (points.length) return points
  for (const key of ['ref', 'sourceRef', 'targetRef'] as const) {
    const ref = record[key]
    if (typeof ref !== 'string') continue
    const element = elements[ref]
    if (element) points.push(elementCenter(element))
  }
  return points
}

/** Pull `{ ref, x, y, width, height }` boxes out of a tool result, including JSON text. */
export function collectSnapshotElements(value: unknown): Record<string, SnapshotElement> {
  const found: Record<string, SnapshotElement> = {}
  let budget = 2000
  const walk = (node: unknown, depth: number) => {
    if (budget <= 0 || depth > 8 || node == null) return
    budget -= 1
    if (typeof node === 'string') {
      const trimmed = node.trim()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { walk(JSON.parse(trimmed) as unknown, depth + 1) } catch { /* not JSON */ }
      }
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    if (typeof node !== 'object') return
    const record = node as Record<string, unknown>
    const ref = typeof record.ref === 'string' ? record.ref : null
    const x = number(record.x)
    const y = number(record.y)
    const width = number(record.width)
    const height = number(record.height)
    if (ref && x != null && y != null && width != null && height != null) {
      found[ref] = { ref, x, y, width, height }
    }
    for (const nested of Object.values(record)) walk(nested, depth + 1)
  }
  walk(value, 0)
  return found
}
