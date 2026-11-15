import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_FORMATION_TOPOLOGY,
  DeepResearchReplayOverflow,
  DeepResearchSSEParser,
  cancelDeepResearchRun,
  deleteDeepResearchRun,
  emptyDeepResearchSnapshot,
  fetchDeepResearchStatus,
  getDeepResearchRun,
  listDeepResearchRuns,
  normalizeDeepResearchSnapshot,
  parseResearchUrl,
  reduceDeepResearchEvent,
  researchUrl,
  resolveResearchArtifactUrl,
  startDeepResearchRun,
  streamDeepResearchEvents,
  type DeepResearchEvent,
} from './deep-research-api.ts'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

test('parseResearchUrl and researchUrl round-trip internal research addresses', () => {
  assert.deepEqual(parseResearchUrl('ron://research'), { sessionId: null })
  assert.deepEqual(parseResearchUrl('ron://research/'), { sessionId: null })
  assert.deepEqual(parseResearchUrl('ron://research/dr-session-42'), { sessionId: 'dr-session-42' })
  assert.deepEqual(parseResearchUrl('ron://research/dr%2Fencoded-99/?view=trace'), { sessionId: 'dr/encoded-99' })
  assert.equal(parseResearchUrl('ron://home'), null)
  assert.equal(parseResearchUrl('ron://documents/abc'), null)
  assert.equal(parseResearchUrl('https://example.com/research'), null)
  assert.equal(parseResearchUrl(null), null)
  assert.equal(parseResearchUrl(undefined), null)

  assert.equal(researchUrl(), 'ron://research')
  assert.equal(researchUrl(null), 'ron://research')
  assert.equal(researchUrl('  '), 'ron://research')
  assert.equal(researchUrl('dr-session-42'), 'ron://research/dr-session-42')
  assert.equal(researchUrl('dr/encoded 99'), 'ron://research/dr%2Fencoded%2099')
})

test('REST client helpers hit /deep-research/* endpoints and normalize payloads', async () => {
  const calls: { url: string; method: string; body?: string }[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? init.body : undefined
    calls.push({ url, method, body })

    if (url.endsWith('/deep-research/status')) {
      return jsonResponse({
        available: true,
        default_selection: { provider: 'gemini', model_id: 'gemini-3.8-pro-preview', reasoning_effort: 'high' },
        depths: ['standard', 'deep', 'exhaustive'],
        topology: DEFAULT_FORMATION_TOPOLOGY,
      })
    }
    if (url.endsWith('/deep-research/runs') && method === 'POST') {
      return jsonResponse({
        version: 1,
        session_id: 'dr-101',
        user_id: 'user-7',
        query: 'Solid-state battery supply chain 2026',
        title: 'Solid-state battery supply chain 2026',
        depth: 'exhaustive',
        status: 'executing',
        active: true,
        sequence: 1,
        replay_after: 1,
      })
    }
    if (url.includes('/deep-research/runs?')) {
      return jsonResponse({
        runs: [
          {
            session_id: 'dr-101',
            user_id: 'user-7',
            query: 'Solid-state battery supply chain 2026',
            status: 'completed',
            active: false,
            citations: [{ url: 'https://example.com/a', title: 'Report A', snippet: 'Key metric' }],
          },
        ],
      })
    }
    if (url.includes('/deep-research/runs/dr-101/cancel')) {
      return jsonResponse({
        session_id: 'dr-101',
        user_id: 'user-7',
        status: 'cancelled',
        active: false,
      })
    }
    if (url.includes('/deep-research/runs/dr-101') && method === 'GET') {
      return jsonResponse({
        session_id: 'dr-101',
        user_id: 'user-7',
        query: 'Solid-state battery supply chain 2026',
        status: 'completed',
        active: false,
        report_markdown: '# Executive Dossier\n\nVerified findings.',
      })
    }
    if (url.includes('/deep-research/runs/dr-101') && method === 'DELETE') {
      return jsonResponse({ deleted: true, session_id: 'dr-101' })
    }
    return jsonResponse({ detail: 'Not found' }, 404)
  }) as typeof fetch

  const status = await fetchDeepResearchStatus({ baseUrl: 'http://localhost:8765/', fetcher })
  assert.equal(status.available, true)
  assert.equal(status.default_selection.provider, 'gemini')
  assert.equal(status.topology.nodes.length, 4)

  const started = await startDeepResearchRun(
    {
      query: '  Solid-state battery supply chain 2026  ',
      user_id: 'user-7',
      depth: 'exhaustive',
      context: 'Focus on electrolyte scaling bottlenecks',
    },
    { baseUrl: 'http://localhost:8765', fetcher },
  )
  assert.equal(started.session_id, 'dr-101')
  assert.equal(started.depth, 'exhaustive')
  assert.equal(started.active, true)
  const postBody = JSON.parse(calls[1].body || '{}')
  assert.equal(postBody.query, 'Solid-state battery supply chain 2026')
  assert.equal(postBody.context, 'Focus on electrolyte scaling bottlenecks')

  const runs = await listDeepResearchRuns('user-7', { baseUrl: 'http://localhost:8765', fetcher })
  assert.equal(runs.length, 1)
  assert.equal(runs[0].citations.length, 1)

  const hydrated = await getDeepResearchRun('dr-101', 'user-7', { baseUrl: 'http://localhost:8765', fetcher })
  assert.match(hydrated.report_markdown, /Executive Dossier/)

  const cancelled = await cancelDeepResearchRun('dr-101', 'user-7', { baseUrl: 'http://localhost:8765', fetcher })
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.active, false)

  const deleted = await deleteDeepResearchRun('dr-101', 'user-7', { baseUrl: 'http://localhost:8765', fetcher })
  assert.equal(deleted.deleted, true)
  assert.equal(deleted.session_id, 'dr-101')

  await assert.rejects(
    getDeepResearchRun('missing-id', 'user-7', { baseUrl: 'http://localhost:8765', fetcher }),
    /HTTP 404/,
  )
})

