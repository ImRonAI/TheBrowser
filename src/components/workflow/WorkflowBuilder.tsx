import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react'
import { RenIcon } from '@/components/brand'
import {
  ReactFlowProvider, addEdge, useEdgesState, useNodesState, useReactFlow,
  type Connection as FlowConnection, type Edge as FlowEdge, type IsValidConnection, type OnNodesChange,
} from '@xyflow/react'
import { nanoid } from 'nanoid'
import { ArrowRight, CircleDot, Diamond, Loader2, MousePointerClick, Square, Trash2, Undo2, Workflow as WorkflowIcon, LayoutGrid } from 'lucide-react'
import { Canvas } from '@/components/ai-elements/canvas'
import { Connection } from '@/components/ai-elements/connection'
import { Controls } from '@/components/ai-elements/controls'
import { Panel } from '@/components/ai-elements/panel'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  WORKFLOW_SHAPE_GROUPS, WORKFLOW_STEP_KINDS, handlesFor, normalizeWorkflow, tidyWorkflow, workflowNodeSize,
  type WorkflowEdgeType, type WorkflowGraph, type WorkflowStepKind,
} from '@/lib/workflow'
import { ronSegments, ronSessionId, workflowRonMessage } from '@/lib/ron-run'
import { useRonRun } from '@/hooks/useRonRun'
import { cn } from '@/lib/utils'
import { flowEdge, toFlow, workflowEdgeTypes, workflowNodeTypes, type WorkflowFlowNode } from './WorkflowCanvas'
import { ShapeThumbnail } from './WorkflowShapes'

const NEW_LABEL: Record<WorkflowStepKind, string> = {
  start: 'Start', end: 'Done', step: 'New step', decision: 'Decision?', delay: 'Wait', subprocess: 'Subprocess',
  manual: 'Manual task', automation: 'Automation', io: 'Input', document: 'Document', data: 'Data store',
}
const DRAG_TYPE = 'application/x-ron-workflow-shape'
const EDGE_LABELS = ['Yes', 'No', 'Approved', 'Rejected']
const field = 'w-full rounded-lg border border-surface-200 bg-surface-0 px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 dark:border-surface-700 dark:bg-surface-850 dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted'
const fieldLabel = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted'

export interface WorkflowBuilderProps {
  open: boolean
  title: string
  graph: WorkflowGraph
  onSave: (title: string, graph: WorkflowGraph) => void
  onClose: () => void
}

/** Full-screen editor for a document's workflow block, built from the AI Elements workflow components. */
export function WorkflowBuilder({ open, title, graph, onSave, onClose }: WorkflowBuilderProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent showCloseButton={false} overlayClassName="z-[230] bg-surface-900/50 backdrop-blur-sm"
        className="z-[231] flex h-[calc(100dvh-3rem)] w-[calc(100vw-3rem)] max-w-[1400px] flex-col gap-0 overflow-hidden rounded-2xl bg-surface-0 p-0 text-ink dark:bg-surface-900 dark:text-ink-inverse">
        {open && (
          <ReactFlowProvider>
            <BuilderBody initialTitle={title} initialGraph={graph} onSave={onSave} onClose={onClose} />
          </ReactFlowProvider>
        )}
      </DialogContent>
    </Dialog>
  )
}

