import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentFromSelection, agentModel, agentTarget, projectChoices, RON_AGENT, sameAgent, specialistChoices } from './panel-agents.ts'
import { hydratePanelSession } from './panel-stream.ts'

const specialist = specialistChoices([{ id: 'a1', name: 'F1 2026 Briefing', description: 'Race weekends', config: { model: 'xai/grok-4.7' } }])[0]
const project = projectChoices([{ id: 'p1', name: 'Calendar QA', key: 'CALQA' }])[0]

test('agent targets: Ren sends no id; specialists and projects send theirs', () => {
  assert.deepEqual(agentTarget(RON_AGENT), { kind: 'ron', id: '' })
  assert.deepEqual(agentTarget(specialist), { kind: 'specialist', id: 'a1' })
  assert.deepEqual(agentTarget(project), { kind: 'project', id: 'p1' })
  assert.equal(project.name, 'Calendar QA (CALQA)')
  assert.ok(sameAgent(RON_AGENT, { kind: 'ron', id: 'ignored' }))
  assert.ok(!sameAgent(specialist, project))
})

test("a specialist's own model is offered only when the panel can run its provider", () => {
  assert.deepEqual(agentModel(specialist), { provider: 'xai', model: 'grok-4.7' })
  assert.equal(agentModel({ ...specialist, model: 'bedrock/us.anthropic.claude' }), null)
  assert.equal(agentModel({ ...specialist, model: undefined }), null)
  assert.equal(agentModel(project), null)
})

test('the pinned agent is restored from the session snapshot', () => {
  assert.equal(agentFromSelection({ agent: { kind: 'specialist', id: 'a1' } }, [RON_AGENT, specialist, project]), specialist)
  assert.equal(agentFromSelection({}, [specialist]), RON_AGENT)
  assert.equal(agentFromSelection({ agent: { kind: 'other', id: 'x' } }, []), RON_AGENT)
  // An agent the renderer does not know (deleted, other device) still shows as that kind.
  assert.deepEqual(agentFromSelection({ agent: { kind: 'project', id: 'gone' } }, []),
    { kind: 'project', id: 'gone', name: 'Project agent', description: '' })
  const state = hydratePanelSession('s', { selection: { provider: 'xai', model_id: 'grok-4.7', agent: { kind: 'project', id: 'p1' } } })
  assert.deepEqual(state.configuration?.agent, { kind: 'project', id: 'p1' })
})
