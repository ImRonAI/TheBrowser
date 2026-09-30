import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface Favorite {
  id: string
  title: string
  url: string
}

export const DEFAULT_FAVORITES: Favorite[] = [
  { id: 'github', title: 'GitHub', url: 'https://github.com' },
  { id: 'hn', title: 'Hacker News', url: 'https://news.ycombinator.com' },
  { id: 'youtube', title: 'YouTube', url: 'https://www.youtube.com' },
  { id: 'wikipedia', title: 'Wikipedia', url: 'https://en.wikipedia.org' },
  { id: 'x', title: 'X', url: 'https://x.com' },
  { id: 'reddit', title: 'Reddit', url: 'https://www.reddit.com' },
]

export function normalizeFavoriteUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
  const candidate = hasScheme ? trimmed : `https://${trimmed}`

  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.href
  } catch {
    return null
  }
}

export function faviconFor(url: string): string {
  try {
    const parsed = new URL(url)
    if (!parsed.hostname) return ''
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`
  } catch {
    return ''
  }
}

interface FavoritesState {
  favorites: Favorite[]
  add: (input: { title: string; url: string }) => Favorite | null
  remove: (id: string) => void
  reset: () => void
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favorites: DEFAULT_FAVORITES,
      add: ({ title, url }) => {
        const normalized = normalizeFavoriteUrl(url)
        if (!normalized) return null

        const existing = get().favorites.find((fav) => fav.url === normalized)
        if (existing) return existing

        let computedTitle = title.trim()
        if (!computedTitle) {
          try {
            computedTitle = new URL(normalized).hostname
          } catch {
            computedTitle = normalized
          }
        }

        const id = `fav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
        const newFav: Favorite = { id, title: computedTitle, url: normalized }

        set((state) => ({ favorites: [...state.favorites, newFav] }))
        return newFav
      },
      remove: (id) =>
        set((state) => ({
          favorites: state.favorites.filter((fav) => fav.id !== id),
        })),
      reset: () => set({ favorites: DEFAULT_FAVORITES }),
    }),
    {
      name: 'ron-favorites',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      merge: (persisted, current) => ({
        ...current,
        favorites: Array.isArray((persisted as { favorites?: unknown })?.favorites)
          ? (persisted as { favorites: Favorite[] }).favorites
          : current.favorites,
      }),
    },
  ),
)
