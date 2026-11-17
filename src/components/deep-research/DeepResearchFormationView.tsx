/**
 * DeepResearchFormationView — draws the Strands `Graph` of `Swarm`s and `Graph`s
 * (`research_swarm` → `data_analysis_graph` → `writing_swarm` → `production_graph`), the swarms'
 * `handoff_to_agent` messages, and every built-in `subagent` run with its tool calls.
 *
 * Container-responsive and Ren palette-compliant using Inter (`font-sans`).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowDown,
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  GitFork,
  Loader2,
  Repeat,
  Square,
  Wrench,
  XCircle,
} from 'lucide-react'
import {
  humanizeIdentifier,
  nodePathKey,
  type DeepResearchHandoff,
  type DeepResearchNodeStatus,
  type DeepResearchRunStatus,
  type DeepResearchSkillExecution,
  type DeepResearchSnapshot,
  type FormationNodeKind,
  type FormationTopology,
  type FormationTopologyNode,
} from '@/lib/deep-research-api'
import { deriveNodeState } from '@/lib/deep-research-graph'
import { cn } from '@/utils/cn'

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  const totalSec = Math.max(1, Math.round(ms / 1000))
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`
}

export function StatusIcon({ status, className }: { status: DeepResearchNodeStatus; className?: string }) {
  if (status === 'executing') {
    return <Loader2 className={cn('h-3.5 w-3.5 animate-spin text-volt', className)} aria-hidden />
  }
  if (status === 'completed') {
    return <CheckCircle2 className={cn('h-3.5 w-3.5 text-emerald-500', className)} aria-hidden />
  }
  if (status === 'failed') {
    return <AlertCircle className={cn('h-3.5 w-3.5 text-rose-500', className)} aria-hidden />
  }
  if (status === 'cancelled') {
    return <XCircle className={cn('h-3.5 w-3.5 text-ink-muted dark:text-ink-inverse-muted', className)} aria-hidden />
  }
  if (status === 'interrupted') {
    return <AlertCircle className={cn('h-3.5 w-3.5 text-sky-500', className)} aria-hidden />
  }
  return <Circle className={cn('h-3 w-3 text-surface-300 dark:text-surface-600', className)} aria-hidden />
}

function runStatusPill(status: DeepResearchRunStatus, active: boolean) {
  if (active || status === 'running') {
    return {
      label: 'Running',
      classes: 'border-blurple-500/40 bg-blurple-600/10 text-volt dark:border-blurple-400/40 dark:bg-blurple-400/15',
      dot: 'bg-volt animate-pulse',
    }
  }
  if (status === 'completed') {
    return {
      label: 'Completed',
      classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      dot: 'bg-emerald-500',
    }
  }
  if (status === 'failed') {
    return {
      label: 'Failed',
      classes: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
      dot: 'bg-rose-500',
    }
  }
  return {
    label: 'Cancelled',
    classes: 'border-surface-300 bg-surface-100 text-ink-secondary dark:border-surface-700 dark:bg-surface-800 dark:text-ink-inverse-secondary',
    dot: 'bg-surface-400',
  }
}

export function KindBadge({ kind }: { kind: FormationNodeKind }) {
  const label = kind === 'swarm' ? 'Swarm' : kind === 'graph' ? 'Graph' : 'Agent'
  const styles =
    kind === 'swarm'
      ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
      : kind === 'graph'
        ? 'border-blurple-500/30 bg-blurple-600/10 text-blurple-700 dark:border-blurple-400/30 dark:bg-blurple-400/15 dark:text-blurple-300'
        : 'border-surface-200 bg-surface-100 text-ink-secondary dark:border-surface-700 dark:bg-surface-800 dark:text-ink-inverse-secondary'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-px font-sans text-[10.5px] font-medium',
        styles,
      )}
    >
      {label}
    </span>
  )
}

function SkillInvocationCard({ invocation }: { invocation: DeepResearchSkillExecution }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = Boolean(invocation.summary || invocation.output_text || invocation.tools.length > 0)

  return (
    <div className="rounded-lg border border-surface-200/90 bg-surface-50/80 px-2.5 py-2 font-sans dark:border-surface-800 dark:bg-surface-900/70">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          disabled={!hasDetail}
          onClick={() => setExpanded((prev) => !prev)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-default"
        >
          {invocation.status === 'running' ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-volt" aria-hidden />
          ) : invocation.status === 'failed' ? (
            <AlertCircle className="h-3 w-3 shrink-0 text-rose-500" aria-hidden />
          ) : (
            <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden />
          )}
          <span className="rounded-md bg-blurple-600/10 px-1.5 py-px font-sans text-[11px] font-medium text-volt dark:bg-blurple-400/15">
            Skill
          </span>
          <span className="truncate font-sans text-[12px] font-semibold text-ink dark:text-ink-inverse">
            {invocation.skill_name}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          {hasDetail && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse skill details' : 'Expand skill details'}
              className="rounded p-0.5 text-ink-muted hover:bg-surface-200/60 hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-surface-800 dark:hover:text-ink-inverse"
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>

      {invocation.task && (
        <p className="mt-1 line-clamp-2 pl-4 font-sans text-[11.5px] leading-snug text-ink-secondary dark:text-ink-inverse-secondary">
          {invocation.task}
        </p>
      )}

      {invocation.tools.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-4">
          {invocation.tools.map((tool) => (
            <span
              key={tool.id}
              title={tool.input_preview || tool.output_preview || tool.tool_name}
              className={cn(
                'inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 font-sans text-[11px]',
                tool.status === 'running'
                  ? 'border-blurple-500/40 bg-blurple-600/10 text-volt dark:border-blurple-400/40 dark:bg-blurple-400/15'
                  : tool.status === 'failed'
                    ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                    : 'border-surface-200 bg-surface-0 text-ink-secondary dark:border-surface-700 dark:bg-surface-850 dark:text-ink-inverse-secondary',
              )}
            >
              <Wrench className="h-2.5 w-2.5 shrink-0 opacity-75" aria-hidden />
              <span className="shrink-0 font-medium">{tool.tool_name}</span>
              {tool.input_preview && (
                <span className="max-w-[150px] truncate text-ink-muted dark:text-ink-inverse-muted">
                  · {tool.input_preview}
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {expanded && (invocation.summary || invocation.output_text) && (
        <div className="mt-2 border-t border-surface-200/70 pt-1.5 pl-4 font-sans text-[11.5px] leading-relaxed text-ink-secondary dark:border-surface-800 dark:text-ink-inverse-secondary">
          {invocation.summary || invocation.output_text.slice(0, 500)}
        </div>
      )}
    </div>
  )
}

function AgentLeafCard({
  node,
  path,
  snapshot,
}: {
  node: FormationTopologyNode
  path: string[]
  snapshot: DeepResearchSnapshot
}) {
  const { status, nodeSnap } = deriveNodeState(snapshot, path)
  const key = nodePathKey(path)
  const directInvocations = snapshot.skill_invocations.filter((s) => s.node_key === key)

  return (
    <div
      className={cn(
        'rounded-xl border p-3 font-sans transition-colors duration-150',
        status === 'executing'
          ? 'border-blurple-500/60 bg-blurple-600/[0.04] dark:border-blurple-400/60 dark:bg-blurple-400/[0.07]'
          : status === 'completed'
            ? 'border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-850/90'
            : status === 'failed'
              ? 'border-rose-500/40 bg-rose-500/[0.04] dark:bg-rose-500/[0.07]'
              : 'border-surface-200/70 bg-surface-0/60 dark:border-surface-800/80 dark:bg-surface-900/50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusIcon status={status} />
          <span className="truncate font-sans text-[12.5px] font-semibold text-ink dark:text-ink-inverse">
            {node.label}
          </span>
          <KindBadge kind="agent" />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 font-sans text-[11px] text-ink-muted dark:text-ink-inverse-muted">
          {nodeSnap && nodeSnap.execution_count > 1 && (
            <span className="rounded bg-sky-500/10 px-1.5 py-px font-medium text-sky-700 dark:text-sky-300">
              ×{nodeSnap.execution_count}
            </span>
          )}
          {nodeSnap?.execution_time_ms ? (
            <span className="tabular-nums">{formatDurationMs(nodeSnap.execution_time_ms)}</span>
          ) : null}
        </div>
      </div>

      {/* The agent's skill while it has no sub-agent runs */}
      {node.skill && directInvocations.length === 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 pl-5">
          <span className="rounded-md border border-surface-200 bg-surface-50 px-1.5 py-px font-sans text-[11px] text-ink-muted dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse-muted">
            {node.skill}
          </span>
        </div>
      )}

      {/* Live and completed sub-agent runs */}
      {directInvocations.length > 0 && (
        <div className="mt-2.5 space-y-1.5 pl-4">
          {directInvocations.map((inv) => (
            <SkillInvocationCard key={inv.id} invocation={inv} />
          ))}
        </div>
      )}

      {nodeSnap?.output_preview && status === 'completed' && directInvocations.length === 0 && (
        <p className="mt-2 line-clamp-2 pl-5 font-sans text-[11.5px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
          {nodeSnap.output_preview}
        </p>
      )}
    </div>
  )
}

