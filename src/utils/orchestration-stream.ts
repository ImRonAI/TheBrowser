import { useOrchestrationStore } from "@/stores/orchestrationStore";
import type {
  AgentConfig,
  AgentResult,
  AgentStatus,
  GraphState,
  StrandsGraphEdge,
  StrandsGraphNode,
  StrandsSwarmEdge,
  StrandsSwarmNode,
  SwarmState,
  WorkflowState,
  WorkflowTask,
} from "@/components/ai-elements/strands-orchestration/types";
import type {
  AgentStreamingData,
  AIChainOfThoughtStep,
  AIToolExecution,
} from "@/stores/orchestrationStore";

export type OrchestrationStreamEvent = {
  eventType?: string;
  type?: string;
  toolName?: string;
  toolCallId?: string;
  nodes?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
  activeAgents?: Array<Record<string, unknown>>;
  title?: string;
  node_id?: string;
  nodeId?: string;
  node_type?: string;
  nodeType?: string;
  event?: Record<string, unknown>;
  node_result?: Record<string, unknown>;
  result?: Record<string, unknown>;
  from_node_ids?: string[];
  to_node_ids?: string[];
  message?: string;
};

type OrchestrationDataPart = {
  type: string;
  data?: OrchestrationStreamEvent;
};

const ORCHESTRATION_TOOLS = ["workflow", "swarm", "graph"];

export function handleOrchestrationDataPart(part: OrchestrationDataPart) {
  if (!part || part.type !== "data-orchestration" || !part.data) return;
  applyOrchestrationEvent(part.data);
}

export function initOrchestrationFromToolInput(
  toolName: string,
  input: unknown,
): boolean {
  const normalizedTool = normalizeToolName(toolName);
  if (!ORCHESTRATION_TOOLS.includes(normalizedTool)) return false;

  const payload = parseInput(input);
  if (!payload) return false;

  const store = useOrchestrationStore.getState();

  if (normalizedTool === "workflow") {
    const state = buildWorkflowState(payload);
    if (!state) return false;
    store.initWorkflowOrchestration(state);
    return true;
  }

  if (normalizedTool === "swarm") {
    const state = buildSwarmState(payload);
    if (!state) return false;
    store.initSwarmOrchestration(state);
    return true;
  }

  if (normalizedTool === "graph") {
    const state = buildGraphState(payload);
    if (!state) return false;
    store.initGraphOrchestration(state);
    return true;
  }

  return false;
}

function applyOrchestrationEvent(event: OrchestrationStreamEvent) {
  const eventType = event.eventType || event.type;
  if (!eventType) return;

  switch (eventType) {
    case "workflow_visualization":
      applyVisualizationSnapshot(event);
      break;
    case "multiagent_node_start":
      handleNodeStart(event);
      break;
    case "multiagent_node_stream":
      handleNodeStream(event);
      break;
    case "multiagent_node_stop":
      handleNodeStop(event);
      break;
    case "multiagent_handoff":
      handleHandoff(event);
      break;
    case "multiagent_result":
      handleResult(event);
      break;
    default:
      break;
  }
}

function applyVisualizationSnapshot(event: OrchestrationStreamEvent) {
  const toolName = normalizeToolName(event.toolName || "");
  const store = useOrchestrationStore.getState();

  if (toolName === "workflow") {
    const state = buildWorkflowStateFromVisualization(event);
    if (state) {
      store.initWorkflowOrchestration(state);
    }
  } else if (toolName === "swarm") {
    const state = buildSwarmStateFromVisualization(event);
    if (state) {
      store.initSwarmOrchestration(state);
    }
  } else if (toolName === "graph") {
    const state = buildGraphStateFromVisualization(event);
    if (state) {
      store.initGraphOrchestration(state);
    }
  }

  if (event.activeAgents && event.activeAgents.length > 0) {
    const ids = event.activeAgents
      .map((agent) => String(agent.id || agent.name || ""))
      .filter(Boolean);
    if (ids.length > 0) {
      store.setActiveAgents(ids);
    }
  }

  if (event.activeAgents) {
    event.activeAgents.forEach((agent) => {
      const agentId = String(agent.id || agent.name || "");
      // Cast to expected structure with chainOfThought
      const agentData = agent as { chainOfThought?: { steps?: AIChainOfThoughtStep[] } };
      const steps = agentData.chainOfThought?.steps;
      if (agentId && steps && steps.length > 0) {
        store.syncStreamingData(agentId, { chainOfThought: steps });
      }
    });
  }
}

