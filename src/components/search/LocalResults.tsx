/**
 * The Places panel — Brave place search as compact cards: a 64px photo, the name,
 * one line of rating ★ (reviews) · price dots · categories, then single-line hours
 * and address, and phone + distance in small mono. Cards open the place's page.
 */
import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { MapPin, Star } from 'lucide-react'
import { sectionItems, type SearchRunState } from '@/lib/search-api'
import type { DiscoverItem } from '@/lib/discover-feed'
import { EmptyState, CardSkeleton, SourceErrorNotice } from './primitives'
import { rowMotion } from './ResultRow'
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

function PriceDots({ priceRange }: { priceRange: unknown }) {
  if (typeof priceRange !== 'string' || !priceRange) return null
  const level = (priceRange.match(/\$/g) || []).length || Math.min(4, Math.max(1, priceRange.length))
  return (
    <span className="flex items-center gap-[3px]" title={priceRange} aria-label={`Price ${priceRange}`} role="img">
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} className={i < level ? 'h-1 w-1 rounded-full bg-ink-secondary dark:bg-ink-inverse-secondary' : 'h-1 w-1 rounded-full bg-surface-300 dark:bg-surface-700'} />
      ))}
    </span>
  )
}

function PlaceCard({ item, index }: { item: DiscoverItem; index: number }) {
  const reduced = useReducedMotion()
  const [broken, setBroken] = useState(false)
  const place = (item.place || {}) as Place
  const pictures = Array.isArray(place.pictures) ? (place.pictures as string[]).filter(Boolean) : []
  const hero = pictures[0] || item.thumbnail
  const rating = typeof place.rating === 'number' ? place.rating : null
  const reviews = typeof place.review_count === 'number' ? place.review_count : null
  const hours = formatHours(place.hours_today)
  const distance = formatDistance(place.distance)
  const categories = Array.isArray(place.categories) ? (place.categories as string[]).slice(0, 2) : []
  const address = typeof place.address === 'string' && place.address ? place.address : null
  const phone = typeof place.phone === 'string' && place.phone ? place.phone : null

  return (
    <motion.li {...rowMotion(index, reduced)} className="list-none">
      <button
        type="button"
        onClick={() => openResult(item.url)}
        className="group flex w-full items-start gap-3 rounded-xl border border-surface-200/80 p-3 text-left transition-colors duration-150 hover:border-surface-300 hover:bg-surface-50 dark:border-surface-800 dark:hover:border-surface-700 dark:hover:bg-surface-850"
      >
        <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-100 dark:bg-surface-800">
          {hero && !broken
            ? <img src={hero} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
            : <MapPin className="h-5 w-5 text-ink-muted dark:text-ink-inverse-muted" strokeWidth={1.5} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[14.5px] font-medium text-ink decoration-accent/50 underline-offset-[3px] group-hover:underline dark:text-ink-inverse">{item.title}</span>
            {distance && <span className="flex-shrink-0 font-mono text-[10.5px] text-ink-muted dark:text-ink-inverse-muted">{distance}</span>}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[12px] text-ink-secondary dark:text-ink-inverse-secondary">
            {rating !== null && (
              <span className="flex flex-shrink-0 items-center gap-0.5">
                <Star className="h-3 w-3 fill-accent text-accent dark:fill-accent-light dark:text-accent-light" />
                <span className="font-medium tabular-nums text-ink dark:text-ink-inverse">{rating.toFixed(1)}</span>
                {reviews !== null && <span className="text-ink-muted dark:text-ink-inverse-muted">({reviews.toLocaleString()})</span>}
              </span>
            )}
            <PriceDots priceRange={place.price_range} />
            {categories.length > 0 && <span className="truncate text-ink-muted dark:text-ink-inverse-muted">{categories.join(' · ')}</span>}
          </span>
          {(hours || address) && (
            <span className="mt-0.5 block truncate text-[12px] text-ink-muted dark:text-ink-inverse-muted">
              {[hours, address].filter(Boolean).join(' · ')}
            </span>
          )}
          {phone && <span className="mt-0.5 block font-mono text-[10.5px] text-ink-muted dark:text-ink-inverse-muted">{phone}</span>}
        </span>
      </button>
    </motion.li>
  )
}

/** Sets the profile's home location and re-runs Places there (`searchResultsStore.refreshPlaces`). */
function LocationForm({ initial, onSubmit }: { initial: string; onSubmit: (location: string) => void }) {
  const [value, setValue] = useState(initial)
  const trimmed = value.trim()
  return (
    <form
      className="mt-5 flex w-full max-w-sm items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (trimmed) onSubmit(trimmed)
      }}
    >
      <label htmlFor="places-location" className="sr-only">Your city or neighborhood</label>
      <input
        id="places-location"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="City or neighborhood"
        maxLength={200}
        autoComplete="address-level2"
        className="h-9 min-w-0 flex-1 rounded-lg border border-surface-200 bg-surface-0 px-3 text-[13px] text-ink placeholder:text-ink-muted dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted"
      />
      <button
        type="submit"
        disabled={!trimmed}
        className="inline-flex h-9 flex-shrink-0 items-center rounded-lg bg-blurple-600 px-3 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-blurple-700 disabled:pointer-events-none disabled:opacity-40 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300"
      >
        Search here
      </button>
    </form>
  )
}

export function LocalResults({ state, onRetry, location, onLocationChange }: {
  state: SearchRunState
  hue?: string
  onRetry?: () => void
  /** The profile's home location, prefilled in the empty state's form. */
  location?: string | null
  onLocationChange?: (location: string) => void
}) {
  const section = state.sections.places
  if (!section) return <CardSkeleton cards={4} />
  if (section.status === 'error') return <div className="max-w-[680px]"><SourceErrorNotice error={{ source: 'brave', ...section.error! }} onRetry={onRetry} /></div>

  const items = sectionItems(state, 'places')
  if (!items.length) {
    return (
      <EmptyState
        title="No places found"
        hint={onLocationChange
          ? 'Add your city or neighborhood for sharper local results. Ren saves it to your profile.'
          : 'Add a city or neighborhood to your profile for sharper local results'}
      >
        {onLocationChange && <LocationForm initial={location ?? ''} onSubmit={onLocationChange} />}
      </EmptyState>
    )
  }
  return (
    <ul className="grid max-w-4xl grid-cols-1 gap-3 md:grid-cols-2">
      {items.map((item, i) => <PlaceCard key={item.id} item={item} index={i} />)}
    </ul>
  )
}
