/**
 * WorkflowVisualizationPart
 *
 * Shared rendering for orchestration workflow visualization + active agent reasoning.
 */

import { memo, useMemo } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { NodeTypes } from '@xyflow/react'
import { Canvas } from '@/components/ai-elements/canvas'
import { Task, TaskTrigger, TaskContent } from '@/components/ai-elements/task'
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
} from '@/components/ai-elements/chain-of-thought'
import {
  Node,
  NodeHeader,
  NodeTitle,
  NodeDescription,
  NodeContent,
} from '@/components/ai-elements/node'

export interface WorkflowVisualizationUIPart {
  type: 'workflow_visualization'
  title?: string
  nodes: Array<{
    id: string
    type?: string
    position: { x: number; y: number }
    data: {
      label: string
      description?: string
      status?: 'pending' | 'running' | 'complete' | 'error'
      isAgentActive?: boolean
      chainOfThought?: {
        steps: Array<{
          label: string
          description: string
          status: 'pending' | 'running' | 'complete' | 'error'
        }>
      }
    }
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    type?: 'default' | 'animated' | 'temporary'
    animated?: boolean
  }>
  activeAgents?: Array<{
    id: string
    name: string
    chainOfThought: {
      steps: Array<{
        label: string
        description: string
        status: 'pending' | 'running' | 'complete' | 'error'
      }>
    }
  }>
}

const AgentWorkflowNode = memo(({ data }: any) => {
  const nodeClassName = data.isAgentActive
    ? 'border border-accent/60 dark:border-accent-light/60 shadow-glow-accent animate-pulse-glow'
    : ''

  return (
    <Node className={nodeClassName} handles={{ target: true, source: true }}>
      <NodeHeader>
        <NodeTitle>{data.label}</NodeTitle>
        {data.description && <NodeDescription>{data.description}</NodeDescription>}
      </NodeHeader>
      {data.status && (
        <NodeContent>
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                data.status === 'complete'
                  ? 'bg-green-500'
                  : data.status === 'running'
                  ? 'bg-blue-500 animate-pulse'
                  : data.status === 'error'
                  ? 'bg-red-500'
                  : 'bg-gray-400'
              }`}
            />
            <span className="text-xs capitalize">{data.status}</span>
          </div>
        </NodeContent>
      )}
    </Node>
  )
})

AgentWorkflowNode.displayName = 'AgentWorkflowNode'

const workflowNodeTypes: NodeTypes = {
  agentNode: AgentWorkflowNode,
}

export const WorkflowVisualizationPart = memo(({ part, messageId, partIndex }: {
  part: WorkflowVisualizationUIPart
  messageId: string
  partIndex: number
}) => {
  const activeAgentsForWorkflow = part.activeAgents || []
  const flowNodes = useMemo(
    () => part.nodes.map((node) => ({ ...node, type: 'agentNode' })),
    [part.nodes],
  )

  return (
    <Task
      key={`${messageId}-${partIndex}`}
      defaultOpen
    >
      <TaskTrigger title={part.title || 'Agent Orchestration Workflow'} status="running" />
      <TaskContent>
        <div className="flex flex-col md:flex-row min-h-[520px] md:h-[540px] rounded-xl border border-surface-200/70 dark:border-surface-700/70 overflow-hidden bg-surface-0/70 dark:bg-surface-900/40">
        {/* Left 70% - Canvas Workflow Visualization */}
        <div className="flex-[7] min-h-[320px] md:min-h-0 border-b md:border-b-0 md:border-r border-surface-200/70 dark:border-surface-700/70 bg-surface-50/70 dark:bg-surface-900/50">
          <ReactFlowProvider>
            <Canvas
              nodes={flowNodes}
              edges={part.edges}
              nodeTypes={workflowNodeTypes}
              fitView
            />
          </ReactFlowProvider>
        </div>

        {/* Right 30% - Chain of Thought */}
        <div className="flex-[3] p-4 md:p-5 overflow-y-auto space-y-4 bg-surface-0/80 dark:bg-surface-850/80">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
              Active Agents
            </h3>
            <span className="text-xs text-ink-muted/70 dark:text-ink-inverse-muted/70">
              {activeAgentsForWorkflow.length}
            </span>
          </div>
          {activeAgentsForWorkflow.length > 0 ? (
            activeAgentsForWorkflow.map((agent) => (
              <ChainOfThought key={agent.id} defaultOpen>
                <ChainOfThoughtHeader>{agent.name}</ChainOfThoughtHeader>
                <ChainOfThoughtContent>
                  {agent.chainOfThought.steps.map((step, stepIndex) => (
                    <ChainOfThoughtStep
                      key={stepIndex}
                      label={step.label}
                      description={step.description}
                      status={step.status === 'running' ? 'active' : step.status === 'error' ? 'complete' : step.status as 'pending' | 'complete'}
                    />
                  ))}
                </ChainOfThoughtContent>
              </ChainOfThought>
            ))
          ) : (
            <p className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">
              No active agents to display yet.
            </p>
          )}
        </div>
      </div>
      </TaskContent>
    </Task>
  )
})

WorkflowVisualizationPart.displayName = 'WorkflowVisualizationPart'
