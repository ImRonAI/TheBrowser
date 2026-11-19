/**
 * Deep Research formation graph: the AI Elements Workflow composition v0-clone-blurple uses for its
 * agent graphs (`graph-canvas.tsx` + `graph-node.tsx`) — Canvas + a custom Node type +
 * Edge.Animated/Temporary + Connection + Controls + Panel — fed by the run snapshot.
 *
 * Two differences from that reference, both asked for:
 * - An agent's `Agent` component (its Task and Chain of Thought inside) is not a hover toolbar: it
 *   slides down inside the node in the native Accordion when the node is clicked, at a fixed
 *   height with its own scrolling.
 * - A nested formation is not drawn as a frame inside the canvas: clicking its node enters it, and
 *   the same canvas shows that formation's own graph; the Panel leads back out.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import {
  Agent,
  AgentContent,
  AgentHeader,
} from '@/components/ai-elements/agent'
import { Canvas } from '@/components/ai-elements/canvas'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from '@/components/ai-elements/chain-of-thought'
import { Connection } from '@/components/ai-elements/connection'
import { Controls } from '@/components/ai-elements/controls'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Edge } from '@/components/ai-elements/edge'
import {
  Node,
  NodeAction,
  NodeContent,
  NodeDescription,
  NodeFooter,
  NodeHeader,
  NodeTitle,
} from '@/components/ai-elements/node'
import { Panel } from '@/components/ai-elements/panel'
import { MessageResponse } from '@/components/ai-elements/response'
import { Shimmer } from '@/components/ai-elements/shimmer'
import {
  Task,
  TaskContent,
  TaskItem,
  TaskTrigger,
  type TaskStatus,
} from '@/components/ai-elements/task'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  getStatusBadge,
  type LegacyToolState,
} from '@/components/ai-elements/tool'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import {
  nodePathKey,
  type DeepResearchSnapshot,
  type FormationTopology,
  type FormationTopologyNode,
} from '@/lib/deep-research-api'
import {
  agentTranscript,
  deriveNodeState,
  isFormation,
  layoutScope,
  leafAgents,
  nodeToolState,
  resolveScope,
  scopeEdges,
  scopeTrail,
  type AgentStepView,
  type AgentTranscript,
  type SkillStepView,
  type SkillView,
  type TextStepView,
} from '@/lib/deep-research-graph'
import { cn } from '@/utils/cn'
import './formation-graph.css'

const KIND_LABELS: Record<string, string> = {
  agent: 'Agent',
  swarm: 'Swarm',
  graph: 'Graph',
}

interface FormationGraphContextValue {
  snapshot: DeepResearchSnapshot
  /** Open or close an agent's accordion (by node path key). */
  onToggle: (key: string) => void
  /** Show a nested formation's own graph. */
  onEnter: (path: string[]) => void
}

const FormationGraphContext = createContext<FormationGraphContextValue | null>(null)

function useFormationGraph(): FormationGraphContextValue {
  const context = useContext(FormationGraphContext)
  if (!context) throw new Error('Formation nodes must render inside FormationGraph')
  return context
}

interface FormationNodeData extends Record<string, unknown> {
  path: string[]
  pathKey: string
  node: FormationTopologyNode
  expanded: boolean
  handles: { target: boolean; source: boolean }
}

interface FlowNode {
  id: string
  type: 'formation'
  position: { x: number; y: number }
  data: FormationNodeData
}

/**
 * True when a click came from an interactive element inside the node (a link in rendered markdown,
 * a trigger, the agent's own scrolling body): those keep their own behaviour and do not toggle it.
 */
function fromInteractiveDescendant(event: { target: EventTarget; currentTarget: EventTarget }): boolean {
  const { target, currentTarget } = event
  if (!(target instanceof Element) || !(currentTarget instanceof Element)) return false
  if (!currentTarget.contains(target)) return true
  const hit = target.closest("a, button, input, textarea, select, summary, [role='button'], [data-agent-body]")
  return Boolean(hit && hit !== currentTarget)
}

const CARD =
  'w-[360px] cursor-pointer rounded-xl border-surface-200 bg-surface-0 text-ink shadow-soft transition-colors duration-200 hover:border-blurple-500/50 dark:hover:border-blurple-400/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple-500/60 dark:border-surface-800 dark:bg-surface-850 dark:text-ink-inverse'
