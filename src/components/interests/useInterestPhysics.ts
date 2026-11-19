import { useEffect, useMemo, useRef, useState } from 'react'
import { useInterestsStore, type InterestNode } from '@/stores/interestsStore'

// Physics constants - SPREAD but CENTERED and VISIBLE
const REPULSION_STRENGTH = 12000 // Strong repulsion - stay apart
const ATTRACTION_STRENGTH = 0.002 // Tiny attraction to keep connected
const CENTER_GRAVITY = 0.002 // Very slight center pull to stay visible
const DAMPING = 0.9 // Velocity damping (0-1)
const MIN_DISTANCE = 130 // Keep big nodes apart
const MAX_VELOCITY = 4 // Smooth movement
const BOUNDARY_PADDING = 70 // Keep nodes away from edges

interface Vector {
  x: number
  y: number
}

interface SimBody {
  position: Vector
  velocity: Vector
}

/**
 * Custom hook that applies force-directed physics to interest nodes locally in memory
 * (without writing 60x/sec into persisted Zustand `localStorage` or IPC).
 */
export function useInterestPhysics(canvasWidth: number, canvasHeight: number): InterestNode[] {
  const nodes = useInterestsStore((state) => state.nodes)
  const connections = useInterestsStore((state) => state.connections)
  const bodiesRef = useRef<Map<string, SimBody>>(new Map())
  const [, setFrame] = useState(0)

  const nodeSignature = useMemo(() => nodes.map((n) => n.id).join('|'), [nodes])

  useEffect(() => {
    const bodies = bodiesRef.current
    const activeIds = new Set(nodes.map((n) => n.id))
    for (const id of bodies.keys()) {
      if (!activeIds.has(id)) bodies.delete(id)
    }
    for (const node of nodes) {
      if (!bodies.has(node.id)) {
        bodies.set(node.id, {
          position: { ...node.position },
          velocity: { ...node.velocity },
        })
      }
    }
  }, [nodes, nodeSignature])

  useEffect(() => {
    if (nodes.length === 0) return

    let animationId: number | null = null
    let lastTime = performance.now()
    const centerX = canvasWidth / 2
    const centerY = canvasHeight / 2

    const simulate = (timestamp: number) => {
      const deltaTime = Math.min((timestamp - lastTime) / 1000, 0.05)
      lastTime = timestamp

      if (deltaTime < 0.001) {
        animationId = requestAnimationFrame(simulate)
        return
      }

      const currentNodes = useInterestsStore.getState().nodes
      const currentConnections = useInterestsStore.getState().connections
      const bodies = bodiesRef.current

      for (const node of currentNodes) {
        if (!bodies.has(node.id)) {
          bodies.set(node.id, { position: { ...node.position }, velocity: { ...node.velocity } })
        }
      }

      const forces = new Map<string, Vector>()

      for (const node of currentNodes) {
        const body = bodies.get(node.id)!
        let fx = 0
        let fy = 0

        for (const other of currentNodes) {
          if (other.id === node.id) continue
          const otherBody = bodies.get(other.id) ?? other
          const dx = body.position.x - otherBody.position.x
          const dy = body.position.y - otherBody.position.y
          const distSq = dx * dx + dy * dy
          const dist = Math.sqrt(distSq)

          if (dist < MIN_DISTANCE) {
            const force = REPULSION_STRENGTH / Math.max(distSq, 50)
            fx += (dx / Math.max(dist, 1)) * force
            fy += (dy / Math.max(dist, 1)) * force
          } else if (dist < 300) {
            const force = REPULSION_STRENGTH / (distSq * 1.5)
            fx += (dx / dist) * force
            fy += (dy / dist) * force
          }
        }

        for (const conn of currentConnections) {
          if (conn.from !== node.id && conn.to !== node.id) continue
          const otherId = conn.from === node.id ? conn.to : conn.from
          const otherBody = bodies.get(otherId)
          if (!otherBody) continue
          const dx = otherBody.position.x - body.position.x
          const dy = otherBody.position.y - body.position.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          const targetDist = 180 + (1 - conn.strength) * 80
          if (dist > targetDist) {
            const force = (dist - targetDist) * ATTRACTION_STRENGTH * conn.strength * 0.5
            fx += (dx / Math.max(dist, 1)) * force
            fy += (dy / Math.max(dist, 1)) * force
          }
        }

        fx += (centerX - body.position.x) * CENTER_GRAVITY
        fy += (centerY - body.position.y) * CENTER_GRAVITY

        const boundaryForce = 50
        if (body.position.x < BOUNDARY_PADDING) {
          fx += boundaryForce * (1 - body.position.x / BOUNDARY_PADDING)
        }
        if (body.position.x > canvasWidth - BOUNDARY_PADDING) {
          fx -= boundaryForce * (1 - (canvasWidth - body.position.x) / BOUNDARY_PADDING)
        }
        if (body.position.y < BOUNDARY_PADDING) {
          fy += boundaryForce * (1 - body.position.y / BOUNDARY_PADDING)
        }
        if (body.position.y > canvasHeight - BOUNDARY_PADDING) {
          fy -= boundaryForce * (1 - (canvasHeight - body.position.y) / BOUNDARY_PADDING)
        }

        const drift = 0.5
        fx += (Math.random() - 0.5) * drift
        fy += (Math.random() - 0.5) * drift

        forces.set(node.id, { x: fx, y: fy })
      }

      let moved = false
      for (const node of currentNodes) {
        const force = forces.get(node.id)
        const body = bodies.get(node.id)
        if (!force || !body) continue

        let vx = (body.velocity.x + force.x * deltaTime) * DAMPING
        let vy = (body.velocity.y + force.y * deltaTime) * DAMPING
        const speed = Math.sqrt(vx * vx + vy * vy)
        if (speed > MAX_VELOCITY) {
          vx = (vx / speed) * MAX_VELOCITY
          vy = (vy / speed) * MAX_VELOCITY
        }

        const newX = Math.max(BOUNDARY_PADDING, Math.min(canvasWidth - BOUNDARY_PADDING, body.position.x + vx))
        const newY = Math.max(BOUNDARY_PADDING, Math.min(canvasHeight - BOUNDARY_PADDING, body.position.y + vy))

        if (Math.abs(newX - body.position.x) > 0.1 || Math.abs(newY - body.position.y) > 0.1) {
          body.position = { x: newX, y: newY }
          body.velocity = { x: vx, y: vy }
          moved = true
        }
      }

      if (moved) {
        setFrame((f) => (f + 1) & 0xffff)
      }
      animationId = requestAnimationFrame(simulate)
    }

    animationId = requestAnimationFrame(simulate)
    return () => {
      if (animationId !== null) cancelAnimationFrame(animationId)
    }
  }, [nodeSignature, connections.length, canvasWidth, canvasHeight, nodes.length])

  return nodes.map((node) => {
    const body = bodiesRef.current.get(node.id)
    return body ? { ...node, position: body.position, velocity: body.velocity } : node
  })
}

/**
 * Utility to initialize node positions - CENTERED and VISIBLE
 */
export function initializeNodePositions(
  nodes: ReturnType<typeof useInterestsStore.getState>['nodes'],
  canvasWidth: number,
  canvasHeight: number,
) {
  const padding = 70
  const usableW = canvasWidth - padding * 2
  const usableH = canvasHeight - padding * 2

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
    const pos = positions[i % positions.length] ?? { x: 0.5, y: 0.5 }
    return {
      ...node,
      position: {
        x: padding + pos.x * usableW,
        y: padding + pos.y * usableH,
      },
      velocity: { x: 0, y: 0 },
    }
  })
}
