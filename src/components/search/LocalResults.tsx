/**
 * The Local panel — Brave place search as cards: a picture strip on top, then name,
 * star rating with review count, price-range dots, today's hours, address, phone and
 * distance. Cards open the place's own page in a new tab.
 */
import { motion } from 'framer-motion'
import { Clock, MapPin, Phone, Star } from 'lucide-react'
import { sectionItems, type SearchRunState } from '@/lib/search-api'
import type { DiscoverItem } from '@/lib/discover-feed'
import { EmptyState, CardSkeleton, SourceErrorNotice } from './primitives'
import { hueWash } from './tabs-meta'
import { openResult } from './open-result'

type Place = NonNullable<DiscoverItem['place']>

function formatDistance(meters: unknown): string | null {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters <= 0) return null
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters * 0.000621371).toFixed(1)} mi`
}

function formatHours(hours: unknown): string | null {
  if (!Array.isArray(hours) || !hours.length) return null
  const ranges = hours
    .map((h) => {
      const entry = h as { abbr_name?: string; opens?: string; closes?: string }
      return entry.opens && entry.closes ? `${entry.abbr_name ?? ''} ${entry.opens}–${entry.closes}`.trim() : null
    })
    .filter(Boolean)
  return ranges.length ? ranges.join(' · ') : null
}

function PriceDots({ priceRange, hue }: { priceRange: unknown; hue: string }) {
  if (typeof priceRange !== 'string' || !priceRange) return null
  const level = (priceRange.match(/\$/g) || []).length || Math.min(4, Math.max(1, priceRange.length))
  return (
    <span className="flex items-center gap-0.5" title={priceRange}>
      {Array.from({ length: 4 }, (_, i) => (
        <span
          key={i}
          className="h-1 w-1 rounded-full"
          style={{ backgroundColor: i < level ? hue : hueWash(hue, 0.2) }}
        />
      ))}
    </span>
  )
}

function PlaceCard({ item, index, hue }: { item: DiscoverItem; index: number; hue: string }) {
  const place = (item.place || {}) as Place
  const pictures = Array.isArray(place.pictures) ? (place.pictures as string[]).filter(Boolean) : []
  const hero = pictures[0] || item.thumbnail
  const rating = typeof place.rating === 'number' ? place.rating : null
  const reviews = typeof place.review_count === 'number' ? place.review_count : null
  const hours = formatHours(place.hours_today)
  const distance = formatDistance(place.distance)
  const categories = Array.isArray(place.categories) ? (place.categories as string[]).slice(0, 2) : []

  return (
    <motion.button
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index, 10) * 0.04, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => openResult(item.url)}
      className="group overflow-hidden rounded-2xl border border-surface-200/70 bg-surface-0/80 text-left backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-medium dark:border-surface-700/60 dark:bg-surface-800/60 dark:hover:shadow-dark-medium"
    >
      {hero && (
        <span className="block h-28 w-full overflow-hidden bg-surface-100 dark:bg-surface-800">
          <img src={hero} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 ease-smooth group-hover:scale-[1.04]" />
        </span>
      )}
      <span className="block px-4 py-3.5">
        <span className="flex items-start justify-between gap-2">
          <span className="text-[15px] font-normal leading-snug text-ink dark:text-ink-inverse">{item.title}</span>
          {distance && (
            <span className="flex flex-shrink-0 items-center gap-1 font-mono text-[10px] text-ink-muted dark:text-ink-inverse-muted">
              <MapPin className="h-3 w-3" />
              {distance}
            </span>
          )}
        </span>

        <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {rating !== null && (
            <span className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5" style={{ color: hue, fill: hueWash(hue, 0.35) }} />
              <span className="text-xs font-medium tabular-nums text-ink dark:text-ink-inverse">{rating.toFixed(1)}</span>
              {reviews !== null && (
                <span className="text-[11px] font-light text-ink-muted dark:text-ink-inverse-muted">({reviews.toLocaleString()})</span>
              )}
            </span>
          )}
          <PriceDots priceRange={place.price_range} hue={hue} />
          {categories.length > 0 && (
            <span className="truncate text-[11px] font-light text-ink-muted dark:text-ink-inverse-muted">
              {categories.join(' · ')}
            </span>
          )}
        </span>

        {hours && (
          <span className="mt-2 flex items-center gap-1.5 text-[11px] font-light text-ink-secondary dark:text-ink-inverse-secondary">
            <Clock className="h-3 w-3 flex-shrink-0" style={{ color: hue }} />
            {hours}
          </span>
        )}
        {typeof place.address === 'string' && place.address && (
          <span className="mt-1 block truncate text-[11px] font-light text-ink-muted dark:text-ink-inverse-muted">
            {place.address}
          </span>
        )}
        {typeof place.phone === 'string' && place.phone && (
          <span className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-ink-muted dark:text-ink-inverse-muted">
            <Phone className="h-3 w-3" />
            {place.phone}
          </span>
        )}
      </span>
    </motion.button>
  )
}

export function LocalResults({ state, hue, onRetry }: { state: SearchRunState; hue: string; onRetry?: () => void }) {
  const section = state.sections.places
  if (!section) return <CardSkeleton cards={4} />
  if (section.status === 'error') return <div className="mx-auto max-w-3xl"><SourceErrorNotice error={{ source: 'brave', ...section.error! }} onRetry={onRetry} /></div>

  const items = sectionItems(state, 'places')
  if (!items.length) {
    return <EmptyState title="No places found" hint="Add a city or neighborhood to your profile for sharper local results" />
  }
  return (
    <div className="mx-auto grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
      {items.map((item, i) => <PlaceCard key={item.id} item={item} index={i} hue={hue} />)}
    </div>
  )
}
