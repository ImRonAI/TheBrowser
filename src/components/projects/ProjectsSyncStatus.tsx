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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-5 text-ink-muted dark:text-ink-inverse-muted" aria-live="polite">
      {!userId && <p>Opening your workspace…</p>}
      {state.isLoading && <p role="status">Loading projects…</p>}
      {state.pendingSaves > 0 && <p role="status">Saving…</p>}
      {state.error && <p role="alert" className="text-red-600 dark:text-red-400">{state.error}</p>}
      {userId && (
        <Button type="button" variant="link" className="h-auto p-0 text-[12px] font-medium text-blurple-600 dark:text-blurple-400 disabled:opacity-40"
          disabled={state.isLoading || state.pendingSaves > 0}
          onClick={() => void state.refreshFromServer()}>Reload from server</Button>
      )}
    </div>
  )
}