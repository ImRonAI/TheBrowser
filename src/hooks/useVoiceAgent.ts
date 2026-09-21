/**
 * Voice Agent Hook
 *
 * Manages the Python voice agent subprocess lifecycle and events.
 * Connects Electron IPC to React state for voice onboarding.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useOnboardingStore } from '@/stores/onboardingStore'


export type VoiceAgentState = 'idle' | 'starting' | 'listening' | 'thinking' | 'speaking' | 'complete' | 'stopped' | 'error'

interface VoiceAgentEvent {
  type: 'state_change' | 'transcript' | 'question' | 'answer_recorded' | 'complete'
  data: Record<string, unknown>
}

type VoiceAgentStartResult = { success: boolean; error?: string }

interface UseVoiceAgentOptions {
  enabled: boolean
  apiKey?: string
  onComplete?: () => void
  onError?: (error: string) => void
}

interface UseVoiceAgentResult {
  state: VoiceAgentState
  transcript: string
  currentQuestion: string | null
  agentMessage: string
  error: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
}

export function useVoiceAgent({
  enabled,
  apiKey,
  onComplete,
  onError,
}: UseVoiceAgentOptions): UseVoiceAgentResult {
  const [state, setState] = useState<VoiceAgentState>('idle')
  const [transcript, setTranscript] = useState('')
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null)
  const [agentMessage, setAgentMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)

  // Start the voice agent
  const start = useCallback(async () => {
    if (!window.electron?.voiceAgent) {
      const errorMsg = 'Voice agent API not available'
      setError(errorMsg)
      setState('error')
      onError?.(errorMsg)
      return
    }

    try {
      setState('starting')
      const result = await window.electron.voiceAgent.start(apiKey) as VoiceAgentStartResult

      if (!result.success) {
        const errorMsg = result.error || 'Failed to start voice agent'
        setError(errorMsg)
        setState('error')
        onError?.(errorMsg)
        return
      }

      startedRef.current = true
      setState('listening')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error starting voice agent'
      setError(errorMsg)
      setState('error')
      onError?.(errorMsg)
    }
  }, [apiKey, onError])

  // Stop the voice agent
  const stop = useCallback(async () => {
    if (!window.electron?.voiceAgent) return


    try {
      await window.electron.voiceAgent.stop()
      setState('stopped')
      startedRef.current = false
    } catch (err) {
      console.error('Failed to stop voice agent:', err)
    }
  }, [])

  // Start/stop when enabled toggles
  useEffect(() => {
    if (!enabled || !window.electron?.voiceAgent) return
    let ownsProcess = false
    let cancelled = false

    const startPromise = (async () => {
      if (!startedRef.current) {
        await start()
        ownsProcess = startedRef.current
        if (cancelled && ownsProcess) await stop()
      }
    })()

    return () => {
      cancelled = true
      void startPromise.then(() => {
        if (ownsProcess || startedRef.current) void stop()
      })
    }
  }, [enabled, start, stop])

  // Handle agent events (separate effect to avoid restart loops)
  useEffect(() => {
    if (!enabled || !window.electron?.voiceAgent) return

    // Listen for structured events
    const removeEventListener = window.electron.voiceAgent.onEvent((event) => {
      const agentEvent = event as VoiceAgentEvent

      switch (agentEvent.type) {
        case 'state_change':
          setState(agentEvent.data.state as VoiceAgentState)
          break

        case 'transcript':
          if (agentEvent.data.role === 'user') {
            setTranscript(agentEvent.data.text as string)
          } else if (agentEvent.data.role === 'assistant') {
            setAgentMessage(agentEvent.data.text as string)
          }
          break

        case 'question':
          setCurrentQuestion(agentEvent.data.question as string)
          setAgentMessage(agentEvent.data.question as string)
          break

        case 'answer_recorded':
          // User's answer was recorded, clear transcript
          if (agentEvent.data.question && agentEvent.data.answer) {
            useOnboardingStore.getState().setAnswer(
              agentEvent.data.question as string,
              agentEvent.data.answer as string
            )
          }
          setTranscript('')
          break

        case 'complete':
          setState('stopped')
          onComplete?.()
          break
      }
    })

    // Listen for text output
    const removeOutputListener = window.electron.voiceAgent.onOutput((output) => {
      console.log('[Voice Agent]:', output)
    })

    // Listen for errors
    const removeErrorListener = window.electron.voiceAgent.onError((errorMsg) => {
      console.error('[Voice Agent Error]:', errorMsg)
      setError(errorMsg)
      setState('error')
      onError?.(errorMsg)
    })

    // Listen for agent stopped
    const removeStoppedListener = window.electron.voiceAgent.onStopped(({ code }) => {
      console.log(`[Voice Agent] Stopped with code ${code}`)
      setState('stopped')
    })

    // Cleanup listeners only (stop is handled in the other effect)
    return () => {
      removeEventListener()
      removeOutputListener()
      removeErrorListener()
      removeStoppedListener()
    }
  }, [enabled, onComplete, onError])

  return {
    state,
    transcript,
    currentQuestion,
    agentMessage,
    error,
    start,
    stop,
  }
}
