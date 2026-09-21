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
  setPanelMode: (mode: PanelMode) => void
  setPanelWidth: (width: number) => void
}

export const usePanelAgentStore = create<PanelAgentState>((set) => ({
  panelMode: 'narrow',
  panelWidth: 420,
  setPanelMode: (panelMode) => set({ panelMode }),
  setPanelWidth: (panelWidth) => set({ panelWidth }),
}))
