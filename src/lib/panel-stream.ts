/** Native panel protocol. Keep transport parsing independent of React. */
export interface PanelEvent {
  version: 1
  sequence: number
  session_id: string
  run_id: string
  type: string
  node_path: unknown[]
  [key: string]: unknown
}

export type RunStatus = 'idle' | 'running' | 'completed' | 'cancelled' | 'checkpointed' | 'interrupted' | 'error'
export interface PanelInterrupt { id: string; reason: unknown }
export interface RuntimeOptions {
  checkpointing: boolean
  tool_execution: 'concurrent' | 'sequential'
  context: 'auto' | 'agentic' | 'sliding'
  goal: string
  background: boolean
}
export interface PanelConfiguration {
  model: string
  provider: string
  effort: string
  options: Partial<RuntimeOptions> & Record<string, unknown>
  /** Who this conversation is with (`selection.agent`): Ron, a saved specialist or a project agent. */
  agent?: { kind: 'ron' | 'specialist' | 'project'; id: string }
}
export interface ToolPart {
  kind: 'tool'
  key: string
  id: string
  name: string
  path: unknown[]
  input: unknown
  progress: string[]
  status?: string
  output?: unknown
  finished: boolean
}
/**
 * A Perplexity Agent API server-side tool event (`native_tool` envelope). Output items
 * (`sandbox_results`, `search_results`, `share_file`, ...) render once each; consecutive
 * `response.reasoning.*` steps of the same kind collapse into one part with all payloads.
 */
export interface NativePart {
  kind: 'native'
  key: string
  path: unknown[]
  /** Output item `type`, or the `response.reasoning.*` event name for reasoning steps. */
  itemType: string
  /** The output item itself (undefined for reasoning steps). */
  item?: Record<string, unknown>
  /** Raw event payloads, in arrival order (one per merged reasoning step). */
  steps: Record<string, unknown>[]
}
export type PanelPart = ToolPart | NativePart | {
  kind: 'text' | 'reasoning' | 'activity' | 'retry'
  key: string
  path: unknown[]
  text: string
  discarded?: boolean
  modelAttempt?: unknown
  cycle?: unknown
}

export function isNativePart(part: PanelPart): part is NativePart {
  return part.kind === 'native'
}

function nativeIdentity(runId: unknown, path: unknown[], itemType: string, item: Record<string, unknown> | undefined, sequence: unknown): string {
  const id = item && (typeof item.call_id === 'string' ? item.call_id : typeof item.id === 'string' ? item.id : undefined)
  return `${String(runId)}-native-${itemType}-${id ?? String(sequence)}${path.length ? `-${JSON.stringify(path)}` : ''}`
}
export interface PanelMessage {
  id: string
  role: 'user' | 'assistant'
  runId?: string
  parts: PanelPart[]
}
/** Where a failing tool lives; every kind is repaired per user (file / adapter / server revision). */
export type RepairKind = 'library' | 'mcp' | 'core' | 'other'
export interface RepairDemonstration {
  kind: 'failing' | 'context'
  input: unknown
  expected?: string
  actual?: string
  status: 'passed' | 'failed'
  dry_run: boolean
  source?: 'session' | 'synthetic'
}
/**
 * One investigation of a failing tool, as the panel sees it. It starts from the server's native
 * tool-failure hook (`tool_repair_investigating`), may wait for the user (`tool_repair_approval`:
 * the verified artifact plus the fixer's parked interrupt and the approval token the panel echoes),
 * and ends with `tool_repair_ready` (applied / declined / failed / blocked / cancelled /
 * needs_maintainer / not_reproducible / verified-but-not-applied).
 */
export interface RepairInvestigation {
  tool: string
  rev: string
  state: 'investigating' | 'approval' | 'done'
  kind?: RepairKind
  exceptionClass?: string
  count?: number
  status?: string
  summary?: string
  diff?: string
  /** file (library module), adapter (wraps any tool, incl. MCP) or server (repaired browser MCP server). */
  repairKind?: 'file' | 'adapter' | 'server'
  demonstrations: RepairDemonstration[]
  sandbox?: string
  route?: string
  /** Present while `approval`: proof the panel must send back with Approve. */
  approvalToken?: string
  interrupt?: { interruptId: string; name?: string; reason?: unknown }
  applied?: boolean
  declined?: boolean
}
/** Kept for stored sessions that recorded the former proposal event. */
export interface RepairProposal {
  id: string
  tool: string
  kind: RepairKind
  exceptionClass?: string
  count?: number
  observation: boolean
}
export interface PanelState {
  sessionId: string
  messages: PanelMessage[]
  sequence: number
  runId?: string
  status: RunStatus
  interrupts: PanelInterrupt[]
  repairProposal?: RepairProposal
  repair?: RepairInvestigation
  checkpoint?: unknown
  /** What failed, as people read it (`failureText`); `errorDetails` keeps the raw payload when it says more. */
  error?: string
  errorDetails?: string
  stopReason?: string
  model?: string
  provider?: string
  configuration?: PanelConfiguration
  configurationLocked?: boolean
  latestSequence?: number
  needsReplay?: boolean
  recoveryRequired?: boolean
  historyIncomplete?: boolean
  followPending?: boolean
}

/** A terminal snapshot can precede the runtime's finally-phase steering admission. */
export function shouldFollowPanel(state: PanelState): boolean {
  return Boolean(state.needsReplay || state.followPending)
}

/** Per-session browser target. Immutable server-side once the first run is reserved. */
export type BrowserSelection = 'user' | 'cloud'

export function resolveBrowserSelection(value: unknown): BrowserSelection | null {
  return value === 'user' || value === 'cloud' ? value : null
}

