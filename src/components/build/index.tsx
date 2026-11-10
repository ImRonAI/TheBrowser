/**
 * Build: the Build agent's conversation and its Studio. An empty conversation is the hero (headline, composer,
 * starters); from the first message the page splits into the chat and the Studio (preview, code, console, plan,
 * git, project). Below 760px of page width the two share the space behind a Chat / Studio switch.
 */
import { useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { MessageSquare, PanelsTopLeft } from 'lucide-react'
import { AgentWorkspace } from '@/components/agent-panel/AgentPanel'
import type { PanelChat } from '@/components/agent-panel/usePanelChat'
import { useElementWidth } from '@/hooks/useElementWidth'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/utils/cn'
import { BuildHero, BuildStarters } from './BuildHero'
import { BuildStudio } from './BuildStudio'
export * from './types'

/** Below this page width the chat and the Studio take turns behind a switch. A laptop window with the sidebar
 *  open leaves the page ~860px, which still splits (340px chat, the rest Studio). */
const SPLIT_MIN_WIDTH = 760

export function BuildWorkbenchPage() {
  const userId = useAuthStore((state) => state.user?.id || 'default')
  const [chat, setChat] = useState<PanelChat | null>(null)
  const started = Boolean(chat && (chat.messages.length > 0 || chat.status === 'running'))
  const pageRef = useRef<HTMLDivElement>(null)
  const pageWidth = useElementWidth(pageRef)
  const narrow = pageWidth > 0 && pageWidth < SPLIT_MIN_WIDTH
  const [view, setView] = useState<'chat' | 'studio'>('chat')
  const reduceMotion = useReducedMotion()
  const working = chat?.status === 'running'

  return (
    <div ref={pageRef} className="flex h-full min-h-0 flex-col">
      {started && narrow && (
        <div role="tablist" aria-label="Build view" className="flex h-11 shrink-0 items-center justify-center border-b border-surface-200/80 bg-surface-0 dark:border-surface-800 dark:bg-surface-900">
          <div className="flex items-center rounded-full bg-surface-100 p-0.5 dark:bg-surface-800">
            {([['chat', 'Chat', MessageSquare], ['studio', 'Studio', PanelsTopLeft]] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
                className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors',
                  view === id ? 'bg-surface-0 text-ink shadow-sm dark:bg-surface-900 dark:text-ink-inverse' : 'text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse')}>
                <Icon aria-hidden className="h-3.5 w-3.5" />{label}
                {id === 'studio' && working && view !== 'studio' && <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-volt" />}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className={cn('flex min-h-0 min-w-0 flex-col',
          !started ? 'flex-1' : narrow ? (view === 'chat' ? 'flex-1' : 'hidden') : 'w-[clamp(340px,38%,460px)] shrink-0')}>
          <AgentWorkspace destination="build" onChat={setChat} hero={() => <BuildHero />} heroFooter={(pick) => <BuildStarters pick={pick} />} />
        </div>
        {started && chat && (
          <motion.div key={chat.sessionId} className={cn('min-h-0 min-w-0 flex-1 border-l border-surface-200/80 dark:border-surface-800', narrow && view === 'chat' && 'hidden')}
            initial={reduceMotion ? false : { opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30, mass: 0.9 }}>
            <BuildStudio chat={chat} userId={userId} />
          </motion.div>
        )}
      </div>
    </div>
  )
}
export default BuildWorkbenchPage
