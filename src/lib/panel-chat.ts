/**
 * Pure pieces of a panel-protocol chat (`usePanelChat`) shared by the views built on it: the Agent Panel, Build and
 * the issue workspace's Ron chat.
 *
 * Scope: every destination remembers one session per user, except `issue`, whose agent is built per issue (on its
 * own session) and so is remembered per user AND issue. Every issue turn names the issue (`issue_id`) and carries the
 * caller's project credential, like a project agent's turns, so the server's Projects identity check and RLS decide
 * what Ren may read and change. Ren's own Agent Panel turns carry the credential too, for its document and project
 * tools (the server binds it when it verifies and never refuses the turn over it). No other turn sends either.
 *
 * Pure (relative imports only) so node:test can run it.
 */
import type { AgentDestination } from './articles.ts'
import type { AgentKind } from './panel-agents.ts'
import type { RunStatus, RuntimeOptions } from './panel-stream.ts'

export type PanelConnection = 'loading' | 'connected' | 'reconnecting' | 'detached'

/** Native runtime options a new conversation starts with (changed only by slash commands before the first turn). */
export const DEFAULT_RUNTIME_OPTIONS: RuntimeOptions = {
  checkpointing: false, tool_execution: 'concurrent', context: 'auto', goal: '', background: false,
}

function requireIssue(destination: AgentDestination, issueId: string | undefined): string {
  if (destination === 'issue' && !issueId) throw new Error('An issue chat needs the issue id.')
  return issueId ?? ''
}

/** localStorage key holding the conversation's current `session_id`. */
export function panelSessionKey(userId: string, destination: AgentDestination, issueId?: string): string {
  return destination === 'issue' ? `ron-issue-session:${userId}:${requireIssue(destination, issueId)}` : `ron-${destination}-session:${userId}`
}

/** Fields every `POST /chat` body adds for this scope: `issue_id` for an issue chat, nothing otherwise. */
export function chatScopeFields(destination: AgentDestination, issueId?: string): { issue_id?: string } {
  return destination === 'issue' ? { issue_id: requireIssue(destination, issueId) } : {}
}

/**
 * Whether a `POST /chat` carries the caller's project credential (Supabase bearer token or guest workspace capability):
 * every issue turn, every project-agent turn and Ren's own Agent Panel turns (its document and project tools).
 */
export function sendsProjectCredential(destination: AgentDestination, agentKind: AgentKind): boolean {
  return destination === 'issue' || agentKind === 'project' || (destination === 'panel' && agentKind === 'ron')
}

/** The header status line of a panel-protocol chat. */
export function panelStatusText({ connection, status, background }: { connection: PanelConnection; status: RunStatus; background?: boolean }): string {
  return connection === 'loading' ? 'Restoring session…' : connection === 'reconnecting' ? 'Reconnecting to run…' :
    connection === 'detached' ? 'Disconnected · run may still be active' :
    status === 'running' ? background ? 'Working · background enabled' : 'Working' :
    status === 'checkpointed' ? 'Paused at checkpoint' : status === 'interrupted' ? 'Waiting for your response' :
    status === 'cancelled' ? 'Stopped' : status === 'error' ? 'Run failed' : status === 'completed' ? 'Completed' : 'Ready'
}
