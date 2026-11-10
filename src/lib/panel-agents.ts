/**
 * Who the Agent Panel talks to: Ron, one of the user's saved specialists (built with `create_harness`), or a
 * project's agent. The panel assumes Ren; a specialist or project chat is started from that agent's own entry point
 * (Chat in the Context widget, Ask the project agent). The choice is sent to `POST /chat` as `agent: {kind, id}` on
 * a conversation's first turn, where the server pins it to the session like the model.
 *
 * Pure (relative imports only) so node:test can run it.
 */

export type AgentKind = 'ron' | 'specialist' | 'project'

export interface AgentChoice {
  kind: AgentKind
  /** The specialist's id or the project id; '' for Ron. */
  id: string
  name: string
  description: string
  /** A specialist's own model as `<provider>/<model>` (from its harness config), when it names one. */
  model?: string
}

export const RON_AGENT: AgentChoice = { kind: 'ron', id: '', name: 'Ren', description: 'Your browser agent, with every tool.' }

/** Providers the panel can run (mirrors ModelSelector's list and the backend's PROVIDERS). */
const PROVIDERS = new Set(['nim', 'perplexity', 'openai', 'anthropic', 'gemini', 'xai', 'mistral'])

export function agentTarget(agent: AgentChoice): { kind: AgentKind; id: string } {
  return { kind: agent.kind, id: agent.kind === 'ron' ? '' : agent.id }
}

export function sameAgent(a: Pick<AgentChoice, 'kind' | 'id'>, b: Pick<AgentChoice, 'kind' | 'id'>): boolean {
  return a.kind === b.kind && (a.kind === 'ron' || a.id === b.id)
}

/** A specialist's `<provider>/<model>` when the panel can run it; harness-only strings (bedrock/…) are not. */
export function agentModel(agent: AgentChoice): { provider: string; model: string } | null {
  const value = agent.model?.trim() ?? ''
  const slash = value.indexOf('/')
  if (slash <= 0) return null
  const provider = value.slice(0, slash)
  const model = value.slice(slash + 1)
  return PROVIDERS.has(provider) && model ? { provider, model } : null
}

export function specialistChoices(agents: { id: string; name: string; description?: string; config?: Record<string, unknown> }[]): AgentChoice[] {
  return agents.map((agent) => ({
    kind: 'specialist', id: agent.id, name: agent.name, description: agent.description ?? '',
    model: typeof agent.config?.model === 'string' ? agent.config.model : undefined,
  }))
}

export function projectChoices(projects: { id: string; name: string; key?: string; summary?: string }[]): AgentChoice[] {
  return projects.map((project) => ({
    kind: 'project', id: project.id, name: project.key ? `${project.name} (${project.key})` : project.name,
    description: project.summary || 'Discuss the project, create issues and edit existing ones.',
  }))
}

/** The pinned agent from a session snapshot's `selection.agent`, resolved against the known choices. */
export function agentFromSelection(selection: unknown, choices: AgentChoice[]): AgentChoice {
  const value = selection && typeof selection === 'object' ? (selection as { agent?: unknown }).agent : undefined
  const target = value && typeof value === 'object' ? value as { kind?: unknown; id?: unknown } : {}
  if ((target.kind !== 'specialist' && target.kind !== 'project') || typeof target.id !== 'string' || !target.id) return RON_AGENT
  const known = choices.find((choice) => choice.kind === target.kind && choice.id === target.id)
  return known ?? { kind: target.kind, id: target.id, name: target.kind === 'project' ? 'Project agent' : 'Specialist agent', description: '' }
}

export function agentKindLabel(kind: AgentKind): string {
  return kind === 'specialist' ? 'Specialist' : kind === 'project' ? 'Project agent' : 'Ren'
}
