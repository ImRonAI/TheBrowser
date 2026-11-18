import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_FORMATION_TOPOLOGY,
  DeepResearchSSEParser,
  cancelDeepResearchRun,
  deleteDeepResearchRun,
  emptyDeepResearchSnapshot,
  fetchDeepResearchStatus,
  fetchReportDocument,
  getDeepResearchRun,
  listDeepResearchRuns,
  normalizeDeepResearchSnapshot,
  normalizeFormationTopology,
  parseResearchUrl,
  reduceDeepResearchEvent,
  researchUrl,
  resolveResearchArtifactUrl,
  saveReportDocument,
  startDeepResearchRun,
  streamDeepResearchEvents,
  type DeepResearchEvent,
  type DeepResearchSnapshot,
} from './deep-research-api.ts'

type StreamEvent = DeepResearchEvent['event']

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** `event` as the outer graph streams it from inside the nodes on `path`. */
function at(path: readonly string[], event: StreamEvent): StreamEvent {
  return path.reduceRight<StreamEvent>((inner, nodeId) => ({ type: 'multiagent_node_stream', node_id: nodeId, event: inner }), event)
}

function run(events: StreamEvent[], from = emptyDeepResearchSnapshot('dr-1')): DeepResearchSnapshot {
  return events.reduce(
    (state, event, index) => reduceDeepResearchEvent(state, { sequence: from.sequence + index + 1, event }),
    from,
  )
}

const meta = {
  session_id: 'dr-101',
  user_id: 'user-7',
  query: 'Solid-state battery supply chain 2026',
  context: 'Focus on electrolyte scaling',
  title: 'Solid-state battery supply chain 2026',
  depth: 'ultra',
  status: 'running',
  active: true,
  created_at: '2026-11-17T10:00:00Z',
  updated_at: '2026-11-17T10:00:00Z',
  completed_at: null,
  selection: { provider: 'telnyx', model_id: 'moonshotai/Kimi-K3.1-Pro', reasoning_effort: null },
  error: null,
}

test('parseResearchUrl and researchUrl round-trip internal research addresses', () => {
  assert.deepEqual(parseResearchUrl('ron://research'), { sessionId: null })
  assert.deepEqual(parseResearchUrl('ron://research/'), { sessionId: null })
  assert.deepEqual(parseResearchUrl('ron://research/dr-session-42'), { sessionId: 'dr-session-42' })
  assert.deepEqual(parseResearchUrl('ron://research/dr%2Fencoded-99/?view=trace'), { sessionId: 'dr/encoded-99' })
  assert.equal(parseResearchUrl('ron://home'), null)
  assert.equal(parseResearchUrl('https://example.com/research'), null)
  assert.equal(parseResearchUrl(null), null)

  assert.equal(researchUrl(), 'ron://research')
  assert.equal(researchUrl('  '), 'ron://research')
  assert.equal(researchUrl('dr/encoded 99'), 'ron://research/dr%2Fencoded%2099')
})

