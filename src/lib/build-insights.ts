/**
 * What the Build workbench shows beside the conversation, read from the conversation itself (the panel protocol's
 * messages, see panel-stream.ts): the agent's plan (`todo_write`), the commands it ran (`shell`) and their output,
 * the files it wrote (`editor`), the dev-server URLs it started, and test results found in command output.
 * Pure functions over messages; no React, no `@/` imports (node-testable).
 */
import type { PanelMessage, ToolPart } from './panel-stream.ts'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export interface BuildTodo { content: string; activeForm: string; status: TodoStatus }

export interface BuildCommand {
  id: string
  /** The command line(s) as the agent sent them. */
  command: string
  output: string
  state: 'running' | 'done' | 'failed'
}

export interface BuildFileChange { path: string; action: string; at: number }

export interface BuildTestSummary {
  runner: 'pytest' | 'vitest' | 'jest' | 'node' | 'mocha'
  passed: number
  failed: number
  skipped: number
  total: number
  /** Milliseconds, when the runner printed it. */
  duration?: number
  /** Failing test names the runner listed (bounded). */
  failures: string[]
  commandId: string
}

export interface BuildInsights {
  todos: BuildTodo[]
  commands: BuildCommand[]
  changes: BuildFileChange[]
  /** Dev-server URLs (127.0.0.1 / localhost, any port but the API's) in the order they were first printed. */
  servers: string[]
  tests: BuildTestSummary | null
}

const topLevelTools = (messages: PanelMessage[]): ToolPart[] =>
  messages.flatMap((message) => message.parts.filter((part): part is ToolPart => part.kind === 'tool' && part.path.length === 0))

/** A tool result's text: the SDK's `[{text}]` / `{content: [{text}]}` blocks, a plain string, or JSON as a last resort. */
export function toolText(output: unknown): string {
  if (output == null) return ''
  if (typeof output === 'string') return output
  if (Array.isArray(output)) return output.map(toolText).filter(Boolean).join('\n')
  if (typeof output === 'object') {
    const record = output as Record<string, unknown>
    if (typeof record.text === 'string') return record.text
    if ('content' in record) return toolText(record.content)
    if ('json' in record) return JSON.stringify(record.json, null, 2)
  }
  try { return JSON.stringify(output, null, 2) } catch { return String(output) }
}

const isTodo = (value: unknown): value is BuildTodo => {
  if (!value || typeof value !== 'object') return false
  const todo = value as Record<string, unknown>
  return typeof todo.content === 'string' && (todo.status === 'pending' || todo.status === 'in_progress' || todo.status === 'completed')
}

const commandLine = (input: unknown): string => {
  const command = (input as { command?: unknown } | null)?.command
  if (Array.isArray(command)) return command.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')
  return typeof command === 'string' ? command : ''
}

/**
 * The readable output of a `shell` result. strands_tools' shell returns an "Execution Summary" block followed by
 * one block per command (`Command:`, `Status:`, `Exit Code:`, `Output:`, `Error:`); the console shows each
 * command's output and error text, not that envelope. Text in any other shape is returned as it is.
 */
export function shellOutput(output: unknown): { text: string; failed: boolean } {
  const blocks = Array.isArray(output) ? output.map(toolText) : [toolText(output)]
  const commands = blocks.filter((block) => block.startsWith('Command: ') && block.includes('\nOutput: '))
  if (!commands.length) return { text: blocks.join('\n'), failed: false }
  let failed = false
  const text = commands.map((block) => {
    if (/\nStatus: error\n/.test(block) || /\nExit Code: (?!0\n)-?\d+\n/.test(block)) failed = true
    const afterOutput = block.slice(block.indexOf('\nOutput: ') + '\nOutput: '.length)
    const errorAt = afterOutput.lastIndexOf('\nError: ')
    const out = (errorAt < 0 ? afterOutput : afterOutput.slice(0, errorAt)).replace(/\s+$/, '')
    const err = errorAt < 0 ? '' : afterOutput.slice(errorAt + '\nError: '.length).trim()
    return [out, err && err !== 'None' ? err : ''].filter(Boolean).join('\n')
  }).join('\n')
  return { text, failed }
}

