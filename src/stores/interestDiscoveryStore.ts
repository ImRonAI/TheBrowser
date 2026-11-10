import { create } from 'zustand'
import { fetchDiscoverFeed, stripMarkup } from '@/lib/discover-feed'
import { agentServesInterest } from '@/lib/context-api'
import { useContextAgentStore } from './contextAgentStore'
import { getDiscoverProfile } from './discoverProfileStore'
import { useInterestsStore, type InterestCategory } from './interestsStore'

// ============================================
// Types
// ============================================

export interface DiscoveryStory {
  id: string
  title: string
  description: string
  source: string
  url: string
  imageUrl?: string
  publishedAt?: string
}

/** A specialist the user saved, or one the Context Agent recommends for this interest. */
export interface DiscoveryAgent {
  id: string
  name: string
  description: string
  capabilities: string[]
  saved: boolean
}

export interface DiscoveryTopic {
  id: string
  label: string
  category: InterestCategory
  relevanceScore: number
}

export interface DiscoveryContent {
  stories: DiscoveryStory[]
  agents: DiscoveryAgent[]
  relatedTopics: DiscoveryTopic[]
}

interface InterestDiscoveryState {
  selectedInterestId: string | null
  selectedInterestLabel: string | null
  selectedInterestCategory: InterestCategory | null
  isLoading: boolean
  content: DiscoveryContent | null
  error: string | null
  /** Latest stories per interest label (lower-case), for the native interests menu. */
  storiesByLabel: Record<string, DiscoveryStory[]>

  selectInterest: (id: string, label: string, category: InterestCategory) => void
  clearSelection: () => void
  fetchDiscoveryContent: (interestLabel: string, category: InterestCategory) => Promise<void>
}

/** Agents for an interest: the Context Agent's recommendations for it, then the user's saved specialists. */
export function agentsForInterest(label: string): DiscoveryAgent[] {
  const { recommendations, agents, agentInterests } = useContextAgentStore.getState()
  const key = label.toLowerCase()
  const recommended = recommendations.filter((item) => item.interest.toLowerCase() === key)
    .map((item) => ({ id: item.id, name: item.name, description: item.description, capabilities: [...item.tools, ...item.skills], saved: false }))
  const saved = agents.filter((agent) => agentServesInterest(agent, label, agentInterests[agent.name])).map((agent) => ({ id: agent.id, name: agent.name, description: agent.description, capabilities: [], saved: true }))
  return [...recommended, ...saved].slice(0, 6)
}

function relatedTopics(label: string, category: InterestCategory): DiscoveryTopic[] {
  return useInterestsStore.getState().nodes
    .filter((node) => node.label.toLowerCase() !== label.toLowerCase())
    .sort((a, b) => Number(b.category === category) - Number(a.category === category) || b.weight - a.weight)
    .slice(0, 8)
    .map((node) => ({ id: node.id, label: node.label, category: node.category, relevanceScore: node.weight }))
}

let requestId = 0

export const useInterestDiscoveryStore = create<InterestDiscoveryState>()((set, get) => ({
  selectedInterestId: null,
  selectedInterestLabel: null,
  selectedInterestCategory: null,
  isLoading: false,
  content: null,
  error: null,
  storiesByLabel: {},

  selectInterest: (id, label, category) => {
    set({ selectedInterestId: id, selectedInterestLabel: label, selectedInterestCategory: category })
    void get().fetchDiscoveryContent(label, category)
  },

  clearSelection: () => {
    requestId++
    set({ selectedInterestId: null, selectedInterestLabel: null, selectedInterestCategory: null, content: null, error: null, isLoading: false })
  },

  fetchDiscoveryContent: async (interestLabel, category) => {
    const current = ++requestId
    set({ isLoading: true, error: null, content: { stories: [], agents: agentsForInterest(interestLabel), relatedTopics: relatedTopics(interestLabel, category) } })
    try {
      const { sections } = await fetchDiscoverFeed({
        sections: [{ kind: 'news', q: interestLabel, count: 6, freshness: 'pw' }],
        country: getDiscoverProfile().country,
      })
      if (current !== requestId) return
      const section = sections[0]
      if (section?.status === 'error') throw new Error(section.error?.message || 'News search failed.')
      const seen = new Set<string>()
      const stories: DiscoveryStory[] = (section?.items ?? []).flatMap((item) => {
        if (!item.title || !/^https?:\/\//i.test(item.url) || seen.has(item.url)) return []
        seen.add(item.url)
        return [{ id: item.id || item.url, title: stripMarkup(item.title), description: stripMarkup(item.description || ''),
          source: item.source || new URL(item.url).hostname, url: item.url, imageUrl: item.thumbnail || undefined, publishedAt: item.age || undefined }]
      })
      set({
        isLoading: false,
        content: { stories, agents: agentsForInterest(interestLabel), relatedTopics: relatedTopics(interestLabel, category) },
        storiesByLabel: { ...get().storiesByLabel, [interestLabel.toLowerCase()]: stories },
      })
    } catch (error) {
      if (current !== requestId) return
      set({ isLoading: false, error: `Stories could not load: ${error instanceof Error ? error.message : String(error)}` })
    }
  },
}))