test('the REST helpers call /deep-research/* and read the run back', async () => {
  const calls: { url: string; method: string; body: string }[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : '' })
    if (url.endsWith('/deep-research/status')) {
      return jsonResponse({ available: true, default_selection: meta.selection, depths: ['high'], topology: DEFAULT_FORMATION_TOPOLOGY })
    }
    if (url.endsWith('/deep-research/runs') && method === 'POST') return jsonResponse(meta)
    if (url.includes('/deep-research/runs?')) return jsonResponse({ runs: [{ ...meta, status: 'completed', active: false }] })
    if (url.includes('/runs/dr-101/cancel')) return jsonResponse({ ...meta, status: 'cancelled', active: false })
    if (url.includes('/runs/dr-101?') && method === 'GET') {
      return jsonResponse({
        ...meta,
        status: 'completed',
        active: false,
        events: [{ type: 'multiagent_node_start', node_id: 'research_swarm', node_type: 'multiagent' }],
        files: ['report.md', 'report.pdf', 'slides.md', 'slides/index.html', 'slides.pdf'],
        report_markdown: '# Dossier',
        slidev_markdown: '# Deck',
      })
    }
    if (url.includes('/runs/dr-101/document?') && method === 'GET') {
      return jsonResponse({ title: 'Dossier', content: '<p>Costs fell[1].</p>', document_id: null })
    }
    if (url.includes('/runs/dr-101/document?') && method === 'POST') {
      return jsonResponse({ ...meta, status: 'completed', active: false, document_id: 'doc-9' })
    }
    if (url.includes('/runs/dr-101?') && method === 'DELETE') return jsonResponse({ deleted: true })
    return jsonResponse({ detail: 'Not found' }, 404)
  }
  const options = { baseUrl: 'http://localhost:8765/', fetcher }

  const status = await fetchDeepResearchStatus(options)
  assert.equal(status.available, true)
  assert.equal(status.default_selection.provider, 'telnyx')
  assert.deepEqual(status.depths, ['high'])
  assert.deepEqual(status.topology, DEFAULT_FORMATION_TOPOLOGY)

  const started = await startDeepResearchRun(
    { query: '  Solid-state battery supply chain 2026  ', user_id: 'user-7', depth: 'ultra', context: ' Focus ' },
    options,
  )
  assert.deepEqual([started.session_id, started.depth, started.status, started.active], ['dr-101', 'ultra', 'running', true])
  assert.deepEqual(JSON.parse(calls[1].body), {
    query: 'Solid-state battery supply chain 2026',
    user_id: 'user-7',
    depth: 'ultra',
    context: 'Focus',
    provider: null,
    model_id: null,
    reasoning_effort: null,
  })

  const runs = await listDeepResearchRuns('user-7', options)
  assert.deepEqual(runs.map((item) => [item.session_id, item.status]), [['dr-101', 'completed']])
  assert.match(calls[2].url, /user_id=user-7&limit=50$/)

  const opened = await getDeepResearchRun('dr-101', 'user-7', options)
  assert.equal(opened.nodes.research_swarm.status, 'executing')
  assert.equal(opened.report_markdown, '# Dossier')
  assert.deepEqual(opened.artifacts, {
    report_pdf_url: '/deep-research/runs/dr-101/artifacts/report.pdf',
    report_markdown_url: '/deep-research/runs/dr-101/artifacts/report.md',
    slidev_preview_url: '/deep-research/runs/dr-101/artifacts/slides/',
    slidev_pdf_url: '/deep-research/runs/dr-101/artifacts/slides.pdf',
    slidev_markdown_url: '/deep-research/runs/dr-101/artifacts/slides.md',
  })

  // A cancel answers the run's meta; the events folded so far stay.
  const cancelled = await cancelDeepResearchRun('dr-101', 'user-7', options, opened)
  assert.deepEqual([cancelled.status, cancelled.active], ['cancelled', false])
  assert.equal(cancelled.nodes.research_swarm.status, 'executing')
  assert.equal(cancelled.report_markdown, '# Dossier')

  // The report as a Document page, and the page it was saved as on the run.
  assert.deepEqual(await fetchReportDocument('dr-101', 'user-7', options), {
    title: 'Dossier',
    content: '<p>Costs fell[1].</p>',
    document_id: null,
  })
  assert.equal(opened.document_id, null)
  const saved = await saveReportDocument('dr-101', 'doc-9', 'user-7', options, opened)
  assert.deepEqual(JSON.parse(calls[calls.length - 1].body), { document_id: 'doc-9' })
  assert.equal(saved.document_id, 'doc-9')
  assert.equal(saved.report_markdown, '# Dossier')

  await deleteDeepResearchRun('dr-101', 'user-7', options)
  assert.equal(calls[calls.length - 1].method, 'DELETE')

  await assert.rejects(getDeepResearchRun('dr-404', 'user-7', options), /HTTP 404: Not found/)
})

