/**
 * Workflow graphs drawn with the AI Elements workflow components (Canvas, Node, Edge).
 *
 * One graph serves three places: the workflow block inside project documents (saved as JSON on the
 * block), the document's workflow builder, and the `render_workflow` agent tool, whose JSX
 * (`<Workflow><WorkflowNode/><WorkflowEdge/></Workflow>`) the Agent Panel renders through JSX Preview.
 * Pure: no React, so node:test can run it.
 */

/** AI Elements edge types: `animated` is the main path, `temporary` (dashed) a conditional or error path. */
export type WorkflowEdgeType = 'animated' | 'temporary'
/**
 * Flowchart shapes (ISO 5807 / common flowchart vocabulary). `step` is the AI Elements Node card;
 * the others are drawn as their flowchart symbol. Start has no incoming handle and End no outgoing one.
 */
export type WorkflowStepKind =
  | 'start' | 'end' | 'step' | 'decision' | 'delay'
  | 'subprocess' | 'manual' | 'automation'
  | 'io' | 'document' | 'data'

export interface WorkflowStep {
  id: string
  label: string
  description?: string
  content?: string
  footer?: string
  kind?: WorkflowStepKind
  position?: { x: number; y: number }
}

export interface WorkflowConnection {
  id: string
  source: string
  target: string
  type: WorkflowEdgeType
  /** Short text on the arrow, e.g. "Yes" / "No" out of a decision. */
  label?: string
}

export interface WorkflowGraph {
  steps: WorkflowStep[]
  connections: WorkflowConnection[]
}

export type WorkflowShapeGroup = 'Flow' | 'Work' | 'Information'

export const WORKFLOW_STEP_KINDS: { kind: WorkflowStepKind; label: string; hint: string; group: WorkflowShapeGroup }[] = [
  { kind: 'start', label: 'Start', hint: 'Where the workflow begins: a trigger or request', group: 'Flow' },
  { kind: 'end', label: 'End', hint: 'Where the workflow finishes', group: 'Flow' },
  { kind: 'decision', label: 'Decision', hint: 'A question that splits the path (label the arrows Yes / No)', group: 'Flow' },
  { kind: 'delay', label: 'Wait', hint: 'A pause: waiting on someone, a date or a timer', group: 'Flow' },
  { kind: 'step', label: 'Step', hint: 'Something that needs to happen, with details', group: 'Work' },
  { kind: 'subprocess', label: 'Subprocess', hint: 'A process defined elsewhere (another workflow or runbook)', group: 'Work' },
  { kind: 'manual', label: 'Manual task', hint: 'Done by a person by hand', group: 'Work' },
  { kind: 'automation', label: 'Automation', hint: 'Done by a system, script or Ren', group: 'Work' },
  { kind: 'io', label: 'Input / output', hint: 'Information coming in or going out: a form, an email, a request', group: 'Information' },
  { kind: 'document', label: 'Document', hint: 'A document or report that is produced or read', group: 'Information' },
  { kind: 'data', label: 'Data store', hint: 'A database, spreadsheet or system of record', group: 'Information' },
]

export const WORKFLOW_SHAPE_GROUPS: WorkflowShapeGroup[] = ['Flow', 'Work', 'Information']

/**
 * Names models and older saves use for the same symbols. Anything else is dropped and the kind is
 * inferred from the arrows, so an unknown name never breaks a diagram.
 */
const KIND_ALIASES: Record<string, WorkflowStepKind> = {
  begin: 'start', trigger: 'start', terminator: 'start', finish: 'end', stop: 'end', done: 'end',
  process: 'step', task: 'step', action: 'step', activity: 'step',
  condition: 'decision', gateway: 'decision', choice: 'decision', branch: 'decision',
  wait: 'delay', timer: 'delay', pause: 'delay',
  predefined: 'subprocess', 'sub-process': 'subprocess', subroutine: 'subprocess', call: 'subprocess',
  human: 'manual', 'manual-task': 'manual', manual_task: 'manual', approval: 'manual',
  automated: 'automation', system: 'automation', ai: 'automation', agent: 'automation', script: 'automation',
  input: 'io', output: 'io', 'input/output': 'io', 'input-output': 'io', data_io: 'io', form: 'io',
  doc: 'document', report: 'document', file: 'document',
  database: 'data', datastore: 'data', 'data-store': 'data', data_store: 'data', storage: 'data', store: 'data',
}