/**
 * True for the BrowserAvailabilityHook's `browser_unavailable:<n>` interrupt. Detection uses
 * the reason payload (`browser` + `question`), never the id: ids are opaque
 * `v1:before_tool_call:<toolUseId>:<uuid5>` strings.
 */
export function isBrowserUnavailable(reason: unknown): boolean {
  if (!reason || typeof reason !== 'object' || Array.isArray(reason)) return false
  const { browser, question } = reason as { browser?: unknown; question?: unknown }
  return resolveBrowserSelection(browser) !== null && typeof question === 'string' && question.length > 0
}

/** Native HumanInTheLoop interrupt. The reason is the handler's approve prompt. */
export function isHitlApproval(reason: unknown): boolean {
  return typeof reason === 'string' && reason.startsWith('Approve "')
}

/** The question an interrupt asks (`ask_user` raises `{question}`), or null when its reason has none. */
export function interruptQuestion(reason: unknown): string | null {
  const { question } = record(reason)
  return typeof question === 'string' && question.trim() ? question : null
}

/** Title for the Repair chain card (`repair:<rev>`): the fixer's A2A progress. */
export function repairToolTitle(part: { name: string; finished: boolean }): string | null {
  if (part.name !== 'repair') return null
  return part.finished ? 'Repair finished' : 'Repairing…'
}

const NAME_ACRONYMS: Record<string, string> = {
  a2a: 'A2A', api: 'API', cdp: 'CDP', css: 'CSS', html: 'HTML', http: 'HTTP', https: 'HTTPS', id: 'ID', json: 'JSON',
  jsx: 'JSX', mcp: 'MCP', pdf: 'PDF', sop: 'SOP', sql: 'SQL', ui: 'UI', url: 'URL',
}

/** Browser tools arrive prefixed by target and server, e.g. `cloud_browser_playwright_browser_snapshot`. */
const BROWSER_TOOL_NAME = /^(user|cloud)_browser_(?:(?:playwright|electron|cdp)_)?(?:browser_)?(.+)$/

function readableName(name: string): string {
  const text = name.split(/[_\s-]+/).filter(Boolean).map((word) => NAME_ACRONYMS[word.toLowerCase()] ?? word).join(' ')
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : name
}

/** A tool's registered name as people read it: `http_request` is "HTTP request", a browser tool says which browser. */
export function toolDisplayName(name: string): string {
  const browser = BROWSER_TOOL_NAME.exec(name)
  if (browser) return `${browser[1] === 'cloud' ? 'Cloud browser' : 'Browser'} · ${readableName(browser[2])}`
  return readableName(name)
}

/** A native tool result (`ToolResultContent`: text | json | image | document) split for display. */
export interface ToolResultDisplay {
  /** Every text block, in order. */
  text: string
  /** JSON blocks, and any block this view does not know. */
  values: unknown[]
  /** Image blocks as data URLs. */
  images: { src: string; format: string }[]
  /** Document blocks by name; their bytes are not shown. */
  documents: { name: string; format: string }[]
}

/** The SDK's `ImageFormat`. */
const RESULT_IMAGE_FORMATS = new Set(['png', 'jpeg', 'gif', 'webp'])

/** Base64 of serialized bytes: the runtime's `{encoding: 'base64', data}` or a stored session's `{__bytes_encoded__: true, data}`. */
function base64Bytes(value: unknown): string | null {
  const bytes = record(value)
  if (typeof bytes.data !== 'string' || !bytes.data) return null
  return bytes.encoding === 'base64' || bytes.__bytes_encoded__ === true ? bytes.data : null
}

/** A tool part's `output` (the runtime forwards the native result `content` verbatim) as text, values, images and documents. */
export function toolResultDisplay(output: unknown): ToolResultDisplay {
  const display: ToolResultDisplay = { text: '', values: [], images: [], documents: [] }
  if (output === undefined || output === null) return display
  if (typeof output === 'string') return { ...display, text: output }
  if (!Array.isArray(output)) return { ...display, values: [output] }
  const texts: string[] = []
  for (const block of output) {
    if (typeof block === 'string') { texts.push(block); continue }
    const entry = record(block)
    if (typeof entry.text === 'string') { texts.push(entry.text); continue }
    if ('json' in entry) { display.values.push(entry.json); continue }
    const image = record(entry.image)
    const data = base64Bytes(record(image.source).bytes)
    if (data && typeof image.format === 'string' && RESULT_IMAGE_FORMATS.has(image.format)) {
      display.images.push({ src: `data:image/${image.format};base64,${data}`, format: image.format })
      continue
    }
    const document = record(entry.document)
    if (Object.keys(document).length) {
      display.documents.push({ name: typeof document.name === 'string' && document.name ? document.name : 'Document',
        format: typeof document.format === 'string' ? document.format : '' })
      continue
    }
    display.values.push(block)
  }
  display.text = texts.join('\n')
  return display
}

/** A tool result as plain text: its text, then its JSON values, documents and images as lines. */
export function toolResultText(output: unknown): string {
  const display = toolResultDisplay(output)
  const lines = display.text ? [display.text] : []
  for (const value of display.values) lines.push(displayValue(value))
  for (const document of display.documents) lines.push(`Document: ${document.name}${document.format ? ` (${document.format})` : ''}`)
  if (display.images.length) lines.push(display.images.length === 1 ? '1 image' : `${display.images.length} images`)
  return lines.join('\n')
}

export function emptyPanelState(sessionId: string): PanelState {
  return { sessionId, messages: [], sequence: 0, status: 'idle', interrupts: [] }
}

const recoveryMessage = 'Recovery required: execution stopped before a committed result. The last committed history has been restored; work was not automatically repeated. Start a New chat to continue.'

