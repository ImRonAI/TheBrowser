import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE_URL } from '@/lib/api-base'
import { cancelRon, runRon, type RonDestination } from '@/lib/ron-run'
import type { PanelState } from '@/lib/panel-stream'
import { useAuthStore } from '@/stores/authStore'

/**
 * One request at a time to a scoped Ron agent (`destination`), for a feature that shows Ron's draft
 * before the user applies it. `state` is the folded stream (text, tool calls, results) as it arrives.
 * Sending again on the same `sessionId` continues that conversation (e.g. feedback on a draft).
 */
export function useRonRun(destination: RonDestination) {
  const userId = useAuthStore((state) => state.user?.id || 'default')
  const [state, setState] = useState<PanelState | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = useRef<{ controller: AbortController; sessionId: string } | null>(null)

  // Leaving the view stops reading the stream; the server-owned run finishes on its own.
  useEffect(() => () => active.current?.controller.abort(), [])

  const start = useCallback(async ({ sessionId, message, goal }: { sessionId: string; message: string; goal?: string }) => {
    if (active.current) return null
    const controller = new AbortController()
    active.current = { controller, sessionId }
    setRunning(true)
    setError(null)
    setState(null)
    try {
      const final = await runRon({ apiBase: API_BASE_URL, destination, sessionId, userId, message, goal, signal: controller.signal, onState: setState })
      if (final.status === 'error') setError(final.error || 'Ren could not finish this request.')
      return final
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Ren could not be reached.')
      return null
    } finally {
      if (active.current?.controller === controller) active.current = null
      if (!controller.signal.aborted) setRunning(false)
    }
  }, [destination, userId])

  /** Native cancellation; the stream then ends with the run's `cancelled` status. */
  const stop = useCallback(async () => {
    const current = active.current
    if (!current) return
    try { await cancelRon(API_BASE_URL, current.sessionId, userId) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Stop was not confirmed.') }
  }, [userId])

  const reset = useCallback(() => { setState(null); setError(null) }, [])

  return { userId, state, running, error, start, stop, reset }
}
