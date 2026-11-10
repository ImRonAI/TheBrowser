import assert from 'node:assert/strict'
import { test } from 'node:test'

const { CANCELLED_ANSWER_MESSAGE, CANCELLED_SECTION_MESSAGE, DEFAULT_SEARCH_LEVEL, LEVEL_INFO, PLACES_RESULT_COUNT, SECTION_KINDS,
  SearchApiError, applySearchEvent, beginFollowUpState, initialRunState, levelLabel, mergedImages, mergedWebResults, parseSseBlock,
  placesRefreshRequest, searchRunKey, sectionItems, settleCancelledRun, streamSearch } = await import('./search-api.ts')
type FeedSection = import('./discover-feed.ts').FeedSection
type SearchEvent = import('./search-api.ts').SearchEvent
type SearchRunState = import('./search-api.ts').SearchRunState

const section = (kind: FeedSection['kind'], items: Partial<FeedSection['items'][number]>[], over: Partial<FeedSection> = {}): FeedSection => ({
  kind, q: 'ebikes', status: 'ok', items: items.map((item, index) => ({
    kind: kind === 'news' ? 'article' : kind === 'videos' ? 'video' : kind === 'images' ? 'image' : kind === 'places' ? 'place' : 'web',
    id: `${kind}:${index}`, title: 'T', url: `https://ex.com/${kind}/${index}`, source: 'ex.com', description: '',
    thumbnail: null, favicon: null, published: null, age: null, ...item,
  } as FeedSection['items'][number])), ...over,
})

const run = (events: SearchEvent[]): SearchRunState => events.reduce(applySearchEvent, initialRunState())

test('meta and section events populate the run state', () => {
  const state = run([
    { event: 'meta', data: { q: 'ebikes', level: 'medium', model: 'openai/gpt-6.1-sol', shopping_model: 'openai/gpt-6-luna', country: 'US' } },
    { event: 'section', data: section('web', [{ url: 'https://a.com', title: 'A', description: 'first' }]) },
    { event: 'section', data: section('videos', [], { status: 'error', items: [], error: { code: 'rate_limited', message: 'slow down' } }) },
    { event: 'done', data: { duration_ms: 1234 } },
  ])
  assert.deepEqual(state.meta, { q: 'ebikes', level: 'medium', model: 'openai/gpt-6.1-sol', shoppingModel: 'openai/gpt-6-luna', country: 'US' })
  assert.equal(state.sections.web?.items[0].url, 'https://a.com')
  assert.equal(state.sections.videos?.error?.code, 'rate_limited')
  assert.equal(state.durationMs, 1234)
})

test('agent deltas accumulate; citations, sources and images dedupe by url', () => {
  const state = run([
    { event: 'agent.delta', data: { text: 'Hello' } },
    { event: 'agent.delta', data: { text: ' world' } },
    { event: 'agent.reasoning', data: { text: 'thinking' } },
    { event: 'agent.citation', data: { url: 'https://c.com', title: 'C' } },
    { event: 'agent.citation', data: { url: 'https://c.com', title: 'C again' } },
    { event: 'agent.sources', data: { results: [{ url: 'https://s.com', title: 'S' }, { url: 'https://s.com' }] } },
    { event: 'agent.images', data: { results: [{ url: 'https://i.com/x.jpg', width: 10 }] } },
    { event: 'agent.done', data: { usage: { total_tokens: 9 }, model: 'openai/gpt-6.1-sol' } },
  ])
  assert.equal(state.agent.text, 'Hello world')
  assert.equal(state.agent.reasoning, 'thinking')
  assert.equal(state.agent.citations.length, 1)
  assert.equal(state.agent.sources.length, 1)
  assert.equal(state.agent.images[0].width, 10)
  assert.equal(state.agent.status, 'done')
  assert.equal(state.agent.usage?.total_tokens, 9)
})

test('source_error flags the matching lane; the rest of the run still completes', () => {
  const state = run([
    { event: 'shopping.delta', data: { text: 'shoe' } },
    { event: 'source_error', data: { source: 'agent', code: 'upstream', message: 'boom', status: 502 } },
    { event: 'shopping.done', data: { usage: null, model: 'openai/gpt-6-luna' } },
    { event: 'done', data: { duration_ms: 5 } },
  ])
  assert.equal(state.agent.status, 'error')
  assert.equal(state.agent.error?.code, 'upstream')
  assert.equal(state.shopping.text, 'shoe')
  assert.equal(state.shopping.status, 'done')
  assert.equal(state.errors.length, 0)
})

