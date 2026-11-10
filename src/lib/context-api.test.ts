import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agentServesInterest, approveAgentTurn, browsingDue, browsingTurn, contextAddedTurn, contextResults, createContextClient, dataUrlBlob, discoverTopics,
  formatBytes, interestsFromOutput, isObservable, latestReply, recommendationFromOutput, recordVisit, searchMarkdown,
  type ContextItem,
} from './context-api.ts'
import type { PanelMessage, PanelState } from './panel-stream.ts'

const item: ContextItem = { id: 'ctx-0190000000a1b2c', kind: 'link', title: 'Tokio', source: 'https://tokio.rs/', added: '2026-11-06T10:00:00Z', file: null, preview: 'Async runtime', chars: 40 }

test('isObservable keeps public web pages and drops local, internal and sign-in pages', () => {
  assert.equal(isObservable('https://www.formula1.com/en/racing/2026'), true)
  assert.equal(isObservable('http://example.com/a'), true)
  for (const url of ['ron://home', 'about:blank', 'http://localhost:5173/', 'http://127.0.0.1:8765/health', 'https://accounts.google.com/o/oauth2',
    'https://github.com/login', 'file:///etc/hosts', 'not a url']) assert.equal(isObservable(url), false, url)
})

test('recordVisit drops repeats and hash changes but keeps the newest title', () => {
  let queue = recordVisit([], { url: 'https://a.com/x', title: 'Loading', at: 1 })
  queue = recordVisit(queue, { url: 'https://a.com/x#part', title: 'A page', at: 2 })
  queue = recordVisit(queue, { url: 'ron://home', title: 'Home', at: 3 })
  queue = recordVisit(queue, { url: 'https://b.com/', title: 'B', at: 4 })
  assert.deepEqual(queue, [{ url: 'https://a.com/x', title: 'A page', at: 1 }, { url: 'https://b.com/', title: 'B', at: 4 }])
  const full = Array.from({ length: 45 }, (_, i) => ({ url: `https://s.com/${i}`, title: `${i}`, at: i })).reduce((q, v) => recordVisit(q, v), [] as ReturnType<typeof recordVisit>)
  assert.equal(full.length, 40)
  assert.equal(full[0].url, 'https://s.com/5')
})

test('browsingDue fires at five pages or after the oldest page waited three minutes', () => {
  const visits = (n: number, at = 0) => Array.from({ length: n }, (_, i) => ({ url: `https://x.com/${i}`, title: '', at }))
  assert.equal(browsingDue([], 10 ** 9), false)
  assert.equal(browsingDue(visits(4), 60_000), false)
  assert.equal(browsingDue(visits(5), 0), true)
  assert.equal(browsingDue(visits(1), 3 * 60_000), true)
})