export function nativeRunStatus(value: unknown): RunStatus {
  if (['starting', 'running', 'finishing', 'active'].includes(String(value))) return 'running'
  if (value === 'failed' || value === 'error') return 'error'
  return ['completed', 'cancelled', 'checkpointed', 'interrupted'].includes(String(value)) ? value as RunStatus : 'idle'
}

export function displayValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  return JSON.stringify(value, null, 2)
}

/** A gRPC status error's own sentence inside its repr (`… details = "Your team … spending limit." …`). */
const GRPC_DETAILS = /\bdetails = "((?:[^"\\]|\\.)*)"/

/** A run failure as people read it. The runtime sends the SDK's serialized exception (`{type, message}`, or
 * `{cause, snapshot_error}` when the snapshot failed too); a gRPC provider's message is the whole `AioRpcError` repr,
 * whose `details` field is the provider's own sentence ("…used all available credits…"). */
export function failureText(error: unknown): string {
  if (typeof error === 'string') {
    const details = GRPC_DETAILS.exec(error)
    return (details ? details[1].replace(/\\(.)/g, '$1') : error).trim()
  }
  const fields = record(error)
  for (const value of [fields.message, fields.detail]) {
    if (typeof value === 'string' && value.trim()) return failureText(value)
  }
  if (fields.cause !== undefined) return failureText(fields.cause)
  return displayValue(error)
}

/** The raw failure payload, kept only when it says more than `failureText`. */
function failureDetails(error: unknown, text: string): string | undefined {
  const raw = displayValue(error).trim()
  return raw && raw !== text ? raw : undefined
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function repairProposalFrom(event: PanelEvent): RepairProposal | undefined {
  if (typeof event.id !== 'string' || typeof event.tool !== 'string') return undefined
  const kind = event.kind === 'mcp' || event.kind === 'core' || event.kind === 'other' ? event.kind : 'library'
  return { id: event.id, tool: event.tool, kind, observation: event.observation === true,
    exceptionClass: typeof event.exception_class === 'string' ? event.exception_class : undefined,
    count: typeof event.count === 'number' ? event.count : undefined }
}

function demonstrationsFrom(value: unknown): RepairDemonstration[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const entry = record(item)
    const kind = entry.kind === 'failing' ? 'failing' : 'context'
    return [{ kind, input: entry.input, status: entry.status === 'passed' ? 'passed' : 'failed', dry_run: entry.dry_run === true,
      expected: typeof entry.expected === 'string' ? entry.expected : undefined,
      actual: typeof entry.actual === 'string' ? entry.actual : undefined,
      source: entry.source === 'synthetic' ? 'synthetic' : entry.source === 'session' ? 'session' : undefined } as RepairDemonstration]
  }) : []
}

function repairInvestigationFrom(event: PanelEvent, previous: RepairInvestigation | undefined): RepairInvestigation | undefined {
  if (typeof event.tool !== 'string' || typeof event.rev !== 'string') return undefined
  const base: RepairInvestigation = previous && previous.rev === event.rev ? { ...previous } : { tool: event.tool, rev: event.rev, state: 'investigating', demonstrations: [] }
  if (event.type === 'tool_repair_investigating') {
    const kind = event.kind === 'mcp' || event.kind === 'core' || event.kind === 'other' || event.kind === 'library' ? event.kind : undefined
    return { ...base, state: 'investigating', kind,
      exceptionClass: typeof event.exception_class === 'string' ? event.exception_class : base.exceptionClass,
      count: typeof event.count === 'number' ? event.count : base.count }
  }
  const interrupt = record(event.interrupt)
  const next: RepairInvestigation = { ...base,
    state: event.type === 'tool_repair_approval' ? 'approval' : 'done',
    status: displayValue(event.status) || (event.type === 'tool_repair_approval' ? 'verified' : 'failed'),
    summary: displayValue(event.summary),
    diff: typeof event.diff === 'string' ? event.diff : base.diff,
    repairKind: event.repair_kind === 'adapter' || event.repair_kind === 'server' ? event.repair_kind : event.repair_kind === 'file' ? 'file' : base.repairKind,
    demonstrations: Array.isArray(event.demonstrations) ? demonstrationsFrom(event.demonstrations) : base.demonstrations,
    sandbox: typeof event.sandbox === 'string' ? event.sandbox : base.sandbox,
    route: typeof event.route === 'string' ? event.route : base.route,
    approvalToken: event.type === 'tool_repair_approval' && typeof event.approval_token === 'string' ? event.approval_token : undefined,
    interrupt: event.type === 'tool_repair_approval' && typeof interrupt.interruptId === 'string'
      ? { interruptId: interrupt.interruptId, name: typeof interrupt.name === 'string' ? interrupt.name : undefined, reason: interrupt.reason } : undefined,
    applied: Boolean(event.applied), declined: event.declined === true }
  return next
}

function interruptsFrom(value: unknown): PanelInterrupt[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const entry = record(item)
    return typeof entry.id === 'string' ? [{ id: entry.id, reason: entry.reason }] : []
  }) : []
}

export function toolIdentity(runId: string, path: unknown[], id: string): string {
  return JSON.stringify([runId, path, id])
}

export function isTerminalEvent(event: PanelEvent): boolean {
  return event.node_path.length === 0 && (event.type === 'run_finished' || event.type === 'error')
}

export function parsePanelEvent(data: string): PanelEvent {
  let raw: unknown
  try { raw = JSON.parse(data) } catch { throw new Error('Invalid JSON in agent event stream') }
  const event = record(raw)
  if (event.code === 'replay_overflow' && event.resync_required === true) {
    throw new PanelReplayOverflow(displayValue(event.message) || 'Replay history expired. Reconnect to restore the committed session history.')
  }
  if (event.version !== 1 || !Number.isSafeInteger(event.sequence) || Number(event.sequence) < 0 ||
      typeof event.session_id !== 'string' || typeof event.run_id !== 'string' ||
      typeof event.type !== 'string' || !Array.isArray(event.node_path)) {
    throw new Error('Invalid or unsupported agent event envelope')
  }
  return event as PanelEvent
}

