/**
 * Deep Research client: the REST and SSE calls of `agent/api/endpoints/deep_research.py`, and the
 * fold of the Strands stream events a run keeps (`filter_event` in `agent/api/core/deep_research.py`)
 * into the snapshot the page draws.
 *
 * The events are the SDK's own: `multiagent_node_start`, `multiagent_node_stop`,
 * `multiagent_handoff`, `multiagent_node_cancel` and `multiagent_result`, with each nested node's
 * events inside `multiagent_node_stream`, and an agent's `data`, `reasoningText`, `message` and
 * `tool_stream_event` (the built-in `subagent` tool streams its sub-agent's events there).
 *
 * Pure module (relative `.ts` imports only) so `node --experimental-strip-types --test` runs it.
 */
import { API_BASE_URL } from './api-base.ts'

/** The levels of `LEVELS` in `agent/api/core/deep_research.py`, as Perplexity's Agent API names its efforts. */
export type ResearchDepth = 'fast' | 'low' | 'medium' | 'high' | 'xhigh' | 'ultra'
export const RESEARCH_DEPTHS: readonly ResearchDepth[] = ['fast', 'low', 'medium', 'high', 'xhigh', 'ultra']
export const DEFAULT_RESEARCH_DEPTH: ResearchDepth = 'medium'

export interface DepthMetadata {
  id: ResearchDepth
  label: string
  badge: string
  description: string
}

export const DEPTH_METADATA: readonly DepthMetadata[] = [
  { id: 'fast', label: 'Fast', badge: '5–8 pages', description: 'A quick answer from the strongest sources.' },
  { id: 'low', label: 'Low', badge: '8–12 pages', description: 'A short report on the main questions.' },
  { id: 'medium', label: 'Medium', badge: '12–17 pages', description: 'Several angles, checked and cited.' },
  { id: 'high', label: 'High', badge: '17–23 pages', description: 'More questions, more sources, more checking.' },
  { id: 'xhigh', label: 'Extra High', badge: '23–30 pages', description: 'A long investigation with code and data.' },
  { id: 'ultra', label: 'Ultra', badge: '30–40 pages', description: 'Every angle the agents can find.' },
]

export type FormationNodeKind = 'graph' | 'swarm' | 'agent'

export interface FormationTopologyEdge {
  from: string
  to: string
}

export interface FormationTopologyNode {
  id: string
  label: string
  kind: FormationNodeKind
  skill?: string | undefined
  description?: string | undefined
  children?: FormationTopologyNode[] | undefined
  edges?: FormationTopologyEdge[] | undefined
}

export interface FormationTopology {
  id: string
  label?: string | undefined
  kind: FormationNodeKind
  nodes: FormationTopologyNode[]
  edges: FormationTopologyEdge[]
}

/** `FORMATION_TOPOLOGY` in `agent/api/core/deep_research.py`, drawn until `/deep-research/status` answers. */
export const DEFAULT_FORMATION_TOPOLOGY: FormationTopology = {
  id: 'deep_research_graph',
  label: 'Deep Research',
  kind: 'graph',
  nodes: [
    {
      id: 'research_swarm',
      label: 'Research Swarm',
      kind: 'swarm',
      description: 'Researches the inquiry from primary sources, fact-checks every claim and cites it.',
      children: [
        {
          id: 'researcher',
          label: 'Researcher',
          kind: 'agent',
          skill: 'research',
          description: 'Researches the inquiry from primary sources, follows every claim back to the source that owns it, and writes research.md, every claim with its source URL.',
        },
        {
          id: 'fact_checker',
          label: 'Fact Checker',
          kind: 'agent',
          skill: 'scientific-critical-thinking',
          description: 'The only agent that opens sources: opens the source of every claim in research.md, records a verdict per claim in fact-check.md and fixes or removes what fails.',
        },
        {
          id: 'citation_manager',
          label: 'Citation Manager',
          kind: 'agent',
          skill: 'citation-management',
          description: 'Numbers the citations in research.md and lists each source once in references.md, from the URLs in research.md and fact-check.md, without opening them.',
        },
        {
          id: 'research_qa',
          label: 'Research QA',
          kind: 'agent',
          skill: 'peer-review',
          description: 'Checks research.md, fact-check.md and references.md against each other, without opening sources: every claim cited, every citation in the reference list, every claim passed in fact-check.md.',
        },
      ],
      edges: [],
    },
    {
      id: 'data_analysis_graph',
      label: 'Data Analysis Graph',
      kind: 'graph',
      description: 'Chooses the data visuals that matter, builds them with code, cites them and checks them.',
      children: [
        {
          id: 'visual_planner',
          label: 'Visual Planner',
          kind: 'agent',
          skill: 'data-storytelling',
          description: 'Chooses the data visuals that matter for the inquiry and specifies each in visuals.md: what it shows, the chart type and the data points with their citation numbers.',
        },
        {
          id: 'data_analyst',
          label: 'Data Analyst',
          kind: 'agent',
          skill: 'data-visualization',
          description: 'Builds every visual in visuals.md with Python: figures/<name>.png and the script that made it, figures/<name>.py.',
        },
        {
          id: 'visual_citation',
          label: 'Visual Citation',
          kind: 'agent',
          skill: 'citation-management',
          description: 'Adds each chart\'s caption and the reference numbers its data came from to visuals.md.',
        },
        {
          id: 'visual_qa',
          label: 'Visual QA',
          kind: 'agent',
          skill: 'scientific-visualization',
          description: 'Checks every chart in figures/ against its data and citations in visuals.md and its script, without opening sources, and fixes what is not.',
        },
      ],
      edges: [
        { from: 'visual_planner', to: 'data_analyst' },
        { from: 'data_analyst', to: 'visual_citation' },
        { from: 'visual_citation', to: 'visual_qa' },
      ],
    },
    {
      id: 'writing_swarm',
      label: 'Writing Swarm',
      kind: 'swarm',
      description: 'Designs the report and the deck, writes both, and checks each.',
      children: [
        {
          id: 'report_designer',
          label: 'Report Designer',
          kind: 'agent',
          skill: 'theme-factory',
          description: 'Designs the report in report-layout.md: sections and their order, where each chart goes, typography, colour and page style.',
        },
        {
          id: 'deck_designer',
          label: 'Deck Designer',
          kind: 'agent',
          skill: 'slidev',
          description: 'Designs the Slidev deck in deck-layout.md: an art direction that follows the subject, the theme, palette, type and motion, and each slide\'s layout, chart, Vue component and transition, with three.js scenes where the subject has a shape worth seeing in 3D.',
        },
        {
          id: 'layout_qa',
          label: 'Layout QA',
          kind: 'agent',
          skill: 'verification-before-completion',
          description: 'Checks report-layout.md and deck-layout.md against the inquiry, research.md and figures/.',
        },
        {
          id: 'report_writer',
          label: 'Report Writer',
          kind: 'agent',
          skill: 'scientific-writing',
          description: 'Writes report.md, the run\'s Document, as report-layout.md lays it out: every claim with its citation number, charts as ![caption](figures/<name>.png), processes and timelines as workflows, real videos, pages, maps and PDFs as embeds, and the reference list at the end.',
        },
        {
          id: 'report_qa',
          label: 'Report QA',
          kind: 'agent',
          skill: 'peer-review',
          description: 'Checks report.md against research.md, references.md, figures/ and report-layout.md, without opening sources.',
        },
        {
          id: 'deck_writer',
          label: 'Deck Writer',
          kind: 'agent',
          skill: 'scientific-slides',
          description: 'Writes deck-copy.md as deck-layout.md lays it out: each slide\'s title, points, speaker notes, citation numbers and chart.',
        },
        {
          id: 'deck_qa',
          label: 'Deck QA',
          kind: 'agent',
          skill: 'copy-editing',
          description: 'Checks deck-copy.md against report.md and deck-layout.md.',
        },
      ],
      edges: [],
    },
    {
      id: 'production_graph',
      label: 'Production Graph',
      kind: 'graph',
      description: 'Builds the PDF report and the Slidev deck in parallel, each checked by its own QA.',
      children: [
        {
          id: 'pdf_publisher',
          label: 'PDF Publisher',
          kind: 'agent',
          skill: 'pdf',
          description: 'Builds report.pdf from report.md as report-layout.md styles it, with its charts, citations and reference page.',
        },
        {
          id: 'pdf_qa',
          label: 'PDF QA',
          kind: 'agent',
          skill: 'pdf',
          description: 'Checks report.pdf: charts present, styling as report-layout.md specifies, citations and the reference page intact; fixes what is not.',
        },
        {
          id: 'deck_producer',
          label: 'Slidev Producer',
          kind: 'agent',
          skill: 'slidev',
          description: 'Builds the deck as a Slidev project in the workspace from deck-copy.md and deck-layout.md: slides.md (routerMode: hash), the charts from figures/, Vue components in components/ with three.js scenes, layouts and styles; builds it into slides/ (slidev build --out slides --base ./) and exports slides.pdf.',
        },
        {
          id: 'deck_build_qa',
          label: 'Slidev QA',
          kind: 'agent',
          skill: 'slidev',
          description: 'Checks slides.md, slides/ and slides.pdf against deck-layout.md by looking at every slide: art direction, nothing clipped or overflowing, charts, 3D scenes and citations in place; fixes what is not.',
        },
      ],
      edges: [
        { from: 'pdf_publisher', to: 'pdf_qa' },
        { from: 'deck_producer', to: 'deck_build_qa' },
      ],
    },
  ],
  edges: [
    { from: 'research_swarm', to: 'data_analysis_graph' },
    { from: 'data_analysis_graph', to: 'writing_swarm' },
    { from: 'writing_swarm', to: 'production_graph' },
  ],
}