const SERVER_URL = /\bhttps?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0):(\d{2,5})(?:\/[^\s"'`)<>\]]*)?/g

export function buildInsights(messages: PanelMessage[], apiPort = 8765): BuildInsights {
  let todos: BuildTodo[] = []
  const commands: BuildCommand[] = []
  const changes: BuildFileChange[] = []
  const servers: string[] = []
  let tests: BuildTestSummary | null = null
  const noteServers = (text: string) => {
    for (const match of text.matchAll(SERVER_URL)) {
      if (Number(match[1]) === apiPort) continue
      const url = match[0].replace('0.0.0.0', '127.0.0.1').replace(/[.,;:]+$/, '')
      if (!servers.includes(url)) servers.push(url)
    }
  }
  topLevelTools(messages).forEach((part, index) => {
    if (part.name === 'todo_write') {
      const list = (part.input as { todos?: unknown } | null)?.todos
      if (Array.isArray(list)) todos = list.filter(isTodo).map((todo) => ({ content: todo.content, activeForm: todo.activeForm || todo.content, status: todo.status }))
      return
    }
    if (part.name === 'shell') {
      const result = part.finished ? shellOutput(part.output) : { text: part.progress.join(''), failed: false }
      const output = result.text
      const command: BuildCommand = { id: part.id || `shell-${index}`, command: commandLine(part.input), output,
        state: !part.finished ? 'running' : part.status === 'error' || result.failed ? 'failed' : 'done' }
      commands.push(command)
      noteServers(output)
      noteServers(command.command)
      const summary = parseTestSummary(output)
      if (summary) tests = { ...summary, commandId: command.id }
      return
    }
    if (part.name === 'editor' || part.name === 'file_editor') {
      const input = part.input as { command?: unknown; path?: unknown } | null
      const action = typeof input?.command === 'string' ? input.command : 'edit'
      if (typeof input?.path === 'string' && action !== 'view' && action !== 'find_line') changes.push({ path: input.path, action, at: index })
    }
  })
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts) if (part.kind === 'text') noteServers(part.text)
  }
  return { todos, commands, changes, servers, tests }
}

/** Ends a failed command in the console (xterm 203, #ff5f5f: legible on the terminal's near-black). */
export const FAILED_MARK = '\u001b[1;38;5;203m✗ failed\u001b[0m'
/** Ends a command that never reported back before the run stopped or paused (xterm 179, #d7af5f). */
export const INTERRUPTED_MARK = '\u001b[38;5;179m■ interrupted\u001b[0m'

/**
 * The console transcript: each command as `$ command` followed by its output, like a terminal session. A failed
 * command ends with {@link FAILED_MARK}; while the run is not `live`, a command still waiting for its result ends with
 * {@link INTERRUPTED_MARK}, so nothing looks like it is still running.
 */
export function consoleTranscript(commands: BuildCommand[], live = true): string {
  return commands.map((command) => {
    const mark = command.state === 'failed' ? FAILED_MARK : command.state === 'running' && !live ? INTERRUPTED_MARK : ''
    return [`\u001b[1;38;5;141m$\u001b[0m ${command.command}`, command.output.replace(/\s+$/, ''), mark].filter(Boolean).join('\n')
  }).join('\n\n')
}

const count = (text: string, pattern: RegExp) => {
  const match = text.match(pattern)
  return match ? Number(match[1]) : 0
}

/**
 * The last test-run summary in a command's output, for the runners the Build agent is told to use. Each runner's
 * own summary line is the source (pytest `== 3 passed, 1 failed in 0.12s ==`, Vitest `Tests  3 passed | 1 failed (4)`,
 * Jest `Tests: 1 failed, 3 passed, 4 total`, node:test `# pass 3` / `# fail 1`, Mocha `3 passing` / `1 failing`).
 */
