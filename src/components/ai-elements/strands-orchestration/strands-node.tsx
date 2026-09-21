/**
 * StrandsNode Component - Refined Edition
 * 
 * A polished React Flow node component for visualizing Strands agents in
 * Graph and Swarm orchestration patterns.
 * 
 * Features:
 * - Clean, modern card design
 * - Multi-directional handles (top, bottom, left, right)
 * - Status visualization with subtle animations
 * - Model provider badges
 * - Expandable details panel
 */

"use client";

import { cn } from "@/lib/utils";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, memo } from "react";
import type {
  AgentConfig,
  AgentStatus,
  AgentResult,
  GraphNodeData,
  SwarmNodeData,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Status Configuration
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<AgentStatus, {
  bg: string;
  border: string;
  iconBg: string;
  iconColor: string;
  glow?: string;
}> = {
  idle: {
    bg: "bg-slate-800/80",
    border: "border-slate-600/50",
    iconBg: "bg-slate-700",
    iconColor: "text-slate-400",
  },
  pending: {
    bg: "bg-slate-800/80",
    border: "border-amber-500/50",
    iconBg: "bg-amber-500/20",
    iconColor: "text-amber-400",
  },
  running: {
    bg: "bg-slate-800/90",
    border: "border-sky-500/60",
    iconBg: "bg-sky-500/20",
    iconColor: "text-sky-400",
    glow: "shadow-[0_0_24px_-4px_rgba(14,165,233,0.4)]",
  },
  completed: {
    bg: "bg-slate-800/80",
    border: "border-emerald-500/50",
    iconBg: "bg-emerald-500/20",
    iconColor: "text-emerald-400",
  },
  error: {
    bg: "bg-slate-800/80",
    border: "border-rose-500/50",
    iconBg: "bg-rose-500/20",
    iconColor: "text-rose-400",
  },
  handoff: {
    bg: "bg-slate-800/90",
    border: "border-violet-500/60",
    iconBg: "bg-violet-500/20",
    iconColor: "text-violet-400",
    glow: "shadow-[0_0_24px_-4px_rgba(139,92,246,0.4)]",
  },
};

const MODEL_COLORS: Record<string, string> = {
  bedrock: "bg-orange-500",
  anthropic: "bg-amber-500",
  openai: "bg-emerald-500",
  ollama: "bg-blue-500",
  github: "bg-slate-400",
  env: "bg-purple-500",
  parent: "bg-slate-500",
};

// ─────────────────────────────────────────────────────────────────────────────
// StrandsNode Component
// ─────────────────────────────────────────────────────────────────────────────

interface StrandsNodeComponentProps {
  agent: AgentConfig;
  status: AgentStatus;
  result?: AgentResult;
  isEntryPoint?: boolean;
  dependencies?: string[];
  canHandoffTo?: string[];
  isSelected?: boolean;
  onToggleExpand?: () => void;
}

export const StrandsNodeComponent = memo(function StrandsNodeComponent({
  agent,
  status,
  result,
  isEntryPoint = false,
  dependencies = [],
  canHandoffTo = [],
  isSelected = false,
}: StrandsNodeComponentProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const config = STATUS_CONFIG[status];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={cn(
        "relative w-[220px]",
        "rounded-xl border backdrop-blur-sm",
        "transition-all duration-300",
        config.bg,
        config.border,
        config.glow,
        isSelected && "ring-2 ring-offset-2 ring-offset-slate-900 ring-violet-500"
      )}
    >
      {/* Entry Point Badge */}
      {isEntryPoint && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10">
          <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest bg-violet-500 text-white rounded-md shadow-lg">
            Entry
          </span>
        </div>
      )}

      {/* Multi-directional Handles */}
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className="!w-2.5 !h-2.5 !rounded-full !border-2 !bg-slate-700 !border-slate-500 hover:!border-violet-400 !transition-colors"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="!w-2.5 !h-2.5 !rounded-full !border-2 !bg-slate-700 !border-slate-500 hover:!border-violet-400 !transition-colors"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!w-2.5 !h-2.5 !rounded-full !border-2 !bg-slate-700 !border-slate-500 hover:!border-violet-400 !transition-colors"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="!w-2.5 !h-2.5 !rounded-full !border-2 !bg-slate-700 !border-slate-500 hover:!border-violet-400 !transition-colors"
      />

      {/* Main Card Content */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full text-left p-3 hover:bg-white/[0.02] transition-colors rounded-t-xl"
      >
        <div className="flex items-start gap-3">
          {/* Status Icon */}
          <div className={cn(
            "w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0",
            config.iconBg
          )}>
            {status === "running" ? (
              <LoadingSpinner className={cn("w-4 h-4", config.iconColor)} />
            ) : status === "handoff" ? (
              <HandoffIcon className={cn("w-4 h-4", config.iconColor)} />
            ) : status === "completed" ? (
              <CheckIcon className={cn("w-4 h-4", config.iconColor)} />
            ) : status === "error" ? (
              <XIcon className={cn("w-4 h-4", config.iconColor)} />
            ) : (
              <CircleIcon className={cn("w-4 h-4", config.iconColor)} />
            )}
          </div>

          {/* Agent Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm text-slate-100 truncate">
                {agent.name}
              </h3>
              {agent.priority && agent.priority >= 4 && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold bg-violet-500 text-white rounded">
                  P{agent.priority}
                </span>
              )}
            </div>
            
            {agent.description && (
              <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                {agent.description}
              </p>
            )}

            {/* Model Badge */}
            {agent.modelProvider && (
              <div className="flex items-center gap-1.5 mt-2">
                <span className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  MODEL_COLORS[agent.modelProvider] || "bg-slate-500"
                )} />
                <span className="text-[9px] font-medium text-slate-500 uppercase tracking-wide">
                  {agent.modelProvider}
                  {agent.modelId && ` · ${agent.modelId.split("-").slice(-2).join("-").toUpperCase()}`}
                </span>
              </div>
            )}
          </div>

          {/* Expand Icon */}
          <ChevronIcon className={cn(
            "w-4 h-4 text-slate-500 transition-transform flex-shrink-0",
            isExpanded && "rotate-180"
          )} />
        </div>
      </button>

      {/* Expanded Details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-slate-700/50"
          >
            <div className="p-3 space-y-3">
              {/* Tools */}
              {agent.tools && agent.tools.length > 0 && (
                <div>
                  <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider">
                    Tools
                  </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {agent.tools.slice(0, 3).map((tool) => (
                      <span
                        key={tool}
                        className="px-1.5 py-0.5 text-[9px] font-medium bg-slate-700/50 text-slate-300 rounded"
                      >
                        {tool}
                      </span>
                    ))}
                    {agent.tools.length > 3 && (
                      <span className="px-1.5 py-0.5 text-[9px] font-medium text-slate-500">
                        +{agent.tools.length - 3}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Dependencies */}
              {dependencies.length > 0 && (
                <div>
                  <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider">
                    Depends On
                  </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {dependencies.map((dep) => (
                      <span
                        key={dep}
                        className="px-1.5 py-0.5 text-[9px] font-medium bg-sky-500/20 text-sky-300 rounded"
                      >
                        {dep}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Can Handoff To */}
              {canHandoffTo.length > 0 && (
                <div>
                  <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider">
                    Can Handoff To
                  </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {canHandoffTo.map((target) => (
                      <span
                        key={target}
                        className="px-1.5 py-0.5 text-[9px] font-medium bg-violet-500/20 text-violet-300 rounded"
                      >
                        {target}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Result */}
              {result && (
                <div>
                  <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider">
                    Result
                  </span>
                  <div className={cn(
                    "mt-1 p-2 rounded-lg text-[10px] font-mono",
                    result.status === "success"
                      ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                      : "bg-rose-500/10 text-rose-300 border border-rose-500/20"
                  )}>
                    <p className="line-clamp-2">{result.content}</p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// React Flow Node Wrappers
// ─────────────────────────────────────────────────────────────────────────────

type GraphNodeProps = NodeProps & {
  data: GraphNodeData;
};

export function GraphNodeComponent({ data }: GraphNodeProps) {
  return (
    <StrandsNodeComponent
      agent={data.agent}
      status={data.status}
      result={data.result}
      dependencies={data.dependencies}
    />
  );
}

type SwarmNodeProps = NodeProps & {
  data: SwarmNodeData;
};

export function SwarmNodeComponent({ data }: SwarmNodeProps) {
  return (
    <StrandsNodeComponent
      agent={data.agent}
      status={data.status}
      result={data.result}
      isEntryPoint={data.isEntryPoint}
      canHandoffTo={data.canHandoffTo}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────

function LoadingSpinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
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

function HandoffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}
