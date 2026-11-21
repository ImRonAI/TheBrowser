/**
 * Deep Research formation graph: the pure model behind the canvas (the counterpart of
 * v0-clone-blurple's `graph-run.ts`).
 *
 * - `resolveScope` / `scopeTrail`: one level of the nested formation (the root graph, or a formation
 *   the user entered) and the way back out.
 * - `layoutScope`: left-to-right layers over that level's declared edges; an open agent accordion
 *   adds a fixed height and moves only the cards under it.
 * - `scopeEdges`: `temporary` until an edge's source has started, `animated` after (as `graph-run.ts`).
 * - `nodeToolState`: node status as the tool state the vendored `getStatusBadge` renders.
 * - `agentTranscript`: one agent's work (reasoning, subagent sub-agents with their tool calls,
 *   text) as ordered steps plus the final output.
 *
 * Pure module (relative `.ts` imports only) so `node --experimental-strip-types --test` runs it.
 */
import {
  nodePathKey,
  type DeepResearchHandoff,
  type DeepResearchNodeSnapshot,
  type DeepResearchNodeStatus,
  type DeepResearchSkillExecution,
  type DeepResearchSkillToolCall,
  type DeepResearchSnapshot,
  type FormationNodeKind,
  type FormationTopology,
  type FormationTopologyEdge,
  type FormationTopologyNode,
} from './deep-research-api.ts'

/** Card geometry. Every card has the same collapsed size; an open agent adds a body of fixed height. */
export const NODE_WIDTH = 360
export const NODE_HEIGHT = 167
export const NODE_BODY_HEIGHT = 384
export const GAP_X = 96
export const GAP_Y = 36

// ─────────────────────────────────────────────────────────────────────────────
// Runtime state of one topology node
// ─────────────────────────────────────────────────────────────────────────────

export interface NodeRuntimeState {
  status: DeepResearchNodeStatus
  nodeSnap: DeepResearchNodeSnapshot | undefined
  skills: DeepResearchSkillExecution[]
  handoffs: DeepResearchHandoff[]
}