function SwarmHandoffList({ handoffs }: { handoffs: DeepResearchHandoff[] }) {
  if (handoffs.length === 0) return null
  return (
    <div className="mt-2.5 space-y-1.5 rounded-xl border border-sky-500/25 bg-sky-500/[0.05] p-2.5 font-sans dark:border-sky-400/25 dark:bg-sky-400/[0.07]">
      <div className="flex items-center gap-1.5 font-sans text-[11.5px] font-medium text-sky-700 dark:text-sky-300">
        <ArrowLeftRight className="h-3 w-3" aria-hidden />
        <span>Swarm handoffs ({handoffs.length})</span>
      </div>
      {handoffs.map((h) => (
        <div
          key={h.id}
          className="rounded-lg bg-surface-0/90 px-2.5 py-1.5 font-sans text-[11.5px] dark:bg-surface-900/80"
        >
          <div className="font-sans text-[11.5px] font-semibold text-ink dark:text-ink-inverse">
            {humanizeIdentifier(h.from_node)}{' '}
            <span className="text-sky-600 dark:text-sky-400">→</span>{' '}
            {humanizeIdentifier(h.to_node)}
          </div>
          {h.message && (
            <p className="mt-0.5 line-clamp-2 font-sans text-[11px] leading-snug text-ink-secondary dark:text-ink-inverse-secondary">
              {h.message}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function NestedSwarmBox({
  node,
  path,
  snapshot,
}: {
  node: FormationTopologyNode
  path: string[]
  snapshot: DeepResearchSnapshot
}) {
  const { status, nodeSnap, handoffs } = deriveNodeState(snapshot, path)
  const children = node.children ?? []

  return (
    <div
      className={cn(
        'rounded-xl border p-3 font-sans transition-colors',
        status === 'executing'
          ? 'border-sky-500/50 bg-sky-500/[0.04] dark:border-sky-400/50 dark:bg-sky-400/[0.06]'
          : 'border-surface-200 bg-surface-50/70 dark:border-surface-800 dark:bg-surface-900/60',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusIcon status={status} />
          <span className="truncate font-sans text-[12.5px] font-semibold text-ink dark:text-ink-inverse">
            {node.label}
          </span>
          <KindBadge kind="swarm" />
        </div>
        <span className="font-sans text-[11px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">
          {nodeSnap?.execution_time_ms ? formatDurationMs(nodeSnap.execution_time_ms) : 'Peer handoff'}
        </span>
      </div>

      {node.description && (
        <p className="mt-1 pl-5 font-sans text-[11.5px] text-ink-muted dark:text-ink-inverse-muted">
          {node.description}
        </p>
      )}

      <div className="mt-2.5 space-y-2 pl-2">
        {children.map((peer) => (
          <AgentLeafCard
            key={peer.id}
            node={peer}
            path={[...path, peer.id]}
            snapshot={snapshot}
          />
        ))}
      </div>

      <SwarmHandoffList handoffs={handoffs} />
    </div>
  )
}

function OuterFormationStage({
  stage,
  index,
  snapshot,
}: {
  stage: FormationTopologyNode
  index: number
  snapshot: DeepResearchSnapshot
}) {
  const stagePath = [stage.id]
  const { status, nodeSnap, handoffs } = deriveNodeState(snapshot, stagePath)
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)

  const autoOpen = status === 'executing' || status === 'failed' || index === 0 || Boolean(nodeSnap)
  const isOpen = manualOpen ?? autoOpen
  const children = stage.children ?? []

  const isInvestigation = stage.id === 'investigation_formation'
  const fanInChild = isInvestigation ? children.find((c) => c.id === 'evidence_ledger') : undefined
  const parallelBranches = isInvestigation
    ? children.filter((c) => c.id !== 'evidence_ledger')
    : children

  return (
    <section
      aria-label={stage.label}
      className={cn(
        'rounded-2xl border font-sans transition-colors duration-150',
        status === 'executing'
          ? 'border-blurple-500/70 bg-surface-0 shadow-soft dark:border-blurple-400/70 dark:bg-surface-850 dark:shadow-dark-soft'
          : status === 'completed'
            ? 'border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-850/90'
            : status === 'failed'
              ? 'border-rose-500/50 bg-surface-0 dark:bg-surface-850'
              : 'border-surface-200/80 bg-surface-0/70 dark:border-surface-800/80 dark:bg-surface-900/60',
      )}
    >
      <button
        type="button"
        onClick={() => setManualOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="font-sans text-[11.5px] font-medium tabular-nums text-ink-muted dark:text-ink-inverse-muted">
            {String(index + 1).padStart(2, '0')}
          </span>
          <StatusIcon status={status} className="h-4 w-4" />
          <span className="truncate font-sans text-[14px] font-semibold tracking-[-0.01em] text-ink dark:text-ink-inverse">
            {stage.label}
          </span>
          <KindBadge kind={stage.kind} />
          {nodeSnap && nodeSnap.execution_count > 1 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 font-sans text-[11px] font-medium text-sky-700 dark:text-sky-300">
              <Repeat className="h-2.5 w-2.5" aria-hidden />
              Pass {nodeSnap.execution_count}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {nodeSnap?.execution_time_ms ? (
            <span className="font-sans text-[11.5px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">
              {formatDurationMs(nodeSnap.execution_time_ms)}
            </span>
          ) : null}
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-ink-muted dark:text-ink-inverse-muted" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 text-ink-muted dark:text-ink-inverse-muted" aria-hidden />
          )}
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-surface-200/80 px-3.5 pb-3.5 pt-3 dark:border-surface-800">
          {stage.description && (
            <p className="mb-3 px-0.5 font-sans text-[12px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
              {stage.description}
            </p>
          )}

          {isInvestigation && (
            <div className="mb-2 flex items-center gap-1.5 px-0.5 font-sans text-[11.5px] font-medium text-ink-muted dark:text-ink-inverse-muted">
              <GitFork className="h-3.5 w-3.5 text-volt" aria-hidden />
              <span>Parallel intelligence branches</span>
            </div>
          )}

          <div className="space-y-2">
            {parallelBranches.map((child, childIdx) => {
              const childPath = [...stagePath, child.id]
              const isSequentialGraph = stage.kind === 'graph' && !isInvestigation
              return (
                <div key={child.id}>
                  {child.kind === 'swarm' ? (
                    <NestedSwarmBox node={child} path={childPath} snapshot={snapshot} />
                  ) : (
                    <AgentLeafCard node={child} path={childPath} snapshot={snapshot} />
                  )}
                  {isSequentialGraph && childIdx < parallelBranches.length - 1 && (
                    <div className="my-1 flex justify-center" aria-hidden>
                      <ArrowDown className="h-3.5 w-3.5 text-surface-300 dark:text-surface-600" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {fanInChild && (
            <div className="mt-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="h-px flex-1 bg-surface-200 dark:bg-surface-800" />
                <span className="rounded-full border border-blurple-500/30 bg-blurple-600/10 px-2.5 py-0.5 font-sans text-[11px] font-medium text-volt dark:border-blurple-400/30 dark:bg-blurple-400/15">
                  Convergence barrier · all branches complete
                </span>
                <span className="h-px flex-1 bg-surface-200 dark:bg-surface-800" />
              </div>
              <AgentLeafCard
                node={fanInChild}
                path={[...stagePath, fanInChild.id]}
                snapshot={snapshot}
              />
            </div>
          )}

          {stage.kind === 'swarm' && <SwarmHandoffList handoffs={handoffs} />}
        </div>
      )}
    </section>
  )
}

export interface FormationTelemetryProps {
  snapshot: DeepResearchSnapshot
  onCancel: () => void
  /** Extra controls beside Cancel (the Graph / List switch). */
  actions?: ReactNode
}

/** Run status, elapsed time, counters, Cancel and the path of the agent working now. */
export function FormationTelemetry({ snapshot, onCancel, actions }: FormationTelemetryProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!snapshot.active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [snapshot.active])

  const elapsedMs = useMemo(() => {
    if (snapshot.execution_time_ms > 0 && !snapshot.active) {
      return snapshot.execution_time_ms
    }
    const startedMs = Date.parse(snapshot.created_at)
    if (!Number.isFinite(startedMs)) return snapshot.execution_time_ms
    const endMs = snapshot.completed_at && !snapshot.active ? Date.parse(snapshot.completed_at) : now
    return Math.max(0, endMs - startedMs)
  }, [snapshot.execution_time_ms, snapshot.active, snapshot.created_at, snapshot.completed_at, now])

  const completedCount = useMemo(() => {
    const fromMap = Object.values(snapshot.nodes).filter((n) => n.status === 'completed').length
    return Math.max(fromMap, snapshot.completed_nodes.length)
  }, [snapshot.nodes, snapshot.completed_nodes.length])

  const pill = runStatusPill(snapshot.status, snapshot.active)
  return (
    <div className="shrink-0 border-b border-surface-200 bg-surface-0 px-4 py-3 dark:border-surface-800 dark:bg-surface-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-sans text-[11.5px] font-medium',
              pill.classes,
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', pill.dot)} aria-hidden />
            {pill.label}
          </span>

          <span className="font-sans text-[12px] tabular-nums text-ink-secondary dark:text-ink-inverse-secondary">
            {formatDurationMs(elapsedMs)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {actions}
          {snapshot.active && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 font-sans text-[11.5px] font-medium text-rose-700 transition-colors hover:bg-rose-500/20 dark:text-rose-300"
            >
              <Square className="h-3 w-3 fill-current" aria-hidden />
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Metrics Row */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 font-sans text-[12px] text-ink-muted dark:text-ink-inverse-muted">
        <span>
          <strong className="font-semibold tabular-nums text-ink dark:text-ink-inverse">
            {completedCount}
          </strong>{' '}
          nodes done
        </span>
        <span aria-hidden>·</span>
        <span>
          <strong className="font-semibold tabular-nums text-ink dark:text-ink-inverse">
            {snapshot.skill_invocations.length}
          </strong>{' '}
          skills
        </span>
        {snapshot.usage.totalTokens > 0 && (
          <>
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              {snapshot.usage.totalTokens.toLocaleString()} tokens
            </span>
          </>
        )}
      </div>

      {/* Active Node Path Breadcrumb */}
      {snapshot.active && snapshot.active_node_path.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5 truncate rounded-lg bg-blurple-600/[0.07] px-2.5 py-1.5 font-sans text-[11.5px] font-medium text-volt dark:bg-blurple-400/[0.12]">
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
          <span className="truncate">
            {snapshot.active_node_path.map(humanizeIdentifier).join(' › ')}
          </span>
        </div>
      )}
    </div>
  )
}

/** The formation as a scrolling list of stages: objective, each stage's agents, skills and handoffs. */
export function FormationStageList({
  snapshot,
  topology,
  className,
}: {
  snapshot: DeepResearchSnapshot
  topology: FormationTopology
  className?: string
}) {
  return (
    <div className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-thin', className)}>
      {/* Research Objective Card */}
      <div className="mb-4 rounded-xl border border-surface-200 bg-surface-0 p-3.5 dark:border-surface-800 dark:bg-surface-850">
        <div className="flex items-center justify-between gap-2">
          <span className="font-sans text-[11.5px] font-medium text-volt">
            Research objective
          </span>
          {snapshot.selection.model_id && (
            <span className="truncate font-sans text-[11px] text-ink-muted dark:text-ink-inverse-muted">
              {snapshot.selection.model_id}
            </span>
          )}
        </div>
        <p className="mt-1.5 font-sans text-[13px] font-medium leading-relaxed text-ink dark:text-ink-inverse">
          {snapshot.query}
        </p>
        {snapshot.context && (
          <p className="mt-1.5 line-clamp-3 border-t border-surface-100 pt-1.5 font-sans text-[11.5px] text-ink-secondary dark:border-surface-800 dark:text-ink-inverse-secondary">
            <span className="font-medium text-ink-muted dark:text-ink-inverse-muted">
              Attached context:{' '}
            </span>
            {snapshot.context}
          </p>
        )}
      </div>

      {/* The outer graph's stages, in edge order */}
      <div className="space-y-1.5">
        {topology.nodes.map((stage, idx) => (
          <div key={stage.id}>
            <OuterFormationStage stage={stage} index={idx} snapshot={snapshot} />
            {idx < topology.nodes.length - 1 && (
              <div className="my-2 flex flex-col items-center gap-1">
                <ArrowDown className="h-4 w-4 text-surface-300 dark:text-surface-600" aria-hidden />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export interface DeepResearchFormationViewProps {
  snapshot: DeepResearchSnapshot
  topology: FormationTopology
  onCancel: () => void
}

/** The formation as a list: status strip above the stage list. */
export function DeepResearchFormationView({
  snapshot,
  topology,
  onCancel,
}: DeepResearchFormationViewProps) {
  return (
    <section
      aria-label="Formation inspector"
      className="flex h-full min-h-0 flex-col bg-surface-50/50 font-sans dark:bg-surface-900"
    >
      <FormationTelemetry snapshot={snapshot} onCancel={onCancel} />
      <FormationStageList snapshot={snapshot} topology={topology} />
    </section>
  )
}
