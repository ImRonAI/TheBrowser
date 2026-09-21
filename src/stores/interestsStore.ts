import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useOnboardingStore } from './onboardingStore'

// ============================================
// Types
// ============================================

export interface InterestNode {
  id: string
  label: string
  weight: number           // 0-1, strength of interest
  category: InterestCategory
  source: 'onboarding' | 'browsing'
  lastUpdated: number
  position: { x: number; y: number }
  velocity: { x: number; y: number }
}

export interface InterestConnection {
  id: string
  from: string
  to: string
  strength: number         // 0-1, relationship strength
}

export type InterestCategory = 
  | 'technology'
  | 'design'
  | 'ai'
  | 'privacy'
  | 'productivity'
  | 'learning'
  | 'entertainment'
  | 'news'
  | 'other'

// Category keywords for auto-classification
const CATEGORY_KEYWORDS: Record<InterestCategory, string[]> = {
  technology: ['tech', 'software', 'hardware', 'programming', 'code', 'developer', 'engineering', 'computer', 'app', 'web'],
  design: ['design', 'ui', 'ux', 'visual', 'aesthetic', 'creative', 'art', 'graphics', 'typography', 'color'],
  ai: ['ai', 'artificial intelligence', 'machine learning', 'ml', 'neural', 'gpt', 'llm', 'automation', 'agent'],
  privacy: ['privacy', 'security', 'encryption', 'anonymous', 'data', 'tracking', 'vpn', 'secure'],
  productivity: ['productivity', 'efficient', 'workflow', 'organize', 'task', 'time', 'management', 'focus'],
  learning: ['learn', 'education', 'research', 'study', 'knowledge', 'course', 'tutorial', 'understand'],
  entertainment: ['entertainment', 'video', 'music', 'game', 'fun', 'movie', 'show', 'stream'],
  news: ['news', 'current', 'events', 'politics', 'world', 'breaking', 'update', 'headline'],
  other: []
}

// ============================================
// Store Interface
// ============================================

// Maximum number of nodes to prevent overcrowding
const MAX_NODES = 8

interface InterestsState {
  nodes: InterestNode[]
  connections: InterestConnection[]
  isInitialized: boolean
  isExpanded: boolean

  // Actions
  initializeFromOnboarding: () => void
  addInterest: (label: string, source: 'onboarding' | 'browsing', weight?: number) => void
  recordInteraction: (topic: string, delta?: number) => void
  removeInterest: (id: string) => void
  updateNodePosition: (id: string, position: { x: number; y: number }) => void
  updateNodeVelocity: (id: string, velocity: { x: number; y: number }) => void
  getTopInterests: (n: number) => InterestNode[]
  setExpanded: (expanded: boolean) => void
  toggleExpanded: () => void
  decayWeights: () => void
  resetInterests: () => void
}

// ============================================
// Utility Functions
// ============================================

