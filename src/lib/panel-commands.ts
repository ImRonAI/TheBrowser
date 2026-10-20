import type { RuntimeOptions } from './panel-stream.ts'

// UI syntax only. Execution stays with the existing native Strands configuration.
export const PANEL_COMMANDS = [
  { name: '/goal', usage: '/goal <objective> | off', description: 'Set the native goal loop objective' },
  { name: '/background', usage: '/background on | off', description: 'Enable or disable native background tasks' },
  { name: '/tools', usage: '/tools concurrent | sequential', description: 'Choose the native tool executor' },
  { name: '/context', usage: '/context auto | agentic | sliding', description: 'Offload and summarize, let the model manage context, or trim a sliding window' },
  { name: '/checkpoints', usage: '/checkpoints on | off', description: 'Pause at native SDK checkpoints' },
] as const

export type PanelCommandResult =
  | { kind: 'message' }
  | { kind: 'error'; message: string }
  | { kind: 'configure'; options: RuntimeOptions; message: string }

export function parsePanelCommand(text: string, options: RuntimeOptions, locked: boolean): PanelCommandResult {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!match) return text.trim() === '/' ? { kind: 'error', message: 'Choose a command below.' } : { kind: 'message' }
  const command = PANEL_COMMANDS.find((item) => item.name === `/${match[1]}`)
  // Paths and unfamiliar slash-prefixed text are still ordinary messages.
  if (!command) return { kind: 'message' }
  if (locked) return { kind: 'error', message: 'Configuration is fixed for this chat. Start a new chat to change it.' }
  const value = (match[2] ?? '').trim()
  let update: Partial<RuntimeOptions>
  switch (command.name) {
    case '/goal':
      if (!value) return { kind: 'error', message: `Usage: ${command.usage}` }
      update = { goal: value === 'off' ? '' : value }
      break
    case '/background':
    case '/checkpoints':
      if (value !== 'on' && value !== 'off') return { kind: 'error', message: `Usage: ${command.usage}` }
      update = command.name === '/background' ? { background: value === 'on' } : { checkpointing: value === 'on' }
      break
    case '/tools':
      if (value !== 'concurrent' && value !== 'sequential') return { kind: 'error', message: `Usage: ${command.usage}` }
      update = { tool_execution: value }
      break
    case '/context':
      if (value !== 'auto' && value !== 'agentic' && value !== 'sliding') return { kind: 'error', message: `Usage: ${command.usage}` }
      update = { context: value }
      break
  }
  return { kind: 'configure', options: { ...options, ...update }, message: `${command.name.slice(1)}: ${value}` }
}