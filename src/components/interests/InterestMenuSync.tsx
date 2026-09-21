import { useEffect } from 'react'
import { useAgentUi } from '@/context/AgentUiContext'
import {
  buildInterestMenu,
  interestOverlayInset,
  type InterestAction,
} from '@/lib/interest-menu'
import { useInterestDiscoveryStore } from '@/stores/interestDiscoveryStore'
import { useInterestsStore } from '@/stores/interestsStore'

export function InterestMenuSync() {
  const nodes = useInterestsStore((state) => state.nodes)
  const isExpanded = useInterestsStore((state) => state.isExpanded)
  const setExpanded = useInterestsStore((state) => state.setExpanded)
  const selectedInterestLabel = useInterestDiscoveryStore((state) => state.selectedInterestLabel)
  const selectInterest = useInterestDiscoveryStore((state) => state.selectInterest)
  const { sendToAgentPanel } = useAgentUi()

  useEffect(() => {
    const browser = window.electron?.browser
    if (!browser?.setInterestMenu || !browser.setInterestInset) return

    void browser.setInterestMenu(buildInterestMenu(nodes))
    void browser.setInterestInset(interestOverlayInset({
      hasInterests: nodes.length > 0,
      expanded: isExpanded,
      discoveryOpen: Boolean(selectedInterestLabel),
    }))
  }, [nodes, isExpanded, selectedInterestLabel])

  useEffect(() => {
    const browser = window.electron?.browser
    if (!browser?.onInterestAction) return

    return browser.onInterestAction((action: InterestAction) => {
      if (action.type === 'open-graph') {
        setExpanded(true)
        return
      }
      if (action.type === 'select') {
        setExpanded(true)
        selectInterest(action.id, action.label, action.category)
        return
      }
      if (action.type === 'story') {
        setExpanded(true)
        selectInterest(action.interestId, action.interestLabel, action.category)
        if (action.url) {
          void browser.navigate?.(action.url)
        }
        return
      }
      if (action.type === 'agent') {
        sendToAgentPanel(
          `Use the ${action.name} agent for ${action.interestLabel}. ${action.description}`,
        )
      }
    })
  }, [selectInterest, sendToAgentPanel, setExpanded])

  return null
}