export class PanelReplayOverflow extends Error {}

/** Handles CR, LF, CRLF, split UTF-8, comments, multiline data and an unframed EOF. */
export class PanelSSEParser {
  private buffer = ''
  private data: string[] = []
  private first = true
  private readonly emit: (event: PanelEvent) => void
  constructor(emit: (event: PanelEvent) => void) { this.emit = emit }

  push(chunk: string, final = false): void {
    if (this.first && chunk.length) {
      chunk = chunk.replace(/^\uFEFF/, '')
      this.first = false
    }
    this.buffer += chunk
    let start = 0
    for (let index = 0; index < this.buffer.length; index++) {
      const char = this.buffer[index]
      if (char !== '\r' && char !== '\n') continue
      if (char === '\r' && index === this.buffer.length - 1 && !final) break
      this.line(this.buffer.slice(start, index))
      if (char === '\r' && this.buffer[index + 1] === '\n') index++
      start = index + 1
    }
    this.buffer = this.buffer.slice(start)
    if (final) {
      if (this.buffer) this.line(this.buffer)
      this.buffer = ''
      this.dispatch()
    }
  }

  private line(line: string): void {
    if (!line) { this.dispatch(); return }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') this.data.push(value)
  }

  private dispatch(): void {
    if (!this.data.length) return
    const data = this.data.join('\n')
    this.data = []
    if (data.trim()) this.emit(parsePanelEvent(data))
  }
}

export async function responseError(response: Response): Promise<Error> {
  const body = await response.text()
  let detail = body
  try {
    const parsed = JSON.parse(body)
    if (parsed.detail?.code === 'replay_overflow') return new PanelReplayOverflow(displayValue(parsed.detail.message))
    detail = displayValue(parsed.detail ?? parsed.error ?? parsed)
  } catch { /* Plain-text HTTP error. */ }
  return new Error(`HTTP ${response.status}: ${detail || response.statusText}`)
}

export async function readPanelStream(response: Response, onEvent: (event: PanelEvent) => void | boolean): Promise<boolean> {
  if (!response.ok) throw await responseError(response)
  if (!response.body) throw new Error('Agent response has no event stream')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let terminal = false
  const parser = new PanelSSEParser((event) => {
    if (terminal) return // Do not consume the next run from the same network chunk.
    const accepted = onEvent(event)
    if (accepted !== false && isTerminalEvent(event)) terminal = true
  })
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) { parser.push(decoder.decode(), true); break }
      parser.push(decoder.decode(value, { stream: true }))
      if (terminal) { await reader.cancel(); break }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  return terminal
}

