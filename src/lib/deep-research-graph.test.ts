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
type StreamEvent = DeepResearchEvent['event']

/** `event` as the outer graph streams it from inside the nodes on `path`. */
function at(path: readonly string[], event: StreamEvent): StreamEvent {
  return path.reduceRight<StreamEvent>((inner, nodeId) => ({ type: 'multiagent_node_stream', node_id: nodeId, event: inner }), event)
}

const start = (path: readonly string[], nodeId: string): StreamEvent =>
  at(path, { type: 'multiagent_node_start', node_id: nodeId, node_type: 'agent' })

function run(events: StreamEvent[], from = emptyDeepResearchSnapshot('dr-graph')): DeepResearchSnapshot {
  return events.reduce(
    (state, event, index) => reduceDeepResearchEvent(state, { sequence: from.sequence + index + 1, event }),
    from,
  )
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
    ['Squad', 'Data Analysis Graph'],
  )
  // A stale path stops at the last formation that exists.
  assert.equal(scopeTrail(topology, ['data_analysis_graph', 'gone']).length, 2)
})

test('leafAgents lists the agents under a formation', () => {
  const production = topology.nodes[3]
  assert.ok(production)
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

test('layoutScope layers left to right along the edges and keeps cards the same size', () => {
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

  const analysis = layoutScope(scopeAt(['data_analysis_graph']), new Set())
  assert.deepEqual(analysis.nodes.map((n) => [n.id, n.layer]), [
    ['visual_planner', 0],
    ['data_analyst', 1],
    ['visual_citation', 2],
    ['visual_qa', 3],
  ])
  assert.deepEqual(analysis.edges.map((edge) => edge.id), [
    'visual_planner->data_analyst',
    'data_analyst->visual_citation',
    'visual_citation->visual_qa',
  ])

  // The PDF and the deck are built side by side, each followed by its own QA.
  const production = layoutScope(scopeAt(['production_graph']), new Set())
  const byId = Object.fromEntries(production.nodes.map((n) => [n.id, n]))
  assert.ok(byId["pdf_publisher"] && byId["deck_producer"] && byId["pdf_qa"] && byId["deck_build_qa"])
  assert.deepEqual([byId["pdf_publisher"].layer, byId["deck_producer"].layer, byId["pdf_qa"].layer, byId["deck_build_qa"].layer], [0, 0, 1, 1])
  assert.equal(byId["deck_producer"].y, NODE_HEIGHT + GAP_Y)
  assert.equal(byId["deck_build_qa"].y, NODE_HEIGHT + GAP_Y)

  // A swarm has no edges: its agents hand off to each other themselves, so they stand in one column.
  const swarm = layoutScope(scopeAt(['writing_swarm']), new Set())
  assert.equal(swarm.edges.length, 0)
  assert.ok(swarm.nodes.every((n) => n.layer === 0))
  assert.equal(swarm.nodes.length, 7)
})

test('an open agent pushes only the cards under it; a formation never opens in place', () => {
  const scope = scopeAt(['production_graph'])
  const closed = Object.fromEntries(layoutScope(scope, new Set()).nodes.map((n) => [n.id, n]))
  const open = layoutScope(scope, new Set(['production_graph/pdf_publisher']))
  const byId = Object.fromEntries(open.nodes.map((n) => [n.id, n]))
  assert.ok(closed["pdf_publisher"] && closed["deck_producer"] && closed["pdf_qa"] && closed["deck_build_qa"])
  assert.ok(byId["pdf_publisher"] && byId["deck_producer"] && byId["pdf_qa"] && byId["deck_build_qa"])

  assert.equal(byId["pdf_publisher"].expanded, true)
  assert.equal(byId["pdf_publisher"].height, NODE_HEIGHT + NODE_BODY_HEIGHT)
  assert.equal(byId["pdf_publisher"].y, closed["pdf_publisher"].y)
  assert.equal(byId["deck_producer"].y, closed["deck_producer"].y + NODE_BODY_HEIGHT)
  // The other column does not move.
  assert.equal(byId["pdf_qa"].y, closed["pdf_qa"].y)
  assert.equal(byId["deck_build_qa"].y, closed["deck_build_qa"].y)
  assert.equal(open.height, 2 * NODE_HEIGHT + GAP_Y + NODE_BODY_HEIGHT)

  // A formation is entered, not expanded.
  const root = layoutScope(scopeAt([]), new Set(['research_swarm']))
  assert.ok(root.nodes.every((n) => !n.expanded && n.height === NODE_HEIGHT))
})

test('scopeEdges are temporary until their source has started, and node status maps to the tool badge states', () => {
  const scope = scopeAt(['data_analysis_graph'])
  const edges = layoutScope(scope, new Set()).edges
  const typesOf = (snapshot: DeepResearchSnapshot) =>
    Object.fromEntries(scopeEdges(snapshot, scope, edges).map((edge) => [edge.id, edge.type]))

  assert.ok(Object.values(typesOf(emptyDeepResearchSnapshot('dr-idle'))).every((type) => type === 'temporary'))
  const started = run([
    { type: 'multiagent_node_start', node_id: 'data_analysis_graph', node_type: 'multiagent' },
    start(['data_analysis_graph'], 'visual_planner'),
  ])
  assert.equal(typesOf(started)['visual_planner->data_analyst'], 'animated')
  assert.equal(typesOf(started)['data_analyst->visual_citation'], 'temporary')
  // At the root, the edge out of a formation follows the formation's own derived status.
  const root = scopeAt([])
  const rootTypes = Object.fromEntries(scopeEdges(started, root, layoutScope(root, new Set()).edges).map((edge) => [edge.id, edge.type]))
  assert.equal(rootTypes['research_swarm->data_analysis_graph'], 'temporary')
  assert.equal(rootTypes['data_analysis_graph->writing_swarm'], 'animated')

  assert.deepEqual(
    (['idle', 'executing', 'completed', 'failed', 'cancelled', 'interrupted'] as const).map(nodeToolState),
    ['input-streaming', 'input-available', 'output-available', 'output-error', 'output-error', 'output-error'],
  )
})

test('agentTranscript orders the work, resolves the subagent tool calls and splits off the result', () => {
  const swarm = ['research_swarm']
  const path = ['research_swarm', 'researcher']
  const agent = (event: StreamEvent) => at(path, event)
  const subagent = (data: StreamEvent) =>
    agent({ tool_stream_event: { tool_use: { toolUseId: 'sk-1', name: 'subagent' }, data } })
  const working = run([
    { type: 'multiagent_node_start', node_id: 'research_swarm', node_type: 'multiagent' },
    start(swarm, 'researcher'),
    agent({ reasoningText: 'Plan the scan.' }),
    agent({ data: 'Scanning first.' }),
    agent({
      message: {
        role: 'assistant',
        content: [{ toolUse: { toolUseId: 'sk-1', name: 'subagent', input: { task: 'Scan the field' } } }],
      },
    }),
    subagent({ reasoningText: 'Search.' }),
    subagent({
      message: {
        role: 'assistant',
        content: [{ toolUse: { toolUseId: 'tu-1', name: 'tavily_search', input: { query: 'qLDPC' } } }],
      },
    }),
  ])
  const live = agentTranscript(working, path)
  assert.deepEqual(live.steps.map((step) => step.kind), ['reasoning', 'text', 'skill'])
  const liveSkill = live.steps[2]
  assert.ok(liveSkill && liveSkill.kind === 'skill' && liveSkill.active && liveSkill.skill.task === 'Scan the field')
  assert.deepEqual(liveSkill.steps.map((step) => [step.kind, step.active]), [['reasoning', false], ['tool', true]])
  assert.equal(live.output, '')
  // Nothing is written after the subagent yet: the card previews the newest text anywhere in the work.
  assert.equal(live.latestText, 'Search.')

  const done = run(
    [
      subagent({ message: { role: 'user', content: [{ toolResult: { toolUseId: 'tu-1', status: 'success', content: [{ text: 'eight hits' }] } }] } }),
      subagent({ data: 'Eight sources.' }),
      agent({ message: { role: 'user', content: [{ toolResult: { toolUseId: 'sk-1', status: 'success', content: [{ text: 'Eight sources.' }] } }] } }),
      agent({ reasoningText: 'Now write it up.' }),
      agent({ data: 'The field ' }),
    ],
    working,
  )
  const writing = agentTranscript(done, path)
  // Reasoning after the last subagent stays with the work; text after it is the result, still streaming.
  assert.deepEqual(writing.steps.map((step) => step.kind), ['reasoning', 'text', 'skill', 'reasoning'])
  assert.equal(writing.output, 'The field ')
  assert.equal(writing.outputActive, true)
  const skill = writing.steps[2]
  assert.ok(skill && skill.kind === 'skill' && !skill.active)
  assert.deepEqual(skill.steps.map((step) => step.kind), ['reasoning', 'tool', 'text'])
  const skillTool = skill.steps[1]
  assert.ok(skillTool && skillTool.kind === 'tool' && skillTool.tool.output === 'eight hits' && skillTool.tool.tool_name === 'tavily_search')

  const finished = run(
    [at(swarm, { type: 'multiagent_node_stop', node_id: 'researcher', node_result: { status: 'completed', execution_time: 1200 } })],
    done,
  )
  const closed = agentTranscript(finished, path)
  assert.equal(closed.outputActive, false)
  assert.equal(closed.latestText, 'The field ')
  assert.ok(closed.steps.every((step) => step.kind === 'pass' || step.kind === 'skill' || !step.active))
  assert.ok(finished.nodes['research_swarm/researcher'])
  assert.equal(finished.nodes['research_swarm/researcher'].execution_time_ms, 1200)

  // A swarm that hands back to an agent starts it again: its second pass is marked in its work.
  const again = run([start(swarm, 'researcher'), agent({ data: 'More.' })], finished)
  const second = agentTranscript(again, path)
  assert.ok(second.steps.some((step) => step.kind === 'pass' && step.pass === 2))
  assert.equal(second.output, 'More.')

  // An agent that has not run yet has nothing to show.
  const idle = agentTranscript(emptyDeepResearchSnapshot('dr-idle'), ['research_swarm', 'fact_checker'])
  assert.deepEqual([idle.steps.length, idle.output, idle.latestText], [0, '', ''])
})
