/**
 * StrandsEdge Component
 * 
 * Custom React Flow edge components for visualizing connections in
 * Strands Graph and Swarm orchestration patterns.
 * 
 * Features:
 * - Smart curved edges that avoid crossings
 * - Conditional edges with condition labels (Graph pattern)
 * - Animated data flow visualization
 * - Handoff message display (Swarm pattern)
 * - Active/inactive state styling
 */

"use client";

import { cn } from "@/lib/utils";
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
  type InternalNode,
  type Node,
  Position,
  useInternalNode,
} from "@xyflow/react";
import { motion } from "framer-motion";
import { memo } from "react";
import type { GraphEdgeData, SwarmEdgeData, StrandsGraphEdge, StrandsSwarmEdge } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getHandleCoordsByPosition(
  node: InternalNode<Node>,
  handlePosition: Position,
  handleType: "source" | "target"
) {
  const handle = node.internals.handleBounds?.[handleType]?.find(
    (h) => h.position === handlePosition
  );

  if (!handle) {
    // Fallback to center of node
    const x = node.internals.positionAbsolute.x + (node.measured?.width ?? 0) / 2;
    const y = node.internals.positionAbsolute.y + (node.measured?.height ?? 0) / 2;
    return [x, y] as const;
  }

  let offsetX = handle.width / 2;
  let offsetY = handle.height / 2;

  switch (handlePosition) {
    case Position.Left:
      offsetX = 0;
      break;
    case Position.Right:
      offsetX = handle.width;
      break;
    case Position.Top:
      offsetY = 0;
      break;
    case Position.Bottom:
      offsetY = handle.height;
      break;
  }

  const x = node.internals.positionAbsolute.x + handle.x + offsetX;
  const y = node.internals.positionAbsolute.y + handle.y + offsetY;

  return [x, y] as const;
}

// Determine best handle positions based on node positions
function getOptimalHandlePositions(
  source: InternalNode<Node>,
  target: InternalNode<Node>
): { sourcePos: Position; targetPos: Position } {
  const sx = source.internals.positionAbsolute.x + (source.measured?.width ?? 0) / 2;
  const sy = source.internals.positionAbsolute.y + (source.measured?.height ?? 0) / 2;
  const tx = target.internals.positionAbsolute.x + (target.measured?.width ?? 0) / 2;
  const ty = target.internals.positionAbsolute.y + (target.measured?.height ?? 0) / 2;

  const dx = tx - sx;
  const dy = ty - sy;

  // Predominantly horizontal
  if (Math.abs(dx) > Math.abs(dy)) {
    return {
      sourcePos: dx > 0 ? Position.Right : Position.Left,
      targetPos: dx > 0 ? Position.Left : Position.Right,
    };
  }
  
  // Predominantly vertical
  return {
    sourcePos: dy > 0 ? Position.Bottom : Position.Top,
    targetPos: dy > 0 ? Position.Top : Position.Bottom,
  };
}