function handleNodeStart(event: OrchestrationStreamEvent) {
  const store = useOrchestrationStore.getState();
  const nodeId = normalizeNodeId(event);
  if (!nodeId) return;

  const active = store.activeAgentIds;
  if (!active.includes(nodeId)) {
    store.setActiveAgents([...active, nodeId]);
  }

  store.updateNodeStatus(nodeId, "running");
}

function handleNodeStream(event: OrchestrationStreamEvent) {
  const nodeId = normalizeNodeId(event);
  if (!nodeId || !event.event) return;

  const streamEvent = event.event as Record<string, unknown>;
  const store = useOrchestrationStore.getState();
  const existing = store.agentStreamingData.get(nodeId);
  const update: AgentStreamingData = {};

  const reasoningText = streamEvent.reasoningText as string | undefined;
  if (reasoningText) {
    const current = existing?.reasoning?.content || "";
    const content = `${current}${reasoningText}`;
    update.reasoning = { content };
    update.chainOfThought = upsertReasoningStep(
      existing?.chainOfThought || [],
      content,
      "running",
    );
  }

  const dataText = streamEvent.data as string | undefined;
  if (dataText) {
    const current = existing?.output || "";
    update.output = `${current}${dataText}`;
  }

  const toolUse = (streamEvent.current_tool_use || streamEvent.currentToolUse) as
    | Record<string, unknown>
    | undefined;
  if (toolUse) {
    const toolUpdate = buildToolUpdate(toolUse, "running");
    if (toolUpdate) {
      update.tools = [toolUpdate];
    }
  }

  const toolStream = streamEvent.tool_stream_event as Record<string, unknown> | undefined;
  if (toolStream) {
    const toolUpdate = buildToolStreamUpdate(toolStream);
    if (toolUpdate) {
      update.tools = [...(update.tools || []), toolUpdate];
    }
  }

  const toolResult = streamEvent.tool_result as Record<string, unknown> | undefined;
  if (toolResult) {
    const toolUpdate = buildToolResultUpdate(toolResult);
    if (toolUpdate) {
      update.tools = [...(update.tools || []), toolUpdate];
    }
  }

  if (Object.keys(update).length > 0) {
    store.syncStreamingData(nodeId, update);
  }
}

function handleNodeStop(event: OrchestrationStreamEvent) {
  const store = useOrchestrationStore.getState();
  const nodeId = normalizeNodeId(event);
  if (!nodeId) return;

  const active = store.activeAgentIds.filter((id) => id !== nodeId);
  store.setActiveAgents(active);

  const result = normalizeNodeResult(event.node_result || event.result);
  if (result) {
    store.setNodeResult(nodeId, result);
    store.updateNodeStatus(nodeId, result.status === "error" ? "error" : "completed");
  } else {
    store.updateNodeStatus(nodeId, "completed");
  }

  const existing = store.agentStreamingData.get(nodeId);
  if (existing?.chainOfThought && existing.chainOfThought.length > 0) {
    const completedSteps = existing.chainOfThought.map((step) => ({
      ...step,
      status: step.status === "running" ? "success" : step.status,
    }));
    store.syncStreamingData(nodeId, { chainOfThought: completedSteps });
  }
}

function handleHandoff(event: OrchestrationStreamEvent) {
  const store = useOrchestrationStore.getState();
  const fromAgent = event.from_node_ids?.[0] || "unknown";
  const toAgent = event.to_node_ids?.[0] || "unknown";
  store.addHandoff({
    fromAgent,
    toAgent,
    message: event.message || "Handoff",
    timestamp: Date.now(),
  });
}

function handleResult(event: OrchestrationStreamEvent) {
  const store = useOrchestrationStore.getState();
  if (store.activeAgentIds.length > 0) {
    store.setActiveAgents([]);
  }
  if (event.result) {
    const result = normalizeNodeResult(event.result);
    if (result && store.currentExecutionType === "workflow") {
      // Apply to the last running workflow task if available
      const lastTask = store.workflowTasks.find((task) => task.status === "running");
      if (lastTask) {
        store.setNodeResult(lastTask.taskId, result);
        store.updateNodeStatus(lastTask.taskId, result.status === "error" ? "error" : "completed");
      }
    }
  }
}

function parseInput(input: unknown): Record<string, unknown> | null {
  if (!input) return null;
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (typeof input === "object") {
    return input as Record<string, unknown>;
  }
  return null;
}