export function parseTestSummary(text: string): Omit<BuildTestSummary, 'commandId'> | null {
  if (!text) return null
  const failures: string[] = []
  const pytest = [...text.matchAll(/^=+ (.*?(?:passed|failed|error|skipped).*?) in ([\d.]+)s(?: \([^)]*\))? =+$/gm)].pop()
  if (pytest) {
    const line = pytest[1]
    for (const match of text.matchAll(/^FAILED (\S+)/gm)) failures.push(match[1])
    const passed = count(line, /(\d+) passed/), failed = count(line, /(\d+) failed/) + count(line, /(\d+) errors?/), skipped = count(line, /(\d+) skipped/)
    return { runner: 'pytest', passed, failed, skipped, total: passed + failed + skipped, duration: Math.round(Number(pytest[2]) * 1000), failures: failures.slice(0, 20) }
  }
  const vitest = [...text.matchAll(/^\s*Tests\s+(.*?)\((\d+)\)\s*$/gm)].pop()
  if (vitest && /passed|failed|skipped/.test(vitest[1])) {
    const line = vitest[1]
    for (const match of text.matchAll(/^\s*(?:×|✗|FAIL)\s+(.+?)(?:\s+\d+ms)?$/gm)) failures.push(match[1].trim())
    const duration = text.match(/^\s*Duration\s+([\d.]+)(ms|s)/m)
    return { runner: 'vitest', passed: count(line, /(\d+) passed/), failed: count(line, /(\d+) failed/), skipped: count(line, /(\d+) skipped/),
      total: Number(vitest[2]), duration: duration ? Math.round(Number(duration[1]) * (duration[2] === 's' ? 1000 : 1)) : undefined, failures: failures.slice(0, 20) }
  }
  const jest = [...text.matchAll(/^Tests:\s+(.*?)(\d+) total\s*$/gm)].pop()
  if (jest) {
    for (const match of text.matchAll(/^\s*✕\s+(.+?)(?:\s+\(\d+ m?s\))?$/gm)) failures.push(match[1].trim())
    const duration = text.match(/^Time:\s+([\d.]+)\s*(ms|s)/m)
    return { runner: 'jest', passed: count(jest[1], /(\d+) passed/), failed: count(jest[1], /(\d+) failed/), skipped: count(jest[1], /(\d+) skipped/),
      total: Number(jest[2]), duration: duration ? Math.round(Number(duration[1]) * (duration[2] === 's' ? 1000 : 1)) : undefined, failures: failures.slice(0, 20) }
  }
  if (/^# pass \d+$/m.test(text) && /^# fail \d+$/m.test(text)) {
    for (const match of text.matchAll(/^not ok \d+ - (.+)$/gm)) failures.push(match[1].trim())
    const passed = count(text, /^# pass (\d+)$/m), failed = count(text, /^# fail (\d+)$/m), skipped = count(text, /^# skipped (\d+)$/m)
    const duration = text.match(/^# duration_ms ([\d.]+)$/m)
    return { runner: 'node', passed, failed, skipped, total: count(text, /^# tests (\d+)$/m) || passed + failed + skipped,
      duration: duration ? Math.round(Number(duration[1])) : undefined, failures: failures.slice(0, 20) }
  }
  const mocha = text.match(/^\s*(\d+) passing(?: \((\d+)(ms|s)\))?$/m)
  if (mocha) {
    const failed = count(text, /^\s*(\d+) failing$/m), skipped = count(text, /^\s*(\d+) pending$/m)
    for (const match of text.matchAll(/^\s*\d+\) (.+)$/gm)) failures.push(match[1].trim())
    return { runner: 'mocha', passed: Number(mocha[1]), failed, skipped, total: Number(mocha[1]) + failed + skipped,
      duration: mocha[2] ? Math.round(Number(mocha[2]) * (mocha[3] === 's' ? 1000 : 1)) : undefined, failures: failures.slice(0, 20) }
  }
  return null
}
