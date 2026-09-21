import { useEffect } from 'react'
import { AgentWorkspace } from '@/components/agent-panel/AgentPanel'
import { useAuthStore } from '@/stores/authStore'
import { articleDraftKey, useArticleDraftStore } from '@/stores/articleDraftStore'
import { useSearchStore } from '@/stores/searchStore'

/** Search uses the same native journal/replay protocol as Panel, in its own session. */
export function SearchAgentDisplay({ query }: { query: string; sessionId?: string }) {
  const user = useAuthStore((state) => state.user?.id || 'default')
  useEffect(() => {
    const key = articleDraftKey(user, 'search')
    const store = useArticleDraftStore.getState()
    if (!store.drafts[key]?.text && query.trim()) store.setText(key, query)
  }, [query, user])
  return <div className="flex h-[calc(100dvh-220px)] min-h-[460px] flex-col">
    <div className="flex shrink-0 items-center justify-between px-4 py-2 text-xs text-ink-muted dark:text-ink-inverse-muted"><span>Review your question, then send to research.</span><button onClick={() => useSearchStore.getState().clearSearch()} className="underline">Back to Discover</button></div>
    <div className="min-h-0 flex-1"><AgentWorkspace destination="search" /></div>
  </div>
}
export default SearchAgentDisplay