test('DeepResearchSSEParser and streamDeepResearchEvents handle arbitrary chunk splits and 410 overflow', async () => {
  const parsed: DeepResearchEvent[] = []
  const parser = new DeepResearchSSEParser((ev) => parsed.push(ev))

  const rawStream = [
    ': keepalive comment\r\n',
    'id: 1\r\n',
    'data: {"version":1,"session_id":"dr-1","type":"run_started","node_path":[],"query":"Fusion net gain"}\r\n\r\n',
    'id: 2\n',
    'event: node_start\n',
    'data: {"session_id":"dr-1","node_path":["planning_formation","problem_framing"]}\n\n',
    'id: 3\ndata: {"sequence":3,"session_id":"dr-1","type":"run_finished","node_path":[],"status":"completed","report_markdown":"# Done"}\n\n',
  ].join('')

  // Split every 13 characters to stress CR/LF and JSON frame boundaries.
  for (let i = 0; i < rawStream.length; i += 13) {
    parser.push(rawStream.slice(i, i + 13), false)
  }
  parser.push('', true)

  assert.equal(parsed.length, 3)
  assert.equal(parsed[0].sequence, 1)
  assert.equal(parsed[0].type, 'run_started')
  assert.equal(parsed[1].sequence, 2)
  assert.equal(parsed[1].type, 'node_start')
  assert.deepEqual(parsed[1].node_path, ['planning_formation', 'problem_framing'])
  assert.equal(parsed[2].type, 'run_finished')

  // FullReadableStream via streamDeepResearchEvents
  const encoder = new TextEncoder()
  const streamFetcher = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('after=999')) {
      return jsonResponse(
        { detail: { code: 'replay_overflow', message: 'Cursor too old', requested: 999, earliest: 10, latest: 25 } },
        410,
      )
    }
    if (url.includes('after=888')) {
      const overflowStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'event: replay_overflow\ndata: {"code":"replay_overflow","requested":888,"earliest":15,"latest":40,"resync_required":true}\n\n',
            ),
          )
          controller.close()
        },
      })
      return new Response(overflowStream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('id: 4\ndata: {"session_id":"dr-2","type":"text_delta","node_path":["synthesis_formation","executive_editor"],"delta":"Hello "}\n\n'))
        controller.enqueue(encoder.encode('id: 5\ndata: {"session_id":"dr-2","type":"run_finished","node_path":[],"status":"completed"}\n\n'))
        controller.close()
      },
    })
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch

  const received: DeepResearchEvent[] = []
  const result = await streamDeepResearchEvents('dr-2', 'u-1', {
    after: 3,
    baseUrl: 'http://localhost:8765',
    fetcher: streamFetcher,
    onEvent: (ev) => received.push(ev),
  })
  assert.equal(result.finished, true)
  assert.equal(result.lastSequence, 5)
  assert.equal(received.length, 2)

  await assert.rejects(
    streamDeepResearchEvents('dr-2', 'u-1', {
      after: 999,
      baseUrl: 'http://localhost:8765',
      fetcher: streamFetcher,
      onEvent: () => undefined,
    }),
    (err: unknown) => err instanceof DeepResearchReplayOverflow && err.earliest === 10,
  )

  await assert.rejects(
    streamDeepResearchEvents('dr-2', 'u-1', {
      after: 888,
      baseUrl: 'http://localhost:8765',
      fetcher: streamFetcher,
      onEvent: () => undefined,
    }),
    (err: unknown) => err instanceof DeepResearchReplayOverflow && err.earliest === 15 && err.latest === 40,
  )
})

