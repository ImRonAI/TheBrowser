/**
 * Deep Research client, SSE frame parser, and pure nested-formation state reducer.
 *
 * Aligns with `agent/api/core/deep_research.py` and `agent/api/endpoints/deep_research.py`:
 * - `ron://research` and `ron://research/<sessionId>` URL parsing & formatting
 * - Loopback REST surface (`/deep-research/status`, `/deep-research/runs`, cancel, delete)
 * - Versioned SSE replay/live stream (`/deep-research/runs/{id}/events?user_id=...&after=...`)
 * - Pure `reduceDeepResearchEvent(snapshot, event)` across 3-level nested Strands `Graph` +
 *   `Swarm` formation paths (`node_path: string[]`) and `use_skill` subagent invocations.
 *
 * Pure module (relative `.ts` imports only, zero DOM/React dependencies) so
 * `node --experimental-strip-types --test src/lib/deep-research-api.test.ts` runs directly.
 */
import { API_BASE_URL } from './api-base.ts'

export type ResearchDepth = 'standard' | 'deep' | 'exhaustive'
export const RESEARCH_DEPTHS: readonly ResearchDepth[] = ['standard', 'deep', 'exhaustive']
export const DEFAULT_RESEARCH_DEPTH: ResearchDepth = 'deep'

export interface DepthMetadata {
  id: ResearchDepth
  label: string
  badge: string
  description: string
}

export const DEPTH_METADATA: readonly DepthMetadata[] = [
  {
    id: 'standard',
    label: 'Standard',
    badge: 'Focused',
    description: 'Single-pass formation scan with verified citations and concise synthesis.',
  },
  {
    id: 'deep',
    label: 'Deep',
    badge: 'Multi-angle',
    description: 'Parallel web, news, and adversarial swarm probing with verification gates.',
  },
  {
    id: 'exhaustive',
    label: 'Exhaustive',
    badge: 'Max rigor',
    description: 'Multi-pass refinement loops, contrarian stress-testing, and long-form dossier.',
  },
]

export type FormationNodeKind = 'graph' | 'swarm' | 'agent'

export interface FormationTopologyEdge {
  from: string
  to: string
  conditional?: boolean
  label?: string
  condition?: string
}

export interface FormationTopologyNode {
  id: string
  label: string
  kind: FormationNodeKind
  orchestrator_id?: string
  skill?: string
  use_skill_presets?: string[]
  description?: string
  children?: FormationTopologyNode[]
  edges?: FormationTopologyEdge[]
}

export interface FormationTopology {
  id: string
  label?: string
  kind: FormationNodeKind
  nodes: FormationTopologyNode[]
  edges: FormationTopologyEdge[]
}

/**
 * Canonical 3-level Strands `Graph` + nested `Graph` / `Swarm` formation topology.
 * Used immediately before `/deep-research/status` resolves and merged with live server metadata.
 */
export const DEFAULT_FORMATION_TOPOLOGY: FormationTopology = {
  id: 'deep_research_graph',
  label: 'Deep Research Formation',
  kind: 'graph',
  nodes: [
    {
      id: 'planning_formation',
      label: 'Planning Formation',
      kind: 'graph',
      orchestrator_id: 'deep_research_planning',
      description: 'Frames the problem domain and designs the source verification rubric.',
      children: [
        {
          id: 'problem_framing',
          label: 'Problem Framing',
          kind: 'agent',
          skill: 'research-problem-framing',
          use_skill_presets: ['domain-landscape-scan', 'question-decomposition'],
        },
        {
          id: 'research_blueprint',
          label: 'Research Blueprint',
          kind: 'agent',
          skill: 'research-blueprint-design',
          use_skill_presets: ['methodology-design', 'source-rubric'],
        },
      ],
      edges: [{ from: 'problem_framing', to: 'research_blueprint' }],
    },
    {
      id: 'investigation_formation',
      label: 'Investigation Formation',
      kind: 'graph',
      orchestrator_id: 'deep_research_investigation',
      description: 'Parallel web, temporal news, and nested adversarial swarm converging on an evidence ledger.',
      children: [
        {
          id: 'web_intelligence',
          label: 'Web Intelligence',
          kind: 'agent',
          skill: 'web-intelligence-director',
          use_skill_presets: ['broad-web-discovery', 'deep-source-extraction'],
        },
        {
          id: 'news_data_intelligence',
          label: 'News & Data Intelligence',
          kind: 'agent',
          skill: 'news-data-director',
          use_skill_presets: ['temporal-news-analysis', 'quantitative-fact-lookup'],
        },
        {
          id: 'adversarial_swarm',
          label: 'Adversarial Swarm',
          kind: 'swarm',
          orchestrator_id: 'deep_research_adversarial_swarm',
          description: 'Peer hypothesis and contrarian agents challenging claims via handoffs.',
          children: [
            {
              id: 'hypothesis_explorer',
              label: 'Hypothesis Explorer',
              kind: 'agent',
              skill: 'hypothesis-explorer',
              use_skill_presets: ['hypothesis-probing'],
            },
            {
              id: 'contrarian_examiner',
              label: 'Contrarian Examiner',
              kind: 'agent',
              skill: 'contrarian-examiner',
              use_skill_presets: ['counterevidence-search'],
            },
          ],
          edges: [
            { from: 'hypothesis_explorer', to: 'contrarian_examiner', label: 'handoff_to_agent' },
            { from: 'contrarian_examiner', to: 'hypothesis_explorer', label: 'handoff_to_agent' },
          ],
        },
        {
          id: 'evidence_ledger',
          label: 'Evidence Ledger',
          kind: 'agent',
          skill: 'evidence-ledger-curator',
          use_skill_presets: ['evidence-triangulation'],
        },
      ],
      edges: [
        { from: 'web_intelligence', to: 'evidence_ledger', conditional: true, label: 'all branches complete' },
        { from: 'news_data_intelligence', to: 'evidence_ledger', conditional: true, label: 'all branches complete' },
        { from: 'adversarial_swarm', to: 'evidence_ledger', conditional: true, label: 'all branches complete' },
      ],
    },
    {
      id: 'verification_swarm',
      label: 'Verification Swarm',
      kind: 'swarm',
      orchestrator_id: 'deep_research_verification_swarm',
      description: 'Audits primary citations, probes gaps, and either loops for refinement or clears synthesis.',
      children: [
        {
          id: 'citation_verifier',
          label: 'Citation Verifier',
          kind: 'agent',
          skill: 'citation-verifier',
          use_skill_presets: ['source-verification', 'gap-targeted-search'],
        },
        {
          id: 'analytical_critic',
          label: 'Analytical Critic',
          kind: 'agent',
          skill: 'analytical-critic',
          use_skill_presets: ['claim-stress-test'],
        },
      ],
      edges: [
        { from: 'citation_verifier', to: 'analytical_critic', label: 'handoff_to_agent' },
        { from: 'analytical_critic', to: 'citation_verifier', label: 'handoff_to_agent' },
      ],
    },
    {
      id: 'synthesis_formation',
      label: 'Synthesis Formation',
      kind: 'graph',
      orchestrator_id: 'deep_research_synthesis',
      description: 'Drafts the cited dossier, applies anti-slop editorial polish, and compiles PDF + Slidev artifacts.',
      children: [
        {
          id: 'report_drafter',
          label: 'Report Drafter',
          kind: 'agent',
          skill: 'report-drafter',
          use_skill_presets: ['structured-synthesis', 'citation-weaving'],
        },
        {
          id: 'executive_editor',
          label: 'Executive Editor',
          kind: 'agent',
          skill: 'executive-editor',
          use_skill_presets: ['editorial-polish', 'humanizer', 'stop-slop'],
        },
        {
          id: 'pdf_publisher',
          label: 'PDF Publisher',
          kind: 'agent',
          skill: 'pdf',
          use_skill_presets: ['academic-paper', 'pdf'],
        },
        {
          id: 'slidev_producer',
          label: 'Slidev Producer',
          kind: 'agent',
          skill: 'build-agent-slidev',
          use_skill_presets: ['build-agent-slidev', 'slidev', 'scientific-slides'],
        },
      ],
      edges: [
        { from: 'report_drafter', to: 'executive_editor' },
        { from: 'executive_editor', to: 'pdf_publisher' },
        { from: 'executive_editor', to: 'slidev_producer' },
      ],
    },
  ],
  edges: [
    { from: 'planning_formation', to: 'investigation_formation' },
    { from: 'investigation_formation', to: 'verification_swarm' },
    {
      from: 'verification_swarm',
      to: 'investigation_formation',
      conditional: true,
      label: 'Refinement loop',
      condition: '[NEEDS_REFINEMENT]',
    },
    {
      from: 'verification_swarm',
      to: 'synthesis_formation',
      conditional: true,
      label: 'Verified',
      condition: '[VERIFICATION_PASSED]',
    },
  ],
}

export type DeepResearchRunStatus =
  | 'pending'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'

export type DeepResearchNodeStatus =
  | 'idle'
  | 'pending'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'

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

export interface DeepResearchCitation {
  url: string
  title: string
  snippet: string
  source: string
}

export interface DeepResearchHandoff {
  id: string
  from_node: string
  to_node: string
  message: string
  node_path: string[]
  timestamp: string
}

export interface DeepResearchSkillToolCall {
  id: string
  tool_name: string
  input_preview: string
  status: 'running' | 'completed' | 'failed'
  output_preview: string
  timestamp: string
}

export interface DeepResearchSkillExecution {
  id: string
  skill_name: string
  task: string
  node_path: string[]
  node_key: string
  status: 'running' | 'completed' | 'failed'
  started_at: string
  completed_at: string | null
  duration_ms: number | null
  tools: DeepResearchSkillToolCall[]
  output_text: string
  summary: string
}

export interface DeepResearchNodeSnapshot {
  node_id: string
  node_path: string[]
  node_type: FormationNodeKind
  status: DeepResearchNodeStatus
  started_at: string | null
  completed_at: string | null
  execution_time_ms: number | null
  execution_count: number
  skills_used: string[]
  skill_invocations: DeepResearchSkillExecution[]
  output_preview: string
  streaming_text: string
  error: string | null
}

