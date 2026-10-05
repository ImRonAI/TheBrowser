/**
 * The Shopping panel — a second, domain-restricted Agent API run (gpt-6-luna, tools
 * limited to web_search over known retail domains + fetch_url + image_search). The
 * streamed answer renders as a buying guide; beneath it, the products the agent
 * actually surfaced, grouped by merchant, with price chips extracted from the copy.
 */
import { motion } from 'framer-motion'
import { ShoppingBag } from 'lucide-react'
import { ResponseMarkdown } from '@/components/ai-elements/response'
import type { AgentImageResult, AgentRunState, AgentSearchResult } from '@/lib/search-api'
import { AnswerSkeleton, EmptyState, SourceErrorNotice } from './primitives'
import { domainInitials, hostname, hueWash } from './tabs-meta'
import { openResult } from './open-result'

const PRICE = /\$\s?\d[\d,]*(?:\.\d{2})?/

function extractPrice(...texts: Array<string | undefined>): string | null {
  for (const text of texts) {
    const match = text?.match(PRICE)
    if (match) return match[0].replace(/\$\s+/, '$')
  }
  return null
}

function imagePageHost(image: AgentImageResult): string {
  for (const key of ['page_url', 'source', 'site', 'domain', 'host'] as const) {
    const value = image[key]
    if (typeof value === 'string' && value) return hostname(value)
  }
  return ''
}

/**
 * Map every product source to a photo. First pass: exact merchant-host match against
 * the image's page metadata. Second pass: distribute the unclaimed image pool across
 * the remaining products in order, so every card shows a photo whenever the agent's
 * image_search returned any.
 */
function assignImages(sources: AgentSearchResult[], images: AgentImageResult[]): Map<string, AgentImageResult> {
  const bySourceUrl = new Map<string, AgentImageResult>()
  const claimed = new Set<AgentImageResult>()
  for (const source of sources) {
    if (!source.url) continue
    const host = hostname(source.url)
    const match = images.find((image) => {
      if (claimed.has(image) || !image.url) return false
      const pageHost = imagePageHost(image)
      if (pageHost && pageHost === host) return true
      const page = (image.page_url as string) || ''
      return Boolean(page) && page.includes(host)
    })
    if (match) {
      bySourceUrl.set(source.url, match)
      claimed.add(match)
    }
  }
  const pool = images.filter((image) => !claimed.has(image) && image.url)
  let cursor = 0
  for (const source of sources) {
    if (!source.url || bySourceUrl.has(source.url) || pool.length === 0) continue
    bySourceUrl.set(source.url, pool[cursor % pool.length])
    cursor += 1
  }
  return bySourceUrl
}

interface Product {
  source: AgentSearchResult
  image: AgentImageResult | null
  price: string | null
}

function groupByMerchant(sources: AgentSearchResult[], images: AgentImageResult[]): Array<[string, Product[]]> {
  const assigned = assignImages(sources, images)
  const groups = new Map<string, Product[]>()
  for (const source of sources) {
    if (!source.url) continue
    const merchant = hostname(source.url)
    const product: Product = {
      source,
      image: assigned.get(source.url) ?? null,
      price: extractPrice(source.title, source.snippet),
    }
    groups.set(merchant, [...(groups.get(merchant) || []), product])
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
}

function ProductCard({ product, index, hue }: { product: Product; index: number; hue: string }) {
  const { source, image, price } = product
  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 8) * 0.04, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => openResult(source.url)}
      className="group w-full overflow-hidden rounded-2xl border border-surface-200/70 bg-surface-0/80 text-left backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-medium dark:border-surface-700/60 dark:bg-surface-800/60"
    >
      <span className="block h-32 w-full overflow-hidden bg-surface-100 dark:bg-surface-800">
        {image?.url ? (
          <img src={image.url} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 ease-smooth group-hover:scale-[1.05]" />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <ShoppingBag className="h-6 w-6 text-ink-muted/40 dark:text-ink-inverse-muted/40" />
          </span>
        )}
      </span>
      <span className="block px-3.5 py-3">
        <span className="line-clamp-2 text-[13px] font-normal leading-snug text-ink dark:text-ink-inverse">
          {source.title || hostname(source.url)}
        </span>
        <span className="mt-2 flex items-center justify-between gap-2">
          {price ? (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
              style={{ backgroundColor: hueWash(hue, 0.12), color: hue }}
            >
              {price}
            </span>
          ) : (
            <span className="text-[10px] font-light text-ink-muted dark:text-ink-inverse-muted">See price</span>
          )}
          <span className="truncate font-mono text-[10px] text-ink-muted dark:text-ink-inverse-muted">
            {hostname(source.url)}
          </span>
        </span>
      </span>
    </motion.button>
  )
}

