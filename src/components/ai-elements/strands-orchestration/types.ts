/**
 * Strands Orchestration Types
 * 
 * Type definitions for visualizing Strands framework orchestration patterns:
 * - Graph: Deterministic, dependency-driven execution
 * - Swarm: Dynamic, agent-driven coordination with handoffs
 * 
 * Based on Strands SDK multi-agent patterns:
 * @see https://github.com/strands-agents/sdk-python
 */

import type { Node, Edge } from "@xyflow/react";

// ─────────────────────────────────────────────────────────────────────────────
// Agent Types
// ─────────────────────────────────────────────────────────────────────────────

export type AgentStatus = 
  | "idle"        // Not yet started
  | "pending"     // Waiting for dependencies
  | "running"     // Currently executing
  | "completed"   // Finished successfully
  | "error"       // Failed execution
  | "handoff";    // Handing off to another agent (Swarm)

export type ModelProvider = 
  | "bedrock" 
  | "anthropic" 
  | "openai" 
  | "ollama" 
  | "github" 
  | "env" 
  | "parent";

export interface AgentConfig {
  id: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  modelProvider?: ModelProvider;
  modelId?: string;
  tools?: string[];
  priority?: 1 | 2 | 3 | 4 | 5;
  timeout?: number;
}

export interface AgentResult {
  status: "success" | "error";
  content: string;
  startedAt?: number;
  completedAt?: number;
  metrics?: {
    inputTokens?: number;
    outputTokens?: number;
    latencyMs?: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph Pattern Types
// ─────────────────────────────────────────────────────────────────────────────

export interface GraphNodeData {
  [key: string]: unknown;
  type: "graph-node";
  agent: AgentConfig;
  status: AgentStatus;
  result?: AgentResult;
  dependencies: string[];
  // Streaming data integration
  isActivelyStreaming?: boolean;
  streamingData?: {
    reasoning?: { content: string; duration?: number };
    chainOfThought?: unknown[]; // AIChainOfThoughtStep[] - avoid circular import
    tools?: unknown[]; // AIToolExecution[]
    images?: { base64: string; mediaType: string }[];
  };
}

export interface GraphEdgeCondition {
  id: string;
  label: string;
  expression?: string;
  isActive?: boolean;
}

export interface GraphEdgeData {
  [key: string]: unknown;
  type: "graph-edge";
  condition?: GraphEdgeCondition;
  isConditional: boolean;
  isActive: boolean;
  isAnimated?: boolean;
}

export type StrandsGraphNode = Node<GraphNodeData>;
export type StrandsGraphEdge = Edge<GraphEdgeData>;

export interface GraphState {
  id: string;
  status: "created" | "running" | "completed" | "error" | "paused";
  nodes: StrandsGraphNode[];
  edges: StrandsGraphEdge[];
  completedNodes: string[];
  failedNodes: string[];
  executionOrder: string[];
  startedAt?: number;
  completedAt?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Swarm Pattern Types
// ─────────────────────────────────────────────────────────────────────────────

export interface HandoffMessage {
  fromAgent: string;
  toAgent: string;
  message: string;
  context?: Record<string, unknown>;
  timestamp: number;
}

export interface SwarmNodeData {
  [key: string]: unknown;
  type: "swarm-node";
  agent: AgentConfig;
  status: AgentStatus;
  result?: AgentResult;
  isEntryPoint?: boolean;
  canHandoffTo?: string[];
  // Streaming data integration
  isActivelyStreaming?: boolean;
  streamingData?: {
    reasoning?: { content: string; duration?: number };
    chainOfThought?: unknown[]; // AIChainOfThoughtStep[]
    tools?: unknown[]; // AIToolExecution[]
    images?: { base64: string; mediaType: string }[];
  };
}

export interface SwarmEdgeData {
  [key: string]: unknown;
  type: "swarm-edge";
  handoffMessage?: string;
  isActive: boolean;
  isAnimated?: boolean;
}

export type StrandsSwarmNode = Node<SwarmNodeData>;
export type StrandsSwarmEdge = Edge<SwarmEdgeData>;

export interface SharedContext {
  [nodeId: string]: Record<string, unknown>;
}

export interface SwarmState {
  id: string;
  status: "created" | "running" | "completed" | "error";
  currentNode: string | null;
  nodes: StrandsSwarmNode[];
  edges: StrandsSwarmEdge[];
  nodeHistory: string[];
  handoffs: HandoffMessage[];
  sharedContext: SharedContext;
  maxHandoffs: number;
  handoffCount: number;
  startedAt?: number;
  completedAt?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Pattern Types (Composite)
// ─────────────────────────────────────────────────────────────────────────────

export type WorkflowTaskStatus = 
  | "pending" 
  | "running" 
  | "completed" 
  | "error" 
  | "cancelled";

export interface WorkflowTask {
  taskId: string;
  description: string;
  dependencies: string[];
  tools?: string[];
  modelProvider?: ModelProvider;
  modelSettings?: Record<string, unknown>;
  systemPrompt?: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  timeout?: number;
  status: WorkflowTaskStatus;
  result?: AgentResult;
  // Streaming data integration
  isActivelyStreaming?: boolean;
  streamingData?: {
    reasoning?: { content: string; duration?: number };
    chainOfThought?: unknown[]; // AIChainOfThoughtStep[]
    tools?: unknown[]; // AIToolExecution[]
    images?: { base64: string; mediaType: string }[];
  };
}

export interface WorkflowState {
  workflowId: string;
  status: "created" | "running" | "completed" | "error";
  tasks: WorkflowTask[];
  parallelExecution: boolean;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestration Events
// ─────────────────────────────────────────────────────────────────────────────

export type OrchestrationEventType =
  | "node-started"
  | "node-completed"
  | "node-error"
  | "edge-activated"
  | "edge-deactivated"
  | "handoff-initiated"
  | "handoff-completed"
  | "context-updated"
  | "workflow-started"
  | "workflow-completed"
  | "workflow-error";

export interface OrchestrationEvent {
  type: OrchestrationEventType;
  nodeId?: string;
  edgeId?: string;
  timestamp: number;
  data?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component Props Types
// ─────────────────────────────────────────────────────────────────────────────

export interface StrandsCanvasProps {
  className?: string;
  onNodeClick?: (node: StrandsGraphNode | StrandsSwarmNode) => void;
  onEdgeClick?: (edge: StrandsGraphEdge | StrandsSwarmEdge) => void;
}

export interface StrandsNodeProps {
  agent: AgentConfig;
  status: AgentStatus;
  result?: AgentResult;
  isSelected?: boolean;
  isHighlighted?: boolean;
  showDetails?: boolean;
  onExpand?: () => void;
}

export interface StrandsEdgeProps {
  isConditional?: boolean;
  condition?: GraphEdgeCondition;
  isActive?: boolean;
  isAnimated?: boolean;
  handoffMessage?: string;
}

export interface StrandsControlsProps {
  onPlay?: () => void;
  onPause?: () => void;
  onReset?: () => void;
  onStepForward?: () => void;
  isRunning?: boolean;
  isPaused?: boolean;
  className?: string;
}