const CARD_HEADER =
  'relative h-[60px] rounded-t-xl border-surface-200 bg-surface-50 !p-3 !pr-32 dark:border-surface-800 dark:bg-surface-900'
const CARD_TITLE = 'truncate text-[13px] leading-none'
const CARD_DESCRIPTION = 'truncate text-[11.5px] leading-4 text-ink-muted dark:text-ink-inverse-muted'
const MUTED = 'text-xs text-ink-muted dark:text-ink-inverse-muted'

/** A sub-agent's or the agent's own text and reasoning as a Chain of Thought step. */
function textStep(step: TextStepView, conclusion = false) {
  return (
    <ChainOfThoughtStep
      key={step.id}
      label={step.kind === 'reasoning' ? 'Thinking' : conclusion ? 'Conclusion' : 'Reasoning'}
      status={step.active ? 'active' : 'complete'}
    >
      {step.kind === 'reasoning' ? (
        <p className={cn('whitespace-pre-wrap break-words', MUTED)}>{step.text}</p>
      ) : (
        <div className="text-xs [&_*]:text-xs [&_*]:leading-relaxed">
          <MessageResponse isAnimating={step.active}>{step.text}</MessageResponse>
        </div>
      )}
    </ChainOfThoughtStep>
  )
}

/** One `subagent` run: a Task whose content is that sub-agent's Chain of Thought. */
function SkillTask({ view }: { view: SkillView }) {
  const { skill } = view
  const status: TaskStatus = skill.status === 'running' ? 'running' : skill.status === 'failed' ? 'error' : 'success'
  const last = view.steps[view.steps.length - 1]
  return (
    <Task className="w-full min-w-0" defaultOpen={view.active}>
      <TaskTrigger
        className="min-w-0 [&>div]:min-w-0 [&_svg]:shrink-0"
        description={skill.task || undefined}
        status={status}
        title={skill.skill_name}
      />
      <TaskContent>
        <TaskItem>
          <ChainOfThought className="space-y-2 text-xs" defaultOpen isStreaming={view.active}>
            <ChainOfThoughtHeader>{view.active ? 'Working…' : 'Chain of Thought'}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              {view.steps.length === 0 && <p className={MUTED}>{view.active ? 'Starting…' : 'No steps were recorded.'}</p>}
              {view.steps.map((step: SkillStepView) => {
                if (step.kind === 'tool') {
                  const failed = step.tool.status === 'failed'
                  const toolState: LegacyToolState = step.active ? 'input-available' : failed ? 'output-error' : 'output-available'
                  const body = step.tool.output || step.tool.output_preview
                  return (
                    <ChainOfThoughtStep
                      key={step.id}
                      label={`Tool: ${step.tool.tool_name}`}
                      status={step.active ? 'active' : 'complete'}
                    >
                      <Tool>
                        <ToolHeader type="dynamic-tool" toolName={step.tool.tool_name} state={toolState} />
                        <ToolContent>
                          <ToolInput input={step.tool.input} />
                          {!step.active && (
                            <ToolOutput
                              output={failed ? null : (body || '(empty result)')}
                              errorText={failed ? (body || 'Tool failed') : undefined}
                            />
                          )}
                        </ToolContent>
                      </Tool>
                    </ChainOfThoughtStep>
                  )
                }
                return textStep(step, !view.active && step === last && step.kind === 'text')
              })}
            </ChainOfThoughtContent>
          </ChainOfThought>
        </TaskItem>
      </TaskContent>
    </Task>
  )
}

/** The agent's own reasoning and narration between its subagent calls. */
function OwnChain({ steps }: { steps: Array<Exclude<AgentStepView, SkillView>> }) {
  const streaming = steps.some((step) => step.kind !== 'pass' && step.active)
  return (
    <ChainOfThought className="space-y-2 text-xs" defaultOpen isStreaming={streaming}>
      <ChainOfThoughtHeader>{streaming ? 'Thinking…' : 'Chain of Thought'}</ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {steps.map((step) =>
          step.kind === 'pass' ? (
            <ChainOfThoughtStep key={step.id} label={`Pass ${step.pass}`} description="This agent ran again." />
          ) : (
            textStep(step)
          ),
        )}
      </ChainOfThoughtContent>
    </ChainOfThought>
  )
}

