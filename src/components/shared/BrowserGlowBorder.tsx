/**
 * BrowserGlowBorder Component
 * 
 * A stunning animated glow border that appears around the entire app
 * when the browser tool is being actively used by the agent.
 * 
 * Features:
 * - Purple, dark blue, and teal gradient glow
 * - Approximately 40-60px (one fingerwidth) in height
 * - Smooth fade in/out animation
 * - Persists across website navigation
 */

import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { useMemo } from 'react'
import { isBrowserTool } from '@/stores/previewStore'
import { useOrchestrationStore } from '@/stores/orchestrationStore'

export function BrowserGlowBorder() {
  const agentStreamingData = useOrchestrationStore((state) => state.agentStreamingData)
  const prefersReducedMotion = useReducedMotion()
  
  // Detect if the browser tool is active
  const isBrowserToolActive = useMemo(() => {
    for (const streamData of agentStreamingData.values()) {
      const tools = streamData.tools || []
      for (const tool of tools) {
        const toolName = tool.name?.toLowerCase() || ''
        const isUiAutomationTool =
          isBrowserTool(toolName) ||
          toolName.includes('use_computer') ||
          toolName.includes('playwright') ||
          toolName.includes('browser')
        if (isUiAutomationTool && tool.status === 'running') {
          return true
        }
      }
    }
    return false
  }, [agentStreamingData])
  
  const showGlow = isBrowserToolActive

  const baseGradient = `
    rgba(139, 92, 246, 0.78),
    rgba(59, 130, 246, 0.7) 35%,
    rgba(20, 184, 166, 0.62) 70%,
    transparent
  `

  const outerGradient = `
    rgba(139, 92, 246, 0.6),
    rgba(59, 130, 246, 0.55) 40%,
    rgba(20, 184, 166, 0.5) 75%,
    transparent
  `

  const shimmerGradient = `
    linear-gradient(
      120deg,
      rgba(255, 255, 255, 0),
      rgba(147, 197, 253, 0.25) 35%,
      rgba(167, 139, 250, 0.28) 50%,
      rgba(94, 234, 212, 0.22) 65%,
      rgba(255, 255, 255, 0)
    )
  `

  const conicGradient = `
    conic-gradient(
      from 0deg at 50% 50%,
      rgba(139, 92, 246, 0.18),
      rgba(59, 130, 246, 0.14) 20%,
      rgba(20, 184, 166, 0.12) 35%,
      rgba(255, 255, 255, 0) 50%,
      rgba(139, 92, 246, 0.12) 65%,
      rgba(59, 130, 246, 0.16) 80%,
      rgba(94, 234, 212, 0.12)
    )
  `

  const edgeMotion = prefersReducedMotion
    ? { opacity: 0.9 }
    : { opacity: [0.55, 1, 0.55], backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }

  const outerMotion = prefersReducedMotion
    ? { opacity: 0.65 }
    : { opacity: [0.35, 0.85, 0.35], backgroundPosition: ['100% 50%', '0% 50%', '100% 50%'] }

  const shimmerMotion = prefersReducedMotion
    ? { opacity: 0.15 }
    : { opacity: [0.08, 0.24, 0.08], backgroundPosition: ['0% 0%', '100% 100%', '0% 0%'] }

  const conicMotion = prefersReducedMotion
    ? { opacity: 0.2 }
    : { opacity: [0.12, 0.26, 0.12], rotate: [0, 360] }

  const chromaMotion = prefersReducedMotion
    ? { opacity: 0.18 }
    : {
        opacity: [0.12, 0.22, 0.12],
        filter: [
          'blur(30px) hue-rotate(0deg)',
          'blur(30px) hue-rotate(12deg)',
          'blur(30px) hue-rotate(0deg)',
        ],
      }

  const auroraMotion = prefersReducedMotion
    ? { opacity: 0.35 }
    : { opacity: [0.2, 0.55, 0.2], scale: [0.98, 1.05, 0.98] }

  const orbitalMotion = prefersReducedMotion
    ? { opacity: 0.2 }
    : {
        opacity: [0.08, 0.32, 0.08],
        x: ['6vw', '72vw', '72vw', '6vw', '6vw'],
        y: ['6vh', '6vh', '72vh', '72vh', '6vh'],
      }

  const edgeTransition = prefersReducedMotion
    ? { duration: 0.6, ease: 'easeOut' as const }
    : { duration: 9, ease: 'easeInOut' as const, repeat: Infinity }

  const outerTransition = prefersReducedMotion
    ? { duration: 0.8, ease: 'easeOut' as const }
    : { duration: 12, ease: 'easeInOut' as const, repeat: Infinity }

  const shimmerTransition = prefersReducedMotion
    ? { duration: 1, ease: 'easeOut' as const }
    : { duration: 16, ease: 'easeInOut' as const, repeat: Infinity }

  const conicTransition = prefersReducedMotion
    ? { duration: 1, ease: 'easeOut' as const }
    : { duration: 26, ease: 'linear' as const, repeat: Infinity }

  const chromaTransition = prefersReducedMotion
    ? { duration: 1, ease: 'easeOut' as const }
    : { duration: 22, ease: 'easeInOut' as const, repeat: Infinity }

  const auroraTransition = prefersReducedMotion
    ? { duration: 1, ease: 'easeOut' as const }
    : { duration: 14, ease: 'easeInOut' as const, repeat: Infinity }

  const orbitalTransition = prefersReducedMotion
    ? { duration: 1, ease: 'easeOut' as const }
    : { duration: 18, ease: 'easeInOut' as const, repeat: Infinity }

  return (
    <AnimatePresence>
      {showGlow && (
        <>
          {/* Top border glow */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={edgeMotion}
            exit={{ opacity: 0 }}
            transition={edgeTransition}
            className="fixed top-0 left-0 right-0 h-[112px] pointer-events-none z-[9999]"
            style={{
              background: `linear-gradient(to bottom, ${baseGradient})`,
              filter: 'blur(22px)',
              backgroundSize: '260% 260%',
            }}
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={outerMotion}
            exit={{ opacity: 0 }}
            transition={{ ...outerTransition, delay: 0.25 }}
            className="fixed top-0 left-0 right-0 h-[112px] pointer-events-none z-[9998]"
            style={{
              background: `linear-gradient(to bottom, ${outerGradient})`,
              filter: 'blur(40px)',
              mixBlendMode: 'screen',
              backgroundSize: '300% 300%',
            }}
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={shimmerMotion}
            exit={{ opacity: 0 }}
            transition={shimmerTransition}
            className="fixed top-0 left-0 right-0 h-[84px] pointer-events-none z-[9999]"
            style={{
              background: shimmerGradient,
              filter: 'blur(14px)',
              mixBlendMode: 'screen',
              backgroundSize: '400% 400%',
            }}
          />
          
          {/* Bottom border glow */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={edgeMotion}
            exit={{ opacity: 0 }}
            transition={{ ...edgeTransition, delay: 0.2 }}
            className="fixed bottom-0 left-0 right-0 h-[112px] pointer-events-none z-[9999]"
            style={{
              background: `linear-gradient(to top, ${baseGradient})`,
              filter: 'blur(22px)',
              backgroundSize: '260% 260%',
            }}
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={outerMotion}
            exit={{ opacity: 0 }}
            transition={{ ...outerTransition, delay: 0.4 }}
            className="fixed bottom-0 left-0 right-0 h-[112px] pointer-events-none z-[9998]"
            style={{
              background: `linear-gradient(to top, ${outerGradient})`,
              filter: 'blur(40px)',
              mixBlendMode: 'screen',
              backgroundSize: '300% 300%',
            }}
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={shimmerMotion}
            exit={{ opacity: 0 }}
            transition={{ ...shimmerTransition, delay: 0.2 }}
            className="fixed bottom-0 left-0 right-0 h-[84px] pointer-events-none z-[9999]"
            style={{
              background: shimmerGradient,
              filter: 'blur(14px)',
              mixBlendMode: 'screen',
              backgroundSize: '400% 400%',
            }}
          />
          
          {/* Left border glow */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={edgeMotion}
            exit={{ opacity: 0 }}
            transition={{ ...edgeTransition, delay: 0.3 }}
            className="fixed top-0 left-0 bottom-0 w-[112px] pointer-events-none z-[9999]"
            style={{
              background: `linear-gradient(to right, ${baseGradient})`,
              filter: 'blur(22px)',
              backgroundSize: '260% 260%',
            }}
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={outerMotion}
            exit={{ opacity: 0 }}
            transition={{ ...outerTransition, delay: 0.55 }}
            className="fixed top-0 left-0 bottom-0 w-[112px] pointer-events-none z-[9998]"
            style={{
              background: `linear-gradient(to right, ${outerGradient})`,
              filter: 'blur(40px)',
              mixBlendMode: 'screen',
              backgroundSize: '300% 300%',
            }}
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={shimmerMotion}
            exit={{ opacity: 0 }}
            transition={{ ...shimmerTransition, delay: 0.3 }}
            className="fixed top-0 left-0 bottom-0 w-[84px] pointer-events-none z-[9999]"
            style={{
              background: shimmerGradient,
              filter: 'blur(14px)',
              mixBlendMode: 'screen',
              backgroundSize: '400% 400%',
            }}
          />
          
          {/* Right border glow */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={edgeMotion}
            exit={{ opacity: 0 }}
            transition={{ ...edgeTransition, delay: 0.1 }}
            className="fixed top-0 right-0 bottom-0 w-[112px] pointer-events-none z-[9999]"
            style={{
              background: `linear-gradient(to left, ${baseGradient})`,
              filter: 'blur(22px)',
              backgroundSize: '260% 260%',
            }}
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={outerMotion}
            exit={{ opacity: 0 }}
            transition={{ ...outerTransition, delay: 0.35 }}
            className="fixed top-0 right-0 bottom-0 w-[112px] pointer-events-none z-[9998]"
            style={{
              background: `linear-gradient(to left, ${outerGradient})`,
              filter: 'blur(40px)',
              mixBlendMode: 'screen',
              backgroundSize: '300% 300%',
            }}
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={shimmerMotion}
            exit={{ opacity: 0 }}
            transition={{ ...shimmerTransition, delay: 0.1 }}
            className="fixed top-0 right-0 bottom-0 w-[84px] pointer-events-none z-[9999]"
            style={{
              background: shimmerGradient,
              filter: 'blur(14px)',
              mixBlendMode: 'screen',
              backgroundSize: '400% 400%',
            }}
          />

          {/* Conic shimmer sweep */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={conicMotion}
            exit={{ opacity: 0 }}
            transition={conicTransition}
            className="fixed inset-0 pointer-events-none z-[9997]"
            style={{
              background: conicGradient,
              filter: 'blur(32px)',
              mixBlendMode: 'screen',
            }}
          />

          {/* Subtle chroma drift overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={chromaMotion}
            exit={{ opacity: 0 }}
            transition={chromaTransition}
            className="fixed inset-0 pointer-events-none z-[9996]"
            style={{
              background: `
                radial-gradient(
                  circle at 50% 50%,
                  rgba(139, 92, 246, 0.16) 0%,
                  rgba(59, 130, 246, 0.12) 35%,
                  rgba(20, 184, 166, 0.1) 65%,
                  transparent 75%
                )
              `,
              mixBlendMode: 'screen',
            }}
          />

          {/* Orbital shimmer */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={orbitalMotion}
            exit={{ opacity: 0 }}
            transition={orbitalTransition}
            className="fixed pointer-events-none z-[9997]"
            style={{
              width: '220px',
              height: '220px',
              borderRadius: '9999px',
              background: `
                radial-gradient(
                  circle at 40% 40%,
                  rgba(147, 197, 253, 0.35),
                  rgba(167, 139, 250, 0.22) 45%,
                  rgba(94, 234, 212, 0.18) 70%,
                  transparent 80%
                )
              `,
              filter: 'blur(26px)',
              mixBlendMode: 'screen',
            }}
          />

          {/* Corner aurora blooms */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={auroraMotion}
            exit={{ opacity: 0 }}
            transition={{ ...auroraTransition, delay: 0.3 }}
            className="fixed top-0 left-0 pointer-events-none z-[9997]"
            style={{
              width: '260px',
              height: '260px',
              background: 'radial-gradient(circle at 30% 30%, rgba(139, 92, 246, 0.5), rgba(59, 130, 246, 0.2), transparent 70%)',
              filter: 'blur(38px)',
              mixBlendMode: 'screen',
            }}
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={auroraMotion}
            exit={{ opacity: 0 }}
            transition={{ ...auroraTransition, delay: 0.55 }}
            className="fixed top-0 right-0 pointer-events-none z-[9997]"
            style={{
              width: '260px',
              height: '260px',
              background: 'radial-gradient(circle at 70% 30%, rgba(59, 130, 246, 0.45), rgba(20, 184, 166, 0.24), transparent 70%)',
              filter: 'blur(38px)',
              mixBlendMode: 'screen',
            }}
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={auroraMotion}
            exit={{ opacity: 0 }}
            transition={{ ...auroraTransition, delay: 0.75 }}
            className="fixed bottom-0 left-0 pointer-events-none z-[9997]"
            style={{
              width: '260px',
              height: '260px',
              background: 'radial-gradient(circle at 30% 70%, rgba(167, 139, 250, 0.38), rgba(94, 234, 212, 0.28), transparent 72%)',
              filter: 'blur(38px)',
              mixBlendMode: 'screen',
            }}
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={auroraMotion}
            exit={{ opacity: 0 }}
            transition={{ ...auroraTransition, delay: 0.95 }}
            className="fixed bottom-0 right-0 pointer-events-none z-[9997]"
            style={{
              width: '260px',
              height: '260px',
              background: 'radial-gradient(circle at 70% 70%, rgba(59, 130, 246, 0.42), rgba(139, 92, 246, 0.3), transparent 70%)',
              filter: 'blur(38px)',
              mixBlendMode: 'screen',
            }}
          />

          {/* Animated pulse overlay for extra visual impact */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ 
              opacity: prefersReducedMotion ? 0.2 : [0.22, 0.55, 0.22],
              scale: prefersReducedMotion ? 1 : [1, 1.02, 1],
            }}
            exit={{ opacity: 0 }}
            transition={{ 
              duration: 10, 
              ease: 'easeInOut',
              repeat: Infinity,
            }}
            className="fixed inset-0 pointer-events-none z-[9998]"
            style={{
              background: `
                radial-gradient(
                  ellipse at center,
                  transparent 60%,
                  rgba(139, 92, 246, 0.2) 76%,
                  rgba(59, 130, 246, 0.22) 86%,
                  rgba(20, 184, 166, 0.16) 100%
                )
              `,
              filter: 'blur(28px)',
            }}
          />
        </>
      )}
    </AnimatePresence>
  )
}
