/**
 * Tool-repair client helpers shared by the Agent Panel (`usePanelChat`) and the native repair
 * surface bridge (`RepairBridge`): the decision requests and the mapping of
 * `GET /tools/repairs/active` entries onto the panel's `RepairInvestigation` shape.
 *
 * Pure (no React, relative imports) so `node --experimental-strip-types` can test it.
 */
import type { RepairDemonstration, RepairInvestigation, RepairKind } from './panel-stream.ts'

export type RepairDecision = 'approve' | 'decline' | 'cancel' | 'rollback'

export interface RepairDecisionRequest {
  url: string
  body: Record<string, unknown>
}

/** The loopback request for one user decision (the server validates owner, revision and token). */
export function repairDecisionRequest(api: string, kind: RepairDecision, userId: string, tool: string, rev?: string, approvalToken?: string): RepairDecisionRequest {
  // Approve = activate the verified revision (the server re-checks owner, base sha, digest and token).
  const url = `${api}/tools/repairs/${encodeURIComponent(tool)}/${kind === 'approve' ? 'activate' : kind}`
  if (kind === 'approve') {
    if (!rev || !approvalToken) throw new Error('Approving a repair requires its revision and approval token')
    return { url, body: { user_id: userId, rev, approval_token: approvalToken } }
  }
  if (kind === 'decline') return { url, body: { user_id: userId, rev } }
  return { url, body: { user_id: userId } }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function demonstrationsFromValue(value: unknown): RepairDemonstration[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const entry = record(item)
    return [{ kind: entry.kind === 'failing' ? 'failing' : 'context', input: entry.input,
      status: entry.status === 'passed' ? 'passed' : 'failed', dry_run: entry.dry_run === true,
      expected: text(entry.expected), actual: text(entry.actual),
      source: entry.source === 'synthetic' ? 'synthetic' : entry.source === 'session' ? 'session' : undefined } as RepairDemonstration]
  }) : []
}

/**
 * One entry of `GET /tools/repairs/active` (`Investigation.summary()`), as the panel state shape.
 * Returns `undefined` for malformed entries.
 */
export function investigationFromActive(entry: unknown): RepairInvestigation | undefined {
  const value = record(entry)
  const tool = text(value.tool_name)
  const rev = text(value.revision)
  if (!tool || !rev) return undefined
  const artifact = record(value.artifact)
  const serverState = text(value.state) ?? 'investigating'
  const state: RepairInvestigation['state'] = serverState === 'investigating' ? 'investigating' : serverState === 'approval' ? 'approval' : 'done'
  const interrupt = record(value.interrupt)
  const kindRaw = text(artifact.target_kind)
  const kind: RepairKind | undefined = kindRaw === 'library' || kindRaw === 'mcp' || kindRaw === 'core' || kindRaw === 'other' ? kindRaw : undefined
  const repairKindRaw = text(artifact.repair_kind)
  return {
    tool, rev, state, kind,
    exceptionClass: text(record(value.evidence).exception_class),
    count: typeof record(value.evidence).count === 'number' ? Number(record(value.evidence).count) : undefined,
    status: text(artifact.status) ?? (state === 'approval' ? 'verified' : serverState),
    summary: text(artifact.summary),
    diff: text(artifact.diff),
    repairKind: repairKindRaw === 'file' || repairKindRaw === 'adapter' || repairKindRaw === 'server' ? repairKindRaw : undefined,
    demonstrations: demonstrationsFromValue(artifact.demonstrations),
    sandbox: text(artifact.sandbox),
    route: text(artifact.route),
    approvalToken: state === 'approval' ? text(artifact.approval_token) : undefined,
    interrupt: typeof interrupt.interruptId === 'string' ? { interruptId: interrupt.interruptId, name: text(interrupt.name), reason: interrupt.reason } : undefined,
    applied: Boolean(artifact.applied) || artifact.status === 'active',
    declined: artifact.declined === true || artifact.status === 'declined',
  }
}

/** The state the native surface shows: the one needing a decision first, else the newest running one. */
export function pickSurfaceInvestigation(entries: RepairInvestigation[]): RepairInvestigation | undefined {
  return entries.find((entry) => entry.state === 'approval') ?? entries.find((entry) => entry.state === 'investigating') ?? entries[0]
}

/** What a native notification says for a state transition; `null` when nothing should be announced. */
export function repairNotification(previous: RepairInvestigation | undefined, next: RepairInvestigation): { title: string; body: string } | null {
  if (previous && previous.rev === next.rev && previous.state === next.state && previous.status === next.status) return null
  if (next.state === 'approval') return { title: `Repair ready: ${next.tool}`, body: 'Ren verified a fix in isolation. Open Ren to review and approve it.' }
  if (next.state === 'done') {
    if (next.applied) return { title: `Repair applied: ${next.tool}`, body: 'The repaired tool is active for your account.' }
    if (next.status === 'blocked') return { title: `Repair blocked: ${next.tool}`, body: 'No isolated environment was available; nothing was changed.' }
    if (next.status === 'failed' || next.status === 'not_reproducible' || next.status === 'needs_maintainer') {
      return { title: `Repair not applied: ${next.tool}`, body: next.summary?.slice(0, 160) || 'Ren could not verify a fix.' }
    }
  }
  return null
}
