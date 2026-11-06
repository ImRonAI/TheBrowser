import { useEffect, useMemo, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { nanoid } from 'nanoid'
import { Pencil, Trash2, Workflow as WorkflowIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WorkflowDiagram } from '@/components/workflow/WorkflowCanvas'
import { WorkflowBuilder } from '@/components/workflow/WorkflowBuilder'
import { normalizeWorkflow, starterWorkflow, workflowOutline, type WorkflowGraph } from '@/lib/workflow'
import { workflowMarkdown } from '@/lib/document-ron'
import { cn } from '@/lib/utils'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    workflow: {
      /** Insert a workflow block (Start → Step → Done) and open its builder. */
      insertWorkflow: () => ReturnType
    }
  }
}

function parseGraph(value: string | null): WorkflowGraph {
  if (!value) return { steps: [], connections: [] }
  try {
    return normalizeWorkflow(JSON.parse(value))
  } catch {
    return { steps: [], connections: [] }
  }
}

/**
 * "Show a workflow": a block holding a workflow graph drawn with the AI Elements workflow components.
 * Saved in the page HTML as `<workflow-block data-graph="{…}">` with an ordered list of the steps
 * as a plain-text fallback for readers without the editor.
 */
export const WorkflowBlockExtension = Node.create<Record<string, never>, { openId: string | null }>({
  name: 'workflow',
  group: 'block',
  atom: true,
  draggable: false,

  addStorage() {
    return { openId: null }
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-id'),
        renderHTML: (attributes) => (attributes.id ? { 'data-id': attributes.id } : {}),
      },
      title: {
        default: 'Workflow',
        parseHTML: (element) => element.getAttribute('data-title') || 'Workflow',
        renderHTML: (attributes) => ({ 'data-title': attributes.title }),
      },
      graph: {
        default: { steps: [], connections: [] },
        parseHTML: (element) => parseGraph(element.getAttribute('data-graph')),
        renderHTML: (attributes) => ({ 'data-graph': JSON.stringify(attributes.graph) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'workflow-block' }]
  },

  // @tiptap/markdown: a workflow reads as a ```workflow JSON fence (what Ron receives as page context).
  renderMarkdown: (node) => workflowMarkdown(String(node.attrs?.title || 'Workflow'), normalizeWorkflow(node.attrs?.graph)),

  renderHTML({ node, HTMLAttributes }) {
    const graph = node.attrs.graph as WorkflowGraph
    return ['workflow-block', mergeAttributes(HTMLAttributes), ['ol', ...workflowOutline(graph).map((label) => ['li', label])]]
  },

  addCommands() {
    return {
      insertWorkflow: () => ({ commands, state }) => {
        const id = nanoid(10)
        this.storage.openId = id
        const block = { type: this.name, attrs: { id, title: 'Workflow', graph: starterWorkflow() } }
        // With a block selected (e.g. another workflow), add after it instead of replacing it.
        return state.selection instanceof NodeSelection
          ? commands.insertContentAt(state.selection.to, block)
          : commands.insertContent(block)
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(WorkflowBlockView, {
      // The diagram pans on drag and its buttons are buttons: keep those events away from ProseMirror.
      stopEvent: ({ event }) => event.target instanceof Element && !!event.target.closest('.react-flow, button'),
    })
  },
})

function WorkflowBlockView({ node, editor, extension, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const graph = useMemo(() => normalizeWorkflow(node.attrs.graph), [node.attrs.graph])
  const title = String(node.attrs.title || 'Workflow')
  const [open, setOpen] = useState(false)
  const editable = editor.isEditable

  // A block just inserted from the menu opens straight into the builder.
  useEffect(() => {
    const storage = extension.storage as { openId: string | null }
    if (node.attrs.id && storage.openId === node.attrs.id) {
      storage.openId = null
      setOpen(true)
    }
  }, [extension, node.attrs.id])

  return (
    <NodeViewWrapper contentEditable={false} data-workflow-block=""
      className={cn('not-prose my-6 rounded-2xl border border-surface-200 bg-surface-50/60 p-3 dark:border-surface-700 dark:bg-surface-850/60',
        selected && 'ring-2 ring-accent/40')}>
      <div className="mb-3 flex items-center gap-3 px-1">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent dark:bg-accent-light/10 dark:text-accent-light">
          <WorkflowIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink dark:text-ink-inverse">{title}</p>
          <p className="text-xs text-ink-muted dark:text-ink-inverse-muted">
            {graph.steps.length} {graph.steps.length === 1 ? 'step' : 'steps'} · {graph.connections.length} {graph.connections.length === 1 ? 'connection' : 'connections'}
          </p>
        </div>
        {editable && (
          <>
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 rounded-full" onClick={() => setOpen(true)}>
              <Pencil className="size-3.5" />Edit workflow
            </Button>
            <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove workflow" title="Remove workflow"
              className="rounded-full text-ink-muted hover:text-danger" onClick={() => deleteNode()}>
              <Trash2 className="size-4" />
            </Button>
          </>
        )}
      </div>
      {graph.steps.length > 0
        ? <WorkflowDiagram graph={graph} label={`${title}: ${workflowOutline(graph).join(', then ')}`} className="h-[380px]" />
        : (
          <button type="button" disabled={!editable} onClick={() => setOpen(true)}
            className="flex h-40 w-full items-center justify-center rounded-xl border border-dashed border-surface-300 text-sm text-ink-muted hover:bg-surface-100 dark:border-surface-600 dark:text-ink-inverse-muted dark:hover:bg-surface-800">
            This workflow has no steps yet{editable ? ' — click to add them' : ''}
          </button>
        )}
      {editable && (
        <WorkflowBuilder open={open} title={title} graph={graph} onClose={() => setOpen(false)}
          onSave={(nextTitle, nextGraph) => { updateAttributes({ title: nextTitle, graph: nextGraph }); setOpen(false) }} />
      )}
    </NodeViewWrapper>
  )
}
