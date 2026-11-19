import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useArticleDraftStore } from '@/stores/articleDraftStore'
import { selectionAttachment, type PromptAttachment } from '@/lib/prompt-attachments'

export interface AskRonOption {
  id: string
  label: string
  description?: string
}

export type AskRonStep = 'closed' | 'loading' | 'options' | 'custom-prompt' | 'executing'

/**
 * Static suggestions. `POST /chat` streams SSE and creates a server-owned
 * session, so it is never used to fetch menu options.
 */
export const ASK_RON_OPTIONS: readonly AskRonOption[] = [
  { id: '1', label: 'Summarize this text', description: 'Get a brief summary' },
  { id: '2', label: 'Explain this text', description: 'Understand what it means' },
  { id: '3', label: 'Find related information', description: 'Search for more context' },
]

interface AgentUiContextValue {
  isPanelOpen: boolean
  interactionMode: 'voice' | 'text'
  isViewingScreen: boolean
  screenshotData: string | null

  askRonStep: AskRonStep
  askRonSelectedText: string | null
  askRonSourceUrl: string | null
  askRonOptions: AskRonOption[]
  askRonThinkingText: string
  askRonPendingPrompt: string | null
  agentPanelQueuedPrompts: string[]
  /** Attachment cards waiting to land in the panel's composer (what Ask Ren opened). */
  agentPanelQueuedAttachments: PromptAttachment[]

  togglePanel: () => void
  openPanel: () => void
  closePanel: () => void
  setInteractionMode: (mode: 'voice' | 'text') => void

  startViewingScreen: (screenshotData?: string) => void
  stopViewingScreen: () => void

  startAskRon: (selectedText: string, sourceUrl: string) => Promise<void>
  setAskRonStep: (step: AskRonStep) => void
  selectAskRonOption: (option: AskRonOption) => Promise<void>
  submitCustomAskRon: (prompt: string) => Promise<void>
  closeAskRon: () => void
  consumeAskRonPendingPrompt: () => string | null
  /**
   * Opens the panel with `attachments` as cards in its composer and, when `prompt` has text, sends it with them.
   * Context goes in `attachments`, never pasted into `prompt`.
   */
  sendToAgentPanel: (prompt: string, attachments?: PromptAttachment[]) => void
  consumeAgentPanelPrompt: () => string | null
  consumeAgentPanelAttachments: () => PromptAttachment[]
}

const AgentUiContext = createContext<AgentUiContextValue | null>(null)

