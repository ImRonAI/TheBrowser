import { useEffect, useRef, useState, type ReactNode } from 'react'
import { JSXPreview, JSXPreviewContent, JSXPreviewError } from '@/components/ai-elements/jsx-preview'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ai-elements/card'
import { Badge } from '@/components/ai-elements/badge'
import { Button } from '@/components/ai-elements/button'
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ai-elements/carousel'
import { Workflow, WorkflowEdge, WorkflowNode } from '@/components/workflow/WorkflowJsx'
import type { UiView as UiViewData } from '@/lib/panel-stream'
import type { JSXPreviewProps } from '@/components/ai-elements/jsx-preview'

/** Components a `render_ui` / `render_workflow` JSX fragment may use (markup only; expressions are not executed). */
const JSX_COMPONENTS = { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Badge, Button,
  Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious,
  Workflow, WorkflowNode, WorkflowEdge } as unknown as NonNullable<JSXPreviewProps['components']>

/** `window.parent.postMessage({type:'ron:ui_action', action, payload}, '*')` from inside an html view. */
export interface UiActionMessage { type: 'ron:ui_action'; action: unknown; payload: unknown }

/**
 * One rendered `render_ui` view. `html` runs in a sandboxed iframe (scripts allowed, no same-origin:
 * the document cannot reach the renderer's DOM, storage or IPC bridge); `jsx` renders with the
 * AI Elements kit. Actions posted by the document are forwarded to `onAction`, which the panel
 * turns into a `[ui_action]` user turn.
 */
export function UiView({ view, onAction, superseded }: { view: UiViewData; onAction: (action: unknown, payload: unknown) => void; superseded?: boolean }) {
  const frame = useRef<HTMLIFrameElement | null>(null)
  const [height, setHeight] = useState(view.height)
  useEffect(() => { setHeight(view.height) }, [view.height, view.source])
  useEffect(() => {
    if (view.format !== 'html') return
    const listener = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return
      const data = event.data as { type?: unknown; action?: unknown; payload?: unknown; height?: unknown } | null
      if (!data || typeof data !== 'object') return
      if (data.type === 'ron:ui_action') onAction(data.action, data.payload)
      else if (data.type === 'ron:ui_resize' && typeof data.height === 'number' && Number.isFinite(data.height)) setHeight(Math.max(240, Math.min(Math.round(data.height), 2000)))
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [view.format, onAction])

  if (superseded) {
    return <details className="my-2 text-xs text-ink-muted dark:text-ink-inverse-muted"><summary className="cursor-pointer">Earlier version of {view.title || view.viewId} (replaced below)</summary></details>
  }
  let body: ReactNode
  if (view.format === 'html') {
    body = <iframe ref={frame} title={view.title || `View ${view.viewId}`} srcDoc={view.source} style={{ height }}
      className="w-full rounded-lg border-0 bg-white dark:bg-surface-900"
      // oxlint-disable-next-line eslint-plugin-react(iframe-missing-sandbox)
      sandbox="allow-scripts allow-forms allow-popups allow-presentation" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" />
  } else {
    body = <div className="p-3"><JSXPreview jsx={view.source} components={JSX_COMPONENTS}><JSXPreviewContent /><JSXPreviewError /></JSXPreview></div>
  }
  return <section className="my-3 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-700" aria-label={view.title || 'Rendered view'}>
    {view.title && <header className="border-b border-surface-200 px-3 py-1.5 text-xs font-medium dark:border-surface-700">{view.title}</header>}
    {body}
  </section>
}
