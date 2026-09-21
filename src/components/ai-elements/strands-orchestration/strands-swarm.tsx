/**
 * StrandsSwarm Component - Refined Edition
 * 
 * A polished canvas component for visualizing the Strands Swarm orchestration pattern.
 * Displays dynamic, agent-driven coordination with:
 * - Clean node layouts with proper spacing
 * - Elegant curved edge routing
 * - Refined shared context display
 * - Smooth agent history trail
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
    <div className={cn(
      "bg-slate-900/90 backdrop-blur-md",
      "rounded-xl border border-slate-700/50",
      "shadow-2xl overflow-hidden",
      "max-w-xs",
      className
    )}>
      {/* Header - Collapsible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <TranscriptIcon className="w-4 h-4 text-violet-400" />
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
            Run Transcript
          </span>
          <span className="text-[10px] text-slate-500">
            ({entries.length})
          </span>
        </div>
        <ChevronIcon className={cn(
          "w-4 h-4 text-slate-500 transition-transform",
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
            <div className="px-3 pb-3 max-h-48 overflow-y-auto">
              {entries.map((entry, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-start gap-2 py-1.5 border-b border-slate-800 last:border-0"
                >
                  {/* Icon */}
                  <div className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5",
                    entry.type === 'start' && "bg-emerald-500/20",
                    entry.type === 'handoff' && "bg-violet-500/20",
                    entry.type === 'active' && "bg-sky-500/20"
                  )}>
                    {entry.type === 'start' && <PlaySmallIcon className="w-2.5 h-2.5 text-emerald-400" />}
                    {entry.type === 'handoff' && <ArrowRightIcon className="w-2.5 h-2.5 text-violet-400" />}
                    {entry.type === 'active' && <DotIcon className="w-2.5 h-2.5 text-sky-400" />}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-xs font-medium",
                        entry.type === 'active' ? "text-sky-300" : "text-slate-300"
                      )}>
                        {entry.agent}
                      </span>
                      {entry.type === 'active' && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 uppercase tracking-wider">
                          Active
                        </span>
                      )}
                    </div>
                    {entry.message && (
                      <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">
                        {entry.message}
                      </p>
                    )}
                    {entry.timestamp && (
                      <span className="text-[9px] text-slate-600">
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
    <div className={cn(
      "bg-slate-900/90 backdrop-blur-md",
      "rounded-xl border border-slate-700/50",
      "shadow-2xl overflow-hidden",
      "max-w-xs",
      className
    )}>
      {/* Header - Collapsible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ContextIcon className="w-4 h-4 text-emerald-400" />
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
            Context
          </span>
          <span className="text-[10px] text-slate-500">
            ({entries.length})
          </span>
        </div>
        <ChevronIcon className={cn(
          "w-4 h-4 text-slate-500 transition-transform",
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
            <div className="px-3 pb-3 max-h-40 overflow-y-auto">
              {entries.map(([nodeId, data]) => (
                <div key={nodeId} className="mb-2 last:mb-0">
                  <span className="text-[10px] font-semibold text-violet-400">
                    {nodeId}
                  </span>
                  <div className="mt-1 pl-2 border-l border-slate-700/50">
                    {Object.entries(data).map(([key, value]) => (
                      <div key={key} className="flex items-start gap-2 py-0.5">
                        <span className="text-[9px] text-slate-500 font-medium">
                          {key}:
                        </span>
                        <span className="text-[10px] text-slate-400 truncate max-w-[160px]">
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
    created: { label: "Ready", color: "bg-slate-500", pulse: false },
    running: { label: "Active", color: "bg-violet-500", pulse: true },
    completed: { label: "Completed", color: "bg-emerald-500", pulse: false },
    error: { label: "Error", color: "bg-rose-500", pulse: false },
  }[state.status];

  return (
    <div className={cn(
      "bg-slate-900/90 backdrop-blur-md",
      "rounded-xl border border-slate-700/50",
      "px-4 py-3 shadow-2xl",
      className
    )}>
      {/* Status row */}
      <div className="flex items-center gap-3 mb-3">
        <span className={cn(
          "w-2 h-2 rounded-full",
          statusConfig.color,
          statusConfig.pulse && "animate-pulse"
        )} />
        <span className="text-sm font-medium text-slate-200">
          {statusConfig.label}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="block text-2xl font-bold text-violet-400">
            {state.handoffCount}
          </span>
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">
            Handoffs
          </span>
        </div>
        <div>
          <span className="block text-2xl font-bold text-slate-400">
            {state.maxHandoffs}
          </span>
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">
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
    <div className={cn(
      "flex items-center gap-1 p-1.5",
      "bg-slate-900/90 backdrop-blur-md",
      "rounded-xl border border-slate-700/50",
      "shadow-2xl",
      className
    )}>
      <ControlButton
        onClick={onStart}
        disabled={isRunning}
        title="Start Swarm"
        className={!isRunning ? "text-violet-400 hover:bg-violet-500/20" : ""}
      >
        <PlayIcon className="w-4 h-4" />
      </ControlButton>

      <ControlButton
        onClick={onSimulateHandoff}
        disabled={!isRunning}
        title="Simulate Handoff"
      >
        <HandoffIcon className="w-4 h-4" />
      </ControlButton>

      <ControlButton onClick={onReset} title="Reset">
        <ResetIcon className="w-4 h-4" />
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
      className={cn(
        "p-2.5 rounded-lg transition-all duration-200",
        "text-slate-400 hover:text-slate-200",
        "hover:bg-slate-800",
        "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent",
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
    <div className={cn("relative w-full h-full bg-slate-950", className)}>
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
          color="rgb(51, 65, 85)"
          gap={24}
          size={1}
        />
        
        <Controls
          showInteractive={false}
          className="!rounded-xl !border !border-slate-700/50 !bg-slate-900/90 !backdrop-blur-md !shadow-2xl [&>button]:!bg-transparent [&>button]:!border-0 [&>button:hover]:!bg-slate-800 [&>button]:!text-slate-400"
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

function ContextIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
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

function HandoffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
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

function ResetIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function TranscriptIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function PlaySmallIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function DotIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="6" />
    </svg>
  );
}