test('mergedWebResults merges agent sources with brave items and marks origin both', () => {
  const state = run([
    { event: 'agent.sources', data: { results: [
      { url: 'https://shared.com', title: 'Agent title', snippet: 'agent snippet' },
      { url: 'https://agent-only.com', title: 'Agent only' },
    ] } },
    { event: 'section', data: section('web', [
      { url: 'https://shared.com', title: 'Brave title', description: 'brave snippet', favicon: 'https://f', age: '2d' },
      { url: 'https://brave-only.com', title: 'Brave only', kind: 'discussion', description: 'reddit' },
    ]) },
  ])
  const results = mergedWebResults(state)
  assert.equal(results.length, 3)
  const shared = results.find((r) => r.url === 'https://shared.com')!
  assert.equal(shared.origin, 'both')
  assert.equal(shared.title, 'Agent title')
  assert.equal(shared.snippet, 'agent snippet')
  assert.equal(shared.favicon, 'https://f')
  assert.equal(results.find((r) => r.url === 'https://agent-only.com')!.origin, 'agent')
  const braveOnly = results.find((r) => r.url === 'https://brave-only.com')!
  assert.equal(braveOnly.origin, 'brave')
  assert.equal(braveOnly.kind, 'discussion')
})

test('mergedImages prefers agent entries and pulls brave image urls', () => {
  const state = run([
    { event: 'agent.images', data: { results: [{ url: 'https://img/shared.jpg', width: 50 }] } },
    { event: 'section', data: section('images', [
      { image: { url: 'https://img/shared.jpg', width: 100 }, title: 'brave copy' },
      { image: { url: 'https://img/brave.jpg', width: 200, height: 100 }, title: 'brave', url: 'https://page.com' },
    ]) },
  ])
  const images = mergedImages(state)
  assert.equal(images.length, 2)
  assert.equal(images[0].origin, 'agent')
  assert.equal(images[1].url, 'https://img/brave.jpg')
  assert.equal(images[1].pageUrl, 'https://page.com')
  assert.equal(images[1].origin, 'brave')
})

test('sectionItems returns items only for ok sections', () => {
  const state = run([
    { event: 'section', data: section('news', [{ url: 'https://n.com' }]) },
    { event: 'section', data: section('videos', [], { status: 'error', items: [], error: { code: 'x', message: 'y' } }) },
  ])
  assert.equal(sectionItems(state, 'news').length, 1)
  assert.equal(sectionItems(state, 'videos').length, 0)
  assert.equal(sectionItems(state, 'places').length, 0)
})

test('parseSseBlock reads event/data frames and rejects junk', () => {
  assert.deepEqual(parseSseBlock('event: agent.delta\ndata: {"text":"hi"}'), { event: 'agent.delta', data: { text: 'hi' } })
  assert.equal(parseSseBlock('data: not-json'), null)
  assert.equal(parseSseBlock('event: done'), null)
  assert.equal(parseSseBlock(''), null)
})

test('level metadata covers every preset with a default', () => {
  assert.equal(DEFAULT_SEARCH_LEVEL, 'low')
  assert.deepEqual(LEVEL_INFO.map((info) => info.id), ['fast', 'low', 'medium', 'high', 'xhigh'])
  assert.equal(levelLabel('xhigh'), 'Max')
  assert.equal(levelLabel('bogus'), 'bogus')
})

test('streamSearch parses chunked frames and posts the request body', async () => {
  const payload = 'event: meta\ndata: {"q":"ebikes","level":"low","model":"m","shopping_model":null,"country":"US"}\n\n' +
    'event: agent.delta\ndata: {"text":"Hel'
  const tail = 'lo"}\n\nevent: done\ndata: {"duration_ms":1}\n\n'
  const chunks = [payload, tail]
  const seen: { url: string; body: string }[] = []
  const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
    seen.push({ url, body: String(init?.body) })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
        controller.close()
      },
    })
    return new Response(stream, { status: 200 })
  }
  const events: SearchEvent[] = []
  await streamSearch({ q: 'ebikes', level: 'low' }, (event) => events.push(event), undefined, fetcher, 'http://api.test')
  assert.deepEqual(events.map((e) => e.event), ['meta', 'agent.delta', 'done'])
  assert.equal((events[1] as { data: { text: string } }).data.text, 'Hello')
  assert.equal(seen[0].url, 'http://api.test/search/stream')
  assert.deepEqual(JSON.parse(seen[0].body), { q: 'ebikes', level: 'low' })
})