function buildWorkflowState(input: Record<string, unknown>): WorkflowState | null {
  const tasks = Array.isArray(input.tasks) ? (input.tasks as WorkflowTask[]) : [];
  if (tasks.length === 0) return null;

  const workflowId = String(input.workflow_id || input.workflowId || `workflow-${Date.now()}`);
  const normalizedTasks = tasks.map((task, index) => {
    // Cast task to Record<string, unknown> to access potential snake_case properties from backend
    const rawTask = task as unknown as Record<string, unknown>;
    return {
      taskId: String(rawTask.task_id || rawTask.taskId || `task-${index + 1}`),
      description: String(rawTask.description || rawTask.task_prompt || "Task"),
      dependencies: Array.isArray(rawTask.dependencies) ? rawTask.dependencies : [],
      tools: Array.isArray(rawTask.tools) ? rawTask.tools : undefined,
      modelProvider: rawTask.model_provider || rawTask.modelProvider,
      modelSettings: rawTask.model_settings || rawTask.modelSettings,
      systemPrompt: rawTask.system_prompt || rawTask.systemPrompt,
      priority: rawTask.priority,
      timeout: rawTask.timeout,
      status: "pending",
    };
  }) as WorkflowTask[];

  return {
    workflowId,
    status: "created",
    tasks: normalizedTasks,
    parallelExecution: normalizedTasks.length > 1,
    createdAt: Date.now(),
  };
}

function buildSwarmState(input: Record<string, unknown>): SwarmState | null {
  const agents = Array.isArray(input.agents) ? (input.agents as Record<string, unknown>[]) : [];
  if (agents.length === 0) return null;

  const nodes = agents.map((agent, index) => {
    const agentId = String(agent.name || agent.id || `agent-${index + 1}`);
    const agentConfig: AgentConfig = {
      id: agentId,
      name: agentId,
      description: agent.description as string | undefined,
      systemPrompt: agent.system_prompt as string | undefined,
      modelProvider: agent.model_provider as AgentConfig["modelProvider"],
      modelId: (agent.model_settings as Record<string, unknown> | undefined)?.model_id as string | undefined,
      tools: Array.isArray(agent.tools) ? (agent.tools as string[]) : undefined,
      priority: agent.priority as AgentConfig["priority"],
      timeout: agent.timeout as number | undefined,
    };

    return {
      id: agentId,
      type: "swarm-node",
      position: { x: 0, y: 0 },
      data: {
        type: "swarm-node",
        agent: agentConfig,
        status: "idle",
        isEntryPoint: index === 0,
        canHandoffTo: agents.map((a) => String(a.name || a.id)).filter((id) => id !== agentId),
      },
    } as StrandsSwarmNode;
  });

  return {
    id: String(input.swarm_id || input.swarmId || `swarm-${Date.now()}`),
    status: "created",
    currentNode: null,
    nodes,
    edges: [] as StrandsSwarmEdge[],
    nodeHistory: [],
    handoffs: [],
    sharedContext: {},
    maxHandoffs: Number(input.max_handoffs || input.maxHandoffs || 20),
    handoffCount: 0,
    startedAt: undefined,
  };
}

function buildGraphState(input: Record<string, unknown>): GraphState | null {
  const topology = input.topology as Record<string, unknown> | undefined;
  if (!topology || !Array.isArray(topology.nodes)) return null;

  const nodeSpecs = topology.nodes as Record<string, unknown>[];
  const edgeSpecs = Array.isArray(topology.edges) ? (topology.edges as Record<string, unknown>[]) : [];
  const entryPoints = Array.isArray(topology.entry_points)
    ? (topology.entry_points as string[])
    : [];

  const dependenciesByNode = new Map<string, string[]>();
  edgeSpecs.forEach((edge) => {
    const from = String(edge.from || "");
    const to = String(edge.to || "");
    if (!from || !to) return;
    const current = dependenciesByNode.get(to) || [];
    dependenciesByNode.set(to, [...current, from]);
  });

  const nodes = nodeSpecs.map((node, index) => {
    const nodeId = String(node.id || node.node_id || `node-${index + 1}`);
    const role = String(node.role || node.name || nodeId);
    const agentConfig: AgentConfig = {
      id: nodeId,
      name: role,
      description: node.description as string | undefined,
      systemPrompt: node.system_prompt as string | undefined,
      modelProvider: node.model_provider as AgentConfig["modelProvider"],
      modelId: (node.model_settings as Record<string, unknown> | undefined)?.model_id as string | undefined,
      tools: Array.isArray(node.tools) ? (node.tools as string[]) : undefined,
      priority: node.priority as AgentConfig["priority"],
      timeout: node.timeout as number | undefined,
    };

    return {
      id: nodeId,
      type: "graph-node",
      position: { x: 0, y: 0 },
      data: {
        type: "graph-node",
        agent: agentConfig,
        status: "pending",
        dependencies: dependenciesByNode.get(nodeId) || [],
        isEntryPoint: entryPoints.includes(nodeId),
      },
    } as StrandsGraphNode;
  });

  const edges = edgeSpecs.map((edge) => {
    const from = String(edge.from || "");
    const to = String(edge.to || "");
    return {
      id: `${from}-${to}`,
      source: from,
      target: to,
      type: "graph-edge",
      data: {
        type: "graph-edge",
        isConditional: false,
        isActive: false,
      },
    } as StrandsGraphEdge;
  });

  return {
    id: String(input.graph_id || input.graphId || `graph-${Date.now()}`),
    status: "created",
    nodes,
    edges,
    completedNodes: [],
    failedNodes: [],
    executionOrder: [],
    startedAt: Date.now(),
  };
}

