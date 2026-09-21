/**
 * Orchestration Synchronization Utilities
 *
 * Maps agent streaming events to orchestrationStore state updates.
 * Handles the conversion between AgentStreamEvent and AgentStreamingData.
 */

import type { AgentStreamEvent } from '@/pages/types/agent';
import type { AgentStreamingData, AIToolExecution } from './orchestrationStore';

// ─────────────────────────────────────────────────────────────────────────────
// Stream ID to Agent ID Mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps a stream ID to its corresponding agent ID for orchestration visualization.
 *
 * Note: This is a placeholder implementation. In production, this should:
 * - Query a registry of active agent streams
 * - Look up metadata from the agent backend
 * - Handle multi-agent scenarios where one stream maps to multiple agents
 *
 * @param streamId The stream ID from the agent event
 * @returns The agent ID or null if not found
 */
export function findAgentIdForStream(streamId: string): string | null {
  // TODO: Implement proper stream-to-agent mapping
  // For now, assume streamId can be used as agentId directly
  // or extract from streamId format like "agent-{id}-stream-{timestamp}"

  const match = streamId.match(/agent-([^-]+)/);
  return match ? match[1] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event to Streaming Data Mappers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps an AgentStreamEvent to AgentStreamingData for orchestration visualization.
 * Extracts reasoning, chain-of-thought, tools, and images from the stream event.
 *
 * @param event The agent stream event
 * @returns Partial streaming data to merge with existing data
 */
export function mapStreamEventToData(
  event: AgentStreamEvent
): Partial<AgentStreamingData> {
  const streamingData: Partial<AgentStreamingData> = {};

  // Map reasoning text
  if (event.reasoningText) {
    streamingData.reasoning = {
      content: event.reasoningText,
      // Duration would be calculated by the UI component
    };
  }

  // Map tool usage
  if (event.current_tool_use) {
    streamingData.tools = [mapToolUse(event.current_tool_use)];
  }

  // Note: Images and chain-of-thought steps would be extracted from the full message content
  // This would require access to the conversation state, not just the streaming event
  // For now, these are handled by their respective UI components

  return streamingData;
}

/**
 * Maps a tool use object from the stream event to the AIToolExecution format.
 *
 * @param toolUse The tool use object from the event
 * @returns Formatted tool execution data
 */
function mapToolUse(toolUse: any): AIToolExecution {
  return {
    id: toolUse.id || `tool-${Date.now()}`,
    name: toolUse.name || 'unknown',
    input: toolUse.input || {},
    status: toolUse.status || 'running',
    output: toolUse.output,
    error: toolUse.error,
    timestamp: Date.now(),
  };
}

// Unused function - images are extracted by UI components directly
// function extractImagesFromContent(
//   content: any[]
// ): Array<{ base64: string; mediaType: string }> {
//   if (!Array.isArray(content)) return [];
//   return content
//     .filter((block) => block.type === 'image')
//     .map((block) => ({
//       base64: block.source?.data || '',
//       mediaType: block.source?.media_type || 'image/png',
//     }))
//     .filter((img) => img.base64);
// }

// ─────────────────────────────────────────────────────────────────────────────
// Stream Lifecycle Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determines if an agent should be marked as actively streaming based on the event.
 *
 * @param event The agent stream event
 * @returns true if the agent is actively processing/streaming
 */
export function isActiveStreamingEvent(event: AgentStreamEvent): boolean {
  // Agent is active if:
  // - It has reasoning text (thinking)
  // - It has current tool use (executing a tool)
  // - It's generating content (has data)
  return !!(
    event.reasoningText ||
    event.current_tool_use ||
    typeof event.data === 'string'
  );
}

/**
 * Determines if an event signals the end of agent streaming.
 *
 * @param event The agent stream event
 * @returns true if the agent has finished streaming
 */
export function isStreamCompleteEvent(event: AgentStreamEvent): boolean {
  return event.complete || (event.result?.stop_reason === 'end_turn');
}
