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
    <div className={cn(
      "bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm",
      "rounded-lg border border-slate-200 dark:border-slate-700",
      "p-3 shadow-lg",
      className
    )}>
      <div className="flex items-center gap-2 mb-2">
        <TimelineIcon className="w-4 h-4 text-slate-500" />
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
          Execution Order
        </span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {executionOrder.map((nodeId, index) => {
          const isCompleted = completedNodes.includes(nodeId);
          const isCurrent = currentNodes.includes(nodeId);
          
          return (
            <div key={nodeId} className="flex items-center gap-1.5">
              {index > 0 && (
                <ChevronRightIcon className="w-3 h-3 text-slate-300 dark:text-slate-600" />
              )}
              <motion.span
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-medium",
                  isCompleted
                    ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                    : isCurrent
                    ? "bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 animate-pulse"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                )}
              >
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
    error: "Error",
    paused: "Paused",
  }[state.status];

  const statusColor = {
    created: "bg-slate-500",
    running: "bg-sky-500",
    completed: "bg-emerald-500",
    error: "bg-rose-500",
    paused: "bg-amber-500",
  }[state.status];

  return (
    <div className={cn(
      "bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm",
      "rounded-lg border border-slate-200 dark:border-slate-700",
      "p-3 shadow-lg min-w-[180px]",
      className
    )}>
      {/* Status */}
      <div className="flex items-center gap-2 mb-3">
        <span className={cn("w-2 h-2 rounded-full", statusColor)} />
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          {statusLabel}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mb-3">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5 }}
          className="h-full bg-emerald-500 rounded-full"
        />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <span className="block text-lg font-bold text-emerald-600 dark:text-emerald-400">
            {completedCount}
          </span>
          <span className="text-[9px] text-slate-500 uppercase tracking-wider">Done</span>
        </div>
        <div>
          <span className="block text-lg font-bold text-sky-600 dark:text-sky-400">
            {pendingCount}
          </span>
          <span className="text-[9px] text-slate-500 uppercase tracking-wider">Pending</span>
        </div>
        <div>
          <span className="block text-lg font-bold text-rose-600 dark:text-rose-400">
            {failedCount}
          </span>
          <span className="text-[9px] text-slate-500 uppercase tracking-wider">Failed</span>
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
    <div className={cn(
      "flex items-center gap-1 p-1",
      "bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm",
      "rounded-lg border border-slate-200 dark:border-slate-700",
      "shadow-lg",
      className
    )}>
      {/* Play/Pause */}
      <button
        onClick={isRunning && !isPaused ? onPause : onPlay}
        className={cn(
          "p-2 rounded-md transition-colors",
          "hover:bg-slate-100 dark:hover:bg-slate-800"
        )}
        title={isRunning && !isPaused ? "Pause" : "Play"}
      >
        {isRunning && !isPaused ? (
          <PauseIcon className="w-4 h-4 text-slate-700 dark:text-slate-300" />
        ) : (
          <PlayIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        )}
      </button>

      {/* Step Forward */}
      <button
        onClick={onStepForward}
        className={cn(
          "p-2 rounded-md transition-colors",
          "hover:bg-slate-100 dark:hover:bg-slate-800"
        )}
        title="Step Forward"
      >
        <StepForwardIcon className="w-4 h-4 text-slate-700 dark:text-slate-300" />
      </button>

      {/* Reset */}
      <button
        onClick={onReset}
        className={cn(
          "p-2 rounded-md transition-colors",
          "hover:bg-slate-100 dark:hover:bg-slate-800"
        )}
        title="Reset"
      >
        <ResetIcon className="w-4 h-4 text-slate-700 dark:text-slate-300" />
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
    <div className={cn("relative w-full h-full", className)}>
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
          color="var(--slate-200)"
          gap={20}
          size={1}
        />
        
        <Controls
          showInteractive={interactive}
          className="!rounded-lg !border !border-slate-200 dark:!border-slate-700 !bg-white/90 dark:!bg-slate-900/90 !backdrop-blur-sm !shadow-lg"
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

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────

function TimelineIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function StepForwardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 4 15 12 5 20 5 4" />
      <rect x="17" y="4" width="2" height="16" />
    </svg>
  );
}

function ResetIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