test('reduceDeepResearchEvent folds 3-level nested formations, Swarm handoffs, use_skill subagents, and refinement loops', () => {
  let state = emptyDeepResearchSnapshot('dr-nested')
  const t = '2026-11-14T19:20:00Z'

  const events: DeepResearchEvent[] = [
    { sequence: 1, session_id: 'dr-nested', type: 'run_started', node_path: [], timestamp: t, query: 'Quantum error correction architectures', depth: 'deep' },
    { sequence: 2, session_id: 'dr-nested', type: 'node_start', node_path: ['investigation_formation'], node_type: 'graph', timestamp: t },
    { sequence: 3, session_id: 'dr-nested', type: 'node_start', node_path: ['investigation_formation', 'adversarial_swarm'], node_type: 'swarm', timestamp: t },
    {
      sequence: 4,
      session_id: 'dr-nested',
      type: 'node_start',
      node_path: ['investigation_formation', 'adversarial_swarm', 'hypothesis_explorer'],
      node_type: 'agent',
      timestamp: t,
    },
    {
      sequence: 5,
      session_id: 'dr-nested',
      type: 'skill_start',
      node_path: ['investigation_formation', 'adversarial_swarm', 'hypothesis_explorer'],
      skill_id: 'sk-1',
      skill_name: 'hypothesis-probing',
      task: 'Probe surface code vs LDPC logical qubit overhead',
      timestamp: t,
    },
    {
      sequence: 6,
      session_id: 'dr-nested',
      type: 'skill_tool',
      node_path: ['investigation_formation', 'adversarial_swarm', 'hypothesis_explorer'],
      skill_id: 'sk-1',
      tool_use_id: 'tu-1',
      tool_name: 'brave_web_search',
      input: { query: 'qLDPC vs surface code qubit overhead 2026' },
      status: 'completed',
      output_preview: 'Found 8 peer-reviewed preprints',
      timestamp: t,
    },
    {
      sequence: 7,
      session_id: 'dr-nested',
      type: 'skill_delta',
      node_path: ['investigation_formation', 'adversarial_swarm', 'hypothesis_explorer'],
      skill_id: 'sk-1',
      delta: 'qLDPC codes achieve 10x lower physical-to-logical ratio under non-local connectivity.',
      timestamp: t,
    },
    {
      sequence: 8,
      session_id: 'dr-nested',
      type: 'skill_stop',
      node_path: ['investigation_formation', 'adversarial_swarm', 'hypothesis_explorer'],
      skill_id: 'sk-1',
      status: 'completed',
      duration_ms: 1420,
      citations: [{ url: 'https://arxiv.org/abs/2401.00001', title: 'High-threshold qLDPC', snippet: '10x reduction' }],
      timestamp: t,
    },
    {
      sequence: 9,
      session_id: 'dr-nested',
      type: 'node_handoff',
      node_path: ['investigation_formation', 'adversarial_swarm'],
      from_node: 'hypothesis_explorer',
      to_node: 'contrarian_examiner',
      message: 'Challenge hardware routing feasibility for non-local couplers.',
      timestamp: t,
    },
    {
      sequence: 10,
      session_id: 'dr-nested',
      type: 'node_stop',
      node_path: ['investigation_formation', 'adversarial_swarm', 'hypothesis_explorer'],
      status: 'completed',
      execution_time_ms: 2100,
      timestamp: t,
    },
    {
      sequence: 11,
      session_id: 'dr-nested',
      type: 'node_stop',
      node_path: ['investigation_formation', 'adversarial_swarm'],
      status: 'completed',
      timestamp: t,
    },
    {
      sequence: 12,
      session_id: 'dr-nested',
      type: 'node_stop',
      node_path: ['investigation_formation'],
      status: 'completed',
      timestamp: t,
    },
    // Verification swarm triggers conditional refinement revisit of investigation_formation!
    {
      sequence: 13,
      session_id: 'dr-nested',
      type: 'node_start',
      node_path: ['investigation_formation'],
      node_type: 'graph',
      timestamp: t,
    },
    // Synthesis: report_drafter streams draft, then executive_editor supersedes with final polished report.
    {
      sequence: 14,
      session_id: 'dr-nested',
      type: 'text_delta',
      node_path: ['synthesis_formation', 'report_drafter'],
      delta: 'Draft text...',
      timestamp: t,
    },
    {
      sequence: 15,
      session_id: 'dr-nested',
      type: 'text_delta',
      node_path: ['synthesis_formation', 'executive_editor'],
      delta: '# Quantum Error Correction\n\n',
      timestamp: t,
    },
    {
      sequence: 16,
      session_id: 'dr-nested',
      type: 'text_delta',
      node_path: ['synthesis_formation', 'executive_editor'],
      delta: 'qLDPC architectures reduce overhead significantly [1].',
      timestamp: t,
    },
    // Duplicate citation URL with richer snippet should deduplicate cleanly
    {
      sequence: 17,
      session_id: 'dr-nested',
      type: 'citation',
      node_path: ['synthesis_formation', 'executive_editor'],
      url: 'https://arxiv.org/abs/2401.00001',
      title: 'High-threshold qLDPC',
      snippet: 'Detailed hardware couplers analysis',
      timestamp: t,
    },
    {
      sequence: 18,
      session_id: 'dr-nested',
      type: 'run_finished',
      node_path: [],
      status: 'completed',
      execution_time_ms: 9850,
      usage: { inputTokens: 4200, outputTokens: 1800, totalTokens: 6000 },
      timestamp: t,
    },
  ]

  for (const ev of events) {
    state = reduceDeepResearchEvent(state, ev)
  }

  // Replaying an earlier sequence is a strict no-op
  const afterDuplicate = reduceDeepResearchEvent(state, events[5])
  assert.equal(afterDuplicate, state)

  assert.equal(state.status, 'completed')
  assert.equal(state.active, false)
  assert.equal(state.refinement_count, 1)
  assert.equal(state.nodes['investigation_formation'].execution_count, 2)

  const leafKey = 'investigation_formation/adversarial_swarm/hypothesis_explorer'
  assert.ok(state.nodes[leafKey])
  assert.deepEqual(state.nodes[leafKey].skills_used, ['hypothesis-probing'])
  assert.equal(state.skill_invocations.length, 1)
  assert.equal(state.skill_invocations[0].status, 'completed')
  assert.equal(state.skill_invocations[0].tools.length, 1)
  assert.equal(state.skill_invocations[0].tools[0].tool_name, 'brave_web_search')

  assert.equal(state.handoffs.length, 1)
  assert.equal(state.handoffs[0].from_node, 'hypothesis_explorer')
  assert.equal(state.handoffs[0].to_node, 'contrarian_examiner')

  assert.equal(
    state.report_markdown,
    '# Quantum Error Correction\n\nqLDPC architectures reduce overhead significantly [1].',
  )
  assert.equal(state.citations.length, 1)
  assert.equal(state.citations[0].url, 'https://arxiv.org/abs/2401.00001')
  assert.equal(state.usage.totalTokens, 6000)
  assert.ok(state.trace.length >= 10)
})

