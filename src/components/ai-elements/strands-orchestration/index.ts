/**
 * Strands Orchestration Components
 * 
 * A comprehensive component library for visualizing Strands framework
 * orchestration patterns on AI Elements canvas.
 * 
 * Patterns Supported:
 * - Graph: Deterministic, dependency-driven execution
 *   - Nodes execute when dependencies are satisfied
 *   - Edges can have conditional logic
 *   - Parallel batch execution visualization
 *   
 * - Swarm: Dynamic, agent-driven coordination
 *   - Agents use handoff_to_agent tool to transfer control
 *   - SharedContext for inter-agent communication
 *   - Agent history tracking
 * 
 * Components:
 * - StrandsGraph: Complete canvas for Graph pattern visualization
 * - StrandsSwarm: Complete canvas for Swarm pattern visualization
 * - GraphNodeComponent: React Flow node for Graph agents
 * - SwarmNodeComponent: React Flow node for Swarm agents
 * - GraphEdgeComponent: React Flow edge with conditions
 * - SwarmEdgeComponent: React Flow edge with handoff visualization
 * - EdgeMarkerDefinitions: SVG markers for edge arrows
 * 
 * Usage:
 * ```tsx
 * import { StrandsGraph, StrandsSwarm } from '@/components/ai-elements/strands-orchestration';
 * 
 * // Graph pattern visualization
 * <StrandsGraph
 *   initialState={graphState}
 *   onNodeClick={(node) => console.log(node)}
 *   showTimeline
 *   showStats
 *   showControls
 * />
 * 
 * // Swarm pattern visualization
 * <StrandsSwarm
 *   initialState={swarmState}
 *   onEvent={(event) => console.log(event)}
 *   showHistory
 *   showContext
 * />
 * ```
 * 
 * @see https://github.com/strands-agents/sdk-python for Strands SDK documentation
 */

// Types
export * from "./types";

// Node Components
export {
  StrandsNodeComponent,
  GraphNodeComponent,
  SwarmNodeComponent,
} from "./strands-node";

export {
  PromptNodeComponent,
  PromptNode,
  type PromptNodeData,
} from "./strands-prompt-node";

// Edge Components
export {
  GraphEdgeComponent,
  SwarmEdgeComponent,
  EdgeMarkerDefinitions,
  PendingEdge,
} from "./strands-edge";

// Canvas Components
export { StrandsGraph } from "./strands-graph";
export { StrandsSwarm } from "./strands-swarm";

// Example/Demo Component
export { StrandsWorkflowExample } from "./strands-workflow-example";

// Re-export for convenience
export type {
  // Agent types
  AgentStatus,
  AgentConfig,
  AgentResult,
  ModelProvider,
  
  // Graph types
  GraphNodeData,
  GraphEdgeData,
  GraphEdgeCondition,
  GraphState,
  StrandsGraphNode,
  StrandsGraphEdge,
  
  // Swarm types
  SwarmNodeData,
  SwarmEdgeData,
  SwarmState,
  StrandsSwarmNode,
  StrandsSwarmEdge,
  HandoffMessage,
  SharedContext,
  
  // Workflow types
  WorkflowTask,
  WorkflowTaskStatus,
  WorkflowState,
  
  // Events
  OrchestrationEvent,
  OrchestrationEventType,
  
  // Props
  StrandsCanvasProps,
  StrandsNodeProps,
  StrandsEdgeProps,
  StrandsControlsProps,
} from "./types";

