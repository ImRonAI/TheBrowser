/**
 * Ask Ron to write (a project page or an issue description) as a temporary chat: each turn is what the
 * user asked and Ron's answer as a panel message. The answer splits into Ron's tracing (research tools,
 * reasoning, narration before research) and the draft (text written after its last research call, plus
 * drawn workflows), which the user inserts, uses to overwrite, or sends back with feedback.
 * Pure (relative imports, no React) so node:test can run it.
 */
import { messageSegments, workflowFromTool, type RonSegment } from './ron-run.ts'
import type { PanelMessage, PanelPart, RunStatus, ToolPart } from './panel-stream.ts'

export interface DraftTurn {
  id: string
  kind: 'request' | 'feedback'
  /** What the user typed (the request or the feedback), not the context sent with it. */
  ask: string
  /** Ron's answer so far; null until anything arrives. */
  message: PanelMessage | null
  status: RunStatus
  error?: string
}

/** Ron's answer split into the tracing (shown in an accordion) and the draft (what can go into the editor). */
export function draftParts(message: PanelMessage | null): { tracing: PanelPart[]; segments: RonSegment[] } {
  if (!message) return { tracing: [], segments: [] }
  let lastResearch = -1
  message.parts.forEach((part, index) => {
    if (!part.path.length && part.kind === 'tool' && part.name !== 'render_workflow') lastResearch = index
  })
  const tracing = message.parts.filter((part, index) => {
    if (part.path.length) return true
    if (part.kind === 'text') return part.discarded === true || index < lastResearch
    if (part.kind === 'tool') return part.name !== 'render_workflow' || !workflowFromTool(part)
    return true
  })
  return { tracing, segments: messageSegments(message) }
}

/** One issue-agent run (`GET /projects/issues/{id}/agent`): its output text and recorded tool activity. */
export interface IssueAgentRun {
  id: string
  output: string
  status: string
  error: string | null
  activity?: { id: string; name: string; status: string; input?: unknown }[]
}

/** Issue-agent run status → the panel's run status. */
export function issueRunStatus(status: string): RunStatus {
  if (status === 'running') return 'running'
  if (status === 'completed') return 'completed'
  if (status === 'canceled' || status === 'cancelled') return 'cancelled'
  if (status === 'interrupted') return 'interrupted'
  return 'error'
}

/**
 * An issue-agent run as a panel message, so the same components render it. `IssueToolActivity` records
 * each tool call when it starts (with its input) and again when it ends (with its status); the
 * description text it wrote is the run's output.
 */
export function issueRunMessage(run: IssueAgentRun): PanelMessage {
  const tools = new Map<string, ToolPart>()
  for (const event of run.activity ?? []) {
    const known = tools.get(event.id)
    const finished = event.status !== 'running'
    tools.set(event.id, {
      kind: 'tool', key: `${run.id}:${event.id}`, id: event.id, name: event.name, path: [], progress: [],
      input: known?.input ?? event.input ?? {}, finished: finished || (known?.finished ?? false),
      status: finished ? event.status : known?.status,
    })
  }
  const parts: PanelPart[] = [...tools.values()]
  if (run.output) parts.push({ kind: 'text', key: `${run.id}:output`, path: [], text: run.output })
  return { id: `issue-run-${run.id}`, role: 'assistant', runId: run.id, parts }
}

const DESCRIPTION_RULES = 'Reply with only Markdown (headings, paragraphs, lists, task lists, tables), with no preamble. '
  + 'Write only what the request asks for: when it adds to the description (acceptance criteria, a section, a summary), '
  + 'write just that new content and do not repeat what the description already has, because the user inserts it where they choose; '
  + 'when it asks for the whole description, write all of it, because the user overwrites the description with it. '
  + 'Research with your search tools when you need facts and cite them as Markdown links. '
  + 'Do not edit the issue with tools: the user reviews your draft, then inserts it or overwrites the description with it.'

/** First request on an issue description. The issue agent recognises the opening sentence (no preamble). */
export function descriptionRequestMessage(ask: string, goal: boolean): string {
  return `${goal ? '/goal ' : ''}Write the description for this issue. ${ask.trim()}\n${DESCRIPTION_RULES}`
}

/** Try again: the user's feedback on the last draft; Ron writes the whole description again. */
export function descriptionRetryMessage(feedback: string): string {
  return `Write the description for this issue. Revise your last draft with this feedback: ${feedback.trim()}\n`
    + `Write the complete revised description again. ${DESCRIPTION_RULES}`
}
