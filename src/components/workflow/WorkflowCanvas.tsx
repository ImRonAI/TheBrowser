import { memo, useEffect, useMemo, type ReactNode } from 'react'
import {
  EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlowProvider, getBezierPath, getSimpleBezierPath, useNodesInitialized,
  useReactFlow, useStore, type Edge as FlowEdge, type EdgeProps, type EdgeTypes, type Node as FlowNode, type NodeProps, type NodeTypes,
} from '@xyflow/react'
import { Pencil, Trash2 } from 'lucide-react'
import { Canvas } from '@/components/ai-elements/canvas'
import { Connection } from '@/components/ai-elements/connection'
import { Controls } from '@/components/ai-elements/controls'
import { Edge } from '@/components/ai-elements/edge'
import { Node, NodeContent, NodeDescription, NodeFooter, NodeHeader, NodeTitle } from '@/components/ai-elements/node'
import { Toolbar } from '@/components/ai-elements/toolbar'
import { Button } from '@/components/ui/button'
import { WORKFLOW_STEP_KINDS, handlesFor, inferKind, layoutWorkflow, workflowNodeSize, type WorkflowGraph, type WorkflowStepKind } from '@/lib/workflow'
import { KIND_TONE, ShapeSymbol, handleInset, labelInset } from './WorkflowShapes'
import { cn } from '@/lib/utils'

export interface WorkflowNodeData extends Record<string, unknown> {
  label: string
  description?: string
  content?: string
  footer?: string
  kind: WorkflowStepKind
  handles: { source: boolean; target: boolean }
  /** Present only in the builder: the AI Elements Toolbar shows Edit / Delete on the selected step. */
  onEdit?: (id: string) => void
  onDelete?: (id: string) => void
}
export type WorkflowFlowNode = FlowNode<WorkflowNodeData, 'workflow'>

const KIND_LABEL = Object.fromEntries(WORKFLOW_STEP_KINDS.map((item) => [item.kind, item.label])) as Record<WorkflowStepKind, string>

