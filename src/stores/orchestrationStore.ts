/**
 * Orchestration Store
 *
 * Manages state for multi-agent orchestration visualization across three modes:
 * - Graph: Deterministic dependency-driven execution
 * - Workflow: Sequential linear execution
 * - Swarm: Dynamic handoff-based execution
 *
 * Synchronizes with agent streaming events to update node states in real-time.
 */

import { create } from 'zustand';
import type {
  AgentResult,
  GraphState,
  WorkflowState,
  SwarmState,
  StrandsGraphNode,
  StrandsGraphEdge,
  StrandsSwarmNode,
  StrandsSwarmEdge,
  WorkflowTask,
  HandoffMessage,
  AgentStatus,
} from '@/components/ai-elements/strands-orchestration/types';

// ─────────────────────────────────────────────────────────────────────────────
// Streaming Data Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AIChainOfThoughtStep {
  label: string;
  description?: string;
  status: 'pending' | 'running' | 'success' | 'error';
  duration?: number;
}

export interface AIToolExecution {
  id: string;
  name: string;
  status: 'running' | 'success' | 'error';
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  timestamp?: number;
}

export interface AgentStreamingData {
  reasoning?: {
    content: string;
    duration?: number;
  };
  chainOfThought?: AIChainOfThoughtStep[];
  tools?: AIToolExecution[];
  images?: {
    base64: string;
    mediaType: string;
  }[];
  output?: string;
}

