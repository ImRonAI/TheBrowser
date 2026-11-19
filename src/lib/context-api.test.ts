import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agentServesInterest, agoLabel, approveAgentTurn, browsingDue, browsingTurn, cadenceLabel, contextAddedTurn, contextResults, createContextClient, dataUrlBlob, defaultCadence, discoverTopics, dreamTime, dreamTopicLabel,
  formatBytes, hasPhoneActivity, interestsFromOutput, isObservable, latestReply, notificationTurn, phoneTurn, plainSummary, recommendationFromOutput, recordVisit, reviewDue, reviewTurn, runErrorLine, runHeadline, runNotifications, runStatusLabel,
  searchMarkdown, sendReplyTurn, TWICE_DAILY_MS,
  type AgentRun, type ContextItem,
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
  assert.match(approveAgentTurn({ id: 'rec-1', kind: 'agent', name: 'Briefer', description: '', interest: 'F1', rationale: '', tools: [], skills: [] }), /^\[approve_agent rec-1\] Build "Briefer" now\./)
  assert.match(approveAgentTurn({ id: 'rec-2', kind: 'web', name: 'Tides', description: '', interest: 'Surf', rationale: '', tools: [], skills: [] }), /^\[approve_app rec-2\] Build the web app "Tides" now\./)
  assert.match(approveAgentTurn({ id: 'rec-3', kind: 'project', key: 'AHM', name: 'Austin Half', description: '', interest: 'Running', rationale: '', tools: [], skills: [], issues: ['Sign up'] }), /^\[approve_project rec-3\] Create the project "Austin Half" now\./)
})

test('searches, chats, notifications, reply drafts and twice-daily reviews format and parse cleanly', () => {
  const at = Date.UTC(2026, 10, 17, 14, 30)
  assert.equal(browsingDue([], at + 60_000, 5, 3 * 60_000, [{ query: 'austin half marathon', at }], []), false)
  assert.equal(browsingDue([], at + 3 * 60_000, 5, 3 * 60_000, [{ query: 'austin half marathon', at }], []), true)
  const mixed = browsingTurn([], [{ label: 'Running', weight: 0.7 }],
    [{ query: 'austin half marathon', summary: 'Feb 15 course map', at }],
    [{ channel: 'panel', user: 'Can Dana run with me?', assistant: 'Yes, registration is open.', at }])
  assert.match(mixed, /Searches the user ran:\n- 14:30 "austin half marathon" — Feb 15 course map/)
  assert.match(mixed, /Chats and user responses:\n- 14:30 \[panel\] User: Can Dana run with me\? \| Ren: Yes, registration is open\./)

  const notif = notificationTurn({
    key: '0|com.whatsapp|7', app: 'WhatsApp', package: 'com.whatsapp', title: 'Dana Kim',
    text: 'Saturday 7am trail run?', at: '2026-11-17T14:32:00Z', can_reply: true, number: '+18015550100',
    messages: [{ from: 'Dana Kim', text: 'Saturday 7am trail run?', at: '14:32' }],
  }, [{ label: 'Running', weight: 0.7 }])
  assert.match(notif, /^\[notification\] App: WhatsApp \(com\.whatsapp\)/)
  assert.match(notif, /notification_key=0\|com\.whatsapp\|7, number=\+18015550100/)
  assert.match(notif, /Recent thread:\n- Dana Kim: Saturday 7am trail run\?/)

  const send = sendReplyTurn({
    id: 'rpl-1', sender: 'Dana Kim', app: 'WhatsApp', incoming: 'Saturday 7am?',
    draft: '7am works!', notification_key: '0|com.whatsapp|7', to: '+18015550100',
  }, '7am works — see you at the trailhead!')
  assert.match(send, /^\[send_reply rpl-1\].*phone_request_approval/s)
  assert.match(send, /7am works — see you at the trailhead!/)

  assert.equal(reviewDue(0, false, TWICE_DAILY_MS * 2), false)
  assert.equal(reviewDue(1000, true, 1000 + TWICE_DAILY_MS - 1), false)
  assert.equal(reviewDue(1000, true, 1000 + TWICE_DAILY_MS), true)
  assert.match(reviewTurn([{ label: 'Running', weight: 0.7 }], ['Pace Bot']), /^\[review\]\nTwice-daily review[\s\S]*Already recommended: Pace Bot/)

  const messages = [{ id: 'm2', role: 'assistant', parts: [
    tool('recommend_project', [{ json: { agent_recommendation: { id: 'rec-p', kind: 'project', key: 'AHM', name: 'Austin Half', issues: ['Register with Dana'] } } }]),
    tool('draft_reply', [{ json: { reply_draft: { id: 'rpl-9', sender: 'Dana Kim', app: 'WhatsApp', incoming: '7am?', draft: 'In!', notification_key: 'k1', to: '' } } }]),
    tool('create_project', [{ text: JSON.stringify({ id: 'p-1', name: 'Austin Half' }) }]),
  ] }] as unknown as PanelMessage[]
  const parsed = contextResults(messages)
  assert.equal(parsed.recommendations[0].kind, 'project')
  assert.deepEqual(parsed.recommendations[0].issues, ['Register with Dana'])
  assert.equal(parsed.replyDrafts[0].sender, 'Dana Kim')
  assert.deepEqual(parsed.createdProjects, ['Austin Half'])
})

