import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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

const EASE = [0.16, 1, 0.3, 1] as const

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
      { type: 'thinking', content: 'Analyzing responses...' },
      { type: 'search', content: 'Identifying key interest clusters...' },
      { type: 'tool-use', content: 'Generating personal profile...' },
      { type: 'conclusion', content: 'Profile calibration complete.' }
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
    initial: { opacity: 0, y: 24 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -24 }
  }

  return (
    <div className="min-h-screen w-full flex flex-col justify-center items-center bg-surface-0 dark:bg-surface-900 p-8 overflow-hidden relative">
      {/* Background decorations */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Light mode */}
        <div className="dark:hidden">
          <div 
            className="absolute top-0 left-1/4 w-[600px] h-[600px]"
            style={{
              background: 'radial-gradient(circle, rgba(99, 102, 241, 0.05) 0%, transparent 60%)',
            }}
          />
          <div 
            className="absolute bottom-0 right-1/4 w-[500px] h-[500px]"
            style={{
              background: 'radial-gradient(circle, rgba(55, 48, 163, 0.04) 0%, transparent 60%)',
            }}
          />
        </div>
        {/* Dark mode */}
        <div className="hidden dark:block">
          <div 
            className="absolute top-1/4 left-1/3 w-[500px] h-[500px]"
            style={{
              background: 'radial-gradient(circle, rgba(99, 102, 241, 0.08) 0%, transparent 60%)',
              filter: 'blur(60px)',
            }}
          />
        </div>
      </div>

      <div className="max-w-2xl w-full z-10">
        <AnimatePresence mode="wait">
          
          {/* STEP 1: INTERVIEW */}
          {currentStep === 'interview' && (
            <motion.div
              key={`question-${currentQuestionIndex}`}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.5, ease: EASE }}
              className="space-y-8"
            >
              {/* Progress indicator */}
               <div className="space-y-2">
                {currentQuestionIndex === 0 && (
                  <p className="text-body-lg text-ink-secondary dark:text-ink-inverse-secondary">
                    Welcome, {user?.name || 'Explorer'}. A few quick questions personalize your home page.
                  </p>
                )}
                <span className="text-label uppercase tracking-wider text-accent dark:text-accent-light">
                    Question {currentQuestionIndex + 1} of {INTERVIEW.length}
                </span>
                <h2 className="text-display-md font-display text-ink dark:text-ink-inverse leading-tight">
                    {INTERVIEW[currentQuestionIndex].question}
                </h2>
               </div>

              {/* Input form */}
               <form onSubmit={handleSubmit} className="space-y-6">
                <div className="relative group">
                  {/* Scrollable input container */}
                  <div className="relative overflow-hidden">
                    <div className="overflow-x-auto scrollbar-none">
                      <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder={INTERVIEW[currentQuestionIndex].placeholder}
                        className="
                          min-w-full bg-transparent
                          border-b-2 border-surface-200 dark:border-surface-700
                          focus:border-accent dark:focus:border-accent-light
                          text-display-sm text-ink dark:text-ink-inverse
                          py-4 pr-28 outline-none
                          transition-colors duration-300
                          placeholder:text-ink-muted dark:placeholder:text-ink-inverse-muted
                          placeholder:font-sans placeholder:text-body-xl placeholder:font-thin
                          font-thin
                          whitespace-nowrap
                        "
                        autoFocus
                        style={{ width: Math.max(100, inputValue.length * 18 + 120) + 'px' }}
                      />
                    </div>
                  </div>
                  <div className="absolute right-0 bottom-4 flex items-center text-body-sm text-ink-muted dark:text-ink-inverse-muted bg-surface-0 dark:bg-surface-900 pl-4">
                    Press Enter ↵
                  </div>
                </div>
                
                <div className="flex justify-end">
                  <motion.button
                    type="submit"
                    disabled={!inputValue.trim()}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="
                      px-8 py-3 rounded-xl
                      bg-accent dark:bg-accent-light
                      text-white text-body-md font-semibold
                      disabled:opacity-50 disabled:cursor-not-allowed
                      hover:shadow-glow-accent
                      transition-all duration-300
                      flex items-center gap-2
                    "
                  >
                    Next
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </motion.button>
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
              className="text-center space-y-8"
            >
              {/* Loading spinner */}
                <div className="relative w-24 h-24 mx-auto">
                <div className="absolute inset-0 border-2 border-surface-200 dark:border-surface-700 rounded-full" />
                <motion.div 
                  className="absolute inset-0 border-2 border-t-accent dark:border-t-accent-light rounded-full"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                />
                </div>
              
              <h2 className="text-display-sm font-display text-ink dark:text-ink-inverse">
                Calibrating your experience<span className="text-accent dark:text-accent-light">...</span>
              </h2>
              
              {/* Status messages */}
                <div className="h-8 overflow-hidden relative">
                    <AnimatePresence mode="popLayout">
                        {useOnboardingStore.getState().reasoning.steps.slice(-1).map((step) => (
                             <motion.div
                                key={step.timestamp}
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                exit={{ y: -20, opacity: 0 }}
                      className="text-body-sm text-ink-muted dark:text-ink-inverse-muted font-mono"
                             >
                                {step.content}
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
               className="text-center space-y-6"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center"
              >
                <svg className="w-8 h-8 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </motion.div>
              <h1 className="text-display-lg font-display text-ink dark:text-ink-inverse">
                All Set<span className="text-accent dark:text-accent-light">!</span>
              </h1>
              <p className="text-body-lg text-ink-secondary dark:text-ink-inverse-secondary">
                Redirecting you to your personalized home...
              </p>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
      
      {/* Progress Bar */}
      {currentStep === 'interview' && (
        <motion.div 
          className="absolute bottom-0 left-0 h-1 bg-accent dark:bg-accent-light"
          initial={{ width: 0 }}
          animate={{ width: `${((currentQuestionIndex) / INTERVIEW.length) * 100}%` }}
          transition={{ duration: 0.5, ease: EASE }}
        />
      )}
    </div>
  )
}