export function AgentUiProvider({ children }: { children: ReactNode }) {
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [interactionMode, setInteractionMode] = useState<'voice' | 'text'>('text')
  const [isViewingScreen, setIsViewingScreen] = useState(false)
  const [screenshotData, setScreenshotData] = useState<string | null>(null)

  const [askRonStep, setAskRonStepState] = useState<AskRonStep>('closed')
  const [askRonSelectedText, setAskRonSelectedText] = useState<string | null>(null)
  const [askRonSourceUrl, setAskRonSourceUrl] = useState<string | null>(null)
  const [askRonOptions, setAskRonOptions] = useState<AskRonOption[]>([])
  const [askRonThinkingText, setAskRonThinkingText] = useState('Analyzing selection...')
  const [askRonPendingPrompt, setAskRonPendingPrompt] = useState<string | null>(null)
  const [agentPanelQueuedPrompts, setAgentPanelQueuedPrompts] = useState<string[]>([])
  const [agentPanelQueuedAttachments, setAgentPanelQueuedAttachments] = useState<PromptAttachment[]>([])

  const openPanel = useCallback(() => {
    setIsPanelOpen(true)
  }, [])

  const closePanel = useCallback(() => {
    setIsPanelOpen(false)
  }, [])

  const togglePanel = useCallback(() => {
    setIsPanelOpen((prev) => !prev)
  }, [])

  const setAskRonStep = useCallback((step: AskRonStep) => {
    setAskRonStepState(step)
  }, [])

  // Closing the menu never drops a request that was already queued: the
  // conversation's consume effect dispatches it once the session is ready.
  const closeAskRon = useCallback(() => {
    setAskRonStepState('closed')
    setAskRonSelectedText(null)
    setAskRonSourceUrl(null)
    setAskRonOptions([])
  }, [])

  const startViewingScreen = useCallback((screenData?: string) => {
    setIsViewingScreen(true)
    setScreenshotData(screenData || null)
    openPanel()
  }, [openPanel])

  const stopViewingScreen = useCallback(() => {
    setIsViewingScreen(false)
    setScreenshotData(null)
  }, [])

  // Opening the menu puts the selection in the panel's composer as an attachment card; nothing is sent until the
  // user picks an option, and the choice is then dispatched to whichever mode is visible, with the card.
  const startAskRon = useCallback(async (selectedText: string, sourceUrl: string) => {
    useArticleDraftStore.getState().setDestination('panel')
    if (selectedText.trim()) setAgentPanelQueuedAttachments((prev) => [...prev, selectionAttachment(selectedText, sourceUrl)])
    setAskRonSelectedText(selectedText)
    setAskRonSourceUrl(sourceUrl)
    setAskRonThinkingText('Choose what Ren should do')
    setAskRonOptions([...ASK_RON_OPTIONS])
    setAskRonStepState('options')
    openPanel()
  }, [openPanel])

  const selectAskRonOption = useCallback(async (option: AskRonOption) => {
    if (!askRonSelectedText) return
    useArticleDraftStore.getState().setDestination('panel')
    setAskRonStepState('executing')
    setAskRonThinkingText(`${option.label}...`)
    setAskRonPendingPrompt(option.label)
    openPanel()
  }, [askRonSelectedText, openPanel])

  const submitCustomAskRon = useCallback(async (prompt: string) => {
    if (!askRonSelectedText) return
    useArticleDraftStore.getState().setDestination('panel')
    if (!prompt.trim()) return
    setAskRonStepState('executing')
    setAskRonThinkingText('Processing your request...')
    setAskRonPendingPrompt(prompt.trim())
    openPanel()
  }, [askRonSelectedText, openPanel])

  const consumeAskRonPendingPrompt = useCallback(() => {
    if (!askRonPendingPrompt) return null
    const nextPrompt = askRonPendingPrompt
    setAskRonPendingPrompt(null)
    return nextPrompt
  }, [askRonPendingPrompt])

  const sendToAgentPanel = useCallback((prompt: string, attachments: PromptAttachment[] = []) => {
    const normalized = prompt.trim()
    if (!normalized && !attachments.length) return
    useArticleDraftStore.getState().setDestination('panel')
    if (attachments.length) setAgentPanelQueuedAttachments((prev) => [...prev, ...attachments])
    if (normalized) setAgentPanelQueuedPrompts((prev) => [...prev, normalized])
    openPanel()
  }, [openPanel])

  const consumeAgentPanelAttachments = useCallback(() => {
    const queued = agentPanelQueuedAttachments
    if (queued.length) setAgentPanelQueuedAttachments([])
    return queued
  }, [agentPanelQueuedAttachments])

  const consumeAgentPanelPrompt = useCallback(() => {
    if (agentPanelQueuedPrompts.length === 0) return null
    const [nextPrompt, ...remaining] = agentPanelQueuedPrompts
    setAgentPanelQueuedPrompts(remaining)
    return nextPrompt ?? null
  }, [agentPanelQueuedPrompts])

  const value = useMemo<AgentUiContextValue>(() => ({
    isPanelOpen,
    interactionMode,
    isViewingScreen,
    screenshotData,
    askRonStep,
    askRonSelectedText,
    askRonSourceUrl,
    askRonOptions,
    askRonThinkingText,
    askRonPendingPrompt,
    agentPanelQueuedPrompts,
    agentPanelQueuedAttachments,
    togglePanel,
    openPanel,
    closePanel,
    setInteractionMode,
    startViewingScreen,
    stopViewingScreen,
    startAskRon,
    setAskRonStep,
    selectAskRonOption,
    submitCustomAskRon,
    closeAskRon,
    consumeAskRonPendingPrompt,
    sendToAgentPanel,
    consumeAgentPanelPrompt,
    consumeAgentPanelAttachments,
  }), [
    isPanelOpen,
    interactionMode,
    isViewingScreen,
    screenshotData,
    askRonStep,
    askRonSelectedText,
    askRonSourceUrl,
    askRonOptions,
    askRonThinkingText,
    askRonPendingPrompt,
    agentPanelQueuedPrompts,
    agentPanelQueuedAttachments,
    togglePanel,
    openPanel,
    closePanel,
    setInteractionMode,
    startViewingScreen,
    stopViewingScreen,
    startAskRon,
    setAskRonStep,
    selectAskRonOption,
    submitCustomAskRon,
    closeAskRon,
    consumeAskRonPendingPrompt,
    sendToAgentPanel,
    consumeAgentPanelPrompt,
    consumeAgentPanelAttachments,
  ])

  return (
    <AgentUiContext.Provider value={value}>
      {children}
    </AgentUiContext.Provider>
  )
}

export function SurfaceAgentUiProvider({
  onOpenPanel,
  onSendToAgentPanel,
  children,
}: {
  onOpenPanel: () => void
  onSendToAgentPanel: (prompt: string, attachments?: PromptAttachment[]) => void
  children: ReactNode
}) {
  const value = useMemo<AgentUiContextValue>(() => ({
    isPanelOpen: false,
    interactionMode: 'text',
    isViewingScreen: false,
    screenshotData: null,
    askRonStep: 'closed',
    askRonSelectedText: null,
    askRonSourceUrl: null,
    askRonOptions: [],
    askRonThinkingText: '',
    askRonPendingPrompt: null,
    agentPanelQueuedPrompts: [],
    agentPanelQueuedAttachments: [],
    togglePanel: onOpenPanel,
    openPanel: onOpenPanel,
    closePanel: () => {},
    setInteractionMode: () => {},
    startViewingScreen: () => onOpenPanel(),
    stopViewingScreen: () => {},
    startAskRon: async () => onOpenPanel(),
    setAskRonStep: () => {},
    selectAskRonOption: async () => {},
    submitCustomAskRon: async () => {},
    closeAskRon: () => {},
    consumeAskRonPendingPrompt: () => null,
    sendToAgentPanel: onSendToAgentPanel,
    consumeAgentPanelPrompt: () => null,
    consumeAgentPanelAttachments: () => [],
  }), [onOpenPanel, onSendToAgentPanel])

  return (
    <AgentUiContext.Provider value={value}>
      {children}
    </AgentUiContext.Provider>
  )
}

export function useAgentUi(): AgentUiContextValue {
  const context = useContext(AgentUiContext)
  if (!context) {
    throw new Error('useAgentUi must be used within AgentUiProvider')
  }
  return context
}
