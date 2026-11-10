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
 *
 * Ren styling: a paper card with hairline border and mono labels. The active node
 * (running / handing off) takes the volt border and a volt status label; status is
 * always spelled out, never colour alone.
 */

"use client";

import { cn } from "@/lib/utils";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { motion, AnimatePresence } from "framer-motion";
import { LoaderCircle } from "lucide-react";
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
  /** Status word in the card's mono label row. */
  label: string;
  /** Card border (volt marks the active node). */
  border: string;
  /** Status icon tile. */
  tile: string;
  /** Status label colour (AA on the card in every theme). */
  text: string;
  /** Hairline halo around the active node (no glow). */
  ring?: string;
}> = {
  idle: {
    label: "Idle",
    border: "border-surface-200 dark:border-surface-800",
    tile: "bg-surface-100 text-ink-muted dark:bg-surface-850 dark:text-ink-inverse-muted",
    text: "text-ink-muted dark:text-ink-inverse-muted",
  },
  pending: {
    label: "Waiting",
    border: "border-dashed border-surface-300 dark:border-surface-700",
    tile: "bg-surface-100 text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary",
    text: "text-ink-secondary dark:text-ink-inverse-secondary",
  },
  running: {
    label: "Running",
    border: "border-blurple-600 dark:border-blurple-400",
    tile: "bg-blurple-50 text-blurple-600 dark:bg-blurple-400/15 dark:text-blurple-300",
    text: "text-blurple-600 dark:text-blurple-400",
    ring: "ring-[3px] ring-blurple-600/10 dark:ring-blurple-400/15",
  },
  completed: {
    label: "Done",
    border: "border-surface-200 dark:border-surface-800",
    tile: "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400",
    text: "text-emerald-700 dark:text-emerald-400",
  },
  error: {
    label: "Failed",
    border: "border-red-300 dark:border-red-900",
    tile: "bg-red-50 text-danger dark:bg-red-950/40",
    text: "text-red-700 dark:text-red-400",
  },
  handoff: {
    label: "Handing off",
    border: "border-blurple-600 dark:border-blurple-400",
    tile: "bg-blurple-600 text-white dark:bg-blurple-400 dark:text-ink",
    text: "text-blurple-600 dark:text-blurple-400",
    ring: "ring-[3px] ring-blurple-600/10 dark:ring-blurple-400/15",
  },
};

// Provider dots: varying shades of volt plus ink, so a mixed graph reads at a glance.
const MODEL_COLORS: Record<string, string> = {
  bedrock: "bg-blurple-600 dark:bg-blurple-400",
  anthropic: "bg-blurple-400 dark:bg-blurple-300",
  openai: "bg-blurple-800 dark:bg-blurple-200",
  ollama: "bg-blurple-300 dark:bg-blurple-600",
  github: "bg-ink dark:bg-ink-inverse",
  env: "bg-blurple-950 dark:bg-blurple-100",
  parent: "bg-surface-400 dark:bg-surface-500",
};

const HANDLE_CLASS =
  "!h-2 !w-2 !rounded-full !border !border-surface-300 !bg-surface-0 dark:!border-surface-600 dark:!bg-surface-900 hover:!border-blurple-500 !transition-colors";

const SECTION_LABEL =
  "font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted";