function getEdgeParams(source: InternalNode<Node>, target: InternalNode<Node>) {
  const { sourcePos, targetPos } = getOptimalHandlePositions(source, target);
  const [sx, sy] = getHandleCoordsByPosition(source, sourcePos, "source");
  const [tx, ty] = getHandleCoordsByPosition(target, targetPos, "target");

  return { sx, sy, tx, ty, sourcePos, targetPos };
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph Edge Component (Conditional)
// ─────────────────────────────────────────────────────────────────────────────

export const GraphEdgeComponent = memo(function GraphEdgeComponent({
  id,
  source,
  target,
  data,
}: EdgeProps<StrandsGraphEdge>) {
  const sourceNode = useInternalNode(source as string);
  const targetNode = useInternalNode(target as string);

  if (!(sourceNode && targetNode)) {
    return null;
  }

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(sourceNode, targetNode);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetX: tx,
    targetY: ty,
    targetPosition: targetPos,
    borderRadius: 16,
  });

  const edgeData = (data || {}) as GraphEdgeData;
  const isConditional = edgeData.isConditional ?? false;
  const isActive = edgeData.isActive ?? false;
  const isAnimated = edgeData.isAnimated ?? isActive;
  const condition = edgeData.condition;

  return (
    <>
      {/* Main edge */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: isActive
            ? isConditional
              ? "rgb(139, 92, 246)"
              : "rgb(14, 165, 233)"
            : "rgb(148, 163, 184)",
          strokeWidth: isActive ? 2.5 : 1.5,
          strokeDasharray: isConditional ? "8 4" : "none",
          transition: "stroke 0.3s, stroke-width 0.3s",
        }}
        markerEnd={isActive ? `url(#arrow-${isConditional ? "conditional" : "normal"})` : undefined}
      />

      {/* Animated particle */}
      {isAnimated && (
        <motion.circle
          r="4"
          fill={isConditional ? "rgb(139, 92, 246)" : "rgb(14, 165, 233)"}
          filter="drop-shadow(0 0 4px currentColor)"
        >
          <animateMotion
            dur={isConditional ? "2.5s" : "1.5s"}
            path={edgePath}
            repeatCount="indefinite"
          />
        </motion.circle>
      )}

      {/* Condition label */}
      {isConditional && condition && (
        <EdgeLabelRenderer>
          <div
            className="absolute pointer-events-auto nodrag nopan transform -translate-x-1/2 -translate-y-1/2"
            style={{ left: labelX, top: labelY }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className={cn(
                "px-2 py-1 rounded-md text-[10px] font-medium border backdrop-blur-sm",
                isActive || condition.isActive
                  ? "bg-violet-100 dark:bg-violet-900/50 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300"
                  : "bg-slate-100 dark:bg-slate-800/50 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400"
              )}
            >
              <span className="flex items-center gap-1">
                <ConditionIcon className="w-3 h-3" />
                {condition.label}
              </span>
            </motion.div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Swarm Edge Component (Handoff) - Refined Design
// ─────────────────────────────────────────────────────────────────────────────

export const SwarmEdgeComponent = memo(function SwarmEdgeComponent({
  id,
  source,
  target,
  data,
}: EdgeProps<StrandsSwarmEdge>) {
  const sourceNode = useInternalNode(source as string);
  const targetNode = useInternalNode(target as string);

  if (!(sourceNode && targetNode)) {
    return null;
  }

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(sourceNode, targetNode);

  // Use smooth step path for cleaner routing
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetX: tx,
    targetY: ty,
    targetPosition: targetPos,
    borderRadius: 20,
    offset: 15,
  });

  const edgeData = (data || {}) as SwarmEdgeData;
  const isActive = edgeData.isActive ?? false;
  const isAnimated = edgeData.isAnimated ?? isActive;
  const handoffMessage = edgeData.handoffMessage;

  return (
    <>
      {/* Main edge - elegant dashed line for potential, solid for active */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: isActive
            ? "rgb(139, 92, 246)"
            : "rgba(148, 163, 184, 0.4)",
          strokeWidth: isActive ? 2 : 1,
          strokeDasharray: isActive ? "none" : "6 4",
          transition: "stroke 0.4s ease, stroke-width 0.4s ease",
        }}
        markerEnd={isActive ? "url(#arrow-handoff)" : undefined}
      />

      {/* Animated handoff particle */}
      {isAnimated && (
        <>
          <motion.circle
            r="5"
            fill="rgb(139, 92, 246)"
            filter="drop-shadow(0 0 8px rgba(139, 92, 246, 0.6))"
          >
            <animateMotion dur="1s" path={edgePath} repeatCount="indefinite" />
          </motion.circle>
          {/* Trail */}
          <motion.circle r="3" fill="rgba(139, 92, 246, 0.4)">
            <animateMotion dur="1s" path={edgePath} repeatCount="indefinite" begin="0.15s" />
          </motion.circle>
        </>
      )}

      {/* Handoff message tooltip */}
      {handoffMessage && isActive && (
        <EdgeLabelRenderer>
          <div
            className="absolute pointer-events-auto nodrag nopan transform -translate-x-1/2"
            style={{ left: labelX, top: labelY - 24 }}
          >
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              className={cn(
                "max-w-[180px] px-2.5 py-1.5 rounded-lg text-[11px]",
                "bg-violet-600 text-white shadow-xl",
                "border border-violet-400/30"
              )}
            >
              <span className="flex items-start gap-1.5">
                <HandoffIcon className="w-3 h-3 mt-0.5 flex-shrink-0 opacity-70" />
                <span className="line-clamp-2 leading-snug">{handoffMessage}</span>
              </span>
            </motion.div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge Markers (SVG Definitions)
// ─────────────────────────────────────────────────────────────────────────────

export function EdgeMarkerDefinitions() {
  return (
    <svg style={{ position: "absolute", width: 0, height: 0 }}>
      <defs>
        <marker
          id="arrow-normal"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(14, 165, 233)" />
        </marker>

        <marker
          id="arrow-conditional"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(139, 92, 246)" />
        </marker>

        <marker
          id="arrow-handoff"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(139, 92, 246)" />
        </marker>
      </defs>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending/Temporary Edge
// ─────────────────────────────────────────────────────────────────────────────

export const PendingEdge = memo(function PendingEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        stroke: "rgb(148, 163, 184)",
        strokeWidth: 2,
        strokeDasharray: "6 3",
      }}
    />
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────

function ConditionIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12h6l4-8 4 16 4-8h2" />
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
