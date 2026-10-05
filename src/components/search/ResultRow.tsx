/**
 * Web result cards. Every result is a real object on the page: a favicon tile with a
 * pastel domain-hashed fallback, the domain as identity anchor, markdown-rendered
 * title and snippet, a mono URL footer, and provenance marks (a single spark for
 * agent finds, interlocked sparks for consensus — both engines surfaced it).
 * ConsensusHero elevates the single best-corroborated result into a feature card.
 */
import { motion } from 'framer-motion'
import { ArrowUpRight, Sparkle, Sparkles } from 'lucide-react'
import type { MergedResult } from '@/lib/search-api'
import { InlineMarkdown } from './inline-markdown'
import { domainHue, domainInitials, hostname, hueWash } from './tabs-meta'
import { openResult } from './open-result'

export function ProvenanceMark({ origin, hue }: { origin: MergedResult['origin']; hue: string }) {
  if (origin === 'brave') return null
  const Icon = origin === 'both' ? Sparkles : Sparkle
  const title = origin === 'both' ? 'Consensus — found by the agent and Brave' : 'Agent pick'
  return (
    <span
      title={title}
      aria-label={title}
      className="inline-flex items-center justify-center rounded-full p-1"
      style={{ color: hue, backgroundColor: hueWash(hue, origin === 'both' ? 0.16 : 0.1) }}
    >
      <Icon className="h-3 w-3" strokeWidth={2.2} />
    </span>
  )
}

function FaviconTile({ url, favicon, size = 'md' }: { url: string; favicon: string | null; size?: 'md' | 'lg' }) {
  const host = hostname(url)
  const hue = domainHue(host)
  const box = size === 'lg' ? 'h-12 w-12 rounded-2xl' : 'h-10 w-10 rounded-xl'
  return (
    <span
      className={`flex flex-shrink-0 items-center justify-center overflow-hidden ring-1 ring-black/5 dark:ring-white/10 ${box}`}
      style={{ backgroundColor: hueWash(hue, 0.1) }}
    >
      {favicon ? (
        <img src={favicon} alt="" loading="lazy" className={size === 'lg' ? 'h-6 w-6' : 'h-5 w-5'} />
      ) : (
        <span className="font-semibold" style={{ color: hue, fontSize: size === 'lg' ? 13 : 10 }}>
          {domainInitials(url)}
        </span>
      )}
    </span>
  )
}

const cardMotion = (index: number) => ({
  initial: { opacity: 0, y: 12, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  transition: { duration: 0.4, delay: Math.min(index, 12) * 0.03, ease: [0.16, 1, 0.3, 1] as const },
})

export interface ResultCardProps {
  result: MergedResult
  index?: number
  hue: string
}

export function ResultCard({ result, index = 0, hue }: ResultCardProps) {
  return (
    <motion.button
      {...cardMotion(index)}
      onClick={() => openResult(result.url)}
      className="group block w-full rounded-2xl border border-surface-200/70 bg-surface-0/80 px-4 py-4 text-left backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-medium dark:border-surface-700/60 dark:bg-surface-800/60 dark:hover:shadow-dark-medium"
      style={{ ['--card-hover-border' as string]: hueWash(hue, 0.45) }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = hueWash(hue, 0.45) }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '' }}
    >
      <span className="flex items-start gap-3.5">
        <FaviconTile url={result.url} favicon={result.favicon} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[11px] font-medium uppercase tracking-wide text-ink-muted dark:text-ink-inverse-muted">
              {hostname(result.url)}
            </span>
            <ProvenanceMark origin={result.origin} hue={hue} />
            {result.age && (
              <span className="ml-auto flex-shrink-0 font-mono text-[10px] text-ink-muted/70 dark:text-ink-inverse-muted/70">
                {result.age}
              </span>
            )}
          </span>
          <InlineMarkdown
            text={result.title}
            className="mt-1 line-clamp-2 block text-[15px] font-medium leading-snug text-ink transition-colors group-hover:text-accent-light dark:text-ink-inverse dark:group-hover:text-accent-muted"
          />
          {result.snippet && (
            <InlineMarkdown
              text={result.snippet}
              className="mt-1 line-clamp-3 block text-[13px] font-light leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary"
            />
          )}
          <span className="mt-2 flex items-center gap-1.5 font-mono text-[10px] text-ink-muted/60 dark:text-ink-inverse-muted/60">
            <span className="truncate">{result.url}</span>
            <ArrowUpRight className="h-3 w-3 flex-shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
          </span>
        </span>
      </span>
    </motion.button>
  )
}

/** The single best-corroborated result: found by BOTH the agent and Brave. */
export function ConsensusHero({ result, hue }: { result: MergedResult; hue: string }) {
  return (
    <motion.button
      {...cardMotion(0)}
      onClick={() => openResult(result.url)}
      className="group relative block w-full overflow-hidden rounded-3xl p-px text-left"
      style={{ background: `linear-gradient(135deg, ${hueWash(hue, 0.5)}, ${hueWash(hue, 0.08)} 45%, ${hueWash(hue, 0.3)})` }}
    >
      <span className="block rounded-[calc(1.5rem-1px)] bg-surface-0/95 px-5 py-5 backdrop-blur-xl transition-colors dark:bg-surface-900/90">
        <span className="mb-3 flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5" style={{ color: hue }} />
          <span className="text-label uppercase" style={{ color: hue }}>Top consensus</span>
          <span className="text-[10px] font-light text-ink-muted dark:text-ink-inverse-muted">
            surfaced by the agent and Brave
          </span>
          {result.age && (
            <span className="ml-auto font-mono text-[10px] text-ink-muted/70 dark:text-ink-inverse-muted/70">{result.age}</span>
          )}
        </span>
        <span className="flex items-start gap-4">
          <FaviconTile url={result.url} favicon={result.favicon} size="lg" />
          <span className="min-w-0 flex-1">
            <InlineMarkdown
              text={result.title}
              className="line-clamp-2 block text-lg font-normal leading-snug tracking-tight text-ink transition-colors group-hover:text-accent-light dark:text-ink-inverse dark:group-hover:text-accent-muted"
            />
            {result.snippet && (
              <InlineMarkdown
                text={result.snippet}
                className="mt-1.5 line-clamp-3 block text-sm font-light leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary"
              />
            )}
            <span className="mt-2.5 flex items-center gap-1.5 font-mono text-[11px] text-ink-muted dark:text-ink-inverse-muted">
              <span className="truncate">{result.url}</span>
              <ArrowUpRight className="h-3.5 w-3.5 flex-shrink-0 opacity-60 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100" />
            </span>
          </span>
        </span>
      </span>
    </motion.button>
  )
}
