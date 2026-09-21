/**
 * StrandsPromptNode Component
 * 
 * A specialized React Flow node for displaying the prompt/input in an
 * orchestration workflow. This shows the user's input or task description
 * as the starting point of the agent workflow.
 * 
 * Features:
 * - Clean, minimal input display
 * - Visual distinction from agent nodes
 * - Connection point to entry agent
 */

"use client";

import { cn } from "@/lib/utils";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { motion } from "framer-motion";
import { memo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PromptNodeData {
  [key: string]: unknown;
  type: "prompt-node";
  prompt: string;
  label?: string;
  icon?: "chat" | "task" | "search" | "code";
}

// ─────────────────────────────────────────────────────────────────────────────
// PromptNode Component
// ─────────────────────────────────────────────────────────────────────────────

interface PromptNodeComponentProps {
  prompt: string;
  label?: string;
  icon?: "chat" | "task" | "search" | "code";
}

export const PromptNodeComponent = memo(function PromptNodeComponent({
  prompt,
  label = "Input",
  icon = "chat",
}: PromptNodeComponentProps) {
  const IconComponent = {
    chat: ChatIcon,
    task: TaskIcon,
    search: SearchIcon,
    code: CodeIcon,
  }[icon];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={cn(
        "relative w-[260px]",
        "rounded-xl",
        "bg-gradient-to-br from-violet-600/20 to-indigo-600/20",
        "border border-violet-500/30",
        "backdrop-blur-sm",
        "shadow-xl shadow-violet-500/10"
      )}
    >
      {/* Source Handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !rounded-full !border-2 !bg-violet-500 !border-violet-400 !transition-all hover:!scale-125"
      />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-violet-500/20">
        <div className="w-6 h-6 rounded-lg bg-violet-500/30 flex items-center justify-center">
          <IconComponent className="w-3.5 h-3.5 text-violet-300" />
        </div>
        <span className="text-[10px] font-semibold text-violet-300 uppercase tracking-wider">
          {label}
        </span>
      </div>

      {/* Content */}
      <div className="p-3">
        <p className="text-sm text-slate-200 leading-relaxed line-clamp-3">
          {prompt}
        </p>
      </div>

      {/* Decorative glow */}
      <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-violet-500/5 to-transparent pointer-events-none" />
    </motion.div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// React Flow Node Wrapper
// ─────────────────────────────────────────────────────────────────────────────

type PromptNodeProps = NodeProps & {
  data: PromptNodeData;
};

export function PromptNode({ data }: PromptNodeProps) {
  return (
    <PromptNodeComponent
      prompt={data.prompt}
      label={data.label}
      icon={data.icon}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function TaskIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function CodeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

