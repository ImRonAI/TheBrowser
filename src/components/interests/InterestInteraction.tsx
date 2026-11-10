import { useState } from 'react'
import { ChevronDown, MessageSquare } from 'lucide-react'
import { OpenIn, OpenInContent, OpenInItem, OpenInLabel, OpenInTrigger } from '@/components/ai-elements/open-in-chat'
import { useAgentUi } from '@/context/AgentUiContext'
import { useAuthStore } from '@/stores/authStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { useSearchStore } from '@/stores/searchStore'
import { useTabStore } from '@/stores/tabStore'
import { articleDraftKey, useArticleDraftStore } from '@/stores/articleDraftStore'
import { AGENT_LABELS, ARTICLE_DESTINATIONS, type AgentDestination, type ArticleAttachment } from '@/lib/articles'

function showDestination(url: string, title: string) {
  const tabs = useTabStore.getState()
  if (tabs.activeTabId) tabs.updateTab(tabs.activeTabId, { url, title })
  void window.electron?.browser?.navigate(url)
}

export function InterestsActionMenu({ article, onAttached, disabled }: { article: ArticleAttachment; onAttached: () => void; disabled?: boolean }) {
  const { openPanel, closePanel, setInteractionMode } = useAgentUi()
  const [error, setError] = useState('')
  const user = useAuthStore((state) => state.user?.id || 'default')
  const attach = (destination: AgentDestination) => {
    const store = useArticleDraftStore.getState()
    if (!store.attach(articleDraftKey(user, destination), article)) {
      setError(`${AGENT_LABELS[destination]} already has 3 articles. Remove one from its composer before attaching another.`)
      return
    }
    onAttached()
    if (destination === 'voice') {
      setInteractionMode('voice')
      openPanel()
      return
    }
    if (destination === 'panel') {
      setInteractionMode('text')
      openPanel()
      return
    }
    closePanel()
    if (destination === 'build') {
      useSearchStore.getState().clearSearch()
      useNavigationStore.getState().setActiveTab('build')
      showDestination('ron://build', 'Build')
      return
    }
    useNavigationStore.getState().setActiveTab('discover')
    useNavigationStore.getState().setDrawerExpanded(true)
    showDestination('ron://home', 'Home')
  }
  return <><OpenIn query="">
    <OpenInTrigger><button type="button" disabled={disabled} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"><MessageSquare size={14} />Attach to<ChevronDown size={12} /></button></OpenInTrigger>
    <OpenInContent className="z-[300]">
      <OpenInLabel>Choose a destination · nothing is sent automatically</OpenInLabel>
      {ARTICLE_DESTINATIONS.map((destination) => <OpenInItem key={destination} onSelect={() => attach(destination)}>{AGENT_LABELS[destination]}</OpenInItem>)}
    </OpenInContent>
  </OpenIn>{error && <p role="alert" className="basis-full text-xs text-red-600 dark:text-red-400">{error}</p>}</>
}