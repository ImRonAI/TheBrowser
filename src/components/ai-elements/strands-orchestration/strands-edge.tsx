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
 *
 * Ren styling: idle edges are ink hairlines, live flow is volt. Colours come from the
 * theme's CSS variables (`--ren-ink`, `--ren-volt`), so Light, Dark and Glass all follow.
 * Flow particles are hidden under reduced motion.
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
import { ArrowRight, Split } from "lucide-react";
import { memo } from "react";
import type { GraphEdgeData, SwarmEdgeData, StrandsGraphEdge, StrandsSwarmEdge } from "./types";

// Theme-following stroke colours (index.css: --ren-ink / --ren-volt flip with .dark).
const VOLT = "rgb(var(--ren-volt))";
const VOLT_TRAIL = "rgb(var(--ren-volt) / 0.4)";
const INK_HAIRLINE = "rgb(var(--ren-ink) / 0.22)";
const INK_POTENTIAL = "rgb(var(--ren-ink) / 0.16)";
const INK_PENDING = "rgb(var(--ren-ink) / 0.3)";

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
      {/* Main edge: ink hairline at rest, volt while data flows; conditions are dashed */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: isActive ? VOLT : INK_HAIRLINE,
          strokeWidth: isActive ? 2 : 1.25,
          strokeDasharray: isConditional ? "6 4" : "none",
          transition: "stroke 200ms ease-out, stroke-width 200ms ease-out",
        }}
        markerEnd={isActive ? `url(#arrow-${isConditional ? "conditional" : "normal"})` : undefined}
      />

      {/* Animated particle (live flow only; hidden under reduced motion) */}
      {isAnimated && (
        <motion.circle r="3" className="motion-reduce:hidden" style={{ fill: VOLT }}>
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
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-full border px-2.5",
                "font-mono text-[11px] font-medium leading-none transition-colors duration-200",
                isActive || condition.isActive
                  ? "border-blurple-600/30 bg-blurple-50 text-blurple-700 dark:border-blurple-400/30 dark:bg-blurple-950 dark:text-blurple-200"
                  : "border-surface-200 bg-card text-ink-secondary dark:border-surface-800 dark:text-ink-inverse-secondary"
              )}
            >
              <Split className="h-3 w-3 shrink-0" />
              {condition.label}
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
      {/* Main edge: dashed ink hairline for a possible handoff, solid volt for the live one */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: isActive ? VOLT : INK_POTENTIAL,
          strokeWidth: isActive ? 2 : 1,
          strokeDasharray: isActive ? "none" : "4 4",
          transition: "stroke 200ms ease-out, stroke-width 200ms ease-out",
        }}
        markerEnd={isActive ? "url(#arrow-handoff)" : undefined}
      />

      {/* Animated handoff particle (hidden under reduced motion) */}
      {isAnimated && (
        <>
          <motion.circle r="3.5" className="motion-reduce:hidden" style={{ fill: VOLT }}>
            <animateMotion dur="1s" path={edgePath} repeatCount="indefinite" />
          </motion.circle>
          {/* Trail */}
          <motion.circle r="2" className="motion-reduce:hidden" style={{ fill: VOLT_TRAIL }}>
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
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className={cn(
                "max-w-[200px] rounded-lg px-2.5 py-1.5 text-[11px] font-medium shadow-float",
                "bg-blurple-600 text-white dark:bg-blurple-400 dark:text-ink"
              )}
            >
              <span className="flex items-start gap-1.5">
                <ArrowRight className="mt-0.5 h-3 w-3 shrink-0" />
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
          <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: VOLT }} />
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
          <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: VOLT }} />
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
          <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: VOLT }} />
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
        stroke: INK_PENDING,
        strokeWidth: 1.5,
        strokeDasharray: "6 3",
      }}
    />
  );
});
