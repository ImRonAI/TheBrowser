import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useInterestsStore, getCategoryColor, InterestNode } from '@/stores/interestsStore'
import { InterestNodeComponent } from './InterestNode'
import { useInterestPhysics } from './useInterestPhysics'
import { useUserPreferencesStore } from '@/stores/userPreferencesStore'
import { cn } from '@/utils/cn'

const CANVAS_WIDTH = 520
const CANVAS_HEIGHT = 380

export function NeuralCanvas() {
  const { nodes, connections } = useInterestsStore()
  const { theme } = useUserPreferencesStore()
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)

  // Determine effective theme
  const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const isGlass = theme === 'glass'

  // Apply physics simulation
  useInterestPhysics(CANVAS_WIDTH, CANVAS_HEIGHT)

  // Handle node interactions
  const handleNodeHover = useCallback((nodeId: string | null) => {
    setHoveredNode(nodeId)
  }, [])

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNode(prev => prev === nodeId ? null : nodeId)
  }, [])

  // Get connections for a specific node
  const getNodeConnections = useCallback((nodeId: string) => {
    return connections.filter(c => c.from === nodeId || c.to === nodeId)
  }, [connections])

  // Check if connection should be highlighted
  const isConnectionHighlighted = useCallback((fromId: string, toId: string) => {
    if (!hoveredNode && !selectedNode) return false
    const activeNode = hoveredNode || selectedNode
    return fromId === activeNode || toId === activeNode
  }, [hoveredNode, selectedNode])

  // Theme-adaptive canvas background
  const getCanvasBackground = () => {
    if (isDark) {
      return 'bg-gradient-to-br from-zinc-900/60 to-zinc-950/60'
    } else if (isGlass) {
      return 'bg-transparent' // Let wallpaper show through
    }
    return 'bg-gradient-to-br from-slate-50/80 to-zinc-100/80'
  }

  return (
    <div
      className={cn(
        "relative w-full h-full rounded-xl overflow-hidden",
        getCanvasBackground()
      )}
      style={{ 
        minHeight: CANVAS_HEIGHT,
        backdropFilter: isGlass ? 'blur(4px)' : 'none',
        WebkitBackdropFilter: isGlass ? 'blur(4px)' : 'none'
      }}
    >
      {/* Subtle grid pattern for depth */}
      <div 
        className={cn(
          "absolute inset-0",
          isDark ? "opacity-[0.04]" : isGlass ? "opacity-[0.06]" : "opacity-[0.025]"
        )}
        style={{
          backgroundImage: isDark 
            ? `radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)`
            : `radial-gradient(circle, rgba(0,0,0,0.6) 1px, transparent 1px)`,
          backgroundSize: '28px 28px'
        }}
      />

      {/* SVG Layer for Connections */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Gradient definitions for connections */}
          {connections.map(conn => {
            const fromNode = nodes.find(n => n.id === conn.from)
            const toNode = nodes.find(n => n.id === conn.to)
            if (!fromNode || !toNode) return null

            const fromColor = getCategoryColor(fromNode.category)
            const toColor = getCategoryColor(toNode.category)

            return (
              <linearGradient
                key={`grad-${conn.id}`}
                id={`gradient-${conn.id}`}
                x1="0%"
                y1="0%"
                x2="100%"
                y2="0%"
              >
                <stop offset="0%" stopColor={fromColor} stopOpacity={0.6} />
                <stop offset="50%" stopColor={fromColor} stopOpacity={0.3} />
                <stop offset="100%" stopColor={toColor} stopOpacity={0.6} />
              </linearGradient>
            )
          })}

          {/* Glow filter */}
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Connection lines */}
        <g className="connections">
          {connections.map(conn => {
            const fromNode = nodes.find(n => n.id === conn.from)
            const toNode = nodes.find(n => n.id === conn.to)
            if (!fromNode || !toNode) return null

            const isHighlighted = isConnectionHighlighted(conn.from, conn.to)
            const baseOpacity = conn.strength * 0.5
            const opacity = isHighlighted ? Math.min(1, baseOpacity + 0.4) : baseOpacity

            return (
              <ConnectionLine
                key={conn.id}
                from={fromNode}
                to={toNode}
                strength={conn.strength}
                gradientId={`gradient-${conn.id}`}
                opacity={opacity}
                isHighlighted={isHighlighted}
              />
            )
          })}
        </g>
      </svg>

      {/* Nodes Layer */}
      <div className="absolute inset-0">
        {nodes.map(node => (
          <InterestNodeComponent
            key={node.id}
            node={node}
            isHovered={hoveredNode === node.id}
            isSelected={selectedNode === node.id}
            isConnected={
              hoveredNode
                ? getNodeConnections(hoveredNode).some(
                    c => c.from === node.id || c.to === node.id
                  )
                : false
            }
            onHover={handleNodeHover}
            onClick={handleNodeClick}
            canvasWidth={CANVAS_WIDTH}
            canvasHeight={CANVAS_HEIGHT}
          />
        ))}
      </div>

      {/* Ambient particles for visual depth */}
      <AmbientParticles count={12} isDark={isDark} isGlass={isGlass} />
    </div>
  )
}

