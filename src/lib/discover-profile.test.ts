import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
} })
const { buildFeedRequest, buildProfile, DEFAULT_TOPICS, interestSeeds, MAX_FEED_SECTIONS, parseHome, parseList, parseMarkets, parseMedia } =
  await import('./discover-profile.ts')
const { INTERVIEW, answerFor, useOnboardingStore } = await import('../stores/onboardingStore.ts')
const { getDiscoverProfile, resolveDiscoverProfile, useDiscoverProfileStore } = await import('../stores/discoverProfileStore.ts')

const answered = (byId: Partial<Record<string, string>>) => Object.entries(byId).map(([id, answer]) => ({
  question: INTERVIEW.find((item) => item.id === id)!.question, answer: answer!, timestamp: 1,
}))
beforeEach(() => {
  storage.clear()
  useOnboardingStore.setState({ answers: [] })
  useDiscoverProfileStore.setState({ overrides: {} })
})

test('interview keeps the keywords interestsStore and HomePage match on, with unique ids', () => {
  assert.equal(INTERVIEW.length, 8)
  assert.equal(new Set(INTERVIEW.map((item) => item.id)).size, 8)
  const byId = Object.fromEntries(INTERVIEW.map((item) => [item.id, item.question]))
  assert.match(byId.topics, /topics/)
  assert.match(byId.intent, /brings you/)
  assert.match(byId.goal, /goal/)
  for (const item of INTERVIEW) assert.ok(item.placeholder.startsWith('e.g.'), item.id)
})

test('parseList splits natural lists and drops none-style answers', () => {
  assert.deepEqual(parseList('AI, design and climate; cooking / travel'), ['AI', 'design', 'climate', 'cooking', 'travel'])
  assert.deepEqual(parseList('I follow the Lakers and Arsenal.'), ['Lakers', 'Arsenal'])
  assert.deepEqual(parseList('none'), [])
  assert.deepEqual(parseList('Not really'), [])
  assert.deepEqual(parseList('AI, ai, Ai', 6), ['AI'])
  assert.deepEqual(parseList('this is a very long phrase that should be dropped, ok'), ['ok'])
})

test('parseHome extracts location and country with a US fallback', () => {
  assert.deepEqual(parseHome("I'm in San Francisco, USA."), { location: 'San Francisco, USA', country: 'US' })
  assert.deepEqual(parseHome('London'), { location: 'London', country: 'GB' })
  assert.deepEqual(parseHome('Berlin, Germany'), { location: 'Berlin, Germany', country: 'DE' })
  assert.deepEqual(parseHome('Lagos'), { location: 'Lagos', country: 'US' })
  assert.deepEqual(parseHome('skip'), { location: null, country: 'US' })
  assert.deepEqual(parseHome(undefined), { location: null, country: 'US' })
})

test('parseMarkets classifies tickers, coins, currency codes and words', () => {
  assert.deepEqual(parseMarkets('TSLA, nvda, bitcoin, ETH, GBP and euros, Apple stock'),
    { stocks: ['TSLA', 'NVDA', 'Apple'], crypto: ['bitcoin', 'ETH'], currencies: ['GBP', 'EUR'] })
  assert.deepEqual(parseMarkets('none'), { stocks: [], crypto: [], currencies: [] })
})

test('parseMedia reads article/video/local preferences with negation', () => {
  assert.deepEqual(parseMedia('Mostly articles, a few videos, yes to local'), { articles: true, videos: true, local: true })
  assert.deepEqual(parseMedia('Articles only, no videos, no local stuff'), { articles: true, videos: false, local: false })
  assert.deepEqual(parseMedia('just videos please'), { articles: false, videos: true, local: true })
  assert.deepEqual(parseMedia('a mix'), { articles: true, videos: true, local: true })
  assert.deepEqual(parseMedia(undefined), { articles: true, videos: true, local: true })
  assert.deepEqual(parseMedia('articles'), { articles: true, videos: false, local: true })
})


