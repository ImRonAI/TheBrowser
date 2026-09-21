import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { getAccessToken } from '@/api/supabase'
import { API_BASE_URL, API_ENDPOINTS } from '@/pages/types/api'

export interface AskRonOption {
  id: string
  label: string
  description?: string
}

export type AskRonStep = 'closed' | 'loading' | 'options' | 'custom-prompt' | 'executing'

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

  const closeAskRon = useCallback(() => {
    setAskRonStepState('closed')
    setAskRonSelectedText(null)
    setAskRonSourceUrl(null)
    setAskRonOptions([])
    setAskRonPendingPrompt(null)
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

  const startAskRon = useCallback(async (selectedText: string, sourceUrl: string) => {
    setAskRonStepState('loading')
    setAskRonSelectedText(selectedText)
    setAskRonSourceUrl(sourceUrl)
    setAskRonOptions([])
    setAskRonThinkingText('Analyzing selection...')
    setAskRonPendingPrompt(null)
    openPanel()

    try {
      const token = await getAccessToken()
      const prompt = `The user has sent you this text "${selectedText}" from ${sourceUrl}. Please select three likely options of what the user would want you to do with this text, and output it in json format like: {"options": [{"id": "1", "label": "Option label", "description": "Brief description"}, ...]}`

      setAskRonThinkingText('Getting suggestions...')

      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.agent.chat}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: prompt,
          session_id: `askron-${Date.now()}`,
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      let options: AskRonOption[] = []
      try {
        const jsonMatch = data.content?.match(/\{[\s\S]*"options"[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          options = parsed.options || []
        }
      } catch {
        options = []
      }

      if (options.length === 0) {
        options = [
          { id: '1', label: 'Summarize this text', description: 'Get a brief summary' },
          { id: '2', label: 'Explain this text', description: 'Understand what it means' },
          { id: '3', label: 'Find related information', description: 'Search for more context' },
        ]
      }

      setAskRonStepState('options')
      setAskRonOptions(options.slice(0, 3))
    } catch (error) {
      console.error('Failed to get Ask Ron suggestions:', error)
      setAskRonStepState('options')
      setAskRonOptions([
        { id: '1', label: 'Summarize this text', description: 'Get a brief summary' },
        { id: '2', label: 'Explain this text', description: 'Understand what it means' },
        { id: '3', label: 'Find related information', description: 'Search for more context' },
      ])
    }
  }, [openPanel])

  const selectAskRonOption = useCallback(async (option: AskRonOption) => {
    if (!askRonSelectedText) return
    const prompt = `The user selected this text: "${askRonSelectedText}" from ${askRonSourceUrl}. They want you to: ${option.label}. ${option.description || ''}`
    setAskRonStepState('executing')
    setAskRonThinkingText(`${option.label}...`)
    setAskRonPendingPrompt(prompt)
    openPanel()
  }, [askRonSelectedText, askRonSourceUrl, openPanel])

  const submitCustomAskRon = useCallback(async (prompt: string) => {
    if (!askRonSelectedText) return
    const fullPrompt = `The user selected this text: "${askRonSelectedText}" from ${askRonSourceUrl}. They want you to: ${prompt}`
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
