import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BUILD_OUTCOMES,
  DEFAULT_FORMATION_TOPOLOGY,
  DeepResearchSSEParser,
  REPORT_OUTCOMES,
  SQUAD_OUTCOMES,
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
    { query: '  Solid-state battery supply chain 2026  ', user_id: 'user-7', depth: 'ultra', outcome: 'deck', context: ' Focus ' },
    options,
  )
  assert.deepEqual([started.session_id, started.depth, started.status, started.active], ['dr-101', 'ultra', 'running', true])
  assert.ok(calls[1])
  assert.deepEqual(JSON.parse(calls[1].body), {
    query: 'Solid-state battery supply chain 2026',
    user_id: 'user-7',
    depth: 'ultra',
    outcome: 'deck',
    context: 'Focus',
    provider: null,
    model_id: null,
    reasoning_effort: null,
  })

  const runs = await listDeepResearchRuns('user-7', options)
  assert.deepEqual(runs.map((item) => [item.session_id, item.status]), [['dr-101', 'completed']])
  assert.ok(calls[2])
  assert.match(calls[2].url, /user_id=user-7&limit=50$/)

  const opened = await getDeepResearchRun('dr-101', 'user-7', options)
  assert.ok(opened.nodes["research_swarm"])
  assert.equal(opened.nodes["research_swarm"].status, 'executing')
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
  assert.ok(cancelled.nodes["research_swarm"])
  assert.equal(cancelled.nodes["research_swarm"].status, 'executing')
  assert.equal(cancelled.report_markdown, '# Dossier')

  // The report as a Document page, and the page it was saved as on the run.
  assert.deepEqual(await fetchReportDocument('dr-101', 'user-7', options), {
    title: 'Dossier',
    content: '<p>Costs fell[1].</p>',
    document_id: null,
  })
  assert.equal(opened.document_id, null)
  const saved = await saveReportDocument('dr-101', 'doc-9', 'user-7', options, opened)
  const saveCall = calls[calls.length - 1]
  assert.ok(saveCall)
  assert.deepEqual(JSON.parse(saveCall.body), { document_id: 'doc-9' })
  assert.equal(saved.document_id, 'doc-9')
  assert.equal(saved.report_markdown, '# Dossier')

  await deleteDeepResearchRun('dr-101', 'user-7', options)
  const deleteCall = calls[calls.length - 1]
  assert.ok(deleteCall)
  assert.equal(deleteCall.method, 'DELETE')

  await assert.rejects(getDeepResearchRun('dr-404', 'user-7', options), /HTTP 404: Not found/)
})

test('the build outcomes come from the backend with their team, and a run carries the app it listed', async () => {
  const team = {
    id: 'deep_research_graph',
    label: 'Squad',
    kind: 'graph',
    nodes: [
      { id: 'research_swarm', label: 'Research Swarm', kind: 'swarm', children: [{ id: 'researcher', label: 'Researcher', kind: 'agent' }], edges: [] },
      {
        id: 'build_swarm',
        label: 'Build Swarm',
        kind: 'swarm',
        children: [{ id: 'app_builder', label: 'App Builder', kind: 'agent' }],
        edges: [],
      },
    ],
    edges: [{ from: 'research_swarm', to: 'build_swarm' }],
  }
  const application = {
    id: 'app-1a2b3c4d5e',
    name: 'Tide',
    kind: 'android',
    location: '/config/workspace/tide/app/build/outputs/apk/debug/app-debug.apk',
    description: 'Tide times for a saved beach.',
    created_at: 1795300000.5,
  }
  const built = { ...meta, outcome: 'mobile_app', status: 'completed', active: false }
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/deep-research/status')) {
      return jsonResponse({
        available: true,
        default_selection: meta.selection,
        depths: ['medium'],
        topology: DEFAULT_FORMATION_TOPOLOGY,
        outcomes: [...SQUAD_OUTCOMES, 'podcast'],
        topologies: { mobile_app: team, podcast: team },
      })
    }
    if (url.includes('/runs/dr-101/cancel')) return jsonResponse(built)
    if (init?.method === 'POST') return jsonResponse({ ...built, application: { ...application, kind: 'ios' } })
    return jsonResponse({ ...built, events: [], files: [], application, grid_json: '{"title": "Tides", "sheets": []}' })
  }
  const options = { baseUrl: 'http://localhost:8765/', fetcher }

  // The picker offers what the backend lists, and knows which of those OpenCode builds.
  const status = await fetchDeepResearchStatus(options)
  assert.deepEqual(status.outcomes, SQUAD_OUTCOMES)
  assert.deepEqual(BUILD_OUTCOMES, ['web_app', 'website', 'mobile_app'])
  assert.deepEqual(REPORT_OUTCOMES, ['report', 'deck'])
  assert.deepEqual(Object.keys(status.topologies), ['mobile_app'])
  assert.deepEqual(status.topologies.mobile_app?.nodes.map((node) => [node.id, node.kind]), [
    ['research_swarm', 'swarm'],
    ['build_swarm', 'swarm'],
  ])
  assert.deepEqual(status.topologies.mobile_app?.nodes[1]?.children?.map((node) => node.id), ['app_builder'])

  const opened = await getDeepResearchRun('dr-101', 'user-7', options)
  assert.equal(opened.outcome, 'mobile_app')
  assert.deepEqual(opened.application, { ...application })
  assert.equal(emptyDeepResearchSnapshot('dr-102').application, null)
  // A spreadsheet's run carries grid.json as its team wrote it.
  assert.equal(opened.grid_json, '{"title": "Tides", "sheets": []}')
  assert.equal(emptyDeepResearchSnapshot('dr-102').grid_json, '')

  // A meta without the app keeps the one the run had; an app of a kind Ren doesn't list is none.
  assert.deepEqual((await cancelDeepResearchRun('dr-101', 'user-7', options, opened)).application, application)
  assert.equal((await saveReportDocument('dr-101', 'doc-9', 'user-7', options, opened)).application, null)
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
  assert.deepEqual(seen.map((event) => [event.sequence, event.event["type"]]), [
    [1, 'multiagent_node_start'],
    [2, 'multiagent_handoff'],
  ])
  assert.ok(runs[0])
  assert.equal(runs[0]["status"], 'completed')

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
  const researcherNode = state.nodes['research_swarm/researcher']
  const swarmNode = state.nodes["research_swarm"]
  const factCheckerNode = state.nodes['research_swarm/fact_checker']
  assert.ok(researcherNode && swarmNode && factCheckerNode)
  assert.equal(researcherNode.status, 'completed')
  assert.equal(researcherNode.node_type, 'agent')
  assert.equal(swarmNode.node_type, 'swarm')
  assert.equal(swarmNode.error, 'Telnyx 403')
  assert.equal(factCheckerNode.error, 'Telnyx 403')
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
  assert.ok(snapshot.nodes["research_swarm"])
  assert.equal(snapshot.nodes["research_swarm"].status, 'cancelled')
  assert.equal(snapshot.nodes["research_swarm"].error, 'Cancelled by the user.')
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