export type DeepResearchRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export type DeepResearchNodeStatus = 'idle' | 'executing' | 'completed' | 'failed' | 'interrupted' | 'cancelled'

export interface DeepResearchSelection {
  provider: string | null
  model_id: string | null
  reasoning_effort: string | null
}

export interface DeepResearchUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface DeepResearchHandoff {
  id: string
  from_node: string
  to_node: string
  message: string
  node_path: string[]
}

export interface DeepResearchSkillToolCall {
  id: string
  tool_name: string
  input_preview: string
  status: 'running' | 'completed' | 'failed'
  output_preview: string
  input: unknown
  output: string
}

/** Streamed text or reasoning. */
export interface DeepResearchTextPart {
  id: string
  kind: 'text' | 'reasoning'
  text: string
}

/** One entry of a `subagent` sub-agent's work, in the order it happened. */
export type DeepResearchSkillStep = DeepResearchTextPart | { id: string; kind: 'tool'; tool_id: string }

/** One entry of a formation agent's own work, in the order it happened; `pass` marks it starting again. */
export type DeepResearchActivityPart =
  | DeepResearchTextPart
  | { id: string; kind: 'skill'; skill_id: string }
  | { id: string; kind: 'pass'; pass: number }

/** One call of the built-in `subagent` tool and the sub-agent's work. */
export interface DeepResearchSkillExecution {
  id: string
  subagent_id?: string
  skill_name: string
  task: string
  node_path: string[]
  node_key: string
  status: 'running' | 'completed' | 'failed'
  tools: DeepResearchSkillToolCall[]
  output_text: string
  summary: string
  steps: DeepResearchSkillStep[]
}

export interface DeepResearchNodeSnapshot {
  node_id: string
  node_path: string[]
  node_type: FormationNodeKind
  status: DeepResearchNodeStatus
  execution_time_ms: number | null
  execution_count: number
  skill_invocations: DeepResearchSkillExecution[]
  output_preview: string
  streaming_text: string
  activity: DeepResearchActivityPart[]
  error: string | null
}

export interface DeepResearchArtifacts {
  report_pdf_url?: string | null
  report_markdown_url?: string | null
  slidev_preview_url?: string | null
  slidev_pdf_url?: string | null
  slidev_markdown_url?: string | null
}

export interface DeepResearchTraceEntry {
  id: string
  sequence: number
  kind: 'node' | 'handoff' | 'skill'
  title: string
  detail: string
  node_path: string[]
  status: string
  skill_id?: string
}