/** Sequence numbers are session-wide; tool IDs are scoped to run AND node path. */
export function reducePanelEvent(state: PanelState, event: PanelEvent): PanelState {
  if (event.session_id !== state.sessionId || event.sequence <= state.sequence) return state
  let next: PanelState = { ...state, sequence: event.sequence, latestSequence: Math.max(state.latestSequence ?? 0, event.sequence) }
  const root = event.node_path.length === 0
  if (root && event.type === 'run_started') {
    next = { ...next, runId: event.run_id, status: 'running', error: undefined, errorDetails: undefined,
      stopReason: undefined, interrupts: [], checkpoint: undefined,
      configurationLocked: true, followPending: false,
      model: typeof event.model_id === 'string' ? event.model_id : state.model,
      provider: typeof event.provider === 'string' ? event.provider : state.provider }
    if (next.configuration) next.configuration = { ...next.configuration,
      model: next.model ?? next.configuration.model, provider: next.provider ?? next.configuration.provider }
    // The initial POST may fail after reservation but before any bytes arrive.
    // A subsequent replay must still bind the optimistic input to the real run.
    const last = next.messages[next.messages.length - 1]
    if (last?.role === 'user' && !last.runId && last.id.startsWith('user-')) {
      next.messages = [...next.messages.slice(0, -1), { ...last, runId: event.run_id }]
    }
  }
  if (root && event.type === 'interrupt') next.interrupts = interruptsFrom(event.interrupts)
  if (root && event.type === 'tool_repair_proposed') next.repairProposal = repairProposalFrom(event) ?? state.repairProposal
  if (root && (event.type === 'tool_repair_investigating' || event.type === 'tool_repair_approval' || event.type === 'tool_repair_ready')) {
    const repair = repairInvestigationFrom(event, state.repair)
    if (repair) {
      next.repair = repair
      if (next.repairProposal?.tool === repair.tool) next.repairProposal = undefined
    }
  }
  if (root && event.type === 'checkpoint') next.checkpoint = event.checkpoint
  if (root && event.type === 'error') {
    next.status = 'error'
    next.error = failureText(event.error) || 'Agent run failed'
    next.errorDetails = failureDetails(event.error, next.error)
    if (record(event.error).code === 'recovery_required' || event.recovery_required === true) {
      next.recoveryRequired = true
      next.error = `${next.error}\n\n${recoveryMessage}`
    }
  }
  if (root && event.type === 'run_finished') {
    const status = nativeRunStatus(event.status)
    next.status = next.error || status === 'idle' || status === 'running' ? 'error' : status
    next.stopReason = displayValue(event.stop_reason)
    if (next.status === 'error') next.error = next.error || `Agent run failed${next.stopReason ? `: ${next.stopReason}` : ''}`
    const result = record(event.result)
    if (event.interrupts || event.pending_interrupts || result.interrupts) next.interrupts = interruptsFrom(event.interrupts ?? event.pending_interrupts ?? result.interrupts)
    if (event.checkpoint !== undefined || result.checkpoint !== undefined) next.checkpoint = event.checkpoint ?? result.checkpoint
    next.needsReplay = false
  }

  const renderTypes = ['text_delta', 'reasoning_delta', 'tool_input', 'tool_progress', 'tool_result', 'native_tool',
    'retry', 'node_event', 'background_event', 'steering_accepted', 'steering_applied', 'tool_repair_proposed', 'tool_repair_investigating', 'tool_repair_approval', 'tool_repair_ready']
  if (!root && event.type === 'interrupt') renderTypes.push('interrupt')
  if (!renderTypes.includes(event.type) && !(event.type === 'error' && !root)) return next
  const messages = [...next.messages]
  let index = messages.findIndex((message) => message.role === 'assistant' && message.runId === event.run_id)
  if (index < 0) {
    index = messages.length
    messages.push({ id: `run-${event.run_id}`, runId: event.run_id, role: 'assistant', parts: [] })
  }
  const parts = [...messages[index].parts]
  const pathKey = JSON.stringify(event.node_path)
  const key = `${event.run_id}-${event.sequence}`
  if (event.type.startsWith('tool_') && !event.type.startsWith('tool_repair_')) {
    if (typeof event.id !== 'string') throw new Error(`${event.type} is missing its tool ID`)
    const identity = toolIdentity(event.run_id, event.node_path, event.id)
    const position = parts.findIndex((part) => part.kind === 'tool' && part.key === identity)
    const existing = position >= 0 ? parts[position] as ToolPart : undefined
    const tool: ToolPart = { kind: 'tool', key: identity, id: event.id,
      name: typeof event.name === 'string' ? event.name : existing?.name || event.id,
      path: event.node_path, input: existing?.input ?? {}, progress: [], finished: false, ...existing }
    if (typeof event.name === 'string') tool.name = event.name
    if (event.type === 'tool_input') tool.input = event.input ?? tool.input
    if (event.type === 'tool_progress' && !tool.finished) tool.progress = [...tool.progress, displayValue(event.data)]
    // Identical results are harmless; transformed/corrected results remain authoritative.
    if (event.type === 'tool_result') {
      tool.output = event.content
      tool.status = typeof event.status === 'string' ? event.status : 'success'
      tool.finished = true
    }
    if (position >= 0) parts[position] = tool
    else parts.push(tool)
  } else if (event.type === 'native_tool') {
    const payload = (event.payload && typeof event.payload === 'object' ? event.payload : {}) as Record<string, unknown>
    const item = payload.item && typeof payload.item === 'object' ? payload.item as Record<string, unknown> : undefined
    const itemType = typeof event.item_type === 'string' ? event.item_type : typeof event.event === 'string' ? event.event : 'native'
    const last = parts[parts.length - 1]
    if (!item && last?.kind === 'native' && !last.item && last.itemType === itemType && JSON.stringify(last.path) === pathKey) {
      // Consecutive reasoning steps of one kind (e.g. several search_web queries) share a card.
      parts[parts.length - 1] = { ...last, steps: [...last.steps, payload] }
    } else {
      const identity = nativeIdentity(event.run_id, event.node_path, itemType, item, event.sequence)
      const position = parts.findIndex((part) => part.kind === 'native' && part.key === identity)
      const existing = position >= 0 ? (parts[position] as NativePart) : undefined
      const native: NativePart = {
        kind: 'native',
        key: identity,
        path: event.node_path,
        itemType,
        item: item ?? existing?.item,
        steps: existing ? [...existing.steps, payload] : [payload],
      }
      if (position >= 0) parts[position] = native
      else parts.push(native)
    }
  } else if (event.type === 'text_delta' || event.type === 'reasoning_delta') {
    if (typeof event.data !== 'string') throw new Error(`${event.type} is missing text data`)
    const kind = event.type === 'text_delta' ? 'text' : 'reasoning'
    const last = parts[parts.length - 1]
    if (last?.kind === kind && !last.discarded && JSON.stringify(last.path) === pathKey &&
        last.modelAttempt === event.model_attempt && last.cycle === event.cycle) {
      parts[parts.length - 1] = { ...last, text: last.text + event.data }
    } else parts.push({ kind, key, path: event.node_path, text: event.data, modelAttempt: event.model_attempt, cycle: event.cycle })
  } else {
    let text = displayValue(event.event ?? event.message ?? event.error)
    if (event.type === 'retry') {
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        // A tool retry never invalidates model output. Without attempt metadata,
        // retain drafts rather than discarding successful earlier model cycles.
        if (event.model_attempt !== undefined && !event.id &&
            (part.kind === 'text' || part.kind === 'reasoning') && JSON.stringify(part.path) === pathKey &&
            part.modelAttempt === event.model_attempt && part.cycle === event.cycle) {
          parts[i] = { ...part, discarded: true }
        }
      }
      // An in-run recovery (agent respawn, overflow hook retry) drops the attempt without a visible line.
      if (event.silent === true) {
        messages[index] = { ...messages[index], parts }
        return { ...next, messages }
      }
      text = `Retry${event.attempt === undefined ? '' : ` ${displayValue(event.attempt)}`}: ${displayValue(event.reason) || 'Trying again'}`
      if (event.delay !== undefined) text += ` · delay ${displayValue(event.delay)}s`
    } else if (event.type === 'interrupt') text = `Input requested · ${displayValue(event.interrupts)}`
    else if (event.type === 'background_event') text = `Background · ${text}`
    else if (event.type === 'node_event') text = `Node · ${text}`
    else if (event.type === 'steering_accepted') text = `Steering accepted · ${text}`
    else if (event.type === 'steering_applied') text = `Steering applied · ${text}`
    else if (event.type === 'tool_repair_proposed') text = `Repair proposed · ${displayValue(event.tool)} keeps failing (${displayValue(event.count)}× ${displayValue(event.exception_class) || 'error'})`
    else if (event.type === 'tool_repair_investigating') text = `Investigating · ${displayValue(event.tool)} failed (${displayValue(event.count)}× ${displayValue(event.exception_class) || 'error'}); Ren's fixer is reproducing it in isolation`
    else if (event.type === 'tool_repair_approval') text = `Repair ready for your approval · ${displayValue(event.tool)} revision ${displayValue(event.rev)}`
    else if (event.type === 'tool_repair_ready') text = `Repair ${displayValue(event.status)} · ${displayValue(event.tool)} revision ${displayValue(event.rev)}`
    parts.push({ kind: event.type === 'retry' ? 'retry' : 'activity', key, path: event.node_path, text })
  }
  messages[index] = { ...messages[index], parts }
  return { ...next, messages }
}

