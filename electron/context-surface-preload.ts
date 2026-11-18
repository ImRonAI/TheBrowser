/**
 * Preload of the native ContextSurface (`widgetView` and `discoveryView` WebContentsViews).
 *
 * Caches the latest `context-surface:state` snapshot immediately at preload initialization
 * and sends `context-surface:ready` on subscription so zero state frames are ever lost if
 * `did-finish-load` fires before React's `useEffect` mounts.
 */
import { contextBridge, ipcRenderer } from 'electron'

export type ContextSurfaceKind = 'widget' | 'discovery'

export interface ContextSurfaceMetrics {
  pillWidth?: number
  noticeHeight?: number
  orbHovered?: boolean
}

let hasLatestState = false
let latestState: unknown = null
const listeners = new Set<(state: unknown) => void>()

ipcRenderer.on('context-surface:state', (_event: unknown, state: unknown) => {
  hasLatestState = true
  latestState = state
  for (const listener of listeners) {
    listener(state)
  }
})

const api = {
  onState: (callback: (state: unknown) => void) => {
    listeners.add(callback)
    if (hasLatestState) {
      callback(latestState)
    }
    ipcRenderer.send('context-surface:ready')
    return () => {
      listeners.delete(callback)
    }
  },
  dispatch: (action: unknown): Promise<unknown> =>
    ipcRenderer.invoke('context-surface:action', action),
  sendToIssue: (payload: unknown): Promise<{ message?: string; error?: string }> =>
    ipcRenderer.invoke('context-surface:send-to-issue', payload),
  triggerGesture: (kind: 'upload' | 'record'): void => {
    ipcRenderer.send('context-surface:gesture', kind)
  },
  reportMetrics: (metrics: ContextSurfaceMetrics): void => {
    ipcRenderer.send('context-surface:metrics', metrics)
  },
  dragStart: (surface: ContextSurfaceKind): void => {
    ipcRenderer.send('context-surface:drag-start', surface)
  },
  dragMove: (surface: ContextSurfaceKind): void => {
    ipcRenderer.send('context-surface:drag-move', surface)
  },
  dragEnd: (surface: ContextSurfaceKind): void => {
    ipcRenderer.send('context-surface:drag-end', surface)
  },
  openSignIn: (): void => {
    ipcRenderer.send('context-surface:open-sign-in')
  },
}

contextBridge.exposeInMainWorld('contextSurface', api)

export type ContextSurfaceAPI = typeof api