export interface DeepResearchArtifacts {
  report_pdf_url?: string | null
  report_markdown_url?: string | null
  slidev_preview_url?: string | null
  slidev_pdf_url?: string | null
  slidev_markdown_url?: string | null
  [key: string]: string | null | undefined
}

export interface DeepResearchTraceEntry {
  id: string
  sequence: number
  kind: 'run' | 'node' | 'handoff' | 'skill' | 'tool' | 'artifact' | 'error'
  title: string
  detail: string
  node_path: string[]
  status: string
  timestamp: string
  skill_id?: string
}

export interface DeepResearchSnapshot {
  version: number
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
  sequence: number
  replay_after: number
  active_node_path: string[]
  completed_nodes: string[]
  failed_nodes: string[]
  execution_order: string[]
  nodes: Record<string, DeepResearchNodeSnapshot>
  handoffs: DeepResearchHandoff[]
  citations: DeepResearchCitation[]
  usage: DeepResearchUsage
  execution_time_ms: number
  report_markdown: string
  slidev_markdown: string
  artifacts: DeepResearchArtifacts
  summary: string
  error: string | null
  /** Rich per-invocation records for `use_skill` subagents across nested nodes. */
  skill_invocations: DeepResearchSkillExecution[]
  /** Chronological event trace for the Research Studio's Skill & Node Trace tab. */
  trace: DeepResearchTraceEntry[]
  /** Number of conditional verification -> investigation refinement loops executed. */
  refinement_count: number
  /** Tracks which synthesis node is actively streaming `report_markdown` so editor polish cleanly supersedes draft. */
  report_source_node: string | null
}

export type DeepResearchEventType =
  | 'run_started'
  | 'node_start'
  | 'node_stop'
  | 'node_handoff'
  | 'node_cancel'
  | 'node_interrupt'
  | 'skill_start'
  | 'skill_tool'
  | 'skill_delta'
  | 'skill_stop'
  | 'text_delta'
  | 'citation'
  | 'artifact_ready'
  | 'error'
  | 'run_finished'

export interface DeepResearchEvent {
  version?: number
  sequence: number
  session_id: string
  type: DeepResearchEventType | (string & {})
  node_path: string[]
  timestamp: string
  [key: string]: unknown
}

export interface DeepResearchStatusResponse {
  available: boolean
  default_selection: DeepResearchSelection
  depths: ResearchDepth[]
  topology: FormationTopology
}

export interface StartDeepResearchInput {
  query: string
  user_id?: string
  session_id?: string | null
  context?: string | null
  depth?: ResearchDepth
  provider?: string | null
  model_id?: string | null
  reasoning_effort?: string | null
}

export interface RequestOptions {
  baseUrl?: string
  fetcher?: typeof fetch
  signal?: AbortSignal
}

export interface StreamDeepResearchOptions extends RequestOptions {
  after?: number
  onEvent: (event: DeepResearchEvent) => void
}

export class DeepResearchReplayOverflow extends Error {
  readonly requested?: number
  readonly earliest?: number
  readonly latest?: number