function BuilderBody({ initialTitle, initialGraph, onSave, onClose }: {
  initialTitle: string; initialGraph: WorkflowGraph; onSave: WorkflowBuilderProps['onSave']; onClose: () => void
}) {
  const initial = useMemo(() => toFlow(initialGraph), [initialGraph])
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowFlowNode>(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>(initial.edges)
  const [title, setTitle] = useState(initialTitle)
  const canvasRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLInputElement>(null)
  const { screenToFlowPosition, fitView } = useReactFlow()

  const select = useCallback((id: string | null) => {
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === id })))
    setEdges((current) => current.map((edge) => ({ ...edge, selected: false })))
  }, [setNodes, setEdges])

  const removeStep = useCallback((id: string) => {
    setNodes((current) => current.filter((node) => node.id !== id))
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id))
  }, [setNodes, setEdges])

  const editStep = useCallback((id: string) => {
    select(id)
    requestAnimationFrame(() => labelRef.current?.focus())
  }, [select])

  // The Toolbar's Edit / Delete actions travel in node data, as React Flow custom nodes expect.
  const displayNodes = useMemo(() => nodes.map((node) => ({ ...node, data: { ...node.data, onEdit: editStep, onDelete: removeStep } })),
    [nodes, editStep, removeStep])

  const isValidConnection: IsValidConnection = useCallback((connection) =>
    connection.source !== connection.target &&
    !edges.some((edge) => edge.source === connection.source && edge.target === connection.target), [edges])

  const onConnect = useCallback((connection: FlowConnection) => {
    setEdges((current) => addEdge({ ...connection, ...flowEdge({ id: `${connection.source}->${connection.target}`,
      source: connection.source, target: connection.target, type: 'animated' }) }, current))
  }, [setEdges])

  /** Add a shape centred on a flow point (the drop point, or the middle of the view with a small cascade). */
  const addStep = (kind: WorkflowStepKind, at?: { x: number; y: number }) => {
    const bounds = canvasRef.current?.getBoundingClientRect()
    const offset = at ? 0 : (nodes.length % 6) * 28
    const centre = at ?? (bounds
      ? screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
      : { x: 0, y: 0 })
    const size = workflowNodeSize(kind)
    const id = `${kind}-${nanoid(6)}`
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      {
        id, type: 'workflow', selected: true,
        position: { x: Math.round(centre.x - size.width / 2 + offset), y: Math.round(centre.y - size.height / 2 + offset) },
        data: { label: NEW_LABEL[kind], kind, handles: handlesFor(kind) },
      },
    ])
    setEdges((current) => current.map((edge) => ({ ...edge, selected: false })))
    requestAnimationFrame(() => labelRef.current?.select())
  }

  // Drag a shape from the palette onto the canvas (React Flow's drag-and-drop pattern).
  const onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }
  const onDrop = (event: DragEvent) => {
    const kind = event.dataTransfer.getData(DRAG_TYPE) as WorkflowStepKind
    if (!WORKFLOW_STEP_KINDS.some((item) => item.kind === kind)) return
    event.preventDefault()
    addStep(kind, screenToFlowPosition({ x: event.clientX, y: event.clientY }))
  }

  const currentGraph = (): WorkflowGraph => normalizeWorkflow({
    steps: nodes.map((node) => ({
      id: node.id, label: node.data.label, description: node.data.description, content: node.data.content,
      footer: node.data.footer, kind: node.data.kind,
      position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
    })),
    connections: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, type: edge.type,
      label: typeof edge.label === 'string' ? edge.label : undefined })),
  })

  const replaceGraph = (graph: WorkflowGraph) => {
    const next = toFlow(graph)
    setNodes(next.nodes)
    setEdges(next.edges)
    requestAnimationFrame(() => void fitView({ padding: 0.25, duration: 300 }))
  }

  const tidy = () => replaceGraph(tidyWorkflow(currentGraph()))

  // Ask Ron: Ron draws the workflow with its render_workflow tool; the drawn graph replaces the canvas (undoable).
  const ron = useRonRun('document')
  const [ronPrompt, setRonPrompt] = useState('')
  const [ronNote, setRonNote] = useState('')
  const [beforeRon, setBeforeRon] = useState<{ title: string; graph: WorkflowGraph } | null>(null)
  const askRon = async () => {
    const intent = ronPrompt.trim()
    if (!intent || ron.running) return
    const before = { title, graph: currentGraph() }
    setRonNote('')
    const final = await ron.start({ sessionId: ronSessionId('wf', nanoid(12)), message: workflowRonMessage(title, before.graph, intent) })
    if (!final) return
    const segments = ronSegments(final)
    const drawn = [...segments].reverse().find((segment) => segment.kind === 'workflow')
    const reply = segments.filter((segment) => segment.kind === 'text').map((segment) => segment.kind === 'text' ? segment.text : '').join(' ').trim()
    if (!drawn || drawn.kind !== 'workflow') {
      setRonNote(final.status === 'cancelled' ? 'Stopped. Nothing was changed.' : reply ? `Ren didn’t draw a workflow: ${reply}` : 'Ren didn’t draw a workflow. Try describing the steps.')
      return
    }
    setBeforeRon(before)
    if (!title.trim() || title === 'Workflow') setTitle(drawn.title)
    replaceGraph(tidyWorkflow(drawn.graph))
    setRonPrompt('')
    setRonNote(reply || `Drew ${drawn.graph.steps.length} steps.`)
  }
  const undoRon = () => {
    if (!beforeRon) return
    setTitle(beforeRon.title)
    replaceGraph(beforeRon.graph)
    setBeforeRon(null)
    setRonNote('Restored the workflow from before Ren’s change.')
  }

  const selectedNode = nodes.filter((node) => node.selected).length === 1 ? nodes.find((node) => node.selected) : undefined
  const selectedEdge = !selectedNode ? edges.find((edge) => edge.selected) : undefined

  const updateStep = (id: string, patch: Partial<WorkflowFlowNode['data']>) => {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node))
  }

  const changeKind = (id: string, kind: WorkflowStepKind) => {
    updateStep(id, { kind, handles: handlesFor(kind) })
    // A Start has no incoming arrows and an End no outgoing ones.
    setEdges((current) => current.filter((edge) => !(kind === 'start' && edge.target === id) && !(kind === 'end' && edge.source === id)))
  }

  const setEdgeType = (id: string, type: WorkflowEdgeType) =>
    setEdges((current) => current.map((edge) => edge.id === id ? { ...edge, type } : edge))
  const setEdgeLabel = (id: string, label: string) =>
    setEdges((current) => current.map((edge) => edge.id === id ? { ...edge, label: label.slice(0, 40) || undefined } : edge))

  const save = () => onSave(title.trim() || 'Workflow', currentGraph())

  const stepLabel = (id: string) => nodes.find((node) => node.id === id)?.data.label ?? id
  const ronBusy = ron.running

  return (
    <>
      <header className="flex items-center gap-3 border-b border-surface-200 px-5 py-3 dark:border-surface-700">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent dark:bg-accent-light/10 dark:text-accent-light">
          <WorkflowIcon className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <DialogTitle className="sr-only">Workflow builder</DialogTitle>
          <DialogDescription className="sr-only">Add shapes, connect them, and describe what needs to happen, or ask Ren to draw it.</DialogDescription>
          <input aria-label="Workflow title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Workflow title"
            className="w-full rounded-md bg-transparent font-display text-xl text-ink outline-none placeholder:text-ink-muted focus:outline-none focus-visible:outline-none dark:text-ink-inverse" />
          <p className="text-xs text-ink-muted dark:text-ink-inverse-muted">
            {nodes.length} {nodes.length === 1 ? 'step' : 'steps'} · {edges.length} {edges.length === 1 ? 'connection' : 'connections'} · Drag from a dot to connect steps
          </p>
        </div>
        <Button type="button" variant="ghost" className="gap-1.5 rounded-full" disabled={nodes.length < 2 || ronBusy} onClick={tidy} title="Lay the steps out left to right">
          <LayoutGrid className="size-4" />Tidy up
        </Button>
        <Button type="button" variant="outline" className="rounded-full" onClick={onClose}>Cancel</Button>
        <Button type="button" className="rounded-full" onClick={save} disabled={nodes.length === 0 || ronBusy}>Save workflow</Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside aria-label="Shapes" className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-surface-200 bg-surface-50/60 p-3 dark:border-surface-700 dark:bg-surface-850/60">
          {WORKFLOW_SHAPE_GROUPS.map((group) => (
            <div key={group}>
              <p className={cn(fieldLabel, 'px-1')}>{group}</p>
              <div className="space-y-0.5">
                {WORKFLOW_STEP_KINDS.filter((item) => item.group === group).map(({ kind, label, hint }) => (
                  <button key={kind} type="button" draggable title={hint} aria-label={`Add ${label}`}
                    onDragStart={(event) => { event.dataTransfer.setData(DRAG_TYPE, kind); event.dataTransfer.effectAllowed = 'move' }}
                    onClick={() => addStep(kind)}
                    className="flex w-full cursor-grab items-center gap-2.5 rounded-lg px-1.5 py-1 text-left text-[13px] text-ink transition-colors hover:bg-surface-100 active:cursor-grabbing dark:text-ink-inverse dark:hover:bg-surface-800">
                    <ShapeThumbnail kind={kind} />
                    <span className="truncate">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="mt-auto px-1 text-[11px] leading-snug text-ink-muted dark:text-ink-inverse-muted">Click a shape to add it, or drag it onto the canvas.</p>
        </aside>

        <div ref={canvasRef} className="ron-workflow relative min-w-0 flex-1" onDragOver={onDragOver} onDrop={onDrop}>
          <Canvas nodes={displayNodes} edges={edges} nodeTypes={workflowNodeTypes} edgeTypes={workflowEdgeTypes}
            onNodesChange={onNodesChange as OnNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            isValidConnection={isValidConnection} connectionLineComponent={Connection}
            onPaneClick={() => select(null)} minZoom={0.2} fitViewOptions={{ padding: 0.25 }}>
            {nodes.length === 0 && !ronBusy && (
              <Panel position="top-center" className="mt-24 max-w-sm px-4 py-3 text-center text-sm text-ink-muted shadow-subtle dark:text-ink-inverse-muted">
                Add a Start from the shapes on the left, then the steps that follow, and drag between the dots to connect them. Or describe the process below and let Ren draw it.
              </Panel>
            )}
            <Panel position="bottom-center" className="ron-field mb-4 w-[min(640px,calc(100%-2rem))] rounded-2xl p-2 shadow-medium dark:shadow-dark-medium">
              <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void askRon() }}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent dark:bg-accent-light/10 dark:text-accent-light">
                  {ronBusy ? <Loader2 className="size-4 animate-spin" /> : <RenIcon className="size-4" />}
                </span>
                <input aria-label="Ask Ren to draw this workflow" value={ronPrompt} onChange={(event) => setRonPrompt(event.target.value)} disabled={ronBusy} maxLength={4000}
                  placeholder={nodes.length ? 'Ask Ren to change this workflow, e.g. “add a legal review before launch”' : 'Describe the process and Ren will draw it'}
                  className="min-w-0 flex-1 bg-transparent px-1 text-sm text-ink placeholder:text-ink-muted focus:outline-none disabled:opacity-60 dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted" />
                {ronBusy
                  ? <Button type="button" size="sm" variant="outline" className="gap-1.5 rounded-full" onClick={() => void ron.stop()}><Square className="size-3" />Stop</Button>
                  : <Button type="submit" size="sm" className="gap-1.5 rounded-full" disabled={!ronPrompt.trim()}>{nodes.length ? 'Ask Ren' : 'Draw it'}<ArrowRight className="size-3.5" /></Button>}
              </form>
              {(ronBusy || ronNote || ron.error || beforeRon) && (
                <div role="status" className="mt-1.5 flex items-center gap-2 px-2 pb-0.5 text-xs text-ink-muted dark:text-ink-inverse-muted">
                  <span className={cn('min-w-0 flex-1 truncate', ron.error && 'text-danger')}>
                    {ron.error ?? (ronBusy ? 'Ren is drawing the workflow…' : ronNote)}
                  </span>
                  {beforeRon && !ronBusy && (
                    <Button type="button" size="sm" variant="ghost" className="h-6 gap-1 rounded-full px-2 text-xs" onClick={undoRon}><Undo2 className="size-3" />Undo</Button>
                  )}
                </div>
              )}
            </Panel>
            <Controls position="bottom-left" showInteractive={false} />
          </Canvas>
        </div>

        <aside aria-label="Workflow inspector" className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-surface-200 bg-surface-50/60 p-5 dark:border-surface-700 dark:bg-surface-850/60">
          {selectedNode ? (
            <>
              <div>
                <p className={fieldLabel}>Shape</p>
                <div role="group" aria-label="Shape" className="grid grid-cols-3 gap-1.5">
                  {WORKFLOW_STEP_KINDS.map(({ kind, label, hint }) => (
                    <button key={kind} type="button" title={hint} aria-pressed={selectedNode.data.kind === kind} onClick={() => changeKind(selectedNode.id, kind)}
                      className={cn('flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium transition-colors',
                        selectedNode.data.kind === kind
                          ? 'border-accent/50 bg-accent/[0.07] text-ink dark:border-accent-light/40 dark:bg-accent-light/[0.07] dark:text-ink-inverse'
                          : 'border-surface-200 text-ink-secondary hover:bg-surface-100 dark:border-surface-700 dark:text-ink-inverse-secondary dark:hover:bg-surface-800')}>
                      <ShapeThumbnail kind={kind} />
                      <span className="w-full truncate text-center">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className={fieldLabel}>Name</span>
                <input ref={labelRef} className={field} value={selectedNode.data.label} maxLength={120}
                  onChange={(event) => updateStep(selectedNode.id, { label: event.target.value })} />
              </label>
              <label className="block">
                <span className={fieldLabel}>Summary</span>
                <input className={field} value={selectedNode.data.description ?? ''} maxLength={300} placeholder="One line about this step"
                  onChange={(event) => updateStep(selectedNode.id, { description: event.target.value })} />
              </label>
              <label className="block">
                <span className={fieldLabel}>What needs to happen</span>
                <textarea className={cn(field, 'min-h-[110px] resize-y')} value={selectedNode.data.content ?? ''} maxLength={2000}
                  placeholder="Details, checks, hand-offs…" onChange={(event) => updateStep(selectedNode.id, { content: event.target.value })} />
                {selectedNode.data.kind !== 'step' && <span className="mt-1 block text-[11px] text-ink-muted dark:text-ink-inverse-muted">Shown on hover; Step cards show it in full.</span>}
              </label>
              <label className="block">
                <span className={fieldLabel}>Footer</span>
                <input className={field} value={selectedNode.data.footer ?? ''} maxLength={300} placeholder="Owner, duration or status"
                  onChange={(event) => updateStep(selectedNode.id, { footer: event.target.value })} />
              </label>
              <Button type="button" variant="outline" className="mt-auto gap-2 rounded-full text-danger hover:text-danger" onClick={() => removeStep(selectedNode.id)}>
                <Trash2 className="size-4" />Delete step
              </Button>
            </>
          ) : selectedEdge ? (
            <>
              <div>
                <p className={fieldLabel}>Connection</p>
                <p className="text-sm text-ink dark:text-ink-inverse">{stepLabel(selectedEdge.source)} → {stepLabel(selectedEdge.target)}</p>
              </div>
              <label className="block">
                <span className={fieldLabel}>Label</span>
                <input className={field} value={typeof selectedEdge.label === 'string' ? selectedEdge.label : ''} maxLength={40} placeholder="e.g. Yes, No, Approved"
                  onChange={(event) => setEdgeLabel(selectedEdge.id, event.target.value)} />
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {EDGE_LABELS.map((label) => (
                    <button key={label} type="button" onClick={() => setEdgeLabel(selectedEdge.id, label)}
                      className="rounded-full border border-surface-200 px-2.5 py-0.5 text-xs text-ink-secondary hover:bg-surface-100 dark:border-surface-700 dark:text-ink-inverse-secondary dark:hover:bg-surface-800">
                      {label}
                    </button>
                  ))}
                </span>
              </label>
              <div>
                <p className={fieldLabel}>Path</p>
                <div role="group" aria-label="Path type" className="space-y-2">
                  {([['animated', 'Main path', 'Animated: the expected flow'], ['temporary', 'Alternate path', 'Dashed: conditional or error route']] as const).map(([type, label, hint]) => (
                    <button key={type} type="button" aria-pressed={(selectedEdge.type ?? 'animated') === type} onClick={() => setEdgeType(selectedEdge.id, type)}
                      className={cn('w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                        (selectedEdge.type ?? 'animated') === type ? 'border-accent/50 bg-accent/[0.06] dark:border-accent-light/40 dark:bg-accent-light/[0.06]'
                          : 'border-surface-200 hover:bg-surface-100 dark:border-surface-700 dark:hover:bg-surface-800')}>
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="block text-xs text-ink-muted dark:text-ink-inverse-muted">{hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              <Button type="button" variant="outline" className="mt-auto gap-2 rounded-full text-danger hover:text-danger"
                onClick={() => setEdges((current) => current.filter((edge) => edge.id !== selectedEdge.id))}>
                <Trash2 className="size-4" />Delete connection
              </Button>
            </>
          ) : (
            <div className="space-y-4 text-sm text-ink-secondary dark:text-ink-inverse-secondary">
              <p className="font-medium text-ink dark:text-ink-inverse">Show what needs to happen</p>
              <ul className="space-y-2.5">
                <li className="flex gap-2"><MousePointerClick className="mt-0.5 size-4 shrink-0 text-accent" />Pick shapes from the left: decisions, waits, documents, data stores and more.</li>
                <li className="flex gap-2"><CircleDot className="mt-0.5 size-4 shrink-0 text-accent" />Drag from a shape's right dot to another shape's left dot to connect them.</li>
                <li className="flex gap-2"><Diamond className="mt-0.5 size-4 shrink-0 text-accent" />Select a shape or an arrow to edit it here; label the arrows out of a decision.</li>
                <li className="flex gap-2"><RenIcon className="mt-0.5 size-4 shrink-0 text-accent" />Or ask Ren below to draw or change the workflow for you.</li>
              </ul>
              {nodes.length > 0 && (
                <div>
                  <p className={fieldLabel}>Steps</p>
                  <ul className="space-y-1">
                    {nodes.map((node) => (
                      <li key={node.id}>
                        <button type="button" onClick={() => select(node.id)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-surface-100 dark:hover:bg-surface-800">
                          <ShapeThumbnail kind={node.data.kind} className="scale-75" />
                          <span className="truncate">{node.data.label || 'Untitled step'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </>
  )
}
