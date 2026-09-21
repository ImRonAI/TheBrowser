/**
 * OpenToChatButton Component
 * 
 * A reusable button component that renders an "Open to Chat" action
 * for routing search results to the appropriate internal agent.
 * Supports icon-only, text-only, and full button variants.
 */

import type { UniversalResult } from '@/pages/types/search'
import { Button } from '@/components/ui/button'
import { MessageCircle } from 'lucide-react'
import { useAgentUi } from '@/context/AgentUiContext'
import { buildAgentPromptForResult, buildOpenToChatContext, getAgentForResult } from '@/utils/open-to-chat'

/**
 * Props for the OpenToChatButton component
 */
export interface OpenToChatButtonProps {
  /** The search result to open in the agent */
  result: UniversalResult
  /** Optional original search query for context */
  searchQuery?: string
  /** Button variant: icon, text, or full */
  variant?: 'icon' | 'text' | 'full'
  /** Optional custom className for styling */
  className?: string
  /** Optional onClick handler (in addition to opening in agent) */
  onClick?: (e: React.MouseEvent) => void
}

/**
 * Button component for opening search results in the appropriate internal agent
 * 
 * @example
 * ```tsx
 * // Icon-only variant
 * <OpenToChatButton result={searchResult} variant="icon" />
 * 
 * // Text-only variant
 * <OpenToChatButton result={searchResult} variant="text" />
 * 
 * // Full button with icon and text
 * <OpenToChatButton result={searchResult} variant="full" searchQuery="query" />
 * ```
 */
export function OpenToChatButton({
  result,
  searchQuery,
  variant = 'full',
  className = '',
  onClick,
}: OpenToChatButtonProps) {
  const { sendToAgentPanel } = useAgentUi()

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Call custom onClick handler if provided
    if (onClick) {
      onClick(e)
    }
    
    if (!e.defaultPrevented) {
      const context = buildOpenToChatContext(result, searchQuery)
      sendToAgentPanel(buildAgentPromptForResult(result, searchQuery, context))
    }
  }

  const buttonProps = {
    onClick: handleClick,
    className,
    size: (variant === 'icon' ? 'icon' : 'sm') as 'default' | 'sm' | 'lg' | 'icon',
    variant: 'outline' as 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link',
  }

  return (
    <Button {...buttonProps}>
      <MessageCircle className="h-4 w-4" />
      {variant === 'full' && 'Open to Chat'}
    </Button>
  )
}

/**
 * Props for the OpenToChatButtonWithAgent component
 */
export interface OpenToChatButtonWithAgentProps extends Omit<OpenToChatButtonProps, 'variant'> {
  /** Whether to show the agent name in the button */
  showAgentName?: boolean
}

/**
 * Extended button component that also shows the target agent name
 * 
 * @example
 * ```tsx
 * <OpenToChatButtonWithAgent 
 *   result={searchResult} 
 *   showAgentName={true}
 *   searchQuery="query"
 * />
 * ```
 */
export function OpenToChatButtonWithAgent({
  result,
  searchQuery,
  className = '',
  showAgentName = true,
  onClick,
}: OpenToChatButtonWithAgentProps) {
  const { sendToAgentPanel } = useAgentUi()
  const targetAgent = getAgentForResult(result)
  const agentName = getAgentDisplayName(targetAgent)

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (onClick) {
      onClick(e)
    }
    
    if (!e.defaultPrevented) {
      const context = buildOpenToChatContext(result, searchQuery)
      sendToAgentPanel(buildAgentPromptForResult(result, searchQuery, context))
    }
  }

  return (
    <Button
      onClick={handleClick}
      className={className}
      size="sm"
      variant="outline"
    >
      <MessageCircle className="h-4 w-4 mr-2" />
      {showAgentName ? `${agentName}` : 'Open to Chat'}
    </Button>
  )
}

/**
 * Gets the display name for an internal agent ID
 */
function getAgentDisplayName(agentId: string): string {
  switch (agentId) {
    case 'ron':
      return 'Ron'
    case 'researcher':
      return 'Researcher'
    case 'browser':
      return 'Browser'
    case 'coding-agent':
      return 'Coding'
    default:
      return 'Chat'
  }
}
