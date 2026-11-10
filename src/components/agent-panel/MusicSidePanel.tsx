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
      {/* The wrapper takes the slide; the tab keeps its own colour transition. */}
      <div className="absolute right-0 top-1/2 z-[70] -translate-y-1/2">
        <button type="button" onClick={() => setOpen(true)} aria-label="Open music deck" aria-expanded={false}
          title={playing ? 'Open music deck · playing' : 'Open music deck'}
          className={cn(
            'flex flex-col items-center gap-2 rounded-l-xl bg-ink py-3 pl-2.5 pr-2 text-white shadow-float transition-colors duration-150',
            'hover:bg-surface-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple-600/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0',
            'dark:bg-ink-inverse dark:text-ink dark:hover:bg-surface-200 dark:focus-visible:ring-blurple-400/70 dark:focus-visible:ring-offset-surface-900',
          )}>
          {playing && <span aria-hidden className="size-1.5 rounded-full bg-blurple-400 dark:bg-blurple-600" />}
          <Music2Icon className="size-4" aria-hidden />
          <span aria-hidden className="rotate-180 font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.14em] [writing-mode:vertical-rl]">Music</span>
          <span className="sr-only">Music</span>
        </button>
      </div>
    </Transition>

    <Transition show={open} as={Fragment}
      enter="transform transition ease-smooth duration-400" enterFrom="translate-x-full" enterTo="translate-x-0"
      leave="transform transition ease-smooth duration-400" leaveFrom="translate-x-0" leaveTo="translate-x-full">
      <aside aria-label="Music deck" className="absolute inset-y-0 right-0 z-[70] flex max-w-full flex-col"
        style={{ width }}>
        <div className="ron-glass-panel flex h-full min-h-0 flex-col border-l border-surface-200 bg-surface-0 text-ink shadow-float dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse">
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-surface-200 px-4 pb-3.5 pt-4 dark:border-surface-800">
            <div className="min-w-0">
              <p className="tag-label tag-label-slash">Studio</p>
              <h2 className="mt-1.5 flex items-center gap-2 font-display text-xl font-bold leading-none tracking-[-0.025em]">
                <Music2Icon className="size-[18px] text-blurple-600 dark:text-blurple-400" aria-hidden />Live music
              </h2>
            </div>
            <Button type="button" size="icon-sm" variant="ghost" aria-label="Close music deck" title="Close music deck"
              className="rounded-lg text-ink-secondary hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse"
              onClick={() => setOpen(false)}><XIcon /></Button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 scrollbar-thin">
            <MusicDeck userId={userId} agentId={agentId} />
          </div>
        </div>
      </aside>
    </Transition>
  </>
}
