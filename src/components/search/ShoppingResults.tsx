/**
 * The Shopping panel — powered by the Strands Harness Shopping Subagent (`create_harness`
 * on `xai/grok-4.7` with `brave_web_search`, `brave_local_search`, `brave_image_search`,
 * and `web_fetch`). Streams a structured buying guide and surfaces both Online Retailers
 * (grouped by merchant with product imagery and prices) and Brick-and-Mortar / Local Stores
 * (with address, rating, hours, phone, and website/storefront links).
 */
import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ExternalLink, MapPin, Phone, ShoppingBag, Star, Store } from 'lucide-react'
import { ResponseMarkdown } from '@/components/ai-elements/response'
import type { DiscoverItem } from '@/lib/discover-feed'
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

function isLocalSource(source: AgentSearchResult): boolean {
  if (source.kind === 'local') return true
  return Boolean(source.address || source.hours || source.phone || typeof source.distance === 'number')
}

/**
 * Map product sources to photos taken from the same merchant: an image is used only when
 * its page metadata names the product's host. A product without such a photo keeps the
 * bag placeholder (a photo from another page would misrepresent what is for sale); the
 * unmatched photos are shown on their own under "Product photos".
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

function mergeLocalStores(sources: AgentSearchResult[], places: DiscoverItem[]): AgentSearchResult[] {
  const seen = new Set<string>()
  const merged: AgentSearchResult[] = []
  for (const source of sources) {
    if (!source.url || !isLocalSource(source) || seen.has(source.url)) continue
    seen.add(source.url)
    merged.push(source)
  }
  for (const item of places) {
    if (!item.url || seen.has(item.url)) continue
    seen.add(item.url)
    const place = item.place || {}
    merged.push({
      url: item.url,
      title: item.title,
      snippet: item.description || '',
      kind: 'local',
      address: typeof place.address === 'string' ? place.address : null,
      rating: typeof place.rating === 'number' ? place.rating : null,
      review_count: typeof place.review_count === 'number' ? place.review_count : null,
      price_range: typeof place.price_range === 'string' ? place.price_range : null,
      phone: typeof place.phone === 'string' ? place.phone : null,
      distance: typeof place.distance === 'number' ? place.distance : null,
    })
  }
  return merged
}

function ProductCard({ product, index }: { product: Product; index: number }) {
  const reduced = useReducedMotion()
  const [failed, setFailed] = useState(false)
  const { source, image, price } = product
  return (
    <motion.li {...rowMotion(index, reduced)} className="list-none">
      <button type="button" onClick={() => openResult(source.url)} className="group block w-full rounded-lg text-left" title={source.url}>
        <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-surface-200/70 bg-surface-50 dark:border-surface-800 dark:bg-surface-850">
          {image?.url && !failed ? (
            <img src={image.url} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-contain p-3 mix-blend-multiply transition-transform duration-500 ease-smooth motion-safe:group-hover:scale-[1.04] dark:mix-blend-normal" />
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

function LocalStoreCard({ store, index }: { store: AgentSearchResult; index: number }) {
  const reduced = useReducedMotion()
  const rating = typeof store.rating === 'number' ? store.rating : null
  const reviews = typeof store.review_count === 'number' ? store.review_count : null
  const address = typeof store.address === 'string' && store.address ? store.address : null
  const hours = typeof store.hours === 'string' && store.hours ? store.hours : null
  const phone = typeof store.phone === 'string' && store.phone ? store.phone : null
  const priceRange = typeof store.price_range === 'string' && store.price_range ? store.price_range : null

  return (
    <motion.li {...rowMotion(index, reduced)} className="list-none">
      <button
        type="button"
        onClick={() => openResult(store.url)}
        title={store.url}
        className="group flex w-full items-start gap-3.5 rounded-xl border border-surface-200/80 bg-surface-0 p-3.5 text-left transition-colors hover:border-surface-300 hover:bg-surface-50 dark:border-surface-800 dark:bg-surface-900 dark:hover:border-surface-700 dark:hover:bg-surface-850"
      >
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-surface-100 text-ink-secondary dark:bg-surface-800 dark:text-ink-inverse-secondary">
          <Store className="h-5 w-5" strokeWidth={1.6} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-[14px] font-medium text-ink decoration-accent/50 underline-offset-[3px] group-hover:underline dark:text-ink-inverse">
              {store.title || hostname(store.url)}
            </span>
            <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100 dark:text-ink-inverse-muted" />
          </span>
          {(rating !== null || priceRange) && (
            <span className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-secondary dark:text-ink-inverse-secondary">
              {rating !== null && (
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3 w-3 fill-accent text-accent dark:fill-accent-light dark:text-accent-light" />
                  <span className="font-medium tabular-nums text-ink dark:text-ink-inverse">{rating.toFixed(1)}</span>
                  {reviews !== null && <span className="text-ink-muted dark:text-ink-inverse-muted">({reviews.toLocaleString()})</span>}
                </span>
              )}
              {priceRange && <span className="font-mono text-[11px] text-ink-muted dark:text-ink-inverse-muted">{priceRange}</span>}
            </span>
          )}
          {address && (
            <span className="mt-1 flex items-center gap-1.5 truncate text-[12px] text-ink-muted dark:text-ink-inverse-muted">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{address}</span>
            </span>
          )}
          {(hours || phone) && (
            <span className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-muted dark:text-ink-inverse-muted">
              {hours && <span>{hours}</span>}
              {phone && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-2.5 w-2.5" />
                  {phone}
                </span>
              )}
            </span>
          )}
          {store.snippet && !address && (
            <span className="mt-1 line-clamp-2 block text-[12px] text-ink-muted dark:text-ink-inverse-muted">
              {store.snippet}
            </span>
          )}
        </span>
      </button>
    </motion.li>
  )
}

/** A product photo with no matching product card; hidden when the image fails to load. */
function ProductPhoto({ image }: { image: AgentImageResult }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={() => openResult(((image.page_url as string) || (image.source as string) || image.url) as string)}
        className="group block aspect-square w-full overflow-hidden rounded-lg border border-surface-200/70 bg-surface-50 dark:border-surface-800 dark:bg-surface-850"
        aria-label="Open product photo source"
      >
        <img src={image.url} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-contain p-3 mix-blend-multiply transition-transform duration-500 ease-smooth motion-safe:group-hover:scale-[1.04] dark:mix-blend-normal" />
      </button>
    </li>
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

export function ShoppingResults({
  run,
  places = [],
  onRetry,
  onOpenWeb,
}: {
  run: AgentRunState
  places?: DiscoverItem[]
  hue?: string
  onRetry?: () => void
  onOpenWeb?: () => void
}) {
  if (run.status === 'error' && !run.text && !run.sources.length) {
    return <div className="max-w-[680px]"><SourceErrorNotice error={run.error!} onRetry={onRetry} /></div>
  }
  if (run.status === 'idle' && !run.text && !run.sources.length && places.length === 0) {
    return <div className="max-w-[680px]"><AnswerSkeleton /></div>
  }

  const onlineSources = run.sources.filter((source) => !isLocalSource(source))
  const localStores = mergeLocalStores(run.sources, places)
  const merchants = groupByMerchant(onlineSources, run.images)
  const onCards = new Set(merchants.flatMap(([, products]) => products.map((product) => product.image)))
  const extraPhotos = run.images.filter((image) => image.url && !onCards.has(image))
  const streaming = run.status === 'streaming'

  return (
    <div className="max-w-5xl">
      {(run.text || streaming) && (
        <section aria-label="Buying guide" className="max-w-[720px] rounded-xl border border-surface-200/80 px-5 py-4 dark:border-surface-800">
          <p className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted dark:text-ink-inverse-muted">
            <ShoppingBag className="h-3.5 w-3.5" strokeWidth={1.75} />
            Buying guide — Online &amp; Brick-and-Mortar
            {run.model && <span className="font-mono text-[10px] normal-case tracking-normal">{run.model}</span>}
            {streaming && (
              <>
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse dark:bg-accent-light" />
                <span className="sr-only">, writing</span>
              </>
            )}
          </p>
          <div className="text-[14px] leading-relaxed text-ink dark:text-ink-inverse [&_img]:my-3 [&_img]:max-h-56 [&_img]:w-auto [&_img]:rounded-lg [&_img]:border [&_img]:border-surface-200/70 [&_img]:bg-white [&_img]:object-contain dark:[&_img]:border-surface-800">
            <ResponseMarkdown content={stripCitationMarkers(run.text)} isStreaming={streaming} />
          </div>
        </section>
      )}

      {run.status === 'error' && (
        <div className="mt-4 max-w-[680px]"><SourceErrorNotice error={run.error!} onRetry={onRetry} /></div>
      )}

      {merchants.length === 0 && localStores.length === 0 && run.status === 'done' && run.images.length === 0 && (
        <EmptyState
          title="No products or stores surfaced"
          hint="Try naming the product, brand, or city explicitly"
          action={onOpenWeb ? { label: 'See web results', onClick: onOpenWeb } : undefined}
        />
      )}

      {localStores.length > 0 && (
        <section className="mt-8" aria-label="Brick-and-mortar and local stores">
          <div className="mb-3 flex items-center gap-2">
            <Store className="h-4 w-4 text-ink-secondary dark:text-ink-inverse-secondary" strokeWidth={1.75} />
            <span className="text-[13px] font-semibold text-ink dark:text-ink-inverse">Brick-and-Mortar &amp; Local Stores</span>
            <span className="font-mono text-[10.5px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">{localStores.length}</span>
            <div className="h-px flex-1 bg-surface-200/80 dark:bg-surface-800" />
          </div>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {localStores.map((store, i) => (
              <LocalStoreCard key={store.url} store={store} index={i} />
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

      {/* Photos the agent found that match no product's merchant: shown on their own, never on another product's card. */}
      {extraPhotos.length > 0 && (
        <section className="mt-8" aria-label={merchants.length ? 'More product photos' : 'Product photos'}>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[13px] font-medium text-ink dark:text-ink-inverse">{merchants.length ? 'More product photos' : 'Product photos'}</span>
            <span className="font-mono text-[10.5px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">{extraPhotos.length}</span>
            <div className="h-px flex-1 bg-surface-200/80 dark:bg-surface-800" />
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {extraPhotos.map((image) => <ProductPhoto key={image.url} image={image} />)}
          </ul>
        </section>
      )}
    </div>
  )
}
