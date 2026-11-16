import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_FORMATION_TOPOLOGY,
  emptyDeepResearchSnapshot,
  reduceDeepResearchEvent,
  type DeepResearchEvent,
  type DeepResearchSnapshot,
} from './deep-research-api.ts'
import {
  GAP_X,
  GAP_Y,
  NODE_BODY_HEIGHT,
  NODE_HEIGHT,
  NODE_WIDTH,
  agentTranscript,
  layoutScope,
  leafAgents,
  nodeToolState,
  resolveScope,
  scopeEdges,
  scopeTrail,
} from './deep-research-graph.ts'

const topology = DEFAULT_FORMATION_TOPOLOGY
const t = '2026-11-15T10:00:00Z'

function run(events: Array<Omit<DeepResearchEvent, 'sequence' | 'session_id' | 'timestamp'>>): DeepResearchSnapshot {
  let state = emptyDeepResearchSnapshot('dr-graph')
  events.forEach((event, index) => {
    state = reduceDeepResearchEvent(state, { ...event, sequence: index + 1, session_id: 'dr-graph', timestamp: t } as DeepResearchEvent)
  })
  return state
}

const scopeAt = (path: string[]) => {
  const scope = resolveScope(topology, path)
  assert.ok(scope, `no scope at ${path.join('/')}`)
  return scope
}

test('resolveScope walks into nested formations and refuses agents and unknown ids', () => {
  const root = scopeAt([])
  assert.deepEqual(root.members.map((m) => m.id), ['research_swarm', 'data_analysis_graph', 'writing_swarm', 'production_graph'])
  assert.equal(root.kind, 'graph')

  const swarm = scopeAt(['research_swarm'])
  assert.equal(swarm.kind, 'swarm')
  assert.deepEqual(swarm.members.map((m) => m.id), ['researcher', 'fact_checker', 'citation_manager', 'research_qa'])
  assert.deepEqual(swarm.path, ['research_swarm'])

  assert.equal(resolveScope(topology, ['research_swarm', 'researcher']), null)
  assert.equal(resolveScope(topology, ['nope']), null)

  assert.deepEqual(
    scopeTrail(topology, ['data_analysis_graph']).map((crumb) => crumb.label),
    ['Deep Research Formation', 'Data Analysis Graph'],
  )
  // A stale path stops at the last formation that exists.
  assert.equal(scopeTrail(topology, ['data_analysis_graph', 'gone']).length, 2)
})

test('leafAgents lists the agents under a formation', () => {
  const production = topology.nodes[3]
  assert.deepEqual(
    leafAgents(production, ['production_graph']).map((leaf) => leaf.path.join('/')),
    [
      'production_graph/pdf_publisher',
      'production_graph/pdf_qa',
      'production_graph/deck_producer',
      'production_graph/deck_build_qa',
    ],
  )
})

test('layoutScope layers left to right through loops and keeps cards the same size', () => {
  const root = layoutScope(scopeAt([]), new Set())
  assert.deepEqual(root.nodes.map((n) => [n.id, n.layer]), [
    ['research_swarm', 0],
    ['data_analysis_graph', 1],
    ['writing_swarm', 2],
    ['production_graph', 3],
  ])
  assert.ok(root.nodes.every((n) => n.y === 0 && n.height === NODE_HEIGHT))
  assert.deepEqual(root.nodes.map((n) => n.x), [0, 1, 2, 3].map((layer) => layer * (NODE_WIDTH + GAP_X)))
  assert.deepEqual(root.nodes.map((n) => n.handles), [
    { target: false, source: true },
    { target: true, source: true },
    { target: true, source: true },
    { target: true, source: false },
  ])
  assert.equal(root.width, 4 * NODE_WIDTH + 3 * GAP_X)
  assert.equal(root.height, NODE_HEIGHT)

  // A QA feedback loop is an ordinary edge back to an earlier card; it does not change the layers.
  const analysis = layoutScope(scopeAt(['data_analysis_graph']), new Set())
  assert.deepEqual(analysis.nodes.map((n) => [n.id, n.layer]), [
    ['visual_planner', 0],
    ['data_analyst', 1],
    ['visual_citation', 2],
    ['visual_qa', 3],
  ])
  assert.ok(analysis.edges.some((edge) => edge.source === 'visual_qa' && edge.target === 'data_analyst'))

  // The PDF and the deck are built side by side, each followed by its own QA.
  const production = layoutScope(scopeAt(['production_graph']), new Set())
  const byId = Object.fromEntries(production.nodes.map((n) => [n.id, n]))
  assert.deepEqual([byId.pdf_publisher.layer, byId.deck_producer.layer, byId.pdf_qa.layer, byId.deck_build_qa.layer], [0, 0, 1, 1])
  assert.equal(byId.deck_producer.y, NODE_HEIGHT + GAP_Y)
  assert.equal(byId.deck_build_qa.y, NODE_HEIGHT + GAP_Y)

  // A swarm's agents are laid out along their usual handoffs, QA's way back included.
  const swarm = layoutScope(scopeAt(['writing_swarm']), new Set())
  assert.deepEqual(swarm.nodes.map((n) => [n.id, n.layer]), [
    ['report_designer', 0],
    ['deck_designer', 1],
    ['layout_qa', 2],
    ['report_writer', 3],
    ['report_qa', 4],
    ['deck_writer', 5],
    ['deck_qa', 6],
  ])
  assert.ok(swarm.edges.some((edge) => edge.source === 'layout_qa' && edge.target === 'deck_designer'))
})