test('the SSE parser takes any chunk split and streamDeepResearchEvents ends on the run frame', async () => {
  const frames = [
    'id: 1\ndata: {"type":"multiagent_node_start","node_id":"research_swarm","node_type":"multiagent"}\n\n',
    ': keep-alive\n\n',
    'id: 2\ndata: {"type":"multiagent_handoff","from_node_ids":["researcher"],"to_node_ids":["fact_checker"],"message":"Check it"}\n\n',
    `event: run\ndata: ${JSON.stringify({ ...meta, status: 'completed', active: false })}\n\n`,
  ].join('')

  const seen: DeepResearchEvent[] = []
  const runs: Record<string, unknown>[] = []
  const parser = new DeepResearchSSEParser((event) => seen.push(event), (value) => runs.push(value))
  for (let i = 0; i < frames.length; i += 7) parser.push(frames.slice(i, i + 7))
  parser.push('', true)
  assert.deepEqual(seen.map((event) => [event.sequence, event.event.type]), [
    [1, 'multiagent_node_start'],
    [2, 'multiagent_handoff'],
  ])
  assert.equal(runs[0].status, 'completed')

  const requested: string[] = []
  const fetcher: typeof fetch = async (input) => {
    requested.push(String(input))
    return new Response(frames, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  const streamed: number[] = []
  const result = await streamDeepResearchEvents('dr-101', 'user-7', {
    baseUrl: 'http://localhost:8765',
    fetcher,
    after: 0,
    onEvent: (event) => streamed.push(event.sequence),
  })
  assert.deepEqual(result, { finished: true, lastSequence: 2 })
  assert.deepEqual(streamed, [1, 2])
  assert.equal(requested[0], 'http://localhost:8765/deep-research/runs/dr-101/events?user_id=user-7&after=0')
})

test('reduceDeepResearchEvent folds the nested formations, handoffs and the result, once per event', () => {
  const swarm = ['research_swarm']
  const state = run([
    { type: 'multiagent_node_start', node_id: 'research_swarm', node_type: 'multiagent' },
    at(swarm, { type: 'multiagent_node_start', node_id: 'researcher', node_type: 'agent' }),
    at(swarm, { type: 'multiagent_handoff', from_node_ids: ['researcher'], to_node_ids: ['fact_checker'], message: 'Check the claims.' }),
    at(swarm, { type: 'multiagent_node_stop', node_id: 'researcher', node_result: { status: 'completed', execution_time: 4000 } }),
    at(swarm, { type: 'multiagent_node_start', node_id: 'fact_checker', node_type: 'agent' }),
    at(swarm, {
      type: 'multiagent_node_stop',
      node_id: 'fact_checker',
      node_result: { status: 'failed', execution_time: 10, result: { type: 'exception', message: 'Telnyx 403' } },
    }),
    {
      type: 'multiagent_node_stop',
      node_id: 'research_swarm',
      node_result: {
        status: 'failed',
        execution_time: 4100,
        result: {
          type: 'multiagent_result',
          status: 'failed',
          results: {
            fact_checker: { status: 'failed', execution_time: 10, result: { type: 'exception', message: 'Telnyx 403' } },
          },
        },
      },
    },
    {
      type: 'multiagent_result',
      result: {
        type: 'multiagent_result',
        status: 'failed',
        execution_time: 4200,
        accumulated_usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        results: {
          research_swarm: {
            status: 'failed',
            execution_time: 4100,
            result: {
              type: 'multiagent_result',
              status: 'failed',
              results: {
                fact_checker: { status: 'failed', execution_time: 10, result: { type: 'exception', message: 'Telnyx 403' } },
              },
            },
          },
        },
      },
    },
  ])

  assert.equal(state.sequence, 8)
  assert.equal(state.status, 'failed')
  assert.equal(state.error, 'Telnyx 403')
  assert.equal(state.nodes['research_swarm/researcher'].status, 'completed')
  assert.equal(state.nodes['research_swarm/researcher'].node_type, 'agent')
  assert.equal(state.nodes.research_swarm.node_type, 'swarm')
  assert.equal(state.nodes.research_swarm.error, 'Telnyx 403')
  assert.equal(state.nodes['research_swarm/fact_checker'].error, 'Telnyx 403')
  assert.deepEqual(state.completed_nodes, ['research_swarm/researcher'])
  assert.deepEqual(state.failed_nodes, ['research_swarm/fact_checker', 'research_swarm'])
  assert.deepEqual(state.execution_order, ['research_swarm', 'research_swarm/researcher', 'research_swarm/fact_checker'])
  assert.deepEqual(state.handoffs.map((h) => [h.from_node, h.to_node, h.message, h.node_path]), [
    ['researcher', 'fact_checker', 'Check the claims.', ['research_swarm']],
  ])
  assert.deepEqual(state.trace.map((entry) => entry.kind), ['node', 'node', 'handoff', 'node', 'node', 'node', 'node'])
  assert.deepEqual(state.active_node_path, [])
  assert.deepEqual(state.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 })
  assert.equal(state.execution_time_ms, 4200)

  // An event already folded is skipped: a reconnect that replays it changes nothing.
  assert.equal(reduceDeepResearchEvent(state, { sequence: 8, event: { type: 'multiagent_node_start', node_id: 'writing_swarm' } }), state)
})

test('a run is folded from its saved events, and a cancelled node keeps its message', () => {
  const snapshot = normalizeDeepResearchSnapshot({
    ...meta,
    status: 'cancelled',
    active: false,
    events: [
      { type: 'multiagent_node_start', node_id: 'research_swarm', node_type: 'multiagent' },
      { type: 'multiagent_node_cancel', node_id: 'research_swarm', message: 'Cancelled by the user.' },
    ],
    files: [],
  })
  assert.equal(snapshot.sequence, 2)
  assert.equal(snapshot.status, 'cancelled')
  assert.equal(snapshot.nodes.research_swarm.status, 'cancelled')
  assert.equal(snapshot.nodes.research_swarm.error, 'Cancelled by the user.')
  assert.deepEqual(snapshot.active_node_path, [])
  assert.equal(snapshot.artifacts.report_pdf_url, null)
  assert.equal(snapshot.selection.model_id, 'moonshotai/Kimi-K3.1-Pro')
})

test('resolveResearchArtifactUrl adds the user and the download flag; the topology falls back to the built-in one', () => {
  assert.equal(
    resolveResearchArtifactUrl('/deep-research/runs/dr-1/artifacts/report.pdf', 'user-7', { baseUrl: 'http://localhost:8765/' }),
    'http://localhost:8765/deep-research/runs/dr-1/artifacts/report.pdf?user_id=user-7',
  )
  assert.equal(
    resolveResearchArtifactUrl('deep-research/runs/dr-1/artifacts/slides.pdf', 'user-7', { baseUrl: 'http://localhost:8765', download: true }),
    'http://localhost:8765/deep-research/runs/dr-1/artifacts/slides.pdf?user_id=user-7&download=true',
  )
  assert.equal(resolveResearchArtifactUrl('  ', 'user-7'), null)

  assert.equal(normalizeFormationTopology({}), DEFAULT_FORMATION_TOPOLOGY)
  assert.equal(normalizeFormationTopology({ nodes: [{ id: 'x', kind: 'nope' }] }), DEFAULT_FORMATION_TOPOLOGY)
  const custom = normalizeFormationTopology({ id: 'g', nodes: [{ id: 'only_agent', kind: 'agent' }], edges: [{ from: 'a' }] })
  assert.deepEqual(custom.nodes.map((node) => [node.id, node.label]), [['only_agent', 'Only Agent']])
  assert.deepEqual(custom.edges, [])
})