/** Edit / Delete on the selected node (builder only), from the AI Elements workflow Toolbar. */
function NodeActions({ id, data }: { id: string; data: WorkflowNodeData }) {
  if (!data.onEdit && !data.onDelete) return null
  return (
    <Toolbar className="bg-card shadow-subtle">
      {data.onEdit && <Button type="button" size="sm" variant="ghost" className="h-7 gap-1.5 px-2" onClick={() => data.onEdit?.(id)}><Pencil className="size-3.5" />Edit</Button>}
      {data.onDelete && <Button type="button" size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-danger hover:text-danger" onClick={() => data.onDelete?.(id)}><Trash2 className="size-3.5" />Delete</Button>}
    </Toolbar>
  )
}

/** A Step: the node from the AI Elements workflow example (Node + Header/Title/Description + Content + Footer). */
function StepCard({ id, data }: { id: string; data: WorkflowNodeData }) {
  return (
    <>
      <Node handles={data.handles} className="w-72 shadow-subtle dark:shadow-dark-subtle">
        <NodeHeader className="!p-3">
          <span className={cn('text-[10px] font-semibold uppercase tracking-[0.12em]', KIND_TONE.step)}>{KIND_LABEL.step}</span>
          <NodeTitle className="text-sm">{data.label}</NodeTitle>
          {data.description && <NodeDescription className="text-xs">{data.description}</NodeDescription>}
        </NodeHeader>
        {data.content && <NodeContent className="!p-3"><p className="whitespace-pre-wrap text-sm">{data.content}</p></NodeContent>}
        {data.footer && <NodeFooter className="!p-3"><p className="text-xs text-muted-foreground">{data.footer}</p></NodeFooter>}
      </Node>
      <NodeActions id={id} data={data} />
    </>
  )
}

/** Every other kind: its flowchart symbol, the name inside, details on hover, the footer as a caption below. */
function ShapeNode({ id, data, selected }: { id: string; data: WorkflowNodeData; selected: boolean }) {
  const { width, height } = workflowNodeSize(data.kind)
  const inset = labelInset(data.kind, width, height)
  const handle = handleInset(data.kind, width, height)
  const roomy = !['start', 'end', 'decision'].includes(data.kind)
  const details = [data.description, data.content].filter(Boolean).join('\n\n')
  return (
    <>
      <div className="node-shape relative" style={{ width, height }} title={details || undefined} data-kind={data.kind}>
        <ShapeSymbol kind={data.kind} width={width} height={height} selected={selected} />
        <div className="absolute flex flex-col items-center justify-center text-center"
          style={{ top: inset.top, right: inset.right, bottom: inset.bottom, left: inset.left }}>
          <span className={cn('font-semibold leading-tight text-ink dark:text-ink-inverse', data.kind === 'decision' ? 'line-clamp-3 text-[12px]' : 'line-clamp-2 text-[13px]')}>{data.label}</span>
          {roomy && data.description && <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-muted dark:text-ink-inverse-muted">{data.description}</span>}
        </div>
        {data.handles.target && <Handle type="target" position={Position.Left} style={handle ? { left: handle } : undefined} />}
        {data.handles.source && <Handle type="source" position={Position.Right} style={handle ? { right: handle } : undefined} />}
        {data.footer && (
          <p className="absolute left-1/2 top-full mt-1.5 w-max max-w-[220px] -translate-x-1/2 truncate text-center text-[11px] text-ink-muted dark:text-ink-inverse-muted">{data.footer}</p>
        )}
      </div>
      <NodeActions id={id} data={data} />
    </>
  )
}

const WorkflowStepNode = memo(({ id, data, selected }: NodeProps<WorkflowFlowNode>) =>
  data.kind === 'step' ? <StepCard id={id} data={data} /> : <ShapeNode id={id} data={data} selected={!!selected} />)
WorkflowStepNode.displayName = 'WorkflowStepNode'

/** Short text on an arrow ("Yes", "No", "Approved"), centred on the curve. */
function EdgeLabel({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <EdgeLabelRenderer>
      <div className="nodrag nopan pointer-events-none absolute rounded-full border border-surface-200 bg-surface-0 px-2 py-0.5 text-[11px] font-medium text-ink-secondary shadow-subtle dark:border-surface-700 dark:bg-surface-850 dark:text-ink-inverse-secondary"
        style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}>
        {children}
      </div>
    </EdgeLabelRenderer>
  )
}

/** The AI Elements edges, with an optional label. Both connect a step's right side to the next step's left side. */
function AnimatedEdge(props: EdgeProps) {
  const [, x, y] = getBezierPath({ ...props, sourcePosition: Position.Right, targetPosition: Position.Left })
  return <><Edge.Animated {...props} />{props.label ? <EdgeLabel x={x} y={y}>{props.label}</EdgeLabel> : null}</>
}
function TemporaryEdge(props: EdgeProps) {
  const [, x, y] = getSimpleBezierPath(props)
  return <><Edge.Temporary {...props} />{props.label ? <EdgeLabel x={x} y={y}>{props.label}</EdgeLabel> : null}</>
}

export const workflowNodeTypes: NodeTypes = { workflow: WorkflowStepNode }
export const workflowEdgeTypes: EdgeTypes = { animated: AnimatedEdge, temporary: TemporaryEdge }

/** Arrowhead at the target end; the colour follows the canvas's edge stroke. */
export const WORKFLOW_ARROW = { type: MarkerType.ArrowClosed, width: 18, height: 18, color: 'var(--xy-edge-stroke)' } as const

export function flowEdge(edge: { id: string; source: string; target: string; type: string; label?: string }): FlowEdge {
  return { id: edge.id, source: edge.source, target: edge.target, type: edge.type, label: edge.label, markerEnd: WORKFLOW_ARROW }
}

/** Graph → React Flow nodes/edges. A handle always exists where an arrow attaches, whatever the step's kind. */
export function toFlow(graph: WorkflowGraph): { nodes: WorkflowFlowNode[]; edges: FlowEdge[] } {
  const positions = layoutWorkflow(graph)
  return {
    nodes: graph.steps.map((step) => {
      const kind = inferKind(step, graph.connections)
      const handles = handlesFor(kind)
      return {
        id: step.id,
        type: 'workflow',
        position: positions[step.id],
        data: {
          label: step.label, description: step.description, content: step.content, footer: step.footer, kind,
          handles: {
            source: handles.source || graph.connections.some((edge) => edge.source === step.id),
            target: handles.target || graph.connections.some((edge) => edge.target === step.id),
          },
        },
      }
    }),
    edges: graph.connections.map(flowEdge),
  }
}

/**
 * A read-only workflow diagram (document blocks, agent `render_workflow` views). Page scrolling passes
 * through the canvas; drag to pan, use the controls to zoom or fit.
 */
export function WorkflowDiagram({ graph, className, label }: { graph: WorkflowGraph; className?: string; label?: string }) {
  const { nodes, edges } = useMemo(() => toFlow(graph), [graph])
  // Uncontrolled (defaultNodes): React Flow keeps the measured sizes, so fitting works. A new graph remounts.
  const graphKey = useMemo(() => JSON.stringify(graph), [graph])
  return (
    <div role="img" aria-label={label ?? 'Workflow diagram'}
      className={cn('ron-workflow relative h-[420px] w-full overflow-hidden rounded-xl border border-surface-200 bg-surface-0 dark:border-surface-700 dark:bg-surface-900', className)}>
      <ReactFlowProvider key={graphKey}>
        <Canvas defaultNodes={nodes} defaultEdges={edges} nodeTypes={workflowNodeTypes} edgeTypes={workflowEdgeTypes}
          connectionLineComponent={Connection} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
          // No keyboard interaction here, and no aria-live region: inside a document a live region makes modal
          // dialogs (aria-hidden's hideOthers keeps it visible) mark the editor's paragraphs, which ProseMirror redraws.
          disableKeyboardA11y
          panOnDrag panOnScroll={false} zoomOnScroll={false} preventScrolling={false} minZoom={0.2} fitViewOptions={{ padding: 0.2 }}>
          <Controls showInteractive={false} position="bottom-left" />
          <FitOnResize />
        </Canvas>
      </ReactFlowProvider>
    </div>
  )
}

/**
 * `fitView` on Canvas runs once, at initialisation. A diagram mounted before it has a size (an editor
 * node view, a panel that is still opening) would stay at minimum zoom in a corner, so fit again
 * whenever the viewport's size changes.
 */
function FitOnResize() {
  const width = useStore((state) => state.width)
  const height = useStore((state) => state.height)
  const initialized = useNodesInitialized()
  const { fitView } = useReactFlow()
  useEffect(() => {
    if (initialized && width > 0 && height > 0) void fitView({ padding: 0.2 })
  }, [initialized, width, height, fitView])
  return null
}