test('reduceDeepResearchEvent handles node_cancel, node_interrupt, and error events', () => {
  let state = emptyDeepResearchSnapshot('dr-err')
  const t = '2026-11-14T19:25:00Z'

  state = reduceDeepResearchEvent(state, {
    sequence: 1,
    session_id: 'dr-err',
    type: 'node_interrupt',
    node_path: ['planning_formation', 'problem_framing'],
    reason: 'Awaiting policy check',
    timestamp: t,
  })
  assert.equal(state.status, 'interrupted')
  assert.equal(state.nodes['planning_formation/problem_framing'].status, 'interrupted')

  state = reduceDeepResearchEvent(state, {
    sequence: 2,
    session_id: 'dr-err',
    type: 'node_cancel',
    node_path: ['planning_formation', 'problem_framing'],
    reason: 'Research run cancelled',
    timestamp: t,
  })
  assert.equal(state.nodes['planning_formation/problem_framing'].status, 'cancelled')

  state = reduceDeepResearchEvent(state, {
    sequence: 3,
    session_id: 'dr-err',
    type: 'error',
    node_path: ['planning_formation'],
    error: 'Upstream provider timeout',
    timestamp: t,
  })
  assert.equal(state.error, 'Upstream provider timeout')
  assert.equal(state.nodes['planning_formation'].status, 'failed')
})

