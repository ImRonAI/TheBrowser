import { buildDiscoveryContent } from '@/stores/interestDiscoveryStore'
import type { InterestCategory } from '@/stores/interestsStore'

export const INTERESTS_ORB_INSET = 88
export const INTERESTS_EXPANDED_INSET = 544
export const INTERESTS_DISCOVERY_INSET = 624

export type InterestMenuInterest = {
  id: string
  label: string
  category: InterestCategory
}

export type InterestMenuStory = {
  id: string
  title: string
  url?: string
  interestId: string
  interestLabel: string
  category: InterestCategory
}

export type InterestMenuAgent = {
  id: string
  name: string
  description: string
  interestId: string
  interestLabel: string
  category: InterestCategory
}

export type InterestMenuPayload = {
  interests: InterestMenuInterest[]
  stories: InterestMenuStory[]
  agents: InterestMenuAgent[]
}

export type InterestAction =
  | { type: 'open-graph' }
  | { type: 'select'; id: string; label: string; category: InterestCategory }
  | { type: 'story'; interestId: string; interestLabel: string; category: InterestCategory; url?: string }
  | { type: 'agent'; name: string; description: string; interestLabel: string }

export function interestOverlayInset(options: {
  hasInterests: boolean
  expanded: boolean
  discoveryOpen: boolean
}): number {
  if (!options.hasInterests) return 0
  let width = INTERESTS_ORB_INSET
  if (options.expanded) width = Math.max(width, INTERESTS_EXPANDED_INSET)
  if (options.discoveryOpen) width = Math.max(width, INTERESTS_DISCOVERY_INSET)
  return width
}

export function buildInterestMenu(
  nodes: Array<{ id: string; label: string; category: InterestCategory; weight: number }>,
): InterestMenuPayload {
  const top = [...nodes].sort((a, b) => b.weight - a.weight).slice(0, 3)
  const stories: InterestMenuStory[] = []
  const agents: InterestMenuAgent[] = []
  const seenAgents = new Set<string>()

  for (const node of top) {
    const content = buildDiscoveryContent(node.label, node.category)
    for (const story of content.stories) {
      stories.push({
        id: `${node.id}:${story.id}`,
        title: story.title,
        url: story.url,
        interestId: node.id,
        interestLabel: node.label,
        category: node.category,
      })
    }
    for (const agent of content.agents) {
      if (seenAgents.has(agent.id)) continue
      seenAgents.add(agent.id)
      agents.push({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        interestId: node.id,
        interestLabel: node.label,
        category: node.category,
      })
    }
  }

  return {
    interests: top.map((node) => ({
      id: node.id,
      label: node.label,
      category: node.category,
    })),
    stories: stories.slice(0, 6),
    agents: agents.slice(0, 6),
  }
}
