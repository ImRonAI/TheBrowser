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
  assert.deepEqual(root.members.map((m) => m.id), ['planning_formation', 'investigation_formation', 'verification_swarm', 'synthesis_formation'])
  assert.equal(root.kind, 'graph')

  const swarm = scopeAt(['investigation_formation', 'adversarial_swarm'])
  assert.equal(swarm.kind, 'swarm')
  assert.deepEqual(swarm.members.map((m) => m.id), ['hypothesis_explorer', 'contrarian_examiner'])
  assert.deepEqual(swarm.path, ['investigation_formation', 'adversarial_swarm'])

  assert.equal(resolveScope(topology, ['planning_formation', 'problem_framing']), null)
  assert.equal(resolveScope(topology, ['nope']), null)

  assert.deepEqual(
    scopeTrail(topology, ['investigation_formation', 'adversarial_swarm']).map((crumb) => crumb.label),
    ['Deep Research Formation', 'Investigation Formation', 'Adversarial Swarm'],
  )
  // A stale path stops at the last formation that exists.
  assert.equal(scopeTrail(topology, ['investigation_formation', 'gone']).length, 2)
})

test('leafAgents counts agents at any depth', () => {
  const investigation = topology.nodes[1]
  assert.deepEqual(
    leafAgents(investigation, ['investigation_formation']).map((leaf) => leaf.path.join('/')),
    [
      'investigation_formation/web_intelligence',
      'investigation_formation/news_data_intelligence',
      'investigation_formation/adversarial_swarm/hypothesis_explorer',
      'investigation_formation/adversarial_swarm/contrarian_examiner',
      'investigation_formation/evidence_ledger',
    ],
  )
})

test('layoutScope layers left to right through loops and keeps cards the same size', () => {
  const root = layoutScope(scopeAt([]), new Set())
  assert.deepEqual(root.nodes.map((n) => [n.id, n.layer]), [
    ['planning_formation', 0],
    ['investigation_formation', 1],
    ['verification_swarm', 2],
    ['synthesis_formation', 3],
  ])
  assert.ok(root.nodes.every((n) => n.y === 0 && n.height === NODE_HEIGHT))
  assert.deepEqual(root.nodes.map((n) => n.x), [0, 1, 2, 3].map((layer) => layer * (NODE_WIDTH + GAP_X)))
  // The refinement loop is an ordinary edge back to an earlier card; it does not change the layers.
  assert.ok(root.edges.some((edge) => edge.source === 'verification_swarm' && edge.target === 'investigation_formation'))
  assert.deepEqual(root.nodes.map((n) => n.handles), [
    { target: false, source: true },
    { target: true, source: true },
    { target: true, source: true },
    { target: true, source: false },
  ])
  assert.equal(root.width, 4 * NODE_WIDTH + 3 * GAP_X)
  assert.equal(root.height, NODE_HEIGHT)

  // Three parallel branches converge on the ledger, which sits centred beside them.
  const investigation = layoutScope(scopeAt(['investigation_formation']), new Set())
  const byId = Object.fromEntries(investigation.nodes.map((n) => [n.id, n]))
  assert.deepEqual([byId.web_intelligence.layer, byId.news_data_intelligence.layer, byId.adversarial_swarm.layer, byId.evidence_ledger.layer], [0, 0, 0, 1])
  assert.equal(byId.evidence_ledger.y, NODE_HEIGHT + GAP_Y)
  assert.equal(byId.news_data_intelligence.y, NODE_HEIGHT + GAP_Y)

  // A swarm's two peers hand off both ways and still sit side by side.
  const swarm = layoutScope(scopeAt(['verification_swarm']), new Set())
  assert.deepEqual(swarm.nodes.map((n) => [n.id, n.layer]), [['citation_verifier', 0], ['analytical_critic', 1]])
  assert.deepEqual(swarm.edges.map((edge) => [edge.source, edge.target]), [
    ['citation_verifier', 'analytical_critic'],
    ['analytical_critic', 'citation_verifier'],
  ])
})

test('an open agent pushes only the cards under it; a formation never opens in place', () => {
  const scope = scopeAt(['investigation_formation'])
  const closed = Object.fromEntries(layoutScope(scope, new Set()).nodes.map((n) => [n.id, n]))
  const open = layoutScope(scope, new Set(['investigation_formation/web_intelligence', 'investigation_formation/adversarial_swarm']))
  const byId = Object.fromEntries(open.nodes.map((n) => [n.id, n]))

  assert.equal(byId.web_intelligence.expanded, true)
  assert.equal(byId.web_intelligence.height, NODE_HEIGHT + NODE_BODY_HEIGHT)
  assert.equal(byId.web_intelligence.y, closed.web_intelligence.y)
  assert.equal(byId.news_data_intelligence.y, closed.news_data_intelligence.y + NODE_BODY_HEIGHT)
  assert.equal(byId.adversarial_swarm.y, closed.adversarial_swarm.y + NODE_BODY_HEIGHT)
  // The other column does not move.
  assert.equal(byId.evidence_ledger.y, closed.evidence_ledger.y)
  // The swarm is a formation: it is entered, not expanded.
  assert.equal(byId.adversarial_swarm.expanded, false)
  assert.equal(byId.adversarial_swarm.height, NODE_HEIGHT)
  assert.equal(open.height, 3 * NODE_HEIGHT + 2 * GAP_Y + NODE_BODY_HEIGHT)
})

test('scopeEdges are temporary until their source has started, and node status maps to the tool badge states', () => {
  const scope = scopeAt(['planning_formation'])
  const edges = layoutScope(scope, new Set()).edges
  const typeOf = (snapshot: DeepResearchSnapshot) => scopeEdges(snapshot, scope, edges).map((edge) => edge.type)

  assert.deepEqual(typeOf(emptyDeepResearchSnapshot('dr-idle')), ['temporary'])
  const started = run([
    { type: 'node_start', node_path: ['planning_formation'], node_type: 'graph' },
    { type: 'node_start', node_path: ['planning_formation', 'problem_framing'], node_type: 'agent' },
  ])
  assert.deepEqual(typeOf(started), ['animated'])
  // At the root, the edge out of a formation follows the formation's own derived status.
  const root = scopeAt([])
  const rootTypes = Object.fromEntries(scopeEdges(started, root, layoutScope(root, new Set()).edges).map((edge) => [edge.id, edge.type]))
  assert.equal(rootTypes['planning_formation->investigation_formation'], 'animated')
  assert.equal(rootTypes['investigation_formation->verification_swarm'], 'temporary')

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
