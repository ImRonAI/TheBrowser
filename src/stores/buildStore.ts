/**
 * Build Workbench Store
 * 
 * State management for the Build Agent Workbench including:
 * - Agent switching with thread isolation
 * - Message threads keyed by agent + session
 * - Session management (new chat, per-agent history)
 * - Execution plan
 * - Projects
 * - Current view state
 */

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  AgentProfile,
  BuildMessage,
  BuildSession,
  CodingProject,
  ExecutionPlan,
  Source,
  Citation,
  CenterView,
  MessageBlock,
} from '@/components/build/types'

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const DEFAULT_SESSION_TITLE = 'New chat'
const MAX_SESSION_TITLE_LENGTH = 60

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function truncateSessionTitle(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return DEFAULT_SESSION_TITLE
  if (normalized.length <= MAX_SESSION_TITLE_LENGTH) return normalized
  return `${normalized.slice(0, MAX_SESSION_TITLE_LENGTH - 3)}...`
}

function extractTextFromMessage(message: BuildMessage): string {
  for (const block of message.blocks) {
    if (block.type === 'text') return block.content.trim()
  }
  return ''
}

function deriveSessionTitle(messages: BuildMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')
  const text = firstUser ? extractTextFromMessage(firstUser) : ''
  return truncateSessionTitle(text || DEFAULT_SESSION_TITLE)
}

function createSessionRecord(agentId: string, title?: string, now: number = Date.now()): BuildSession {
  return {
    id: generateSessionId(),
    agentId,
    title: truncateSessionTitle(title || DEFAULT_SESSION_TITLE),
    createdAt: now,
    updatedAt: now,
  }
}