  constructor(message: string, details?: { requested?: number; earliest?: number; latest?: number }) {
    super(message)
    this.name = 'DeepResearchReplayOverflow'
    this.requested = details?.requested
    this.earliest = details?.earliest
    this.latest = details?.latest
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// URL Routing Helpers (`ron://research` & `ron://research/<sessionId>`)
// ─────────────────────────────────────────────────────────────────────────────

/** Parse `ron://research` or `ron://research/<sessionId>`; returns `null` for any other URL. */
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

/** Build the internal browser address for Deep Research (`ron://research` or `ron://research/<sessionId>`). */
export function researchUrl(sessionId?: string | null): string {
  const trimmed = typeof sessionId === 'string' ? sessionId.trim() : ''
  return trimmed ? `ron://research/${encodeURIComponent(trimmed)}` : 'ron://research'
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure Normalization Helpers
// ─────────────────────────────────────────────────────────────────────────────

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : value === null || value === undefined ? fallback : String(value)

const asNullableString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const asNullableNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => asString(item).trim()).filter(Boolean) : []

/** Join a hierarchical `node_path` (`["investigation_formation", "adversarial_swarm"]`) into its canonical map key. */
export function nodePathKey(nodePath: readonly string[]): string {
  return nodePath.map((segment) => segment.trim()).filter(Boolean).join('/')
}

export function parseNodePath(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((item) => asString(item).trim()).filter(Boolean)
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split('/').map((part) => part.trim()).filter(Boolean)
  }
  return []
}

function normalizeDepth(value: unknown): ResearchDepth {
  const candidate = asString(value).toLowerCase()
  return (RESEARCH_DEPTHS as readonly string[]).includes(candidate) ? (candidate as ResearchDepth) : DEFAULT_RESEARCH_DEPTH
}

function normalizeRunStatus(value: unknown): DeepResearchRunStatus {
  const raw = asString(value).toLowerCase()
  if (raw === 'executing' || raw === 'running' || raw === 'in_progress') return 'executing'
  if (raw === 'completed' || raw === 'complete' || raw === 'succeeded' || raw === 'done') return 'completed'
  if (raw === 'failed' || raw === 'error') return 'failed'
  if (raw === 'interrupted') return 'interrupted'
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled'
  return 'pending'
}

function normalizeNodeStatus(value: unknown, fallback: DeepResearchNodeStatus = 'idle'): DeepResearchNodeStatus {
  const raw = asString(value).toLowerCase()
  if (raw === 'executing' || raw === 'running' || raw === 'in_progress') return 'executing'
  if (raw === 'completed' || raw === 'complete' || raw === 'succeeded' || raw === 'success') return 'completed'
  if (raw === 'failed' || raw === 'error') return 'failed'
  if (raw === 'interrupted') return 'interrupted'
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled'
  if (raw === 'pending') return 'pending'
  if (raw === 'idle') return 'idle'
  return fallback
}

function normalizeNodeKind(value: unknown, nodeId = ''): FormationNodeKind {
  const raw = asString(value).toLowerCase()
  if (raw === 'graph') return 'graph'
  if (raw === 'swarm') return 'swarm'
  if (raw === 'agent') return 'agent'
  if (nodeId.endsWith('_swarm')) return 'swarm'
  if (nodeId.endsWith('_formation') || nodeId.endsWith('_graph')) return 'graph'
  return 'agent'
}

function normalizeUsage(raw: unknown): DeepResearchUsage {
  const obj = asRecord(raw)
  const inputTokens = asNumber(obj.inputTokens ?? obj.input_tokens, 0)
  const outputTokens = asNumber(obj.outputTokens ?? obj.output_tokens, 0)
  const totalTokens = asNumber(obj.totalTokens ?? obj.total_tokens, inputTokens + outputTokens)
  return { inputTokens, outputTokens, totalTokens }
}

function normalizeSelection(raw: unknown): DeepResearchSelection {
  const obj = asRecord(raw)
  return {
    provider: asNullableString(obj.provider),
    model_id: asNullableString(obj.model_id ?? obj.model),
    reasoning_effort: asNullableString(obj.reasoning_effort ?? obj.effort),
  }
}

function normalizeCitation(raw: unknown, fallbackSource = ''): DeepResearchCitation | null {
  const obj = asRecord(raw)
  const url = asString(obj.url).trim()
  if (!url) return null
  return {
    url,
    title: asString(obj.title).trim() || url,
    snippet: asString(obj.snippet ?? obj.description ?? obj.excerpt).trim(),
    source: asString(obj.source).trim() || fallbackSource,
  }
}

function mergeCitations(
  existing: readonly DeepResearchCitation[],
  incoming: readonly DeepResearchCitation[],
): DeepResearchCitation[] {
  if (!incoming.length) return [...existing]
  const byUrl = new Map<string, DeepResearchCitation>()
  for (const item of existing) {
    byUrl.set(item.url, item)
  }
  for (const item of incoming) {
    const prev = byUrl.get(item.url)
    if (!prev) {
      byUrl.set(item.url, item)
    } else {
      byUrl.set(item.url, {
        url: item.url,
        title: item.title && item.title !== item.url ? item.title : prev.title,
        snippet: item.snippet || prev.snippet,
        source: prev.source || item.source,
      })
    }
  }
  return Array.from(byUrl.values())
}

function formatInputPreview(input: unknown): string {
  if (typeof input === 'string') return input.trim().slice(0, 220)
  if (input === null || input === undefined) return ''
  const obj = asRecord(input)
  for (const key of ['query', 'q', 'url', 'task', 'prompt', 'topic']) {
    if (typeof obj[key] === 'string' && obj[key].trim()) {
      return `${key}: ${(obj[key] as string).trim().slice(0, 200)}`
    }
  }
  try {
    return JSON.stringify(input).slice(0, 220)
  } catch {
    return String(input).slice(0, 220)
  }
}

function normalizeSkillToolCall(raw: unknown, index: number, fallbackTime: string): DeepResearchSkillToolCall {
  const obj = asRecord(raw)
  const statusRaw = asString(obj.status).toLowerCase()
  const status: DeepResearchSkillToolCall['status'] =
    statusRaw === 'failed' || statusRaw === 'error'
      ? 'failed'
      : statusRaw === 'running' || statusRaw === 'executing'
        ? 'running'
        : 'completed'
  return {
    id: asString(obj.id ?? obj.tool_use_id) || `tool-${index}`,
    tool_name: asString(obj.tool_name ?? obj.name) || 'tool',
    input_preview: asString(obj.input_preview) || formatInputPreview(obj.input ?? obj.arguments),
    status,
    output_preview: asString(obj.output_preview ?? obj.summary ?? obj.result).slice(0, 300),
    timestamp: asString(obj.timestamp) || fallbackTime,
  }
}

function normalizeSkillExecution(
  raw: unknown,
  fallbackNodePath: string[],
  index: number,
  fallbackTime: string,
): DeepResearchSkillExecution | null {
  if (typeof raw === 'string') {
    const name = raw.trim()
    if (!name) return null
    const key = nodePathKey(fallbackNodePath)
    return {
      id: `${key || 'root'}:skill:${name}:${index}`,
      skill_name: name,
      task: '',
      node_path: fallbackNodePath,
      node_key: key,
      status: 'completed',
      started_at: fallbackTime,
      completed_at: fallbackTime,
      duration_ms: null,
      tools: [],
      output_text: '',
      summary: '',
    }
  }
  const obj = asRecord(raw)
  const skillName = asString(obj.skill_name ?? obj.preset ?? obj.skill ?? obj.name).trim()
  if (!skillName) return null
  const path = parseNodePath(obj.node_path)
  const effectivePath = path.length > 0 ? path : fallbackNodePath
  const key = nodePathKey(effectivePath)
  const statusRaw = asString(obj.status).toLowerCase()
  const status: DeepResearchSkillExecution['status'] =
    statusRaw === 'failed' || statusRaw === 'error'
      ? 'failed'
      : statusRaw === 'running' || statusRaw === 'executing'
        ? 'running'
        : 'completed'
  const tools = Array.isArray(obj.tools)
    ? obj.tools.map((t, i) => normalizeSkillToolCall(t, i, fallbackTime))
    : []
  return {
    id: asString(obj.id ?? obj.skill_id ?? obj.invocation_id ?? obj.tool_use_id) || `${key || 'root'}:skill:${index}`,
    skill_name: skillName,
    task: asString(obj.task ?? obj.prompt ?? obj.query),
    node_path: effectivePath,
    node_key: key,
    status,
    started_at: asString(obj.started_at ?? obj.timestamp) || fallbackTime,
    completed_at: asNullableString(obj.completed_at),
    duration_ms: asNullableNumber(obj.duration_ms ?? obj.execution_time_ms),
    tools,
    output_text: asString(obj.output_text),
    summary: asString(obj.summary ?? obj.output_preview),
  }
}

export function normalizeFormationTopology(raw: unknown): FormationTopology {
  const obj = asRecord(raw)
  if (!Array.isArray(obj.nodes) || obj.nodes.length === 0) {
    return DEFAULT_FORMATION_TOPOLOGY
  }
  const mapEdge = (edgeRaw: unknown): FormationTopologyEdge | null => {
    const e = asRecord(edgeRaw)
    const from = asString(e.from ?? e.source).trim()
    const to = asString(e.to ?? e.target).trim()
    if (!from || !to) return null
    return {
      from,
      to,
      conditional: Boolean(e.conditional ?? e.is_conditional),
      label: asNullableString(e.label) ?? undefined,
      condition: asNullableString(e.condition) ?? undefined,
    }
  }
  const mapNode = (nodeRaw: unknown): FormationTopologyNode | null => {
    const n = asRecord(nodeRaw)
    const id = asString(n.id ?? n.node_id).trim()
    if (!id) return null
    const children = Array.isArray(n.children ?? n.nodes)
      ? ((n.children ?? n.nodes) as unknown[]).map(mapNode).filter((item): item is FormationTopologyNode => item !== null)
      : undefined
    const edges = Array.isArray(n.edges)
      ? (n.edges as unknown[]).map(mapEdge).filter((item): item is FormationTopologyEdge => item !== null)
      : undefined
    return {
      id,
      label: asString(n.label ?? n.name).trim() || humanizeIdentifier(id),
      kind: normalizeNodeKind(n.kind ?? n.type ?? n.node_type, id),
      orchestrator_id: asNullableString(n.orchestrator_id) ?? undefined,
      skill: asNullableString(n.skill) ?? undefined,
      use_skill_presets: Array.isArray(n.use_skill_presets) ? asStringArray(n.use_skill_presets) : undefined,
      description: asNullableString(n.description) ?? undefined,
      ...(children && children.length > 0 ? { children } : {}),
      ...(edges && edges.length > 0 ? { edges } : {}),
    }
  }
  const nodes = (obj.nodes as unknown[]).map(mapNode).filter((item): item is FormationTopologyNode => item !== null)
  if (!nodes.length) return DEFAULT_FORMATION_TOPOLOGY
  const edges = Array.isArray(obj.edges)
    ? (obj.edges as unknown[]).map(mapEdge).filter((item): item is FormationTopologyEdge => item !== null)
    : DEFAULT_FORMATION_TOPOLOGY.edges
  return {
    id: asString(obj.id) || DEFAULT_FORMATION_TOPOLOGY.id,
    label: asString(obj.label) || DEFAULT_FORMATION_TOPOLOGY.label,
    kind: normalizeNodeKind(obj.kind ?? obj.type, 'deep_research_graph'),
    nodes,
    edges,
  }
}

export function humanizeIdentifier(id: string): string {
  return id
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim()
}

function mapArtifactSlotKey(rawKey: string): keyof DeepResearchArtifacts {
  const k = rawKey.trim().toLowerCase()
  if (k === 'report_pdf' || k === 'report.pdf' || k === 'pdf' || k === 'report_pdf_url') return 'report_pdf_url'
  if (k === 'report_markdown' || k === 'report.md' || k === 'report_markdown_url') return 'report_markdown_url'
  if (
    k === 'slidev_preview' ||
    k === 'slides_preview' ||
    k === 'slidev_html' ||
    k === 'slides' ||
    k === 'slides/index.html' ||
    k === 'slidev_preview_url'
  ) {
    return 'slidev_preview_url'
  }
  if (k === 'slidev_pdf' || k === 'slides_pdf' || k === 'slides.pdf' || k === 'deck_pdf' || k === 'slidev_pdf_url') {
    return 'slidev_pdf_url'
  }
  if (
    k === 'slidev_markdown' ||
    k === 'slides_markdown' ||
    k === 'slides.md' ||
    k === 'slidev_md' ||
    k === 'slidev_markdown_url'
  ) {
    return 'slidev_markdown_url'
  }
  return rawKey.trim()
}

function normalizeArtifacts(raw: unknown, previous?: DeepResearchArtifacts): DeepResearchArtifacts {
  const merged: DeepResearchArtifacts = { ...(previous ?? {}) }
  const obj = asRecord(raw)
  for (const [key, value] of Object.entries(obj)) {
    const str = asNullableString(value)
    if (str) {
      merged[mapArtifactSlotKey(key)] = str
    }
  }
  return merged
}

/**
 * Resolve a Deep Research artifact URL (relative `/deep-research/runs/.../artifacts/...` or full URL)
 * against the configured FastAPI origin so `<iframe src>`, downloads, and fullscreen browser tabs
 * load directly from the backend in both dev (`localhost:5173`) and packaged (`file://`) Electron runs.
 */
export function resolveResearchArtifactUrl(
  urlOrPath: string | null | undefined,
  userId = 'default',
  options?: string | { baseUrl?: string; download?: boolean },
): string | null {
  if (!urlOrPath || typeof urlOrPath !== 'string') return null
  const trimmed = urlOrPath.trim()
  if (!trimmed) return null
  if (/^(blob|data):/i.test(trimmed)) return trimmed

  const baseUrl = typeof options === 'string' ? options : options?.baseUrl
  const download = typeof options === 'object' && options !== null ? Boolean(options.download) : false

  const base = (baseUrl ?? API_BASE_URL).replace(/\/+$/, '')
  const full = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `${base}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`

  if (!full.includes('/deep-research/')) {
    return full
  }
  const hashIdx = full.indexOf('#')
  let beforeHash = hashIdx >= 0 ? full.slice(0, hashIdx) : full
  const hash = hashIdx >= 0 ? full.slice(hashIdx) : ''
  if (!/[?&]user_id=/i.test(beforeHash)) {
    const sep = beforeHash.includes('?') ? '&' : '?'
    beforeHash = `${beforeHash}${sep}user_id=${encodeURIComponent(userId || 'default')}`
  }
  if (download && !/[?&]download=/i.test(beforeHash)) {
    const sep = beforeHash.includes('?') ? '&' : '?'
    beforeHash = `${beforeHash}${sep}download=true`
  }
  return `${beforeHash}${hash}`
}

export function emptyDeepResearchSnapshot(
  sessionId: string,
  init?: Partial<DeepResearchSnapshot>,
): DeepResearchSnapshot {
  const now = new Date().toISOString()
  return {
    version: 1,
    session_id: sessionId,
    user_id: 'default',
    query: '',
    context: '',
    title: 'Deep Research',
    depth: DEFAULT_RESEARCH_DEPTH,
    status: 'pending',
    active: false,
    created_at: now,
    updated_at: now,
    completed_at: null,
    selection: { provider: null, model_id: null, reasoning_effort: null },
    sequence: 0,
    replay_after: 0,
    active_node_path: [],
    completed_nodes: [],
    failed_nodes: [],
    execution_order: [],
    nodes: {},
    handoffs: [],
    citations: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    execution_time_ms: 0,
    report_markdown: '',
    slidev_markdown: '',
    artifacts: {},
    summary: '',
    error: null,
    skill_invocations: [],
    trace: [],
    refinement_count: 0,
    report_source_node: null,
    ...init,
  }
}

/** Normalize a server run snapshot (from `POST /runs`, `GET /runs`, `GET /runs/{id}`, or `POST /cancel`). */
export function normalizeDeepResearchSnapshot(
  raw: unknown,
  previous?: DeepResearchSnapshot,
): DeepResearchSnapshot {
  const obj = asRecord(raw)
  const sessionId = asString(obj.session_id ?? previous?.session_id) || 'research-session'
  const createdAt = asString(obj.created_at ?? previous?.created_at) || new Date().toISOString()
  const updatedAt = asString(obj.updated_at ?? previous?.updated_at) || createdAt
  const status = obj.status !== undefined ? normalizeRunStatus(obj.status) : (previous?.status ?? 'pending')
  const active = typeof obj.active === 'boolean' ? obj.active : status === 'pending' || status === 'executing'

  const rawNodes = asRecord(obj.nodes)
  const nodes: Record<string, DeepResearchNodeSnapshot> = { ...(previous?.nodes ?? {}) }
  const discoveredSkills: DeepResearchSkillExecution[] = []

  for (const [rawKey, entryValue] of Object.entries(rawNodes)) {
    const entry = asRecord(entryValue)
    const parsedPath = parseNodePath(entry.node_path)
    const effectivePath = parsedPath.length > 0 ? parsedPath : parseNodePath(rawKey)
    const key = nodePathKey(effectivePath) || rawKey
    const prevNode = nodes[key]
    const nodeId = asString(entry.node_id) || effectivePath[effectivePath.length - 1] || rawKey

    const skillNames = new Set<string>(prevNode?.skills_used ?? [])
    const nodeInvocations: DeepResearchSkillExecution[] = []
    const rawSkills = Array.isArray(entry.skill_invocations)
      ? entry.skill_invocations
      : Array.isArray(entry.skills_used)
        ? entry.skills_used
        : []

    rawSkills.forEach((skillRaw, index) => {
      if (typeof skillRaw === 'string') {
        if (skillRaw.trim()) skillNames.add(skillRaw.trim())
      } else {
        const exec = normalizeSkillExecution(skillRaw, effectivePath, index, updatedAt)
        if (exec) {
          skillNames.add(exec.skill_name)
          nodeInvocations.push(exec)
          discoveredSkills.push(exec)
        }
      }
    })

    if (Array.isArray(entry.skills_used)) {
      for (const s of entry.skills_used) {
        if (typeof s === 'string' && s.trim()) skillNames.add(s.trim())
      }
    }

    const mergedNodeInvocations =
      nodeInvocations.length > 0
        ? nodeInvocations
        : prevNode?.skill_invocations?.length
          ? prevNode.skill_invocations
          : Array.from(skillNames).map((name, idx) => ({
              id: `${key}:skill:${name}:${idx}`,
              skill_name: name,
              task: '',
              node_path: effectivePath,
              node_key: key,
              status: 'completed' as const,
              started_at: asString(entry.started_at) || updatedAt,
              completed_at: asNullableString(entry.completed_at),
              duration_ms: null,
              tools: [],
              output_text: '',
              summary: '',
            }))

    for (const inv of mergedNodeInvocations) {
      if (!discoveredSkills.some((d) => d.id === inv.id)) {
        discoveredSkills.push(inv)
      }
    }

    nodes[key] = {
      node_id: nodeId,
      node_path: effectivePath,
      node_type: normalizeNodeKind(entry.node_type ?? prevNode?.node_type, nodeId),
      status: normalizeNodeStatus(entry.status, prevNode?.status ?? 'idle'),
      started_at: asNullableString(entry.started_at) ?? prevNode?.started_at ?? null,
      completed_at: asNullableString(entry.completed_at) ?? prevNode?.completed_at ?? null,
      execution_time_ms: asNullableNumber(entry.execution_time_ms) ?? prevNode?.execution_time_ms ?? null,
      execution_count: Math.max(asNumber(entry.execution_count, 0), prevNode?.execution_count ?? 0),
      skills_used: Array.from(skillNames),
      skill_invocations: mergedNodeInvocations,
      output_preview: asString(entry.output_preview) || prevNode?.output_preview || '',
      streaming_text: prevNode?.streaming_text ?? '',
      error: asNullableString(entry.error) ?? prevNode?.error ?? null,
    }
  }

  const topLevelSkills = Array.isArray(obj.skill_invocations)
    ? obj.skill_invocations
        .map((s, idx) => normalizeSkillExecution(s, [], idx, updatedAt))
        .filter((s): s is DeepResearchSkillExecution => s !== null)
    : []

  const skillById = new Map<string, DeepResearchSkillExecution>()
  for (const prevSkill of previous?.skill_invocations ?? []) skillById.set(prevSkill.id, prevSkill)
  for (const nodeSkill of discoveredSkills) {
    if (!skillById.has(nodeSkill.id)) skillById.set(nodeSkill.id, nodeSkill)
  }
  for (const topSkill of topLevelSkills) skillById.set(topSkill.id, topSkill)

  const handoffs: DeepResearchHandoff[] = Array.isArray(obj.handoffs)
    ? obj.handoffs.map((hRaw, index) => {
        const h = asRecord(hRaw)
        const fromList = asStringArray(h.from_node_ids)
        const toList = asStringArray(h.to_node_ids)
        return {
          id: asString(h.id) || `handoff-${index}`,
          from_node: asString(h.from_node ?? h.from_agent) || fromList[0] || 'agent',
          to_node: asString(h.to_node ?? h.to_agent) || toList[0] || 'agent',
          message: asString(h.message),
          node_path: parseNodePath(h.node_path),
          timestamp: asString(h.timestamp) || updatedAt,
        }
      })
    : (previous?.handoffs ?? [])

  const incomingCitations = Array.isArray(obj.citations)
    ? obj.citations
        .map((c) => normalizeCitation(c))
        .filter((c): c is DeepResearchCitation => c !== null)
    : []
  const citations = mergeCitations(previous?.citations ?? [], incomingCitations)

  const sequence = Math.max(asNumber(obj.sequence, 0), previous?.sequence ?? 0)
  const replayAfter = asNumber(obj.replay_after, sequence)
  const query = asString(obj.query) || previous?.query || ''
  const title = asString(obj.title) || previous?.title || (query ? query.slice(0, 90) : 'Deep Research')
  const investigationCount = nodes['investigation_formation']?.execution_count ?? 0
  const refinementCount = Math.max(
    asNumber(obj.refinement_count, 0),
    previous?.refinement_count ?? 0,
    investigationCount > 1 ? investigationCount - 1 : 0,
  )

  return {
    version: asNumber(obj.version, 1),
    session_id: sessionId,
    user_id: asString(obj.user_id) || previous?.user_id || 'default',
    query,
    context: asString(obj.context) || previous?.context || '',
    title,
    depth: obj.depth !== undefined ? normalizeDepth(obj.depth) : (previous?.depth ?? DEFAULT_RESEARCH_DEPTH),
    status,
    active,
    created_at: createdAt,
    updated_at: updatedAt,
    completed_at: asNullableString(obj.completed_at) ?? (active ? null : (previous?.completed_at ?? updatedAt)),
    selection: obj.selection ? normalizeSelection(obj.selection) : (previous?.selection ?? { provider: null, model_id: null, reasoning_effort: null }),
    sequence,
    replay_after: replayAfter,
    active_node_path: obj.active_node_path !== undefined ? parseNodePath(obj.active_node_path) : (active ? (previous?.active_node_path ?? []) : []),
    completed_nodes: obj.completed_nodes !== undefined ? asStringArray(obj.completed_nodes) : (previous?.completed_nodes ?? []),
    failed_nodes: obj.failed_nodes !== undefined ? asStringArray(obj.failed_nodes) : (previous?.failed_nodes ?? []),
    execution_order: obj.execution_order !== undefined ? asStringArray(obj.execution_order) : (previous?.execution_order ?? []),
    nodes,
    handoffs,
    citations,
    usage: obj.usage ? normalizeUsage(obj.usage) : (previous?.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    execution_time_ms: asNumber(obj.execution_time_ms, previous?.execution_time_ms ?? 0),
    report_markdown:
      typeof obj.report_markdown === 'string' && obj.report_markdown.length > 0
        ? obj.report_markdown
        : (previous?.report_markdown ?? ''),
    slidev_markdown:
      typeof obj.slidev_markdown === 'string' && obj.slidev_markdown.length > 0
        ? obj.slidev_markdown
        : (previous?.slidev_markdown ?? ''),
    artifacts: normalizeArtifacts(obj.artifacts, previous?.artifacts),
    summary: asString(obj.summary) || previous?.summary || '',
    error: obj.error !== undefined ? asNullableString(obj.error) : (previous?.error ?? null),
    skill_invocations: Array.from(skillById.values()),
    trace: previous?.trace && previous.trace.length > 0 ? previous.trace : buildSynthesizedTrace(nodes, handoffs, Array.from(skillById.values()), updatedAt),
    refinement_count: refinementCount,
    report_source_node: previous?.report_source_node ?? null,
  }
}

/** Synthesize a readable trace when hydrating a historical completed snapshot cold from storage. */
function buildSynthesizedTrace(
  nodes: Record<string, DeepResearchNodeSnapshot>,
  handoffs: readonly DeepResearchHandoff[],
  skills: readonly DeepResearchSkillExecution[],
  fallbackTime: string,
): DeepResearchTraceEntry[] {
  const entries: DeepResearchTraceEntry[] = []
  let seq = 1
  for (const node of Object.values(nodes)) {
    if (node.status === 'idle') continue
    entries.push({
      id: `hydrated-node-${seq}`,
      sequence: seq++,
      kind: 'node',
      title: humanizeIdentifier(node.node_id),
      detail: node.output_preview || `${node.node_type} ${node.status}`,
      node_path: node.node_path,
      status: node.status,
      timestamp: node.started_at || node.completed_at || fallbackTime,
    })
  }
  for (const handoff of handoffs) {
    entries.push({
      id: `hydrated-handoff-${seq}`,
      sequence: seq++,
      kind: 'handoff',
      title: `${humanizeIdentifier(handoff.from_node)} → ${humanizeIdentifier(handoff.to_node)}`,
      detail: handoff.message,
      node_path: handoff.node_path,
      status: 'completed',
      timestamp: handoff.timestamp || fallbackTime,
    })
  }
  for (const skill of skills) {
    entries.push({
      id: `hydrated-skill-${seq}`,
      sequence: seq++,
      kind: 'skill',
      title: `use_skill · ${skill.skill_name}`,
      detail: skill.summary || skill.task,
      node_path: skill.node_path,
      status: skill.status,
      timestamp: skill.started_at || fallbackTime,
      skill_id: skill.id,
    })
  }
  return entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.sequence - b.sequence)
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure Event Reducer (`reduceDeepResearchEvent`)
// ─────────────────────────────────────────────────────────────────────────────

function ensureNodeEntry(
  nodes: Record<string, DeepResearchNodeSnapshot>,
  nodePath: string[],
  timestamp: string,
  nodeTypeHint?: unknown,
): { nodes: Record<string, DeepResearchNodeSnapshot>; key: string } {
  const nextNodes = { ...nodes }
  // Ensure every ancestor formation in `nodePath` exists so nested paths always connect in the tree.
  for (let depth = 1; depth <= nodePath.length; depth++) {
    const slice = nodePath.slice(0, depth)
    const sliceKey = nodePathKey(slice)
    const sliceId = slice[slice.length - 1]
    const existing = nextNodes[sliceKey]
    if (!existing) {
      nextNodes[sliceKey] = {
        node_id: sliceId,
        node_path: slice,
        node_type: normalizeNodeKind(depth === nodePath.length ? nodeTypeHint : undefined, sliceId),
        status: depth < nodePath.length ? 'executing' : 'pending',
        started_at: timestamp,
        completed_at: null,
        execution_time_ms: null,
        execution_count: depth < nodePath.length ? 1 : 0,
        skills_used: [],
        skill_invocations: [],
        output_preview: '',
        streaming_text: '',
        error: null,
      }
    } else if (depth === nodePath.length && nodeTypeHint) {
      nextNodes[sliceKey] = {
        ...existing,
        node_type: normalizeNodeKind(nodeTypeHint, sliceId),
      }
    }
  }
  return { nodes: nextNodes, key: nodePathKey(nodePath) }
}

function appendTrace(
  trace: readonly DeepResearchTraceEntry[],
  entry: DeepResearchTraceEntry,
  maxEntries = 400,
): DeepResearchTraceEntry[] {
  const next = [...trace, entry]
  return next.length > maxEntries ? next.slice(next.length - maxEntries) : next
}

function syncNodeSkillInvocations(
  nodes: Record<string, DeepResearchNodeSnapshot>,
  nodeKey: string,
  allSkills: readonly DeepResearchSkillExecution[],
): Record<string, DeepResearchNodeSnapshot> {
  if (!nodeKey || !nodes[nodeKey]) return nodes
  const matching = allSkills.filter((item) => item.node_key === nodeKey)
  const names = Array.from(new Set([...nodes[nodeKey].skills_used, ...matching.map((m) => m.skill_name)]))
  return {
    ...nodes,
    [nodeKey]: {
      ...nodes[nodeKey],
      skills_used: names,
      skill_invocations: matching,
    },
  }
}

/**
 * Fold one versioned SSE `DeepResearchEvent` into an immutable `DeepResearchSnapshot`.
 * Handles arbitrary nesting depth in `node_path: string[]`, Swarm handoffs, conditional
 * refinement loops, `use_skill` subagent lifecycles, streaming Markdown, and citations.
 */
export function reduceDeepResearchEvent(
  snapshot: DeepResearchSnapshot,
  event: DeepResearchEvent,
): DeepResearchSnapshot {
  const seq = asNumber(event.sequence, 0)
  // Idempotently ignore already-applied sequence numbers during SSE reconnect/replay.
  if (seq > 0 && seq <= snapshot.sequence) {
    return snapshot
  }

  const timestamp = asString(event.timestamp) || new Date().toISOString()
  const nodePath = parseNodePath(event.node_path)
  const nextSeq = seq > 0 ? seq : snapshot.sequence + 1

  let next: DeepResearchSnapshot = {
    ...snapshot,
    sequence: nextSeq,
    replay_after: nextSeq,
    updated_at: timestamp,
  }

  switch (event.type) {
    case 'run_started': {
      const query = asString(event.query) || next.query
      next = {
        ...next,
        query,
        title: asString(event.title) || next.title || (query ? query.slice(0, 90) : 'Deep Research'),
        depth: event.depth !== undefined ? normalizeDepth(event.depth) : next.depth,
        status: 'executing',
        active: true,
        error: null,
        selection: event.selection ? normalizeSelection(event.selection) : next.selection,
        trace: appendTrace(next.trace, {
          id: `ev-${nextSeq}`,
          sequence: nextSeq,
          kind: 'run',
          title: 'Deep Research formation started',
          detail: query,
          node_path: [],
          status: 'executing',
          timestamp,
        }),
      }
      return next
    }

    case 'node_start': {
      if (nodePath.length === 0) return next
      const { nodes: seeded, key } = ensureNodeEntry(next.nodes, nodePath, timestamp, event.node_type)
      const prevNode = seeded[key]
      const nextExecCount = (prevNode?.execution_count ?? 0) + 1
      const updatedNodes: Record<string, DeepResearchNodeSnapshot> = { ...seeded }

      // When a parent formation is revisited (e.g., `investigation_formation` on `[NEEDS_REFINEMENT]`),
      // reset descendant node statuses to `pending` so the second pass animates cleanly.
      if (nextExecCount > 1) {
        const prefix = `${key}/`
        for (const [otherKey, otherNode] of Object.entries(updatedNodes)) {
          if (otherKey.startsWith(prefix)) {
            updatedNodes[otherKey] = {
              ...otherNode,
              status: 'pending',
              completed_at: null,
              streaming_text: '',
            }
          }
        }
      }

      updatedNodes[key] = {
        ...prevNode,
        node_id: asString(event.node_id) || nodePath[nodePath.length - 1],
        node_path: nodePath,
        node_type: normalizeNodeKind(event.node_type ?? prevNode.node_type, prevNode.node_id),
        status: 'executing',
        started_at: timestamp,
        completed_at: null,
        execution_count: nextExecCount,
        streaming_text: '',
        error: null,
      }

      const executionOrder = [...next.execution_order, key]
      const refinementCount =
        key === 'investigation_formation' && nextExecCount > 1
          ? Math.max(next.refinement_count, nextExecCount - 1)
          : next.refinement_count

      return {
        ...next,
        status: 'executing',
        active: true,
        active_node_path: nodePath,
        execution_order: executionOrder,
        nodes: updatedNodes,
        refinement_count: refinementCount,
        trace: appendTrace(next.trace, {
          id: `ev-${nextSeq}`,
          sequence: nextSeq,
          kind: 'node',
          title: `${humanizeIdentifier(updatedNodes[key].node_id)}${nextExecCount > 1 ? ` (pass ${nextExecCount})` : ''}`,
          detail: `Started ${updatedNodes[key].node_type} node`,
          node_path: nodePath,
          status: 'executing',
          timestamp,
        }),
      }
    }

    case 'node_stop': {
      if (nodePath.length === 0) return next
      const { nodes: seeded, key } = ensureNodeEntry(next.nodes, nodePath, timestamp, event.node_type)
      const prevNode = seeded[key]
      const nodeStatus = normalizeNodeStatus(event.status, 'completed')
      const preview =
        asString(event.output_preview ?? event.summary) ||
        prevNode.streaming_text.trim().slice(0, 400) ||
        prevNode.output_preview
      const durationMs = asNullableNumber(event.execution_time_ms ?? event.duration_ms) ?? prevNode.execution_time_ms

      const updatedNodes: Record<string, DeepResearchNodeSnapshot> = {
        ...seeded,
        [key]: {
          ...prevNode,
          status: nodeStatus,
          completed_at: timestamp,
          execution_time_ms: durationMs,
          execution_count: Math.max(1, prevNode.execution_count),
          output_preview: preview,
          error: nodeStatus === 'failed' ? (asNullableString(event.error) ?? prevNode.error) : prevNode.error,
        },
      }

      const completedNodes =
        nodeStatus === 'completed' && !next.completed_nodes.includes(key)
          ? [...next.completed_nodes, key]
          : next.completed_nodes
      const failedNodes =
        nodeStatus === 'failed' && !next.failed_nodes.includes(key)
          ? [...next.failed_nodes, key]
          : next.failed_nodes

      const activeMatchesStopped = nodePathKey(next.active_node_path) === key
      const nextActivePath = activeMatchesStopped ? nodePath.slice(0, -1) : next.active_node_path

      // Accumulate node-level token metrics if emitted incrementally.
      let usage = next.usage
      if (event.usage) {
        const delta = normalizeUsage(event.usage)
        if (delta.totalTokens > 0) {
          usage = {
            inputTokens: next.usage.inputTokens + delta.inputTokens,
            outputTokens: next.usage.outputTokens + delta.outputTokens,
            totalTokens: next.usage.totalTokens + delta.totalTokens,
          }
        }
      }

      return {
        ...next,
        active_node_path: nextActivePath,
        completed_nodes: completedNodes,
        failed_nodes: failedNodes,
        nodes: updatedNodes,
        usage,
        trace: appendTrace(next.trace, {
          id: `ev-${nextSeq}`,
          sequence: nextSeq,
          kind: 'node',
          title: `${humanizeIdentifier(updatedNodes[key].node_id)} ${nodeStatus}`,
          detail: preview.slice(0, 240),
          node_path: nodePath,
          status: nodeStatus,
          timestamp,
        }),
      }
    }

    case 'node_handoff': {
      const fromIds = asStringArray(event.from_node_ids)
      const toIds = asStringArray(event.to_node_ids)
      const fromNode = asString(event.from_node ?? event.from_agent) || fromIds[0] || 'agent'
      const toNode = asString(event.to_node ?? event.to_agent) || toIds[0] || 'agent'
      const message = asString(event.message)
      const handoff: DeepResearchHandoff = {
        id: asString(event.handoff_id) || `handoff-${nextSeq}`,
        from_node: fromNode,
        to_node: toNode,
        message,
        node_path: nodePath,
        timestamp,
      }
      return {
        ...next,
        handoffs: [...next.handoffs, handoff],
        trace: appendTrace(next.trace, {
          id: `ev-${nextSeq}`,
          sequence: nextSeq,
          kind: 'handoff',
          title: `${humanizeIdentifier(fromNode)} → ${humanizeIdentifier(toNode)}`,
          detail: message || 'Swarm handoff_to_agent',
          node_path: nodePath,
          status: 'completed',
          timestamp,
        }),
      }
    }

    case 'node_cancel': {
      const reason = asString(event.reason ?? event.message) || 'Node cancelled'
      if (nodePath.length === 0) {
        return {
          ...next,
          trace: appendTrace(next.trace, {
            id: `ev-${nextSeq}`,
            sequence: nextSeq,
            kind: 'node',
            title: 'Formation cancelled',
            detail: reason,
            node_path: [],
            status: 'cancelled',
            timestamp,
          }),
        }
      }
      const { nodes: seeded, key } = ensureNodeEntry(next.nodes, nodePath, timestamp)
      const updatedNodes: Record<string, DeepResearchNodeSnapshot> = {
        ...seeded,
        [key]: {
          ...seeded[key],
          status: 'cancelled',
          completed_at: timestamp,
          error: reason,
        },
      }
      return {
        ...next,
        nodes: updatedNodes,
        active_node_path: nodePathKey(next.active_node_path) === key ? nodePath.slice(0, -1) : next.active_node_path,
        trace: appendTrace(next.trace, {
          id: `ev-${nextSeq}`,
          sequence: nextSeq,
          kind: 'node',
          title: `${humanizeIdentifier(updatedNodes[key].node_id)} cancelled`,
          detail: reason,
          node_path: nodePath,
          status: 'cancelled',
          timestamp,
        }),
      }
    }

    case 'node_interrupt': {
      const reason = asString(event.reason ?? event.message) || 'Formation interrupted'
      let updatedNodes = next.nodes
      if (nodePath.length > 0) {
        const seeded = ensureNodeEntry(next.nodes, nodePath, timestamp)
        updatedNodes = {
          ...seeded.nodes,
          [seeded.key]: {
            ...seeded.nodes[seeded.key],
            status: 'interrupted',
            error: reason,
          },
        }
      }
      return {
        ...next,
        status: 'interrupted',
        nodes: updatedNodes,
        trace: appendTrace(next.trace, {
          id: `ev-${nextSeq}`,
          sequence: nextSeq,
          kind: 'node',
          title: nodePath.length ? `${humanizeIdentifier(nodePath[nodePath.length - 1])} interrupted` : 'Formation interrupted',
          detail: reason,
          node_path: nodePath,
          status: 'interrupted',
          timestamp,
        }),
      }
    }

    case 'skill_start': {
      const effectivePath = nodePath.length > 0 ? nodePath : next.active_node_path
      const key = nodePathKey(effectivePath)
      const skillName = asString(event.skill_name ?? event.preset ?? event.skill ?? event.name) || 'use_skill'
      const skillId =
        asString(event.skill_id ?? event.invocation_id ?? event.tool_use_id) ||
        `${key || 'root'}:skill:${nextSeq}`
      const task = asString(event.task ?? event.prompt ?? event.query)

      const newSkill: DeepResearchSkillExecution = {
        id: skillId,
        skill_name: skillName,
        task,
        node_path: effectivePath,
        node_key: key,
        status: 'running',
        started_at: timestamp,
        completed_at: null,
        duration_ms: null,
        tools: [],
        output_text: '',
        summary: '',
      }

      const existingIdx = next.skill_invocations.findIndex((item) => item.id === skillId)
      const skillInvocations =
        existingIdx >= 0
          ? next.skill_invocations.map((item, idx) => (idx === existingIdx ? { ...item, ...newSkill } : item))
          : [...next.skill_invocations, newSkill]

      let updatedNodes = next.nodes
      if (effectivePath.length > 0) {
        const seeded = ensureNodeEntry(next.nodes, effectivePath, timestamp)
        updatedNodes = syncNodeSkillInvocations(seeded.nodes, seeded.key, skillInvocations)
      }

      return {
        ...next,
        nodes: updatedNodes,
        skill_invocations: skillInvocations,
        trace: appendTrace(next.trace, {
          id: `ev-${nextSeq}`,
          sequence: nextSeq,
          kind: 'skill',
          title: `use_skill · ${skillName}`,
          detail: task || 'Executing skill-guided subagent',
          node_path: effectivePath,
          status: 'running',
          timestamp,
          skill_id: skillId,
        }),
      }
    }

    case 'skill_tool': {
      const effectivePath = nodePath.length > 0 ? nodePath : next.active_node_path
      const key = nodePathKey(effectivePath)
      const targetSkillId = asString(event.skill_id ?? event.invocation_id ?? event.parent_tool_use_id)
      const toolName = asString(event.tool_name ?? event.name) || 'research_tool'
      const toolId = asString(event.tool_use_id ?? event.id) || `tool-${nextSeq}`
      const toolStatusRaw = asString(event.status).toLowerCase()
      const toolStatus: DeepResearchSkillToolCall['status'] =
        toolStatusRaw === 'failed' || toolStatusRaw === 'error'
          ? 'failed'
          : toolStatusRaw === 'completed' || toolStatusRaw === 'success'
            ? 'completed'
            : 'running'
      const inputPreview = asString(event.input_preview) || formatInputPreview(event.input ?? event.arguments)
      const outputPreview = asString(event.output_preview ?? event.summary).slice(0, 300)

      let matchedIndex = -1
      if (targetSkillId) {
        matchedIndex = next.skill_invocations.findIndex((s) => s.id === targetSkillId)
      }
      if (matchedIndex < 0) {
        for (let i = next.skill_invocations.length - 1; i >= 0; i--) {
          if (next.skill_invocations[i].node_key === key && next.skill_invocations[i].status === 'running') {
            matchedIndex = i
            break
          }
        }
      }
      if (matchedIndex < 0 && next.skill_invocations.length > 0) {
        for (let i = next.skill_invocations.length - 1; i >= 0; i--) {
          if (next.skill_invocations[i].status === 'running') {
            matchedIndex = i
            break
          }
        }
      }

      let skillInvocations = next.skill_invocations
      let resolvedSkillId: string | undefined
      if (matchedIndex >= 0) {
        const target = next.skill_invocations[matchedIndex]
        resolvedSkillId = target.id
        const existingToolIdx = target.tools.findIndex((t) => t.id === toolId)
        const nextTool: DeepResearchSkillToolCall = {
          id: toolId,
          tool_name: toolName,
          input_preview: inputPreview || (existingToolIdx >= 0 ? target.tools[existingToolIdx].input_preview : ''),
          status: toolStatus,
          output_preview: outputPreview || (existingToolIdx >= 0 ? target.tools[existingToolIdx].output_preview : ''),
          timestamp,
        }
        const tools =
          existingToolIdx >= 0
            ? target.tools.map((t, idx) => (idx === existingToolIdx ? nextTool : t))
            : [...target.tools, nextTool]
        skillInvocations = next.skill_invocations.map((s, idx) => (idx === matchedIndex ? { ...s, tools } : s))
      }

      const updatedNodes = key ? syncNodeSkillInvocations(next.nodes, key, skillInvocations) : next.nodes

      return {
        ...next,
        nodes: updatedNodes,
        skill_invocations: skillInvocations,
        trace: appendTrace(next.trace, {
          id: `ev-${nextSeq}`,
          sequence: nextSeq,
          kind: 'tool',
          title: toolName,
          detail: inputPreview || outputPreview || 'Leaf research tool call',
          node_path: effectivePath,
          status: toolStatus,
          timestamp,
          skill_id: resolvedSkillId,
        }),
      }
    }

    case 'skill_delta': {
      const effectivePath = nodePath.length > 0 ? nodePath : next.active_node_path
      const key = nodePathKey(effectivePath)
      const delta = asString(event.delta ?? event.text)
      if (!delta) return next
      const targetSkillId = asString(event.skill_id ?? event.invocation_id ?? event.tool_use_id)

      let matchedIndex = targetSkillId ? next.skill_invocations.findIndex((s) => s.id === targetSkillId) : -1
      if (matchedIndex < 0) {
        for (let i = next.skill_invocations.length - 1; i >= 0; i--) {
          if (next.skill_invocations[i].node_key === key && next.skill_invocations[i].status === 'running') {
            matchedIndex = i
            break
          }
        }
      }
      if (matchedIndex < 0) return next

      const target = next.skill_invocations[matchedIndex]
      const outputText = target.output_text + delta
      const updatedSkill: DeepResearchSkillExecution = {
        ...target,
        output_text: outputText,
        summary: outputText.trim().slice(0, 320),
      }
      const skillInvocations = next.skill_invocations.map((s, idx) => (idx === matchedIndex ? updatedSkill : s))
      const updatedNodes = key ? syncNodeSkillInvocations(next.nodes, key, skillInvocations) : next.nodes

      return {
        ...next,
        nodes: updatedNodes,
        skill_invocations: skillInvocations,
      }
    }

    case 'skill_stop': {
      const effectivePath = nodePath.length > 0 ? nodePath : next.active_node_path
      const key = nodePathKey(effectivePath)
      const targetSkillId = asString(event.skill_id ?? event.invocation_id ?? event.tool_use_id)
      const skillNameHint = asString(event.skill_name ?? event.preset ?? event.skill)
      const statusRaw = asString(event.status).toLowerCase()
      const finalStatus: DeepResearchSkillExecution['status'] =
        statusRaw === 'failed' || statusRaw === 'error' ? 'failed' : 'completed'

      let matchedIndex = targetSkillId ? next.skill_invocations.findIndex((s) => s.id === targetSkillId) : -1
      if (matchedIndex < 0) {
        for (let i = next.skill_invocations.length - 1; i >= 0; i--) {
          const candidate = next.skill_invocations[i]
          if (
            candidate.status === 'running' &&
            candidate.node_key === key &&
            (!skillNameHint || candidate.skill_name === skillNameHint)
          ) {
            matchedIndex = i
            break
          }
        }
      }
      if (matchedIndex < 0) {
        for (let i = next.skill_invocations.length - 1; i >= 0; i--) {
          if (next.skill_invocations[i].status === 'running') {
            matchedIndex = i
            break
          }
        }
      }

      let skillInvocations = next.skill_invocations
      let skillLabel = skillNameHint || 'use_skill'
      let summaryText = asString(event.summary ?? event.output_preview)
      let resolvedSkillId: string | undefined

      if (matchedIndex >= 0) {
        const target = next.skill_invocations[matchedIndex]
        skillLabel = target.skill_name
        resolvedSkillId = target.id
        summaryText = summaryText || target.summary || target.output_text.trim().slice(0, 320)
        const updatedSkill: DeepResearchSkillExecution = {
          ...target,
          status: finalStatus,
          completed_at: timestamp,
          duration_ms: asNullableNumber(event.duration_ms ?? event.execution_time_ms) ?? target.duration_ms,
          summary: summaryText,
          tools: target.tools.map((t) => (t.status === 'running' ? { ...t, status: finalStatus } : t)),
        }
        skillInvocations = next.skill_invocations.map((s, idx) => (idx === matchedIndex ? updatedSkill : s))
      }

      const incomingCitations = Array.isArray(event.citations)
        ? event.citations
            .map((c) => normalizeCitation(c, skillLabel))
            .filter((c): c is DeepResearchCitation => c !== null)
        : []

      const updatedNodes = key ? syncNodeSkillInvocations(next.nodes, key, skillInvocations) : next.nodes

      return {
        ...next,
        nodes: updatedNodes,
        skill_invocations: skillInvocations,
        citations: mergeCitations(next.citations, incomingCitations),
        trace: appendTrace(next.trace, {
          id: `ev-${nextSeq}`,
          sequence: nextSeq,
          kind: 'skill',
          title: `use_skill · ${skillLabel} ${finalStatus}`,
          detail: summaryText.slice(0, 240),
          node_path: effectivePath,
          status: finalStatus,
          timestamp,
          skill_id: resolvedSkillId,
        }),
      }
    }

    case 'text_delta': {
      const delta = asString(event.delta ?? event.text)
      if (!delta) return next

      let updatedNodes = next.nodes
      if (nodePath.length > 0) {
        const seeded = ensureNodeEntry(next.nodes, nodePath, timestamp)
        const prevNode = seeded.nodes[seeded.key]
        const streamingText = prevNode.streaming_text + delta
        updatedNodes = {
          ...seeded.nodes,
          [seeded.key]: {
            ...prevNode,
            streaming_text: streamingText,
            output_preview: streamingText.trim().slice(0, 400),
          },
        }
      }

      const leafNode = nodePath[nodePath.length - 1] ?? ''
      const isSlidevStream =
        event.is_slidev === true ||
        event.target === 'slidev' ||
        event.target === 'slides' ||
        leafNode.toLowerCase().includes('slide')

      if (isSlidevStream) {
        return {
          ...next,
          nodes: updatedNodes,
          slidev_markdown: next.slidev_markdown + delta,
        }
      }

      const isNonProseArtifactPublisher =
        leafNode.toLowerCase().includes('pdf') || leafNode.toLowerCase().includes('publisher')

      const isSynthesisStream =
        event.is_report === true ||
        event.target === 'report' ||
        nodePath.length === 0 ||
        (nodePath[0] === 'synthesis_formation' && !isNonProseArtifactPublisher)

      let reportMarkdown = next.report_markdown
      let reportSourceNode = next.report_source_node
      if (isSynthesisStream) {
        const sourceId = leafNode || 'report'
        if (
          sourceId === 'executive_editor' &&
          reportSourceNode &&
          reportSourceNode !== 'executive_editor'
        ) {
          // Executive editor begins streaming the polished dossier; cleanly replace the raw draft buffer.
          reportMarkdown = delta
          reportSourceNode = 'executive_editor'
        } else if (sourceId === 'report_drafter' && reportSourceNode === 'executive_editor') {
          // Ignore late draft chunks once executive_editor owns the report stream.
        } else {
          reportMarkdown = next.report_markdown + delta
          reportSourceNode = sourceId
        }
      }

      return {
        ...next,
        nodes: updatedNodes,
        report_markdown: reportMarkdown,
        report_source_node: reportSourceNode,
      }
    }

    case 'artifact_ready': {
      let artifacts = normalizeArtifacts(event.artifacts, next.artifacts)
      const singleSlot = asString(event.artifact_type ?? event.artifact ?? event.kind ?? event.name).trim()
      const singleUrl = asNullableString(event.url ?? event.path)
      if (singleSlot && singleUrl) {
        artifacts = {
          ...artifacts,
          [mapArtifactSlotKey(singleSlot)]: singleUrl,
        }
      }
      const slidevMarkdown =
        typeof event.slidev_markdown === 'string' && event.slidev_markdown.length > 0
          ? event.slidev_markdown
          : next.slidev_markdown
      const reportMarkdown =
        typeof event.report_markdown === 'string' && event.report_markdown.length > 0
          ? event.report_markdown
          : next.report_markdown
      const label =
        asString(event.label ?? event.title) ||
        (singleSlot ? humanizeIdentifier(singleSlot) : 'Studio artifacts ready')

      return {
        ...next,
        artifacts,
        slidev_markdown: slidevMarkdown,
        report_markdown: reportMarkdown,
        trace: appendTrace(next.trace, {
          id: `ev-${nextSeq}`,
          sequence: nextSeq,
          kind: 'artifact',
          title: label,
          detail: singleUrl || Object.values(artifacts).filter(Boolean).join(' · ') || 'Artifact published',
          node_path: nodePath,
          status: 'completed',
          timestamp,
        }),
      }
    }

    case 'citation': {
      const single = normalizeCitation(event.citation ?? event, nodePathKey(nodePath))
      const batch = Array.isArray(event.citations)
        ? event.citations
            .map((c) => normalizeCitation(c, nodePathKey(nodePath)))
            .filter((c): c is DeepResearchCitation => c !== null)
        : []
      const incoming = [...(single ? [single] : []), ...batch]
      return {
        ...next,
        citations: mergeCitations(next.citations, incoming),
      }
    }

    case 'error': {
      const message = asString(event.error ?? event.message) || 'Deep Research error'
      let updatedNodes = next.nodes
      if (nodePath.length > 0) {
        const seeded = ensureNodeEntry(next.nodes, nodePath, timestamp)
        updatedNodes = {
          ...seeded.nodes,
          [seeded.key]: {
            ...seeded.nodes[seeded.key],
            status: event.fatal === false ? seeded.nodes[seeded.key].status : 'failed',
            error: message,
          },
        }
      }
      return {
        ...next,
        error: message,
        nodes: updatedNodes,
        trace: appendTrace(next.trace, {
          id: `ev-${nextSeq}`,
          sequence: nextSeq,
          kind: 'error',
          title: 'Formation error',
          detail: message,
          node_path: nodePath,
          status: 'failed',
          timestamp,
        }),
      }
    }

    case 'run_finished': {
      const finalStatus = event.status
        ? normalizeRunStatus(event.status)
        : next.error
          ? 'failed'
          : 'completed'
      const terminalNodeStatus: DeepResearchNodeStatus =
        finalStatus === 'cancelled'
          ? 'cancelled'
          : finalStatus === 'failed'
            ? 'failed'
            : finalStatus === 'interrupted'
              ? 'interrupted'
              : 'completed'

      const settledNodes: Record<string, DeepResearchNodeSnapshot> = {}
      for (const [k, n] of Object.entries(next.nodes)) {
        settledNodes[k] =
          n.status === 'executing'
            ? { ...n, status: terminalNodeStatus, completed_at: n.completed_at ?? timestamp }
            : n
      }

      const settledSkills = next.skill_invocations.map((s) =>
        s.status === 'running'
          ? { ...s, status: (finalStatus === 'completed' ? 'completed' : 'failed') as 'completed' | 'failed', completed_at: timestamp }
          : s,
      )

      const incomingCitations = Array.isArray(event.citations)
        ? event.citations
            .map((c) => normalizeCitation(c))
            .filter((c): c is DeepResearchCitation => c !== null)
        : []

      const finalReport =
        typeof event.report_markdown === 'string' && event.report_markdown.length > 0
          ? event.report_markdown
          : next.report_markdown
      const finalSlidev =
        typeof event.slidev_markdown === 'string' && event.slidev_markdown.length > 0
          ? event.slidev_markdown
          : next.slidev_markdown
      const finalArtifacts = event.artifacts ? normalizeArtifacts(event.artifacts, next.artifacts) : next.artifacts

      return {
        ...next,
        status: finalStatus,
        active: false,
        completed_at: asNullableString(event.completed_at) ?? timestamp,
        active_node_path: [],
        nodes: settledNodes,
        skill_invocations: settledSkills,
        citations: mergeCitations(next.citations, incomingCitations),
        usage: event.usage ? normalizeUsage(event.usage) : next.usage,
        execution_time_ms: asNumber(event.execution_time_ms, next.execution_time_ms),
        report_markdown: finalReport,
        slidev_markdown: finalSlidev,
        artifacts: finalArtifacts,
        summary: asString(event.summary) || next.summary || finalReport.slice(0, 280),
        error: finalStatus === 'failed' ? (asNullableString(event.error) ?? next.error) : next.error,
        trace: appendTrace(next.trace, {
          id: `ev-${nextSeq}`,
          sequence: nextSeq,
          kind: 'run',
          title: `Deep Research ${finalStatus}`,
          detail: asString(event.summary) || (finalStatus === 'completed' ? 'Synthesis dossier ready.' : next.error || ''),
          node_path: [],
          status: finalStatus,
          timestamp,
        }),
      }
    }

    default:
      return next
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE Frame Parser (`id:` + `event:` + `data:`)
// ─────────────────────────────────────────────────────────────────────────────

export class DeepResearchSSEParser {
  private buffer = ''
  private eventId = ''
  private eventName = ''
  private dataLines: string[] = []
  private first = true
  private readonly emit: (event: DeepResearchEvent) => void

  constructor(emit: (event: DeepResearchEvent) => void) {
    this.emit = emit
  }

  push(chunk: string, final = false): void {
    if (this.first && chunk.length > 0) {
      chunk = chunk.replace(/^\uFEFF/, '')
      this.first = false
    }
    this.buffer += chunk
    let start = 0
    for (let index = 0; index < this.buffer.length; index++) {
      const char = this.buffer[index]
      if (char !== '\r' && char !== '\n') continue
      if (char === '\r' && index === this.buffer.length - 1 && !final) break
      this.processLine(this.buffer.slice(start, index))
      if (char === '\r' && this.buffer[index + 1] === '\n') index++
      start = index + 1
    }
    this.buffer = this.buffer.slice(start)
    if (final) {
      if (this.buffer) this.processLine(this.buffer)
      this.buffer = ''
      this.dispatch()
    }
  }

  private processLine(line: string): void {
    if (!line) {
      this.dispatch()
      return
    }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'id') this.eventId = value
    else if (field === 'event') this.eventName = value
    else if (field === 'data') this.dataLines.push(value)
  }

  private dispatch(): void {
    const idStr = this.eventId
    const nameStr = this.eventName
    const payload = this.dataLines.join('\n').trim()
    this.eventId = ''
    this.eventName = ''
    this.dataLines = []
    if (!payload) return
    const parsed = JSON.parse(payload) as Record<string, unknown>
    const parsedSeq = Number(idStr)
    const sequence =
      typeof parsed.sequence === 'number' && Number.isFinite(parsed.sequence)
        ? parsed.sequence
        : Number.isFinite(parsedSeq) && idStr !== ''
          ? parsedSeq
          : 0
    const type = asString(parsed.type ?? nameStr) || 'unknown'
    this.emit({
      ...parsed,
      sequence,
      session_id: asString(parsed.session_id),
      type,
      node_path: parseNodePath(parsed.node_path),
      timestamp: asString(parsed.timestamp) || new Date().toISOString(),
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP & Streaming Client
// ─────────────────────────────────────────────────────────────────────────────

function resolveBase(baseUrl?: string): string {
  return (baseUrl ?? API_BASE_URL).replace(/\/+$/, '')
}

async function toHttpError(response: Response): Promise<Error> {
  const rawText = await response.text()
  try {
    const body = JSON.parse(rawText) as { detail?: unknown; error?: unknown }
    const detailObj = asRecord(body.detail)
    if (response.status === 410 || detailObj.code === 'replay_overflow') {
      return new DeepResearchReplayOverflow(
        asString(detailObj.message ?? body.detail) || 'Replay buffer overflow',
        {
          requested: asNullableNumber(detailObj.requested) ?? undefined,
          earliest: asNullableNumber(detailObj.earliest) ?? undefined,
          latest: asNullableNumber(detailObj.latest) ?? undefined,
        },
      )
    }
    const detailText =
      typeof body.detail === 'string'
        ? body.detail
        : typeof body.error === 'string'
          ? body.error
          : rawText
    return new Error(`HTTP ${response.status}: ${detailText || response.statusText}`)
  } catch {
    if (response.status === 410) {
      return new DeepResearchReplayOverflow(rawText || 'Replay buffer overflow')
    }
    return new Error(`HTTP ${response.status}: ${rawText || response.statusText}`)
  }
}

export async function fetchDeepResearchStatus(
  options: RequestOptions = {},
): Promise<DeepResearchStatusResponse> {
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(`${resolveBase(options.baseUrl)}/deep-research/status`, {
    method: 'GET',
    signal: options.signal ?? AbortSignal.timeout(15000),
  })
  if (!response.ok) throw await toHttpError(response)
  const raw = asRecord(await response.json())
  const depths = Array.isArray(raw.depths)
    ? raw.depths.map(normalizeDepth).filter((d, i, arr) => arr.indexOf(d) === i)
    : [...RESEARCH_DEPTHS]
  return {
    available: raw.available !== false,
    default_selection: normalizeSelection(raw.default_selection),
    depths: depths.length > 0 ? depths : [...RESEARCH_DEPTHS],
    topology: normalizeFormationTopology(raw.topology),
  }
}

export async function startDeepResearchRun(
  input: StartDeepResearchInput,
  options: RequestOptions = {},
): Promise<DeepResearchSnapshot> {
  const fetcher = options.fetcher ?? fetch
  const payload: Record<string, unknown> = {
    query: input.query.trim(),
    user_id: input.user_id || 'default',
    depth: input.depth ?? DEFAULT_RESEARCH_DEPTH,
  }
  if (input.session_id) payload.session_id = input.session_id
  if (input.context && input.context.trim()) payload.context = input.context.trim()
  if (input.provider) payload.provider = input.provider
  if (input.model_id) payload.model_id = input.model_id
  if (input.reasoning_effort) payload.reasoning_effort = input.reasoning_effort

  const response = await fetcher(`${resolveBase(options.baseUrl)}/deep-research/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal ?? AbortSignal.timeout(30000),
  })
  if (!response.ok) throw await toHttpError(response)
  return normalizeDeepResearchSnapshot(await response.json())
}

export async function listDeepResearchRuns(
  userId = 'default',
  options: RequestOptions & { limit?: number } = {},
): Promise<DeepResearchSnapshot[]> {
  const fetcher = options.fetcher ?? fetch
  const params = new URLSearchParams({
    user_id: userId || 'default',
    limit: String(options.limit ?? 50),
  })
  const response = await fetcher(`${resolveBase(options.baseUrl)}/deep-research/runs?${params}`, {
    method: 'GET',
    signal: options.signal ?? AbortSignal.timeout(15000),
  })
  if (!response.ok) throw await toHttpError(response)
  const body = await response.json()
  const items = Array.isArray(body) ? body : Array.isArray(asRecord(body).runs) ? (asRecord(body).runs as unknown[]) : []
  return items.map((item) => normalizeDeepResearchSnapshot(item))
}

export async function getDeepResearchRun(
  sessionId: string,
  userId = 'default',
  options: RequestOptions = {},
): Promise<DeepResearchSnapshot> {
  const fetcher = options.fetcher ?? fetch
  const params = new URLSearchParams({ user_id: userId || 'default' })
  const response = await fetcher(
    `${resolveBase(options.baseUrl)}/deep-research/runs/${encodeURIComponent(sessionId)}?${params}`,
    {
      method: 'GET',
      signal: options.signal ?? AbortSignal.timeout(15000),
    },
  )
  if (!response.ok) throw await toHttpError(response)
  return normalizeDeepResearchSnapshot(await response.json())
}

export async function cancelDeepResearchRun(
  sessionId: string,
  userId = 'default',
  options: RequestOptions = {},
): Promise<DeepResearchSnapshot> {
  const fetcher = options.fetcher ?? fetch
  const params = new URLSearchParams({ user_id: userId || 'default' })
  const response = await fetcher(
    `${resolveBase(options.baseUrl)}/deep-research/runs/${encodeURIComponent(sessionId)}/cancel?${params}`,
    {
      method: 'POST',
      signal: options.signal ?? AbortSignal.timeout(15000),
    },
  )
  if (!response.ok) throw await toHttpError(response)
  return normalizeDeepResearchSnapshot(await response.json())
}

export async function deleteDeepResearchRun(
  sessionId: string,
  userId = 'default',
  options: RequestOptions = {},
): Promise<{ deleted: boolean; session_id: string }> {
  const fetcher = options.fetcher ?? fetch
  const params = new URLSearchParams({ user_id: userId || 'default' })
  const response = await fetcher(
    `${resolveBase(options.baseUrl)}/deep-research/runs/${encodeURIComponent(sessionId)}?${params}`,
    {
      method: 'DELETE',
      signal: options.signal ?? AbortSignal.timeout(15000),
    },
  )
  if (!response.ok) throw await toHttpError(response)
  const raw = asRecord(await response.json())
  return {
    deleted: raw.deleted !== false,
    session_id: asString(raw.session_id) || sessionId,
  }
}

export async function streamDeepResearchEvents(
  sessionId: string,
  userId = 'default',
  options: StreamDeepResearchOptions,
): Promise<{ finished: boolean; lastSequence: number }> {
  const fetcher = options.fetcher ?? fetch
  const after = Math.max(0, Math.floor(options.after ?? 0))
  const params = new URLSearchParams({
    user_id: userId || 'default',
    after: String(after),
  })
  const response = await fetcher(
    `${resolveBase(options.baseUrl)}/deep-research/runs/${encodeURIComponent(sessionId)}/events?${params}`,
    {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: options.signal,
    },
  )
  if (!response.ok) throw await toHttpError(response)
  if (!response.body) throw new Error('Deep Research SSE response has no body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let finished = false
  let lastSequence = after

  let overflowError: DeepResearchReplayOverflow | null = null

  const parser = new DeepResearchSSEParser((event) => {
    if (finished || overflowError) return
    if (event.type === 'replay_overflow' || event.code === 'replay_overflow') {
      overflowError = new DeepResearchReplayOverflow(
        asString(event.message) || 'Replay buffer overflow',
        {
          requested: asNullableNumber(event.requested) ?? undefined,
          earliest: asNullableNumber(event.earliest) ?? undefined,
          latest: asNullableNumber(event.latest) ?? undefined,
        },
      )
      return
    }
    if (event.sequence > lastSequence) lastSequence = event.sequence
    options.onEvent(event)
    if (event.type === 'run_finished') {
      finished = true
    }
  })

  try {
    while (!finished && !overflowError) {
      const { value, done } = await reader.read()
      if (done) {
        parser.push(decoder.decode(), true)
        break
      }
      parser.push(decoder.decode(value, { stream: true }), false)
    }
    if (overflowError) throw overflowError
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  return { finished, lastSequence }
}
