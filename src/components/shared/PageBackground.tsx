import { memo } from 'react'
import { motion } from 'framer-motion'


/**
 * PageBackground — SuperAgent-grade ambient effects
 *
 * Provides NeuralGridBackground + AmbientBreathingGlow matching the
 * SuperAgentInterface aesthetic for all full-page surfaces.
 */

// ─────────────────────────────────────────────────────────────────────────────
// NeuralGridBackground — same as SuperAgentInterface
// ─────────────────────────────────────────────────────────────────────────────

const NeuralGridBackground = memo(function NeuralGridBackground() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Light mode grid */}
      <div className="dark:hidden">
        <div
          className="absolute top-0 right-0 w-[600px] h-[600px] bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.04)_0%,transparent_50%)]"
        />
        <div
          className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-[radial-gradient(circle_at_bottom_left,rgba(55,48,163,0.03)_0%,transparent_50%)]"
        />
        <div
          className="absolute inset-0 opacity-[0.02] bg-[linear-gradient(rgba(0,0,0,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.1)_1px,transparent_1px)] bg-[length:48px_48px]"
        />
      </div>

      {/* Dark mode — Neural grid dots */}
      <div className="hidden dark:block">
        <svg className="w-full h-full opacity-[0.06]">
          {Array.from({ length: 100 }).map((_, i) => (
            <circle
              key={i}
              cx={`${(i % 10) * 10 + 5}%`}
              cy={`${Math.floor(i / 10) * 10 + 5}%`}
              r={1.5}
              className="fill-violet-400"
              style={{
                opacity: 0.3,
              }}
            />
          ))}
        </svg>
      </div>
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// AmbientBreathingGlow — same as SuperAgentInterface
// ─────────────────────────────────────────────────────────────────────────────

const AmbientBreathingGlow = memo(function AmbientBreathingGlow() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden hidden dark:block">
      {/* Core glow */}
      <motion.div
        className="absolute top-1/4 right-1/4 w-[600px] h-[400px]"
        animate={{ scale: [1, 1.05, 1], opacity: [0.06, 0.09, 0.06] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        style={{
          background: 'radial-gradient(ellipse, rgba(139,92,246,0.12), transparent 70%)',
          filter: 'blur(80px)'
        }}
      />
      {/* Middle ring */}
      <motion.div
        className="absolute bottom-1/4 left-1/4 w-[500px] h-[500px]"
        animate={{ scale: [1, 1.03, 1], opacity: [0.04, 0.07, 0.04] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
        style={{
          background: 'radial-gradient(ellipse, rgba(124,58,237,0.08), transparent 70%)',
          filter: 'blur(100px)'
        }}
      />
      {/* Outer haze */}
      <motion.div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[600px]"
        animate={{ scale: [1, 1.02, 1], opacity: [0.02, 0.04, 0.02] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        style={{
          background: 'radial-gradient(ellipse, rgba(99,102,241,0.06), transparent 70%)',
          filter: 'blur(120px)'
        }}
      />
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export function PageBackground() {
  return (
    <>
      <NeuralGridBackground />
      <AmbientBreathingGlow />
    </>
  )
}
