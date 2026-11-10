import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/** Voice ("talk") onboarding is retired; the interview is typed. Kept for persisted-state compatibility. */
type OnboardingMode = 'type' | null
type OnboardingStep =
  | 'interview'
  | 'reasoning'
  | 'calibration'
  | 'complete'

const ONBOARDING_STEPS: OnboardingStep[] = ['interview', 'reasoning', 'calibration', 'complete']

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

export type InterviewQuestionId =
  | 'intent' | 'topics' | 'home' | 'goal' | 'teams' | 'format' | 'markets' | 'media'

export interface InterviewQuestion {
  id: InterviewQuestionId
  question: string
  placeholder: string
}

/**
 * Interview script. Answers stay free text (typed or spoken); `discoverProfileStore`
 * parses them into the structured inputs the Discover homepage needs (home location →
 * weather/local news/country, teams → sports cards, markets → stock/crypto/currency
 * cards, media → video sections). Question text is the persisted key for answers, and
 * `interestsStore` keyword-matches `topics` / `brings you` / `goal`, so keep those words.
 */
const INTERVIEW: InterviewQuestion[] = [
  { id: 'intent', question: "What brings you to Ren Browser today?",
    placeholder: 'e.g. Staying on top of AI news without the noise' },
  { id: 'topics', question: "What topics are you most interested in?",
    placeholder: 'e.g. AI, design, climate, cooking' },
  { id: 'home', question: "Where's home? Your city and country set your weather and local news.",
    placeholder: 'e.g. San Francisco, USA' },
  { id: 'goal', question: "What's your primary goal when browsing?",
    placeholder: 'e.g. Research for work, keeping up with friends' },
  { id: 'teams', question: "Which teams or leagues do you follow, if any?",
    placeholder: 'e.g. Lakers, Arsenal, Formula 1 — or none' },
  { id: 'format', question: "Do you prefer summaries or detailed articles?",
    placeholder: 'e.g. Summaries first, details when I ask' },
  { id: 'markets', question: "Any stocks, crypto or currencies you want to keep an eye on?",
    placeholder: 'e.g. TSLA, NVDA, bitcoin, GBP — or none' },
  { id: 'media', question: "How do you like your news: articles, videos, or a mix? Include local stories?",
    placeholder: 'e.g. Mostly articles, a few videos, yes to local' },
]

const INTERVIEW_QUESTIONS = INTERVIEW.map((item) => item.question)

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, _get) => ({
      mode: 'type',
      currentStep: 'interview',
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
          const currentIndex = ONBOARDING_STEPS.indexOf(state.currentStep)
          const nextStep = ONBOARDING_STEPS[Math.min(currentIndex + 1, ONBOARDING_STEPS.length - 1)]
          return { currentStep: nextStep }
        })
      },

      previousStep: () => {
        set(state => {
          const currentIndex = ONBOARDING_STEPS.indexOf(state.currentStep)
          const previousStep = ONBOARDING_STEPS[Math.max(currentIndex - 1, 0)]
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
          mode: 'type',
          currentStep: 'interview',
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
      version: 2,
      partialize: (state) => ({
        mode: state.mode,
        currentStep: state.currentStep,
        currentQuestionIndex: state.currentQuestionIndex,
        isComplete: state.isComplete,
        answers: state.answers,
      }),
      migrate: (persisted, version) => migrateOnboardingState(persisted, version),
    }
  )
)

/**
 * v1 → v2: the voice/type mode-selection step is gone and four interview questions were
 * replaced with Discover-specific ones. Users mid-interview restart at the interview step;
 * answers to retired questions are dropped (they were never read anywhere).
 */
export function migrateOnboardingState(persisted: unknown, version: number): Partial<OnboardingState> {
  const state = (persisted ?? {}) as Record<string, unknown>
  if (version >= 2) return state as Partial<OnboardingState>
  const answers = Array.isArray(state.answers)
    ? (state.answers as OnboardingAnswer[]).filter((item) => INTERVIEW_QUESTIONS.includes(item.question))
    : []
  const currentStep = state.currentStep === 'mode-selection' || !ONBOARDING_STEPS.includes(state.currentStep as OnboardingStep)
    ? 'interview'
    : (state.currentStep as OnboardingStep)
  return {
    ...state,
    mode: 'type',
    currentStep,
    currentQuestionIndex: currentStep === 'interview' ? 0 : (state.currentQuestionIndex as number) ?? 0,
    answers,
  }
}

/** Look up the stored answer for a question id (undefined when unanswered or blank). */
export function answerFor(answers: OnboardingAnswer[], id: InterviewQuestionId): string | undefined {
  const question = INTERVIEW.find((item) => item.id === id)?.question
  const answer = question ? answers.find((item) => item.question === question)?.answer.trim() : undefined
  return answer || undefined
}

// Export interview questions for use in components
export { INTERVIEW, INTERVIEW_QUESTIONS }
export type { OnboardingAnswer }