/** An agent's work in order: its Chain of Thought, a Task per subagent run, then its output. */
function AgentWork({ transcript, executing }: { transcript: AgentTranscript; executing: boolean }) {
  const blocks = useMemo(() => {
    const grouped: Array<{ key: string; skill?: SkillView; own?: Array<Exclude<AgentStepView, SkillView>> }> = []
    for (const step of transcript.steps) {
      if (step.kind === 'skill') {
        grouped.push({ key: step.id, skill: step })
        continue
      }
      const open = grouped[grouped.length - 1]
      if (open?.own) open.own.push(step)
      else grouped.push({ key: step.id, own: [step] })
    }
    return grouped
  }, [transcript.steps])

  if (blocks.length === 0 && !transcript.output) {
    return <p className={MUTED}>{executing ? 'Starting…' : 'No output streamed yet.'}</p>
  }
  return (
    <>
      {blocks.map((block) =>
        block.skill ? <SkillTask key={block.key} view={block.skill} /> : <OwnChain key={block.key} steps={block.own ?? []} />,
      )}
      {transcript.output && (
        <div className="min-w-0 text-[13px] [&_*]:text-[13px] [&_*]:leading-relaxed">
          <MessageResponse isAnimating={transcript.outputActive}>{transcript.output}</MessageResponse>
        </div>
      )}
    </>
  )
}

/** A nested formation: clicking it shows its own graph. */
function FormationCard({ data }: { data: FormationNodeData }) {
  const { snapshot, onEnter } = useFormationGraph()
  const { node, path } = data
  const { status } = deriveNodeState(snapshot, path)
  const agents = leafAgents(node, path).length
  const kind = KIND_LABELS[node.kind] ?? node.kind
  return (
    <Node
      aria-label={`${node.label} — ${kind}, ${agents} agents, ${status}. Activate to open this formation.`}
      className={CARD}
      data-node-kind={node.kind}
      data-node-status={status}
      handles={data.handles}
      onClick={() => onEnter(path)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onEnter(path)
        }
      }}
      role="button"
      tabIndex={0}
    >
      <NodeHeader className={CARD_HEADER}>
        <NodeTitle className={CARD_TITLE}>{node.label}</NodeTitle>
        <NodeDescription className={CARD_DESCRIPTION}>
          {kind} · {agents} {agents === 1 ? 'agent' : 'agents'}
        </NodeDescription>
        <NodeAction className="absolute right-3 top-3 p-0">{getStatusBadge(nodeToolState(status))}</NodeAction>
      </NodeHeader>
      <NodeContent className="h-[72px] overflow-hidden !p-3">
        <p className={cn('line-clamp-3', MUTED)}>{node.description || `Nested ${kind.toLowerCase()} formation.`}</p>
      </NodeContent>
      <NodeFooter className="h-[33px] justify-between rounded-b-xl border-surface-200 bg-surface-50 !px-3 !py-0 text-xs font-medium text-volt dark:border-surface-800 dark:bg-surface-900">
        Open formation
        <ChevronRight className="size-3.5" aria-hidden />
      </NodeFooter>
    </Node>
  )
}