test('artifact_ready, slidev_markdown text_delta, and resolveResearchArtifactUrl handle PDF Report and Slidev Deck artifacts', () => {
  let state = emptyDeepResearchSnapshot('dr-artifacts')
  const t = '2026-11-14T19:30:00Z'

  state = reduceDeepResearchEvent(state, {
    sequence: 1,
    session_id: 'dr-artifacts',
    type: 'text_delta',
    node_path: ['synthesis_formation', 'slidev_designer'],
    delta: '---\ntheme: default\n---\n\n# Slide 1\n\n---\n\n# Slide 2',
    timestamp: t,
  })
  assert.match(state.slidev_markdown, /# Slide 1/)
  assert.equal(state.report_markdown, '')

  state = reduceDeepResearchEvent(state, {
    sequence: 2,
    session_id: 'dr-artifacts',
    type: 'artifact_ready',
    node_path: ['synthesis_formation', 'report_publisher'],
    artifact_type: 'report_pdf',
    url: '/deep-research/runs/dr-artifacts/artifacts/report.pdf',
    timestamp: t,
  })
  assert.equal(state.artifacts.report_pdf_url, '/deep-research/runs/dr-artifacts/artifacts/report.pdf')

  state = reduceDeepResearchEvent(state, {
    sequence: 3,
    session_id: 'dr-artifacts',
    type: 'artifact_ready',
    node_path: ['synthesis_formation', 'slidev_designer'],
    artifacts: {
      slidev_preview_url: '/deep-research/runs/dr-artifacts/artifacts/slides/index.html',
      slidev_pdf_url: '/deep-research/runs/dr-artifacts/artifacts/slides.pdf',
      slidev_markdown_url: '/deep-research/runs/dr-artifacts/artifacts/slides.md',
    },
    timestamp: t,
  })
  assert.equal(state.artifacts.slidev_preview_url, '/deep-research/runs/dr-artifacts/artifacts/slides/index.html')
  assert.equal(state.artifacts.slidev_pdf_url, '/deep-research/runs/dr-artifacts/artifacts/slides.pdf')
  assert.equal(state.artifacts.slidev_markdown_url, '/deep-research/runs/dr-artifacts/artifacts/slides.md')
  assert.ok(state.trace.some((entry) => entry.kind === 'artifact'))

  const hydrated = normalizeDeepResearchSnapshot({
    session_id: 'dr-artifacts',
    status: 'completed',
    slidev_markdown: '# Hydrated Slides',
    artifacts: {
      'report.pdf': '/deep-research/runs/dr-artifacts/artifacts/report.pdf',
      'slides/index.html': '/deep-research/runs/dr-artifacts/artifacts/slides/index.html',
    },
  })
  assert.equal(hydrated.slidev_markdown, '# Hydrated Slides')
  assert.equal(hydrated.artifacts.report_pdf_url, '/deep-research/runs/dr-artifacts/artifacts/report.pdf')
  assert.equal(hydrated.artifacts.slidev_preview_url, '/deep-research/runs/dr-artifacts/artifacts/slides/index.html')

  assert.equal(
    resolveResearchArtifactUrl(
      '/deep-research/runs/dr-artifacts/artifacts/report.pdf',
      'user-42',
      { baseUrl: 'http://localhost:8765/', download: true },
    ),
    'http://localhost:8765/deep-research/runs/dr-artifacts/artifacts/report.pdf?user_id=user-42&download=true',
  )
  assert.equal(
    resolveResearchArtifactUrl('/deep-research/runs/dr-artifacts/artifacts/report.pdf', 'user-42', 'http://localhost:8765/'),
    'http://localhost:8765/deep-research/runs/dr-artifacts/artifacts/report.pdf?user_id=user-42',
  )
  assert.equal(
    resolveResearchArtifactUrl(
      '/deep-research/runs/dr-artifacts/artifacts/slides/index.html#2',
      'user-42',
      'http://localhost:8765',
    ),
    'http://localhost:8765/deep-research/runs/dr-artifacts/artifacts/slides/index.html?user_id=user-42#2',
  )
  assert.equal(resolveResearchArtifactUrl(null), null)
})

test('reduceDeepResearchEvent keeps each agent and sub-agent transcript in order, with tool names and payloads', () => {
  const t = '2026-11-15T10:00:00Z'
  const path = ['planning_formation', 'problem_framing']
  const base = { session_id: 'dr-transcript', timestamp: t, node_path: path }
  const events: DeepResearchEvent[] = [
    { ...base, sequence: 1, type: 'node_start', node_type: 'agent' },
    { ...base, sequence: 2, type: 'reasoning_delta', delta: 'I should scan ' },
    { ...base, sequence: 3, type: 'reasoning_delta', delta: 'the landscape.' },
    { ...base, sequence: 4, type: 'text_delta', delta: 'Starting with a scan. ' },
    { ...base, sequence: 5, type: 'skill_start', skill_id: 'sk-1', skill_name: 'domain-landscape-scan', task: 'Scan the field' },
    { ...base, sequence: 6, type: 'reasoning_delta', skill_id: 'sk-1', delta: 'Search first.' },
    // Named as soon as the model starts the call, before its input is complete.
    { ...base, sequence: 7, type: 'skill_tool', skill_id: 'sk-1', tool_use_id: 'tu-1', tool_name: 'brave_web_search', status: 'running' },
    { ...base, sequence: 8, type: 'skill_tool', skill_id: 'sk-1', tool_use_id: 'tu-1', tool_name: 'brave_web_search', status: 'running', input: { query: 'qLDPC' }, input_preview: 'qLDPC' },
    // The result event names neither the tool nor its input.
    { ...base, sequence: 9, type: 'skill_tool', skill_id: 'sk-1', tool_use_id: 'tu-1', status: 'completed', output_preview: '8 results', output: '8 results\nfull text', output_truncated: false },
    { ...base, sequence: 10, type: 'skill_delta', skill_id: 'sk-1', delta: 'Found ' },
    { ...base, sequence: 11, type: 'skill_delta', skill_id: 'sk-1', delta: 'eight sources.' },
    { ...base, sequence: 12, type: 'skill_stop', skill_id: 'sk-1', status: 'completed' },
    { ...base, sequence: 13, type: 'text_delta', delta: 'Framing complete.' },
    { ...base, sequence: 14, type: 'node_stop', status: 'completed' },
  ]
  let state = emptyDeepResearchSnapshot('dr-transcript')
  for (const event of events) state = reduceDeepResearchEvent(state, event)

  const node = state.nodes['planning_formation/problem_framing']
  assert.deepEqual(node.activity, [
    { id: 'p2', kind: 'reasoning', text: 'I should scan the landscape.' },
    { id: 'p4', kind: 'text', text: 'Starting with a scan. ' },
    { id: 'p5', kind: 'skill', skill_id: 'sk-1' },
    { id: 'p13', kind: 'text', text: 'Framing complete.' },
  ])
  const skill = state.skill_invocations[0]
  assert.deepEqual(skill.steps, [
    { id: 'p6', kind: 'reasoning', text: 'Search first.' },
    { id: 'p7', kind: 'tool', tool_id: 'tu-1' },
    { id: 'p10', kind: 'text', text: 'Found eight sources.' },
  ])
  assert.equal(skill.tools.length, 1)
  assert.equal(skill.tools[0].tool_name, 'brave_web_search')
  assert.deepEqual(skill.tools[0].input, { query: 'qLDPC' })
  assert.equal(skill.tools[0].input_preview, 'qLDPC')
  assert.equal(skill.tools[0].output, '8 results\nfull text')
  assert.equal(skill.tools[0].status, 'completed')
  assert.equal(skill.output_text, 'Found eight sources.')

  // A repeat pass is marked; the first pass stays above it.
  state = reduceDeepResearchEvent(state, { ...base, sequence: 15, type: 'node_start', node_type: 'agent' })
  state = reduceDeepResearchEvent(state, { ...base, sequence: 16, type: 'text_delta', delta: 'Second look.' })
  const again = state.nodes['planning_formation/problem_framing'].activity
  assert.deepEqual(again.slice(-2), [
    { id: 'p15', kind: 'pass', pass: 2 },
    { id: 'p16', kind: 'text', text: 'Second look.' },
  ])
  assert.equal(again.length, 6)
})

test('a run list entry without transcripts does not erase the transcript a full snapshot gave', () => {
  const fullRun = {
    session_id: 'dr-merge',
    status: 'completed',
    active: false,
    sequence: 20,
    nodes: {
      'planning_formation/problem_framing': {
        node_id: 'problem_framing',
        node_path: ['planning_formation', 'problem_framing'],
        node_type: 'agent',
        status: 'completed',
        activity: [{ id: 'p2', kind: 'reasoning', text: 'Think.' }, { id: 'p5', kind: 'skill', skill_id: 'sk-1' }],
        skill_invocations: [{ id: 'sk-1', skill_name: 'domain-landscape-scan', node_path: ['planning_formation', 'problem_framing'], tools: [{ id: 'tu-1', tool_name: 'brave_web_search', status: 'completed' }] }],
      },
    },
    skill_invocations: [
      {
        id: 'sk-1',
        skill_name: 'domain-landscape-scan',
        node_path: ['planning_formation', 'problem_framing'],
        status: 'completed',
        output_text: 'Found eight sources.',
        steps: [{ id: 'p7', kind: 'tool', tool_id: 'tu-1' }, { id: 'p10', kind: 'text', text: 'Found eight sources.' }],
        tools: [{ id: 'tu-1', tool_name: 'brave_web_search', status: 'completed', input: { query: 'qLDPC' }, output: 'full text', output_truncated: true }],
      },
    ],
  }
  const full = normalizeDeepResearchSnapshot(fullRun)
  assert.equal(full.nodes['planning_formation/problem_framing'].activity.length, 2)
  assert.equal(full.skill_invocations[0].steps.length, 2)
  assert.equal(full.skill_invocations[0].tools[0].output_truncated, true)

  // GET /deep-research/runs: same run, no `activity`, no `steps`, no tool input/output.
  const listed = structuredClone(fullRun) as typeof fullRun
  for (const node of Object.values(listed.nodes)) delete (node as { activity?: unknown }).activity
  for (const skill of listed.skill_invocations) {
    delete (skill as { steps?: unknown }).steps
    skill.tools = skill.tools.map((tool) => ({ id: tool.id, tool_name: tool.tool_name, status: tool.status })) as typeof skill.tools
  }
  const merged = normalizeDeepResearchSnapshot(listed, full)
  assert.deepEqual(merged.nodes['planning_formation/problem_framing'].activity, full.nodes['planning_formation/problem_framing'].activity)
  assert.deepEqual(merged.skill_invocations[0].steps, full.skill_invocations[0].steps)
  assert.deepEqual(merged.skill_invocations[0].tools[0].input, { query: 'qLDPC' })
  assert.equal(merged.skill_invocations[0].tools[0].output, 'full text')
  assert.equal(merged.skill_invocations[0].tools[0].output_truncated, true)
})
