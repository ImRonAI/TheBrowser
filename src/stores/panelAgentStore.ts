import { create } from 'zustand'
import type { AgentChoice } from '@/lib/panel-agents'

export type PanelMode = 'narrow' | 'wide' | 'fullscreen'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
}

interface PanelAgentState {
  panelMode: PanelMode
  panelWidth: number
  /** Width reserved on the right while the teaching studio is expanded. 0 when it is closed or minimized. */
  teachingInset: number
  setPanelMode: (mode: PanelMode) => void
  setPanelWidth: (width: number) => void
  setTeachingInset: (width: number) => void
  /** Another surface (Agents tab, a project page) asks the Agent Panel to start a chat with this agent. */
  requestedAgent: AgentChoice | null
  requestAgent: (agent: AgentChoice | null) => void
  /** A thread (session id) another surface asks the Agent Panel to open, e.g. a chat referenced in a page. */
  requestedThread: string | null
  requestThread: (sessionId: string | null) => void
}

export const usePanelAgentStore = create<PanelAgentState>((set) => ({
  panelMode: 'narrow',
  panelWidth: 420,
  teachingInset: 0,
  setPanelMode: (panelMode) => set({ panelMode }),
  setPanelWidth: (panelWidth) => set({ panelWidth }),
  setTeachingInset: (teachingInset) => set({ teachingInset }),
  requestedAgent: null,
  requestAgent: (requestedAgent) => set({ requestedAgent }),
  requestedThread: null,
  requestThread: (requestedThread) => set({ requestedThread }),
}))