// ============================================
// Connection Line Component
// ============================================

interface ConnectionLineProps {
  from: InterestNode
  to: InterestNode
  strength: number
  gradientId: string
  opacity: number
  isHighlighted: boolean
}

function ConnectionLine({
  from,
  to,
  strength,
  gradientId,
  opacity,
  isHighlighted
}: ConnectionLineProps) {
  // Calculate control point for curved line
  const midX = (from.position.x + to.position.x) / 2
  const midY = (from.position.y + to.position.y) / 2
  
  // Add perpendicular offset for curve
  const dx = to.position.x - from.position.x
  const dy = to.position.y - from.position.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  
  // Curve amount based on distance
  const curveAmount = Math.min(30, dist * 0.15)
  const perpX = -dy / dist * curveAmount
  const perpY = dx / dist * curveAmount
  
  const controlX = midX + perpX
  const controlY = midY + perpY

  const pathD = `M ${from.position.x} ${from.position.y} Q ${controlX} ${controlY} ${to.position.x} ${to.position.y}`

  return (
    <motion.path
      d={pathD}
      fill="none"
      stroke={`url(#${gradientId})`}
      strokeWidth={isHighlighted ? strength * 3 + 1 : strength * 2 + 0.5}
      strokeLinecap="round"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ 
        pathLength: 1, 
        opacity,
        filter: isHighlighted ? 'url(#glow)' : 'none'
      }}
      transition={{ 
        pathLength: { duration: 1.5, ease: 'easeOut' },
        opacity: { duration: 0.3 }
      }}
    />
  )
}

// ============================================
// Ambient Particles
// ============================================

interface AmbientParticlesProps {
  count: number
  isDark: boolean
  isGlass: boolean
}

function AmbientParticles({ count, isDark, isGlass }: AmbientParticlesProps) {
  // Theme-adaptive particle colors
  const getParticleColor = () => {
    if (isDark) return 'rgba(99, 102, 241, 0.25)' // Indigo
    if (isGlass) return 'rgba(45, 59, 135, 0.2)' // Royal
    return 'rgba(45, 59, 135, 0.15)' // Royal lighter
  }

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: 3 + Math.random() * 3,
            height: 3 + Math.random() * 3,
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            backgroundColor: getParticleColor(),
            boxShadow: isDark 
              ? '0 0 6px rgba(99, 102, 241, 0.3)' 
              : '0 0 4px rgba(45, 59, 135, 0.2)'
          }}
          animate={{
            x: [0, (Math.random() - 0.5) * 40, 0],
            y: [0, (Math.random() - 0.5) * 40, 0],
            opacity: [0.3, 0.6, 0.3],
            scale: [1, 1.3, 1]
          }}
          transition={{
            duration: 10 + Math.random() * 5,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: i * 0.4
          }}
        />
      ))}
    </div>
  )
}

