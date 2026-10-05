/**
 * Search header: back control, the query rendered as a monument (huge, extralight,
 * tight tracking), the search depth + model as quiet provenance chips, and a sonar
 * pulse that breathes while any source is still streaming and resolves to a check.
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Check, RefreshCw } from 'lucide-react'
import { levelLabel } from '@/lib/search-api'
import { cn } from '@/utils/cn'
import { hueWash } from './tabs-meta'

function formatElapsed(ms: number): string {
  const seconds = ms / 1000
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
}

function Sonar({ running, hue }: { running: boolean; hue: string }) {
  if (!running) {
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full"
        style={{ backgroundColor: hueWash(hue, 0.14), color: hue }}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
    )
  }
  return (
    <span className="relative flex h-5 w-5 items-center justify-center">
      {[0, 1].map((ring) => (
        <motion.span
          key={ring}
          className="absolute inset-0 rounded-full border"
          style={{ borderColor: hueWash(hue, 0.5) }}
          animate={{ scale: [0.4, 1.15], opacity: [0.9, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, delay: ring * 0.8, ease: 'easeOut' }}
        />
      ))}
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: hue }} />
    </span>
  )
}

export interface SearchHeaderProps {
  query: string
  level: string
  model: string | null
  hue: string
  isRunning: boolean
  startedAt: number | null
  durationMs: number | null
  onBack: () => void
  onRefresh: () => void
}

export function SearchHeader({ query, level, model, hue, isRunning, startedAt, durationMs, onBack, onRefresh }: SearchHeaderProps) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isRunning || startedAt === null) return
    const timer = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(timer)
  }, [isRunning, startedAt])

  const timing = durationMs !== null
    ? formatElapsed(durationMs)
    : isRunning && startedAt !== null
      ? formatElapsed(now - startedAt)
      : null

  return (
    <motion.header
      initial={{ opacity: 0, y: -14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="relative z-10"
    >
      <div className="mx-auto max-w-5xl px-6 pt-6">
        <div className="flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.94 }}
            onClick={onBack}
            aria-label="Back to home"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-surface-200/70 bg-surface-0/70 text-ink-secondary backdrop-blur-xl transition-colors hover:text-ink dark:border-surface-700/60 dark:bg-surface-800/60 dark:text-ink-inverse-secondary dark:hover:text-ink-inverse"
          >
            <ArrowLeft className="h-4 w-4" />
          </motion.button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <Sonar running={isRunning} hue={hue} />
              {timing && (
                <span className="font-mono text-[11px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">
                  {timing}
                </span>
              )}
            </div>
            <h1 className="mt-2 truncate text-3xl font-extralight tracking-tight text-ink dark:text-ink-inverse md:text-4xl">
              {query}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className="rounded-full px-2.5 py-1 text-label uppercase"
                style={{ backgroundColor: hueWash(hue, 0.12), color: hue }}
              >
                {levelLabel(level)}
              </span>
              {model && (
                <span className="rounded-full border border-surface-200/80 px-2.5 py-1 font-mono text-[10px] text-ink-muted dark:border-surface-700/70 dark:text-ink-inverse-muted">
                  {model}
                </span>
              )}
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.05, rotate: 8 }}
            whileTap={{ scale: 0.94 }}
            onClick={onRefresh}
            disabled={isRunning}
            aria-label="Run this search again"
            className={cn(
              'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border backdrop-blur-xl transition-colors',
              isRunning
                ? 'cursor-not-allowed border-surface-200/40 text-ink-muted/40 dark:border-surface-700/40 dark:text-ink-inverse-muted/40'
                : 'border-surface-200/70 bg-surface-0/70 text-ink-secondary hover:text-ink dark:border-surface-700/60 dark:bg-surface-800/60 dark:text-ink-inverse-secondary dark:hover:text-ink-inverse',
            )}
          >
            <RefreshCw className={cn('h-4 w-4', isRunning && 'animate-spin')} />
          </motion.button>
        </div>
      </div>
    </motion.header>
  )
}
