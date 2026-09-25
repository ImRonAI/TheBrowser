import { useEffect } from 'react'
import { useProjectsStore } from '@/stores/projectsStore'
import { Button } from '@/components/ui/button'

export function ProjectsSyncStatus({ initialize = false }: { initialize?: boolean }) {
  const state = useProjectsStore()
  const { userId, initialize: load } = state
  useEffect(() => {
    if (initialize && userId) void load()
  }, [initialize, userId, load])
  return (
    <div className="text-body-sm text-ink dark:text-ink-inverse" aria-live="polite">
      {!userId && <p>Opening your workspace…</p>}
      {state.isLoading && <p role="status">Loading Projects…</p>}
      {state.pendingSaves > 0 && <p role="status">Saving…</p>}
      {state.error && <p role="alert" className="text-rose-500">{state.error}</p>}
      {userId && (
        <Button type="button" variant="link" className="mt-2 text-accent"
          disabled={state.isLoading || state.pendingSaves > 0}
          onClick={() => void state.refreshFromServer()}>Reload from server</Button>
      )}
    </div>
  )
}