/** Box each symbol is drawn in (flow units). Step cards size to their content; `height` is an estimate for layout. */
export function workflowNodeSize(kind: WorkflowStepKind, step?: Partial<WorkflowStep>): { width: number; height: number } {
  switch (kind) {
    case 'start': case 'end': return { width: 184, height: 64 }
    case 'decision': return { width: 196, height: 124 }
    case 'delay': return { width: 188, height: 80 }
    case 'subprocess': return { width: 216, height: 88 }
    case 'manual': return { width: 216, height: 84 }
    case 'automation': return { width: 216, height: 88 }
    case 'io': return { width: 220, height: 84 }
    case 'document': return { width: 204, height: 100 }
    case 'data': return { width: 188, height: 108 }
    default: return { width: 288, height: 80 + (step?.content ? 64 : 0) + (step?.footer ? 44 : 0) }
  }
}

/** Horizontal distance between layers and vertical distance between siblings (flow units). */
export const COLUMN_GAP = 380
export const ROW_GAP = 220

const KINDS = new Set<WorkflowStepKind>(WORKFLOW_STEP_KINDS.map((item) => item.kind))
const EDGE_TYPES = new Set<WorkflowEdgeType>(['animated', 'temporary'])

/** A known kind (or alias) → its canonical name; anything else → undefined. */
export function workflowKind(value: unknown): WorkflowStepKind | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.trim().toLowerCase()
  return KINDS.has(name as WorkflowStepKind) ? name as WorkflowStepKind : KIND_ALIASES[name]
}

export function handlesFor(kind: WorkflowStepKind): { source: boolean; target: boolean } {
  return { source: kind !== 'end', target: kind !== 'start' }
}

/** A step without its own kind is a start when nothing points at it and an end when it points nowhere. */
export function inferKind(step: WorkflowStep, connections: WorkflowConnection[]): WorkflowStepKind {
  if (step.kind) return step.kind
  const incoming = connections.some((edge) => edge.target === step.id)
  const outgoing = connections.some((edge) => edge.source === step.id)
  if (outgoing && !incoming) return 'start'
  if (incoming && !outgoing) return 'end'
  return 'step'
}

/**
 * Left-to-right layers by longest path from the starts (back edges of cycles are ignored); each layer
 * is centred vertically. Steps that carry a position keep it.
 */
export function layoutWorkflow(graph: WorkflowGraph): Record<string, { x: number; y: number }> {
  const ids = graph.steps.map((step) => step.id)
  const outgoing = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const edge of graph.connections) outgoing.get(edge.source)?.push(edge.target)
  const order: string[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (id: string) => {
    if (state.get(id)) return
    state.set(id, 'visiting')
    for (const next of outgoing.get(id) ?? []) if (!state.get(next)) visit(next)
    state.set(id, 'done')
    order.push(id)
  }
  for (const id of ids) visit(id)
  order.reverse()
  const position = new Map(order.map((id, index) => [id, index]))
  const layer = new Map<string, number>(ids.map((id) => [id, 0]))
  for (const id of order) {
    for (const next of outgoing.get(id) ?? []) {
      // Only forward edges in the topological order lengthen a path; a back edge closes a cycle.
      if ((position.get(next) ?? 0) > (position.get(id) ?? 0)) layer.set(next, Math.max(layer.get(next) ?? 0, (layer.get(id) ?? 0) + 1))
    }
  }
  const columns = new Map<number, string[]>()
  for (const id of ids) columns.set(layer.get(id) ?? 0, [...(columns.get(layer.get(id) ?? 0) ?? []), id])
  const result: Record<string, { x: number; y: number }> = {}
  const steps = new Map(graph.steps.map((step) => [step.id, step]))
  const widest = workflowNodeSize('step').width
  for (const [column, members] of columns) {
    members.forEach((id, index) => {
      // Centre every symbol on its point so arrows between different shapes stay level.
      const step = steps.get(id)!
      const size = workflowNodeSize(inferKind(step, graph.connections), step)
      result[id] = {
        x: column * COLUMN_GAP + Math.round((widest - size.width) / 2),
        y: Math.round((index - (members.length - 1) / 2) * ROW_GAP - size.height / 2),
      }
    })
  }
  for (const step of graph.steps) if (step.position) result[step.id] = step.position
  return result
}