test('backgrounded subagent and tool calls stay running on dispatch, stream live child events, and settle cleanly', () => {
  const path = ['research_swarm', 'researcher']
  const state = run([
    { type: 'multiagent_node_start', node_id: 'research_swarm', node_type: 'multiagent' },
    at(['research_swarm'], { type: 'multiagent_node_start', node_id: 'researcher', node_type: 'agent' }),
    // Researcher dispatches subagent in background
    at(path, {
      message: {
        role: 'assistant',
        content: [{ toolUse: { toolUseId: 'sub-1', name: 'subagent', input: { task: 'Fetch benchmark numbers' } } }],
      },
    }),
    at(path, {
      message: {
        role: 'user',
        content: [{ toolResult: { toolUseId: 'sub-1', status: 'success', content: [{ text: 'Background task dispatched.\n\nTask ID: bg-sub-1\nTool: subagent\nStatus: working' }] } }],
      },
    }),
    // Inside sub-1, child dispatches a background olostep_scrape_website, which stays running on dispatch ack, then is cancelled
    at(path, {
      tool_stream_event: {
        tool_use: { toolUseId: 'sub-1', name: 'subagent', input: { task: 'Fetch benchmark numbers' } },
        data: {
          message: {
            role: 'assistant',
            content: [{ toolUse: { toolUseId: 'scr-1', name: 'olostep_scrape_website', input: { url_to_scrape: 'https://hung.example', _background_execution: true } } }],
          },
        },
      },
    }),
    at(path, {
      tool_stream_event: {
        tool_use: { toolUseId: 'sub-1', name: 'subagent', input: { task: 'Fetch benchmark numbers' } },
        data: {
          message: {
            role: 'user',
            content: [{ toolResult: { toolUseId: 'scr-1', status: 'success', content: [{ text: 'Background task dispatched.\n\nTask ID: bg-scr-1\nTool: olostep_scrape_website\nStatus: working' }] } }],
          },
        },
      },
    }),
    at(path, {
      tool_stream_event: {
        tool_use: { toolUseId: 'sub-1', name: 'subagent', input: { task: 'Fetch benchmark numbers' } },
        data: {
          message: {
            role: 'assistant',
            content: [{ toolUse: { toolUseId: 'bg-scr-1', name: 'strands_manage_background_task', input: { mode: 'get', task_id: 'bg-scr-1' } } }],
          },
        },
      },
    }),
    at(path, {
      tool_stream_event: {
        tool_use: { toolUseId: 'sub-1', name: 'subagent', input: { task: 'Fetch benchmark numbers' } },
        data: {
          message: {
            role: 'user',
            content: [{ toolResult: { toolUseId: 'bg-scr-1', status: 'success', content: [{ json: { task_id: 'bg-scr-1', tool_use_id: 'scr-1', status: 'cancelled', error: { type: 'cancelled', message: 'Cancelled hung scrape' } } }] } }],
          },
        },
      },
    }),
    at(path, {
      tool_stream_event: {
        tool_use: { toolUseId: 'sub-1', name: 'subagent', input: { task: 'Fetch benchmark numbers' } },
        data: { data: 'Threshold is 1.0%.' },
      },
    }),
    // Parent Researcher receives sub-1 synthetic settlement
    at(path, {
      message: {
        role: 'assistant',
        content: [{ toolUse: { toolUseId: 'bg-sub-1', name: 'strands_manage_background_task', input: { mode: 'get', task_id: 'bg-sub-1' } } }],
      },
    }),
    at(path, {
      message: {
        role: 'user',
        content: [{ toolResult: { toolUseId: 'bg-sub-1', status: 'success', content: [{ json: { task_id: 'bg-sub-1', tool_use_id: 'sub-1', status: 'completed' } }, { text: 'Threshold is 1.0%.' }] } }],
      },
    }),
  ])

  const researcher = state.nodes['research_swarm/researcher']
  assert.ok(researcher)
  assert.equal(researcher.skill_invocations.length, 1)
  const sub = researcher.skill_invocations[0]
  assert.ok(sub)
  assert.equal(sub.id, 'sub-1')
  assert.equal(sub.status, 'completed')
  assert.equal(sub.output_text, 'Threshold is 1.0%.')
  assert.deepEqual(sub.tools.map((tc) => [tc.id, tc.status, tc.output]), [
    ['scr-1', 'failed', 'Cancelled hung scrape'],
  ])
})

