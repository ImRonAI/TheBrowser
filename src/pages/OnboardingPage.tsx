import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useOnboardingStore, INTERVIEW_QUESTIONS } from '@/stores/onboardingStore'
import { useAuthStore } from '@/stores/authStore'
import { VoiceOnboardingScene } from '@/components/voice-agent'

const EASE = [0.16, 1, 0.3, 1] as const

export function OnboardingPage() {
  const { user } = useAuthStore()
  const {
    mode,
    currentStep,
    currentQuestionIndex,
    setMode,
    nextStep,
    nextQuestion,
    setAnswer,
    completeOnboarding,
    addReasoningStep
  } = useOnboardingStore()
  
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

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

    const currentQuestion = INTERVIEW_QUESTIONS[currentQuestionIndex]
    setAnswer(currentQuestion, inputValue)
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
          timeoutIds.push(setTimeout(completeOnboarding, 1000))
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
          
          {/* STEP 1: MODE SELECTION */}
          {currentStep === 'mode-selection' && (
            <motion.div
              key="mode-selection"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.6, ease: EASE }}
              className="space-y-12 text-center"
            >
              {/* Welcome text */}
              <div className="space-y-4">
                <motion.div 
                  className="w-12 h-1 bg-accent dark:bg-accent-light mx-auto rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: 48 }}
                  transition={{ duration: 0.6, delay: 0.2, ease: EASE }}
                />
                <h1 className="text-display-xl font-display text-ink dark:text-ink-inverse">
                  Welcome, {user?.name || 'Explorer'}<span className="text-accent dark:text-accent-light">.</span>
                </h1>
                <p className="text-body-xl text-ink-secondary dark:text-ink-inverse-secondary">
                  How would you like to set up your experience?
                </p>
              </div>

              {/* Mode selection cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <ModeCard
                  onClick={() => setMode('type')}
                  icon={
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  }
                  title="Text Interview"
                  description="Answer a few questions at your own pace to personalize your feed."
                  delay={0.3}
                />
                <ModeCard
                  onClick={() => setMode('talk')}
                  icon={
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  }
                  title="Voice Calibration"
                  description="Have a natural conversation with our AI agent to set up your profile."
                  delay={0.4}
                />
              </div>
            </motion.div>
          )}

          {/* STEP 2: INTERVIEW - TEXT MODE */}
          {currentStep === 'interview' && mode === 'type' && (
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
                <span className="text-label uppercase tracking-wider text-accent dark:text-accent-light">
                    Question {currentQuestionIndex + 1} of {INTERVIEW_QUESTIONS.length}
                </span>
                <h2 className="text-display-md font-display text-ink dark:text-ink-inverse leading-tight">
                    {INTERVIEW_QUESTIONS[currentQuestionIndex]}
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
                        placeholder="Type your answer here..."
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

          {/* STEP 2: INTERVIEW - VOICE MODE */}
          {currentStep === 'interview' && mode === 'talk' && (
            <VoiceOnboardingScene
              onComplete={() => nextStep()}
              onSkip={() => setMode('type')}
            />
          )}

          {/* STEP 3: REASONING */}
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
          animate={{ width: `${((currentQuestionIndex) / INTERVIEW_QUESTIONS.length) * 100}%` }}
          transition={{ duration: 0.5, ease: EASE }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE CARD COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface ModeCardProps {
  onClick: () => void
  icon: React.ReactNode
  title: string
  description: string
  delay: number
}

function ModeCard({ onClick, icon, title, description, delay }: ModeCardProps) {
  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease: EASE }}
      whileHover={{ y: -4, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="
        group relative p-8 rounded-2xl text-left space-y-4
        bg-surface-0 dark:bg-surface-850
        border border-surface-200 dark:border-surface-700
        hover:border-accent/50 dark:hover:border-accent-light/50
        shadow-soft dark:shadow-dark-soft
        hover:shadow-bold dark:hover:shadow-dark-bold
        transition-all duration-300
      "
    >
      {/* Icon */}
      <div className="
        p-3 rounded-xl w-fit
        bg-surface-100 dark:bg-surface-800
        group-hover:bg-accent/10 dark:group-hover:bg-accent-light/10
        transition-colors duration-300
      ">
        <div className="text-ink dark:text-ink-inverse group-hover:text-accent dark:group-hover:text-accent-light transition-colors">
          {icon}
        </div>
      </div>
      
      {/* Content */}
      <div>
        <h3 className="text-body-xl font-semibold text-ink dark:text-ink-inverse">
          {title}
        </h3>
        <p className="mt-2 text-body-sm text-ink-secondary dark:text-ink-inverse-secondary">
          {description}
        </p>
      </div>

      {/* Arrow indicator */}
      <motion.div 
        className="absolute top-8 right-8 text-ink-muted dark:text-ink-inverse-muted group-hover:text-accent dark:group-hover:text-accent-light"
        initial={{ x: 0 }}
        whileHover={{ x: 4 }}
        transition={{ duration: 0.2 }}
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </motion.div>
    </motion.button>
  )
}
