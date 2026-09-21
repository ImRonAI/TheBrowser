import { create } from 'zustand'
import { InterestCategory } from './interestsStore'

// ============================================
// Types
// ============================================

export interface DiscoveryStory {
  id: string
  title: string
  description: string
  source: string
  url?: string
  imageUrl?: string
  readTime?: string
  publishedAt?: string
}

export interface DiscoveryAgent {
  id: string
  name: string
  description: string
  iconId: string  // Icon identifier for mapping to Heroicons
  capabilities: string[]
  isAvailable: boolean
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
  
  // Actions
  selectInterest: (id: string, label: string, category: InterestCategory) => void
  clearSelection: () => void
  fetchDiscoveryContent: (interestLabel: string, category: InterestCategory) => Promise<void>
}

// ============================================
// Mock Data Generator
// ============================================

export function buildDiscoveryContent(label: string, category: InterestCategory): DiscoveryContent {
  const storyKey = label.toLowerCase().replace(/\W+/g, '_')
  const stories: DiscoveryStory[] = [
    {
      id: `story_${storyKey}_1`,
      title: `The Latest Developments in ${label}`,
      description: `Explore cutting-edge advances and emerging trends in the world of ${label.toLowerCase()}. Industry experts weigh in on what's next.`,
      source: 'Tech Insights',
      readTime: '5 min read',
      publishedAt: 'Today'
    },
    {
      id: `story_${storyKey}_2`,
      title: `How ${label} is Shaping the Future`,
      description: `A deep dive into how ${label.toLowerCase()} is transforming industries and creating new opportunities for innovation.`,
      source: 'Future Forward',
      readTime: '8 min read',
      publishedAt: 'Yesterday'
    },
    {
      id: `story_${storyKey}_3`,
      title: `Getting Started with ${label}: A Guide`,
      description: `Whether you're new to ${label.toLowerCase()} or looking to deepen your knowledge, this comprehensive guide has you covered.`,
      source: 'Learning Hub',
      readTime: '12 min read',
      publishedAt: '2 days ago'
    }
  ]

  // Generate agents based on category
  const agentsByCategory: Record<InterestCategory, DiscoveryAgent[]> = {
    technology: [
      {
        id: 'agent_dev_assistant',
        name: 'Dev Assistant',
        description: 'Helps with coding, debugging, and technical documentation',
        iconId: 'agent_dev_assistant',
        capabilities: ['Code review', 'Documentation', 'Debugging'],
        isAvailable: true
      },
      {
        id: 'agent_tech_researcher',
        name: 'Tech Researcher',
        description: 'Finds and summarizes technical articles and papers',
        iconId: 'agent_tech_researcher',
        capabilities: ['Research', 'Summarization', 'Analysis'],
        isAvailable: true
      }
    ],
    ai: [
      {
        id: 'agent_ai_analyst',
        name: 'AI Analyst',
        description: 'Explains AI concepts and tracks latest developments',
        iconId: 'agent_ai_analyst',
        capabilities: ['Concept explanation', 'Trend tracking', 'Paper analysis'],
        isAvailable: true
      },
      {
        id: 'agent_prompt_engineer',
        name: 'Prompt Engineer',
        description: 'Helps craft effective prompts and AI workflows',
        iconId: 'agent_prompt_engineer',
        capabilities: ['Prompt crafting', 'Workflow design', 'Optimization'],
        isAvailable: false
      }
    ],
    design: [
      {
        id: 'agent_design_critic',
        name: 'Design Critic',
        description: 'Provides feedback on design work and inspiration',
        iconId: 'agent_design_critic',
        capabilities: ['Design review', 'Inspiration', 'Trends'],
        isAvailable: true
      }
    ],
    privacy: [
      {
        id: 'agent_privacy_guardian',
        name: 'Privacy Guardian',
        description: 'Analyzes privacy policies and security practices',
        iconId: 'agent_privacy_guardian',
        capabilities: ['Policy analysis', 'Security audit', 'Recommendations'],
        isAvailable: true
      }
    ],
    productivity: [
      {
        id: 'agent_task_master',
        name: 'Task Master',
        description: 'Helps organize tasks and optimize workflows',
        iconId: 'agent_task_master',
        capabilities: ['Task management', 'Scheduling', 'Automation'],
        isAvailable: true
      }
    ],
    learning: [
      {
        id: 'agent_tutor',
        name: 'Personal Tutor',
        description: 'Creates personalized learning paths and explanations',
        iconId: 'agent_tutor',
        capabilities: ['Explanations', 'Quizzes', 'Progress tracking'],
        isAvailable: true
      }
    ],
    entertainment: [
      {
        id: 'agent_curator',
        name: 'Content Curator',
        description: 'Finds and recommends entertainment based on your taste',
        iconId: 'agent_curator',
        capabilities: ['Recommendations', 'Discovery', 'Reviews'],
        isAvailable: true
      }
    ],
    news: [
      {
        id: 'agent_news_digest',
        name: 'News Digest',
        description: 'Summarizes and curates news from trusted sources',
        iconId: 'agent_news_digest',
        capabilities: ['Summarization', 'Fact-checking', 'Alerts'],
        isAvailable: true
      }
    ],
    other: [
      {
        id: 'agent_general',
        name: 'General Assistant',
        description: 'A versatile helper for various tasks',
        iconId: 'agent_general',
        capabilities: ['Research', 'Writing', 'Organization'],
        isAvailable: true
      }
    ]
  }

  // Generate related topics
  const relatedByCategory: Record<InterestCategory, string[]> = {
    technology: ['Software Engineering', 'Open Source', 'DevOps', 'APIs'],
    ai: ['Machine Learning', 'Neural Networks', 'LLMs', 'Automation'],
    design: ['UI/UX', 'Typography', 'Color Theory', 'Prototyping'],
    privacy: ['Encryption', 'VPNs', 'Data Rights', 'Security'],
    productivity: ['Time Management', 'Focus', 'Tools', 'Workflows'],
    learning: ['Online Courses', 'Books', 'Tutorials', 'Research'],
    entertainment: ['Streaming', 'Gaming', 'Music', 'Podcasts'],
    news: ['Tech News', 'World Events', 'Analysis', 'Opinions'],
    other: ['Exploration', 'Discovery', 'Trends', 'Innovation']
  }

  const relatedTopics: DiscoveryTopic[] = relatedByCategory[category].map((topic, i) => ({
    id: `topic_${storyKey}_${i}`,
    label: topic,
    category: category,
    relevanceScore: 0.9 - i * 0.15
  }))

  return {
    stories,
    agents: agentsByCategory[category] || agentsByCategory.other,
    relatedTopics
  }
}

// ============================================
// Store
// ============================================

export const useInterestDiscoveryStore = create<InterestDiscoveryState>()((set, get) => ({
  selectedInterestId: null,
  selectedInterestLabel: null,
  selectedInterestCategory: null,
  isLoading: false,
  content: null,
  error: null,

  selectInterest: (id: string, label: string, category: InterestCategory) => {
    set({
      selectedInterestId: id,
      selectedInterestLabel: label,
      selectedInterestCategory: category
    })
    // Auto-fetch content
    get().fetchDiscoveryContent(label, category)
  },

  clearSelection: () => {
    set({
      selectedInterestId: null,
      selectedInterestLabel: null,
      selectedInterestCategory: null,
      content: null,
      error: null
    })
  },

  fetchDiscoveryContent: async (interestLabel: string, category: InterestCategory) => {
    set({ isLoading: true, error: null })
    
    try {
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 600))
      
      // Generate mock content (in real app, this would be an API call)
      const content = buildDiscoveryContent(interestLabel, category)
      
      set({ content, isLoading: false })
    } catch (err) {
      set({ 
        error: 'Failed to load discovery content', 
        isLoading: false 
      })
    }
  }
}))