export function ShoppingResults({ run, hue, onRetry }: { run: AgentRunState; hue: string; onRetry?: () => void }) {
  if (run.status === 'error' && !run.text && !run.sources.length) {
    return <div className="mx-auto max-w-3xl"><SourceErrorNotice error={run.error!} onRetry={onRetry} /></div>
  }
  if (run.status === 'idle' && !run.text && !run.sources.length) {
    return <div className="mx-auto max-w-2xl"><AnswerSkeleton /></div>
  }

  const merchants = groupByMerchant(run.sources, run.images)
  const streaming = run.status === 'streaming'

  return (
    <div className="mx-auto max-w-4xl">
      {(run.text || streaming) && (
        <div
          className="rounded-2xl border px-5 py-4"
          style={{ borderColor: hueWash(hue, 0.22), backgroundColor: hueWash(hue, 0.05) }}
        >
          <div className="mb-2 flex items-center gap-2">
            <ShoppingBag className="h-3.5 w-3.5" style={{ color: hue }} />
            <span className="text-label uppercase" style={{ color: hue }}>Buying guide</span>
            {run.model && <span className="font-mono text-[10px] text-ink-muted dark:text-ink-inverse-muted">{run.model}</span>}
          </div>
          <div className="text-sm font-light leading-relaxed text-ink dark:text-ink-inverse">
            <ResponseMarkdown content={run.text} isStreaming={streaming} />
          </div>
        </div>
      )}

      {run.status === 'error' && (
        <div className="mt-4"><SourceErrorNotice error={run.error!} onRetry={onRetry} /></div>
      )}

      {merchants.length === 0 && run.status === 'done' && run.images.length === 0 && (
        <EmptyState title="No products surfaced" hint="Try naming the product, brand or budget explicitly" />
      )}

      {/* The agent pulled photos but no structured sources: still show the imagery. */}
      {merchants.length === 0 && run.images.length > 0 && (
        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2.5">
            <ShoppingBag className="h-3.5 w-3.5" style={{ color: hue }} />
            <span className="text-sm font-normal text-ink dark:text-ink-inverse">Product photos</span>
            <span className="font-mono text-[10px] text-ink-muted dark:text-ink-inverse-muted">{run.images.length}</span>
            <div className="h-px flex-1 bg-surface-200/70 dark:bg-surface-700/60" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {run.images.map((image, i) => (
              <motion.button
                key={image.url}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: Math.min(i, 8) * 0.04, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => openResult(((image.page_url as string) || (image.source as string) || image.url) as string)}
                className="group overflow-hidden rounded-2xl border border-surface-200/70 bg-surface-0/80 dark:border-surface-700/60 dark:bg-surface-800/60"
              >
                <span className="block h-32 w-full overflow-hidden bg-surface-100 dark:bg-surface-800">
                  <img src={image.url} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 ease-smooth group-hover:scale-[1.05]" />
                </span>
              </motion.button>
            ))}
          </div>
        </section>
      )}

      {merchants.map(([merchant, products]) => (
        <section key={merchant} className="mt-8">
          <div className="mb-3 flex items-center gap-2.5">
            <span
              className="flex h-6 w-6 items-center justify-center rounded-lg text-[9px] font-semibold"
              style={{ backgroundColor: hueWash(hue, 0.12), color: hue }}
            >
              {domainInitials(merchant)}
            </span>
            <span className="text-sm font-normal text-ink dark:text-ink-inverse">{merchant}</span>
            <span className="font-mono text-[10px] text-ink-muted dark:text-ink-inverse-muted">{products.length}</span>
            <div className="h-px flex-1 bg-surface-200/70 dark:bg-surface-700/60" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product, i) => <ProductCard key={product.source.url} product={product} index={i} hue={hue} />)}
          </div>
        </section>
      ))}
    </div>
  )
}
