import { useEffect, useRef } from 'react'
import { useInterestsStore } from '@/stores/interestsStore'

// Physics constants - SPREAD but CENTERED and VISIBLE
const REPULSION_STRENGTH = 12000    // Strong repulsion - stay apart
const ATTRACTION_STRENGTH = 0.002   // Tiny attraction to keep connected
const CENTER_GRAVITY = 0.002        // Very slight center pull to stay visible
const DAMPING = 0.9                 // Velocity damping (0-1)
const MIN_DISTANCE = 130            // Keep big nodes apart
const MAX_VELOCITY = 4              // Smooth movement
const BOUNDARY_PADDING = 70         // Keep nodes away from edges

interface Vector {
  x: number
  y: number
}

/**
 * Custom hook that applies force-directed physics to interest nodes
 * Creates organic, floating movement with collision avoidance
 */
export function useInterestPhysics(canvasWidth: number, canvasHeight: number) {
  const animationRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number>(0)
  
  const { nodes, updateNodePosition, updateNodeVelocity } = useInterestsStore()

  useEffect(() => {
    if (nodes.length === 0) return

    const centerX = canvasWidth / 2
    const centerY = canvasHeight / 2

    // Physics simulation step
    const simulate = (timestamp: number) => {
      // Calculate delta time (cap at 50ms to prevent huge jumps)
      const deltaTime = Math.min((timestamp - lastTimeRef.current) / 1000, 0.05)
      lastTimeRef.current = timestamp

      // Skip if delta is too small
      if (deltaTime < 0.001) {
        animationRef.current = requestAnimationFrame(simulate)
        return
      }

      // Get current state
      const currentNodes = useInterestsStore.getState().nodes
      const currentConnections = useInterestsStore.getState().connections

      // Calculate forces for each node
      const forces: Map<string, Vector> = new Map()

      for (const node of currentNodes) {
        let fx = 0
        let fy = 0

        // 1. Repulsion from other nodes (Coulomb's law style) - SPREAD THEM OUT
        for (const other of currentNodes) {
          if (other.id === node.id) continue

          const dx = node.position.x - other.position.x
          const dy = node.position.y - other.position.y
          const distSq = dx * dx + dy * dy
          const dist = Math.sqrt(distSq)

          if (dist < MIN_DISTANCE) {
            // Very strong repulsion when too close
            const force = REPULSION_STRENGTH / Math.max(distSq, 50)
            const nx = dx / Math.max(dist, 1)
            const ny = dy / Math.max(dist, 1)
            fx += nx * force
            fy += ny * force
          } else if (dist < 300) {
            // Still repel at medium distance - keep spreading
            const force = REPULSION_STRENGTH / (distSq * 1.5)
            const nx = dx / dist
            const ny = dy / dist
            fx += nx * force
            fy += ny * force
          }
        }

        // 2. Attraction to connected nodes (spring force) - VERY WEAK
        const nodeConnections = currentConnections.filter(
          c => c.from === node.id || c.to === node.id
        )

        for (const conn of nodeConnections) {
          const otherId = conn.from === node.id ? conn.to : conn.from
          const other = currentNodes.find(n => n.id === otherId)
          if (!other) continue

          const dx = other.position.x - node.position.x
          const dy = other.position.y - node.position.y
          const dist = Math.sqrt(dx * dx + dy * dy)

          // Spring force - only pull if VERY far, let them spread out
          const targetDist = 180 + (1 - conn.strength) * 80 // Much larger target distance
          if (dist > targetDist) {
            const force = (dist - targetDist) * ATTRACTION_STRENGTH * conn.strength * 0.5
            const nx = dx / Math.max(dist, 1)
            const ny = dy / Math.max(dist, 1)
            fx += nx * force
            fy += ny * force
          }
        }

        // 3. Center gravity - gentle pull to keep nodes visible and centered
        const dxCenter = centerX - node.position.x
        const dyCenter = centerY - node.position.y
        fx += dxCenter * CENTER_GRAVITY
        fy += dyCenter * CENTER_GRAVITY

        // 4. Boundary repulsion - push away from edges
        const boundaryForce = 50
        if (node.position.x < BOUNDARY_PADDING) {
          fx += boundaryForce * (1 - node.position.x / BOUNDARY_PADDING)
        }
        if (node.position.x > canvasWidth - BOUNDARY_PADDING) {
          fx -= boundaryForce * (1 - (canvasWidth - node.position.x) / BOUNDARY_PADDING)
        }
        if (node.position.y < BOUNDARY_PADDING) {
          fy += boundaryForce * (1 - node.position.y / BOUNDARY_PADDING)
        }
        if (node.position.y > canvasHeight - BOUNDARY_PADDING) {
          fy -= boundaryForce * (1 - (canvasHeight - node.position.y) / BOUNDARY_PADDING)
        }

        // 5. Add subtle random drift for organic feel
        const drift = 0.5
        fx += (Math.random() - 0.5) * drift
        fy += (Math.random() - 0.5) * drift

        forces.set(node.id, { x: fx, y: fy })
      }

      // Apply forces and update positions
      for (const node of currentNodes) {
        const force = forces.get(node.id)
        if (!force) continue

        // Update velocity
        let vx = (node.velocity.x + force.x * deltaTime) * DAMPING
        let vy = (node.velocity.y + force.y * deltaTime) * DAMPING

        // Cap velocity
        const speed = Math.sqrt(vx * vx + vy * vy)
        if (speed > MAX_VELOCITY) {
          vx = (vx / speed) * MAX_VELOCITY
          vy = (vy / speed) * MAX_VELOCITY
        }

        // Update position
        let newX = node.position.x + vx
        let newY = node.position.y + vy

        // Clamp to bounds
        newX = Math.max(BOUNDARY_PADDING, Math.min(canvasWidth - BOUNDARY_PADDING, newX))
        newY = Math.max(BOUNDARY_PADDING, Math.min(canvasHeight - BOUNDARY_PADDING, newY))

        // Only update if position changed significantly
        const dx = newX - node.position.x
        const dy = newY - node.position.y
        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
          updateNodePosition(node.id, { x: newX, y: newY })
          updateNodeVelocity(node.id, { x: vx, y: vy })
        }
      }

      // Continue simulation
      animationRef.current = requestAnimationFrame(simulate)
    }

    // Start simulation
    lastTimeRef.current = performance.now()
    animationRef.current = requestAnimationFrame(simulate)

    // Cleanup
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [nodes.length, canvasWidth, canvasHeight, updateNodePosition, updateNodeVelocity])
}

/**
 * Utility to initialize node positions - CENTERED and VISIBLE
 */
export function initializeNodePositions(
  nodes: ReturnType<typeof useInterestsStore.getState>['nodes'],
  canvasWidth: number,
  canvasHeight: number
) {
  const padding = 70
  const usableW = canvasWidth - padding * 2
  const usableH = canvasHeight - padding * 2
  
  // Centered positions - all visible
  const positions = [
    { x: 0.5, y: 0.25 },
    { x: 0.2, y: 0.35 },
    { x: 0.8, y: 0.35 },
    { x: 0.35, y: 0.6 },
    { x: 0.65, y: 0.6 },
    { x: 0.2, y: 0.8 },
    { x: 0.8, y: 0.8 },
    { x: 0.5, y: 0.75 },
    { x: 0.5, y: 0.5 },
    { x: 0.35, y: 0.15 },
  ]
  
  return nodes.map((node, i) => {
    const pos = positions[i % positions.length]
    return {
      ...node,
      position: {
        x: padding + pos.x * usableW,
        y: padding + pos.y * usableH
      },
      velocity: { x: 0, y: 0 }
    }
  })
}

