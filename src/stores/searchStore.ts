/**
 * Search Store
 * 
 * Manages search state including query, phases, and results.
 * Handles the flow: idle -> thinking -> reasoning -> results -> complete
 */

import { create } from 'zustand'
import type { SourceData } from '@/components/search-results/SourceCard'
import type { ReasoningStep, QuickSearchResult } from '@/components/search-results/SearchQuickResults'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SearchPhase = 
  | 'idle'           // No search active
  | 'thinking'       // Initial animation (blob + bubble)
  | 'reasoning'      // Chain of thought streaming
  | 'answering'      // Answer streaming
  | 'complete'       // Quick results ready
  | 'chatting'       // Chat mode active
  | 'full-results'   // Full search results page

interface SearchState {
  // Core state
  query: string
  phase: SearchPhase
  isSearchActive: boolean
  
  // Quick results data
  quickResult: QuickSearchResult | null
  isStreaming: boolean
  
  // Chat state
  chatSessionId: string | null
  
  // Actions
  search: (query: string) => void
  setPhase: (phase: SearchPhase) => void
  updateQuickResult: (update: Partial<QuickSearchResult>) => void
  addReasoningStep: (step: ReasoningStep) => void
  updateReasoningStep: (id: string, update: Partial<ReasoningStep>) => void
  appendAnswer: (text: string) => void
  addSource: (source: SourceData) => void
  setSources: (sources: SourceData[]) => void
  setIsStreaming: (isStreaming: boolean) => void
  goToFullResults: () => void
  goToChat: () => void
  setChatSessionId: (sessionId: string) => void
  tryAgain: (feedback?: string) => void
  clearSearch: () => void
  reset: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Initial State
// ─────────────────────────────────────────────────────────────────────────────

const initialQuickResult: QuickSearchResult = {
  query: '',
  answer: '',
  isAnswerComplete: false,
  reasoning: [],
  sources: [],
  relatedQueries: [],
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useSearchStore = create<SearchState>()((set, get) => ({
  // Initial state
  query: '',
  phase: 'idle',
  isSearchActive: false,
  quickResult: null,
  isStreaming: false,
  chatSessionId: null,
  
  // Start a new search
  search: (query: string) => {
    if (!query.trim()) return
    
    set({
      query: query.trim(),
      phase: 'thinking',
      isSearchActive: true,
      isStreaming: true,
      quickResult: {
        ...initialQuickResult,
        query: query.trim(),
      },
    })
    
    // Auto-transition from thinking to reasoning after animation
    setTimeout(() => {
      const state = get()
      if (state.phase === 'thinking') {
        set({ phase: 'reasoning' })
      }
    }, 2500) // Allow thinking animation to play
  },
  
  // Manually set phase
  setPhase: (phase: SearchPhase) => {
    set({ phase })
  },
  
  // Update quick result
  updateQuickResult: (update: Partial<QuickSearchResult>) => {
    set((state) => ({
      quickResult: state.quickResult
        ? { ...state.quickResult, ...update }
        : { ...initialQuickResult, ...update },
    }))
  },
  
  // Add a reasoning step
  addReasoningStep: (step: ReasoningStep) => {
    set((state) => ({
      quickResult: state.quickResult
        ? {
            ...state.quickResult,
            reasoning: [...state.quickResult.reasoning, step],
          }
        : null,
    }))
  },
  
  // Update an existing reasoning step
  updateReasoningStep: (id: string, update: Partial<ReasoningStep>) => {
    set((state) => ({
      quickResult: state.quickResult
        ? {
            ...state.quickResult,
            reasoning: state.quickResult.reasoning.map((step) =>
              step.id === id ? { ...step, ...update } : step
            ),
          }
        : null,
    }))
  },
  
  // Append to the answer (for streaming)
  appendAnswer: (text: string) => {
    const state = get()
    
    // Transition to answering phase if needed
    if (state.phase === 'reasoning') {
      set({ phase: 'answering' })
    }
    
    set((state) => ({
      quickResult: state.quickResult
        ? {
            ...state.quickResult,
            answer: state.quickResult.answer + text,
          }
        : null,
    }))
  },
  
  // Add a single source
  addSource: (source: SourceData) => {
    set((state) => ({
      quickResult: state.quickResult
        ? {
            ...state.quickResult,
            sources: [...state.quickResult.sources, source],
          }
        : null,
    }))
  },
  
  // Set all sources at once
  setSources: (sources: SourceData[]) => {
    set((state) => ({
      quickResult: state.quickResult
        ? {
            ...state.quickResult,
            sources,
          }
        : null,
    }))
  },
  
  // Set streaming state
  setIsStreaming: (isStreaming: boolean) => {
    set({ isStreaming })
    
    if (!isStreaming) {
      // Mark answer as complete when streaming ends
      set((state) => ({
        phase: 'complete',
        quickResult: state.quickResult
          ? { ...state.quickResult, isAnswerComplete: true }
          : null,
      }))
    }
  },
  
  // Navigate to full results
  goToFullResults: () => {
    set({ phase: 'full-results' })
  },
  
  // Navigate to chat mode
  goToChat: () => {
    set({ phase: 'chatting' })
  },
  
  // Set chat session ID
  setChatSessionId: (sessionId: string) => {
    set({ chatSessionId: sessionId })
  },
  
  // Try again with optional feedback
  tryAgain: (feedback?: string) => {
    const state = get()
    const newQuery = feedback
      ? `${state.query} ${feedback}`
      : state.query
    
    // Reset and search again
    set({
      phase: 'thinking',
      isStreaming: true,
      quickResult: {
        ...initialQuickResult,
        query: newQuery,
      },
    })
    
    // Auto-transition from thinking to reasoning
    setTimeout(() => {
      const currentState = get()
      if (currentState.phase === 'thinking') {
        set({ phase: 'reasoning' })
      }
    }, 2500)
  },
  
  // Clear search and return to home
  clearSearch: () => {
    set({
      query: '',
      phase: 'idle',
      isSearchActive: false,
      quickResult: null,
      isStreaming: false,
      chatSessionId: null,
    })
  },
  
  // Reset to initial state
  reset: () => {
    set({
      query: '',
      phase: 'idle',
      isSearchActive: false,
      quickResult: null,
      isStreaming: false,
      chatSessionId: null,
    })
  },
}))

// ─────────────────────────────────────────────────────────────────────────────
// Selectors
// ─────────────────────────────────────────────────────────────────────────────

export const selectIsThinking = (state: SearchState) => state.phase === 'thinking'
export const selectIsReasoning = (state: SearchState) => state.phase === 'reasoning'
export const selectIsAnswering = (state: SearchState) => state.phase === 'answering'
export const selectShowQuickResults = (state: SearchState) => 
  state.phase === 'reasoning' || state.phase === 'answering' || state.phase === 'complete'
export const selectShowChat = (state: SearchState) => state.phase === 'chatting'
export const selectShowFullResults = (state: SearchState) => state.phase === 'full-results'
