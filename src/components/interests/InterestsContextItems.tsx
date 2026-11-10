import { useMemo } from 'react'
import { RenIcon } from '@/components/brand'
import { useAgentUi } from '@/context/AgentUiContext'
import { buildInterestMenu } from '@/lib/interest-menu'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { agentsForInterest, useInterestDiscoveryStore } from '@/stores/interestDiscoveryStore'
import { useInterestsStore } from '@/stores/interestsStore'

interface InterestsContextItemsProps {
  onClose: () => void
}

export function InterestsContextItems({ onClose }: InterestsContextItemsProps) {
  const nodes = useInterestsStore((state) => state.nodes)
  const setExpanded = useInterestsStore((state) => state.setExpanded)
  const selectInterest = useInterestDiscoveryStore((state) => state.selectInterest)
  const storiesByLabel = useInterestDiscoveryStore((state) => state.storiesByLabel)
  const recommendations = useContextAgentStore((state) => state.recommendations)
  const agents = useContextAgentStore((state) => state.agents)
  const { sendToAgentPanel } = useAgentUi()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- agentsForInterest reads the context store; recompute when it changes
  const menu = useMemo(() => buildInterestMenu(nodes, { storiesByLabel, agentsFor: agentsForInterest }), [nodes, storiesByLabel, recommendations, agents])

  if (menu.interests.length === 0) return null

  return (
    <>
      <div className="my-1.5 h-px mx-2 bg-gradient-to-r from-transparent via-black/10 dark:via-white/10 to-transparent" />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="w-full px-3 py-2.5 mx-0 flex items-center gap-3 text-left">
          <RenIcon className="w-4 h-4 text-royal dark:text-royal-light" />
          <span className="text-sm font-raleway font-raleway-bold text-royal dark:text-royal-light">
            Your Interests
          </span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="z-[9999] min-w-[260px] rounded-xl py-1.5 shadow-2xl bg-white dark:bg-zinc-800 border border-black/10 dark:border-white/10">
          <DropdownMenuItem
            onSelect={() => {
              setExpanded(true)
              onClose()
            }}
            className="w-full px-3 py-2 flex items-center gap-3 text-left"
          >
            <span className="text-sm font-raleway text-ron-text dark:text-white">Interest Graph</span>
          </DropdownMenuItem>

          {menu.stories.length > 0 && (
            <>
              <DropdownMenuSeparator className="bg-black/10 dark:bg-white/10" />
              <DropdownMenuLabel className="px-3 py-1.5 text-xs font-raleway text-ron-text/40 dark:text-white/40">
                Latest Stories
              </DropdownMenuLabel>
              {menu.stories.map((story) => (
                <DropdownMenuItem
                  key={story.id}
                  onSelect={() => {
                    setExpanded(true)
                    selectInterest(story.interestId, story.interestLabel, story.category)
                    onClose()
                  }}
                  className="w-full px-3 py-2 text-left"
                >
                  <span className="text-sm font-raleway text-ron-text dark:text-white line-clamp-2">
                    {story.title}
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          )}

          {menu.agents.length > 0 && (
            <>
              <DropdownMenuSeparator className="bg-black/10 dark:bg-white/10" />
              <DropdownMenuLabel className="px-3 py-1.5 text-xs font-raleway text-ron-text/40 dark:text-white/40">
                Suggested Agents
              </DropdownMenuLabel>
              {menu.agents.map((agent) => (
                <DropdownMenuItem
                  key={agent.id}
                  onSelect={() => {
                    sendToAgentPanel(
                      `Use my specialist agent "${agent.name}" (find it with list_harness_agents, then a2a_send_message) for ${agent.interestLabel}. ${agent.description}`,
                    )
                    onClose()
                  }}
                  className="w-full px-3 py-2 text-left"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-raleway font-raleway-bold text-ron-text dark:text-white">
                      {agent.name}
                    </span>
                    <span className="text-xs font-raleway text-ron-text/50 dark:text-white/50 line-clamp-2">
                      {agent.description}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  )
}