/** Convert SDK content blocks without flattening tool/text ordering. */
export function hydratePanelSession(sessionId: string, value: unknown): PanelState {
  const snapshot = record(value)
  const state = emptyPanelState(sessionId)
  state.runId = typeof snapshot.run_id === 'string' ? snapshot.run_id : undefined
  state.latestSequence = Number.isSafeInteger(snapshot.sequence) ? Number(snapshot.sequence) : 0
  state.sequence = Number.isSafeInteger(snapshot.replay_after) ? Number(snapshot.replay_after) : state.latestSequence
  state.status = nativeRunStatus(snapshot.status)
  state.historyIncomplete = snapshot.history_incomplete === true || snapshot.replay_status === 'gap'
  state.followPending = snapshot.active === true && state.status !== 'running' && !snapshot.recovery_required
  state.needsReplay = Boolean(state.runId) && (state.status === 'running' || state.sequence < state.latestSequence)
  state.configurationLocked = snapshot.configuration_locked !== false
  const selection = record(snapshot.selection)
  state.model = typeof selection.model_id === 'string' ? selection.model_id : undefined
  state.provider = typeof selection.provider === 'string' ? selection.provider : undefined
  const agent = record(selection.agent)
  if (state.model && state.provider) state.configuration = { model: state.model, provider: state.provider,
    effort: typeof selection.reasoning_effort === 'string' ? selection.reasoning_effort : '', options: record(snapshot.options),
    agent: (agent.kind === 'specialist' || agent.kind === 'project') && typeof agent.id === 'string' && agent.id
      ? { kind: agent.kind, id: agent.id } : { kind: 'ron', id: '' } }
  state.interrupts = interruptsFrom(snapshot.interrupts ?? snapshot.pending_interrupts)
  state.checkpoint = snapshot.checkpoint
  state.stopReason = typeof record(snapshot.result).stop_reason === 'string' ? String(record(snapshot.result).stop_reason) : undefined
  const failure = snapshot.error == null ? '' : failureText(snapshot.error)
  if (state.status === 'error') {
    state.error = failure || 'Previous agent run failed'
    if (snapshot.error != null) state.errorDetails = failureDetails(snapshot.error, failure)
  }
  state.recoveryRequired = snapshot.recovery_required === true
  if (state.recoveryRequired) { state.status = 'error'; state.error = failure ? `${failure}\n\n${recoveryMessage}` : recoveryMessage }
  const sdkMessages = Array.isArray(snapshot.messages) ? snapshot.messages : []
  let assistant: PanelMessage | undefined
  sdkMessages.forEach((raw, messageIndex) => {
    const message = record(raw)
    const blocks = Array.isArray(message.content) ? message.content : []
    // Legacy sessions (before ephemeral request-context injection) persisted the
    // browser-context block as user text; never render it.
    const userBlocks = blocks.filter((block) => !record(block).toolResult && !record(block).interruptResponse && !isRequestContextBlock(block))
    if (message.role === 'user' && userBlocks.length) {
      state.messages.push({ id: `history-user-${messageIndex}`, role: 'user', parts: userBlocks.map((block, i) => ({
        kind: 'text', key: `history-${messageIndex}-${i}`, path: [],
        text: typeof record(block).text === 'string' ? String(record(block).text) : displayValue(block),
      })) })
      assistant = undefined
    }
    blocks.forEach((rawBlock, blockIndex) => {
      const block = record(rawBlock)
      if (block.toolResult) {
        const result = record(block.toolResult)
        for (const part of assistant?.parts ?? []) {
          if (part.kind === 'tool' && part.id === result.toolUseId && !part.finished) {
            part.finished = true; part.output = result.content; part.status = String(result.status || 'success')
          }
        }
        return
      }
      if (message.role !== 'assistant') return
      if (!assistant) {
        assistant = { id: `history-assistant-${messageIndex}`, role: 'assistant', parts: [] }
        state.messages.push(assistant)
      }
      const key = `history-${messageIndex}-${blockIndex}`
      if (typeof block.text === 'string') assistant.parts.push({ kind: 'text', key, path: [], text: block.text })
      else if (block.toolUse) {
        const tool = record(block.toolUse)
        assistant.parts.push({ kind: 'tool', key, id: String(tool.toolUseId), name: String(tool.name),
          path: [], input: tool.input ?? {}, progress: [], finished: false })
      } else if (block.reasoningContent) {
        const reasoning = record(record(block.reasoningContent).reasoningText)
        if (typeof reasoning.text === 'string') assistant.parts.push({ kind: 'reasoning', key, path: [], text: reasoning.text })
      } else assistant.parts.push({ kind: 'activity', key, path: [], text: displayValue(block) })
    })
  })
  if (assistant && state.runId && !state.needsReplay && !state.recoveryRequired) {
    assistant.runId = state.runId
    for (const part of assistant.parts) if (part.kind === 'tool') part.key = toolIdentity(state.runId, part.path, part.id)
  }
  if (state.runId && !state.needsReplay && !state.recoveryRequired) {
    const user = [...state.messages].reverse().find((message) => message.role === 'user')
    if (user) user.runId = state.runId
  }
  // Active snapshots contain PRE-RUN history. Never relabel the prior answer as
  // this run, and only append native message input (not checkpoint/interrupt input).
  if (state.needsReplay && !state.historyIncomplete && state.runId && snapshot.input != null) {
    const input = snapshot.input
    const blocks = typeof input === 'string' ? [{ text: input }] : Array.isArray(input)
      ? input.filter((block) => !record(block).interruptResponse) : []
    if (blocks.length) state.messages.push({ id: `input-${state.runId}`, role: 'user', runId: state.runId,
      parts: blocks.map((block, i) => ({ kind: 'text', key: `input-${state.runId}-${i}`, path: [],
        text: typeof record(block).text === 'string' ? String(record(block).text) : displayValue(block) })) })
  }
  return state
}

