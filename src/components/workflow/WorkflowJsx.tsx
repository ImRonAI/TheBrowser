import { Children, isValidElement, useMemo, type ReactNode } from 'react'
import { Workflow as WorkflowIcon } from 'lucide-react'
import { normalizeWorkflow, workflowOutline } from '@/lib/workflow'
import { WorkflowDiagram } from './WorkflowCanvas'

/**
 * The workflow vocabulary agents write for JSX Preview (`render_workflow` emits it; `render_ui` jsx may use it):
 *
 *   <Workflow title="Release">
 *     <WorkflowNode id="plan" label="Plan" description="…" content="…" footer="…" kind="start" x={0} y={0} />
 *     <WorkflowEdge source="plan" target="ship" type="animated" />
 *   </Workflow>
 *
 * WorkflowNode / WorkflowEdge render nothing themselves; Workflow reads their props and draws the diagram
 * with the AI Elements workflow components.
 */
export interface WorkflowNodeProps {
  id: string
  label: string
  description?: string
  content?: string
  footer?: string
  kind?: string
  x?: number
  y?: number
}
export interface WorkflowEdgeProps { source: string; target: string; type?: string }

export function WorkflowNode(_props: WorkflowNodeProps) { return null }
export function WorkflowEdge(_props: WorkflowEdgeProps) { return null }

export function Workflow({ title, children }: { title?: string; children?: ReactNode }) {
  const graph = useMemo(() => {
    const steps: unknown[] = []
    const connections: unknown[] = []
    Children.forEach(children, (child) => {
      if (!isValidElement(child)) return
      if (child.type === WorkflowNode) {
        const { x, y, ...step } = child.props as WorkflowNodeProps
        steps.push({ ...step, position: Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined })
      } else if (child.type === WorkflowEdge) {
        connections.push(child.props)
      }
    })
    return normalizeWorkflow({ steps, connections })
  }, [children])
  const outline = useMemo(() => workflowOutline(graph), [graph])

  return (
    <figure className="my-1 space-y-2">
      {title && (
        <figcaption className="flex items-center gap-2 text-sm font-medium text-ink dark:text-ink-inverse">
          <WorkflowIcon className="size-4 text-accent dark:text-accent-light" aria-hidden />
          {title}
          <span className="text-xs font-normal text-ink-muted dark:text-ink-inverse-muted">· {graph.steps.length} steps</span>
        </figcaption>
      )}
      {graph.steps.length > 0
        ? <WorkflowDiagram graph={graph} label={`${title ?? 'Workflow'}: ${outline.join(', then ')}`} />
        : <p className="text-sm text-ink-muted dark:text-ink-inverse-muted">This workflow has no steps.</p>}
    </figure>
  )
}
