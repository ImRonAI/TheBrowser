/**
 * The Shopping panel — a second, domain-restricted Agent API run (gpt-6-luna, tools
 * limited to web_search over known retail domains + fetch_url + image_search). The
 * streamed answer renders as a quiet buying guide; beneath it, the products the
 * agent actually surfaced, grouped by merchant: square product photo, a two-line
 * name, the price extracted from the copy, and the merchant.
 */
import { motion, useReducedMotion } from 'framer-motion'
import { ShoppingBag } from 'lucide-react'
import { ResponseMarkdown } from '@/components/ai-elements/response'
import type { AgentImageResult, AgentRunState, AgentSearchResult } from '@/lib/search-api'
import { AnswerSkeleton, EmptyState, SourceErrorNotice } from './primitives'
import { hostname, stripCitationMarkers } from './tabs-meta'
import { Favicon, rowMotion } from './ResultRow'
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

function ProductCard({ product, index }: { product: Product; index: number }) {
  const reduced = useReducedMotion()
  const { source, image, price } = product
  return (
    <motion.li {...rowMotion(index, reduced)} className="list-none">
      <button type="button" onClick={() => openResult(source.url)} className="group block w-full rounded-lg text-left" title={source.url}>
        <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-surface-200/70 bg-surface-50 dark:border-surface-800 dark:bg-surface-850">
          {image?.url ? (
            <img src={image.url} alt="" loading="lazy" className="h-full w-full object-contain p-3 mix-blend-multiply transition-transform duration-500 ease-smooth motion-safe:group-hover:scale-[1.04] dark:mix-blend-normal" />
          ) : (
            <ShoppingBag className="h-6 w-6 text-ink-muted/50 dark:text-ink-inverse-muted/50" strokeWidth={1.5} />
          )}
        </span>
        <span className="mt-2 line-clamp-2 block px-0.5 text-[13px] leading-snug text-ink decoration-accent/50 underline-offset-[3px] group-hover:underline dark:text-ink-inverse">
          {source.title || hostname(source.url)}
        </span>
        <span className="mt-1 flex items-baseline justify-between gap-2 px-0.5">
          {price
            ? <span className="text-[14px] font-semibold tabular-nums text-ink dark:text-ink-inverse">{price}</span>
            : <span className="text-[12px] text-ink-muted dark:text-ink-inverse-muted">See price</span>}
          <span className="truncate text-[11px] text-ink-muted dark:text-ink-inverse-muted">{hostname(source.url)}</span>
        </span>
      </button>
    </motion.li>
  )
}

function MerchantHeader({ url, label, count }: { url: string; label: string; count: number }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Favicon url={url} favicon={null} size={16} />
      <span className="text-[13px] font-medium text-ink dark:text-ink-inverse">{label}</span>
      <span className="font-mono text-[10.5px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">{count}</span>
      <div className="h-px flex-1 bg-surface-200/80 dark:bg-surface-800" />
    </div>
  )
}

export function ShoppingResults({ run, onRetry }: { run: AgentRunState; hue?: string; onRetry?: () => void }) {
  if (run.status === 'error' && !run.text && !run.sources.length) {
    return <div className="max-w-[680px]"><SourceErrorNotice error={run.error!} onRetry={onRetry} /></div>
  }
  if (run.status === 'idle' && !run.text && !run.sources.length) {
    return <div className="max-w-[680px]"><AnswerSkeleton /></div>
  }

  const merchants = groupByMerchant(run.sources, run.images)
  const streaming = run.status === 'streaming'

  return (
    <div className="max-w-5xl">
      {(run.text || streaming) && (
        <section aria-label="Buying guide" className="max-w-[720px] rounded-xl border border-surface-200/80 px-5 py-4 dark:border-surface-800">
          <p className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted dark:text-ink-inverse-muted">
            <ShoppingBag className="h-3.5 w-3.5" strokeWidth={1.75} />
            Buying guide
            {run.model && <span className="font-mono text-[10px] normal-case tracking-normal">{run.model}</span>}
            {streaming && <span className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse dark:bg-accent-light" aria-label="writing" />}
          </p>
          <div className="text-[14px] leading-relaxed text-ink dark:text-ink-inverse [&_img]:my-3 [&_img]:max-h-56 [&_img]:w-auto [&_img]:rounded-lg [&_img]:border [&_img]:border-surface-200/70 [&_img]:bg-white [&_img]:object-contain dark:[&_img]:border-surface-800">
            <ResponseMarkdown content={stripCitationMarkers(run.text)} isStreaming={streaming} />
          </div>
        </section>
      )}

      {run.status === 'error' && (
        <div className="mt-4 max-w-[680px]"><SourceErrorNotice error={run.error!} onRetry={onRetry} /></div>
      )}

      {merchants.length === 0 && run.status === 'done' && run.images.length === 0 && (
        <EmptyState title="No products surfaced" hint="Try naming the product, brand or budget explicitly" />
      )}

      {/* The agent pulled photos but no structured sources: still show the imagery. */}
      {merchants.length === 0 && run.images.length > 0 && (
        <section className="mt-8" aria-label="Product photos">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[13px] font-medium text-ink dark:text-ink-inverse">Product photos</span>
            <span className="font-mono text-[10.5px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">{run.images.length}</span>
            <div className="h-px flex-1 bg-surface-200/80 dark:bg-surface-800" />
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {run.images.map((image) => (
              <li key={image.url} className="list-none">
                <button
                  type="button"
                  onClick={() => openResult(((image.page_url as string) || (image.source as string) || image.url) as string)}
                  className="group block aspect-square w-full overflow-hidden rounded-lg border border-surface-200/70 bg-surface-50 dark:border-surface-800 dark:bg-surface-850"
                  aria-label="Open product photo source"
                >
                  <img src={image.url} alt="" loading="lazy" className="h-full w-full object-contain p-3 mix-blend-multiply transition-transform duration-500 ease-smooth motion-safe:group-hover:scale-[1.04] dark:mix-blend-normal" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {merchants.map(([merchant, products]) => (
        <section key={merchant} className="mt-8" aria-label={merchant}>
          <MerchantHeader url={products[0]?.source.url || `https://${merchant}`} label={merchant} count={products.length} />
          <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
            {products.map((product, i) => <ProductCard key={product.source.url} product={product} index={i} />)}
          </ul>
        </section>
      ))}
    </div>
  )
}
