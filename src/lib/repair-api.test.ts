import assert from 'node:assert/strict'
import { test } from 'node:test'
import { investigationFromActive, pickSurfaceInvestigation, repairDecisionRequest, repairNotification } from './repair-api.ts'
import type { RepairInvestigation } from './panel-stream.ts'

test('decision requests target the loopback surface and approve needs rev + token', () => {
  assert.deepEqual(repairDecisionRequest('http://api', 'approve', 'alice', 'flaky', 'r1', 'a'.repeat(64)),
    { url: 'http://api/tools/repairs/flaky/approve', body: { user_id: 'alice', rev: 'r1', approval_token: 'a'.repeat(64) } })
  assert.deepEqual(repairDecisionRequest('http://api', 'decline', 'alice', 'flaky', 'r1'),
    { url: 'http://api/tools/repairs/flaky/decline', body: { user_id: 'alice', rev: 'r1' } })
  assert.deepEqual(repairDecisionRequest('http://api', 'cancel', 'alice', 'user_browser_browser_click'),
    { url: 'http://api/tools/repairs/user_browser_browser_click/cancel', body: { user_id: 'alice' } })
  assert.deepEqual(repairDecisionRequest('http://api', 'rollback', 'alice', 'flaky').body, { user_id: 'alice' })
  assert.throws(() => repairDecisionRequest('http://api', 'approve', 'alice', 'flaky', 'r1'), /approval token/)
})

test('GET /tools/repairs/active entries map onto the panel shape; the token travels only while approval', () => {
  const entry = {
    revision: 'r1', tool_name: 'flaky', state: 'approval', context_id: 'repair-r1', task_id: 't1',
    interrupt: { interruptId: 'v1:x', name: 'strands:human-in-the-loop', reason: 'Approve "apply_repair"?' },
    evidence: { kind: 'library', exception_class: 'KeyError', count: 2 },
    artifact: { status: 'verified', summary: 'Guarded the key.', diff: '-a\n+b', repair_kind: 'file', target_kind: 'library',
      demonstrations: [{ kind: 'failing', input: {}, status: 'passed', dry_run: false, source: 'session' }], sandbox: 'docker',
      route: 'repair', approval_token: 'b'.repeat(64), applied: null, declined: false },
  }
  const repair = investigationFromActive(entry)
  assert.ok(repair)
  assert.equal(repair.state, 'approval')
  assert.equal(repair.approvalToken, 'b'.repeat(64))
  assert.equal(repair.interrupt?.interruptId, 'v1:x')
  assert.equal(repair.kind, 'library')
  assert.equal(repair.repairKind, 'file')
  assert.equal(repair.exceptionClass, 'KeyError')
  assert.equal(repair.count, 2)
  assert.equal(repair.demonstrations.length, 1)
  const running = investigationFromActive({ ...entry, state: 'investigating', artifact: { status: 'investigating' } })
  assert.equal(running?.state, 'investigating')
  assert.equal(running?.approvalToken, undefined)
  const applied = investigationFromActive({ ...entry, state: 'applied', artifact: { ...entry.artifact, status: 'active', applied: { revision: 'r1' } } })
  assert.equal(applied?.state, 'done')
  assert.equal(applied?.applied, true)
  assert.equal(applied?.approvalToken, undefined)
  assert.equal(investigationFromActive({ state: 'approval' }), undefined)
  assert.equal(investigationFromActive(null), undefined)
})

test('the surface shows the investigation that needs a decision first', () => {
  const base: RepairInvestigation = { tool: 'a', rev: 'r1', state: 'investigating', demonstrations: [] }
  const waiting: RepairInvestigation = { tool: 'b', rev: 'r2', state: 'approval', demonstrations: [] }
  assert.equal(pickSurfaceInvestigation([base, waiting]), waiting)
  assert.equal(pickSurfaceInvestigation([base]), base)
  assert.equal(pickSurfaceInvestigation([]), undefined)
})

test('notifications fire once per state transition and never for routine progress', () => {
  const investigating: RepairInvestigation = { tool: 'flaky', rev: 'r1', state: 'investigating', demonstrations: [] }
  assert.equal(repairNotification(undefined, investigating), null)
  const approval: RepairInvestigation = { ...investigating, state: 'approval', status: 'verified' }
  assert.deepEqual(repairNotification(investigating, approval), { title: 'Repair ready: flaky', body: 'Ron verified a fix in isolation. Open Ron to review and approve it.' })
  assert.equal(repairNotification(approval, approval), null)
  const applied: RepairInvestigation = { ...approval, state: 'done', status: 'active', applied: true }
  assert.equal(repairNotification(approval, applied)?.title, 'Repair applied: flaky')
  const blocked: RepairInvestigation = { ...investigating, state: 'done', status: 'blocked' }
  assert.equal(repairNotification(investigating, blocked)?.title, 'Repair blocked: flaky')
  const declined: RepairInvestigation = { ...approval, state: 'done', status: 'declined', declined: true }
  assert.equal(repairNotification(approval, declined), null)
})
