import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COLUMN_GAP, ROW_GAP, WORKFLOW_STEP_KINDS, handlesFor, inferKind, layoutWorkflow, normalizeWorkflow, starterWorkflow, tidyWorkflow,
  workflowKind, workflowNodeSize, workflowOutline,
} from './workflow.ts'

const edge = (source: string, target: string) => ({ id: `${source}->${target}`, source, target, type: 'animated' as const })

test('layers follow the longest path and centre siblings', () => {
  const graph = {
    steps: ['start', 'process', 'decision', 'ok', 'error', 'done'].map((id) => ({ id, label: id })),
    connections: [edge('start', 'process'), edge('process', 'decision'), edge('decision', 'ok'),
      edge('decision', 'error'), edge('ok', 'done'), edge('error', 'done'), edge('start', 'done')],
  }
  const positions = layoutWorkflow(graph)
  // Every symbol is centred on its layer/row point, whatever its size.
  const centre = (id: string) => {
    const step = graph.steps.find((item) => item.id === id)!
    const size = workflowNodeSize(inferKind(step, graph.connections), step)
    return { x: positions[id].x + size.width / 2, y: positions[id].y + size.height / 2 }
  }
  const column = workflowNodeSize('step').width / 2
  assert.deepEqual(centre('start'), { x: column, y: 0 })
  assert.equal(centre('decision').x, COLUMN_GAP * 2 + column)
  assert.deepEqual([centre('ok').y, centre('error').y], [-ROW_GAP / 2, ROW_GAP / 2])
  // start -> done is a shortcut; done still sits after the longest branch.
  assert.equal(centre('done').x, COLUMN_GAP * 4 + column)
})

test('shape names and aliases normalize; unknown kinds fall back to inference; arrows keep short labels', () => {
  const graph = normalizeWorkflow({
    steps: [
      { id: 'a', label: 'A', kind: 'Database' }, { id: 'b', label: 'B', kind: 'gateway' }, { id: 'c', label: 'C', kind: 'io' },
      { id: 'd', label: 'D', kind: 'hologram' },
    ],
    connections: [{ source: 'b', target: 'c', label: '  Yes  ' }, { source: 'b', target: 'd', label: 'x'.repeat(80), type: 'temporary' }],
  })
  assert.deepEqual(graph.steps.map((step) => step.kind), ['data', 'decision', 'io', undefined])
  assert.equal(graph.connections[0].label, 'Yes')
  assert.equal(graph.connections[1].label!.length, 40)
  assert.equal(workflowKind('manual_task'), 'manual')
  assert.equal(workflowKind(42), undefined)
  assert.equal(WORKFLOW_STEP_KINDS.length, new Set(WORKFLOW_STEP_KINDS.map((item) => item.kind)).size)
})

test('tidy up re-lays out every step, discarding hand-placed positions', () => {
  const tidy = tidyWorkflow({ steps: [{ id: 'a', label: 'A', position: { x: 999, y: 999 } }, { id: 'b', label: 'B' }],
    connections: [{ id: 'a->b', source: 'a', target: 'b', type: 'animated' }] })
  assert.notDeepEqual(tidy.steps[0].position, { x: 999, y: 999 })
  assert.ok(tidy.steps[1].position!.x > tidy.steps[0].position!.x)
})

test('cycles do not loop forever and explicit positions win', () => {
  const graph = {
    steps: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C', position: { x: 7, y: 9 } }],
    connections: [edge('a', 'b'), edge('b', 'a'), edge('b', 'c')],
  }
  const positions = layoutWorkflow(graph)
  assert.deepEqual(positions.c, { x: 7, y: 9 })
  assert.equal(positions.a.x, 0)
  assert.equal(positions.b.x, COLUMN_GAP)
})

test('kinds are inferred from arrows unless set, and decide the handles', () => {
  const connections = [edge('a', 'b'), edge('b', 'c')]
  assert.equal(inferKind({ id: 'a', label: 'A' }, connections), 'start')
  assert.equal(inferKind({ id: 'b', label: 'B' }, connections), 'step')
  assert.equal(inferKind({ id: 'c', label: 'C' }, connections), 'end')
  assert.equal(inferKind({ id: 'c', label: 'C', kind: 'decision' }, connections), 'decision')
  assert.deepEqual(handlesFor('start'), { source: true, target: false })
  assert.deepEqual(handlesFor('end'), { source: false, target: true })
  assert.deepEqual(handlesFor('decision'), { source: true, target: true })
})

test('normalizeWorkflow keeps valid parts of untrusted input', () => {
  const graph = normalizeWorkflow({
    steps: [{ id: 'a', label: '  Plan  ', kind: 'start', position: { x: 1, y: 2 } }, { id: 'a', label: 'dup' },
      { id: 'b', label: '', kind: 'nonsense', content: 42 }, null, { label: 'no id' }],
    connections: [{ source: 'a', target: 'b', type: 'temporary' }, { source: 'a', target: 'b' },
      { source: 'a', target: 'missing' }, { source: 'b', target: 'b' }, { source: 'b', target: 'a', type: 'zigzag' }],
  })
  assert.deepEqual(graph.steps.map((step) => [step.id, step.label, step.kind]), [['a', 'Plan', 'start'], ['b', 'Untitled step', undefined]])
  assert.deepEqual(graph.steps[0].position, { x: 1, y: 2 })
  assert.equal(graph.steps[1].content, undefined)
  assert.deepEqual(graph.connections.map((c) => [c.source, c.target, c.type]), [['a', 'b', 'temporary'], ['b', 'a', 'animated']])
  assert.deepEqual(normalizeWorkflow('not json'), { steps: [], connections: [] })
})

test('the outline reads starts first and the starter workflow is connected', () => {
  const starter = starterWorkflow()
  assert.deepEqual(workflowOutline(starter), ['Start', 'Do the work', 'Done'])
  assert.deepEqual(starter.connections.map((c) => c.target), ['step-1', 'end'])
})
