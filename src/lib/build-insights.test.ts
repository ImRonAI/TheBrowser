import assert from 'node:assert/strict'
import test from 'node:test'
import { FAILED_MARK, INTERRUPTED_MARK, buildInsights, consoleTranscript, parseTestSummary, shellOutput } from './build-insights.ts'
import type { PanelMessage, ToolPart } from './panel-stream.ts'

const tool = (name: string, input: unknown, output?: unknown, extra: Partial<ToolPart> = {}): ToolPart =>
  ({ kind: 'tool', key: `${name}-${JSON.stringify(input).length}`, id: `${name}-${Math.abs(JSON.stringify(input).length)}`, name, path: [], input,
    progress: [], output, finished: output !== undefined, status: output === undefined ? undefined : 'success', ...extra })

/** strands_tools shell's result: an execution summary, then one block per command. */
const shellResult = (command: string, out: string, exit = 0, error = '') => [
  { text: `Execution Summary:\nTotal commands: 1\nSuccessful: ${exit ? 0 : 1}\nFailed: ${exit ? 1 : 0}` },
  { text: `Command: ${command}\nStatus: ${exit ? 'error' : 'success'}\nExit Code: ${exit}\nOutput: ${out}\nError: ${error}` },
]

test('shell results become the commands’ own output; a non-zero exit marks the command failed', () => {
  assert.deepEqual(shellOutput(shellResult('ls', 'index.html\nstyle.css\n')), { text: 'index.html\nstyle.css', failed: false })
  assert.deepEqual(shellOutput(shellResult('npm test', 'FAIL x', 1, 'npm ERR! code 1')), { text: 'FAIL x\nnpm ERR! code 1', failed: true })
  assert.deepEqual(shellOutput('plain text'), { text: 'plain text', failed: false })
})

test('the plan is the latest todo_write; commands, edits, servers and tests come from the run in order', () => {
  const messages: PanelMessage[] = [
    { id: 'u1', role: 'user', parts: [{ kind: 'text', key: 't', text: 'Build me a timer' } as never] },
    { id: 'a1', role: 'assistant', parts: [
      tool('todo_write', { todos: [{ content: 'Scaffold', activeForm: 'Scaffolding', status: 'in_progress' }, { content: 'Style it', activeForm: 'Styling', status: 'pending' }] }, [{ text: '2 todos remaining' }]),
      tool('editor', { command: 'create', path: '/ws/index.html', file_text: '<html>' }, [{ text: 'created' }]),
      tool('editor', { command: 'view', path: '/ws/index.html' }, [{ text: '<html>' }]),
      tool('shell', { command: 'nohup python3 -m http.server 4100 --bind 127.0.0.1 > .ren-dev.log 2>&1 &' }, shellResult('python3 -m http.server', 'Serving on http://127.0.0.1:4100/')),
      tool('shell', { command: ['npx vitest run'] }, shellResult('npx vitest run', ' ✓ src/a.test.ts (2)\n × src/b.test.ts > adds\n\n Test Files  1 failed | 1 passed (2)\n      Tests  1 failed | 2 passed (3)\n   Duration  412ms', 1)),
      tool('todo_write', { todos: [{ content: 'Scaffold', activeForm: 'Scaffolding', status: 'completed' }, { content: 'Style it', activeForm: 'Styling', status: 'in_progress' }] }, [{ text: '1 todos remaining' }]),
      tool('shell', { command: 'git log' }, undefined, { progress: ['commit 1'] }),
      { kind: 'text', key: 'x', text: 'Open http://localhost:4100/ — the API at http://127.0.0.1:8765/health is not a preview.' } as never,
    ] },
  ]
  const insights = buildInsights(messages)
  assert.deepEqual(insights.todos.map((todo) => `${todo.status}:${todo.content}`), ['completed:Scaffold', 'in_progress:Style it'])
  assert.deepEqual(insights.changes.map((change) => `${change.action} ${change.path}`), ['create /ws/index.html'])
  assert.deepEqual(insights.commands.map((command) => command.state), ['done', 'failed', 'running'])
  assert.equal(insights.commands[1].command, 'npx vitest run')
  assert.equal(insights.commands[2].output, 'commit 1')
  assert.deepEqual(insights.servers, ['http://127.0.0.1:4100/', 'http://localhost:4100/'])
  assert.equal(insights.tests?.runner, 'vitest')
  assert.deepEqual([insights.tests?.passed, insights.tests?.failed, insights.tests?.total, insights.tests?.duration], [2, 1, 3, 412])
  assert.match(consoleTranscript(insights.commands), /\$\u001b\[0m git log\ncommit 1$/)
})

test('the console marks a failed command, and one still waiting for its result once the run has stopped', () => {
  const commands = [
    { id: 'a', command: 'npm test', output: 'FAIL x\n', state: 'failed' as const },
    { id: 'b', command: 'ls', output: 'index.html', state: 'done' as const },
    { id: 'c', command: 'npm install', output: '', state: 'running' as const },
  ]
  const prompt = (command: string) => `\u001b[1;38;5;141m$\u001b[0m ${command}`
  assert.equal(consoleTranscript(commands),
    `${prompt('npm test')}\nFAIL x\n${FAILED_MARK}\n\n${prompt('ls')}\nindex.html\n\n${prompt('npm install')}`)
  assert.equal(consoleTranscript(commands, false).split('\n\n')[2], `${prompt('npm install')}\n${INTERRUPTED_MARK}`)
  assert.equal(consoleTranscript(commands, false).split('\n\n')[1], `${prompt('ls')}\nindex.html`)
})

test('test summaries from each runner the Build agent uses', () => {
  const pytest = parseTestSummary('tests/test_a.py ..F\nFAILED tests/test_a.py::test_total - AssertionError\n========= 2 passed, 1 failed, 1 skipped in 0.31s =========')
  assert.deepEqual(pytest, { runner: 'pytest', passed: 2, failed: 1, skipped: 1, total: 4, duration: 310, failures: ['tests/test_a.py::test_total'] })
  const jest = parseTestSummary('  ✕ adds numbers (3 ms)\nTests:       1 failed, 5 passed, 6 total\nTime:        1.2 s')
  assert.deepEqual(jest, { runner: 'jest', passed: 5, failed: 1, skipped: 0, total: 6, duration: 1200, failures: ['adds numbers'] })
  const node = parseTestSummary('not ok 2 - rejects empty\n# tests 3\n# pass 2\n# fail 1\n# skipped 0\n# duration_ms 85.18')
  assert.deepEqual(node, { runner: 'node', passed: 2, failed: 1, skipped: 0, total: 3, duration: 85, failures: ['rejects empty'] })
  const mocha = parseTestSummary('  3 passing (25ms)\n  1 failing\n\n  1) parser\n       throws:\n')
  assert.deepEqual(mocha?.runner, 'mocha')
  assert.deepEqual([mocha?.passed, mocha?.failed, mocha?.total, mocha?.duration], [3, 1, 4, 25])
  assert.equal(parseTestSummary('Compiled successfully'), null)
})