/** An agent: the node shows its live output; its Agent component slides down in the accordion. */
function AgentCard({ data }: { data: FormationNodeData }) {
  const { snapshot, onToggle } = useFormationGraph()
  const { node, path, pathKey, expanded } = data
  const { status } = deriveNodeState(snapshot, path)
  const streaming = status === 'executing'
  const transcript = useMemo(() => agentTranscript(snapshot, path), [snapshot, path])
  const excerpt = transcript.latestText.length > 480 ? `…${transcript.latestText.slice(-480)}` : transcript.latestText

  return (
    <Node
      aria-expanded={expanded}
      aria-label={`${node.label} — Agent${node.skill ? `, skill ${node.skill}` : ''}, ${status}. Activate to show its work.`}
      className={CARD}
      data-node-kind="agent"
      data-node-status={status}
      handles={data.handles}
      onClick={(event) => {
        if (!fromInteractiveDescendant(event)) onToggle(pathKey)
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onToggle(pathKey)
        }
      }}
      role="button"
      tabIndex={0}
    >
      <NodeHeader className={CARD_HEADER}>
        <NodeTitle className={CARD_TITLE}>{node.label}</NodeTitle>
        <NodeDescription className={CARD_DESCRIPTION}>
          Agent{node.skill ? ` · ${node.skill}` : ''}
        </NodeDescription>
        <NodeAction className="absolute right-3 top-3 p-0">{getStatusBadge(nodeToolState(status))}</NodeAction>
      </NodeHeader>
      <NodeContent className="h-[72px] overflow-hidden !p-3">
        {streaming && (
          <Shimmer as="p" className="text-xs">
            Streaming…
          </Shimmer>
        )}
        {excerpt ? (
          <div className="max-h-24 overflow-hidden text-xs [&_*]:text-xs [&_*]:leading-snug">
            <MessageResponse isAnimating={streaming}>{excerpt}</MessageResponse>
          </div>
        ) : streaming ? null : (
          <p className={MUTED}>No output yet</p>
        )}
      </NodeContent>
      <Accordion collapsible onValueChange={() => onToggle(pathKey)} type="single" value={expanded ? 'agent' : ''}>
        <AccordionItem className="border-b-0 border-t border-surface-200 dark:border-surface-800" value="agent">
          <AccordionTrigger className="h-8 px-3 py-0 text-xs tracking-normal text-ink-secondary hover:no-underline dark:text-ink-inverse-secondary">
            Agent activity
          </AccordionTrigger>
          <AccordionContent className="p-0">
            <Agent className="rounded-none border-0" data-agent-body>
              <AgentHeader
                className="h-11 overflow-hidden border-t border-surface-200 py-0 dark:border-surface-800 [&>div>div]:shrink-0 [&>div>div]:whitespace-nowrap [&>div>span]:truncate [&>div]:min-w-0"
                model={snapshot.selection.model_id ?? undefined}
                name={`${node.label} · ${status}`}
              />
              <AgentContent className="nodrag nopan nowheel flex h-[340px] cursor-auto select-text flex-col space-y-0 p-0">
                <Conversation>
                  <ConversationContent className="gap-3 px-3 pb-3 pt-1">
                    <AgentWork executing={streaming} transcript={transcript} />
                  </ConversationContent>
                  <ConversationScrollButton />
                </Conversation>
              </AgentContent>
            </Agent>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Node>
  )
}

/** Room for the Panel above the graph and the Controls beside it. */
const FIT_VIEW = { padding: { top: '72px', right: '32px', bottom: '32px', left: '72px' }, maxZoom: 1 } as const

/** Fits the graph again after an agent opens or closes, once its accordion has finished moving. */
function RefitOnChange({ signal }: { signal: string }) {
  const { fitView } = useReactFlow()
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const timer = window.setTimeout(() => void fitView({ ...FIT_VIEW, duration: 250 }), 220)
    return () => window.clearTimeout(timer)
  }, [signal, fitView])
  return null
}

function FormationNode({ data }: { data: FormationNodeData }) {
  return isFormation(data.node) ? <FormationCard data={data} /> : <AgentCard data={data} />
}

const nodeTypes = {
  formation: FormationNode,
}

const edgeTypes = {
  animated: Edge.Animated,
  temporary: Edge.Temporary,
}

export interface FormationGraphProps {
  snapshot: DeepResearchSnapshot
  topology: FormationTopology
}

