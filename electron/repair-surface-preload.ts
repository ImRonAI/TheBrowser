/**
 * Preload of the native repair surface (a trusted WebContentsView drawn above the tab views).
 *
 * Deliberately narrow: the surface shows one investigation and lets the user decide; it never
 * reaches the backend itself (the shell renderer owns authenticated access) and exposes no tab,
 * window, theme or automation IPC. Everything arrives through `repair-surface:state` and leaves
 * through `repair-surface:decision` / `repair-surface:size`.
 */
import { contextBridge, ipcRenderer } from 'electron'

export type RepairSurfaceDecision = 'approve' | 'decline' | 'cancel' | 'rollback' | 'open' | 'dismiss'

const api = {
  /** Subscribe to the surface state the main process forwards from the shell renderer. */
  onState: (callback: (state: unknown) => void) => {
    const handler = (_: unknown, state: unknown) => callback(state)
    ipcRenderer.on('repair-surface:state', handler)
    return () => ipcRenderer.removeListener('repair-surface:state', handler)
  },
  /** The user's decision. The main process relays it to the shell renderer, which calls the API. */
  decide: (decision: RepairSurfaceDecision, rev: string) => ipcRenderer.send('repair-surface:decision', decision, rev),
  /** The content height the surface needs (bounded by the main process). */
  resize: (height: number) => ipcRenderer.send('repair-surface:size', height),
}

contextBridge.exposeInMainWorld('repairSurface', api)

export type RepairSurfaceAPI = typeof api
