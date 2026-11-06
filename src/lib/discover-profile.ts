/**
 * Turns free-text onboarding answers into the structured inputs the Discover homepage
 * needs, and turns that profile into a `POST /discover/feed` body
 * (`FeedRequest` in agent/api/core/brave_search.py). Pure functions; no I/O.
 */
import type { InterviewQuestionId } from '../stores/onboardingStore.ts'

export interface DiscoverProfile {
  topics: string[]
  /** Free-text place for Brave's `location` param (e.g. "San Francisco, USA"); null when unknown. */
  location: string | null
  /** ISO-3166 alpha-2 for Brave's `country` param. */
  country: string
  teams: string[]
  stocks: string[]
  crypto: string[]
  /** ISO-4217 codes to quote against the home currency. */
  currencies: string[]
  media: { articles: boolean; videos: boolean; local: boolean }
}

export type SectionKind = 'news' | 'videos' | 'images' | 'web' | 'places' | 'rich'
export interface FeedSectionRequest { kind: SectionKind; q: string; count?: number; freshness?: 'pd' | 'pw' | 'pm' | 'py' }
export interface FeedRequestBody {
  sections: FeedSectionRequest[]
  location?: { location: string }
  country: string
}

/** Server-side `FeedRequest.sections` max_length. */
export const MAX_FEED_SECTIONS = 14
/** Total story cards in the 3-row desktop Discover grid (Row 1: 2, Row 2: 3, Row 3: 3). */
export const STORY_GRID_SLOTS = 8
/** Maximum user topics parsed from onboarding. */
export const MAX_TOPICS = 5
/** Teams carried to the feed: one sports card each, four across the "At a glance" row on desktop. */
export const MAX_TEAMS = 4
export const DEFAULT_TOPICS = ['Technology', 'AI', 'Design']
export const FALLBACK_NEWS_TOPICS = ['Technology', 'AI', 'Design', 'Science', 'Culture', 'World news']
export const DEFAULT_PROFILE: DiscoverProfile = {
  topics: DEFAULT_TOPICS, location: null, country: 'US', teams: [], stocks: [], crypto: [], currencies: [],
  media: { articles: true, videos: true, local: true },
}

const NONE = /^(none|no|nope|nothing|n\/?a|not really|skip|-+)$/i
const LIST_SPLIT = /[,;/&\n]+|\s+(?:and|or|plus)\s+/i
const LEADING_FILLER = /^(?:i (?:follow|like|watch|track|own|hold)|the|maybe|mostly|some)\s+/i

/** Split "A, B and C" into ["A", "B", "C"], dropping filler and "none"-style answers. */
export function parseList(text: string | undefined, max = 6): string[] {
  if (!text) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(LIST_SPLIT)) {
    let part = raw.trim().replace(/[.!?]+$/, '').trim()
    while (LEADING_FILLER.test(part)) part = part.replace(LEADING_FILLER, '').trim()
    if (part.length < 2 || part.length > 40 || NONE.test(part) || part.split(/\s+/).length > 4) continue
    const key = part.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(part)
    if (out.length >= max) break
  }
  return out
}

const COUNTRIES: Array<[RegExp, string]> = [
  [/\b(usa?|u\.s\.a?\.?|united states|america|california|texas|new york|florida)\b/i, 'US'],
  [/\b(uk|u\.k\.|united kingdom|england|britain|great britain|scotland|wales|london)\b/i, 'GB'],
  [/\bcanada\b/i, 'CA'], [/\baustralia\b/i, 'AU'], [/\bnew zealand\b/i, 'NZ'], [/\bireland\b/i, 'IE'],
  [/\b(germany|deutschland|berlin)\b/i, 'DE'], [/\b(france|paris)\b/i, 'FR'], [/\b(spain|españa|madrid)\b/i, 'ES'],
  [/\b(italy|italia|rome)\b/i, 'IT'], [/\b(netherlands|holland|amsterdam)\b/i, 'NL'], [/\b(japan|tokyo)\b/i, 'JP'],
  [/\b(india|mumbai|delhi|bangalore|bengaluru)\b/i, 'IN'], [/\b(brazil|brasil)\b/i, 'BR'], [/\b(mexico|méxico)\b/i, 'MX'],
  [/\b(south korea|korea|seoul)\b/i, 'KR'], [/\b(singapore)\b/i, 'SG'], [/\b(sweden|stockholm)\b/i, 'SE'],
  [/\b(switzerland|zurich|zürich)\b/i, 'CH'], [/\b(south africa)\b/i, 'ZA'], [/\b(portugal|lisbon)\b/i, 'PT'],
  [/\b(poland|warsaw)\b/i, 'PL'], [/\b(norway|oslo)\b/i, 'NO'], [/\b(denmark|copenhagen)\b/i, 'DK'],
]