function buildWorkflowStateFromVisualization(event: OrchestrationStreamEvent): WorkflowState | null {
  if (!event.nodes || event.nodes.length === 0) return null;

  const tasks = event.nodes.map((node, index) => {
    const data = (node.data || {}) as Record<string, unknown>;
    return {
      taskId: String(node.id || `task-${index + 1}`),
      description: String(data.label || data.description || "Task"),
      dependencies: [],
      status: mapStatus(String(data.status || "pending")) as WorkflowTask["status"],
    };
  }) as WorkflowTask[];

  return {
    workflowId: `workflow-${Date.now()}`,
    status: "running",
    tasks,
    parallelExecution: tasks.length > 1,
    createdAt: Date.now(),
  };
}

function buildSwarmStateFromVisualization(event: OrchestrationStreamEvent): SwarmState | null {
  if (!event.nodes || event.nodes.length === 0) return null;
  const nodes = event.nodes.map((node) => {
    const data = (node.data || {}) as Record<string, unknown>;
    const agentId = String(node.id);
    const agent: AgentConfig = {
      id: agentId,
      name: String(data.label || agentId),
    };
    return {
      id: agentId,
      type: "swarm-node",
      position: node.position as { x: number; y: number },
      data: {
        type: "swarm-node",
        agent,
        status: mapStatus(String(data.status || "pending")) as AgentStatus,
      },
    } as StrandsSwarmNode;
  });

  return {
    id: `swarm-${Date.now()}`,
    status: "running",
    currentNode: null,
    nodes,
    edges: [] as StrandsSwarmEdge[],
    nodeHistory: [],
    handoffs: [],
    sharedContext: {},
    maxHandoffs: 20,
    handoffCount: 0,
  };
}

function buildGraphStateFromVisualization(event: OrchestrationStreamEvent): GraphState | null {
  if (!event.nodes || event.nodes.length === 0) return null;

  const nodes = event.nodes.map((node) => {
    const data = (node.data || {}) as Record<string, unknown>;
    const agentId = String(node.id);
    const agent: AgentConfig = {
      id: agentId,
      name: String(data.label || agentId),
    };
    return {
      id: agentId,
      type: "graph-node",
      position: node.position as { x: number; y: number },
      data: {
        type: "graph-node",
        agent,
        status: mapStatus(String(data.status || "pending")) as AgentStatus,
        dependencies: [],
      },
    } as StrandsGraphNode;
  });

  const edges = (event.edges || []).map((edge) => ({
    id: String(edge.id || `${edge.source}-${edge.target}`),
    source: String(edge.source || ""),
    target: String(edge.target || ""),
    type: "graph-edge",
    data: {
      type: "graph-edge",
      isConditional: false,
      isActive: Boolean(edge.animated),
    },
  })) as StrandsGraphEdge[];

  return {
    id: `graph-${Date.now()}`,
    status: "running",
    nodes,
    edges,
    completedNodes: [],
    failedNodes: [],
    executionOrder: [],
    startedAt: Date.now(),
  };
}

function mapStatus(status: string): AgentStatus {
  if (status === "complete" || status === "completed") return "completed";
  if (status === "error" || status === "failed") return "error";
  if (status === "running") return "running";
  if (status === "handoff") return "handoff";
  return "pending";
}

function normalizeNodeId(event: OrchestrationStreamEvent): string | null {
  return (event.nodeId || event.node_id || null) as string | null;
}

