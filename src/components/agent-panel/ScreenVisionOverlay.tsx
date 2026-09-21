import { motion, AnimatePresence } from 'framer-motion'
import { useAgentUi } from '@/context/AgentUiContext'

export function ScreenVisionOverlay() {
  const { isViewingScreen } = useAgentUi()

  return (
    <AnimatePresence>
      {isViewingScreen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="fixed inset-0 z-40 pointer-events-none"
        >
          {/* Corner brackets - frame indicator */}
          <svg className="absolute inset-0 w-full h-full">
            <defs>
              <linearGradient id="royal-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: '#2D3B87', stopOpacity: 0.6 }} />
                <stop offset="100%" style={{ stopColor: '#4A3B87', stopOpacity: 0.6 }} />
              </linearGradient>
            </defs>

            {/* Top-left bracket */}
            <motion.path
              d="M 40 20 L 20 20 L 20 40"
              stroke="url(#royal-gradient)"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            />

            {/* Top-right bracket */}
            <motion.path
              d="M calc(100vw - 40) 20 L calc(100vw - 20) 20 L calc(100vw - 20) 40"
              stroke="url(#royal-gradient)"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            />

            {/* Bottom-left bracket */}
            <motion.path
              d="M 40 calc(100vh - 20) L 20 calc(100vh - 20) L 20 calc(100vh - 40)"
              stroke="url(#royal-gradient)"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
            />

            {/* Bottom-right bracket */}
            <motion.path
              d="M calc(100vw - 40) calc(100vh - 20) L calc(100vw - 20) calc(100vh - 20) L calc(100vw - 20) calc(100vh - 40)"
              stroke="url(#royal-gradient)"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
            />
          </svg>

          {/* Scanning line - elegant sweep */}
          <motion.div
            className="absolute left-0 right-0 h-px"
            style={{
              background: 'linear-gradient(90deg, transparent 0%, rgba(45, 59, 135, 0.4) 20%, rgba(74, 59, 135, 0.6) 50%, rgba(45, 59, 135, 0.4) 80%, transparent 100%)',
              boxShadow: '0 0 20px rgba(45, 59, 135, 0.5), 0 0 40px rgba(74, 59, 135, 0.3)',
            }}
            animate={{
              top: ['0%', '100%'],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: 'linear',
            }}
          />

          {/* Focus zones - subtle highlights showing areas of interest */}
          <motion.div
            className="absolute top-1/4 left-1/4 w-32 h-32"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: [0, 0.3, 0], scale: [0.8, 1, 1.2] }}
            transition={{
              duration: 2,
              repeat: Infinity,
              repeatDelay: 1,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            <div className="w-full h-full rounded-sm border-2 border-royal dark:border-royal-light" style={{
              boxShadow: '0 0 30px rgba(45, 59, 135, 0.4), inset 0 0 30px rgba(45, 59, 135, 0.2)',
            }} />
          </motion.div>

          <motion.div
            className="absolute top-1/2 right-1/3 w-24 h-24"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: [0, 0.3, 0], scale: [0.8, 1, 1.2] }}
            transition={{
              duration: 2,
              repeat: Infinity,
              repeatDelay: 1,
              delay: 0.5,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            <div className="w-full h-full rounded-sm border-2 border-royal-purple dark:border-royal-light" style={{
              boxShadow: '0 0 30px rgba(74, 59, 135, 0.4), inset 0 0 30px rgba(74, 59, 135, 0.2)',
            }} />
          </motion.div>

          <motion.div
            className="absolute bottom-1/3 left-1/2 w-28 h-28"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: [0, 0.3, 0], scale: [0.8, 1, 1.2] }}
            transition={{
              duration: 2,
              repeat: Infinity,
              repeatDelay: 1,
              delay: 1,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            <div className="w-full h-full rounded-sm border-2 border-royal dark:border-royal-light" style={{
              boxShadow: '0 0 30px rgba(45, 59, 135, 0.4), inset 0 0 30px rgba(45, 59, 135, 0.2)',
            }} />
          </motion.div>

          {/* Vision active indicator - top center */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="absolute top-8 left-1/2 -translate-x-1/2"
          >
            <div className="glass-ultra rounded-sm px-4 py-2 flex items-center gap-3">
              {/* Pulsing dot indicator */}
              <motion.div
                className="w-2 h-2 rounded-full bg-royal dark:bg-royal-light"
                animate={{
                  opacity: [1, 0.4, 1],
                  scale: [1, 0.8, 1],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />
              <span className="text-xs font-raleway font-raleway-bold tracking-wider uppercase text-royal dark:text-royal-light">
                Vision Active
              </span>
            </div>
          </motion.div>

          {/* Subtle vignette to draw focus */}
          <div
            className="absolute inset-0"
            style={{
              background: 'radial-gradient(circle at center, transparent 40%, rgba(10, 10, 10, 0.05) 100%)',
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
