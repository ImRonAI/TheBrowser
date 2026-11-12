import { useEffect, useState, useRef, type CSSProperties } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { ArrowRight, Check } from 'lucide-react'
import { RenWordmark } from '@/components/brand'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { useOnboardingStore, INTERVIEW } from '@/stores/onboardingStore'
import { useAuthStore } from '@/stores/authStore'
import { useInterestsStore } from '@/stores/interestsStore'
import { useDiscoverFeedStore } from '@/stores/discoverFeedStore'
import { useDiscoverProfileStore } from '@/stores/discoverProfileStore'

/**
 * Apply freshly-answered interview to everything derived from it: the Interests orb is
 * re-seeded, homepage per-field overrides are dropped (the new answers win), and the cached
 * feed is cleared so Discover fetches for the new profile immediately.
 */
function applyOnboardingAnswers() {
  useDiscoverProfileStore.getState().resetOverrides()
  useDiscoverFeedStore.getState().clear()
  const interests = useInterestsStore.getState()
  interests.resetInterests()
  interests.initializeFromOnboarding()
  if (window.location.hash === '#onboarding') window.location.hash = ''
}

// Ren's house curve (docs/brand.md § Shape and depth: ease-out-expo)
const EASE = [0.19, 1, 0.22, 1] as const

// Shimmer (AI Elements) reads shadcn v4 colour variables; map them onto Ren's tokens.
const SHIMMER_VARS = {
  '--color-muted-foreground': 'hsl(var(--foreground) / 0.72)',
  '--color-background': 'hsl(var(--background))',
} as CSSProperties

const twoDigits = (value: number) => String(value).padStart(2, '0')

