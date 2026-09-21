import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

type OnboardingMode = 'talk' | 'type' | null
type OnboardingStep =
  | 'mode-selection'
  | 'interview'
  | 'reasoning'
  | 'calibration'
  | 'complete'

interface OnboardingAnswer {
  question: string
  answer: string
  timestamp: number
}

interface OnboardingState {
  mode: OnboardingMode
  currentStep: OnboardingStep
  currentQuestionIndex: number
  answers: OnboardingAnswer[]
  isComplete: boolean
  reasoning: {
    steps: Array<{
      type: 'thinking' | 'tool-use' | 'agent-task' | 'search' | 'conclusion'
      content: string
      timestamp: number
    }>
    systemPrompt?: string
  }

  // Actions
  setMode: (mode: OnboardingMode) => void
  nextStep: () => void
  previousStep: () => void
  setAnswer: (question: string, answer: string) => void
  nextQuestion: () => void
  previousQuestion: () => void
  addReasoningStep: (type: string, content: string) => void
  setSystemPrompt: (prompt: string) => void
  completeOnboarding: () => void
  resetOnboarding: () => void
}

const INTERVIEW_QUESTIONS = [
  "What brings you to Ron Browser today?",
  "What topics are you most interested in?",
  "How do you prefer to consume information?",
  "What's your primary goal when browsing?",
  "How important is privacy to you?",
  "Do you prefer summaries or detailed articles?",
  "What time of day do you usually browse?",
  "What frustrates you about current browsers?"
]

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, _get) => ({
      mode: null,
      currentStep: 'mode-selection',
      currentQuestionIndex: 0,
      answers: [],
      isComplete: false,
      reasoning: {
        steps: []
      },

      setMode: (mode: OnboardingMode) => {
        set({ mode, currentStep: 'interview' })
      },

      nextStep: () => {
        set(state => {
          const steps: OnboardingStep[] = [
            'mode-selection',
            'interview',
            'reasoning',
            'calibration',
            'complete'
          ]
          const currentIndex = steps.indexOf(state.currentStep)
          const nextStep = steps[Math.min(currentIndex + 1, steps.length - 1)]
          return { currentStep: nextStep }
        })
      },

      previousStep: () => {
        set(state => {
          const steps: OnboardingStep[] = [
            'mode-selection',
            'interview',
            'reasoning',
            'calibration',
            'complete'
          ]
          const currentIndex = steps.indexOf(state.currentStep)
          const previousStep = steps[Math.max(currentIndex - 1, 0)]
          return { currentStep: previousStep }
        })
      },

      setAnswer: (question: string, answer: string) => {
        set(state => ({
          answers: [
            ...state.answers.filter(a => a.question !== question),
            { question, answer, timestamp: Date.now() }
          ]
        }))
      },

      nextQuestion: () => {
        set(state => {
          const nextIndex = Math.min(
            state.currentQuestionIndex + 1,
            INTERVIEW_QUESTIONS.length - 1
          )
          // Move to reasoning if we've answered all questions
          if (nextIndex === state.currentQuestionIndex &&
              state.currentQuestionIndex === INTERVIEW_QUESTIONS.length - 1) {
            return { currentStep: 'reasoning' }
          }
          return { currentQuestionIndex: nextIndex }
        })
      },

      previousQuestion: () => {
        set(state => ({
          currentQuestionIndex: Math.max(state.currentQuestionIndex - 1, 0)
        }))
      },

      addReasoningStep: (type: string, content: string) => {
        set(state => ({
          reasoning: {
            ...state.reasoning,
            steps: [
              ...state.reasoning.steps,
              {
                type: type as any,
                content,
                timestamp: Date.now()
              }
            ]
          }
        }))
      },

      setSystemPrompt: (prompt: string) => {
        set(state => ({
          reasoning: {
            ...state.reasoning,
            systemPrompt: prompt
          }
        }))
      },

      completeOnboarding: () => {
        set({ isComplete: true, currentStep: 'complete' })
      },

      resetOnboarding: () => {
        set({
          mode: null,
          currentStep: 'mode-selection',
          currentQuestionIndex: 0,
          answers: [],
          isComplete: false,
          reasoning: { steps: [] }
        })
      }
    }),
    {
      name: 'onboarding-storage',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        mode: state.mode,
        currentStep: state.currentStep,
        currentQuestionIndex: state.currentQuestionIndex,
        isComplete: state.isComplete,
        answers: state.answers,
      }),
      migrate: (persisted) => persisted as Partial<OnboardingState>,
    }
  )
)

// Export interview questions for use in components
export { INTERVIEW_QUESTIONS }