test('deep research folds native _SubagentTool(background=True) spawn, subagent_id stream, recover, and [subagent-completed]', () => {
  const path = ['research_swarm', 'researcher']
  const state = run([
    { type: 'multiagent_node_start', node_id: 'research_swarm' },
    at(['research_swarm'], { type: 'multiagent_node_start', node_id: 'researcher' }),
    at(path, {
      message: {
        role: 'assistant',
        content: [{ toolUse: { toolUseId: 'call-1', name: 'subagent', input: { task: 'Gather filings' } } }],
      },
    }),
    at(path, {
      message: {
        role: 'user',
        content: [{ toolResult: { toolUseId: 'call-1', status: 'success', content: [{ json: { subagent_id: 'subagent-1111', status: 'running' } }] } }],
      },
    }),
    at(path, {
      tool_stream_event: {
        tool_use: { toolUseId: 'subagent-1111', name: 'subagent', input: { task: 'Gather filings', subagent_id: 'subagent-1111' } },
        data: { data: '10-K located. ' },
      },
    }),
    at(path, {
      message: {
        role: 'user',
        content: [{ text: '[subagent-hangup] Background subagent hangup detected:\n[\n  {"subagent_id": "subagent-1111", "status": "running", "hangup_reason": "scraper stalled"}\n]' }],
      },
    }),
    at(path, {
      message: {
        role: 'assistant',
        content: [{ toolUse: { toolUseId: 'call-rec', name: 'subagent', input: { action: 'recover', subagent_id: 'subagent-1111', task: 'Use custom EDGAR tool' } } }],
      },
    }),
    at(path, {
      message: {
        role: 'user',
        content: [{ toolResult: { toolUseId: 'call-rec', status: 'success', content: [{ json: { recovered_from: 'subagent-1111', subagent_id: 'subagent-2222', status: 'running' } }] } }],
      },
    }),
    at(path, {
      tool_stream_event: {
        tool_use: { toolUseId: 'subagent-2222', name: 'subagent', input: { task: 'Use custom EDGAR tool', subagent_id: 'subagent-2222' } },
        data: { data: 'Revenue verified.' },
      },
    }),
    at(path, {
      message: {
        role: 'user',
        content: [{ text: '[subagent-completed] Background subagent(s) finished:\n[\n  {"subagent_id": "subagent-2222", "status": "completed", "result": "10-K located. Revenue verified."}\n]' }],
      },
    }),
  ])

  const researcher = state.nodes['research_swarm/researcher']
  assert.ok(researcher)
  assert.equal(researcher.skill_invocations.length, 1)
  const sub = researcher.skill_invocations[0]
  assert.ok(sub)
  assert.equal(sub.id, 'call-1')
  assert.equal(sub.subagent_id, 'subagent-2222')
  assert.equal(sub.status, 'completed')
  assert.equal(sub.output_text, '10-K located. Revenue verified.')
})

test('Deep Research HTTP requests attach no default timeout AbortSignal', async () => {
  const capturedInits: Array<RequestInit | undefined> = []
  const fetcher: typeof fetch = async (_input, init) => {
    capturedInits.push(init)
    return jsonResponse({ enabled: true, configured: true, topology: DEFAULT_FORMATION_TOPOLOGY })
  }

  await fetchDeepResearchStatus({ baseUrl: 'http://127.0.0.1:8765', fetcher })
  assert.equal(capturedInits.length, 1)
  assert.equal(capturedInits[0]?.signal, undefined)

  const controller = new AbortController()
  await fetchDeepResearchStatus({ baseUrl: 'http://127.0.0.1:8765', fetcher, signal: controller.signal })
  assert.equal(capturedInits.length, 2)
  assert.equal(capturedInits[1]?.signal, controller.signal)
})