export function FormationGraph({ snapshot, topology }: FormationGraphProps) {
  const [scopePath, setScopePath] = useState<string[]>([])
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  const scopeKey = nodePathKey(scopePath)
  // A path that no longer names a formation (the topology changed) falls back to the root graph.
  const scope = useMemo(
    () => resolveScope(topology, scopePath) ?? resolveScope(topology, []),
    [topology, scopePath],
  )
  const trail = useMemo(() => scopeTrail(topology, scope?.path ?? []), [topology, scope])
  const layout = useMemo(() => (scope ? layoutScope(scope, expanded) : null), [scope, expanded])

  // Node objects are reused while their place and state are unchanged, so React Flow keeps their measurements.
  const placed = useRef(new Map<string, FlowNode>())
  const nodes = useMemo(() => {
    const next = new Map<string, FlowNode>()
    const list = (layout?.nodes ?? []).map((item) => {
      const id = item.key
      const before = placed.current.get(id)
      const same =
        before &&
        before.position.x === item.x &&
        before.position.y === item.y &&
        before.data.expanded === item.expanded &&
        before.data.node === item.node &&
        before.data.handles.target === item.handles.target &&
        before.data.handles.source === item.handles.source
      const node: FlowNode = same
        ? before
        : {
            id,
            type: 'formation',
            position: { x: item.x, y: item.y },
            data: { path: item.path, pathKey: item.key, node: item.node, expanded: item.expanded, handles: item.handles },
          }
      next.set(id, node)
      return node
    })
    placed.current = next
    return list
  }, [layout])

  const live = scope && layout ? scopeEdges(snapshot, scope, layout.edges) : []
  const edgeSignature = live.map((edge) => `${edge.id}:${edge.type}`).join('|')
  const edges = useMemo(
    () =>
      live.map((edge) => ({
        id: `${scopeKey}:${edge.id}`,
        source: nodePathKey([...(scope?.path ?? []), edge.source]),
        target: nodePathKey([...(scope?.path ?? []), edge.target]),
        type: edge.type,
      })),
    // `live` is rebuilt on every snapshot; its signature changes only when an edge changes type.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeKey, edgeSignature],
  )

  const context = useMemo<FormationGraphContextValue>(
    () => ({
      snapshot,
      onToggle: (key) =>
        setExpanded((current) => {
          const next = new Set(current)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        }),
      onEnter: (path) => setScopePath(path),
    }),
    [snapshot],
  )

  if (!scope || nodes.length === 0) return null
  const parent = trail.length > 1 ? trail[trail.length - 2] : null
  const scopeStatus = scope.path.length > 0 ? deriveNodeState(snapshot, scope.path).status : snapshot.status

  return (
    <FormationGraphContext.Provider value={context}>
      <div className="ron-formation-canvas h-full min-h-0 w-full bg-surface-50 dark:bg-surface-900">
        <Canvas
          className="h-full"
          connectionLineComponent={Connection}
          edges={edges}
          edgeTypes={edgeTypes}
          elementsSelectable
          fitView
          fitViewOptions={FIT_VIEW}
          key={scopeKey || 'root'}
          minZoom={0.25}
          nodes={nodes}
          nodesConnectable={false}
          nodesDraggable={false}
          nodesFocusable={false}
          nodeTypes={nodeTypes}
          panOnDrag
          selectionOnDrag={false}
        >
          <Controls />
          <RefitOnChange signal={[...expanded].sort().join('|')} />
          <Panel
            className="flex items-center gap-1 rounded-xl border-surface-200 bg-surface-0 p-1 shadow-soft dark:border-surface-800 dark:bg-surface-850"
            position="top-left"
          >
            {parent && (
              <Button
                aria-label={`Back to ${parent.label}`}
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={() => setScopePath(parent.path)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                Back
              </Button>
            )}
            <nav aria-label="Formation path" className="flex items-center gap-0.5 px-1 text-xs">
              {trail.map((crumb, index) => {
                const current = index === trail.length - 1
                return (
                  <span className="flex items-center gap-0.5" key={nodePathKey(crumb.path) || 'root'}>
                    {index > 0 && <ChevronRight className="size-3 text-ink-muted dark:text-ink-inverse-muted" aria-hidden />}
                    {current ? (
                      <span aria-current="page" className="px-1 font-semibold text-ink dark:text-ink-inverse">
                        {crumb.label}
                      </span>
                    ) : (
                      <button
                        className="rounded px-1 text-ink-muted transition-colors hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse"
                        onClick={() => setScopePath(crumb.path)}
                        type="button"
                      >
                        {crumb.label}
                      </button>
                    )}
                  </span>
                )
              })}
            </nav>
            <span className="pr-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted dark:text-ink-inverse-muted">
              · {KIND_LABELS[scope.kind] ?? scope.kind} · {scopeStatus}
            </span>
          </Panel>
        </Canvas>
      </div>
    </FormationGraphContext.Provider>
  )
}