/** Canonical history owns root content; replay owns progress, nested nodes and retries. */
export function reconcilePanelSession(previous: PanelState, canonical: PanelState): PanelState {
  if (previous.sessionId !== canonical.sessionId) return canonical
  const used = new Set<PanelMessage>()
  const signature = (message: PanelMessage) => JSON.stringify([message.role,
    message.parts.filter((part) => part.path.length === 0 && part.kind === 'text' && !part.discarded)
      .map((part) => part.kind !== 'tool' && part.kind !== 'native' ? part.text : '').join(''),
    message.parts.filter((part) => part.kind === 'tool' && part.path.length === 0).map((part) => part.kind === 'tool' ? part.id : '')])
  const messages = canonical.messages.map((message) => {
    // PRE-RUN hydration must rebuild the current run from its cursor, never
    // merge its already-streamed assistant or duplicate pending input.
    const candidates = previous.messages.filter((old) => !used.has(old) &&
      !(canonical.needsReplay && old.role === 'assistant' && old.runId === canonical.runId))
    let exact = candidates.find((old) => signature(old) === signature(message))
    let old = exact ?? candidates.find((old) => old.role === message.role &&
      message.runId !== undefined && old.runId === message.runId)
    // Checkpoint/interrupt resumes have no new user message: SDK history groups
    // multiple run responses into one assistant turn. Recombine that same turn.
    if (message.role === 'assistant' && !exact) {
      const start = old ? previous.messages.indexOf(old) : -1
      let first = start
      while (first > 0 && previous.messages[first - 1].role === 'assistant' && !used.has(previous.messages[first - 1])) first--
      const group = first >= 0 ? previous.messages.slice(first, start + 1).filter((item) => candidates.includes(item)) : []
      if (group.length > 1) {
        group.forEach((item) => used.add(item))
        old = { ...group[0], runId: message.runId, parts: group.flatMap((item) => item.parts) }
        if (signature(old) === signature(message)) exact = old
      }
    }
    // Retained replay can finish a resumed run with no new root output. The
    // canonical assistant may match the pre-resume turn exactly; attach any
    // remaining run-scoped nested/progress events instead of dropping them.
    if (message.role === 'assistant' && message.runId && !canonical.needsReplay) {
      const continuation = candidates.filter((item) => item !== old && !used.has(item) &&
        item.role === 'assistant' && item.runId === message.runId)
      if (old && continuation.length) {
        used.add(old)
        continuation.forEach((item) => used.add(item))
        old = { ...old, runId: message.runId, parts: [...old.parts, ...continuation.flatMap((item) => item.parts)] }
        exact = signature(old) === signature(message) ? old : undefined
      }
    }
    if (!old) return message
    used.add(old)
    if (message.role === 'user') return { ...message, id: old.id, runId: old.runId }
    const tools = message.parts.filter((part): part is ToolPart => part.kind === 'tool')
    const enrichTool = (part: PanelPart): PanelPart => {
      if (part.kind !== 'tool' || part.path.length) return part
      const live = old.parts.find((item): item is ToolPart => item.kind === 'tool' && !item.path.length && item.id === part.id)
      const saved = tools.find((item) => item.id === part.id)
      return { ...part, ...saved, key: live?.key ?? part.key, progress: live?.progress ?? part.progress }
    }
    // Exact root text/tool matches can keep the original interleaving in full.
    const parts = exact ? old.parts.map(enrichTool) : [
      ...message.parts.map(enrichTool),
      // Server-side tool cards (native) are live-only: the canonical snapshot never
      // carries them, so every one the stream produced is kept.
      ...old.parts.filter((part) => part.path.length || part.kind === 'native' || (part.kind !== 'tool' &&
        (part.discarded || part.kind === 'activity' || part.kind === 'retry' || part.kind === 'reasoning') &&
        !message.parts.some((saved) => saved.kind !== 'tool' && saved.kind !== 'native' && saved.kind === part.kind && saved.text === part.text))),
    ]
    // Native structured output/reasoning may not have appeared in delta events.
    for (const part of message.parts) {
      if (part.kind === 'tool' || part.kind === 'text' || part.kind === 'native') continue
      if (!parts.some((item) => item.kind !== 'tool' && item.kind !== 'native' && item.kind === part.kind && item.text === part.text)) parts.push(part)
    }
    return { ...message, id: old.id, runId: message.runId ?? old.runId, parts }
  })
  // Failure/recovery snapshots deliberately roll back incomplete work. Keep that
  // visible evidence, but never treat it as committed SDK history.
  if (canonical.recoveryRequired && !canonical.needsReplay) {
    messages.push(...previous.messages.filter((message) => !used.has(message) && message.runId === previous.runId))
  }
  const ids = new Set<string>()
  return { ...canonical, historyIncomplete: canonical.historyIncomplete || previous.historyIncomplete, messages: messages.map((message, index) => {
    let id = message.id
    while (ids.has(id)) id = `${id}-${canonical.sequence}-${index}`
    ids.add(id)
    return id === message.id ? message : { ...message, id }
  }) }
}