test('an open agent pushes only the cards under it; a formation never opens in place', () => {
  const scope = scopeAt(['production_graph'])
  const closed = Object.fromEntries(layoutScope(scope, new Set()).nodes.map((n) => [n.id, n]))
  const open = layoutScope(scope, new Set(['production_graph/pdf_publisher']))
  const byId = Object.fromEntries(open.nodes.map((n) => [n.id, n]))

  assert.equal(byId.pdf_publisher.expanded, true)
  assert.equal(byId.pdf_publisher.height, NODE_HEIGHT + NODE_BODY_HEIGHT)
  assert.equal(byId.pdf_publisher.y, closed.pdf_publisher.y)
  assert.equal(byId.deck_producer.y, closed.deck_producer.y + NODE_BODY_HEIGHT)
  // The other column does not move.
  assert.equal(byId.pdf_qa.y, closed.pdf_qa.y)
  assert.equal(byId.deck_build_qa.y, closed.deck_build_qa.y)
  assert.equal(open.height, 2 * NODE_HEIGHT + GAP_Y + NODE_BODY_HEIGHT)

  // A formation is entered, not expanded.
  const root = layoutScope(scopeAt([]), new Set(['research_swarm']))
  assert.ok(root.nodes.every((n) => !n.expanded && n.height === NODE_HEIGHT))
})

test('scopeEdges are temporary until their source has started, and node status maps to the tool badge states', () => {
  const scope = scopeAt(['research_swarm'])
  const edges = layoutScope(scope, new Set()).edges
  const typesOf = (snapshot: DeepResearchSnapshot) =>
    Object.fromEntries(scopeEdges(snapshot, scope, edges).map((edge) => [edge.id, edge.type]))

  assert.ok(Object.values(typesOf(emptyDeepResearchSnapshot('dr-idle'))).every((type) => type === 'temporary'))
  const started = run([
    { type: 'node_start', node_path: ['research_swarm'], node_type: 'swarm' },
    { type: 'node_start', node_path: ['research_swarm', 'researcher'], node_type: 'agent' },
  ])
  assert.equal(typesOf(started)['researcher->fact_checker'], 'animated')
  assert.equal(typesOf(started)['fact_checker->citation_manager'], 'temporary')
  // At the root, the edge out of a formation follows the formation's own derived status.
  const root = scopeAt([])
  const rootTypes = Object.fromEntries(scopeEdges(started, root, layoutScope(root, new Set()).edges).map((edge) => [edge.id, edge.type]))
  assert.equal(rootTypes['research_swarm->data_analysis_graph'], 'animated')
  assert.equal(rootTypes['data_analysis_graph->writing_swarm'], 'temporary')

  assert.deepEqual(
    (['idle', 'pending', 'executing', 'completed', 'failed', 'cancelled', 'interrupted'] as const).map(nodeToolState),
    ['input-streaming', 'input-streaming', 'input-available', 'output-available', 'output-error', 'output-error', 'output-error'],
  )
})

