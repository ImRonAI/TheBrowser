import { useEffect, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { AppWindow, Check, Monitor, X } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { ScreenShareRequest, ScreenShareSource } from '@/pages/types/electron'

type Kind = ScreenShareSource['kind']

/**
 * What to share with Ren: the screens and windows Electron's `desktopCapturer` lists, as thumbnails. The main
 * process asks (`screenShare.onChoose`) whenever a page of the shell calls `getDisplayMedia` (a live session, a
 * lesson, a screen recording) and hides the page view while this is open; `backdrop` is a still of that page.
 */
export function ScreenSharePicker() {
  const [request, setRequest] = useState<ScreenShareRequest | null>(null)
  const [kind, setKind] = useState<Kind>('screen')
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => window.electron?.screenShare?.onChoose((next) => {
    const first = next.sources.find((source) => source.kind === 'screen') ?? next.sources[0]
    setKind(first?.kind ?? 'screen')
    setSelected(first?.id ?? null)
    setRequest(next)
  }), [])

  const answer = (sourceId: string | null) => {
    if (!request) return
    window.electron?.screenShare?.choose(request.requestId, sourceId)
    setRequest(null)
  }

  const counts = { screen: 0, window: 0 }
  for (const source of request?.sources ?? []) counts[source.kind] += 1
  const shown = (request?.sources ?? []).filter((source) => source.kind === kind)
  const backdrop = request?.backdrop

  return (
    <DialogPrimitive.Root open={!!request} onOpenChange={(open) => { if (!open) answer(null) }}>
      <DialogPrimitive.Portal>
        {backdrop && (
          <img src={backdrop.image} alt="" aria-hidden className="pointer-events-none fixed z-[600] select-none object-cover"
            style={{ left: backdrop.x, top: backdrop.y, width: backdrop.width, height: backdrop.height }} />
        )}
        <DialogPrimitive.Overlay className="fixed inset-0 z-[600] bg-ink/35 backdrop-blur-[6px] dark:bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            const option = event.currentTarget instanceof HTMLElement ? event.currentTarget.querySelector('[role=option][aria-selected=true]') : null
            if (option instanceof HTMLElement) option.focus()
          }}
          className="fixed left-1/2 top-1/2 z-[601] flex max-h-[min(640px,calc(100vh-80px))] w-[min(680px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-surface-200 bg-white shadow-2xl outline-none dark:border-surface-800 dark:bg-surface-850 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]"
        >
          <header className="flex items-start gap-3 px-5 pb-3 pt-5">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[1.125rem] font-bold leading-tight tracking-[-0.015em] text-ink dark:text-ink-inverse">
                Share with Ren
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-body-sm text-ink-muted dark:text-ink-inverse-muted">
                Ren sees what you pick only while you share it.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close aria-label="Cancel" className="grid size-8 shrink-0 place-items-center rounded-[10px] text-ink-muted hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-surface-800 dark:hover:text-ink-inverse">
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>

          {counts.screen > 0 && counts.window > 0 && (
            <div role="tablist" aria-label="What to share" className="mx-5 mb-3 inline-flex w-fit gap-1 rounded-[10px] bg-surface-100 p-1 dark:bg-surface-900">
              {(['screen', 'window'] as const).map((value) => (
                <button key={value} type="button" role="tab" aria-selected={kind === value}
                  onClick={() => { setKind(value); setSelected(request?.sources.find((source) => source.kind === value)?.id ?? null) }}
                  className={cn('inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors',
                    kind === value
                      ? 'bg-white text-ink shadow-sm dark:bg-surface-700 dark:text-ink-inverse'
                      : 'text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse')}>
                  {value === 'screen' ? <Monitor className="size-4" /> : <AppWindow className="size-4" />}
                  {value === 'screen' ? 'Screens' : 'Windows'}
                  <span className="font-mono text-[11px] text-ink-muted dark:text-ink-inverse-muted">{counts[value]}</span>
                </button>
              ))}
            </div>
          )}

          <div role="listbox" aria-label={kind === 'screen' ? 'Screens' : 'Windows'}
            className={cn('grid min-h-0 flex-1 gap-3 overflow-y-auto px-5 pb-1 pt-1', kind === 'screen' ? 'grid-cols-2' : 'grid-cols-3')}>
            {shown.map((source) => (
              <SourceCard key={source.id} source={source} selected={source.id === selected}
                onSelect={() => setSelected(source.id)} onShare={() => answer(source.id)} />
            ))}
          </div>

          <footer className="mt-3 flex items-center justify-end gap-2 border-t border-surface-200 px-5 py-3 dark:border-surface-800">
            <DialogPrimitive.Close className="h-9 rounded-[10px] px-4 text-[13px] font-medium text-ink-secondary hover:bg-surface-100 dark:text-ink-inverse-secondary dark:hover:bg-surface-800">
              Cancel
            </DialogPrimitive.Close>
            <button type="button" disabled={!selected} onClick={() => answer(selected)}
              className="h-9 rounded-[10px] bg-blurple-600 px-4 text-[13px] font-semibold text-white hover:bg-blurple-700 disabled:opacity-40 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300">
              Share
            </button>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function SourceCard({ source, selected, onSelect, onShare }: { source: ScreenShareSource; selected: boolean; onSelect: () => void; onShare: () => void }) {
  return (
    <button type="button" role="option" aria-selected={selected} title={source.name}
      onClick={onSelect} onDoubleClick={onShare} onFocus={onSelect}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onShare() } }}
      className={cn('group flex min-w-0 flex-col gap-2 rounded-xl border p-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blurple-600 dark:focus-visible:ring-blurple-400',
        selected
          ? 'border-blurple-600 bg-blurple-50 dark:border-blurple-400 dark:bg-blurple-400/10'
          : 'border-surface-200 hover:border-surface-300 hover:bg-surface-50 dark:border-surface-800 dark:hover:border-surface-700 dark:hover:bg-surface-800/60')}>
      <span className="relative block aspect-[16/10] w-full overflow-hidden rounded-lg bg-surface-100 dark:bg-surface-900">
        {source.thumbnail
          ? <img src={source.thumbnail} alt="" className="size-full object-contain" draggable={false} />
          : <span className="grid size-full place-items-center text-ink-muted dark:text-ink-inverse-muted">
              {source.kind === 'screen' ? <Monitor className="size-6" /> : <AppWindow className="size-6" />}
            </span>}
        {selected && (
          <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-blurple-600 text-white dark:bg-blurple-400 dark:text-ink">
            <Check className="size-3" strokeWidth={3} />
          </span>
        )}
      </span>
      <span className="flex min-w-0 items-center gap-2 px-0.5">
        {source.icon
          ? <img src={source.icon} alt="" className="size-4 shrink-0" draggable={false} />
          : source.kind === 'screen'
            ? <Monitor className="size-4 shrink-0 text-ink-muted dark:text-ink-inverse-muted" />
            : <AppWindow className="size-4 shrink-0 text-ink-muted dark:text-ink-inverse-muted" />}
        <span className="truncate text-[13px] font-medium text-ink dark:text-ink-inverse">{source.name}</span>
      </span>
    </button>
  )
}