const tool = (name: string, output: unknown, status = 'success'): PanelMessage['parts'][number] =>
  ({ kind: 'tool', key: name, path: [], name, toolUseId: name, input: {}, output, status, finished: true }) as unknown as PanelMessage['parts'][number]

test('contextResults reads the graph, recommendations and saved agents from tool results', () => {
  const messages = [{ id: 'm1', role: 'assistant', parts: [
    tool('update_interest_graph', [{ json: { interests: [{ label: 'Old', weight: 0.4, category: 'news', reason: '' }] } }]),
    tool('update_interest_graph', [{ json: { interests: [{ label: ' Formula 1 ', weight: 1.4, category: 'sport', reason: 'five pages' }, { label: '', weight: 0.5 }] } }]),
    tool('recommend_agent', [{ json: { agent_recommendation: { id: 'rec-a', name: 'Briefer', tools: ['brave_news_search', 3] } } }]),
    tool('recommend_agent', [{ text: 'failed' }], 'error'),
    tool('recommend_app', [{ json: { agent_recommendation: { id: 'rec-b', kind: 'android', name: 'Tide Log' } } }]),
    tool('create_harness', [{ text: JSON.stringify({ id: 'u-1', name: 'Briefer' }) }]),
  ] }] as unknown as PanelMessage[]
  const results = contextResults(messages)
  assert.deepEqual(results.interests, [{ label: 'Formula 1', weight: 1, category: 'other', reason: 'five pages' }])
  assert.deepEqual(results.recommendations.map((r) => [r.id, r.kind, r.tools]), [['rec-a', 'agent', ['brave_news_search']], ['rec-b', 'android', []]])
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

test('scheduled runs: cadence labels, notifications, plain summaries and headlines', () => {
  assert.equal(cadenceLabel({ every: 'hours', hours: 1, time: '08:00', weekday: 0, timezone: 'UTC' }), 'Every hour')
  assert.equal(cadenceLabel({ every: 'hours', hours: 6, time: '08:00', weekday: 0, timezone: 'UTC' }), 'Every 6 hours')
  assert.equal(cadenceLabel({ every: 'day', hours: 24, time: '08:00', weekday: 0, timezone: 'UTC' }, 'en-US'), 'Daily at 8:00 AM')
  assert.equal(cadenceLabel({ every: 'week', hours: 24, time: '18:30', weekday: 4, timezone: 'UTC' }, 'en-US'), 'Fridays at 6:30 PM')
  assert.deepEqual(defaultCadence('America/New_York'), { every: 'day', hours: 24, time: '08:00', weekday: 0, timezone: 'America/New_York' })

  const run = (id: string, patch: Partial<AgentRun>): AgentRun => ({ id, agent_id: 'a', agent_name: 'Scout', session_id: `agent-${id}`, trigger: 'schedule',
    status: 'completed', summary: '', error: '', started_at: '2026-11-13T08:00:00Z', finished_at: '2026-11-13T08:05:00Z', seen_at: null, ...patch })
  const runs = [
    run('running', { status: 'running', finished_at: null }),
    run('seen', { seen_at: '2026-11-13T09:00:00Z' }),
    run('older', { finished_at: '2026-11-13T08:01:00Z' }),
    run('newer', { status: 'failed', finished_at: '2026-11-13T08:30:00Z' }),
  ]
  assert.deepEqual(runNotifications(runs).map((entry) => entry.id), ['newer', 'older'])

  assert.equal(plainSummary('## Deals\n- **Niche Zero** at [$499](https://x.test)\n- `DF64`  restocked'), 'Deals Niche Zero at $499 DF64 restocked')
  // The provider error recorded by a real failed run (Gemini free-tier quota), shortened to its lead sentence.
  assert.equal(runErrorLine(`429 Too Many Requests. {'message': '{\\n  "error": {\\n    "code": 429, "message": "You exceeded your current quota"}}'}`), '429 Too Many Requests.')
  assert.equal(runErrorLine("The run's session could not be found."), "The run's session could not be found.")
  assert.equal(runHeadline({ status: 'completed', trigger: 'schedule' }), 'Finished its scheduled run')
  assert.equal(runHeadline({ status: 'completed', trigger: 'manual' }), 'Finished its run')
  assert.equal(runHeadline({ status: 'interrupted', trigger: 'schedule' }), 'Needs your answer')
  assert.equal(runStatusLabel('cancelled'), 'Stopped')
  const now = Date.parse('2026-11-13T12:00:00Z')
  assert.equal(agoLabel('2026-11-13T11:59:50Z', now), 'just now')
  assert.equal(agoLabel('2026-11-13T11:55:00Z', now), '5 min ago')
  assert.equal(agoLabel('2026-11-13T09:00:00Z', now), '3 h ago')
  assert.equal(agoLabel('2026-11-10T12:00:00Z', now), '3 d ago')
})

test('phoneTurn names all apps, sub-minute sessions, runtime logs, calls, SMS, notifications, calendar, reminders and graph', () => {
  const turn = phoneTurn({
    since: Date.UTC(2026, 10, 15, 8, 0), until: Date.UTC(2026, 10, 15, 9, 30),
    apps: [{ name: 'Strava', minutes: 42 }, { name: 'WhatsApp', package: 'com.whatsapp', minutes: 0, seconds: 38, opens: 3 }],
    actions: [{ kind: 'device', text: 'sms_send: {"sent":true,"to":"+18015550100"}', at: Date.UTC(2026, 10, 15, 9, 5) }],
    calls: [{ kind: 'incoming', number: '+18015550100', name: 'Dana Kim', seconds: 195, at: '2026-11-15T08:40' }],
    sms: [{ from: 'Dana Kim', number: '+18015550100', contact: 'Dana Kim', text: 'Trailhead at 7?', at: '2026-11-15T08:45', unread: false }],
    notifications: [{ key: 'k1', app: 'Slack', package: 'com.Slack', title: '#launch', text: 'Ship beta', at: '2026-11-15T08:50', can_reply: true }],
    events: [{ title: 'Half Marathon', start: '2026-11-16T07:00', end: '2026-11-16T10:00', location: 'Austin' }],
    reminders: [{ id: 'r1', text: 'Pack gels', at: '2026-11-15T20:00' }],
    device: { battery_percent: 82, charging: true, network: 'wifi' },
  }, [{ label: 'Running', weight: 0.5 }])
  assert.match(turn, /^\[phone\]\nThe user's phone from 2026-11-15 08:00 to 2026-11-15 09:30 UTC\./)
  assert.match(turn, /Device status: battery 82% \(charging\), network: wifi/)
  assert.match(turn, /- Strava — 42 min/)
  assert.match(turn, /- WhatsApp \(com\.whatsapp\) — 38s, 3 opens/)
  assert.match(turn, /- 2026-11-15 09:05 \[device\] sms_send: \{"sent":true,"to":"\+18015550100"\}/)
  assert.match(turn, /Call log:\n- 2026-11-15T08:40 \[incoming\] Dana Kim \(\+18015550100\) — 195s/)
  assert.match(turn, /SMS \/ text messages:\n- 2026-11-15T08:45 Dana Kim \(\+18015550100\): Trailhead at 7\?/)
  assert.match(turn, /App notifications:\n- 2026-11-15T08:50 \[Slack \/ com\.Slack\] #launch: Ship beta/)
  assert.match(turn, /Calendar & reminders:\n- \[calendar\] 2026-11-16T07:00 – 2026-11-16T10:00 Half Marathon @ Austin\n- \[reminder r1\] 2026-11-15T20:00 Pack gels/)
  assert.match(turn, /Current interest graph: Running \(0\.50\)/)
  assert.equal(hasPhoneActivity({ since: 0, until: 0, apps: [], actions: [] }), false)
  assert.equal(hasPhoneActivity({ since: 0, until: 0, apps: [], actions: [], sms: [{ from: 'me', number: '+1801', text: 'Yo', at: 'now' }] }), true)
  assert.match(phoneTurn({ since: 0, until: 0, apps: [], actions: [] }, []), /\(none\)[\s\S]*\(nothing\)/)
})

test('a dream notice names each topic by its heading and the agent whose folder it is in, and sends the checklist', async () => {
  assert.equal(dreamTime('20261117T201500123456'), '2026-11-17T20:15:00Z')
  assert.deepEqual(dreamTopicLabel({ key: 'memory/brain/panel/travel.md', text: '# Travel plans\nFlies from SLC.' }), { title: 'Travel plans', agent: 'panel' })
  assert.deepEqual(dreamTopicLabel({ key: 'memory/brain/search-page/old-flights.md', text: null }), { title: 'old flights', agent: 'search-page' })
  const sent: { url: string; body: string }[] = []
  const fetcher = (async (url: string, init?: RequestInit) => {
    sent.push({ url, body: String(init?.body ?? '') })
    return new Response(JSON.stringify(url.includes('?') ? { dream: null } : { reviewed: 'v' }), { status: 200 })
  }) as typeof fetch
  const client = createContextClient('http://api.test/', 'u 1', fetcher)
  assert.equal(await client.dream(), null)
  await client.reviewDream('20261117T201500123456', [{ key: 'memory/brain/panel/travel.md', right: false, comment: 'Ogden' }])
  assert.equal(sent[0].url, 'http://api.test/context/dream?user_id=u%201')
  assert.equal(sent[1].url, 'http://api.test/context/dream/20261117T201500123456')
  assert.deepEqual(JSON.parse(sent[1].body), { user_id: 'u 1', topics: [{ key: 'memory/brain/panel/travel.md', right: false, comment: 'Ogden' }] })
})
