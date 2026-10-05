import { create } from 'zustand'

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
}

export const usePanelAgentStore = create<PanelAgentState>((set) => ({
  panelMode: 'narrow',
  panelWidth: 420,
  teachingInset: 0,
  setPanelMode: (panelMode) => set({ panelMode }),
  setPanelWidth: (panelWidth) => set({ panelWidth }),
  setTeachingInset: (teachingInset) => set({ teachingInset }),
}))
