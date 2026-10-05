import { create } from 'zustand'
import {
  browserToolFrame, collectSnapshotElements, cursorTargets, type CursorPoint, type SnapshotElement,
} from '@/lib/agent-cursor'
import type { PanelMessage } from '@/lib/panel-stream'
import type { LiveTurn } from '@/lib/voice-events'

interface AgentPresenceState {
  screenCaptures: number
  panelFrames: Record<string, true>
  liveFrames: Record<string, true>
  elements: Record<string, SnapshotElement>
  cursorPoints: CursorPoint[]
  cursorSeq: number
}

export const useAgentPresenceStore = create<AgentPresenceState>(() => ({
  screenCaptures: 0,
  panelFrames: {},
  liveFrames: {},
  elements: {},
  cursorPoints: [],
  cursorSeq: 0,
}))

export function agentFrameOn(state: Pick<AgentPresenceState, 'screenCaptures' | 'panelFrames' | 'liveFrames'>): boolean {
  return state.screenCaptures > 0 || Object.keys(state.panelFrames).length > 0 || Object.keys(state.liveFrames).length > 0
}

/** One holder (Teach Ron or Live screen share). The returned function releases it once. */
export function acquireScreenCapture(): () => void {
  useAgentPresenceStore.setState((state) => ({ screenCaptures: state.screenCaptures + 1 }))
  let released = false
  return () => {
    if (released) return
    released = true
    useAgentPresenceStore.setState((state) => ({ screenCaptures: Math.max(0, state.screenCaptures - 1) }))
  }
}

const panelCursorKey = new Map<string, string>()
const liveCursorKey = new Map<string, string>()
const panelStamp = new Map<string, string>()
const liveStamp = new Map<string, string>()

function mergeElements(output: unknown, elements: Record<string, SnapshotElement>): Record<string, SnapshotElement> {
  const found = collectSnapshotElements(output)
  let next = elements
  for (const [ref, element] of Object.entries(found)) {
    const prev = next[ref]
    if (prev && prev.x === element.x && prev.y === element.y && prev.width === element.width && prev.height === element.height) continue
    if (next === elements) next = { ...elements }
    next[ref] = element
  }
  return next
}

export function rememberSnapshot(output: unknown): void {
  const state = useAgentPresenceStore.getState()
  const elements = mergeElements(output, state.elements)
  if (elements !== state.elements) useAgentPresenceStore.setState({ elements })
}

export function notePanelTools(sessionId: string, messages: PanelMessage[]): void {
  const tools = messages.flatMap((message) => message.parts.filter((part) => part.kind === 'tool'))
  const stamp = tools.map((part) => `${part.id}:${part.finished}:${part.output == null}:${JSON.stringify(part.input)}`).join('\n')
  const state = useAgentPresenceStore.getState()
  const active = tools.some((part) => !part.finished && browserToolFrame(part.name))
  if (panelStamp.get(sessionId) === stamp && active === (state.panelFrames[sessionId] === true)) return
  panelStamp.set(sessionId, stamp)
  let elements = state.elements
  for (const part of tools) elements = mergeElements(part.output, elements)
  let newestKey = ''
  let newestPoints: CursorPoint[] = []
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    if (tools[index].finished) continue
    const points = cursorTargets(tools[index].input, elements)
    if (!points.length) continue
    newestKey = `${tools[index].id}:${JSON.stringify(tools[index].input)}`
    newestPoints = points
    break
  }
  const cursorChanged = Boolean(newestKey) && panelCursorKey.get(sessionId) !== newestKey
  if (!cursorChanged && elements === state.elements && active === (state.panelFrames[sessionId] === true)) return
  if (cursorChanged) panelCursorKey.set(sessionId, newestKey)
  const panelFrames = { ...state.panelFrames }
  if (active) panelFrames[sessionId] = true
  else delete panelFrames[sessionId]
  useAgentPresenceStore.setState({
    panelFrames,
    elements,
    ...(cursorChanged ? { cursorPoints: newestPoints, cursorSeq: state.cursorSeq + 1 } : {}),
  })
}

export function noteLiveTools(key: string, turns: LiveTurn[]): void {
  const tools = turns.filter((turn) => turn.kind === 'tool')
  const stamp = tools.map((turn) => `${turn.id}:${turn.final}:${turn.cancelled}:${JSON.stringify(turn.toolInput)}`).join('\n')
  const state = useAgentPresenceStore.getState()
  const active = tools.some((turn) => !turn.final && !turn.cancelled && browserToolFrame(turn.toolName ?? ''))
  if (liveStamp.get(key) === stamp && active === (state.liveFrames[key] === true)) return
  liveStamp.set(key, stamp)
  let newestKey = ''
  let newestPoints: CursorPoint[] = []
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    if (tools[index].final || tools[index].cancelled) continue
    const points = cursorTargets(tools[index].toolInput, state.elements)
    if (!points.length) continue
    newestKey = `${tools[index].id}:${JSON.stringify(tools[index].toolInput)}`
    newestPoints = points
    break
  }
  const cursorChanged = Boolean(newestKey) && liveCursorKey.get(key) !== newestKey
  if (!cursorChanged && active === (state.liveFrames[key] === true)) return
  if (cursorChanged) liveCursorKey.set(key, newestKey)
  const liveFrames = { ...state.liveFrames }
  if (active) liveFrames[key] = true
  else delete liveFrames[key]
  useAgentPresenceStore.setState({
    liveFrames,
    ...(cursorChanged ? { cursorPoints: newestPoints, cursorSeq: state.cursorSeq + 1 } : {}),
  })
}

export function clearLiveTools(key: string): void {
  liveCursorKey.delete(key)
  liveStamp.delete(key)
  useAgentPresenceStore.setState((state) => {
    if (!state.liveFrames[key]) return state
    const liveFrames = { ...state.liveFrames }
    delete liveFrames[key]
    return { liveFrames }
  })
}