function normalizeToolName(toolName: string): string {
  const normalized = toolName.toLowerCase().trim();
  if (!normalized) return "";
  const parts = normalized.split(/[./:\\\s-]+/g).filter(Boolean);
  const match = parts.find((part) => ORCHESTRATION_TOOLS.includes(part));
  return match || parts[parts.length - 1] || normalized;
}

function buildToolUpdate(toolUse: Record<string, unknown>, status: AIToolExecution["status"]) {
  const id = String(toolUse.toolUseId || toolUse.id || toolUse.tool_use_id || "");
  if (!id) return null;
  return {
    id,
    name: String(toolUse.name || toolUse.tool_name || "tool"),
    status,
    input: toolUse.input as Record<string, unknown> | undefined,
    timestamp: Date.now(),
  } satisfies AIToolExecution;
}

function buildToolStreamUpdate(toolStream: Record<string, unknown>) {
  const toolUse = toolStream.tool_use as Record<string, unknown> | undefined;
  if (!toolUse) return null;
  const id = String(toolUse.toolUseId || toolUse.id || toolUse.tool_use_id || "");
  if (!id) return null;
  const outputPayload =
    toolStream.data ??
    toolStream.output ??
    toolStream.result ??
    toolStream.content;
  return {
    id,
    name: String(toolUse.name || toolUse.tool_name || "tool"),
    status: "running",
    output: stringifyToolOutput(outputPayload),
    timestamp: Date.now(),
  } satisfies AIToolExecution;
}

function buildToolResultUpdate(toolResult: Record<string, unknown>) {
  const id = String(toolResult.toolUseId || toolResult.id || toolResult.tool_use_id || "");
  if (!id) return null;
  const status = toolResult.status === "error" ? "error" : "success";
  const outputPayload =
    toolResult.content ??
    toolResult.output ??
    toolResult.result ??
    toolResult.data;
  return {
    id,
    name: String(toolResult.name || toolResult.tool_name || "tool"),
    status,
    output: stringifyToolOutput(outputPayload),
    error: toolResult.error as string | undefined,
    timestamp: Date.now(),
  } satisfies AIToolExecution;
}

function stringifyToolOutput(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  if (output == null) return undefined;
  if (Array.isArray(output)) {
    const textParts = output
      .map((item) => (item as { text?: string } | undefined)?.text)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (textParts.length > 0) {
      return textParts.join("\n");
    }
  }
  if (typeof output === "object") {
    const record = output as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.output === "string") return record.output;
    if (typeof record.result === "string") return record.result;
    if (typeof record.data === "string") return record.data;
  }
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

function normalizeNodeResult(result: Record<string, unknown> | undefined): AgentResult | null {
  if (!result) return null;
  const status =
    result.status === "error" ||
    result.status === "failed" ||
    result.status === "FAILED"
      ? "error"
      : "success";
  const content = extractResultText(result);
  return {
    status,
    content,
    startedAt: result.startedAt as number | undefined,
    completedAt: result.completedAt as number | undefined,
    metrics: result.metrics as AgentResult["metrics"] | undefined,
  };
}

function extractResultText(result: Record<string, unknown>): string {
  const nestedResult = result.result as Record<string, unknown> | undefined;
  if (nestedResult) {
    const message = nestedResult.message as Record<string, unknown> | undefined;
    const messageContent = message?.content as Array<Record<string, unknown>> | undefined;
    if (messageContent && messageContent.length > 0) {
      const first = messageContent[0];
      if (typeof first.text === "string") return first.text;
      if (typeof first === "string") return first;
    }
    if (typeof nestedResult.text === "string") return nestedResult.text;
  }

  const content = result.content as Array<Record<string, unknown>> | undefined;
  if (content && content.length > 0) {
    const first = content[0];
    if (typeof first.text === "string") return first.text;
    if (typeof first === "string") return first;
  }
  if (typeof result.text === "string") return result.text;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function upsertReasoningStep(
  steps: AIChainOfThoughtStep[],
  content: string,
  status: AIChainOfThoughtStep["status"],
): AIChainOfThoughtStep[] {
  const existingIndex = steps.findIndex((step) => step.label === "Reasoning");
  const nextStep: AIChainOfThoughtStep = {
    label: "Reasoning",
    description: content,
    status,
  };

  if (existingIndex === -1) {
    return [...steps, nextStep];
  }

  return steps.map((step, index) => (index === existingIndex ? nextStep : step));
}
