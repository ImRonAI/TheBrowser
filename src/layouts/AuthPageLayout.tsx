import { ReactNode, useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ContextMenu } from '@/components/shared/ContextMenu'
import { AgentUiProvider } from '@/context/AgentUiContext'

interface AuthPageLayoutProps {
  children: ReactNode
}

// Sophisticated easing
const EASE = [0.16, 1, 0.3, 1] as const

export function AuthPageLayout({ children }: AuthPageLayoutProps) {
  // ContextMenu (rendered below) calls useAgentUi() and must be inside the
  // AgentUiProvider. BrowserLayout has its own provider; AuthPageLayout needs
  // its own scope so the sign-in screen can still right-click.
  return (
    <AgentUiProvider>
      <AuthPageLayoutInner>{children}</AuthPageLayoutInner>
    </AgentUiProvider>
  )
}

function AuthPageLayoutInner({ children }: AuthPageLayoutProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    isOpen: boolean
    selectedText?: string
  }>({
    x: 0,
    y: 0,
    isOpen: false,
  })

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      const selection = window.getSelection()
      const selectedText = selection?.toString().trim()

      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        isOpen: true,
        selectedText,
      })
    }

    document.addEventListener('contextmenu', handleContextMenu)
    return () => document.removeEventListener('contextmenu', handleContextMenu)
  }, [])

  return (
    <div className="h-screen w-full bg-surface-50 dark:bg-surface-900 flex relative overflow-hidden">
      {/* Dramatic geometric background - Light mode */}
      <div className="absolute inset-0 dark:hidden">
        {/* Large gradient orb */}
        <div 
          className="absolute -top-1/4 -right-1/4 w-[800px] h-[800px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(99, 102, 241, 0.08) 0%, transparent 70%)',
          }}
        />
        <div 
          className="absolute -bottom-1/4 -left-1/4 w-[600px] h-[600px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(55, 48, 163, 0.05) 0%, transparent 70%)',
          }}
        />
        {/* Grid pattern */}
        <div 
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0,0,0,0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.1) 1px, transparent 1px)
            `,
            backgroundSize: '64px 64px',
          }}
        />
      </div>

      {/* Dark mode background */}
      <div className="absolute inset-0 hidden dark:block">
        {/* Subtle gradient */}
        <div 
          className="absolute top-0 right-0 w-[600px] h-[600px]"
          style={{
            background: 'radial-gradient(circle at top right, rgba(99, 102, 241, 0.08) 0%, transparent 60%)',
          }}
        />
        <div 
          className="absolute bottom-0 left-0 w-[500px] h-[500px]"
          style={{
            background: 'radial-gradient(circle at bottom left, rgba(55, 48, 163, 0.06) 0%, transparent 60%)',
          }}
        />
        {/* Subtle noise texture */}
        <div className="absolute inset-0 opacity-20 noise-texture" />
      </div>

      {/* Left side - Brand statement */}
      <motion.div 
        className="hidden lg:flex lg:w-1/2 xl:w-[55%] relative items-center justify-center p-16"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, ease: EASE }}
      >
        <div className="flex flex-col items-center justify-center">
          {/* Geometric Logo Composition */}
          <div className="relative">
            {/* Purple accent line - top left */}
            <motion.div 
              className="absolute -top-6 left-0 h-[3px] bg-accent dark:bg-accent-light"
              style={{ width: 80 }}
              initial={{ scaleX: 0, originX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.7, delay: 0.4, ease: EASE }}
            />
            
            {/* "Ron" - Hero Typography */}
            <motion.div
              className="text-[10rem] xl:text-[12rem] leading-[0.85] font-display font-bold text-ink dark:text-ink-inverse tracking-tight"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.1, ease: EASE }}
            >
              Ron
            </motion.div>
            
            {/* White accent line - bottom right, diagonal from purple */}
            <motion.div 
              className="absolute -bottom-8 right-0 h-[3px] bg-white/90 dark:bg-ink-inverse"
              style={{ width: 80 }}
              initial={{ scaleX: 0, originX: 1 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.7, delay: 0.6, ease: EASE }}
            />
          </div>
          
          {/* Tagline - Perfectly centered below */}
          <motion.div 
            className="mt-12 text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5, ease: EASE }}
          >
            <span className="text-xl xl:text-2xl font-sans font-light tracking-wide text-white/80 dark:text-ink-inverse/80">
              The{' '}
              <span className="text-accent dark:text-accent-light font-medium">Collaborative</span>
              {' '}Browser OS
            </span>
          </motion.div>
        </div>
      </motion.div>

      {/* Right side - Auth form */}
      <div className="flex-1 flex items-start lg:items-center justify-center p-6 lg:p-10 relative z-10 min-h-0 overflow-y-auto">
        <motion.div 
          className="w-full max-w-md"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: EASE }}
        >
          {/* Logo */}
          <motion.div 
            className="mb-12 lg:hidden text-center"
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <h1 className="text-display-md font-display text-accent dark:text-accent-light">
              Ron
            </h1>
          </motion.div>

          {/* Form card */}
          <div className="bg-surface-0 dark:bg-surface-850 rounded-2xl shadow-bold dark:shadow-dark-bold p-8 lg:p-10 border border-surface-200 dark:border-surface-700">
          {children}
        </div>

          {/* Footer */}
          <motion.p 
            className="mt-8 text-center text-body-xs text-ink-muted dark:text-ink-inverse-muted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.8, ease: EASE }}
          >
            By continuing, you agree to our{' '}
            <a href="#" className="text-accent dark:text-accent-light hover:underline">Terms</a>
            {' '}and{' '}
            <a href="#" className="text-accent dark:text-accent-light hover:underline">Privacy Policy</a>
          </motion.p>
        </motion.div>
      </div>

      {/* Context Menu */}
      <ContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        isOpen={contextMenu.isOpen}
        selectedText={contextMenu.selectedText}
        onClose={() => setContextMenu(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  )
}