export interface CompletedNodeOutput {
  status: "success" | "error";
  content: string;
  duration?: number;
  tokenUsage: {
    input?: number;
    output?: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Store State Interface
// ─────────────────────────────────────────────────────────────────────────────

interface OrchestrationStoreState {
  // ─── Graph Orchestration ───
  graphState: GraphState | null;
  graphNodes: StrandsGraphNode[];
  graphEdges: StrandsGraphEdge[];

  // ─── Workflow Orchestration ───
  workflowState: WorkflowState | null;
  workflowTasks: WorkflowTask[];

  // ─── Swarm Orchestration ───
  swarmState: SwarmState | null;
  swarmNodes: StrandsSwarmNode[];
  swarmEdges: StrandsSwarmEdge[];
  swarmHandoffs: HandoffMessage[];

  // ─── Active Execution Tracking ───
  activeAgentIds: string[]; // Can have multiple in swarm mode
  currentExecutionType: 'graph' | 'workflow' | 'swarm' | null;

  // ─── Streaming Integration (synced from agent stream events) ───
  agentStreamingData: Map<string, AgentStreamingData>;

  // ─── Initialization Actions ───
  initGraphOrchestration: (state: GraphState) => void;
  initWorkflowOrchestration: (state: WorkflowState) => void;
  initSwarmOrchestration: (state: SwarmState) => void;

  // ─── State Update Actions ───
  updateNodeStatus: (nodeId: string, status: AgentStatus) => void;
  setNodeResult: (nodeId: string, result: AgentResult) => void;
  setActiveAgents: (agentIds: string[]) => void;
  addHandoff: (handoff: HandoffMessage) => void;

  // ─── Streaming Data Sync (called from stream listeners) ───
  syncStreamingData: (agentId: string, data: AgentStreamingData) => void;
  clearStreamingData: (agentId: string) => void;

  // ─── Reset ───
  reset: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Initial State
// ─────────────────────────────────────────────────────────────────────────────

const initialState = {
  // Graph
  graphState: null,
  graphNodes: [],
  graphEdges: [],

  // Workflow
  workflowState: null,
  workflowTasks: [],

  // Swarm
  swarmState: null,
  swarmNodes: [],
  swarmEdges: [],
  swarmHandoffs: [],

  // Execution
  activeAgentIds: [],
  currentExecutionType: null,

  // Streaming
  agentStreamingData: new Map<string, AgentStreamingData>(),
};

// ─────────────────────────────────────────────────────────────────────────────
// Store Implementation
// ─────────────────────────────────────────────────────────────────────────────

export const useOrchestrationStore = create<OrchestrationStoreState>()((set, get) => ({
  ...initialState,

  // ─── Graph Orchestration Initialization ───
  initGraphOrchestration: (state: GraphState) => {
    set({
      graphState: state,
      graphNodes: state.nodes,
      graphEdges: state.edges,
      currentExecutionType: 'graph',
      // Clear other modes
      workflowState: null,
      workflowTasks: [],
      swarmState: null,
      swarmNodes: [],
      swarmEdges: [],
      swarmHandoffs: [],
    });
  },

  // ─── Workflow Orchestration Initialization ───
  initWorkflowOrchestration: (state: WorkflowState) => {
    set({
      workflowState: state,
      workflowTasks: state.tasks,
      currentExecutionType: 'workflow',
      // Clear other modes
      graphState: null,
      graphNodes: [],
      graphEdges: [],
      swarmState: null,
      swarmNodes: [],
      swarmEdges: [],
      swarmHandoffs: [],
    });
  },

  // ─── Swarm Orchestration Initialization ───
  initSwarmOrchestration: (state: SwarmState) => {
    set({
      swarmState: state,
      swarmNodes: state.nodes,
      swarmEdges: state.edges,
      swarmHandoffs: state.handoffs,
      currentExecutionType: 'swarm',
      // Clear other modes
      graphState: null,
      graphNodes: [],
      graphEdges: [],
      workflowState: null,
      workflowTasks: [],
    });
  },

  // ─── Update Node Status ───
  updateNodeStatus: (nodeId: string, status: AgentStatus) => {
    const { currentExecutionType } = get();

    if (currentExecutionType === 'graph') {
      set((state) => ({
        graphNodes: state.graphNodes.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, status } }
            : node
        ),
        graphState: state.graphState
          ? {
              ...state.graphState,
              nodes: state.graphNodes.map((node) =>
                node.id === nodeId
                  ? { ...node, data: { ...node.data, status } }
                  : node
              ),
            }
          : null,
      }));
    } else if (currentExecutionType === 'swarm') {
      set((state) => ({
        swarmNodes: state.swarmNodes.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, status } }
            : node
        ),
        swarmState: state.swarmState
          ? {
              ...state.swarmState,
              nodes: state.swarmNodes.map((node) =>
                node.id === nodeId
                  ? { ...node, data: { ...node.data, status } }
                  : node
              ),
            }
          : null,
      }));
    } else if (currentExecutionType === 'workflow') {
      set((state) => ({
        workflowTasks: state.workflowTasks.map((task) =>
          task.taskId === nodeId
            ? { ...task, status: status as WorkflowTask['status'] }
            : task
        ),
        workflowState: state.workflowState
          ? {
              ...state.workflowState,
              tasks: state.workflowTasks.map((task) =>
                task.taskId === nodeId
                  ? { ...task, status: status as WorkflowTask['status'] }
                  : task
              ),
            }
          : null,
      }));
    }
  },

  // ─── Set Node Result ───
  setNodeResult: (nodeId: string, result: AgentResult) => {
    const { currentExecutionType } = get();

    if (currentExecutionType === 'graph') {
      set((state) => ({
        graphNodes: state.graphNodes.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, result } }
            : node
        ),
        graphState: state.graphState
          ? {
              ...state.graphState,
              nodes: state.graphNodes.map((node) =>
                node.id === nodeId
                  ? { ...node, data: { ...node.data, result } }
                  : node
              ),
            }
          : null,
      }));
    } else if (currentExecutionType === 'swarm') {
      set((state) => ({
        swarmNodes: state.swarmNodes.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, result } }
            : node
        ),
        swarmState: state.swarmState
          ? {
              ...state.swarmState,
              nodes: state.swarmNodes.map((node) =>
                node.id === nodeId
                  ? { ...node, data: { ...node.data, result } }
                  : node
              ),
            }
          : null,
      }));
    } else if (currentExecutionType === 'workflow') {
      set((state) => ({
        workflowTasks: state.workflowTasks.map((task) =>
          task.taskId === nodeId
            ? { ...task, result }
            : task
        ),
        workflowState: state.workflowState
          ? {
              ...state.workflowState,
              tasks: state.workflowTasks.map((task) =>
                task.taskId === nodeId
                  ? { ...task, result }
                  : task
              ),
            }
          : null,
      }));
    }
  },

  // ─── Set Active Agents ───
  setActiveAgents: (agentIds: string[]) => {
    set({ activeAgentIds: agentIds });
  },

  // ─── Add Handoff (Swarm mode) ───
  addHandoff: (handoff: HandoffMessage) => {
    set((state) => ({
      swarmHandoffs: [...state.swarmHandoffs, handoff],
      swarmState: state.swarmState
        ? {
            ...state.swarmState,
            handoffs: [...state.swarmHandoffs, handoff],
            handoffCount: state.swarmState.handoffCount + 1,
          }
        : null,
    }));
  },

  // ─── Sync Streaming Data ───
  syncStreamingData: (agentId: string, data: AgentStreamingData) => {
    set((state) => {
      const newMap = new Map(state.agentStreamingData);
      const existing = newMap.get(agentId);
      const existingTools = existing?.tools || [];
      const incomingTools = data.tools || [];
      const mergedTools = (() => {
        if (incomingTools.length === 0) return existingTools;
        const toolMap = new Map(existingTools.map((tool) => [tool.id, tool]));
        incomingTools.forEach((tool) => {
          const prev = toolMap.get(tool.id);
          toolMap.set(tool.id, { ...prev, ...tool });
        });
        return Array.from(toolMap.values());
      })();

      // Merge new data with existing
      newMap.set(agentId, {
        reasoning: data.reasoning || existing?.reasoning,
        chainOfThought: data.chainOfThought || existing?.chainOfThought,
        tools: mergedTools,
        images: data.images
          ? [...(existing?.images || []), ...data.images]
          : existing?.images,
        output: data.output ?? existing?.output,
      });

      return { agentStreamingData: newMap };
    });
  },

  // ─── Clear Streaming Data ───
  clearStreamingData: (agentId: string) => {
    set((state) => {
      const newMap = new Map(state.agentStreamingData);
      newMap.delete(agentId);
      return { agentStreamingData: newMap };
    });
  },

  // ─── Reset ───
  reset: () => {
    set(initialState);
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Selectors (for performance optimization)
// ─────────────────────────────────────────────────────────────────────────────

export const selectGraphState = (state: OrchestrationStoreState) => state.graphState;
export const selectWorkflowState = (state: OrchestrationStoreState) => state.workflowState;
export const selectSwarmState = (state: OrchestrationStoreState) => state.swarmState;
export const selectActiveAgents = (state: OrchestrationStoreState) => state.activeAgentIds;
export const selectStreamingData = (state: OrchestrationStoreState) => state.agentStreamingData;
