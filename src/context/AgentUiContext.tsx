import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useArticleDraftStore } from '@/stores/articleDraftStore'

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

export function askRonPrompt(selectedText: string, sourceUrl: string, intent: string): string {
  return `The user selected this text: "${selectedText}" from ${sourceUrl}. They want you to: ${intent.trim()}`
}

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
  sendToAgentPanel: (prompt: string) => void
  consumeAgentPanelPrompt: () => string | null
}

const AgentUiContext = createContext<AgentUiContextValue | null>(null)

function setElectronPanelOpen(isOpen: boolean): void {
  if (typeof window !== 'undefined' && window.electron?.browser) {
    window.electron.browser.setPanelOpen(isOpen)
  }
}

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

  const openPanel = useCallback(() => {
    setIsPanelOpen(true)
    setElectronPanelOpen(true)
  }, [])

  const closePanel = useCallback(() => {
    setIsPanelOpen(false)
    setElectronPanelOpen(false)
  }, [])

  const togglePanel = useCallback(() => {
    setIsPanelOpen((prev) => {
      const next = !prev
      setElectronPanelOpen(next)
      return next
    })
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

  // Opening the menu is a pure UI step: nothing is sent until the user picks
  // an option, and the choice is then dispatched to whichever mode is visible.
  const startAskRon = useCallback(async (selectedText: string, sourceUrl: string) => {
    useArticleDraftStore.getState().setDestination('panel')
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
    const prompt = askRonPrompt(askRonSelectedText, askRonSourceUrl ?? '', `${option.label}. ${option.description || ''}`)
    setAskRonStepState('executing')
    setAskRonThinkingText(`${option.label}...`)
    setAskRonPendingPrompt(prompt)
    openPanel()
  }, [askRonSelectedText, askRonSourceUrl, openPanel])

  const submitCustomAskRon = useCallback(async (prompt: string) => {
    if (!askRonSelectedText) return
    useArticleDraftStore.getState().setDestination('panel')
    const fullPrompt = askRonPrompt(askRonSelectedText, askRonSourceUrl ?? '', prompt)
    setAskRonStepState('executing')
    setAskRonThinkingText('Processing your request...')
    setAskRonPendingPrompt(fullPrompt)
    openPanel()
  }, [askRonSelectedText, askRonSourceUrl, openPanel])

  const consumeAskRonPendingPrompt = useCallback(() => {
    if (!askRonPendingPrompt) return null
    const nextPrompt = askRonPendingPrompt
    setAskRonPendingPrompt(null)
    return nextPrompt
  }, [askRonPendingPrompt])

  const sendToAgentPanel = useCallback((prompt: string) => {
    const normalized = prompt.trim()
    if (!normalized) return
    useArticleDraftStore.getState().setDestination('panel')
    setAgentPanelQueuedPrompts((prev) => [...prev, normalized])
    openPanel()
  }, [openPanel])

  const consumeAgentPanelPrompt = useCallback(() => {
    if (agentPanelQueuedPrompts.length === 0) return null
    const [nextPrompt, ...remaining] = agentPanelQueuedPrompts
    setAgentPanelQueuedPrompts(remaining)
    return nextPrompt
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
  ])

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