/** "San Francisco, USA" → { location: "San Francisco, USA", country: "US" }. Country defaults to US. */
export function parseHome(text: string | undefined): Pick<DiscoverProfile, 'location' | 'country'> {
  const cleaned = (text || '').replace(/^(?:i(?:'m| am| live) (?:in|from|based in)|home is|it's)\s+/i, '').replace(/[.!?]+$/, '').trim()
  if (!cleaned || NONE.test(cleaned)) return { location: null, country: 'US' }
  const match = COUNTRIES.find(([pattern]) => pattern.test(cleaned))
  return { location: cleaned.slice(0, 200), country: match ? match[1] : 'US' }
}


const CRYPTO = /^(bitcoin|btc|ethereum|eth|solana|sol|dogecoin|doge|xrp|ripple|cardano|ada|litecoin|ltc|polkadot|dot|avalanche|avax|chainlink|link|polygon|matic|bnb|usdc|usdt|tether)$/i
const CURRENCY_CODES = /^(usd|eur|gbp|jpy|chf|cad|aud|nzd|cny|rmb|inr|mxn|brl|krw|sek|nok|dkk|sgd|hkd|zar|pln|try|thb|aed)$/i
const CURRENCY_WORDS: Record<string, string> = {
  dollar: 'USD', dollars: 'USD', euro: 'EUR', euros: 'EUR', pound: 'GBP', pounds: 'GBP', sterling: 'GBP',
  yen: 'JPY', franc: 'CHF', francs: 'CHF', rupee: 'INR', rupees: 'INR', yuan: 'CNY', peso: 'MXN', pesos: 'MXN',
  real: 'BRL', won: 'KRW', krona: 'SEK', rand: 'ZAR', dirham: 'AED',
}
const HOME_CURRENCY: Record<string, string> = {
  US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR',
  PT: 'EUR', JP: 'JPY', IN: 'INR', BR: 'BRL', MX: 'MXN', KR: 'KRW', SG: 'SGD', SE: 'SEK', CH: 'CHF', ZA: 'ZAR', PL: 'PLN',
  NO: 'NOK', DK: 'DKK',
}

export function homeCurrency(country: string): string {
  return HOME_CURRENCY[country.toUpperCase()] || 'USD'
}

/** Classify "TSLA, bitcoin, GBP" into stocks / crypto / currencies. Company names stay as stock queries. */
export function parseMarkets(text: string | undefined): Pick<DiscoverProfile, 'stocks' | 'crypto' | 'currencies'> {
  const stocks: string[] = [], crypto: string[] = [], currencies: string[] = []
  for (const item of parseList(text, 10)) {
    const token = item.replace(/\b(stocks?|shares?|price|coin|crypto)\b/gi, '').trim()
    if (!token) continue
    const lower = token.toLowerCase()
    if (CRYPTO.test(token)) crypto.push(token)
    else if (CURRENCY_CODES.test(token)) currencies.push(token.toUpperCase())
    else if (CURRENCY_WORDS[lower]) currencies.push(CURRENCY_WORDS[lower])
    else stocks.push(/^[A-Z]{1,5}$/.test(token) || /^[a-z]{1,4}$/.test(token) ? token.toUpperCase() : token)
  }
  return { stocks: stocks.slice(0, 4), crypto: crypto.slice(0, 3), currencies: [...new Set(currencies)].slice(0, 3) }
}

const negated = (text: string, word: RegExp) =>
  new RegExp(`\\b(?:no|not|without|skip|never|don't|dont|hate)\\s+(?:\\w+\\s+){0,2}(?:${word.source})`, 'i').test(text)

/** "Mostly articles, a few videos, yes to local" → { articles, videos, local }. Unanswered → all on. */
export function parseMedia(text: string | undefined): DiscoverProfile['media'] {
  if (!text || NONE.test(text.trim())) return { ...DEFAULT_PROFILE.media }
  const videoWord = /videos?|youtube|clips?|watch/, localWord = /local|nearby|my (?:city|area|town)|regional/
  const mentionsVideo = videoWord.test(text.toLowerCase()) || /\b(mix|both|everything|all)\b/i.test(text)
  const videos = mentionsVideo && !negated(text, videoWord)
  const articles = !/\b(only|just)\s+videos?\b|\bvideos?\s+only\b/i.test(text)
  const local = !negated(text, localWord) && !/\bno\s+to\s+local\b/i.test(text)
  return { articles, videos, local }
}

export type AnswerLookup = (id: InterviewQuestionId) => string | undefined

/** Build the whole profile from an answer lookup (see `answerFor` in onboardingStore). */
export function buildProfile(answer: AnswerLookup): DiscoverProfile {
  const topics = parseList(answer('topics'), MAX_TOPICS)
  return {
    topics: topics.length ? topics : DEFAULT_TOPICS,
    ...parseHome(answer('home')),
    teams: parseList(answer('teams'), MAX_TEAMS),
    ...parseMarkets(answer('markets')),
    media: parseMedia(answer('media')),
  }
}

function extraNewsTopic(profile: DiscoverProfile, usedQueries: Set<string>): string | null {
  const candidates = [...profile.teams, ...profile.stocks, ...FALLBACK_NEWS_TOPICS]
  for (const candidate of candidates) {
    const clean = candidate.trim()
    if (!clean) continue
    if (!usedQueries.has(clean.toLowerCase())) {
      return clean
    }
  }
  return null
}

/**
 * Profile → `POST /discover/feed` body. Sections are emitted in priority order and capped
 * at MAX_FEED_SECTIONS so a maximal profile never 422s. When articles are enabled, an extra
 * trailing `news` section is appended so the 3-row desktop grid (2 + 3 + 3 = 8 cards) fills
 * its bottom-right 8th slot.
 */
export function buildFeedRequest(profile: DiscoverProfile): FeedRequestBody {
  const sections: FeedSectionRequest[] = []
  const usedNews = new Set<string>()
  const city = profile.location?.split(',')[0]?.trim()
  if (profile.location) sections.push({ kind: 'rich', q: `weather in ${profile.location}` })
  if (profile.media.articles) {
    for (const topic of profile.topics) {
      sections.push({ kind: 'news', q: topic, count: 6, freshness: 'pw' })
      usedNews.add(topic.toLowerCase())
    }
  }
  if (profile.media.local && city) {
    const localQuery = `${city} news`
    sections.push({ kind: 'news', q: localQuery, count: 6, freshness: 'pw' })
    usedNews.add(localQuery.toLowerCase())
    usedNews.add(city.toLowerCase())
  }
  for (const team of profile.teams) sections.push({ kind: 'rich', q: `${team} game` })
  for (const stock of profile.stocks) sections.push({ kind: 'rich', q: `${stock} stock` })
  for (const coin of profile.crypto) sections.push({ kind: 'rich', q: `${coin} price` })
  const base = homeCurrency(profile.country)
  for (const code of profile.currencies) if (code !== base) sections.push({ kind: 'rich', q: `1 ${code} to ${base}` })
  if (profile.media.videos) for (const topic of profile.topics.slice(0, 2)) sections.push({ kind: 'videos', q: topic, count: 4, freshness: 'pm' })
  if (profile.media.articles) {
    const storyCount = sections.filter((section) => section.kind === 'news' || section.kind === 'videos').length
    if (storyCount < STORY_GRID_SLOTS) {
      const extra = extraNewsTopic(profile, usedNews)
      if (extra) {
        sections.push({ kind: 'news', q: extra, count: 6, freshness: 'pw' })
      }
    }
  }
  return {
    sections: sections.slice(0, MAX_FEED_SECTIONS),
    ...(profile.location ? { location: { location: profile.location } } : {}),
    country: profile.country,
  }
}

export interface InterestSeed { label: string; weight: number }

/**
 * Labels the Interests orb (bottom-right widget) should start from, weighted by how
 * directly the user asked for them. Topics lead; teams, markets and home city follow so
 * the interests agent can grow from the same inputs that drive the Discover feed.
 */
export function interestSeeds(profile: DiscoverProfile): InterestSeed[] {
  const seeds: InterestSeed[] = []
  const seen = new Set<string>()
  const push = (label: string, weight: number) => {
    const key = label.toLowerCase()
    if (!label || seen.has(key)) return
    seen.add(key)
    seeds.push({ label, weight })
  }
  for (const topic of profile.topics) push(topic, 0.9)
  for (const team of profile.teams) push(team, 0.7)
  for (const stock of profile.stocks) push(stock, 0.6)
  for (const coin of profile.crypto) push(coin, 0.6)
  if (profile.location) push(profile.location.split(',')[0].trim(), 0.5)
  return seeds
}
