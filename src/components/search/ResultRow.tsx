/**
 * Web results — the clean row grammar. Every result is one compact block: 16px favicon ·
 * host in mono micro text · provenance mark · age, then a single-line 16px semibold title
 * and a single-line snippet in secondary ink. No card chrome, no URL footer, no lift; hover is
 * a faint wash and a volt underline on the title. The best-corroborated result gets the same
 * grammar with a two-line snippet and a mono lead label ("Consensus", "Top pick").
 */
import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { MergedResult } from '@/lib/search-api'
import { cn } from '@/utils/cn'
import { InlineMarkdown } from './inline-markdown'
import { domainInitials, hostname } from './tabs-meta'
import { openResult } from './open-result'

export function ProvenanceMark({ origin, hue: _hue }: { origin: MergedResult['origin']; hue?: string }) {
  if (origin === 'brave') return null
  const title = origin === 'both' ? 'Consensus — found by the agent and Brave' : 'Agent pick — a source the answer used'
  return (
    <span title={title} className="inline-flex flex-shrink-0 items-center gap-[3px]" aria-label={title} role="img">
      <span className="h-[5px] w-[5px] rounded-full bg-blurple-600 dark:bg-blurple-400" />
      {origin === 'both' && <span className="h-[5px] w-[5px] rounded-full bg-blurple-600/40 dark:bg-blurple-400/40" />}
    </span>
  )
}

export function Favicon({ url, favicon, size = 16 }: { url: string; favicon: string | null | undefined; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (favicon && !broken) {
    return (
      <img
        src={favicon}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        width={size}
        height={size}
        className="flex-shrink-0 rounded-[4px]"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      aria-hidden
      className="flex flex-shrink-0 items-center justify-center rounded-[4px] bg-surface-100 font-mono font-semibold leading-none text-ink-secondary dark:bg-surface-800 dark:text-ink-inverse-secondary"
      style={{ width: size, height: size, fontSize: Math.max(7, size * 0.5) }}
    >
      {domainInitials(url).slice(0, 1)}
    </span>
  )
}

/** Snippets from fetched pages can start with markdown headings/rules; show prose only. */
function cleanSnippet(snippet: string): string {
  return snippet.replace(/(^|\s)#{1,6}\s+/g, '$1').replace(/\s{2,}/g, ' ').trim()
}

export const rowMotion = (index: number, reduced: boolean | null) => reduced
  ? {}
  : {
      initial: { opacity: 0, y: 4 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.22, delay: Math.min(index, 10) * 0.015, ease: [0.16, 1, 0.3, 1] as const },
    }

export interface ResultCardProps {
  result: MergedResult
  index?: number
  hue?: string
  /** Lead treatment: two-line snippet + a small label. */
  lead?: string
}

export function ResultCard({ result, index = 0, lead }: ResultCardProps) {
  const reduced = useReducedMotion()
  const host = hostname(result.url)
  return (
    <motion.li {...rowMotion(index, reduced)} className="list-none">
      <button
        type="button"
        onClick={() => openResult(result.url)}
        title={result.url}
        className="group block w-full rounded-xl px-3 py-3 text-left transition-colors duration-150 hover:bg-surface-100/60 focus-visible:ring-offset-0 dark:hover:bg-surface-850/70"
      >
        <span className="flex items-center gap-2 text-ink-muted dark:text-ink-inverse-muted">
          <Favicon url={result.url} favicon={result.favicon} />
          <span className="truncate font-mono text-[11px] tracking-[0.01em]">{host}</span>
          <ProvenanceMark origin={result.origin} />
          {lead && (
            <span className="flex-shrink-0 rounded-full bg-blurple-600/10 px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-blurple-700 dark:bg-blurple-400/15 dark:text-blurple-300">
              {lead}
            </span>
          )}
          {result.kind === 'discussion' && (
            <span className="flex-shrink-0 font-mono text-[11px]">· Discussion</span>
          )}
          {result.age && (
            <span className="ml-auto flex-shrink-0 pl-2 font-mono text-[11px] tabular-nums">{result.age}</span>
          )}
        </span>
        <InlineMarkdown
          text={result.title || host}
          className="mt-1.5 block truncate text-base font-semibold leading-snug tracking-[-0.01em] text-ink decoration-blurple-600 decoration-2 underline-offset-4 group-hover:underline dark:text-ink-inverse dark:decoration-blurple-400"
        />
        {result.snippet && (
          <InlineMarkdown
            text={cleanSnippet(result.snippet)}
            className={cn(
              'mt-1 block text-[13.5px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary',
              lead ? 'line-clamp-2' : 'truncate',
            )}
          />
        )}
      </button>
    </motion.li>
  )
}

/** The single best-corroborated result: found by BOTH the agent and Brave. */
export function ConsensusHero({ result, label = 'Top result' }: { result: MergedResult; hue?: string; label?: string }) {
  return <ResultCard result={result} index={0} lead={label} />
}