test('streamSearch maps http and network failures to SearchApiError', async () => {
  const notConfigured = async (): Promise<Response> =>
    new Response(JSON.stringify({ detail: { code: 'not_configured', message: 'no keys' } }), { status: 503 })
  await assert.rejects(streamSearch({ q: 'x' }, () => {}, undefined, notConfigured, 'http://api.test'),
    (error: unknown) => error instanceof SearchApiError && error.code === 'not_configured' && error.status === 503)
  const offline = async (): Promise<Response> => { throw new TypeError('fetch failed') }
  await assert.rejects(streamSearch({ q: 'x' }, () => {}, undefined, offline, 'http://api.test'),
    (error: unknown) => error instanceof SearchApiError && error.code === 'unreachable')
})

test('beginFollowUpState archives the completed turn and preserves sessionId, sections, and shopping', () => {
  const initial = run([
    {
      event: 'meta',
      data: {
        q: 'best espresso machines',
        level: 'high',
        model: 'xai/grok-4.7',
        provider: 'xai',
        effort: 'high',
        shopping_model: 'xai/grok-4.7',
        country: 'US',
        session_id: 'search-session-123',
        follow_up: false,
      },
    },
    { event: 'section', data: section('web', [{ url: 'https://coffee.com', title: 'Coffee' }]) },
    { event: 'agent.reasoning', data: { text: 'Comparing boilers' } },
    { event: 'agent.delta', data: { text: 'The Rancilio Silvia Pro X is a top pick.' } },
    { event: 'agent.citation', data: { url: 'https://coffee.com', title: 'Coffee' } },
    { event: 'agent.sources', data: { results: [{ url: 'https://coffee.com', title: 'Coffee' }] } },
    { event: 'agent.done', data: { usage: { total_tokens: 420 }, model: 'xai/grok-4.7' } },
    {
      event: 'shopping.sources',
      data: {
        results: [
          { url: 'https://seattlecoffeegear.com/silvia', title: 'Silvia Pro X - $1,990', kind: 'online' },
          {
            url: 'https://localroaster.example.com',
            title: 'Local Roaster & Supply',
            kind: 'local',
            address: '123 Main St, Seattle, WA',
            rating: 4.8,
            review_count: 210,
          },
        ],
      },
    },
  ])
  assert.equal(initial.sessionId, 'search-session-123')
  assert.equal(initial.effort, 'high')
  assert.equal(initial.shopping.sources.length, 2)
  assert.equal(initial.shopping.sources[1].kind, 'local')

  const next = beginFollowUpState(initial, 'How does it compare to the Profitec Pro 300?')
  assert.equal(next.turns.length, 1)
  assert.equal(next.turns[0].question, 'best espresso machines')
  assert.equal(next.turns[0].text, 'The Rancilio Silvia Pro X is a top pick.')
  assert.equal(next.turns[0].reasoning, 'Comparing boilers')
  assert.equal(next.turns[0].citations.length, 1)
  assert.equal(next.activeQuestion, 'How does it compare to the Profitec Pro 300?')
  assert.equal(next.agent.status, 'streaming')
  assert.equal(next.agent.text, '')
  assert.equal(next.agent.sources.length, 1)
  assert.equal(next.sessionId, 'search-session-123')
  assert.equal(next.shopping.sources.length, 2)

  const afterFollowUp = [
    {
      event: 'meta' as const,
      data: {
        q: 'How does it compare to the Profitec Pro 300?',
        level: 'high',
        model: 'xai/grok-4.7',
        provider: 'xai',
        effort: 'high',
        shopping_model: null,
        country: 'US',
        session_id: 'search-session-123',
        follow_up: true,
      },
    },
    { event: 'agent.delta' as const, data: { text: 'The Profitec heats up faster.' } },
    { event: 'agent.done' as const, data: { usage: { total_tokens: 310 }, model: 'xai/grok-4.7' } },
  ].reduce(applySearchEvent, next)

  assert.equal(afterFollowUp.meta?.q, 'best espresso machines')
  assert.equal(afterFollowUp.meta?.shoppingModel, 'xai/grok-4.7')
  assert.equal(afterFollowUp.turns.length, 1)
  assert.equal(afterFollowUp.agent.text, 'The Profitec heats up faster.')
  assert.equal(afterFollowUp.agent.status, 'done')
})

