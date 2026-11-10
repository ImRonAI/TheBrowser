import { ReactNode, useState, useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ContextMenu } from '@/components/shared/ContextMenu'
import { Marker, RenWordmark } from '@/components/brand'
import { AgentUiProvider } from '@/context/AgentUiContext'
import { BRAND } from '@/lib/brand'

interface AuthPageLayoutProps {
  children: ReactNode
}

// Ren's house curve (docs/brand.md § Shape and depth: ease-out-expo)
const EASE = [0.19, 1, 0.22, 1] as const

// "The browser that" + "builds." — the Marker sits under the tagline's last word.
const TAGLINE_WORDS = BRAND.tagline.split(' ')
const TAGLINE_LAST = TAGLINE_WORDS[TAGLINE_WORDS.length - 1]
const TAGLINE_LEAD = TAGLINE_WORDS.slice(0, -1).join(' ')

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
  const reduceMotion = useReducedMotion()
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

  const rise = (delay: number) => ({
    initial: { opacity: 0, y: reduceMotion ? 0 : 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay, ease: EASE },
  })

  return (
    // `ron-content`: in the Glass theme the page becomes the see-through content layer and
    // the paper surfaces below take the blue glass tint (index.css § GLASS THEME).
    <div className="ron-content relative flex h-screen w-full overflow-hidden bg-surface-0 text-ink dark:bg-surface-900 dark:text-ink-inverse">
      {/* Poster: the brand moment */}
      <motion.div
        className="relative hidden flex-col justify-between overflow-hidden border-r border-surface-200 bg-surface-0 p-12 dark:border-surface-800 dark:bg-surface-900 lg:flex lg:w-1/2 xl:w-[55%] xl:p-16"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        <div aria-hidden className="halftone pointer-events-none absolute -right-20 top-[16%] h-[68%] w-[82%]" />

        <div className="relative flex items-center justify-between gap-6">
          <RenWordmark className="text-[30px] text-ink dark:text-ink-inverse" />
          <span className="sticker-volt">Local-first</span>
        </div>

        <div className="relative">
          <motion.h1
            {...rise(0.1)}
            className="spray-halo ren-display text-[length:clamp(3.75rem,6.4vw,6.75rem)] text-ink dark:text-ink-inverse"
          >
            {TAGLINE_LEAD} <Marker>{TAGLINE_LAST}</Marker>
          </motion.h1>
          <motion.p
            {...rise(0.2)}
            className="mt-8 max-w-md text-body-lg text-ink-secondary dark:text-ink-inverse-secondary"
          >
            Browse, research and build with an agent that works right beside you.
          </motion.p>
        </div>

        <motion.p
          {...rise(0.3)}
          className="relative font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary dark:text-ink-inverse-muted"
        >
          Made for builders and creators
        </motion.p>
      </motion.div>

      {/* Form side: quiet, one column */}
      <div className="relative z-10 flex min-h-0 flex-1 items-start justify-center overflow-y-auto bg-surface-0 px-6 py-12 dark:bg-surface-900 sm:px-10 lg:items-center lg:px-14">
        <motion.div
          className="w-full max-w-[400px]"
          initial={{ opacity: 0, x: reduceMotion ? 0 : 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.15, ease: EASE }}
        >
          {/* Brand header when the poster is hidden (narrow windows) */}
          <motion.div className="mb-10 space-y-3 lg:hidden" {...rise(0)}>
            <h1 className="flex">
              <RenWordmark className="text-[40px] text-ink dark:text-ink-inverse" />
            </h1>
            <p className="font-display text-lg font-bold tracking-tight text-ink-secondary dark:text-ink-inverse-secondary">
              {BRAND.tagline}
            </p>
          </motion.div>

          {children}

          {/* Footer */}
          <motion.p
            className="mt-10 text-[12px] leading-relaxed text-ink-secondary dark:text-ink-inverse-muted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.6, ease: EASE }}
          >
            By continuing, you agree to our{' '}
            <a href="#" className="font-medium text-blurple-700 underline-offset-2 hover:underline dark:text-blurple-300">Terms</a>
            {' '}and{' '}
            <a href="#" className="font-medium text-blurple-700 underline-offset-2 hover:underline dark:text-blurple-300">Privacy Policy</a>
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
