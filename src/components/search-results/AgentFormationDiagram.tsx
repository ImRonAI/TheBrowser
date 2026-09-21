/**
 * Agent Formation Diagram for Search Agent
 *
 * Visualizes the search agent's orchestration (swarm/workflow/graph)
 * using AI Elements Task components for collapsible tool display.
 */

import { memo, useMemo } from 'react'
import { Task, TaskTrigger, TaskContent, type TaskStatus } from '@/components/ai-elements/task'
import { CodeBlock } from '@/components/ai-elements/code-block'
import type { UIMessage } from '@ai-sdk/react'

/** Map AI SDK tool part state to TaskStatus */
function mapToTaskStatus(state: string | undefined): TaskStatus {
  switch (state) {
    case 'output-available':
      return 'success'
    case 'output-error':
      return 'error'
    case 'input-streaming':
    case 'input-available':
      return 'running'
    default:
      return 'pending'
  }
}

interface OrchestrationTool {
  toolCallId: string
  toolName: string
  state: string | undefined
  input: unknown
  output: unknown
}

interface AgentFormationDiagramProps {
  messages: UIMessage[]
  className?: string
}

export const AgentFormationDiagram = memo(function AgentFormationDiagram({
  messages,
  className
}: AgentFormationDiagramProps) {
  // Extract orchestration tool calls from messages
  const orchestrationTools = useMemo(() => {
    const tools: OrchestrationTool[] = []

    for (const message of messages) {
      if (message.role === 'assistant') {
        for (const part of message.parts) {
          if (part.type === 'dynamic-tool') {
            const toolName = (part.toolName ?? '').toLowerCase()

            // Check if it's an orchestration tool (workflow, swarm, graph)
            if (['workflow', 'swarm', 'graph'].some(t => toolName.includes(t))) {
              tools.push({
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                state: part.state,
                input: part.input,
                output: part.output,
              })
            }
          }
        }
      }
    }

    return tools
  }, [messages])

  if (orchestrationTools.length === 0) return null

  return (
    <div className={className}>
      <h3 className="text-sm font-semibold text-ink-base dark:text-ink-inverse-base mb-3">
        Agent Formation
      </h3>

      <div className="space-y-3">
        {orchestrationTools.map((tool, index) => (
          <Task key={`${tool.toolCallId}-${index}`} defaultOpen={false}>
            <TaskTrigger
              title={tool.toolName}
              status={mapToTaskStatus(tool.state)}
              description={`Orchestration: ${tool.toolName}`}
            />
            <TaskContent>
              {tool.input != null && (
                <CodeBlock
                  code={String(typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input, null, 2))}
                  language="json"
                />
              )}
              {tool.output != null && (
                <CodeBlock
                  code={String(typeof tool.output === 'string' ? tool.output : JSON.stringify(tool.output, null, 2))}
                  language="json"
                />
              )}
            </TaskContent>
          </Task>
        ))}
      </div>
    </div>
  )
})
