import { Fragment } from 'react'
import { Transition } from '@headlessui/react'
import { Music2Icon, XIcon } from 'lucide-react'
import { shouldShowMusicDeck, useLiveMusicStore } from '@/stores/liveMusicStore'
import { usePanelAgentStore } from '@/stores/panelAgentStore'
import { Button } from '@/components/ui/button'
import { MusicDeck } from './MusicDeck'
import { cn } from '@/utils/cn'

/**
 * Music side tab + slide-over for the Live Music deck.
 *
 * While Lyria RealTime is playing (or a take awaits saving) a tab sits on the browser's right edge,
 * outside the agent panel so it stays reachable whether or not the panel is open. Clicking it slides
 * the `MusicDeck` in with the same Headless UI `Transition` the agent panel uses. The deck carries
 * transport (play/pause/stop), volume, delete/discard, save, playlists and the position-pinned Edit box.
 */
export function MusicSidePanel() {
  const show = useLiveMusicStore(shouldShowMusicDeck)
  const open = useLiveMusicStore((state) => state.open)
  const setOpen = useLiveMusicStore((state) => state.setOpen)
  const playing = useLiveMusicStore((state) => state.playing)
  const agentId = useLiveMusicStore((state) => state.agentId)
  const userId = useLiveMusicStore((state) => state.userId)
  const panelWidth = usePanelAgentStore((state) => state.panelWidth)
  const width = Math.min(panelWidth, 420)

  if (!show) return null
  return <>
    <Transition show={!open} as={Fragment}
      enter="transform transition ease-smooth duration-300" enterFrom="translate-x-full opacity-0" enterTo="translate-x-0 opacity-100"
      leave="transform transition ease-smooth duration-200" leaveFrom="translate-x-0 opacity-100" leaveTo="translate-x-full opacity-0">
      <button type="button" onClick={() => setOpen(true)} aria-label="Open music deck" aria-expanded={false}
        className={cn(
          'absolute right-0 top-1/2 z-[70] -translate-y-1/2 rounded-l-xl border border-r-0 border-indigo-200/60 bg-white/90 py-3 pl-2 pr-1.5 text-indigo-600 shadow-lg backdrop-blur-xl',
          'hover:bg-indigo-50 dark:border-indigo-900/60 dark:bg-surface-900/90 dark:text-indigo-300 dark:hover:bg-surface-800',
          playing && 'motion-safe:animate-pulse-subtle',
        )}>
        <Music2Icon className="size-4" aria-hidden />
        <span className="sr-only">Music</span>
      </button>
    </Transition>

    <Transition show={open} as={Fragment}
      enter="transform transition ease-smooth duration-400" enterFrom="translate-x-full" enterTo="translate-x-0"
      leave="transform transition ease-smooth duration-400" leaveFrom="translate-x-0" leaveTo="translate-x-full">
      <aside aria-label="Music deck" className="absolute inset-y-0 right-0 z-[70] flex max-w-full flex-col border-l border-indigo-200/50 bg-white/95 text-ink shadow-2xl backdrop-blur-xl dark:border-indigo-900/50 dark:bg-surface-900/95 dark:text-ink-inverse"
        style={{ width }}>
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-indigo-100/50 px-4 py-3 dark:border-surface-800">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Music2Icon className="size-4 text-indigo-600 dark:text-indigo-300" aria-hidden />Live music</h2>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Close music deck" onClick={() => setOpen(false)}><XIcon /></Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 scrollbar-thin">
          <MusicDeck userId={userId} agentId={agentId} />
        </div>
      </aside>
    </Transition>
  </>
}