/** Resolve effective status of a topology node from the runtime's `nodes` map and descendant paths. */
export function deriveNodeState(snapshot: DeepResearchSnapshot, path: readonly string[]): NodeRuntimeState {
  const key = nodePathKey(path)
  const prefix = `${key}/`
  const direct = snapshot.nodes[key]

  const skills = snapshot.skill_invocations.filter(
    (s) => s.node_key === key || s.node_key.startsWith(prefix),
  )
  const directSkills = snapshot.skill_invocations.filter((s) => s.node_key === key)

  const handoffs = snapshot.handoffs.filter((h) => {
    const hKey = nodePathKey(h.node_path)
    return hKey === key || hKey.startsWith(prefix)
  })

  if (direct) {
    return {
      status: direct.status,
      nodeSnap: direct,
      skills: directSkills.length > 0 ? directSkills : skills,
      handoffs,
    }
  }

  const activeKey = nodePathKey(snapshot.active_node_path)
  if (activeKey === key || activeKey.startsWith(prefix)) {
    return { status: 'executing', nodeSnap: undefined, skills, handoffs }
  }

  const descendants = Object.entries(snapshot.nodes).filter(([k]) => k.startsWith(prefix))
  if (descendants.length > 0) {
    if (descendants.some(([, n]) => n.status === 'executing')) {
      return { status: 'executing', nodeSnap: undefined, skills, handoffs }
    }
    if (descendants.some(([, n]) => n.status === 'failed')) {
      return { status: 'failed', nodeSnap: undefined, skills, handoffs }
    }
    if (descendants.every(([, n]) => n.status === 'completed')) {
      return { status: 'completed', nodeSnap: undefined, skills, handoffs }
    }
  }

  return { status: 'idle', nodeSnap: undefined, skills, handoffs }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scopes: one level of the nested formation
// ─────────────────────────────────────────────────────────────────────────────

export interface FormationScope {
  /** `[]` is the root graph; otherwise the path of the formation that was entered. */
  path: string[]
  label: string
  kind: FormationNodeKind
  description: string
  members: FormationTopologyNode[]
  edges: FormationTopologyEdge[]
}

export interface ScopeCrumb {
  path: string[]
  label: string
  kind: FormationNodeKind
}

const rootLabel = (topology: FormationTopology): string => topology.label?.trim() || 'Squad'

export const isFormation = (node: FormationTopologyNode): boolean =>
  node.kind !== 'agent' && (node.children?.length ?? 0) > 0

/** The level at `path`, or `null` when the path names no formation of this topology. */
export function resolveScope(topology: FormationTopology, path: readonly string[]): FormationScope | null {
  let scope: FormationScope = {
    path: [],
    label: rootLabel(topology),
    kind: topology.kind,
    description: '',
    members: topology.nodes,
    edges: topology.edges,
  }
  for (const segment of path) {
    const next = scope.members.find((member) => member.id === segment)
    if (!next || !isFormation(next)) return null
    scope = {
      path: [...scope.path, segment],
      label: next.label,
      kind: next.kind,
      description: next.description ?? '',
      members: next.children ?? [],
      edges: next.edges ?? [],
    }
  }
  return scope
}

/** Root first, then each formation entered on the way to `path`. */
export function scopeTrail(topology: FormationTopology, path: readonly string[]): ScopeCrumb[] {
  const trail: ScopeCrumb[] = [{ path: [], label: rootLabel(topology), kind: topology.kind }]
  for (let depth = 1; depth <= path.length; depth++) {
    const scope = resolveScope(topology, path.slice(0, depth))
    if (!scope) break
    trail.push({ path: scope.path, label: scope.label, kind: scope.kind })
  }
  return trail
}

/** Every agent under a node, at any depth (the node itself when it is an agent). */
export function leafAgents(
  node: FormationTopologyNode,
  path: readonly string[],
): Array<{ node: FormationTopologyNode; path: string[] }> {
  const here = [...path]
  if (!isFormation(node)) return [{ node, path: here }]
  return (node.children ?? []).flatMap((child) => leafAgents(child, [...here, child.id]))
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout
// ─────────────────────────────────────────────────────────────────────────────

export interface PlacedNode {
  id: string
  path: string[]
  key: string
  node: FormationTopologyNode
  layer: number
  x: number
  y: number
  height: number
  expanded: boolean
  /** Left (incoming) and right (outgoing) connection points, as the vendored `Node` renders them. */
  handles: { target: boolean; source: boolean }
}

export interface PlacedEdge {
  id: string
  source: string
  target: string
}

export interface ScopeLayout {
  nodes: PlacedNode[]
  edges: PlacedEdge[]
  width: number
  height: number
}

/** Classify edges that close a cycle (depth-first, in declared order) and layer the rest. */
function layerMembers(
  members: readonly FormationTopologyNode[],
  edges: readonly FormationTopologyEdge[],
): { layers: Map<string, number> } {
  const ids = new Set(members.map((member) => member.id))
  const scoped = edges
    .map((edge, index) => ({ ...edge, index }))
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to)

  const back = new Set<number>()
  const visit = new Map<string, 'open' | 'done'>()
  const walk = (id: string): void => {
    visit.set(id, 'open')
    for (const edge of scoped) {
      if (edge.from !== id) continue
      const seen = visit.get(edge.to)
      if (seen === 'open') back.add(edge.index)
      else if (!seen) walk(edge.to)
    }
    visit.set(id, 'done')
  }
  for (const member of members) if (!visit.has(member.id)) walk(member.id)

  const forward = scoped.filter((edge) => !back.has(edge.index))
  const layers = new Map<string, number>()
  const layerOf = (id: string): number => {
    const known = layers.get(id)
    if (known !== undefined) return known
    const incoming = forward.filter((edge) => edge.to === id)
    const layer = incoming.length ? Math.max(...incoming.map((edge) => layerOf(edge.from))) + 1 : 0
    layers.set(id, layer)
    return layer
  }
  for (const member of members) layerOf(member.id)
  return { layers }
}

/**
 * Place one level's members left to right. Columns are centred on their collapsed height, so
 * opening an agent moves only the cards under it in the same column.
 */
export function layoutScope(scope: FormationScope, expanded: ReadonlySet<string>): ScopeLayout {
  const { layers } = layerMembers(scope.members, scope.edges)
  const ids = new Set(scope.members.map((member) => member.id))

  const edges: PlacedEdge[] = []
  scope.edges.forEach((edge) => {
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) return
    if (edges.some((placed) => placed.source === edge.from && placed.target === edge.to)) return
    edges.push({ id: `${edge.from}->${edge.to}`, source: edge.from, target: edge.to })
  })

  const columns: FormationTopologyNode[][] = []
  for (const member of scope.members) (columns[layers.get(member.id) ?? 0] ??= []).push(member)
  const collapsedHeight = (count: number) => count * NODE_HEIGHT + Math.max(0, count - 1) * GAP_Y
  const tallest = Math.max(0, ...columns.map((column) => collapsedHeight(column?.length ?? 0)))

  const nodes: PlacedNode[] = []
  let height = 0
  columns.forEach((column, layer) => {
    if (!column) return
    let y = (tallest - collapsedHeight(column.length)) / 2
    for (const member of column) {
      const path = [...scope.path, member.id]
      const key = nodePathKey(path)
      const open = !isFormation(member) && expanded.has(key)
      const cardHeight = NODE_HEIGHT + (open ? NODE_BODY_HEIGHT : 0)
      nodes.push({
        id: member.id,
        path,
        key,
        node: member,
        layer,
        x: layer * (NODE_WIDTH + GAP_X),
        y,
        height: cardHeight,
        expanded: open,
        handles: {
          target: edges.some((edge) => edge.target === member.id),
          source: edges.length === 0 || edges.some((edge) => edge.source === member.id),
        },
      })
      y += cardHeight + GAP_Y
    }
    height = Math.max(height, y - GAP_Y)
  })

  const layerCount = columns.filter(Boolean).length
  return {
    nodes,
    edges,
    width: layerCount * NODE_WIDTH + Math.max(0, layerCount - 1) * GAP_X,
    height,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Live edges and status badges
// ─────────────────────────────────────────────────────────────────────────────

export interface LiveEdge extends PlacedEdge {
  /** The vendored edge type: dashed `temporary` until the source has started, `animated` after. */
  type: 'animated' | 'temporary'
}

export function scopeEdges(
  snapshot: DeepResearchSnapshot,
  scope: FormationScope,
  edges: readonly PlacedEdge[],
): LiveEdge[] {
  return edges.map((edge) => {
    const source = deriveNodeState(snapshot, [...scope.path, edge.source]).status
    return { ...edge, type: source === 'idle' ? 'temporary' : 'animated' }
  })
}

/** Node status as the tool state the vendored `getStatusBadge` (ai-elements/tool) renders. */
export function nodeToolState(
  status: DeepResearchNodeStatus,
): 'input-streaming' | 'input-available' | 'output-available' | 'output-error' {
  switch (status) {
    case 'executing':
      return 'input-available'
    case 'completed':
      return 'output-available'
    case 'failed':
    case 'cancelled':
    case 'interrupted':
      return 'output-error'
    default:
      return 'input-streaming'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// One agent's transcript
// ─────────────────────────────────────────────────────────────────────────────

export interface TextStepView {
  kind: 'text' | 'reasoning'
  id: string
  text: string
  /** Still being written. */
  active: boolean
}

export interface ToolStepView {
  kind: 'tool'
  id: string
  tool: DeepResearchSkillToolCall
  active: boolean
}

export type SkillStepView = TextStepView | ToolStepView

export interface SkillView {
  kind: 'skill'
  id: string
  skill: DeepResearchSkillExecution
  steps: SkillStepView[]
  active: boolean
}

export interface PassView {
  kind: 'pass'
  id: string
  pass: number
}

export type AgentStepView = TextStepView | SkillView | PassView

export interface AgentTranscript {
  /** The work: reasoning, narration and subagent sub-agents, in order. */
  steps: AgentStepView[]
  /** What the agent wrote after its last subagent call: its result. */
  output: string
  outputActive: boolean
  /** The newest text the agent or one of its sub-agents wrote: what the collapsed card previews. */
  latestText: string
}

function skillSteps(skill: DeepResearchSkillExecution): SkillStepView[] {
  const running = skill.status === 'running'
  const tools = new Map(skill.tools.map((tool) => [tool.id, tool]))
  const steps: SkillStepView[] = []
  skill.steps.forEach((step, index) => {
    if (step.kind === 'tool') {
      const tool = tools.get(step.tool_id)
      if (tool) steps.push({ kind: 'tool', id: step.id, tool, active: tool.status === 'running' })
      return
    }
    if (!step.text.trim()) return
    steps.push({
      kind: step.kind,
      id: step.id,
      text: step.text,
      active: running && index === skill.steps.length - 1,
    })
  })
  return steps
}

/** The transcript of the agent at `path`, ready to render. */
export function agentTranscript(snapshot: DeepResearchSnapshot, path: readonly string[]): AgentTranscript {
  const key = nodePathKey(path)
  const node = snapshot.nodes[key]
  const executing = node?.status === 'executing'
  const skillsById = new Map(
    snapshot.skill_invocations.filter((skill) => skill.node_key === key).map((skill) => [skill.id, skill]),
  )

  const parts = node?.activity ?? []

  // Text after the last subagent call (or repeat pass) is the agent's result; the rest is its work.
  let boundary = -1
  parts.forEach((part, index) => {
    if (part.kind === 'skill' || part.kind === 'pass') boundary = index
  })

  const steps: AgentStepView[] = []
  let output = ''
  parts.forEach((part, index) => {
    const last = index === parts.length - 1
    if (part.kind === 'pass') {
      steps.push({ kind: 'pass', id: part.id, pass: part.pass })
    } else if (part.kind === 'skill') {
      const skill = skillsById.get(part.skill_id)
      if (!skill) return
      steps.push({ kind: 'skill', id: part.id, skill, steps: skillSteps(skill), active: skill.status === 'running' })
    } else if (part.kind === 'text' && index > boundary) {
      output += part.text
    } else if (part.text.trim()) {
      steps.push({ kind: part.kind, id: part.id, text: part.text, active: executing && last })
    }
  })

  const lastPart = parts[parts.length - 1]
  const outputActive = executing && lastPart?.kind === 'text' && parts.length - 1 > boundary

  let latestText = output
  if (!latestText.trim()) {
    for (const step of [...steps].reverse()) {
      if (step.kind === 'pass') continue
      const text =
        step.kind === 'skill'
          ? [...step.steps].reverse().find((inner): inner is TextStepView => inner.kind !== 'tool')?.text
          : step.text
      if (text?.trim()) {
        latestText = text
        break
      }
    }
  }

  return {
    steps,
    output,
    outputActive,
    latestText,
  }
}
