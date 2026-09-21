import { useEffect } from 'react'
import type { UIMessage } from '@ai-sdk/react'
import { SearchAgentDisplay } from './SearchAgentDisplay'
import type { SourceData } from './SourceCard'
import type { UniversalResult } from '@/pages/types/search'
import { useAuthStore } from '@/stores/authStore'
import { articleDraftKey, useArticleDraftStore } from '@/stores/articleDraftStore'

export type ChatMessage = UIMessage
export function SearchChat({ searchResult, onBack, initialContext }: {
  searchResult: { query: string; answer?: string; sources?: SourceData[] }
  onBack: () => void
  initialContext?: UniversalResult | null
}) {
  const user = useAuthStore((state) => state.user?.id || 'default')
  useEffect(() => {
    if (!initialContext) return
    const key = articleDraftKey(user, 'search')
    const store = useArticleDraftStore.getState()
    if (!store.drafts[key]?.text) store.setText(key, `${searchResult.query}\n\nSearch reference:\n${JSON.stringify(initialContext)}`)
  }, [initialContext, searchResult.query, user])
  return <div className="h-full"><button onClick={onBack} className="m-4 text-xs underline">Back to results</button><SearchAgentDisplay query={searchResult.query} /></div>
}
export default SearchChat