/** Reference data the backend once injected as a leading user text block. */
export function isRequestContextBlock(block: unknown): boolean {
  const text = record(block).text
  return typeof text === 'string' && /^Browser context (reference )?for this request/.test(text)
}

export type RenderItem =
  | { kind: 'part'; part: PanelPart }
  | { kind: 'think'; tool: ToolPart; steps: ThinkStep[] }
export type ThinkStep =
  | { kind: 'text'; key: string; text: string; active: boolean }
  | { kind: 'reasoning'; key: string; text: string; active: boolean }
  | { kind: 'tool'; key: string; tool: ToolPart; active: boolean }

/**
 * Root tools whose child agent events render as a chain of thought: the Perplexity
 * `think` child and the per-user tool fixer (`repair`, a synthetic root tool
 * `repair:<rev>` fed by the repair service), whose events arrive under
 * node_path=[<its toolUseId>].
 */
export const CHAIN_TOOLS: ReadonlySet<string> = new Set(['think', 'repair'])

export function isChainTool(part: PanelPart): part is ToolPart {
  return part.kind === 'tool' && part.path.length === 0 && CHAIN_TOOLS.has(part.name)
}

/**
 * Group a message's flat parts for rendering. Nested events emitted by a chain
 * tool's child agent (node_path[0] === that tool's id) become chain-of-thought
 * steps inside the chain block and are removed from the flat list. Nested parts
 * under any other tool, and root reasoning, are left untouched.
 */
export function groupThinkParts(parts: PanelPart[], running: boolean): RenderItem[] {
  const thinkIds = new Set(parts.filter(isChainTool).map((p) => p.id))
  const items: RenderItem[] = []
  for (const part of parts) {
    const parentId = part.path.length ? String(part.path[0]) : undefined
    if (parentId !== undefined && thinkIds.has(parentId)) continue // consumed by its chain block
    if (isChainTool(part)) {
      const nested = parts.filter((p) => p.path.length >= 1 && String(p.path[0]) === part.id)
      const steps: ThinkStep[] = []
      for (const child of nested) {
        if (child.kind === 'tool') {
          steps.push({ kind: 'tool', key: child.key, tool: child, active: !child.finished && running && !part.finished })
        } else if (child.kind === 'text' || child.kind === 'reasoning') {
          const last = steps[steps.length - 1]
          if (last && last.kind === child.kind && child.kind !== 'reasoning' && !child.discarded) {
            last.text += child.text
          } else if (!child.discarded) {
            steps.push({ kind: child.kind, key: child.key, text: child.text, active: false })
          }
        }
      }
      if (!part.finished && running && steps.length) steps[steps.length - 1].active = true
      items.push({ kind: 'think', tool: part, steps })
      continue
    }
    items.push({ kind: 'part', part })
  }
  return items
}
/**
 * `render_ui` views. The tool result's first content block is `{json: {ui: {...}}}`; the panel
 * runtime forwards `content` verbatim and the SDK stores it in the thread, so a view renders live
 * and again from history. A later render with the same `view_id` replaces the earlier one.
 */
export interface UiView { viewId: string; format: 'html' | 'jsx'; title: string; source: string; height: number }

export const RENDER_UI_TOOL = 'render_ui'

export function uiViewFromOutput(output: unknown): UiView | null {
  if (!Array.isArray(output)) return null
  for (const block of output) {
    const json = record(record(block).json)
    const ui = record(json.ui)
    if (typeof ui.source !== 'string' || (ui.format !== 'html' && ui.format !== 'jsx')) continue
    const height = typeof ui.height === 'number' && Number.isFinite(ui.height) ? Math.max(240, Math.min(ui.height, 2000)) : 520
    return { viewId: String(ui.view_id || ''), format: ui.format, title: typeof ui.title === 'string' ? ui.title : '', source: ui.source, height }
  }
  return null
}

/** The latest finished render per view_id across a conversation; earlier renders of the same id are superseded. */
export function supersededUiParts(messages: { parts: PanelPart[] }[]): Set<string> {
  const latest = new Map<string, string>()
  const keys: { key: string; viewId: string }[] = []
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.kind !== 'tool' || part.name !== RENDER_UI_TOOL || !part.finished) continue
      const view = uiViewFromOutput(part.output)
      if (!view?.viewId) continue
      latest.set(view.viewId, part.key); keys.push({ key: part.key, viewId: view.viewId })
    }
  }
  return new Set(keys.filter((entry) => latest.get(entry.viewId) !== entry.key).map((entry) => entry.key))
}

/** Text of the user turn that reports one `ron:ui_action` message; mirrors `render_ui_tool.ui_action_text`. */
export function uiActionText(viewId: string, action: unknown, payload: unknown): string {
  const label = typeof action === 'string' && /^[a-z][a-z0-9_:-]{0,63}$/.test(action) ? action : 'action'
  let body = 'null'
  if (payload !== undefined && payload !== null) { try { body = JSON.stringify(payload) } catch { body = String(payload) } }
  return `[ui_action ${viewId}] action=${label} payload=${body.slice(0, 4000)}`
}