function getSessionTimestamps(messages: BuildMessage[], fallback: number): { createdAt: number; updatedAt: number } {
  const timestamps = messages.map((m) => m.timestamp).filter((value) => typeof value === 'number') as number[]
  if (timestamps.length === 0) {
    return { createdAt: fallback, updatedAt: fallback }
  }
  return {
    createdAt: Math.min(...timestamps),
    updatedAt: Math.max(...timestamps),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// State Interface
// ─────────────────────────────────────────────────────────────────────────────

interface Artifact {
  id: string
  name: string
  kind: string
  projectId?: string
}

interface Todo {
  id: string
  text: string
  done: boolean
}

interface BuildState {
  // Agent management
  activeAgentId: string | null
  agents: AgentProfile[]

  // Thread management (keyed by threadKey)
  threads: Record<string, BuildMessage[]>
  workspaceId: string  // default workspace/user scope
  sessions: BuildSession[]
  activeSessionId: string | null
  streamingMessageId: string | null
  isStreaming: boolean

  // View state
  activeCenterView: CenterView
  activeProjectId: string | null

  // Execution plan
  currentPlan: ExecutionPlan | null

  // Projects
  projects: CodingProject[]

  // Right rail data
  sources: Source[]
  citations: Citation[]
  todos: Todo[]

  // Preview state
  previewUrl: string | null
  previewTitle: string | null

  // Artifacts
  artifacts: Artifact[]

  // Navigation counter for headline rotation
  navigationCounter: number

  // Error state
  error: { message: string; code?: string } | null

  // ─────────────────────────────────────────────────────────────────────────
  // Computed
  // ─────────────────────────────────────────────────────────────────────────
  
  activeThreadKey: () => string
  activeMessages: () => BuildMessage[]

  // ─────────────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────────────

  // Agent actions
  setActiveAgent: (agentId: string) => void
  loadAgents: (agents: AgentProfile[]) => void

  // Message actions
  addMessage: (message: BuildMessage) => void
  addUserMessage: (content: string) => void
  updateStreamingMessage: (messageId: string, blocks: MessageBlock[]) => void
  finalizeStreamingMessage: () => void
  clearThread: () => void
  createSession: (agentId?: string, title?: string) => string
  setActiveSession: (sessionId: string) => void
  ensureActiveSession: (agentId?: string) => string

  // View actions
  selectProject: (projectId: string) => void
  setCenterView: (view: CenterView) => void
  incrementNavigation: () => void

  // Plan actions
  updatePlan: (plan: ExecutionPlan) => void
  clearPlan: () => void

  // Project actions
  addProject: (project: CodingProject) => void
  loadProjects: (projects: CodingProject[]) => void

  // Right rail actions
  upsertSources: (sources: Source[]) => void
  upsertCitations: (citations: Citation[]) => void
  updateTodos: (todos: Todo[]) => void

  // Preview actions
  setPreview: (url: string, title?: string) => void
  clearPreview: () => void

  // Artifact actions
  addArtifact: (artifact: Artifact) => void

  // Tool call actions
  updateToolCall: (toolName: string, status: string, output?: string, error?: string) => void

  // Streaming actions
  setStreaming: (isStreaming: boolean) => void

  // Error actions
  setError: (message: string, code?: string) => void
  clearError: () => void

  // Reset
  reset: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Agents (seed data)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Default Agents (seed data)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_AGENTS: AgentProfile[] = [
  {
    id: 'super-agent',
    name: 'Super Agent',
    description: 'Strands-based orchestration agent with MCP/A2A capabilities',
    tools: ['mcp-client', 'use_agent', 'swarm', 'think'],
    avatar: '', // Icons handled by UI
  },
  {
    id: 'search-agent',
    name: 'Search Agent',
    description: 'Deep research and synthesis using Perplexity & MCPs',
    tools: ['perplexity_deep_research', 'mcp-client', 'swarm'],
    avatar: '', // Icons handled by UI
  },
  {
    id: 'sandbox-agent',
    name: 'Sandbox Agent',
    description: 'Full-stack coding agent with browser preview capabilities',
    tools: ['mcp-playwright', 'code-interpreter', 'use_computer'],
    avatar: '', // Icons handled by UI
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useBuildStore = create<BuildState>()(
  persist(
    (set, get) => ({
      // Initial state
      activeAgentId: 'sandbox-agent',
      agents: DEFAULT_AGENTS,
      threads: {},
      workspaceId: 'default',
      sessions: [],
      activeSessionId: null,
      streamingMessageId: null,
      isStreaming: false,
      activeCenterView: 'chat',
      activeProjectId: null,
      currentPlan: null,
      projects: [],
      sources: [],
      citations: [],
      todos: [],
      previewUrl: null,
      previewTitle: null,
      artifacts: [],
      navigationCounter: 0,
      error: null,

      // Computed
      activeThreadKey: () => {
        const { workspaceId, activeAgentId, activeSessionId } = get()
        const sessionId = activeSessionId || 'default'
        return `${workspaceId}:${activeAgentId || 'default'}:${sessionId}`
      },

      activeMessages: () => {
        const { threads } = get()
        const key = get().activeThreadKey()
        return threads[key] || []
      },

      // Agent actions
      setActiveAgent: (agentId) => {
        set({
          activeAgentId: agentId,
          activeCenterView: 'chat',
          activeProjectId: null,
          // Clear right rail when switching agents
          sources: [],
          citations: [],
          currentPlan: null,
        })
        get().ensureActiveSession(agentId)
      },

      loadAgents: (agents) => {
        set({ agents })
      },

      createSession: (agentId, title) => {
        const targetAgentId = agentId || get().activeAgentId || 'sandbox-agent'
        const session = createSessionRecord(targetAgentId, title)
        set((state) => ({
          sessions: [session, ...state.sessions],
          activeSessionId: session.id,
          activeAgentId: targetAgentId,
          activeCenterView: 'chat',
          activeProjectId: null,
          sources: [],
          citations: [],
          currentPlan: null,
          todos: [],
        }))
        return session.id
      },

      setActiveSession: (sessionId) => {
        const session = get().sessions.find((s) => s.id === sessionId)
        if (!session) return
        set({
          activeSessionId: session.id,
          activeAgentId: session.agentId,
          activeCenterView: 'chat',
          activeProjectId: null,
          sources: [],
          citations: [],
          currentPlan: null,
          todos: [],
        })
      },

      ensureActiveSession: (agentId) => {
        const targetAgentId = agentId || get().activeAgentId || 'sandbox-agent'
        const { sessions, activeSessionId } = get()
        const activeSession = sessions.find(
          (session) => session.id === activeSessionId && session.agentId === targetAgentId
        )
        if (activeSession) return activeSession.id

        const mostRecent = sessions
          .filter((session) => session.agentId === targetAgentId)
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt)[0]

        if (mostRecent) {
          set({ activeSessionId: mostRecent.id, activeAgentId: targetAgentId })
          return mostRecent.id
        }

        return get().createSession(targetAgentId)
      },

      // Message actions
      addMessage: (message) => {
        const sessionId = get().ensureActiveSession()
        const key = get().activeThreadKey()
        const now = Date.now()
        set((state) => ({
          threads: {
            ...state.threads,
            [key]: [...(state.threads[key] || []), message],
          },
          sessions: state.sessions.map((session) =>
            session.id === sessionId ? { ...session, updatedAt: now } : session
          ),
        }))
      },

      addUserMessage: (content) => {
        const sessionId = get().ensureActiveSession()
        const message: BuildMessage = {
          id: generateId(),
          role: 'user',
          blocks: [{ type: 'text', content }],
          timestamp: Date.now(),
        }
        get().addMessage(message)
        const title = truncateSessionTitle(content)
        set((state) => ({
          sessions: state.sessions.map((session) => {
            if (session.id !== sessionId) return session
            if (session.title !== DEFAULT_SESSION_TITLE) return session
            return { ...session, title }
          }),
        }))
      },

      updateStreamingMessage: (messageId, blocks) => {
        get().ensureActiveSession()
        const key = get().activeThreadKey()
        set((state) => {
          const messages = state.threads[key] || []
          const idx = messages.findIndex((m) => m.id === messageId)
          if (idx === -1) {
            // Create new streaming message
            return {
              threads: {
                ...state.threads,
                [key]: [
                  ...messages,
                  {
                    id: messageId,
                    role: 'assistant',
                    blocks,
                    timestamp: Date.now(),
                    isStreaming: true,
                  },
                ],
              },
              streamingMessageId: messageId,
            }
          }
          // Update existing
          const updated = [...messages]
          updated[idx] = { ...updated[idx], blocks, isStreaming: true }
          return {
            threads: { ...state.threads, [key]: updated },
            streamingMessageId: messageId,
          }
        })
      },

      finalizeStreamingMessage: () => {
        const { streamingMessageId } = get()
        if (!streamingMessageId) return

        const key = get().activeThreadKey()
        set((state) => {
          const messages = state.threads[key] || []
          const idx = messages.findIndex((m) => m.id === streamingMessageId)
          if (idx === -1) return state

          const updated = [...messages]
          updated[idx] = { ...updated[idx], isStreaming: false }
          return {
            threads: { ...state.threads, [key]: updated },
            streamingMessageId: null,
            isStreaming: false,
          }
        })
      },

      clearThread: () => {
        get().ensureActiveSession()
        const key = get().activeThreadKey()
        set((state) => ({
          threads: { ...state.threads, [key]: [] },
          sources: [],
          citations: [],
          currentPlan: null,
        }))
      },

      // View actions
      selectProject: (projectId) => {
        set({
          activeProjectId: projectId,
          activeCenterView: 'project',
        })
      },

      setCenterView: (view) => {
        set({ activeCenterView: view })
      },

      incrementNavigation: () => {
        set((state) => ({
          navigationCounter: state.navigationCounter + 1,
        }))
      },

      // Plan actions
      updatePlan: (plan) => {
        set({ currentPlan: plan })
      },

      clearPlan: () => {
        set({ currentPlan: null })
      },

      // Project actions
      addProject: (project) => {
        set((state) => ({
          projects: [...state.projects.filter((p) => p.id !== project.id), project],
        }))
      },

      loadProjects: (projects) => {
        set({ projects })
      },

      // Right rail actions
      upsertSources: (sources) => {
        set((state) => {
          const existing = new Map(state.sources.map((s) => [s.url, s]))
          sources.forEach((s) => existing.set(s.url, s))
          return { sources: Array.from(existing.values()) }
        })
      },

      upsertCitations: (citations) => {
        set((state) => {
          const existing = new Map(state.citations.map((c) => [c.url, c]))
          citations.forEach((c) => existing.set(c.url, c))
          return { citations: Array.from(existing.values()) }
        })
      },

      updateTodos: (todos) => {
        set({ todos })
      },

      // Preview actions
      setPreview: (url, title) => {
        set({ previewUrl: url, previewTitle: title || null })
      },

      clearPreview: () => {
        set({ previewUrl: null, previewTitle: null })
      },

      // Artifact actions
      addArtifact: (artifact) => {
        set((state) => ({
          artifacts: [...state.artifacts.filter((a) => a.id !== artifact.id), artifact],
        }))
      },

      // Tool call actions
      updateToolCall: (toolName, status, output, error) => {
        // Update the last tool_call block in the streaming message
        const { streamingMessageId } = get()
        if (!streamingMessageId) return

        const key = get().activeThreadKey()
        set((state) => {
          const messages = state.threads[key] || []
          const idx = messages.findIndex((m) => m.id === streamingMessageId)
          if (idx === -1) return state

          const msg = messages[idx]
          const blocks = msg.blocks.map((block) => {
            if (block.type === 'tool_call' && block.toolName === toolName) {
              return { ...block, status: status as any, output, error }
            }
            return block
          })

          const updated = [...messages]
          updated[idx] = { ...updated[idx], blocks }
          return { threads: { ...state.threads, [key]: updated } }
        })
      },

      // Streaming actions
      setStreaming: (isStreaming) => {
        set({ isStreaming })
      },

      // Error actions
      setError: (message, code) => {
        set({ error: { message, code } })
      },

      clearError: () => {
        set({ error: null })
      },

      // Reset
      reset: () => {
        set({
          threads: {},
          sessions: [],
          activeSessionId: null,
          currentPlan: null,
          sources: [],
          citations: [],
          todos: [],
          previewUrl: null,
          previewTitle: null,
          artifacts: [],
          error: null,
          isStreaming: false,
          streamingMessageId: null,
        })
      },
    }),
    {
      name: 'build-store-v2',
      storage: createJSONStorage(() => localStorage),
      version: 4,
      migrate: (state: any, version: number) => {
        if (!state) return state

        const nextState = { ...state }
        if (!nextState.activeAgentId || nextState.activeAgentId === 'super-agent') {
          nextState.activeAgentId = 'sandbox-agent'
        }

        const workspaceId = nextState.workspaceId || 'default'
        const threads = nextState.threads || {}

        const stateVersion = typeof version === 'number' ? version : 0
        if (stateVersion < 4) {
          const migratedThreads: Record<string, BuildMessage[]> = {}
          const migratedSessions: BuildSession[] = Array.isArray(nextState.sessions) ? [...nextState.sessions] : []
          const existingSessionIds = new Set(migratedSessions.map((session) => session.id))
          const fallbackAgentId = nextState.activeAgentId || 'sandbox-agent'
          const now = Date.now()

          Object.entries(threads).forEach(([key, messages]) => {
            const parts = key.split(':')
            if (parts.length >= 3) {
              const workspacePart = parts[0] || workspaceId
              const agentPart = parts[1] || fallbackAgentId
              const sessionPart = parts[2]
              const normalizedKey = `${workspacePart}:${agentPart}:${sessionPart}`
              migratedThreads[normalizedKey] = messages as BuildMessage[]

              if (!existingSessionIds.has(sessionPart)) {
                const timestamps = getSessionTimestamps(messages as BuildMessage[], now)
                migratedSessions.push({
                  id: sessionPart,
                  agentId: agentPart,
                  title: deriveSessionTitle(messages as BuildMessage[]),
                  createdAt: timestamps.createdAt,
                  updatedAt: timestamps.updatedAt,
                })
                existingSessionIds.add(sessionPart)
              }
              return
            }

            const agentId = parts.length === 2 ? parts[1] || fallbackAgentId : fallbackAgentId
            const workspacePart = parts.length >= 1 ? parts[0] || workspaceId : workspaceId
            const baseSession = createSessionRecord(agentId, deriveSessionTitle(messages as BuildMessage[]), now)
            const timestamps = getSessionTimestamps(messages as BuildMessage[], now)
            const session = { ...baseSession, createdAt: timestamps.createdAt, updatedAt: timestamps.updatedAt }

            migratedSessions.push(session)
            migratedThreads[`${workspacePart}:${agentId}:${session.id}`] = messages as BuildMessage[]
          })

          if (migratedSessions.length === 0) {
            const session = createSessionRecord(fallbackAgentId, DEFAULT_SESSION_TITLE, now)
            migratedSessions.push(session)
          }

          let activeSessionId = nextState.activeSessionId
          if (!activeSessionId || !migratedSessions.some((session) => session.id === activeSessionId)) {
            const byAgent = migratedSessions.filter((session) => session.agentId === nextState.activeAgentId)
            const candidate = byAgent
              .slice()
              .sort((a, b) => b.updatedAt - a.updatedAt)[0] || migratedSessions[0]
            activeSessionId = candidate?.id || null
          }

          return {
            ...nextState,
            workspaceId,
            threads: migratedThreads,
            sessions: migratedSessions,
            activeSessionId,
          }
        }

        return { ...nextState, workspaceId }
      },
      partialize: (state) => ({
        activeAgentId: state.activeAgentId,
        activeSessionId: state.activeSessionId,
        threads: state.threads,
        sessions: state.sessions,
        projects: state.projects,
        navigationCounter: state.navigationCounter,
      }),
    }
  )
)
