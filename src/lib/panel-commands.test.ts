import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PANEL_COMMANDS, parsePanelCommand } from './panel-commands.ts'
import type { RuntimeOptions } from './panel-stream.ts'

const defaults: RuntimeOptions = {
  checkpointing: false, background: false, context: 'auto', tool_execution: 'concurrent', goal: '',
}

test('commands configure existing native options without changing other fields', () => {
  for (const [text, update] of [
    ['/goal Finish the report', { goal: 'Finish the report' }],
    ['/goal off', { goal: '' }],
    ['/background on', { background: true }],
    ['/background off', { background: false }],
    ['/tools sequential', { tool_execution: 'sequential' }],
    ['/tools concurrent', { tool_execution: 'concurrent' }],
    ['/context agentic', { context: 'agentic' }],
    ['/context sliding', { context: 'sliding' }],
    ['/context auto', { context: 'auto' }],
    ['/checkpoints on', { checkpointing: true }],
    ['/checkpoints off', { checkpointing: false }],
  ] as const) {
    const original = { ...defaults, goal: 'Previous goal' }
    const result = parsePanelCommand(text, original, false)
    assert.equal(result.kind, 'configure', text)
    if (result.kind === 'configure') assert.deepEqual(result.options, { ...original, ...update })
    assert.deepEqual(original, { ...defaults, goal: 'Previous goal' })
  }
})

test('missing and invalid arguments stay local and report usage', () => {
  for (const command of PANEL_COMMANDS) {
    assert.equal(parsePanelCommand(command.name, defaults, false).kind, 'error')
  }
  for (const text of ['/', '/background yes', '/tools parallel', '/checkpoints true', '/context other', '/background on extra']) {
    assert.equal(parsePanelCommand(text, defaults, false).kind, 'error', text)
  }
})

test('every configuration command respects immutable session selection', () => {
  for (const command of PANEL_COMMANDS) {
    const result = parsePanelCommand(`${command.name} on`, defaults, true)
    assert.equal(result.kind, 'error')
    if (result.kind === 'error') assert.match(result.message, /new chat/)
  }
})

test('ordinary prompts and file paths remain messages', () => {
  for (const text of ['Hello', '/Users/tims-stuff/report.md', 'Discuss /tools', '/unknown', '//example']) {
    assert.deepEqual(parsePanelCommand(text, defaults, false), { kind: 'message' })
  }
})

test('goal preserves multiline objectives and outer whitespace is ignored', () => {
  const result = parsePanelCommand('  /goal  First step\nSecond step  ', defaults, false)
  assert.equal(result.kind, 'configure')
  if (result.kind === 'configure') assert.equal(result.options.goal, 'First step\nSecond step')
})