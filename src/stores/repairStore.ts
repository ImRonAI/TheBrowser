import { create } from 'zustand'
import type { RepairInvestigation } from '../lib/panel-stream.ts'

/**
 * Mirror of the Agent Panel's current tool-repair investigation for surfaces that do not own
 * the panel's SSE stream: the native repair surface bridge (`RepairBridge`) and anything that
 * needs to know a repair is waiting while the panel is closed. `usePanelChat` publishes here and
 * registers the decision performer; the bridge only reads and calls it.
 */
export type RepairDecisionKind = 'approve' | 'decline' | 'cancel' | 'rollback' | 'dismiss'

interface RepairStore {
  /** The investigation the owning panel chat currently tracks, keyed by session so stale sessions do not linger. */
  repair?: RepairInvestigation
  sessionId?: string
  /** Performs a decision against the API (bound by the panel chat that owns the session). */
  decide?: (kind: RepairDecisionKind, repair: RepairInvestigation) => Promise<boolean>
  publish: (sessionId: string, repair: RepairInvestigation | undefined, decide: RepairStore['decide']) => void
  clear: (sessionId: string) => void
}

export const useRepairStore = create<RepairStore>((set, get) => ({
  publish: (sessionId, repair, decide) => set({ sessionId, repair, decide }),
  clear: (sessionId) => { if (get().sessionId === sessionId) set({ sessionId: undefined, repair: undefined, decide: undefined }) },
}))