const text = (value: unknown, limit: number) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : undefined

/** Parse untrusted JSON (a saved block, agent JSX props) into a graph; invalid parts are dropped. */
export function normalizeWorkflow(input: unknown): WorkflowGraph {
  const source = (input && typeof input === 'object' ? input : {}) as { steps?: unknown; connections?: unknown }
  const steps: WorkflowStep[] = []
  const seen = new Set<string>()
  for (const raw of Array.isArray(source.steps) ? source.steps : []) {
    if (!raw || typeof raw !== 'object') continue
    const value = raw as Record<string, unknown>
    const id = typeof value.id === 'string' ? value.id.trim().slice(0, 64) : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    const position = value.position as { x?: unknown; y?: unknown } | undefined
    steps.push({
      id,
      label: text(value.label, 120) ?? 'Untitled step',
      description: text(value.description, 300),
      content: text(value.content, 2000),
      footer: text(value.footer, 300),
      kind: workflowKind(value.kind),
      position: position && Number.isFinite(position.x) && Number.isFinite(position.y)
        ? { x: Number(position.x), y: Number(position.y) } : undefined,
    })
  }
  const connections: WorkflowConnection[] = []
  const pairs = new Set<string>()
  for (const raw of Array.isArray(source.connections) ? source.connections : []) {
    if (!raw || typeof raw !== 'object') continue
    const value = raw as Record<string, unknown>
    const from = String(value.source ?? ''), to = String(value.target ?? '')
    if (!seen.has(from) || !seen.has(to) || from === to || pairs.has(`${from}->${to}`)) continue
    pairs.add(`${from}->${to}`)
    const label = text(value.label, 40)
    connections.push({
      id: typeof value.id === 'string' && value.id ? value.id : `${from}->${to}`,
      source: from,
      target: to,
      type: EDGE_TYPES.has(value.type as WorkflowEdgeType) ? value.type as WorkflowEdgeType : 'animated',
      ...(label ? { label } : {}),
    })
  }
  return { steps, connections }
}

/** Reading order for screen readers and plain-text exports: starts first, then each layer top to bottom. */
export function workflowOutline(graph: WorkflowGraph): string[] {
  const positions = layoutWorkflow(graph)
  return [...graph.steps]
    .sort((a, b) => positions[a.id].x - positions[b.id].x || positions[a.id].y - positions[b.id].y)
    .map((step) => step.label)
}

/** A new blank workflow for the document builder: Start → Step → End. */
export function starterWorkflow(): WorkflowGraph {
  return {
    steps: [
      { id: 'start', label: 'Start', description: 'What kicks this off', kind: 'start' },
      { id: 'step-1', label: 'Do the work', description: 'What needs to happen', kind: 'step' },
      { id: 'end', label: 'Done', description: 'What finished looks like', kind: 'end' },
    ],
    connections: [
      { id: 'start->step-1', source: 'start', target: 'step-1', type: 'animated' },
      { id: 'step-1->end', source: 'step-1', target: 'end', type: 'animated' },
    ],
  }
}

/** The same graph with every step placed by the automatic layout ("Tidy up"). */
export function tidyWorkflow(graph: WorkflowGraph): WorkflowGraph {
  const bare = { ...graph, steps: graph.steps.map(({ position: _position, ...step }) => step) }
  const positions = layoutWorkflow(bare)
  return { ...graph, steps: bare.steps.map((step) => ({ ...step, position: positions[step.id] })) }
}