function generateId(): string {
  return `interest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

function classifyCategory(label: string): InterestCategory {
  const lowerLabel = label.toLowerCase()
  
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === 'other') continue
    if (keywords.some(keyword => lowerLabel.includes(keyword))) {
      return category as InterestCategory
    }
  }
  
  return 'other'
}

function generateInitialPosition(existingNodes: InterestNode[]): { x: number; y: number } {
  // Canvas: 520x380 - centered spread that stays visible
  const padding = 70 // Safe margin for large nodes
  const usableWidth = 520 - (padding * 2)   // ~380px usable
  const usableHeight = 380 - (padding * 2)  // ~240px usable
  
  // Pre-defined positions - CENTERED and all visible
  const positions = [
    { x: 0.5, y: 0.25 },   // Top center
    { x: 0.2, y: 0.35 },   // Upper left
    { x: 0.8, y: 0.35 },   // Upper right
    { x: 0.35, y: 0.6 },   // Middle left
    { x: 0.65, y: 0.6 },   // Middle right
    { x: 0.2, y: 0.8 },    // Bottom left
    { x: 0.8, y: 0.8 },    // Bottom right
    { x: 0.5, y: 0.75 },   // Bottom center
    { x: 0.5, y: 0.5 },    // Dead center
    { x: 0.35, y: 0.15 },  // Top left area
  ]
  
  const idx = existingNodes.length % positions.length
  const pos = positions[idx]
  
  // Small jitter for variety
  const jitter = 15
  
  return {
    x: padding + (pos.x * usableWidth) + (Math.random() - 0.5) * jitter,
    y: padding + (pos.y * usableHeight) + (Math.random() - 0.5) * jitter
  }
}

function calculateConnectionStrength(node1: InterestNode, node2: InterestNode): number {
  // Same category = stronger connection
  if (node1.category === node2.category) {
    return 0.7 + Math.random() * 0.3
  }
  
  // Related categories
  const relatedPairs: [InterestCategory, InterestCategory][] = [
    ['technology', 'ai'],
    ['technology', 'productivity'],
    ['design', 'productivity'],
    ['ai', 'learning'],
    ['privacy', 'technology'],
    ['news', 'learning']
  ]
  
  for (const [cat1, cat2] of relatedPairs) {
    if ((node1.category === cat1 && node2.category === cat2) ||
        (node1.category === cat2 && node2.category === cat1)) {
      return 0.4 + Math.random() * 0.3
    }
  }
  
  // Default weak connection
  return 0.1 + Math.random() * 0.2
}

function parseInterestsFromAnswer(answer: string): string[] {
  // Split by common delimiters and clean up
  const delimiters = /[,;\/&]+|\band\b/gi
  const parts = answer.split(delimiters)
  
  return parts
    .map(part => part.trim())
    .filter(part => part.length > 2 && part.length < 30) // Filter more aggressively
    .filter(part => !part.toLowerCase().startsWith("i'm") && !part.toLowerCase().startsWith("i want"))
    .filter(part => part.split(' ').length <= 4) // Max 4 words per interest
    .slice(0, 3) // Limit to only 3 interests per answer - much less crowded
}

// ============================================
// Store Implementation
// ============================================

export const useInterestsStore = create<InterestsState>()(
  persist(
    (set, get) => ({
      nodes: [],
      connections: [],
      isInitialized: false,
      isExpanded: false,

      initializeFromOnboarding: () => {
        const { isInitialized } = get()
        if (isInitialized) return

        const onboardingState = useOnboardingStore.getState()
        const { answers } = onboardingState

        if (answers.length === 0) return

        const newNodes: InterestNode[] = []
        const newConnections: InterestConnection[] = []

        // Extract interests from relevant questions
        for (const answer of answers) {
          const question = answer.question.toLowerCase()
          let weight = 0.5
          let extractedInterests: string[] = []

          // "What topics are you most interested in?" - highest weight
          if (question.includes('topics') || question.includes('interested')) {
            weight = 0.9
            extractedInterests = parseInterestsFromAnswer(answer.answer)
          }
          // "What brings you to Ron Browser today?" - high weight
          else if (question.includes('brings you') || question.includes('today')) {
            weight = 0.7
            extractedInterests = parseInterestsFromAnswer(answer.answer)
          }
          // "What's your primary goal when browsing?" - medium weight
          else if (question.includes('goal') || question.includes('browsing')) {
            weight = 0.6
            extractedInterests = parseInterestsFromAnswer(answer.answer)
          }
          // Other questions - lower weight, extract keywords
          else {
            weight = 0.4
            // Extract meaningful words from the answer
            const words = answer.answer.split(/\s+/)
            extractedInterests = words
              .filter(w => w.length > 4) // Only longer words
              .slice(0, 3)
          }

          // Create nodes for extracted interests
          for (const interest of extractedInterests) {
            // Check if this interest already exists
            const existingNode = newNodes.find(
              n => n.label.toLowerCase() === interest.toLowerCase()
            )

            if (existingNode) {
              // Boost weight of existing interest
              existingNode.weight = Math.min(1, existingNode.weight + weight * 0.3)
            } else {
              const node: InterestNode = {
                id: generateId(),
                label: interest,
                weight: weight,
                category: classifyCategory(interest),
                source: 'onboarding',
                lastUpdated: Date.now(),
                position: generateInitialPosition(newNodes),
                velocity: { x: 0, y: 0 }
              }
              newNodes.push(node)
            }
          }
        }

        // Limit to MAX_NODES, keeping highest weight interests
        const sortedNodes = newNodes
          .sort((a, b) => b.weight - a.weight)
          .slice(0, MAX_NODES)

        // Generate connections between nodes
        for (let i = 0; i < sortedNodes.length; i++) {
          for (let j = i + 1; j < sortedNodes.length; j++) {
            const strength = calculateConnectionStrength(sortedNodes[i], sortedNodes[j])
            // Only create connections above threshold
            if (strength > 0.25) {
              newConnections.push({
                id: `conn_${sortedNodes[i].id}_${sortedNodes[j].id}`,
                from: sortedNodes[i].id,
                to: sortedNodes[j].id,
                strength
              })
            }
          }
        }

        set({
          nodes: sortedNodes,
          connections: newConnections,
          isInitialized: true
        })
      },

      addInterest: (label: string, source: 'onboarding' | 'browsing', weight = 0.5) => {
        const { nodes, connections } = get()

        // Check for existing
        const existing = nodes.find(n => n.label.toLowerCase() === label.toLowerCase())
        if (existing) {
          // Boost existing weight
          set({
            nodes: nodes.map(n =>
              n.id === existing.id
                ? { ...n, weight: Math.min(1, n.weight + weight * 0.3), lastUpdated: Date.now() }
                : n
            )
          })
          return
        }

        // Create new node
        const newNode: InterestNode = {
          id: generateId(),
          label,
          weight,
          category: classifyCategory(label),
          source,
          lastUpdated: Date.now(),
          position: generateInitialPosition(nodes),
          velocity: { x: 0, y: 0 }
        }

        // Create connections to existing nodes
        const newConnections: InterestConnection[] = []
        for (const existingNode of nodes) {
          const strength = calculateConnectionStrength(newNode, existingNode)
          if (strength > 0.25) {
            newConnections.push({
              id: `conn_${newNode.id}_${existingNode.id}`,
              from: newNode.id,
              to: existingNode.id,
              strength
            })
          }
        }

        set({
          nodes: [...nodes, newNode],
          connections: [...connections, ...newConnections]
        })
      },

      recordInteraction: (topic: string, delta = 0.1) => {
        const { nodes, addInterest } = get()

        // Find matching node (fuzzy match)
        const lowerTopic = topic.toLowerCase()
        const matchingNode = nodes.find(n =>
          n.label.toLowerCase().includes(lowerTopic) ||
          lowerTopic.includes(n.label.toLowerCase())
        )

        if (matchingNode) {
          // Boost existing interest
          set({
            nodes: nodes.map(n =>
              n.id === matchingNode.id
                ? {
                    ...n,
                    weight: Math.min(1, n.weight + delta),
                    lastUpdated: Date.now()
                  }
                : n
            )
          })
        } else {
          // Add new browsing-derived interest
          addInterest(topic, 'browsing', 0.3)
        }
      },

      removeInterest: (id: string) => {
        const { nodes, connections } = get()
        set({
          nodes: nodes.filter(n => n.id !== id),
          connections: connections.filter(c => c.from !== id && c.to !== id)
        })
      },

      updateNodePosition: (id: string, position: { x: number; y: number }) => {
        set({
          nodes: get().nodes.map(n =>
            n.id === id ? { ...n, position } : n
          )
        })
      },

      updateNodeVelocity: (id: string, velocity: { x: number; y: number }) => {
        set({
          nodes: get().nodes.map(n =>
            n.id === id ? { ...n, velocity } : n
          )
        })
      },

      getTopInterests: (n: number) => {
        return [...get().nodes]
          .sort((a, b) => b.weight - a.weight)
          .slice(0, n)
      },

      setExpanded: (expanded: boolean) => {
        set({ isExpanded: expanded })
      },

      toggleExpanded: () => {
        set({ isExpanded: !get().isExpanded })
      },

      decayWeights: () => {
        const now = Date.now()
        const dayInMs = 24 * 60 * 60 * 1000
        
        set({
          nodes: get().nodes.map(n => {
            const daysSinceUpdate = (now - n.lastUpdated) / dayInMs
            // Decay by 5% per day for browsing interests, 2% for onboarding
            const decayRate = n.source === 'browsing' ? 0.05 : 0.02
            const decay = Math.pow(1 - decayRate, daysSinceUpdate)
            return {
              ...n,
              weight: Math.max(0.1, n.weight * decay) // Minimum weight of 0.1
            }
          })
        })
      },

      resetInterests: () => {
        set({
          nodes: [],
          connections: [],
          isInitialized: false
        })
      }
    }),
    {
      name: 'interests-storage',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        nodes: state.nodes,
        connections: state.connections,
        isInitialized: state.isInitialized,
        // Don't persist isExpanded - always start collapsed
      }),
      migrate: (persisted) => persisted as Partial<InterestsState>,
    }
  )
)

// Helper to get category color
export function getCategoryColor(category: InterestCategory): string {
  const colors: Record<InterestCategory, string> = {
    technology: '#3B82F6',    // Blue
    design: '#EC4899',        // Pink
    ai: '#8B5CF6',            // Purple
    privacy: '#10B981',       // Green
    productivity: '#F59E0B',  // Amber
    learning: '#06B6D4',      // Cyan
    entertainment: '#EF4444', // Red
    news: '#6366F1',          // Indigo
    other: '#6B7280'          // Gray
  }
  return colors[category]
}

