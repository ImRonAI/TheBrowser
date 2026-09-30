import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
    clear: () => { storage.clear() },
  },
})

const {
  DEFAULT_FAVORITES,
  faviconFor,
  normalizeFavoriteUrl,
  useFavoritesStore,
} = await import('./favoritesStore.ts')

beforeEach(() => {
  storage.clear()
  useFavoritesStore.getState().reset()
})

test('initial state equals DEFAULT_FAVORITES', () => {
  const state = useFavoritesStore.getState()
  assert.deepEqual(state.favorites, DEFAULT_FAVORITES)
  assert.equal(state.favorites.length, 6)
})

test('normalizeFavoriteUrl normalizes valid URLs and rejects invalid schemes', () => {
  assert.equal(normalizeFavoriteUrl('example.com/a'), 'https://example.com/a')
  assert.equal(normalizeFavoriteUrl('http://example.com/foo'), 'http://example.com/foo')
  assert.equal(normalizeFavoriteUrl('  https://sub.domain.org/path?q=1  '), 'https://sub.domain.org/path?q=1')
  assert.equal(normalizeFavoriteUrl('javascript:alert(1)'), null)
  assert.equal(normalizeFavoriteUrl('ftp://x'), null)
  assert.equal(normalizeFavoriteUrl('data:text/html,hello'), null)
  assert.equal(normalizeFavoriteUrl(''), null)
  assert.equal(normalizeFavoriteUrl('   '), null)
  assert.equal(normalizeFavoriteUrl('://invalid'), null)
})

test('faviconFor generates Google S2 favicon URL or empty string on failure', () => {
  assert.equal(
    faviconFor('https://news.ycombinator.com/x'),
    'https://www.google.com/s2/favicons?domain=news.ycombinator.com&sz=64',
  )
  assert.ok(faviconFor('https://news.ycombinator.com/x').includes('domain=news.ycombinator.com'))
  assert.equal(faviconFor('not-a-valid-url-without-scheme'), '')
  assert.equal(faviconFor(''), '')
})

test('add normalizes url, defaults title to hostname, dedupes by url, and returns created/existing', () => {
  const store = useFavoritesStore.getState()
  const added = store.add({ title: '   ', url: 'example.com/path' })
  assert.ok(added !== null)
  assert.equal(added.url, 'https://example.com/path')
  assert.equal(added.title, 'example.com')
  assert.ok(added.id.startsWith('fav-'))

  const currentFavorites = useFavoritesStore.getState().favorites
  assert.equal(currentFavorites.length, DEFAULT_FAVORITES.length + 1)
  assert.deepEqual(currentFavorites[currentFavorites.length - 1], added)

  // Dedupe: adding the same normalized URL again returns existing and doesn't add duplicate
  const duplicate = useFavoritesStore.getState().add({ title: 'Different Title', url: 'https://example.com/path' })
  assert.deepEqual(duplicate, added)
  assert.equal(useFavoritesStore.getState().favorites.length, DEFAULT_FAVORITES.length + 1)

  // Invalid url returns null
  const invalid = useFavoritesStore.getState().add({ title: 'Bad', url: 'ftp://bad' })
  assert.equal(invalid, null)
  assert.equal(useFavoritesStore.getState().favorites.length, DEFAULT_FAVORITES.length + 1)
})

test('remove drops an entry by id', () => {
  const store = useFavoritesStore.getState()
  const initialCount = store.favorites.length
  const targetId = store.favorites[0]?.id
  assert.ok(targetId)

  store.remove(targetId)
  const afterRemove = useFavoritesStore.getState().favorites
  assert.equal(afterRemove.length, initialCount - 1)
  assert.equal(afterRemove.some((f) => f.id === targetId), false)
})

test('rehydrate round-trip preserves state and allows persisting an empty list without reseeding', async () => {
  const store = useFavoritesStore.getState()
  // Remove all favorites
  for (const item of [...store.favorites]) {
    useFavoritesStore.getState().remove(item.id)
  }
  assert.deepEqual(useFavoritesStore.getState().favorites, [])

  // Check saved localStorage state
  const saved = storage.get('ron-favorites')!
  assert.ok(saved)
  useFavoritesStore.setState({ favorites: DEFAULT_FAVORITES })
  storage.set('ron-favorites', saved)

  await useFavoritesStore.persist.rehydrate()
  assert.deepEqual(useFavoritesStore.getState().favorites, [])
})
