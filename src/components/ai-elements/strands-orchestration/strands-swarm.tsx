/**
 * StrandsSwarm Component - Refined Edition
 * 
 * A polished canvas component for visualizing the Strands Swarm orchestration pattern.
 * Displays dynamic, agent-driven coordination with:
 * - Clean node layouts with proper spacing
 * - Elegant curved edge routing
 * - Refined shared context display
 * - Smooth agent history trail
 *
 * Ren styling: the canvas is transparent and themed by `.ron-workflow`, so it reads on
 * paper, ink and Glass alike. Panels float on `bg-popover`; volt marks the active agent
 * and the primary action, never as a glow.
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
  type NodeTypes,
  type EdgeTypes,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ChevronDown, Layers, Play, RotateCcw, ScrollText } from "lucide-react";
import { useCallback, useState, memo } from "react";
import { SwarmNodeComponent } from "./strands-node";
import { SwarmEdgeComponent, EdgeMarkerDefinitions } from "./strands-edge";
import type {
  SwarmState,
  StrandsSwarmNode,
  StrandsSwarmEdge,
  OrchestrationEvent,
  AgentStatus,
  HandoffMessage,
  SharedContext,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Node & Edge Type Registries
// ─────────────────────────────────────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  "swarm-node": SwarmNodeComponent,
};

const edgeTypes: EdgeTypes = {
  "swarm-edge": SwarmEdgeComponent,
};

// Floating canvas panels: frosted by Glass through `bg-popover`.
const PANEL_CLASS =
  "rounded-xl border border-surface-200 bg-popover text-ink shadow-float dark:border-surface-800 dark:text-ink-inverse";

const PANEL_LABEL =
  "font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted";

const PANEL_HEADER =
  "flex w-full items-center justify-between gap-3 px-3.5 py-2.5 transition-colors duration-150 ease-out hover:bg-surface-100/70 dark:hover:bg-surface-800/70";

const COUNT_PILL =
  "inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-surface-100 px-1 font-mono text-[10px] font-medium leading-none tabular-nums text-ink-secondary dark:bg-surface-800 dark:text-ink-inverse-secondary";

// ─────────────────────────────────────────────────────────────────────────────
// Run Transcript Component - Detailed log of agent activity
// ─────────────────────────────────────────────────────────────────────────────

interface RunTranscriptProps {
  history: string[];
  currentAgent: string | null;
  handoffs: HandoffMessage[];
  className?: string;
}

const RunTranscript = memo(function RunTranscript({
  history,
  currentAgent,
  handoffs,
  className,
}: RunTranscriptProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Build transcript entries
  const entries: Array<{
    type: 'start' | 'handoff' | 'active';
    agent: string;
    message?: string;
    timestamp?: number;
  }> = [];

  // Add initial start
  if (history.length > 0 || currentAgent) {
    const firstAgent = history[0] || currentAgent;
    if (firstAgent) {
      entries.push({ type: 'start', agent: firstAgent });
    }
  }

  // Add handoffs
  handoffs.forEach((h) => {
    entries.push({
      type: 'handoff',
      agent: h.toAgent,
      message: h.message,
      timestamp: h.timestamp,
    });
  });

  // Add current active if not in handoffs
  if (currentAgent && !handoffs.find(h => h.toAgent === currentAgent)) {
    entries.push({ type: 'active', agent: currentAgent });
  }

  if (entries.length === 0) return null;

  return (
    <div className={cn(PANEL_CLASS, "w-72 max-w-xs overflow-hidden", className)}>
      {/* Header - Collapsible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={PANEL_HEADER}
      >
        <div className="flex items-center gap-2">
          <ScrollText className="h-3.5 w-3.5 text-blurple-600 dark:text-blurple-400" />
          <span className={PANEL_LABEL}>
            Run transcript
          </span>
          <span className={COUNT_PILL}>
            {entries.length}
          </span>
        </div>
        <ChevronDown className={cn(
          "h-4 w-4 text-ink-muted transition-transform duration-200 ease-out dark:text-ink-inverse-muted",
          isExpanded && "rotate-180"
        )} />
      </button>

      {/* Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="max-h-48 overflow-y-auto border-t border-surface-200 px-3.5 py-1 dark:border-surface-800">
              {entries.map((entry, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-start gap-2.5 border-b border-surface-100 py-2 last:border-0 dark:border-surface-800"
                >
                  {/* Icon */}
                  <div className={cn(
                    "mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                    entry.type === 'start' && "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400",
                    entry.type === 'handoff' && "bg-blurple-50 text-blurple-600 dark:bg-blurple-400/15 dark:text-blurple-300",
                    entry.type === 'active' && "bg-blurple-600 text-white dark:bg-blurple-400 dark:text-ink"
                  )}>
                    {entry.type === 'start' && <Play className="ml-px h-2.5 w-2.5 fill-current" />}
                    {entry.type === 'handoff' && <ArrowRight className="h-3 w-3" />}
                    {entry.type === 'active' && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "truncate text-[12px] font-medium",
                        entry.type === 'active' ? "text-blurple-700 dark:text-blurple-200" : "text-ink dark:text-ink-inverse"
                      )}>
                        {entry.agent}
                      </span>
                      {entry.type === 'active' && (
                        <span className="inline-flex h-4 items-center rounded-full bg-blurple-600 px-1.5 font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.08em] text-white dark:bg-blurple-400 dark:text-ink">
                          Active
                        </span>
                      )}
                    </div>
                    {entry.message && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-secondary dark:text-ink-inverse-secondary">
                        {entry.message}
                      </p>
                    )}
                    {entry.timestamp && (
                      <span className="mt-0.5 block font-mono text-[10px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared Context Card - Collapsible design
// ─────────────────────────────────────────────────────────────────────────────

interface SharedContextCardProps {
  context: SharedContext;
  className?: string;
}

const SharedContextCard = memo(function SharedContextCard({
  context,
  className,
}: SharedContextCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const entries = Object.entries(context);
  
  if (entries.length === 0) return null;

  return (
    <div className={cn(PANEL_CLASS, "w-64 max-w-xs overflow-hidden", className)}>
      {/* Header - Collapsible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={PANEL_HEADER}
      >
        <div className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-ink-secondary dark:text-ink-inverse-secondary" />
          <span className={PANEL_LABEL}>
            Context
          </span>
          <span className={COUNT_PILL}>
            {entries.length}
          </span>
        </div>
        <ChevronDown className={cn(
          "h-4 w-4 text-ink-muted transition-transform duration-200 ease-out dark:text-ink-inverse-muted",
          isExpanded && "rotate-180"
        )} />
      </button>

      {/* Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="max-h-40 overflow-y-auto border-t border-surface-200 px-3.5 py-2.5 dark:border-surface-800">
              {entries.map(([nodeId, data]) => (
                <div key={nodeId} className="mb-2.5 last:mb-0">
                  <span className="font-mono text-[11px] font-semibold text-blurple-700 dark:text-blurple-300">
                    {nodeId}
                  </span>
                  <div className="mt-1 border-l border-surface-200 pl-2.5 dark:border-surface-700">
                    {Object.entries(data).map(([key, value]) => (
                      <div key={key} className="flex items-baseline gap-2 py-0.5">
                        <span className="shrink-0 font-mono text-[10px] font-medium text-ink-muted dark:text-ink-inverse-muted">
                          {key}:
                        </span>
                        <span className="max-w-[160px] truncate text-[11px] text-ink-secondary dark:text-ink-inverse-secondary">
                          {typeof value === 'string' ? value : JSON.stringify(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Swarm Status Badge - Compact & Elegant
// ─────────────────────────────────────────────────────────────────────────────

interface SwarmStatusBadgeProps {
  state: SwarmState;
  className?: string;
}

const SwarmStatusBadge = memo(function SwarmStatusBadge({ state, className }: SwarmStatusBadgeProps) {
  const statusConfig = {
    created: { label: "Ready", color: "bg-surface-400 dark:bg-surface-500", pulse: false },
    running: { label: "Active", color: "bg-blurple-600 dark:bg-blurple-400", pulse: true },
    completed: { label: "Completed", color: "bg-success", pulse: false },
    error: { label: "Failed", color: "bg-danger", pulse: false },
  }[state.status];

  return (
    <div className={cn(PANEL_CLASS, "min-w-[180px] px-3.5 py-3", className)}>
      {/* Status row */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className={PANEL_LABEL}>Swarm</span>
        <span className="inline-flex items-center gap-1.5">
          <span className={cn(
            "h-1.5 w-1.5 rounded-full",
            statusConfig.color,
            // Live: a still halo, never a pulse.
            statusConfig.pulse && "ring-[3px] ring-blurple-600/15 dark:ring-blurple-400/20"
          )} />
          <span className="text-[12px] font-semibold leading-none text-ink dark:text-ink-inverse">
            {statusConfig.label}
          </span>
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 divide-x divide-surface-200 dark:divide-surface-800">
        <div className="pr-3">
          <span className="block font-mono text-2xl font-semibold leading-tight tabular-nums text-blurple-600 dark:text-blurple-300">
            {state.handoffCount}
          </span>
          <span className={PANEL_LABEL}>
            Handoffs
          </span>
        </div>
        <div className="pl-3">
          <span className="block font-mono text-2xl font-semibold leading-tight tabular-nums text-ink-secondary dark:text-ink-inverse-secondary">
            {state.maxHandoffs}
          </span>
          <span className={PANEL_LABEL}>
            Max
          </span>
        </div>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Control Buttons - Minimal & Clean
// ─────────────────────────────────────────────────────────────────────────────

interface SwarmControlButtonsProps {
  isRunning: boolean;
  onStart: () => void;
  onReset: () => void;
  onSimulateHandoff: () => void;
  className?: string;
}

const SwarmControlButtons = memo(function SwarmControlButtons({
  isRunning,
  onStart,
  onReset,
  onSimulateHandoff,
  className,
}: SwarmControlButtonsProps) {
  return (
    <div className={cn(PANEL_CLASS, "flex items-center gap-0.5 rounded-full p-1", className)}>
      <ControlButton
        onClick={onStart}
        disabled={isRunning}
        title="Start swarm"
        className={!isRunning ? "bg-blurple-600 text-white hover:bg-blurple-700 hover:text-white dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300 dark:hover:text-ink" : ""}
      >
        <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
      </ControlButton>

      <ControlButton
        onClick={onSimulateHandoff}
        disabled={!isRunning}
        title="Simulate handoff"
      >
        <ArrowRight className="h-4 w-4" />
      </ControlButton>

      <ControlButton onClick={onReset} title="Reset">
        <RotateCcw className="h-4 w-4" />
      </ControlButton>
    </div>
  );
});

interface ControlButtonProps {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  className?: string;
}

function ControlButton({ onClick, disabled, title, children, className }: ControlButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-150 ease-out",
        "text-ink-secondary hover:text-ink dark:text-ink-inverse-secondary dark:hover:text-ink-inverse",
        "hover:bg-surface-100 dark:hover:bg-surface-800",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
        className
      )}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main StrandsSwarm Component
// ─────────────────────────────────────────────────────────────────────────────

interface StrandsSwarmProps {
  initialState: SwarmState;
  onNodeClick?: (node: StrandsSwarmNode) => void;
  onEdgeClick?: (edge: StrandsSwarmEdge) => void;
  onEvent?: (event: OrchestrationEvent) => void;
  className?: string;
  showHistory?: boolean;
  showStats?: boolean;
  showContext?: boolean;
  showControls?: boolean;
  interactive?: boolean;
}

export function StrandsSwarm({
  initialState,
  onNodeClick,
  onEdgeClick,
  onEvent,
  className,
  showHistory = true,
  showStats = true,
  showContext = true,
  showControls = true,
  interactive = true,
}: StrandsSwarmProps) {
  const [swarmState, setSwarmState] = useState<SwarmState>(initialState);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialState.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialState.edges);
  const [isRunning, setIsRunning] = useState(false);

  // Handle start
  const handleStart = useCallback(() => {
    const entryNode = nodes.find((n) => n.data.isEntryPoint);
    if (!entryNode) return;

    setIsRunning(true);
    setSwarmState((s) => ({
      ...s,
      status: "running",
      currentNode: entryNode.id,
      startedAt: Date.now(),
    }));

    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === entryNode.id) {
          return { ...n, data: { ...n.data, status: "running" as AgentStatus } };
        }
        return n;
      })
    );

    onEvent?.({
      type: "workflow-started",
      nodeId: entryNode.id,
      timestamp: Date.now(),
    });
  }, [nodes, setNodes, onEvent]);

  // Handle reset
  const handleReset = useCallback(() => {
    setIsRunning(false);
    setNodes(initialState.nodes);
    setEdges(initialState.edges);
    setSwarmState(initialState);
  }, [initialState, setNodes, setEdges]);

  // Simulate handoff
  const handleSimulateHandoff = useCallback(() => {
    if (!swarmState.currentNode) return;

    const currentNode = nodes.find((n) => n.id === swarmState.currentNode);
    if (!currentNode || !currentNode.data.canHandoffTo?.length) return;

    const targets = currentNode.data.canHandoffTo;
    const targetId = targets[Math.floor(Math.random() * targets.length)];

    const handoffMessage: HandoffMessage = {
      fromAgent: currentNode.id,
      toAgent: targetId,
      message: `Handing off to ${targetId}`,
      timestamp: Date.now(),
    };

    // Update edges
    setEdges((eds) =>
      eds.map((e) => {
        if (e.source === currentNode.id && e.target === targetId) {
          return {
            ...e,
            data: { ...e.data!, type: 'swarm-edge' as const, isActive: true, isAnimated: true, handoffMessage: handoffMessage.message },
          } as StrandsSwarmEdge;
        }
        if (e.source === currentNode.id) {
          return { ...e, data: { ...e.data!, type: 'swarm-edge' as const, isActive: false, isAnimated: false } } as StrandsSwarmEdge;
        }
        return e;
      })
    );

    // Update nodes
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === currentNode.id) {
          return { ...n, data: { ...n.data, status: "handoff" as AgentStatus } };
        }
        if (n.id === targetId) {
          return { ...n, data: { ...n.data, status: "running" as AgentStatus } };
        }
        return n;
      })
    );

    // Update state
    setSwarmState((s) => ({
      ...s,
      currentNode: targetId,
      nodeHistory: [...s.nodeHistory, currentNode.id],
      handoffs: [...s.handoffs, handoffMessage],
      handoffCount: s.handoffCount + 1,
    }));

    onEvent?.({
      type: "handoff-initiated",
      nodeId: currentNode.id,
      timestamp: Date.now(),
      data: { target: targetId },
    });

    // Complete previous node after animation
    setTimeout(() => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === currentNode.id) {
            return { ...n, data: { ...n.data, status: "completed" as AgentStatus } };
          }
          return n;
        })
      );

      setEdges((eds) =>
        eds.map((e) => {
          if (e.source === currentNode.id && e.target === targetId) {
            return { ...e, data: { ...e.data!, type: 'swarm-edge' as const, isAnimated: false } } as StrandsSwarmEdge;
          }
          return e;
        })
      );
    }, 1200);
  }, [swarmState.currentNode, nodes, setNodes, setEdges, onEvent]);

  // Handlers
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: StrandsSwarmNode) => onNodeClick?.(node),
    [onNodeClick]
  );

  const handleEdgeClick = useCallback(
    (_: React.MouseEvent, edge: StrandsSwarmEdge) => onEdgeClick?.(edge),
    [onEdgeClick]
  );

  return (
    <div className={cn("ron-workflow relative w-full h-full", className)}>
      <EdgeMarkerDefinitions />
      
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={interactive ? onNodesChange : undefined}
        onEdgesChange={interactive ? onEdgesChange : undefined}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.4}
        maxZoom={1.5}
        panOnDrag
        panOnScroll
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: "swarm-edge",
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          color="rgb(var(--ren-ink) / 0.14)"
          gap={24}
          size={1}
        />

        {/* Bottom centre, horizontal: the corners belong to Context and the transcript. */}
        <Controls
          showInteractive={false}
          position="bottom-center"
          orientation="horizontal"
          className="!overflow-hidden !rounded-lg !border !border-surface-200 !shadow-float dark:!border-surface-800"
        />

        {/* Top Left: Status */}
        {showStats && (
          <Panel position="top-left">
            <SwarmStatusBadge state={swarmState} />
          </Panel>
        )}

        {/* Top Right: Controls */}
        {showControls && (
          <Panel position="top-right">
            <SwarmControlButtons
              isRunning={isRunning}
              onStart={handleStart}
              onReset={handleReset}
              onSimulateHandoff={handleSimulateHandoff}
            />
          </Panel>
        )}

        {/* Bottom Left: Shared Context */}
        {showContext && (
          <Panel position="bottom-left">
            <SharedContextCard context={swarmState.sharedContext} />
          </Panel>
        )}

        {/* Bottom Right: Run Transcript */}
        {showHistory && (
          <Panel position="bottom-right">
            <RunTranscript
              history={swarmState.nodeHistory}
              currentAgent={swarmState.currentNode}
              handoffs={swarmState.handoffs}
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

// @ts-ignore - Kept for future use
function _SwarmIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <circle cx="19" cy="5" r="2" />
      <circle cx="5" cy="5" r="2" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="19" r="2" />
      <path d="M12 9V5M15 12h4M12 15v4M9 12H5" />
    </svg>
  );
}

// @ts-ignore - Kept for future use
function _ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

