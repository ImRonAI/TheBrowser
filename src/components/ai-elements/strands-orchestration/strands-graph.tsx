/**
 * StrandsGraph Component
 * 
 * A complete canvas component for visualizing the Strands Graph orchestration pattern.
 * Displays deterministic, dependency-driven agent execution with:
 * - Nodes representing agents/nested orchestrators
 * - Edges with optional conditions
 * - Parallel batch execution visualization
 * - Real-time status updates
 * - Execution order tracking
 *
 * Ren styling: a transparent canvas themed by `.ron-workflow` (React Flow's own
 * variables mapped to Ren tokens per theme), ink dots, and floating panels on
 * `bg-popover` so Glass frosts them. Volt marks progress and the primary action.
 */

"use client";

import { cn } from "@/lib/utils";
import {
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  Panel,
  type OnConnect,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { motion } from "framer-motion";
import {
  Check,
  ChevronRight,
  ListOrdered,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  StepForward,
} from "lucide-react";
import { useCallback, useMemo, useState, memo } from "react";
import { GraphNodeComponent } from "./strands-node";
import { GraphEdgeComponent, EdgeMarkerDefinitions, PendingEdge } from "./strands-edge";
import type {
  GraphState,
  StrandsGraphNode,
  StrandsGraphEdge,
  OrchestrationEvent,
  AgentStatus,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Node & Edge Type Registries
// ─────────────────────────────────────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  "graph-node": GraphNodeComponent,
};

const edgeTypes: EdgeTypes = {
  "graph-edge": GraphEdgeComponent,
  "pending": PendingEdge,
};

// Floating canvas panels: frosted by Glass through `bg-popover`.
const PANEL_CLASS =
  "rounded-xl border border-surface-200 bg-popover text-ink shadow-float dark:border-surface-800 dark:text-ink-inverse";

const PANEL_LABEL =
  "font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted";

const CONTROL_BUTTON =
  "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-150 ease-out";

// ─────────────────────────────────────────────────────────────────────────────
// Execution Timeline Component
// ─────────────────────────────────────────────────────────────────────────────

interface ExecutionTimelineProps {
  executionOrder: string[];
  completedNodes: string[];
  currentNodes: string[];
  className?: string;
}

const ExecutionTimeline = memo(function ExecutionTimeline({
  executionOrder,
  completedNodes,
  currentNodes,
  className,
}: ExecutionTimelineProps) {
  if (executionOrder.length === 0) return null;

  return (
    <div className={cn(PANEL_CLASS, "max-w-[640px] px-3 py-2.5", className)}>
      <div className="mb-2 flex items-center gap-1.5">
        <ListOrdered className="h-3.5 w-3.5 text-ink-muted dark:text-ink-inverse-muted" />
        <span className={PANEL_LABEL}>
          Execution order
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {executionOrder.map((nodeId, index) => {
          const isCompleted = completedNodes.includes(nodeId);
          const isCurrent = currentNodes.includes(nodeId);

          return (
            <div key={nodeId} className="flex items-center gap-1">
              {index > 0 && (
                <ChevronRight className="h-3 w-3 text-surface-300 dark:text-surface-600" />
              )}
              <motion.span
                initial={{ opacity: 0, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-full px-2 font-mono text-[11px] font-medium",
                  isCompleted
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400"
                    : isCurrent
                    ? "bg-blurple-50 text-blurple-700 dark:bg-blurple-400/15 dark:text-blurple-200"
                    : "bg-surface-100 text-ink-secondary dark:bg-surface-800 dark:text-ink-inverse-secondary"
                )}
              >
                {isCompleted ? (
                  <Check className="h-3 w-3 shrink-0" />
                ) : isCurrent ? (
                  <LoaderCircle className="h-3 w-3 shrink-0 motion-safe:animate-spin" />
                ) : null}
                {nodeId}
              </motion.span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Graph Stats Component
// ─────────────────────────────────────────────────────────────────────────────

interface GraphStatsProps {
  state: GraphState;
  className?: string;
}

const GraphStats = memo(function GraphStats({ state, className }: GraphStatsProps) {
  const totalNodes = state.nodes.length;
  const completedCount = state.completedNodes.length;
  const failedCount = state.failedNodes.length;
  const pendingCount = totalNodes - completedCount - failedCount;
  const progress = totalNodes > 0 ? (completedCount / totalNodes) * 100 : 0;

  const statusLabel = {
    created: "Ready",
    running: "Running",
    completed: "Completed",
    error: "Failed",
    paused: "Paused",
  }[state.status];

  const statusColor = {
    created: "bg-surface-400 dark:bg-surface-500",
    running: "bg-blurple-600 dark:bg-blurple-400",
    completed: "bg-success",
    error: "bg-danger",
    paused: "bg-warning",
  }[state.status];

  return (
    <div className={cn(PANEL_CLASS, "min-w-[200px] p-3", className)}>
      {/* Status */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className={PANEL_LABEL}>Graph</span>
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", statusColor)} />
          <span className="text-[12px] font-semibold leading-none text-ink dark:text-ink-inverse">
            {statusLabel}
          </span>
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-3 h-1 overflow-hidden rounded-full bg-surface-100 dark:bg-surface-800">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5 }}
          className="h-full rounded-full bg-blurple-600 dark:bg-blurple-400"
        />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 divide-x divide-surface-200 text-center dark:divide-surface-800">
        <div className="px-1">
          <span className="block font-mono text-lg font-semibold leading-tight tabular-nums text-emerald-700 dark:text-emerald-400">
            {completedCount}
          </span>
          <span className={PANEL_LABEL}>Done</span>
        </div>
        <div className="px-1">
          <span className="block font-mono text-lg font-semibold leading-tight tabular-nums text-blurple-600 dark:text-blurple-300">
            {pendingCount}
          </span>
          <span className={PANEL_LABEL}>Pending</span>
        </div>
        <div className="px-1">
          <span className="block font-mono text-lg font-semibold leading-tight tabular-nums text-red-700 dark:text-red-400">
            {failedCount}
          </span>
          <span className={PANEL_LABEL}>Failed</span>
        </div>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Graph Controls Component
// ─────────────────────────────────────────────────────────────────────────────

interface GraphControlsProps {
  isRunning: boolean;
  isPaused: boolean;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  onStepForward: () => void;
  className?: string;
}

const GraphControls = memo(function GraphControls({
  isRunning,
  isPaused,
  onPlay,
  onPause,
  onReset,
  onStepForward,
  className,
}: GraphControlsProps) {
  return (
    <div className={cn(PANEL_CLASS, "flex items-center gap-0.5 rounded-full p-1", className)}>
      {/* Play/Pause: the primary action, solid volt */}
      <button
        onClick={isRunning && !isPaused ? onPause : onPlay}
        className={cn(
          CONTROL_BUTTON,
          "bg-blurple-600 text-white hover:bg-blurple-700 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300"
        )}
        title={isRunning && !isPaused ? "Pause" : "Play"}
        aria-label={isRunning && !isPaused ? "Pause" : "Play"}
      >
        {isRunning && !isPaused ? (
          <Pause className="h-3.5 w-3.5 fill-current" />
        ) : (
          <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
        )}
      </button>

      {/* Step Forward */}
      <button
        onClick={onStepForward}
        className={cn(
          CONTROL_BUTTON,
          "text-ink-secondary hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse"
        )}
        title="Step forward"
        aria-label="Step forward"
      >
        <StepForward className="h-4 w-4" />
      </button>

      {/* Reset */}
      <button
        onClick={onReset}
        className={cn(
          CONTROL_BUTTON,
          "text-ink-secondary hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse"
        )}
        title="Reset"
        aria-label="Reset"
      >
        <RotateCcw className="h-4 w-4" />
      </button>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Main StrandsGraph Component
// ─────────────────────────────────────────────────────────────────────────────

interface StrandsGraphProps {
  initialState: GraphState;
  onNodeClick?: (node: StrandsGraphNode) => void;
  onEdgeClick?: (edge: StrandsGraphEdge) => void;
  onEvent?: (event: OrchestrationEvent) => void;
  className?: string;
  showTimeline?: boolean;
  showStats?: boolean;
  showControls?: boolean;
  interactive?: boolean;
}

export function StrandsGraph({
  initialState,
  onNodeClick,
  onEdgeClick,
  onEvent,
  className,
  showTimeline = true,
  showStats = true,
  showControls = true,
  interactive = true,
}: StrandsGraphProps) {
  const [graphState, setGraphState] = useState<GraphState>(initialState);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialState.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialState.edges);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Get current running nodes
  const currentNodes = useMemo(() => {
    return nodes
      .filter((n) => n.data.status === "running")
      .map((n) => n.id);
  }, [nodes]);

  // Handle play
  const handlePlay = useCallback(() => {
    setIsRunning(true);
    setIsPaused(false);
    onEvent?.({
      type: "workflow-started",
      timestamp: Date.now(),
    });
  }, [onEvent]);

  // Handle pause
  const handlePause = useCallback(() => {
    setIsPaused(true);
    onEvent?.({
      type: "workflow-completed", // Using as pause event
      timestamp: Date.now(),
    });
  }, [onEvent]);

  // Handle reset
  const handleReset = useCallback(() => {
    setIsRunning(false);
    setIsPaused(false);
    setNodes(initialState.nodes);
    setEdges(initialState.edges);
    setGraphState(initialState);
  }, [initialState, setNodes, setEdges]);

  // Handle step forward (simulate one step)
  const handleStepForward = useCallback(() => {
    // Find first pending node with satisfied dependencies
    const pendingNode = nodes.find((node) => {
      if (node.data.status !== "pending" && node.data.status !== "idle") return false;
      const deps = node.data.dependencies;
      return deps.every((dep) => 
        nodes.find((n) => n.id === dep)?.data.status === "completed"
      );
    });

    if (pendingNode) {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === pendingNode.id) {
            return {
              ...n,
              data: { ...n.data, status: "running" as AgentStatus },
            };
          }
          return n;
        })
      );

      // Activate edges leading to this node
      setEdges((eds) =>
        eds.map((e) => {
          if (e.target === pendingNode.id) {
            return { ...e, data: { ...e.data!, type: 'graph-edge' as const, isActive: true, isAnimated: true } } as StrandsGraphEdge;
          }
          return e;
        })
      );

      onEvent?.({
        type: "node-started",
        nodeId: pendingNode.id,
        timestamp: Date.now(),
      });

      // Simulate completion after delay
      setTimeout(() => {
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id === pendingNode.id) {
              return {
                ...n,
                data: {
                  ...n.data,
                  status: "completed" as AgentStatus,
                  result: {
                    status: "success",
                    content: `Task ${pendingNode.id} completed successfully.`,
                    completedAt: Date.now(),
                  },
                },
              };
            }
            return n;
          })
        );

        setGraphState((s) => ({
          ...s,
          completedNodes: [...s.completedNodes, pendingNode.id],
          executionOrder: [...s.executionOrder, pendingNode.id],
        }));

        onEvent?.({
          type: "node-completed",
          nodeId: pendingNode.id,
          timestamp: Date.now(),
        });
      }, 1500);
    }
  }, [nodes, setNodes, setEdges, onEvent]);

  // Handle node click
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: StrandsGraphNode) => {
      onNodeClick?.(node);
    },
    [onNodeClick]
  );

  // Handle edge click
  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: StrandsGraphEdge) => {
      onEdgeClick?.(edge);
    },
    [onEdgeClick]
  );

  // Handle connection (currently a no-op but required by ReactFlow)
  const onConnect: OnConnect = useCallback(
    (_connection: Connection) => {
      if (!interactive) return;
      // Could add new edge creation logic here
    },
    [interactive]
  );

  return (
    <div className={cn("ron-workflow relative w-full h-full", className)}>
      <EdgeMarkerDefinitions />
      
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={interactive ? onNodesChange : undefined}
        onEdgesChange={interactive ? onEdgesChange : undefined}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
        deleteKeyCode={interactive ? ["Backspace", "Delete"] : null}
        panOnDrag={true}
        panOnScroll={true}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          color="rgb(var(--ren-ink) / 0.14)"
          gap={20}
          size={1}
        />

        <Controls
          showInteractive={interactive}
          className="!overflow-hidden !rounded-lg !border !border-surface-200 !shadow-float dark:!border-surface-800"
        />

        {/* Top Left: Stats */}
        {showStats && (
          <Panel position="top-left">
            <GraphStats state={graphState} />
          </Panel>
        )}

        {/* Top Right: Custom Controls */}
        {showControls && (
          <Panel position="top-right">
            <GraphControls
              isRunning={isRunning}
              isPaused={isPaused}
              onPlay={handlePlay}
              onPause={handlePause}
              onReset={handleReset}
              onStepForward={handleStepForward}
            />
          </Panel>
        )}

        {/* Bottom: Timeline */}
        {showTimeline && (
          <Panel position="bottom-center">
            <ExecutionTimeline
              executionOrder={graphState.executionOrder}
              completedNodes={graphState.completedNodes}
              currentNodes={currentNodes}
            />
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
