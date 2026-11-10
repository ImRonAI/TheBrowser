/**
 * Live preview of what Ren built (AI Elements WebPreview): the workspace's static `index.html` served by the API
 * (`/build/preview/<workspace>/`, CSP-sandboxed) and every local dev server Ren started (URLs found in its commands
 * and replies). The static preview reloads whenever a file it can load changes; dev servers reload themselves.
 * Tablet and phone render at their real viewport width, scaled down when the pane is narrower.
 */
import { useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Monitor, MonitorPlay, RotateCw, Smartphone, Tablet } from 'lucide-react'
import { WebPreview, WebPreviewBody, WebPreviewNavigation, WebPreviewNavigationButton, WebPreviewUrl } from '@/components/ai-elements/web-preview'
import { openResult } from '@/components/search/open-result'
import { useElementWidth } from '@/hooks/useElementWidth'
import { cn } from '@/utils/cn'
import { StudioEmpty } from './shared'

type Device = 'desktop' | 'tablet' | 'mobile'
const DEVICES: { id: Device; label: string; width: number | null; icon: typeof Monitor }[] = [
  { id: 'desktop', label: 'Desktop', width: null, icon: Monitor },
  { id: 'tablet', label: 'Tablet (834px)', width: 834, icon: Tablet },
  { id: 'mobile', label: 'Phone (390px)', width: 390, icon: Smartphone },
]

/** The device stage's padding (p-4) on both sides. */
const STAGE_GUTTER = 32

interface Source { id: string; label: string; url: string }

const hostLabel = (url: string) => { try { return new URL(url).host } catch { return url } }

export function PreviewPane({ staticUrl, servers, version }: {
  /** Absolute URL of the static preview, or null when the workspace has no root index.html. */
  staticUrl: string | null
  servers: string[]
  /** Changes whenever a file the static preview can load changes (`previewVersion`). */
  version: string
}) {
  const sources = useMemo<Source[]>(() => [
    ...servers.map((url) => ({ id: url, label: hostLabel(url), url })),
    ...(staticUrl ? [{ id: 'static', label: 'index.html', url: staticUrl }] : []),
  ], [servers, staticUrl])
  const [picked, setPicked] = useState<string | null>(null)
  // The newest dev server wins (it serves the app as built); the static index.html is the fallback.
  const source = sources.find((item) => item.id === picked) ?? sources.at(-1 - (staticUrl ? 1 : 0)) ?? sources[0]
  const [device, setDevice] = useState<Device>('desktop')
  const [reloads, setReloads] = useState(0)
  const [typed, setTyped] = useState<{ source: string; url: string } | null>(null)
  // The pane's root is always rendered, so it is measured from the first mount, preview or not.
  const paneRef = useRef<HTMLDivElement>(null)
  const paneWidth = useElementWidth(paneRef)

  if (!source) return (
    <div ref={paneRef} className="h-full">
      <StudioEmpty icon={MonitorPlay} title="Nothing to preview yet">
        Ren shows the workspace’s <code className="font-mono text-[12px]">index.html</code> here, or the dev server it starts, as soon as one exists.
      </StudioEmpty>
    </div>
  )

  const width = DEVICES.find((item) => item.id === device)?.width ?? null
  // A device keeps its viewport width (the page's media queries see a tablet or a phone) and is scaled to fit.
  const scale = width && paneWidth > STAGE_GUTTER ? Math.min(1, (paneWidth - STAGE_GUTTER) / width) : 1
  const current = typed?.source === source.url ? typed.url : source.url
  const frameKey = `${source.url}#${reloads}#${source.id === 'static' ? version : ''}`
  return (
    <div ref={paneRef} className="h-full">
      <WebPreview key={source.url} defaultUrl={source.url} onUrlChange={(url) => setTyped({ source: source.url, url })}
        className="rounded-none border-0 bg-transparent">
        <WebPreviewNavigation className="h-11 shrink-0 gap-1 border-surface-200/80 px-2 py-0 dark:border-surface-800">
          <WebPreviewNavigationButton tooltip="Reload" aria-label="Reload the preview" onClick={() => setReloads((count) => count + 1)}>
            <RotateCw className="h-4 w-4" />
          </WebPreviewNavigationButton>
          <WebPreviewUrl aria-label="Preview address"
            className="h-8 min-w-0 flex-1 rounded-lg border-surface-200 bg-surface-50 font-mono text-[12px] shadow-none dark:border-surface-800 dark:bg-surface-950" />
          {width !== null && scale < 1 && (
            <span className="ml-1 hidden shrink-0 font-mono text-[11px] tabular-nums text-ink-muted dark:text-ink-inverse-muted sm:inline"
              title={`Shown at ${Math.round(scale * 100)}% to fit the pane; the page sees a ${width}px viewport`}>
              {Math.round(scale * 100)}%
            </span>
          )}
          <div role="radiogroup" aria-label="Preview width" className="ml-1 hidden items-center rounded-lg bg-surface-100 p-0.5 dark:bg-surface-800 sm:flex">
            {DEVICES.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" role="radio" aria-checked={device === id} title={label} aria-label={label} onClick={() => setDevice(id)}
                className={cn('inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                  device === id ? 'bg-surface-0 text-ink shadow-sm dark:bg-surface-900 dark:text-ink-inverse' : 'text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse')}>
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
          <WebPreviewNavigationButton tooltip="Open in a new tab" aria-label="Open the preview in a new tab" onClick={() => openResult(current)}>
            <ArrowUpRight className="h-4 w-4" />
          </WebPreviewNavigationButton>
        </WebPreviewNavigation>
        {sources.length > 1 && (
          <div role="radiogroup" aria-label="What to preview" className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-surface-200/80 px-3 py-2 scrollbar-none dark:border-surface-800">
            {sources.map((item) => (
              <button key={item.id} type="button" role="radio" aria-checked={item.id === source.id} onClick={() => setPicked(item.id)}
                className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[11px] transition-colors',
                  item.id === source.id
                    ? 'border-blurple-300 bg-blurple-50 text-blurple-700 dark:border-blurple-800 dark:bg-blurple-950/60 dark:text-blurple-200'
                    : 'border-surface-200 text-ink-muted hover:text-ink dark:border-surface-800 dark:text-ink-inverse-muted dark:hover:text-ink-inverse')}>
                <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', item.id === 'static' ? 'bg-ink-muted' : 'bg-emerald-500')} />
                {item.label}
              </button>
            ))}
          </div>
        )}
        {/* One structure for every width, so switching devices never reloads the page. The slot takes the scaled size;
            the frame inside keeps the device's width (and the height that fills the slot once scaled). */}
        <div className={cn('flex min-h-0 flex-1 justify-center overflow-hidden', width && 'bg-surface-100 p-4 dark:bg-surface-950')}>
          <div className="relative h-full shrink-0" style={{ width: width ? `${width * scale}px` : '100%' }}>
            <div className={cn('absolute left-0 top-0 flex flex-col bg-white', width && 'overflow-hidden rounded-xl shadow-float ring-1 ring-black/5')}
              style={width
                ? { width: `${width}px`, height: `${100 / scale}%`, transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: 'top left' }
                : { width: '100%', height: '100%' }}>
              <WebPreviewBody key={frameKey} className="border-0 bg-white" title={`Preview of ${source.label}`} />
            </div>
          </div>
        </div>
      </WebPreview>
    </div>
  )
}
