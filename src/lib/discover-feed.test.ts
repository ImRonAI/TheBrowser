import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
} })
const { DiscoverFeedError, failedSections, fetchDiscoverFeed, formatNumber, isFresh, itemToStory, richAnswers, sectionLabel,
  sectionsToStoryGroups, sparklinePath, sparklinePoints, stripMarkup } = await import('./discover-feed.ts')
const { DEFAULT_PROFILE } = await import('./discover-profile.ts')
const { useDiscoverFeedStore } = await import('../stores/discoverFeedStore.ts')
type FeedSection = import('./discover-feed.ts').FeedSection
type DiscoverItem = import('./discover-feed.ts').DiscoverItem

const item = (over: Partial<DiscoverItem>): DiscoverItem => ({ kind: 'article', id: 'news:x', title: 'T', url: 'https://ex.com/a', source: 'ex.com',
  description: '', thumbnail: null, favicon: null, published: null, age: null, ...over })
const ok = (kind: FeedSection['kind'], q: string, items: DiscoverItem[]): FeedSection => ({ kind, q, status: 'ok', items })
const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => { storage.clear(); useDiscoverFeedStore.setState({ requestKey: null, sections: [], fetchedAt: null, loading: false, error: null }) })

test('stripMarkup drops Brave <strong> highlights and entities', () => {
  assert.equal(stripMarkup('Apple &amp; <strong>Nvidia</strong> rally &#39;24'), "Apple & Nvidia rally '24")
})

test('itemToStory keeps articles/web/video with http urls, derives hostname, drops rich/images', () => {
  const story = itemToStory(item({ title: '<strong>AI</strong> news', source: '', description: 'a &lt; b', age: '2h' }), 'AI')!
  assert.deepEqual(story, { title: 'AI news', url: 'https://ex.com/a', description: 'a < b', age: '2h', topic: 'AI', hostname: 'ex.com', thumbnail: '' })
  assert.equal(itemToStory(item({ kind: 'rich' }), 'x'), null)
  assert.equal(itemToStory(item({ kind: 'image' }), 'x'), null)
  assert.equal(itemToStory(item({ url: 'javascript:alert(1)' }), 'x'), null)
})

test('sectionsToStoryGroups skips failed/rich sections and dedupes urls across sections', () => {
  const sections: FeedSection[] = [
    ok('news', 'AI', [item({ id: '1' }), item({ id: '2', url: 'https://ex.com/b' })]),
    ok('videos', 'AI', [item({ id: '3', kind: 'video', url: 'https://ex.com/a' }), item({ id: '4', kind: 'video', url: 'https://yt.com/v' })]),
    { kind: 'news', q: 'Design', status: 'error', items: [], error: { code: 'rate_limited', message: 'slow down' } },
    ok('rich', 'weather in Austin', [item({ id: '5', kind: 'rich', url: '', rich: { vertical: 'weather', subtype: 'weather', provider: {}, card: { temp_c: 20 }, raw: {} } })]),
  ]
  const groups = sectionsToStoryGroups(sections)
  assert.deepEqual(groups.map((g) => g.map((s) => s.url)), [['https://ex.com/a', 'https://ex.com/b'], ['https://yt.com/v']])
  assert.equal(groups[1][0].topic, 'AI · Video')
  assert.equal(richAnswers(sections).length, 1)
  assert.equal(failedSections(sections)[0].error?.code, 'rate_limited')
  assert.equal(sectionLabel({ kind: 'places', q: 'coffee' }), 'Near you · coffee')
})

test('sparkline helpers accept [ts, value] pairs, bare numbers and objects', () => {
  assert.deepEqual(sparklinePoints([[1, 10], [2, 12.5], [3, 'bad']]), [10, 12.5])
  assert.deepEqual(sparklinePoints([1, 2, { price: 3 }, { rate: '4' }, null]), [1, 2, 3, 4])
  assert.equal(sparklinePath([1, 3, 2], 100, 20), '0.0,20.0 50.0,0.0 100.0,10.0')
  assert.equal(sparklinePath([1]), '')
  assert.equal(formatNumber(1234.567), '1,235')
  assert.equal(formatNumber(12.345), '12.35')
  assert.equal(formatNumber(null), '—')
})

test('fetchDiscoverFeed maps 503 not_configured and network failures to DiscoverFeedError', async () => {
  await assert.rejects(fetchDiscoverFeed({ sections: [], country: 'US' }, async () => jsonResponse(503, { detail: { code: 'not_configured', message: 'BRAVE_SEARCH_API_KEY is not set' } })),
    (error: unknown) => error instanceof DiscoverFeedError && error.code === 'not_configured' && error.status === 503)
  await assert.rejects(fetchDiscoverFeed({ sections: [], country: 'US' }, async () => { throw new TypeError('Failed to fetch') }),
    (error: unknown) => error instanceof DiscoverFeedError && error.code === 'unreachable')
  await assert.rejects(fetchDiscoverFeed({ sections: [], country: 'US' }, async () => jsonResponse(200, { nope: true })),
    (error: unknown) => error instanceof DiscoverFeedError && error.code === 'malformed')
})

test('feed store caches by request key within TTL and refetches when the profile changes', async () => {
  const calls: string[] = []
  const fetcher = async (_url: string, init?: RequestInit) => { calls.push(String(init?.body)); return jsonResponse(200, { sections: [ok('news', 'AI', [item({})])] }) }
  const store = useDiscoverFeedStore.getState()
  await store.load(DEFAULT_PROFILE, { fetcher, now: 1_000 })
  assert.equal(calls.length, 1)
  assert.equal(useDiscoverFeedStore.getState().sections.length, 1)
  assert.equal(useDiscoverFeedStore.getState().fetchedAt, 1_000)
  await store.load(DEFAULT_PROFILE, { fetcher, now: 2_000 })
  assert.equal(calls.length, 1, 'fresh cache is reused')
  assert.equal(isFresh(1_000, 1_000 + 31 * 60_000), false)
  await store.load(DEFAULT_PROFILE, { fetcher, now: 1_000 + 31 * 60_000 })
  assert.equal(calls.length, 2, 'stale cache refetches')
  await store.load({ ...DEFAULT_PROFILE, topics: ['Rust'] }, { fetcher, now: 1_000 + 31 * 60_000 })
  assert.equal(calls.length, 3, 'changed profile refetches')
  assert.match(calls[2], /Rust/)
  const persisted = JSON.parse(storage.get('discover-feed-storage')!)
  assert.equal(persisted.state.sections.length, 1)
  assert.equal('loading' in persisted.state, false)
})

test('feed store records backend errors without dropping the last good feed', async () => {
  useDiscoverFeedStore.setState({ requestKey: 'old', sections: [ok('news', 'AI', [item({})])], fetchedAt: 1 })
  await useDiscoverFeedStore.getState().load(DEFAULT_PROFILE, { fetcher: async () => jsonResponse(503, { detail: { code: 'not_configured', message: 'no key' } }), now: 10 })
  const state = useDiscoverFeedStore.getState()
  assert.deepEqual(state.error, { code: 'not_configured', message: 'no key' })
  assert.equal(state.sections.length, 1)
  assert.equal(state.loading, false)
})

