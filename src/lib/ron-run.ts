/**
 * One Ron request on the server-owned runtime (`POST /chat`), for features that ask Ron to write
 * something the user then reviews: document pages and workflows. Each feature names its own agent
 * (`destination`): writing inside a page is the Document Agent, never the Agent Panel's agent.
 *
 * The stream is folded with the panel's own reducer (`reducePanelEvent`), so text, tool calls and
 * their results arrive exactly as the Agent Panel sees them. If the HTTP stream ends before the run
 * does, the run is followed through `GET /sessions/{id}/events?after=` (replay then follow).
 * Pure (fetch + relative imports, no React) so node:test can run it.
 */
import { emptyPanelState, readPanelStream, reducePanelEvent, responseError, type PanelEvent, type PanelMessage, type PanelState, type ToolPart } from './panel-stream.ts'
import { normalizeWorkflow, type WorkflowGraph } from './workflow.ts'

/** `ChatRequest.destination`: which scoped agent answers (agent/api/endpoints/chat.py). */
export type RonDestination = 'panel' | 'search' | 'build' | 'document' | 'context'

export interface RonRunRequest {
  apiBase: string
  destination: RonDestination
  sessionId: string
  userId: string
  message: string
  /** Native GoalLoop objective; only honoured on a session's first message, so pass a fresh session. */
  goal?: string
  signal?: AbortSignal
  onState?: (state: PanelState) => void
  fetcher?: typeof fetch
}

const FOLLOW_ATTEMPTS = 5

/** `/chat` session ids: `^[A-Za-z0-9][A-Za-z0-9_.-]*$`, at most 128 characters. */
export function ronSessionId(prefix: string, key: string): string {
  return `${prefix}-${key}`.replace(/[^A-Za-z0-9_.-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 128) || prefix
}

export async function runRon({ apiBase, destination, sessionId, userId, message, goal, signal, onState, fetcher = fetch }: RonRunRequest): Promise<PanelState> {
  let state = emptyPanelState(sessionId)
  const accept = (event: PanelEvent) => {
    if (signal?.aborted || event.session_id !== sessionId || event.sequence <= state.sequence) return false
    state = reducePanelEvent(state, event)
    onState?.(state)
  }
  const response = await fetcher(`${apiBase}/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ session_id: sessionId, user_id: userId, message, destination, ...(goal ? { options: { goal } } : {}) }),
  })
  if (!response.ok) throw await responseError(response)
  let terminal = await readPanelStream(response, accept)
  for (let attempt = 0; !terminal && attempt < FOLLOW_ATTEMPTS && !signal?.aborted; attempt += 1) {
    const follow = await fetcher(`${apiBase}/sessions/${encodeURIComponent(sessionId)}/events?user_id=${encodeURIComponent(userId)}&after=${state.sequence}`, { signal })
    terminal = await readPanelStream(follow, accept)
  }
  if (!terminal && !signal?.aborted) throw new Error('Ren’s answer was interrupted. Try again.')
  return state
}

/** Ask the runtime to stop the session's active run (native cancellation). */
export async function cancelRon(apiBase: string, sessionId: string, userId: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`${apiBase}/sessions/${encodeURIComponent(sessionId)}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId }),
  })
  if (!response.ok && response.status !== 404) throw await responseError(response)
}

/** The assistant message of the latest run (the one `run_started` named). */
export function latestAssistant(state: PanelState) {
  const messages = state.messages.filter((message) => message.role === 'assistant' && (!state.runId || !message.runId || message.runId === state.runId))
  return messages[messages.length - 1]
}

/** One piece of Ron's answer, in the order Ron produced it. */
export type RonSegment =
  | { kind: 'text'; text: string }
  | { kind: 'workflow'; title: string; graph: WorkflowGraph; id: string }

/** A finished, successful `render_workflow` call → the workflow it drew (the tool validated the arguments). */
export function workflowFromTool(part: ToolPart): { title: string; graph: WorkflowGraph } | null {
  if (part.name !== 'render_workflow' || !part.finished || (part.status && part.status !== 'success')) return null
  const input = (part.input && typeof part.input === 'object' ? part.input : {}) as { title?: unknown; steps?: unknown; connections?: unknown }
  const steps = Array.isArray(input.steps) ? input.steps : []
  // render_workflow chains the steps in order when connections are omitted; mirror that.
  const connections = Array.isArray(input.connections) ? input.connections
    : steps.slice(1).map((step, index) => ({ source: (steps[index] as { id?: unknown })?.id, target: (step as { id?: unknown })?.id }))
  const graph = normalizeWorkflow({ steps, connections })
  if (graph.steps.length === 0) return null
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 120) : 'Workflow'
  return { title, graph }
}

/** Ron's answer as ordered segments: top-level text (not reasoning or sub-agents) written after its last research call, and drawn workflows. */
export function ronSegments(state: PanelState): RonSegment[] {
  const message = latestAssistant(state)
  return message ? messageSegments(message) : []
}

/** The segments of one assistant message (see `ronSegments`). */
export function messageSegments(message: PanelMessage): RonSegment[] {
  const segments: RonSegment[] = []
  for (const part of message.parts) {
    if (part.path.length) continue
    if (part.kind === 'text' && !part.discarded && part.text) {
      const last = segments[segments.length - 1]
      if (last?.kind === 'text') last.text += part.text
      else segments.push({ kind: 'text', text: part.text })
    } else if (part.kind === 'tool') {
      const workflow = workflowFromTool(part)
      if (workflow) segments.push({ kind: 'workflow', id: part.id, ...workflow })
      // Research (any other tool) comes before writing: what Ron said before it is narration, not the draft.
      else if (part.name !== 'render_workflow') segments.length = 0
    }
  }
  return segments
}

/** Is Ron still producing this answer? */
export const ronBusy = (state: PanelState | null) => state?.status === 'running'

/** The graph as JSON for a prompt: positions dropped (Ron lays out by connections). */
export function workflowJson(title: string, graph: WorkflowGraph): string {
  return JSON.stringify({
    title,
    steps: graph.steps.map(({ position: _position, ...step }) => step),
    connections: graph.connections.map(({ source, target, type, label }) => ({ source, target, type, ...(label ? { label } : {}) })),
  })
}

/** Ask Ron to draw or change a workflow; the answer is one `render_workflow` call with the whole graph. */
export function workflowRonMessage(title: string, graph: WorkflowGraph, intent: string): string {
  return [
    `Workflow request: ${intent.trim()}`,
    graph.steps.length
      ? `The current workflow (change it as asked; keep the ids of the steps you keep):\n${workflowJson(title, graph)}`
      : `There is no workflow yet${title.trim() && title.trim() !== 'Workflow' ? ` (its title is "${title.trim()}")` : ''}.`,
    'Call render_workflow exactly once with the complete workflow: every step and every connection, not only the changes. '
      + 'Give each step the shape (kind) that says what it is, put details in description, content and footer, use "temporary" '
      + 'for conditional or error paths, and label the arrows that leave a decision. Do not use any other tool. '
      + 'After drawing, reply with one short sentence about what you drew or changed.',
  ].join('\n\n')
}
