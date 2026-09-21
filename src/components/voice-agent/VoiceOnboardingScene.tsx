/**
 * Voice Onboarding Scene
 *
 * Full-screen immersive experience for voice onboarding with:
 * - Three.js audio-reactive visualization
 * - Real-time transcript display
 * - Question progress
 * - Agent state feedback
 */
import { motion, AnimatePresence } from 'framer-motion'
import { VoiceAgentVisualizer } from './VoiceAgentVisualizer'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useVoiceAgent } from '@/hooks/useVoiceAgent'

interface VoiceOnboardingSceneProps {
  onComplete?: () => void
  onSkip?: () => void
}

export function VoiceOnboardingScene({
  onComplete,
  onSkip,
}: VoiceOnboardingSceneProps) {
  const { answers } = useOnboardingStore()

  // Connect to Python voice agent
  const {
    state: agentState,
    transcript: currentTranscript,
    agentMessage,
    error,
  } = useVoiceAgent({
    enabled: true,
    apiKey: import.meta.env.VITE_GEMINI_API_KEY,
    onComplete: () => {
      onComplete?.()
    },
    onError: (errorMsg) => {
      console.error('[Voice Onboarding] Error:', errorMsg)
    },
  })

  const progress = (answers.length / 8) * 100
  const isListening = agentState === 'listening'

  return (
    <div className="fixed inset-0 bg-ron-black overflow-hidden">
      {/* Three.js Visualization - Full Screen */}
      <div className="absolute inset-0">
        <VoiceAgentVisualizer isListening={isListening} />
      </div>

      {/* Overlay UI */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Top Bar - Progress */}
        <div className="absolute top-0 left-0 right-0 p-8">
          <div className="max-w-4xl mx-auto pointer-events-auto">
            <div className="glass-ultra rounded-full p-1">
              <div className="relative h-2 bg-ron-black/30 rounded-full overflow-hidden">
                <motion.div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-royal to-royal/60 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>
            </div>
            <div className="flex justify-between items-center mt-3">
              <span className="text-xs font-raleway font-light text-ron-white/60">
                Question {Math.min(answers.length + 1, 8)} of 8
              </span>
              <button
                onClick={onSkip}
                className="text-xs font-raleway font-light text-ron-white/60 hover:text-ron-white transition-colors pointer-events-auto"
              >
                Skip to type mode →
              </button>
            </div>
          </div>
        </div>

        {/* Center - Agent State & Messages */}
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <div className="max-w-3xl w-full space-y-8">
            {/* Agent State Indicator */}
            <AnimatePresence mode="wait">
              <motion.div
                key={agentState}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="text-center"
              >
                <div className="inline-flex items-center gap-3 glass-frosted px-8 py-4 rounded-full pointer-events-auto">
                  {/* State Icon */}
                  <div className="relative">
                    {(agentState === 'idle' || agentState === 'starting') && (
                      <div className="flex gap-1">
                        {[0, 1, 2].map((i) => (
                          <motion.div
                            key={i}
                            className="w-2 h-2 bg-royal rounded-full"
                            animate={{ scale: [1, 1.5, 1] }}
                            transition={{
                              repeat: Infinity,
                              duration: 1,
                              delay: i * 0.2,
                            }}
                          />
                        ))}
                      </div>
                    )}
                    {agentState === 'listening' && (
                      <div className="w-4 h-4 bg-royal rounded-full animate-pulse" />
                    )}
                    {agentState === 'thinking' && (
                      <div className="flex gap-1">
                        {[0, 1, 2].map((i) => (
                          <motion.div
                            key={i}
                            className="w-2 h-2 bg-royal rounded-full"
                            animate={{ scale: [1, 1.5, 1] }}
                            transition={{
                              repeat: Infinity,
                              duration: 1,
                              delay: i * 0.2,
                            }}
                          />
                        ))}
                      </div>
                    )}
                    {agentState === 'speaking' && (
                      <div className="flex gap-1">
                        {[0, 1, 2, 3].map((i) => (
                          <motion.div
                            key={i}
                            className="w-1 h-4 bg-royal rounded-full"
                            animate={{ scaleY: [1, 1.8, 1] }}
                            transition={{
                              repeat: Infinity,
                              duration: 0.8,
                              delay: i * 0.1,
                            }}
                          />
                        ))}
                      </div>
                    )}
                    {(agentState === 'complete' || agentState === 'stopped') && (
                      <svg
                        className="w-5 h-5 text-royal"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                    {agentState === 'error' && (
                      <svg
                        className="w-5 h-5 text-red-500"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    )}
                  </div>

                  {/* State Text */}
                  <span className="font-raleway text-sm font-light text-ron-white">
                    {agentState === 'idle' && 'Initializing...'}
                    {agentState === 'starting' && 'Starting voice agent...'}
                    {agentState === 'listening' && 'Listening to you'}
                    {agentState === 'thinking' && 'Processing...'}
                    {agentState === 'speaking' && "Ron is speaking"}
                    {agentState === 'complete' && 'Interview complete!'}
                    {agentState === 'stopped' && 'Interview stopped'}
                    {agentState === 'error' && 'Error occurred'}
                  </span>
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Agent Message / Question */}
            <AnimatePresence mode="wait">
              {agentMessage && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="text-center"
                >
                  <div className="glass-frosted p-8 rounded-3xl pointer-events-auto">
                    <p className="font-georgia text-2xl text-ron-white leading-relaxed">
                      {agentMessage}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* User Transcript (when listening) */}
            <AnimatePresence>
              {isListening && currentTranscript && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="text-center"
                >
                  <div className="glass-ultra p-6 rounded-2xl pointer-events-auto">
                    <p className="font-raleway text-base text-ron-white/80 italic">
                      "{currentTranscript}"
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Error Display */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="text-center"
                >
                  <div className="glass-frosted p-6 rounded-2xl border border-red-500/30 pointer-events-auto">
                    <p className="font-raleway text-sm text-red-400">
                      {error}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Bottom - Controls */}
        <div className="absolute bottom-8 left-0 right-0">
          <div className="max-w-4xl mx-auto px-8">
            <div className="flex justify-center gap-4">
              {/* Stop Button */}
              {agentState !== 'complete' && (
                <button
                  onClick={onSkip}
                  className="glass-frosted px-6 py-3 rounded-full font-raleway text-sm text-ron-white/60 hover:text-ron-white transition-all hover:scale-105 pointer-events-auto"
                >
                  Stop Interview
                </button>
              )}

              {/* Continue Button (when complete) */}
              {agentState === 'complete' && (
                <motion.button
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  onClick={onComplete}
                  className="glass-frosted px-8 py-4 rounded-full font-raleway text-base text-ron-white bg-royal/20 hover:bg-royal/30 transition-all hover:scale-105 pointer-events-auto"
                >
                  Continue to Next Step →
                </motion.button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Ambient Glow Effects */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-royal/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-royal/10 rounded-full blur-[120px] pointer-events-none" />
    </div>
  )
}

/**
 * Demo component with simulated agent
 */
export function VoiceOnboardingSceneDemo() {
  return (
    <VoiceOnboardingScene
      onComplete={() => console.log('Onboarding complete')}
      onSkip={() => console.log('Skipped to type mode')}
    />
  )
}
