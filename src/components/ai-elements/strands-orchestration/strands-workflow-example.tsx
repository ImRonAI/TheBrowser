/**
 * Strands Workflow Example Component
 * 
 * A comprehensive demo showcasing both Graph and Swarm orchestration patterns
 * from the Strands framework. This serves as:
 * 
 * 1. A visual reference for how Strands patterns work
 * 2. A working example for AI Elements canvas integration
 * 3. Documentation of the component API
 * 
 * Features demonstrated:
 * - Graph pattern with dependencies and conditions
 * - Swarm pattern with handoffs and shared context
 * - Real-time execution simulation
 * - Status tracking and metrics display
 */

"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { StrandsGraph } from "./strands-graph";
import { StrandsSwarm } from "./strands-swarm";
import type {
  GraphState,
  SwarmState,
  StrandsGraphNode,
  StrandsGraphEdge,
  StrandsSwarmNode,
  StrandsSwarmEdge,
  OrchestrationEvent,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Sample Data: Graph Pattern
// ─────────────────────────────────────────────────────────────────────────────

const sampleGraphNodes: StrandsGraphNode[] = [
  {
    id: "data_collection",
    type: "graph-node",
    position: { x: 50, y: 150 },
    data: {
      type: "graph-node",
      agent: {
        id: "data_collection",
        name: "Data Collector",
        description: "Collects and organizes research data",
        modelProvider: "bedrock",
        modelId: "claude-sonnet-4",
        tools: ["retrieve", "file_write", "http_request"],
        priority: 5,
      },
      status: "pending",
      dependencies: [],
    },
  },
  {
    id: "preprocessing",
    type: "graph-node",
    position: { x: 350, y: 50 },
    data: {
      type: "graph-node",
      agent: {
        id: "preprocessing",
        name: "Preprocessor",
        description: "Cleans and normalizes collected data",
        modelProvider: "anthropic",
        modelId: "claude-sonnet-4",
        tools: ["file_read", "file_write"],
        priority: 4,
      },
      status: "idle",
      dependencies: ["data_collection"],
    },
  },
  {
    id: "analysis",
    type: "graph-node",
    position: { x: 350, y: 250 },
    data: {
      type: "graph-node",
      agent: {
        id: "analysis",
        name: "Analyzer",
        description: "Performs statistical analysis",
        modelProvider: "bedrock",
        modelId: "claude-opus-4",
        tools: ["calculator", "python_repl", "file_read"],
        priority: 5,
        timeout: 600,
      },
      status: "idle",
      dependencies: ["data_collection"],
    },
  },
  {
    id: "validation",
    type: "graph-node",
    position: { x: 650, y: 100 },
    data: {
      type: "graph-node",
      agent: {
        id: "validation",
        name: "Validator",
        description: "Validates analysis results",
        modelProvider: "openai",
        modelId: "o4-mini",
        tools: ["file_read"],
        priority: 3,
      },
      status: "idle",
      dependencies: ["preprocessing", "analysis"],
    },
  },
  {
    id: "report",
    type: "graph-node",
    position: { x: 950, y: 150 },
    data: {
      type: "graph-node",
      agent: {
        id: "report",
        name: "Report Generator",
        description: "Creates comprehensive report",
        modelProvider: "anthropic",
        modelId: "claude-sonnet-4",
        tools: ["file_write", "generate_image"],
        priority: 4,
      },
      status: "idle",
      dependencies: ["validation"],
    },
  },
];

const sampleGraphEdges: StrandsGraphEdge[] = [
  {
    id: "e-data-preprocess",
    source: "data_collection",
    target: "preprocessing",
    type: "graph-edge",
    data: {
      type: "graph-edge",
      isConditional: false,
      isActive: false,
    },
  },
  {
    id: "e-data-analysis",
    source: "data_collection",
    target: "analysis",
    type: "graph-edge",
    data: {
      type: "graph-edge",
      isConditional: false,
      isActive: false,
    },
  },
  {
    id: "e-preprocess-validate",
    source: "preprocessing",
    target: "validation",
    type: "graph-edge",
    data: {
      type: "graph-edge",
      isConditional: true,
      condition: {
        id: "cond-1",
        label: "data_valid",
        expression: "state.results['preprocessing'].status == 'success'",
      },
      isActive: false,
    },
  },
  {
    id: "e-analysis-validate",
    source: "analysis",
    target: "validation",
    type: "graph-edge",
    data: {
      type: "graph-edge",
      isConditional: true,
      condition: {
        id: "cond-2",
        label: "analysis_complete",
        expression: "state.results['analysis'].status == 'success'",
      },
      isActive: false,
    },
  },
  {
    id: "e-validate-report",
    source: "validation",
    target: "report",
    type: "graph-edge",
    data: {
      type: "graph-edge",
      isConditional: false,
      isActive: false,
    },
  },
];

const sampleGraphState: GraphState = {
  id: "research_pipeline",
  status: "created",
  nodes: sampleGraphNodes,
  edges: sampleGraphEdges,
  completedNodes: [],
  failedNodes: [],
  executionOrder: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Sample Data: Swarm Pattern
// ─────────────────────────────────────────────────────────────────────────────

const sampleSwarmNodes: StrandsSwarmNode[] = [
  {
    id: "coordinator",
    type: "swarm-node",
    position: { x: 400, y: 50 },
    data: {
      type: "swarm-node",
      agent: {
        id: "coordinator",
        name: "Coordinator",
        description: "Orchestrates task delegation",
        modelProvider: "bedrock",
        modelId: "claude-opus-4",
        tools: ["handoff_to_agent"],
        priority: 5,
      },
      status: "idle",
      isEntryPoint: true,
      canHandoffTo: ["researcher", "writer", "reviewer"],
    },
  },
  {
    id: "researcher",
    type: "swarm-node",
    position: { x: 100, y: 250 },
    data: {
      type: "swarm-node",
      agent: {
        id: "researcher",
        name: "Researcher",
        description: "Gathers information and data",
        modelProvider: "anthropic",
        modelId: "claude-sonnet-4",
        tools: ["retrieve", "web_search", "handoff_to_agent"],
        priority: 4,
      },
      status: "idle",
      canHandoffTo: ["coordinator", "writer"],
    },
  },
  {
    id: "writer",
    type: "swarm-node",
    position: { x: 400, y: 250 },
    data: {
      type: "swarm-node",
      agent: {
        id: "writer",
        name: "Writer",
        description: "Drafts content and documentation",
        modelProvider: "anthropic",
        modelId: "claude-sonnet-4",
        tools: ["file_write", "handoff_to_agent"],
        priority: 4,
      },
      status: "idle",
      canHandoffTo: ["coordinator", "reviewer"],
    },
  },
  {
    id: "reviewer",
    type: "swarm-node",
    position: { x: 700, y: 250 },
    data: {
      type: "swarm-node",
      agent: {
        id: "reviewer",
        name: "Reviewer",
        description: "Reviews and provides feedback",
        modelProvider: "openai",
        modelId: "o4-mini",
        tools: ["file_read", "handoff_to_agent"],
        priority: 3,
      },
      status: "idle",
      canHandoffTo: ["coordinator", "writer"],
    },
  },
];

const sampleSwarmEdges: StrandsSwarmEdge[] = [
  // From Coordinator
  { id: "e-coord-researcher", source: "coordinator", target: "researcher", type: "swarm-edge", data: { type: "swarm-edge", isActive: false } },
  { id: "e-coord-writer", source: "coordinator", target: "writer", type: "swarm-edge", data: { type: "swarm-edge", isActive: false } },
  { id: "e-coord-reviewer", source: "coordinator", target: "reviewer", type: "swarm-edge", data: { type: "swarm-edge", isActive: false } },
  // From Researcher
  { id: "e-researcher-coord", source: "researcher", target: "coordinator", type: "swarm-edge", data: { type: "swarm-edge", isActive: false } },
  { id: "e-researcher-writer", source: "researcher", target: "writer", type: "swarm-edge", data: { type: "swarm-edge", isActive: false } },
  // From Writer
  { id: "e-writer-coord", source: "writer", target: "coordinator", type: "swarm-edge", data: { type: "swarm-edge", isActive: false } },
  { id: "e-writer-reviewer", source: "writer", target: "reviewer", type: "swarm-edge", data: { type: "swarm-edge", isActive: false } },
  // From Reviewer
  { id: "e-reviewer-coord", source: "reviewer", target: "coordinator", type: "swarm-edge", data: { type: "swarm-edge", isActive: false } },
  { id: "e-reviewer-writer", source: "reviewer", target: "writer", type: "swarm-edge", data: { type: "swarm-edge", isActive: false } },
];

const sampleSwarmState: SwarmState = {
  id: "content_creation_swarm",
  status: "created",
  currentNode: null,
  nodes: sampleSwarmNodes,
  edges: sampleSwarmEdges,
  nodeHistory: [],
  handoffs: [],
  sharedContext: {},
  maxHandoffs: 10,
  handoffCount: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Tab Navigation
// ─────────────────────────────────────────────────────────────────────────────

type PatternTab = "graph" | "swarm";

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  icon: React.ReactNode;
}

function TabButton({ active, onClick, children, icon }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium",
        "transition-all duration-200",
        active
          ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-lg"
          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Log Component
// ─────────────────────────────────────────────────────────────────────────────

interface EventLogProps {
  events: OrchestrationEvent[];
  className?: string;
}

function EventLog({ events, className }: EventLogProps) {
  return (
    <div className={cn(
      "bg-slate-900 text-slate-100 rounded-lg overflow-hidden",
      className
    )}>
      <div className="px-3 py-2 bg-slate-800 border-b border-slate-700 flex items-center gap-2">
        <TerminalIcon className="w-4 h-4 text-emerald-400" />
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Event Log
        </span>
        <span className="ml-auto text-xs text-slate-500">{events.length} events</span>
      </div>
      <div className="p-3 max-h-48 overflow-y-auto font-mono text-xs space-y-1">
        {events.length === 0 ? (
          <span className="text-slate-500">Waiting for events...</span>
        ) : (
          events.map((event, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-start gap-2"
            >
              <span className="text-slate-500 w-20 flex-shrink-0">
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
              <span className={cn(
                event.type.includes("error") ? "text-rose-400" :
                event.type.includes("completed") ? "text-emerald-400" :
                event.type.includes("started") ? "text-sky-400" :
                event.type.includes("handoff") ? "text-violet-400" :
                "text-slate-300"
              )}>
                [{event.type}]
              </span>
              {event.nodeId && (
                <span className="text-amber-400">{event.nodeId}</span>
              )}
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Example Component
// ─────────────────────────────────────────────────────────────────────────────

interface StrandsWorkflowExampleProps {
  className?: string;
}

export function StrandsWorkflowExample({ className }: StrandsWorkflowExampleProps) {
  const [activeTab, setActiveTab] = useState<PatternTab>("graph");
  const [events, setEvents] = useState<OrchestrationEvent[]>([]);

  const handleEvent = (event: OrchestrationEvent) => {
    setEvents((prev) => [...prev.slice(-19), event]); // Keep last 20 events
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Strands Orchestration Patterns
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Visualizing Graph and Swarm multi-agent coordination
            </p>
          </div>
          
          {/* Tab Switcher */}
          <div className="flex items-center gap-2">
            <TabButton
              active={activeTab === "graph"}
              onClick={() => setActiveTab("graph")}
              icon={<GraphIcon className="w-4 h-4" />}
            >
              Graph Pattern
            </TabButton>
            <TabButton
              active={activeTab === "swarm"}
              onClick={() => setActiveTab("swarm")}
              icon={<SwarmIcon className="w-4 h-4" />}
            >
              Swarm Pattern
            </TabButton>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Canvas */}
        <div className="flex-1 relative">
          <AnimatePresence mode="wait">
            {activeTab === "graph" ? (
              <motion.div
                key="graph"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0"
              >
                <StrandsGraph
                  initialState={sampleGraphState}
                  onEvent={handleEvent}
                  showTimeline
                  showStats
                  showControls
                />
              </motion.div>
            ) : (
              <motion.div
                key="swarm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0"
              >
                <StrandsSwarm
                  initialState={sampleSwarmState}
                  onEvent={handleEvent}
                  showHistory
                  showStats
                  showContext
                  showControls
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Sidebar */}
        <div className="w-80 border-l border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4 space-y-4 overflow-y-auto">
          {/* Pattern Description */}
          <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2 flex items-center gap-2">
              {activeTab === "graph" ? (
                <>
                  <GraphIcon className="w-4 h-4 text-sky-500" />
                  Graph Pattern
                </>
              ) : (
                <>
                  <SwarmIcon className="w-4 h-4 text-violet-500" />
                  Swarm Pattern
                </>
              )}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {activeTab === "graph" ? (
                <>
                  Deterministic, dependency-driven execution. Nodes represent agents
                  that execute when all dependencies are satisfied. Edges can have
                  conditional logic based on GraphState.
                </>
              ) : (
                <>
                  Dynamic, agent-driven coordination. Agents autonomously decide
                  when to hand off control using the handoff_to_agent tool.
                  SharedContext enables inter-agent communication.
                </>
              )}
            </p>
          </div>

          {/* Key Features */}
          <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">
              Key Features
            </h3>
            <ul className="space-y-2 text-sm">
              {(activeTab === "graph" ? [
                "Dependency resolution",
                "Parallel batch execution",
                "Conditional edges",
                "Execution order tracking",
                "State-based routing",
              ] : [
                "Dynamic handoffs",
                "Agent history tracking",
                "Shared context",
                "Max handoff limits",
                "Entry point configuration",
              ]).map((feature) => (
                <li key={feature} className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                  <CheckCircleIcon className="w-4 h-4 text-emerald-500" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          {/* Event Log */}
          <EventLog events={events} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────

function GraphIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="12" r="3" />
      <circle cx="19" cy="6" r="3" />
      <circle cx="19" cy="18" r="3" />
      <path d="M8 12h4M12 12l4-4M12 12l4 4" />
    </svg>
  );
}

function SwarmIcon({ className }: { className?: string }) {
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

function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

export default StrandsWorkflowExample;