test('settleCancelledRun keeps partial text as a finished answer and closes every lane and missing section', () => {
  const stopped = run([
    { event: 'meta', data: { q: 'ebikes', level: 'low', model: 'm', shopping_model: 's', country: 'US' } },
    { event: 'section', data: section('web', [{ url: 'https://a.com' }]) },
    { event: 'agent.reasoning', data: { text: 'looking' } },
    { event: 'agent.delta', data: { text: 'Partial answer' } },
    { event: 'shopping.reasoning', data: { text: 'browsing shops' } },
  ])
  assert.equal(stopped.agent.status, 'streaming')
  assert.equal(stopped.shopping.status, 'streaming')

  const settled = settleCancelledRun(stopped)
  assert.equal(settled.agent.status, 'done')
  assert.equal(settled.agent.text, 'Partial answer')
  assert.equal(settled.agent.error, null)
  assert.equal(settled.shopping.status, 'error')
  assert.deepEqual(settled.shopping.error, { source: 'shopping', code: 'cancelled', message: CANCELLED_ANSWER_MESSAGE })
  // The section that arrived is untouched; every other one becomes a cancelled error instead of a skeleton.
  assert.equal(settled.sections.web?.status, 'ok')
  for (const kind of SECTION_KINDS.filter((kind) => kind !== 'web')) {
    assert.equal(settled.sections[kind]?.status, 'error', kind)
    assert.equal(settled.sections[kind]?.q, 'ebikes')
    assert.deepEqual(settled.sections[kind]?.error, { code: 'cancelled', message: CANCELLED_SECTION_MESSAGE })
  }
})

test('settleCancelledRun leaves finished lanes alone and settles only the agent lane of a follow-up', () => {
  const finished = run([
    { event: 'meta', data: { q: 'ebikes', level: 'low', model: 'm', shopping_model: 's', country: 'US' } },
    { event: 'agent.delta', data: { text: 'First answer' } },
    { event: 'agent.done', data: { usage: null, model: 'm' } },
    { event: 'source_error', data: { source: 'shopping', code: 'upstream', message: 'boom' } },
  ])
  const followUp = beginFollowUpState(finished, 'And cargo bikes?')
  const settled = settleCancelledRun(followUp, 'follow-up')
  assert.equal(settled.agent.status, 'error')
  assert.equal(settled.agent.error?.code, 'cancelled')
  assert.equal(settled.turns.length, 1)
  assert.equal(settled.shopping.error?.code, 'upstream')
  // A follow-up never streams Brave sections, so none are invented for it.
  assert.deepEqual(settled.sections, finished.sections)

  const untouched = settleCancelledRun(finished)
  assert.equal(untouched.agent.status, 'done')
  assert.equal(untouched.shopping.error?.code, 'upstream')
})

test('searchRunKey identifies a run by level and query', () => {
  assert.equal(searchRunKey('ebikes', 'low'), searchRunKey('ebikes', 'low'))
  assert.notEqual(searchRunKey('ebikes', 'low'), searchRunKey('ebikes', 'high'))
  assert.notEqual(searchRunKey('ebikes', 'low'), searchRunKey('e-bikes', 'low'))
})

test('placesRefreshRequest asks /discover/feed for only the Places section at the search count', () => {
  assert.deepEqual(placesRefreshRequest('coffee', { country: 'GB', location: ' Shoreditch, London ' }), {
    sections: [{ kind: 'places', q: 'coffee', count: PLACES_RESULT_COUNT }],
    location: { location: 'Shoreditch, London' },
    country: 'GB',
  })
  assert.deepEqual(placesRefreshRequest('coffee', { country: 'US', location: null }), {
    sections: [{ kind: 'places', q: 'coffee', count: PLACES_RESULT_COUNT }],
    country: 'US',
  })
})