export function OnboardingPage() {
  const { user } = useAuthStore()
  const {
    currentStep,
    currentQuestionIndex,
    nextQuestion,
    setAnswer,
    completeOnboarding,
    addReasoningStep
  } = useOnboardingStore()
  const reduceMotion = useReducedMotion()

  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Opened via #onboarding while a previous run is already complete → start a fresh interview.
  useEffect(() => {
    const { isComplete, resetOnboarding } = useOnboardingStore.getState()
    if (isComplete && window.location.hash === '#onboarding') resetOnboarding()
  }, [])

  // Focus input on step change
  useEffect(() => {
    if (currentStep !== 'interview') return
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 500)
    return () => clearTimeout(focusTimer)
  }, [currentStep, currentQuestionIndex])

  // Handle Input Submit
  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!inputValue.trim()) return

    setAnswer(INTERVIEW[currentQuestionIndex].question, inputValue)
    setInputValue('')
    nextQuestion()
  }

  // Handle Reasoning Simulation
  useEffect(() => {
    if (currentStep !== 'reasoning') return
    const steps = [
      { type: 'thinking', content: 'Reading your answers…' },
      { type: 'search', content: 'Finding what you care about…' },
      { type: 'tool-use', content: 'Building your profile…' },
      { type: 'conclusion', content: 'Profile ready.' }
    ]

    const timeoutIds: ReturnType<typeof setTimeout>[] = []
    let delay = 0
    steps.forEach((step, index) => {
      delay += 1500
      timeoutIds.push(setTimeout(() => {
        addReasoningStep(step.type, step.content)
        if (index === steps.length - 1) {
          timeoutIds.push(setTimeout(() => {
            applyOnboardingAnswers()
            completeOnboarding()
          }, 1000))
        }
      }, delay))
    })
    return () => timeoutIds.forEach(clearTimeout)
  }, [currentStep, addReasoningStep, completeOnboarding])

  // Animation variants
  const pageVariants = {
    initial: { opacity: 0, y: reduceMotion ? 0 : 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: reduceMotion ? 0 : -20 }
  }

  return (
    // `ron-content`: in the Glass theme the page becomes the see-through content layer and
    // the paper surface below takes the blue glass tint (index.css § GLASS THEME).
    <div className="ron-content relative min-h-screen w-full overflow-hidden bg-surface-0 text-ink dark:bg-surface-900 dark:text-ink-inverse">
      <div className="relative flex min-h-screen w-full flex-col bg-surface-0 dark:bg-surface-900">
        {/* Progress: a thin volt bar along the top edge */}
        {currentStep === 'interview' && (
          <div className="absolute inset-x-0 top-0 h-[3px] bg-surface-100 dark:bg-surface-850">
            <motion.div
              className="h-full bg-blurple-600 dark:bg-blurple-400"
              initial={{ width: 0 }}
              animate={{ width: `${((currentQuestionIndex) / INTERVIEW.length) * 100}%` }}
              transition={{ duration: 0.5, ease: EASE }}
            />
          </div>
        )}

        {/* Halftone texture, top right */}
        <div aria-hidden className="halftone pointer-events-none absolute -right-28 -top-28 h-[520px] w-[520px]" />

        {/* Header: wordmark + mono step counter */}
        <div className="relative z-10 flex items-center justify-between px-8 pt-10 sm:px-12">
          <RenWordmark className="text-[24px] text-ink dark:text-ink-inverse" />
          {currentStep === 'interview' && (
            <span className="font-mono text-[12px] font-medium tabular-nums tracking-[0.08em] text-ink-secondary dark:text-ink-inverse-secondary">
              {twoDigits(currentQuestionIndex + 1)}
              <span className="text-ink-muted dark:text-ink-inverse-muted"> / {twoDigits(INTERVIEW.length)}</span>
            </span>
          )}
        </div>

        <div className="relative z-10 flex flex-1 items-center justify-center px-8 pb-20 pt-10 sm:px-12">
          <div className="w-full max-w-2xl">
            <AnimatePresence mode="wait">

              {/* STEP 1: INTERVIEW */}
              {currentStep === 'interview' && (
                <motion.div
                  key={`question-${currentQuestionIndex}`}
                  variants={pageVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.45, ease: EASE }}
                  className="space-y-10"
                >
                  {/* Question */}
                  <div className="space-y-5">
                    {currentQuestionIndex === 0 && (
                      <p className="text-body-lg text-ink-secondary dark:text-ink-inverse-secondary">
                        Welcome, {user?.name || 'builder'}. A few quick questions and Ren tunes your home page to you.
                      </p>
                    )}
                    <p className="tag-label tag-label-slash">
                      Question {currentQuestionIndex + 1} of {INTERVIEW.length}
                    </p>
                    <h2 className="font-display text-display-md font-extrabold tracking-[-0.035em] text-ink dark:text-ink-inverse sm:text-display-lg">
                      {INTERVIEW[currentQuestionIndex].question}
                    </h2>
                  </div>

                  {/* Answer */}
                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="relative overflow-hidden">
                      <div className="overflow-x-auto scrollbar-none">
                        <input
                          ref={inputRef}
                          type="text"
                          value={inputValue}
                          onChange={(e) => setInputValue(e.target.value)}
                          placeholder={INTERVIEW[currentQuestionIndex].placeholder}
                          aria-label={INTERVIEW[currentQuestionIndex].question}
                          className="
                            ron-field min-w-full bg-transparent [.glass_&]:rounded-2xl [.glass_&]:pl-5
                            border-b-2 border-surface-200 dark:border-surface-700
                            focus:border-blurple-600 dark:focus:border-blurple-400
                            font-display text-display-sm font-semibold tracking-[-0.025em]
                            text-ink dark:text-ink-inverse
                            py-4 pr-4 outline-none
                            transition-colors duration-200
                            placeholder:font-sans placeholder:text-body-xl placeholder:font-normal placeholder:tracking-normal
                            placeholder:text-ink-muted dark:placeholder:text-ink-inverse-muted
                            whitespace-nowrap
                          "
                          autoFocus
                          style={{ width: Math.max(100, inputValue.length * 18 + 120) + 'px' }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-4">
                      <span className="hidden items-center gap-1.5 text-[12px] text-ink-secondary dark:text-ink-inverse-muted sm:inline-flex">
                        Press <kbd className="kbd">Enter</kbd>
                      </span>
                      <button
                        type="submit"
                        disabled={!inputValue.trim()}
                        className="group inline-flex h-11 items-center gap-2 rounded-lg bg-blurple-600 px-5 text-[14px] font-semibold text-white transition-colors duration-150 hover:bg-blurple-700 active:translate-y-px active:bg-blurple-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300"
                      >
                        Next
                        <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
                      </button>
                    </div>
                  </form>
                </motion.div>
              )}

              {/* STEP 2: REASONING */}
              {currentStep === 'reasoning' && (
                <motion.div
                  key="reasoning"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-6"
                >
                  <p className="tag-label tag-label-slash">Tuning</p>
                  <h2 className="font-display text-display-md font-extrabold tracking-[-0.035em] text-ink dark:text-ink-inverse sm:text-display-lg">
                    Making Ren yours<span className="text-volt">.</span>
                  </h2>

                  {/* Status messages */}
                  <div className="relative h-7 overflow-hidden" style={SHIMMER_VARS}>
                    <AnimatePresence mode="popLayout">
                      {useOnboardingStore.getState().reasoning.steps.slice(-1).map((step) => (
                        <motion.div
                          key={step.timestamp}
                          initial={{ y: 20, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          exit={{ y: -20, opacity: 0 }}
                          className="font-mono text-[13px] leading-7"
                        >
                          <Shimmer as="span">{step.content}</Shimmer>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}

              {/* STEP 4: COMPLETE */}
              {currentStep === 'complete' && (
                <motion.div
                  key="complete"
                  variants={pageVariants}
                  initial="initial"
                  animate="animate"
                  className="space-y-6"
                >
                  <motion.div
                    initial={{ scale: reduceMotion ? 1 : 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    className="spray-halo flex h-14 w-14 items-center justify-center rounded-2xl bg-blurple-600 text-white dark:bg-blurple-400 dark:text-ink"
                  >
                    <Check className="h-7 w-7" strokeWidth={2.5} />
                  </motion.div>
                  <h1 className="font-display text-display-lg font-extrabold tracking-[-0.035em] text-ink dark:text-ink-inverse">
                    You’re set<span className="text-volt">.</span>
                  </h1>
                  <p className="text-body-lg text-ink-secondary dark:text-ink-inverse-secondary">
                    Taking you to your home page…
                  </p>
                </motion.div>
              )}

            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}