test('buildProfile and buildFeedRequest produce a valid FeedRequest for a full profile', () => {
  const answers = answered({
    topics: 'AI, design, climate', home: 'London, UK', teams: 'Arsenal, Lakers',
    markets: 'TSLA, bitcoin, USD', media: 'A mix, including local',
  })
  const profile = buildProfile((id) => answerFor(answers, id))
  assert.deepEqual(profile, {
    topics: ['AI', 'design', 'climate'], location: 'London, UK', country: 'GB', teams: ['Arsenal', 'Lakers'],
    stocks: ['TSLA'], crypto: ['bitcoin'], currencies: ['USD'], media: { articles: true, videos: true, local: true },
  })
  const body = buildFeedRequest(profile)
  assert.equal(body.country, 'GB')
  assert.deepEqual(body.location, { location: 'London, UK' })
  assert.deepEqual(body.sections.map((section) => `${section.kind}:${section.q}`), [
    'rich:weather in London, UK', 'news:AI', 'news:design', 'news:climate', 'news:London news',
    'rich:Arsenal game', 'rich:Lakers game', 'rich:TSLA stock', 'rich:bitcoin price', 'rich:1 USD to GBP',
    'videos:AI', 'videos:design',
  ])
  assert.ok(body.sections.length <= MAX_FEED_SECTIONS)
})

test('buildFeedRequest never exceeds the server section cap and skips the home currency pair', () => {
  const body = buildFeedRequest({
    topics: ['a', 'b', 'c', 'd'], location: 'Paris, France', country: 'FR', teams: ['x', 'y', 'z'],
    stocks: ['A', 'B', 'C', 'D'], crypto: ['btc', 'eth', 'sol'], currencies: ['EUR', 'USD', 'GBP'],
    media: { articles: true, videos: true, local: true },
  })
  assert.equal(body.sections.length, MAX_FEED_SECTIONS)
  assert.ok(!body.sections.some((section) => section.q === '1 EUR to EUR'))
})

test('interestSeeds ranks topics above teams, markets and the home city without duplicates', () => {
  const seeds = interestSeeds({
    topics: ['AI', 'Lakers'], location: 'Austin, Texas', country: 'US', teams: ['Lakers', 'Arsenal'],
    stocks: ['TSLA'], crypto: ['bitcoin'], currencies: ['USD'], media: { articles: true, videos: true, local: true },
  })
  assert.deepEqual(seeds, [
    { label: 'AI', weight: 0.9 }, { label: 'Lakers', weight: 0.9 }, { label: 'Arsenal', weight: 0.7 },
    { label: 'TSLA', weight: 0.6 }, { label: 'bitcoin', weight: 0.6 }, { label: 'Austin', weight: 0.5 },
  ])
})

test('empty onboarding yields defaults and no location', () => {
  const profile = buildProfile(() => undefined)
  assert.deepEqual(profile.topics, DEFAULT_TOPICS)
  assert.equal(profile.location, null)
  const body = buildFeedRequest(profile)
  assert.equal(body.location, undefined)
  assert.ok(!body.sections.some((section) => section.kind === 'rich'))
  assert.equal(body.sections.filter((section) => section.kind === 'videos').length, 2)
})

test('discoverProfileStore layers persisted overrides over derived answers', async () => {
  useOnboardingStore.setState({ answers: answered({ topics: 'AI', home: 'Austin, Texas', media: 'articles only, no local' }) })
  assert.deepEqual(getDiscoverProfile().media, { articles: true, videos: false, local: false })
  assert.equal(getDiscoverProfile().location, 'Austin, Texas')
  useDiscoverProfileStore.getState().setOverride('location', 'Denver, USA')
  useDiscoverProfileStore.getState().setOverride('stocks', ['NVDA'])
  const resolved = getDiscoverProfile()
  assert.equal(resolved.location, 'Denver, USA')
  assert.deepEqual(resolved.stocks, ['NVDA'])
  assert.deepEqual(resolved.topics, ['AI'])
  const saved = storage.get('discover-profile-storage')!
  useDiscoverProfileStore.setState({ overrides: {} })
  storage.set('discover-profile-storage', saved)
  await useDiscoverProfileStore.persist.rehydrate()
  assert.deepEqual(useDiscoverProfileStore.getState().overrides, { location: 'Denver, USA', stocks: ['NVDA'] })
  useDiscoverProfileStore.getState().clearOverride('location')
  assert.equal(getDiscoverProfile().location, 'Austin, Texas')
  assert.deepEqual(resolveDiscoverProfile([], {}).topics, DEFAULT_TOPICS)
})