export interface DeepResearchSnapshot {
  session_id: string
  user_id: string
  query: string
  context: string
  title: string
  depth: ResearchDepth
  status: DeepResearchRunStatus
  active: boolean
  created_at: string
  updated_at: string
  completed_at: string | null
  selection: DeepResearchSelection
  error: string | null
  /** How many of the run's events are folded in: the SSE cursor. */
  sequence: number
  active_node_path: string[]
  completed_nodes: string[]
  failed_nodes: string[]
  execution_order: string[]
  nodes: Record<string, DeepResearchNodeSnapshot>
  handoffs: DeepResearchHandoff[]
  skill_invocations: DeepResearchSkillExecution[]
  trace: DeepResearchTraceEntry[]
  usage: DeepResearchUsage
  execution_time_ms: number
  files: string[]
  report_markdown: string
  slidev_markdown: string
  artifacts: DeepResearchArtifacts
  /** The Document the report was saved as (`ron://documents/<id>`), once it is saved. */
  document_id: string | null
}

/** One kept Strands stream event and its position in the run (the SSE `id`). */
export interface DeepResearchEvent {
  sequence: number
  event: Record<string, unknown>
}

export interface DeepResearchStatusResponse {
  available: boolean
  default_selection: DeepResearchSelection
  depths: ResearchDepth[]
  topology: FormationTopology
}

export interface StartDeepResearchInput {
  query: string
  user_id?: string | undefined
  context?: string | null | undefined
  depth?: ResearchDepth | undefined
  provider?: string | null | undefined
  model_id?: string | null | undefined
  reasoning_effort?: string | null | undefined
}

export interface RequestOptions {
  baseUrl?: string | undefined
  fetcher?: typeof fetch | undefined
  signal?: AbortSignal | undefined
}