test('agentTranscript orders the work, resolves tool calls and splits off the result', () => {
  const path = ['planning_formation', 'problem_framing']
  const base = { node_path: path }
  const working = run([
    { ...base, type: 'node_start', node_type: 'agent' },
    { ...base, type: 'reasoning_delta', delta: 'Plan the scan.' },
    { ...base, type: 'text_delta', delta: 'Scanning first.' },
    { ...base, type: 'skill_start', skill_id: 'sk-1', skill_name: 'domain-landscape-scan', task: 'Scan the field' },
    { ...base, type: 'reasoning_delta', skill_id: 'sk-1', delta: 'Search.' },
    { ...base, type: 'skill_tool', skill_id: 'sk-1', tool_use_id: 'tu-1', tool_name: 'brave_web_search', status: 'running', input: { query: 'qLDPC' }, input_preview: 'qLDPC' },
  ])
  const live = agentTranscript(working, path)
  assert.deepEqual(live.steps.map((step) => step.kind), ['reasoning', 'text', 'skill'])
  const liveSkill = live.steps[2]
  assert.ok(liveSkill.kind === 'skill' && liveSkill.active)
  assert.deepEqual(liveSkill.steps.map((step) => [step.kind, step.active]), [['reasoning', false], ['tool', true]])
  assert.equal(live.output, '')
  // Nothing is written after the skill yet: the card previews the newest text anywhere in the work.
  assert.equal(live.latestText, 'Search.')

  const done = run([
    { ...base, type: 'node_start', node_type: 'agent' },
    { ...base, type: 'reasoning_delta', delta: 'Plan the scan.' },
    { ...base, type: 'skill_start', skill_id: 'sk-1', skill_name: 'domain-landscape-scan', task: 'Scan the field' },
    { ...base, type: 'skill_tool', skill_id: 'sk-1', tool_use_id: 'tu-1', tool_name: 'brave_web_search', status: 'running', input: { query: 'qLDPC' } },
    { ...base, type: 'skill_tool', skill_id: 'sk-1', tool_use_id: 'tu-1', status: 'completed', output: 'eight hits' },
    { ...base, type: 'skill_delta', skill_id: 'sk-1', delta: 'Eight sources.' },
    { ...base, type: 'skill_stop', skill_id: 'sk-1', status: 'completed' },
    { ...base, type: 'reasoning_delta', delta: 'Now write it up.' },
    { ...base, type: 'text_delta', delta: 'The field ' },
  ])
  const writing = agentTranscript(done, path)
  // Reasoning after the last skill stays with the work; text after it is the result, still streaming.
  assert.deepEqual(writing.steps.map((step) => step.kind), ['reasoning', 'skill', 'reasoning'])
  assert.equal(writing.output, 'The field ')
  assert.equal(writing.outputActive, true)
  const skill = writing.steps[1]
  assert.ok(skill.kind === 'skill' && !skill.active)
  assert.deepEqual(skill.steps.map((step) => step.kind), ['tool', 'text'])
  assert.ok(skill.steps[0].kind === 'tool' && skill.steps[0].tool.output === 'eight hits' && skill.steps[0].tool.tool_name === 'brave_web_search')

  const finished = reduceDeepResearchEvent(done, { sequence: 99, session_id: 'dr-graph', timestamp: t, type: 'node_stop', node_path: path, status: 'completed' })
  const closed = agentTranscript(finished, path)
  assert.equal(closed.outputActive, false)
  assert.equal(closed.latestText, 'The field ')
  assert.ok(closed.steps.every((step) => step.kind === 'pass' || step.kind === 'skill' || !step.active))
})

test('agentTranscript still shows a run saved before transcripts existed', () => {
  const legacy = emptyDeepResearchSnapshot('dr-old', {
    nodes: {
      'planning_formation/problem_framing': {
        node_id: 'problem_framing',
        node_path: ['planning_formation', 'problem_framing'],
        node_type: 'agent',
        status: 'completed',
        started_at: t,
        completed_at: t,
        execution_time_ms: 1200,
        execution_count: 1,
        skills_used: ['domain-landscape-scan'],
        skill_invocations: [],
        output_preview: 'Framed the problem.',
        streaming_text: '',
        activity: [],
        error: null,
      },
    },
    skill_invocations: [
      {
        id: 'sk-old',
        skill_name: 'domain-landscape-scan',
        task: 'Scan',
        node_path: ['planning_formation', 'problem_framing'],
        node_key: 'planning_formation/problem_framing',
        status: 'completed',
        started_at: t,
        completed_at: t,
        duration_ms: 900,
        tools: [{ id: 'tu-old', tool_name: 'brave_web_search', input_preview: 'qLDPC', status: 'completed', output_preview: '8 hits', timestamp: t, input: null, output: '', output_truncated: false }],
        output_text: 'Eight sources.',
        summary: 'Eight sources.',
        steps: [],
      },
    ],
  })
  const view = agentTranscript(legacy, ['planning_formation', 'problem_framing'])
  assert.deepEqual(view.steps.map((step) => step.kind), ['skill'])
  assert.ok(view.steps[0].kind === 'skill')
  assert.deepEqual(view.steps[0].steps.map((step) => step.kind), ['tool', 'text'])
  assert.equal(view.output, 'Framed the problem.')

  // An agent that has not run yet has nothing to show.
  const idle = agentTranscript(emptyDeepResearchSnapshot('dr-idle'), ['planning_formation', 'problem_framing'])
  assert.deepEqual([idle.steps.length, idle.output, idle.latestText], [0, '', ''])
})
