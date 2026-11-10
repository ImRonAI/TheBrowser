import { create } from 'zustand'
import type { LiveContextTurn } from '../lib/voice-events.ts'

/**
 * Per user/scope/conversation Live state that must outlive the VoiceAgent component.
 *
 * Owner claim: one conversation never has two concurrent Live sockets from different views.
 *
 * Recorded turns: used by the **issue** panes only (`IssueRonChat`, `IssueDescriptionRon`:
 * read-only recap + "latest proposal"). The panel's Chat and Live agents share a native Strands
 * thread (`session_id` + `SnapshotSessionManager`) and never bridge history through this store.
 *
 * In-memory only. Nothing here is persisted or written into SDK messages.
 */
export interface LiveHistoryEntry extends LiveContextTurn {
  id: string
  /** `transcript` = spoken, `text` = typed/text output. */
  kind: 'transcript' | 'text'
  at: number
}

interface LiveConversation {
  turns: LiveHistoryEntry[]
  /** Number of leading `turns` already shared with Chat as context. */
  sharedUpTo: number
}

interface LiveSessionState {
  conversations: Record<string, LiveConversation>
  owners: Record<string, string>
  record: (key: string, entry: LiveHistoryEntry) => void
  markShared: (key: string, count: number) => void
  clear: (key: string) => void
  claim: (key: string, owner: string) => boolean
  release: (key: string, owner: string) => void
}

export const MAX_LIVE_HISTORY = 200
const EMPTY: LiveConversation = { turns: [], sharedUpTo: 0 }

export const liveKey = (userId: string, scope: string, conversationId: string): string => `${userId}\u0000${scope}\u0000${conversationId}`

export const useLiveSessionStore = create<LiveSessionState>()((set, get) => ({
  conversations: {},
  owners: {},
  record: (key, entry) => set((state) => {
    const current = state.conversations[key] ?? EMPTY
    const index = current.turns.findIndex((turn) => turn.id === entry.id)
    let turns = index >= 0 ? current.turns.map((turn, i) => (i === index ? { ...turn, ...entry } : turn)) : [...current.turns, entry]
    let sharedUpTo = current.sharedUpTo
    if (turns.length > MAX_LIVE_HISTORY) {
      const dropped = turns.length - MAX_LIVE_HISTORY
      turns = turns.slice(dropped)
      sharedUpTo = Math.max(0, sharedUpTo - dropped)
    }
    return { conversations: { ...state.conversations, [key]: { turns, sharedUpTo } } }
  }),
  markShared: (key, count) => set((state) => {
    const current = state.conversations[key] ?? EMPTY
    return { conversations: { ...state.conversations, [key]: { ...current, sharedUpTo: Math.min(current.turns.length, Math.max(current.sharedUpTo, count)) } } }
  }),
  clear: (key) => set((state) => {
    const { [key]: _dropped, ...rest } = state.conversations
    return { conversations: rest }
  }),
  claim: (key, owner) => {
    const holder = get().owners[key]
    if (holder && holder !== owner) return false
    if (!holder) set((state) => ({ owners: { ...state.owners, [key]: owner } }))
    return true
  },
  release: (key, owner) => set((state) => {
    if (state.owners[key] !== owner) return state
    const { [key]: _dropped, ...rest } = state.owners
    return { owners: rest }
  }),
}))

export const liveTurnsFor = (state: Pick<LiveSessionState, 'conversations'>, key: string): LiveHistoryEntry[] => state.conversations[key]?.turns ?? EMPTY.turns

/** Turns not yet shared with Chat: the bounded, incremental context payload. */
export function unsharedLiveTurns(state: Pick<LiveSessionState, 'conversations'>, key: string): LiveContextTurn[] {
  const conversation = state.conversations[key] ?? EMPTY
  return conversation.turns.slice(conversation.sharedUpTo).map(({ role, text }) => ({ role, text }))
}

export const liveOwner = (state: Pick<LiveSessionState, 'owners'>, key: string): string | undefined => state.owners[key]