test('turns name the pages, the item and the current graph', () => {
  const graph = [{ label: 'Formula 1', weight: 0.8 }]
  const browsing = browsingTurn([{ url: 'https://f1.com/', title: 'Race preview', at: Date.UTC(2026, 10, 6, 9, 5) }], graph)
  assert.match(browsing, /^\[browsing\]\n/)
  assert.match(browsing, /- 09:05 Race preview — https:\/\/f1\.com\//)
  assert.match(browsing, /Current interest graph: Formula 1 \(0\.80\)/)
  assert.match(browsingTurn([], []), /Current interest graph: \(empty\)/)
  const added = contextAddedTurn(item, graph)
  assert.match(added, /^\[context added\] link: Tokio\nSource: https:\/\/tokio\.rs\/\nExcerpt: Async runtime/)
  assert.match(approveAgentTurn({ id: 'rec-1', name: 'Briefer', description: '', interest: 'F1', rationale: '', tools: [], skills: [] }), /^\[approve_agent rec-1\] Build "Briefer" now\./)
})

const tool = (name: string, output: unknown, status = 'success'): PanelMessage['parts'][number] =>
  ({ kind: 'tool', key: name, path: [], name, toolUseId: name, input: {}, output, status, finished: true }) as unknown as PanelMessage['parts'][number]

test('contextResults reads the graph, recommendations and saved agents from tool results', () => {
  const messages = [{ id: 'm1', role: 'assistant', parts: [
    tool('update_interest_graph', [{ json: { interests: [{ label: 'Old', weight: 0.4, category: 'news', reason: '' }] } }]),
    tool('update_interest_graph', [{ json: { interests: [{ label: ' Formula 1 ', weight: 1.4, category: 'sport', reason: 'five pages' }, { label: '', weight: 0.5 }] } }]),
    tool('recommend_agent', [{ json: { agent_recommendation: { id: 'rec-a', name: 'Briefer', tools: ['brave_news_search', 3] } } }]),
    tool('recommend_agent', [{ text: 'failed' }], 'error'),
    tool('create_harness', [{ text: JSON.stringify({ id: 'u-1', name: 'Briefer' }) }]),
  ] }] as unknown as PanelMessage[]
  const results = contextResults(messages)
  assert.deepEqual(results.interests, [{ label: 'Formula 1', weight: 1, category: 'other', reason: 'five pages' }])
  assert.deepEqual(results.recommendations.map((r) => [r.id, r.tools]), [['rec-a', ['brave_news_search']]])
  assert.deepEqual(results.created, ['Briefer'])
  assert.equal(interestsFromOutput([{ text: 'x' }]), null)
  assert.equal(recommendationFromOutput([{ json: { agent_recommendation: { name: 'no id' } } }]), null)
})

test('latestReply joins the last assistant text parts', () => {
  const state = { messages: [
    { id: '1', role: 'assistant', parts: [{ kind: 'text', text: 'old' }] },
    { id: '2', role: 'user', parts: [{ kind: 'text', text: 'q' }] },
    { id: '3', role: 'assistant', parts: [{ kind: 'text', text: 'Updated ' }, tool('x', []), { kind: 'text', text: 'graph.' }] },
  ] } as unknown as PanelState
  assert.equal(latestReply(state), 'Updated graph.')
})

test('discoverTopics leads with the strongest learned interests, then profile topics, deduplicated', () => {
  const nodes = [
    { label: 'Formula 1', weight: 0.9, source: 'browsing' },
    { label: 'AI', weight: 0.95, source: 'onboarding' },
    { label: 'Home espresso', weight: 0.6, source: 'browsing' },
    { label: 'Knitting', weight: 0.3, source: 'browsing' },
    { label: 'technology', weight: 0.7, source: 'browsing' },
  ]
  assert.deepEqual(discoverTopics(['Technology', 'AI', 'Design'], nodes), ['Formula 1', 'technology', 'Home espresso', 'AI', 'Design'])
  assert.deepEqual(discoverTopics(['A', 'B'], []), ['A', 'B'])
  assert.equal(discoverTopics(['1', '2', '3', '4', '5', '6'], nodes).length, 7)
})

test('searchMarkdown keeps the question, answers, citations and top results', () => {
  const markdown = searchMarkdown({ query: 'best grinder', turns: [{ question: 'best grinder', text: 'The Niche Zero.' }], answer: 'Also the DF64.',
    citations: [{ url: 'https://a.com', title: 'A' }], results: [{ url: 'https://b.com', title: 'B', snippet: 'quiet' }] })
  assert.equal(markdown, 'Search: best grinder\n\n## best grinder\n\nThe Niche Zero.\n\n## Ren\'s answer\n\nAlso the DF64.\n\n## Citations\n\n- [A](https://a.com)\n\n## Top results\n\n- [B](https://b.com) — quiet')
})

test('createContextClient speaks the /context API', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url.includes('/context/agents')) return new Response(JSON.stringify({ agents: [], sign_in_required: true }))
    if (init?.method === 'DELETE') return new Response(JSON.stringify({ deleted: 'x' }))
    if (url.endsWith('/context/items') || url.endsWith('/context/files')) return new Response(JSON.stringify({ item }))
    if (url.includes('/file?')) return new Response('bytes', { headers: { 'content-type': 'image/png' } })
    if (url.includes('/context/items/')) return new Response(JSON.stringify({ item, markdown: '# md' }))
    if (url.includes('/context/items?')) return new Response(JSON.stringify({ items: [item] }))
    return new Response(JSON.stringify({ detail: 'nope' }), { status: 404 })
  }) as typeof fetch
  const client = createContextClient('http://api/', 'u 1', fetcher)
  assert.deepEqual(await client.list(), [item])
  assert.equal(calls[0].url, 'http://api/context/items?user_id=u%201')
  await client.add({ kind: 'thread', sessionId: 'panel-1' })
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { user_id: 'u 1', kind: 'thread', title: '', text: '', url: '', session_id: 'panel-1' })
  await client.upload({ kind: 'screenshot', blob: new Blob(['x'], { type: 'image/jpeg' }), name: 'a.jpg' })
  const form = calls[2].init?.body as FormData
  assert.equal(form.get('kind'), 'screenshot')
  assert.equal((form.get('file') as File).name, 'a.jpg')
  assert.equal(await client.markdown(item.id), '# md')
  assert.equal(await (await client.fileBlob(item.id)).text(), 'bytes')
  assert.equal(calls.find((call) => call.url.includes('/file?'))?.init?.cache, 'no-cache')
  assert.equal(client.fileUrl(item.id), `http://api/context/items/${item.id}/file?user_id=u%201`)
  await client.remove(item.id)
  assert.deepEqual(await client.agents(), { agents: [], signInRequired: true })
  const failing = createContextClient('http://api', 'u', (async () => new Response(JSON.stringify({ detail: 'Context needs text or a URL' }), { status: 422 })) as typeof fetch)
  await assert.rejects(failing.add({ kind: 'note' }), /Context needs text or a URL/)
})

test('dataUrlBlob and formatBytes', async () => {
  const blob = dataUrlBlob('data:image/jpeg;base64,/9j/AA==')
  assert.equal(blob.type, 'image/jpeg')
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [0xff, 0xd8, 0xff, 0x00])
  assert.throws(() => dataUrlBlob('https://x'), /Not a data URL/)
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB')
})

test('agentServesInterest matches the interest an agent was built for or names as a whole word', () => {
  const f1 = { id: 'a', name: 'F1 2026 Briefing', description: 'Tracks 2026 F1 news', a2a_url: '', config: { instructions: 'You serve a Formula 1 fan.' } }
  assert.equal(agentServesInterest(f1, 'Formula 1'), true)
  assert.equal(agentServesInterest(f1, 'Home espresso'), false)
  assert.equal(agentServesInterest(f1, 'F'), false)
  assert.equal(agentServesInterest({ ...f1, config: {} }, 'Formula 1'), false)
  assert.equal(agentServesInterest({ ...f1, config: {} }, 'formula 1', 'Formula 1'), true)
  assert.equal(agentServesInterest(f1, 'C++ (lang)'), false)
  assert.equal(agentServesInterest(f1, '  '), false)
})