const CHIP = "inline-flex h-5 items-center rounded-full px-2 font-mono text-[10px] font-medium";

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
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "relative w-[220px] rounded-xl border bg-surface-0 dark:bg-surface-900",
        "text-ink dark:text-ink-inverse",
        "transition-[border-color,box-shadow] duration-200 ease-out",
        config.border,
        config.ring,
        isSelected && "ring-2 ring-blurple-600/70 ring-offset-2 ring-offset-surface-0 dark:ring-blurple-400/70 dark:ring-offset-surface-900"
      )}
    >
      {/* Entry Point Badge: a solid ink pill on the card's top edge */}
      {isEntryPoint && (
        <div className="absolute -top-2.5 left-3 z-10">
          <span className="inline-flex h-5 items-center rounded-full bg-ink px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-white dark:bg-ink-inverse dark:text-ink">
            Entry
          </span>
        </div>
      )}

      {/* Multi-directional Handles */}
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className={HANDLE_CLASS}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className={HANDLE_CLASS}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className={HANDLE_CLASS}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className={HANDLE_CLASS}
      />

      {/* Main Card Content */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full p-3 text-left transition-colors duration-150 ease-out",
          "hover:bg-surface-50 dark:hover:bg-surface-850",
          isExpanded ? "rounded-t-xl" : "rounded-xl"
        )}
      >
        <div className="flex items-start gap-2.5">
          {/* Status Icon */}
          <div className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
            config.tile
          )}>
            {status === "running" ? (
              <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" />
            ) : status === "handoff" ? (
              <HandoffIcon className="h-3.5 w-3.5" />
            ) : status === "completed" ? (
              <CheckIcon className="h-3.5 w-3.5" />
            ) : status === "error" ? (
              <XIcon className="h-3.5 w-3.5" />
            ) : (
              <CircleIcon className="h-3.5 w-3.5" />
            )}
          </div>

          {/* Agent Info */}
          <div className="min-w-0 flex-1">
            <div className="flex h-4 items-center gap-1.5">
              <span className={cn(
                "font-mono text-[10px] font-medium uppercase leading-none tracking-[0.08em]",
                config.text
              )}>
                {config.label}
              </span>
              {agent.priority && agent.priority >= 4 && (
                <span className="inline-flex h-4 items-center rounded border border-surface-200 px-1 font-mono text-[10px] font-semibold leading-none tabular-nums text-ink-secondary dark:border-surface-700 dark:text-ink-inverse-secondary">
                  P{agent.priority}
                </span>
              )}
            </div>
            <h3 className="mt-1 truncate font-display text-[14px] font-semibold leading-snug tracking-[-0.01em] text-ink dark:text-ink-inverse">
              {agent.name}
            </h3>

            {agent.description && (
              <p className="mt-0.5 line-clamp-1 text-[12px] leading-snug text-ink-secondary dark:text-ink-inverse-secondary">
                {agent.description}
              </p>
            )}
          </div>

          {/* Expand Icon */}
          <ChevronIcon className={cn(
            "h-4 w-4 shrink-0 text-ink-muted transition-transform duration-200 ease-out dark:text-ink-inverse-muted",
            isExpanded && "rotate-180"
          )} />
        </div>

        {/* Model Badge */}
        {agent.modelProvider && (
          <div className="mt-2.5 flex items-center gap-1.5 border-t border-surface-100 pt-2 dark:border-surface-800">
            <span className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              MODEL_COLORS[agent.modelProvider] || "bg-surface-400 dark:bg-surface-500"
            )} />
            <span className="truncate font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted">
              {agent.modelProvider}
              {agent.modelId && ` · ${agent.modelId.split("-").slice(-2).join("-").toUpperCase()}`}
            </span>
          </div>
        )}
      </button>

      {/* Expanded Details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-surface-200 dark:border-surface-800"
          >
            <div className="space-y-3 p-3">
              {/* Tools */}
              {agent.tools && agent.tools.length > 0 && (
                <div>
                  <span className={SECTION_LABEL}>
                    Tools
                  </span>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {agent.tools.slice(0, 3).map((tool) => (
                      <span
                        key={tool}
                        className={cn(CHIP, "bg-surface-100 text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary")}
                      >
                        {tool}
                      </span>
                    ))}
                    {agent.tools.length > 3 && (
                      <span className={cn(CHIP, "px-1 tabular-nums text-ink-muted dark:text-ink-inverse-muted")}>
                        +{agent.tools.length - 3}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Dependencies */}
              {dependencies.length > 0 && (
                <div>
                  <span className={SECTION_LABEL}>
                    Depends on
                  </span>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {dependencies.map((dep) => (
                      <span
                        key={dep}
                        className={cn(CHIP, "border border-surface-200 text-ink-secondary dark:border-surface-700 dark:text-ink-inverse-secondary")}
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
                  <span className={SECTION_LABEL}>
                    Can hand off to
                  </span>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {canHandoffTo.map((target) => (
                      <span
                        key={target}
                        className={cn(CHIP, "bg-blurple-50 text-blurple-700 dark:bg-blurple-400/15 dark:text-blurple-200")}
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
                  <span className={SECTION_LABEL}>
                    Result
                  </span>
                  <div className={cn(
                    "mt-1.5 rounded-lg border p-2 font-mono text-[11px] leading-snug",
                    result.status === "success"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300"
                      : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                  )}>
                    <p className="line-clamp-2 text-[11px] leading-snug text-current">{result.content}</p>
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