export interface StreamDeepResearchOptions extends RequestOptions {
  after?: number | undefined
  onEvent: (event: DeepResearchEvent) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Addresses (`ron://research` and `ron://research/<sessionId>`)
// ─────────────────────────────────────────────────────────────────────────────

/** Parse `ron://research` or `ron://research/<sessionId>`; `null` for any other URL. */
export function parseResearchUrl(url: string | null | undefined): { sessionId: string | null } | null {
  if (!url || typeof url !== 'string') return null
  const match = url.trim().match(/^ron:\/\/research(?:\/([^/?#]+))?\/?(?:[?#].*)?$/i)
  if (!match) return null
  if (!match[1]) return { sessionId: null }
  try {
    return { sessionId: decodeURIComponent(match[1]) }
  } catch {
    return { sessionId: match[1] }
  }
}

export function researchUrl(sessionId?: string | null): string {
  const trimmed = typeof sessionId === 'string' ? sessionId.trim() : ''
  return trimmed ? `ron://research/${encodeURIComponent(trimmed)}` : 'ron://research'
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>

const asRecord = (value: unknown): Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

const asNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

export function nodePathKey(nodePath: readonly string[]): string {
  return nodePath.filter(Boolean).join('/')
}

export function humanizeIdentifier(id: string): string {
  return id
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim()
}

function topologyKinds(nodes: readonly FormationTopologyNode[], into = new Map<string, FormationNodeKind>()) {
  for (const node of nodes) {
    into.set(node.id, node.kind)
    topologyKinds(node.children ?? [], into)
  }
  return into
}

const NODE_KINDS = topologyKinds(DEFAULT_FORMATION_TOPOLOGY.nodes)

function inputPreview(input: unknown): string {
  const obj = asRecord(input)
  for (const key of ['query', 'url', 'task', 'path', 'command']) {
    const value = asString(obj[key]).trim()
    if (value) return `${key}: ${value.slice(0, 200)}`
  }
  try {
    return JSON.stringify(input ?? {}).slice(0, 220)
  } catch {
    return ''
  }
}

/** The text of a message's content blocks, or of a tool result's. */
function blocksText(content: unknown): string {
  return asArray(content)
    .map((block) => {
      const obj = asRecord(block)
      if (typeof obj["text"] === 'string') return obj["text"]
      if (obj["json"] !== undefined) return JSON.stringify(obj["json"])
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

/** Streamed text continues the last part when that part is the same kind. */
function appendText<T extends { id: string; kind: string }>(
  parts: readonly (T | DeepResearchTextPart)[],
  kind: DeepResearchTextPart['kind'],
  text: string,
  id: string,
): (T | DeepResearchTextPart)[] {
  const last = parts[parts.length - 1]
  if (last && isTextPart(last) && last.kind === kind) return [...parts.slice(0, -1), { ...last, text: last.text + text }]
  return [...parts, { id, kind, text }]
}

function isTextPart(part: { kind: string }): part is DeepResearchTextPart {
  return part.kind === 'text' || part.kind === 'reasoning'
}

const NODE_KIND_VALUES: readonly FormationNodeKind[] = ['graph', 'swarm', 'agent']

function topologyEdges(raw: unknown): FormationTopologyEdge[] {
  return asArray(raw)
    .map(asRecord)
    .map((edge) => ({ from: asString(edge["from"]), to: asString(edge["to"]) }))
    .filter((edge) => edge.from && edge.to)
}

function topologyNode(raw: unknown): FormationTopologyNode | null {
  const obj = asRecord(raw)
  const kind = NODE_KIND_VALUES.find((value) => value === obj["kind"])
  const id = asString(obj["id"])
  if (!id || !kind) return null
  const skill = asString(obj["skill"])
  const description = asString(obj["description"])
  const children = asArray(obj["children"]).map(topologyNode).filter((node): node is FormationTopologyNode => node !== null)
  return {
    id,
    label: asString(obj["label"]) || humanizeIdentifier(id),
    kind,
    ...(skill ? { skill } : {}),
    ...(description ? { description } : {}),
    ...(kind === 'agent' ? {} : { children, edges: topologyEdges(obj["edges"]) }),
  }
}

/** `/deep-research/status`'s topology, or the built-in one when it has none. */
export function normalizeFormationTopology(raw: unknown): FormationTopology {
  const obj = asRecord(raw)
  const nodes = asArray(obj["nodes"]).map(topologyNode).filter((node): node is FormationTopologyNode => node !== null)
  if (nodes.length === 0) return DEFAULT_FORMATION_TOPOLOGY
  return {
    id: asString(obj["id"]) || DEFAULT_FORMATION_TOPOLOGY.id,
    label: asString(obj["label"]) || DEFAULT_FORMATION_TOPOLOGY.label,
    kind: 'graph',
    nodes,
    edges: topologyEdges(obj["edges"]),
  }
}

/** An artifact address with the user (and `download`) the endpoint takes, against the API origin. */
export function resolveResearchArtifactUrl(
  urlOrPath: string | null | undefined,
  userId = 'default',
  options?: { baseUrl?: string; download?: boolean },
): string | null {
  const trimmed = (urlOrPath ?? '').trim()
  if (!trimmed) return null
  const base = (options?.baseUrl ?? API_BASE_URL).replace(/\/+$/, '')
  const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `${base}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`)
  url.searchParams.set('user_id', userId || 'default')
  if (options?.download) url.searchParams.set('download', 'true')
  return url.toString()
}

function artifactsFor(sessionId: string, files: readonly string[]): DeepResearchArtifacts {
  const at = (path: string) => `/deep-research/runs/${encodeURIComponent(sessionId)}/artifacts/${path}`
  const has = (path: string) => files.includes(path)
  return {
    report_pdf_url: has('report.pdf') ? at('report.pdf') : null,
    report_markdown_url: has('report.md') ? at('report.md') : null,
    slidev_preview_url: has('slides/index.html') ? at('slides/') : null,
    slidev_pdf_url: has('slides.pdf') ? at('slides.pdf') : null,
    slidev_markdown_url: has('slides.md') ? at('slides.md') : null,
  }
}

export function emptyDeepResearchSnapshot(sessionId: string, init?: Partial<DeepResearchSnapshot>): DeepResearchSnapshot {
  const now = new Date().toISOString()
  return {
    session_id: sessionId,
    user_id: 'default',
    query: '',
    context: '',
    title: 'Deep Research',
    depth: DEFAULT_RESEARCH_DEPTH,
    status: 'running',
    active: false,
    created_at: now,
    updated_at: now,
    completed_at: null,
    selection: { provider: null, model_id: null, reasoning_effort: null },
    error: null,
    sequence: 0,
    active_node_path: [],
    completed_nodes: [],
    failed_nodes: [],
    execution_order: [],
    nodes: {},
    handoffs: [],
    skill_invocations: [],
    trace: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    execution_time_ms: 0,
    files: [],
    report_markdown: '',
    slidev_markdown: '',
    artifacts: {},
    document_id: null,
    ...init,
  }
}

const RUN_STATUSES: readonly DeepResearchRunStatus[] = ['running', 'completed', 'failed', 'cancelled']

/** The run's own fields (`RunMeta` in the backend) over `snapshot`. */
function withMeta(snapshot: DeepResearchSnapshot, raw: Json): DeepResearchSnapshot {
  const status = RUN_STATUSES.find((value) => value === raw["status"]) ?? snapshot.status
  const selection = asRecord(raw["selection"])
  return {
    ...snapshot,
    user_id: asString(raw["user_id"]) || snapshot.user_id,
    query: asString(raw["query"]) || snapshot.query,
    context: asString(raw["context"]) || snapshot.context,
    title: asString(raw["title"]) || snapshot.title,
    depth: RESEARCH_DEPTHS.find((value) => value === raw["depth"]) ?? snapshot.depth,
    status,
    active: typeof raw["active"] === 'boolean' ? raw["active"] : snapshot.active,
    created_at: asString(raw["created_at"]) || snapshot.created_at,
    updated_at: asString(raw["updated_at"]) || snapshot.updated_at,
    completed_at: asString(raw["completed_at"]) || snapshot.completed_at,
    selection: raw["selection"]
      ? {
          provider: asString(selection["provider"]) || null,
          model_id: asString(selection["model_id"]) || null,
          reasoning_effort: asString(selection["reasoning_effort"]) || null,
        }
      : snapshot.selection,
    error: raw["error"] === undefined ? snapshot.error : asString(raw["error"]) || null,
    active_node_path: status === 'running' ? snapshot.active_node_path : [],
    document_id: raw["document_id"] === undefined ? snapshot.document_id : asString(raw["document_id"]) || null,
  }
}

/**
 * A snapshot from a backend answer: a run with its `events` and `files` is folded from the start; a
 * run's meta alone (a listing, a start, a cancel) updates `previous`.
 */
export function normalizeDeepResearchSnapshot(raw: unknown, previous?: DeepResearchSnapshot): DeepResearchSnapshot {
  const obj = asRecord(raw)
  const sessionId = asString(obj["session_id"]) || previous?.session_id || 'research-session'
  if (!Array.isArray(obj["events"])) return withMeta(previous ?? emptyDeepResearchSnapshot(sessionId), obj)
  const files = asArray(obj["files"]).map(asString).filter(Boolean)
  let snapshot = emptyDeepResearchSnapshot(sessionId)
  obj["events"].forEach((event, index) => {
    snapshot = reduceDeepResearchEvent(snapshot, { sequence: index + 1, event: asRecord(event) })
  })
  return withMeta(
    {
      ...snapshot,
      files,
      artifacts: artifactsFor(sessionId, files),
      report_markdown: asString(obj["report_markdown"]),
      slidev_markdown: asString(obj["slidev_markdown"]),
    },
    obj,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The fold
// ─────────────────────────────────────────────────────────────────────────────

const NODE_STATUSES: readonly DeepResearchNodeStatus[] = ['completed', 'failed', 'interrupted', 'cancelled', 'executing']

function nodeEntry(snapshot: DeepResearchSnapshot, path: string[]): DeepResearchNodeSnapshot {
  const key = nodePathKey(path)
  const nodeId = path[path.length - 1] ?? ''
  return (
    snapshot.nodes[key] ?? {
      node_id: nodeId,
      node_path: path,
      node_type: NODE_KINDS.get(nodeId) ?? 'agent',
      status: 'idle',
      execution_time_ms: null,
      execution_count: 0,
      skill_invocations: [],
      output_preview: '',
      streaming_text: '',
      activity: [],
      error: null,
    }
  )
}

function withNode(
  snapshot: DeepResearchSnapshot,
  path: string[],
  change: (node: DeepResearchNodeSnapshot) => Partial<DeepResearchNodeSnapshot>,
): DeepResearchSnapshot {
  const node = nodeEntry(snapshot, path)
  return { ...snapshot, nodes: { ...snapshot.nodes, [nodePathKey(path)]: { ...node, ...change(node) } } }
}

function withSkill(
  snapshot: DeepResearchSnapshot,
  path: string[],
  id: string,
  change: (skill: DeepResearchSkillExecution) => Partial<DeepResearchSkillExecution>,
): DeepResearchSnapshot {
  const key = nodePathKey(path)
  const existing = snapshot.skill_invocations.find((skill) => skill.id === id)
  const skill: DeepResearchSkillExecution = existing ?? {
    id,
    skill_name: 'subagent',
    task: '',
    node_path: path,
    node_key: key,
    status: 'running',
    tools: [],
    output_text: '',
    summary: '',
    steps: [],
  }
  const updated = { ...skill, ...change(skill) }
  const skills = existing
    ? snapshot.skill_invocations.map((item) => (item.id === id ? updated : item))
    : [...snapshot.skill_invocations, updated]
  const next = { ...snapshot, skill_invocations: skills }
  return withNode(next, path, () => ({ skill_invocations: skills.filter((item) => item.node_key === key) }))
}

function trace(snapshot: DeepResearchSnapshot, entry: Omit<DeepResearchTraceEntry, 'id'>): DeepResearchTraceEntry[] {
  return [...snapshot.trace, { ...entry, id: `t${entry.sequence}-${snapshot.trace.length}` }]
}

/** A message's `toolUse` blocks and `toolResult` blocks. */
function messageTools(message: Json): { uses: Json[]; results: Json[] } {
  const blocks = asArray(message["content"]).map(asRecord)
  return {
    uses: blocks.map((block) => asRecord(block["toolUse"])).filter((use) => use["toolUseId"]),
    results: blocks.map((block) => asRecord(block["toolResult"])).filter((result) => result["toolUseId"]),
  }
}

const BACKGROUND_MANAGE_TOOL = 'strands_manage_background_task'
const BACKGROUND_TERMINAL = new Set(['completed', 'failed', 'cancelled'])

function isBackgroundDispatch(content: unknown): boolean {
  const text = blocksText(content)
  return text.startsWith('Background task dispatched.') && /^Task ID:\s*\S+/m.test(text)
}

function parseBackgroundSettlement(content: unknown): {
  taskId: string
  toolUseId: string
  status: string
  output: string
} | null {
  const arr = asArray(content)
  if (arr.length === 0) return null
  const meta = asRecord(asRecord(arr[0])["json"])
  const taskId = asString(meta["task_id"])
  const toolUseId = asString(meta["tool_use_id"])
  const status = asString(meta["status"])
  if (!taskId || !toolUseId || !status) return null
  const body = blocksText(arr.slice(1))
  const errorMsg = asString(asRecord(meta["error"])["message"])
  return { taskId, toolUseId, status, output: body || errorMsg }
}

function isSyntheticBackgroundGet(use: Json): boolean {
  const input = asRecord(use["input"])
  return asString(use["name"]) === BACKGROUND_MANAGE_TOOL && input["mode"] === 'get' && asString(input["task_id"]) === asString(use["toolUseId"])
}

function parseSubagentControlResult(content: unknown): {
  kind: 'spawn' | 'recover' | 'cancel'
  subagentId: string
  recoveredFrom?: string
} | null {
  const arr = asArray(content)
  if (arr.length === 0) return null
  const body = asRecord(asRecord(arr[0])["json"])
  const subagentId = asString(body["subagent_id"])
  if (subagentId && body["status"] === 'running') {
    const recoveredFrom = asString(body["recovered_from"])
    if (recoveredFrom) return { kind: 'recover', subagentId, recoveredFrom }
    return { kind: 'spawn', subagentId }
  }
  const cancelled = asRecord(body["cancelled"])
  const cancelledId = asString(cancelled["subagent_id"])
  if (cancelledId) return { kind: 'cancel', subagentId: cancelledId }
  return null
}

function parseSubagentResume(text: string): {
  kind: 'completed' | 'hangup'
  entries: Array<{ subagentId: string; status: string; output: string; hangupReason: string }>
} | null {
  const isCompleted = text.startsWith('[subagent-completed]')
  const isHangup = text.startsWith('[subagent-hangup]')
  if (!isCompleted && !isHangup) return null
  const bracketIdx = text.indexOf('\n[')
  if (bracketIdx < 0) return null
  try {
    const parsed = JSON.parse(text.slice(bracketIdx + 1))
    if (!Array.isArray(parsed)) return null
    const entries = parsed
      .map(asRecord)
      .filter((item) => asString(item["subagent_id"]))
      .map((item) => ({
        subagentId: asString(item["subagent_id"]),
        status: asString(item["status"]) || 'completed',
        output: asString(item["result"]) || asString(item["error"]),
        hangupReason: asString(item["hangup_reason"]),
      }))
    return entries.length ? { kind: isCompleted ? 'completed' : 'hangup', entries } : null
  } catch {
    return null
  }
}

function resolveSkillId(snapshot: DeepResearchSnapshot, path: string[], idOrSubagentId: string): string {
  const key = nodePathKey(path)
  const match = snapshot.skill_invocations.find(
    (skill) => skill.node_key === key && (skill.id === idOrSubagentId || skill.subagent_id === idOrSubagentId),
  )
  return match?.id ?? idOrSubagentId
}

function foldSubagentEvent(snapshot: DeepResearchSnapshot, path: string[], id: string, event: Json, seq: number) {
  const stepId = `${id}:${seq}`
  if (typeof event["data"] === 'string') {
    const text = event["data"]
    return withSkill(snapshot, path, id, (skill) => ({
      steps: appendText(skill.steps, 'text', text, stepId),
      output_text: skill.output_text + text,
    }))
  }
  if (typeof event["reasoningText"] === 'string') {
    const text = event["reasoningText"]
    return withSkill(snapshot, path, id, (skill) => ({ steps: appendText(skill.steps, 'reasoning', text, stepId) }))
  }
  const message = asRecord(event["message"])
  const { uses, results } = messageTools(message)
  if (message["role"] === 'assistant' && uses.length > 0) {
    const visibleUses = uses.filter((use) => !isSyntheticBackgroundGet(use))
    if (visibleUses.length === 0) return snapshot
    return withSkill(snapshot, path, id, (skill) => ({
      tools: [
        ...skill.tools,
        ...visibleUses.map((use) => ({
          id: asString(use["toolUseId"]),
          tool_name: asString(use["name"]),
          input: use["input"],
          input_preview: inputPreview(use["input"]),
          status: 'running' as const,
          output: '',
          output_preview: '',
        })),
      ],
      steps: [...skill.steps, ...visibleUses.map((use) => ({ id: `${stepId}:${asString(use["toolUseId"])}`, kind: 'tool' as const, tool_id: asString(use["toolUseId"]) }))],
    }))
  }
  if (message["role"] === 'user' && results.length > 0) {
    const byId = new Map(results.map((result) => [asString(result["toolUseId"]), result]))
    const settlements = new Map<string, NonNullable<ReturnType<typeof parseBackgroundSettlement>>>()
    for (const result of results) {
      const settled = parseBackgroundSettlement(result["content"])
      if (settled && BACKGROUND_TERMINAL.has(settled.status)) {
        settlements.set(settled.toolUseId, settled)
      }
    }
    return withSkill(snapshot, path, id, (skill) => ({
      tools: skill.tools.map((tool) => {
        const settled = settlements.get(tool.id)
        if (settled) {
          return {
            ...tool,
            status: settled.status === 'completed' ? 'completed' : 'failed',
            output: settled.output,
            output_preview: settled.output.slice(0, 300),
          }
        }
        const result = byId.get(tool.id)
        if (!result || isBackgroundDispatch(result["content"])) return tool
        const output = blocksText(result["content"])
        return { ...tool, status: result["status"] === 'error' ? 'failed' : 'completed', output, output_preview: output.slice(0, 300) }
      }),
    }))
  }
  return snapshot
}

function foldAgentMessage(snapshot: DeepResearchSnapshot, path: string[], message: Json, seq: number): DeepResearchSnapshot {
  const { uses, results } = messageTools(message)
  let next = snapshot
  if (message["role"] === 'assistant') {
    for (const use of uses.filter((item) => item["name"] === 'subagent')) {
      const id = asString(use["toolUseId"])
      const input = asRecord(use["input"])
      const action = input["action"]
      if (action !== undefined && action !== 'spawn') continue
      const task = asString(input["task"]) || asString(input["prompt"])
      next = withSkill(next, path, id, () => ({ skill_name: asString(input["agent_type"]) || 'subagent', task }))
      next = withNode(next, path, (node) => ({ activity: [...node.activity, { id: `skill:${id}`, kind: 'skill', skill_id: id }] }))
      next = { ...next, trace: trace(next, { sequence: seq, kind: 'skill', title: 'subagent', detail: task, node_path: path, status: 'running', skill_id: id }) }
    }
    const text = blocksText(message["content"])
    if (text) next = withNode(next, path, () => ({ output_preview: text.slice(0, 600) }))
  }
  if (message["role"] === 'user') {
    for (const rawBlock of asArray(message["content"])) {
      const text = asString(asRecord(rawBlock)["text"])
      if (!text) continue
      const resume = parseSubagentResume(text)
      if (!resume) continue
      for (const entry of resume.entries) {
        const targetId = resolveSkillId(next, path, entry.subagentId)
        if (!next.skill_invocations.some((skill) => skill.id === targetId)) continue
        if (resume.kind === 'completed') {
          next = withSkill(next, path, targetId, (skill) => ({
            status: entry.status === 'completed' ? 'completed' : 'failed',
            summary: (entry.output || skill.output_text).slice(0, 600),
            output_text: skill.output_text || entry.output,
          }))
        } else if (entry.hangupReason) {
          next = {
            ...next,
            trace: trace(next, {
              sequence: seq,
              kind: 'skill',
              title: 'subagent hangup',
              detail: entry.hangupReason,
              node_path: path,
              status: 'running',
              skill_id: targetId,
            }),
          }
        }
      }
    }
    for (const result of results) {
      const settled = parseBackgroundSettlement(result["content"])
      if (settled && BACKGROUND_TERMINAL.has(settled.status) && next.skill_invocations.some((skill) => skill.id === settled.toolUseId)) {
        next = withSkill(next, path, settled.toolUseId, (skill) => ({
          status: settled.status === 'completed' ? 'completed' : 'failed',
          summary: settled.output.slice(0, 600),
          output_text: skill.output_text || settled.output,
        }))
        continue
      }
      if (isBackgroundDispatch(result["content"])) continue
      const subControl = parseSubagentControlResult(result["content"])
      const id = asString(result["toolUseId"])
      if (subControl?.kind === 'spawn') {
        if (next.skill_invocations.some((skill) => skill.id === id)) {
          next = withSkill(next, path, id, () => ({ subagent_id: subControl.subagentId, status: 'running' }))
        }
        continue
      }
      if (subControl?.kind === 'recover' && subControl.recoveredFrom) {
        const targetId = resolveSkillId(next, path, subControl.recoveredFrom)
        if (next.skill_invocations.some((skill) => skill.id === targetId)) {
          next = withSkill(next, path, targetId, () => ({ subagent_id: subControl.subagentId, status: 'running' }))
        }
        continue
      }
      if (subControl?.kind === 'cancel') {
        const targetId = resolveSkillId(next, path, subControl.subagentId)
        if (next.skill_invocations.some((skill) => skill.id === targetId)) {
          next = withSkill(next, path, targetId, (skill) => ({
            status: 'failed',
            summary: skill.summary || 'Cancelled.',
          }))
        }
        continue
      }
      if (!next.skill_invocations.some((skill) => skill.id === id)) continue
      const summary = blocksText(result["content"])
      next = withSkill(next, path, id, (skill) => ({
        status: result["status"] === 'error' ? 'failed' : 'completed',
        summary: summary.slice(0, 600),
        output_text: skill.output_text || summary,
      }))
    }
  }
  return next
}

function foldAgentEvent(snapshot: DeepResearchSnapshot, path: string[], event: Json, seq: number): DeepResearchSnapshot {
  if (typeof event["data"] === 'string') {
    const text = event["data"]
    return withNode(snapshot, path, (node) => ({
      activity: appendText(node.activity, 'text', text, `p${seq}`),
      streaming_text: node.streaming_text + text,
    }))
  }
  if (typeof event["reasoningText"] === 'string') {
    const text = event["reasoningText"]
    return withNode(snapshot, path, (node) => ({ activity: appendText(node.activity, 'reasoning', text, `p${seq}`) }))
  }
  if (event["message"]) return foldAgentMessage(snapshot, path, asRecord(event["message"]), seq)
  if (event["force_stop"]) return withNode(snapshot, path, () => ({ error: asString(event["force_stop_reason"]) || 'Stopped.' }))
  const toolStream = asRecord(event["tool_stream_event"])
  const toolUse = asRecord(toolStream["tool_use"])
  if (toolUse["name"] === 'subagent' && toolStream["data"] && typeof toolStream["data"] === 'object') {
    const input = asRecord(toolUse["input"])
    const subId = asString(input["subagent_id"]) || asString(toolUse["toolUseId"])
    const skillId = resolveSkillId(snapshot, path, subId)
    return foldSubagentEvent(snapshot, path, skillId, asRecord(toolStream["data"]), seq)
  }
  return snapshot
}

function multiAgentResultError(result: Json): string | null {
  for (const child of Object.values(asRecord(result["results"]))) {
    const found = nodeResultError(asRecord(child))
    if (found) return found
  }
  return null
}

function nodeResultError(result: Json): string | null {
  const inner = asRecord(result["result"])
  if (inner["type"] === 'exception') return asString(inner["message"]) || 'Failed.'
  if (inner["type"] === 'multiagent_result' && result["status"] === 'failed') return multiAgentResultError(inner)
  return null
}

function foldNodeStop(snapshot: DeepResearchSnapshot, path: string[], event: Json): DeepResearchSnapshot {
  const result = asRecord(event["node_result"])
  const status = NODE_STATUSES.find((value) => value === result["status"]) ?? 'completed'
  const key = nodePathKey(path)
  const next = withNode(snapshot, path, () => ({
    status,
    execution_time_ms: asNumber(result["execution_time"]),
    error: nodeResultError(result),
  }))
  return {
    ...next,
    completed_nodes: status === 'completed' ? [...new Set([...next.completed_nodes, key])] : next.completed_nodes,
    failed_nodes: status === 'failed' ? [...new Set([...next.failed_nodes, key])] : next.failed_nodes,
    trace: trace(next, {
      sequence: next.sequence,
      kind: 'node',
      title: humanizeIdentifier(path[path.length - 1] ?? ''),
      detail: nodeResultError(result) ?? `${status} in ${Math.round(asNumber(result["execution_time"]) / 1000)} s`,
      node_path: path,
      status,
    }),
  }
}

function foldEvent(snapshot: DeepResearchSnapshot, path: string[], event: Json, seq: number): DeepResearchSnapshot {
  const nodeId = asString(event["node_id"])
  const nodePath = [...path, nodeId]
  switch (event["type"]) {
    case 'multiagent_node_stream':
      return foldEvent(snapshot, nodePath, asRecord(event["event"]), seq)
    case 'multiagent_node_start': {
      const key = nodePathKey(nodePath)
      const next = withNode(snapshot, nodePath, (node) => ({
        status: 'executing',
        execution_count: node.execution_count + 1,
        activity:
          node.execution_count > 0
            ? [...node.activity, { id: `pass${seq}`, kind: 'pass', pass: node.execution_count + 1 }]
            : node.activity,
        error: null,
      }))
      return {
        ...next,
        active_node_path: nodePath,
        execution_order: next.execution_order.includes(key) ? next.execution_order : [...next.execution_order, key],
        trace: trace(next, { sequence: seq, kind: 'node', title: humanizeIdentifier(nodeId), detail: 'started', node_path: nodePath, status: 'executing' }),
      }
    }
    case 'multiagent_node_stop':
      return foldNodeStop(snapshot, nodePath, event)
    case 'multiagent_node_cancel':
      return withNode(snapshot, nodePath, () => ({ status: 'cancelled', error: asString(event["message"]) || null }))
    case 'multiagent_handoff': {
      const from = asArray(event["from_node_ids"]).map(asString)
      const to = asArray(event["to_node_ids"]).map(asString)
      const message = asString(event["message"])
      const handoffs = from.flatMap((source) =>
        to.map((target) => ({ id: `h${seq}:${source}:${target}`, from_node: source, to_node: target, message, node_path: path })),
      )
      if (handoffs.length === 0) return snapshot
      return {
        ...snapshot,
        handoffs: [...snapshot.handoffs, ...handoffs],
        trace: trace(snapshot, {
          sequence: seq,
          kind: 'handoff',
          title: `${from.map(humanizeIdentifier).join(', ')} → ${to.map(humanizeIdentifier).join(', ')}`,
          detail: message,
          node_path: path,
          status: 'completed',
        }),
      }
    }
    case 'multiagent_result': {
      if (path.length > 0) return snapshot
      const result = asRecord(event["result"])
      const usage = asRecord(result["accumulated_usage"])
      const failed = result["status"] === 'failed'
      return {
        ...snapshot,
        status: failed ? 'failed' : snapshot.status,
        error: failed ? multiAgentResultError(result) ?? snapshot.error ?? 'The formation failed.' : snapshot.error,
        active_node_path: [],
        execution_time_ms: asNumber(result["execution_time"]),
        usage: { inputTokens: asNumber(usage["inputTokens"]), outputTokens: asNumber(usage["outputTokens"]), totalTokens: asNumber(usage["totalTokens"]) },
      }
    }
    default:
      return path.length > 0 ? foldAgentEvent(snapshot, path, event, seq) : snapshot
  }
}

/** Fold one kept event into the snapshot; an event already folded (by its position) is skipped. */
export function reduceDeepResearchEvent(snapshot: DeepResearchSnapshot, frame: DeepResearchEvent): DeepResearchSnapshot {
  if (frame.sequence <= snapshot.sequence) return snapshot
  return { ...foldEvent({ ...snapshot, sequence: frame.sequence }, [], frame.event, frame.sequence) }
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE frames (`id:` + `data:`, then `event: run`)
// ─────────────────────────────────────────────────────────────────────────────

export class DeepResearchSSEParser {
  private buffer = ''
  private eventId = ''
  private eventName = ''
  private dataLines: string[] = []
  private readonly onEvent: (event: DeepResearchEvent) => void
  private readonly onRun: (meta: Json) => void

  constructor(onEvent: (event: DeepResearchEvent) => void, onRun: (meta: Json) => void) {
    this.onEvent = onEvent
    this.onRun = onRun
  }

  push(chunk: string, final = false): void {
    this.buffer += chunk
    const lines = this.buffer.split(/\r\n|\r|\n/)
    this.buffer = final ? '' : (lines.pop() ?? '')
    for (const line of final ? [...lines, ''] : lines) this.processLine(line)
  }

  private processLine(line: string): void {
    if (!line) {
      this.dispatch()
      return
    }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'id') this.eventId = value
    else if (field === 'event') this.eventName = value
    else if (field === 'data') this.dataLines.push(value)
  }

  private dispatch(): void {
    const payload = this.dataLines.join('\n').trim()
    const name = this.eventName
    const id = Number(this.eventId)
    this.eventId = ''
    this.eventName = ''
    this.dataLines = []
    if (!payload) return
    const parsed = asRecord(JSON.parse(payload))
    if (name === 'run') this.onRun(parsed)
    else if (Number.isFinite(id) && id > 0) this.onEvent({ sequence: id, event: parsed })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP and streaming client
// ─────────────────────────────────────────────────────────────────────────────

function resolveBase(baseUrl?: string): string {
  return (baseUrl ?? API_BASE_URL).replace(/\/+$/, '')
}

async function request(path: string, options: RequestOptions, init: RequestInit = {}): Promise<unknown> {
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(`${resolveBase(options.baseUrl)}/deep-research${path}`, {
    ...init,
    signal: options.signal ?? AbortSignal.timeout(30000),
  })
  if (!response.ok) {
    const text = await response.text()
    let detail = text
    try {
      detail = asString(asRecord(JSON.parse(text))["detail"]) || text
    } catch {
      // not JSON
    }
    throw new Error(`HTTP ${response.status}: ${detail || response.statusText}`)
  }
  return response.json()
}

const runPath = (sessionId: string, userId: string, suffix = '') =>
  `/runs/${encodeURIComponent(sessionId)}${suffix}?${new URLSearchParams({ user_id: userId || 'default' })}`

export async function fetchDeepResearchStatus(options: RequestOptions = {}): Promise<DeepResearchStatusResponse> {
  const raw = asRecord(await request('/status', options))
  const selection = asRecord(raw["default_selection"])
  const depths = asArray(raw["depths"]).filter((value): value is ResearchDepth => RESEARCH_DEPTHS.some((depth) => depth === value))
  return {
    available: raw["available"] !== false,
    default_selection: {
      provider: asString(selection["provider"]) || null,
      model_id: asString(selection["model_id"]) || null,
      reasoning_effort: asString(selection["reasoning_effort"]) || null,
    },
    depths: depths.length > 0 ? depths : [...RESEARCH_DEPTHS],
    topology: normalizeFormationTopology(raw["topology"]),
  }
}

export async function startDeepResearchRun(input: StartDeepResearchInput, options: RequestOptions = {}): Promise<DeepResearchSnapshot> {
  const body = {
    query: input.query.trim(),
    user_id: input.user_id || 'default',
    depth: input.depth ?? DEFAULT_RESEARCH_DEPTH,
    context: input.context?.trim() ?? '',
    provider: input.provider || null,
    model_id: input.model_id || null,
    reasoning_effort: input.reasoning_effort || null,
  }
  const raw = await request('/runs', options, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return normalizeDeepResearchSnapshot(raw)
}

export async function listDeepResearchRuns(
  userId = 'default',
  options: RequestOptions & { limit?: number } = {},
): Promise<DeepResearchSnapshot[]> {
  const params = new URLSearchParams({ user_id: userId || 'default', limit: String(options.limit ?? 50) })
  const raw = asRecord(await request(`/runs?${params}`, options))
  return asArray(raw["runs"]).map((item) => normalizeDeepResearchSnapshot(item))
}

export async function getDeepResearchRun(sessionId: string, userId = 'default', options: RequestOptions = {}): Promise<DeepResearchSnapshot> {
  return normalizeDeepResearchSnapshot(await request(runPath(sessionId, userId), options))
}

/** The run's meta after the cancel, over `previous` (the events folded so far). */
export async function cancelDeepResearchRun(
  sessionId: string,
  userId = 'default',
  options: RequestOptions = {},
  previous?: DeepResearchSnapshot,
): Promise<DeepResearchSnapshot> {
  return normalizeDeepResearchSnapshot(await request(runPath(sessionId, userId, '/cancel'), options, { method: 'POST' }), previous)
}

/** The run's report as a Document page: its title and the editor's HTML, with workflows and figures in place. */
export interface ReportDocument {
  title: string
  content: string
  document_id: string | null
}

export async function fetchReportDocument(sessionId: string, userId = 'default', options: RequestOptions = {}): Promise<ReportDocument> {
  const raw = asRecord(await request(runPath(sessionId, userId, '/document'), options))
  return { title: asString(raw["title"]), content: asString(raw["content"]), document_id: asString(raw["document_id"]) || null }
}

/** Record the Document the report was saved as on the run. */
export async function saveReportDocument(
  sessionId: string,
  documentId: string,
  userId = 'default',
  options: RequestOptions = {},
  previous?: DeepResearchSnapshot,
): Promise<DeepResearchSnapshot> {
  const raw = await request(runPath(sessionId, userId, '/document'), options, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document_id: documentId }),
  })
  return normalizeDeepResearchSnapshot(raw, previous)
}

export async function deleteDeepResearchRun(sessionId: string, userId = 'default', options: RequestOptions = {}): Promise<void> {
  await request(runPath(sessionId, userId), options, { method: 'DELETE' })
}

/** Read the run's events after `options.after` until the run ends (`finished`) or the stream closes. */
export async function streamDeepResearchEvents(
  sessionId: string,
  userId = 'default',
  options: StreamDeepResearchOptions,
): Promise<{ finished: boolean; lastSequence: number }> {
  const fetcher = options.fetcher ?? fetch
  const params = new URLSearchParams({ user_id: userId || 'default', after: String(Math.max(0, options.after ?? 0)) })
  const response = await fetcher(
    `${resolveBase(options.baseUrl)}/deep-research/runs/${encodeURIComponent(sessionId)}/events?${params}`,
    { headers: { Accept: 'text/event-stream' }, ...(options.signal ? { signal: options.signal } : {}) },
  )
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  if (!response.body) throw new Error('Deep Research SSE response has no body')

  let finished = false
  let lastSequence = options.after ?? 0
  const parser = new DeepResearchSSEParser(
    (event) => {
      lastSequence = Math.max(lastSequence, event.sequence)
      options.onEvent(event)
    },
    () => {
      finished = true
    },
  )
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  try {
    while (!finished) {
      const { value, done } = await reader.read()
      if (done) {
        parser.push(decoder.decode(), true)
        break
      }
      parser.push(decoder.decode(value, { stream: true }))
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return { finished, lastSequence }
}
