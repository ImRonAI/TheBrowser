import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { GripHorizontal } from 'lucide-react'
import { clampHeight, EMBED_HEIGHT } from '@/lib/editor-blocks'
import { cn } from '@/lib/utils'

/**
 * The frame of an atom block (embed, PDF, issue, chat, …): not editable text. A hairline card that
 * turns volt while selected; its header actions show on hover, focus or selection.
 */
export function BlockFrame({ selected, className, children, ...data }: {
  selected: boolean
  className?: string
  children: ReactNode
  [key: `data-${string}`]: string | undefined
}) {
  return <NodeViewWrapper contentEditable={false} data-selected={selected ? 'true' : undefined} {...data}
    className={cn('ron-block group/block not-prose my-4 overflow-hidden rounded-xl border bg-surface-0 transition-colors duration-150 dark:bg-surface-900',
      selected
        ? 'border-blurple-600 ring-1 ring-blurple-600 dark:border-blurple-400 dark:ring-blurple-400'
        : 'border-surface-200 hover:border-surface-300 dark:border-surface-800 dark:hover:border-surface-700',
      className)}>
    {children}
  </NodeViewWrapper>
}

export function BlockHeader({ icon, title, subtitle, children }: { icon: ReactNode; title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return <div className="flex items-center gap-2.5 border-b border-surface-200 px-3 py-2 dark:border-surface-800">
    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-100 text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary">{icon}</span>
    <div className="min-w-0 flex-1">
      <p className="truncate text-[13px] font-semibold text-ink dark:text-ink-inverse">{title}</p>
      {subtitle && <p className="truncate text-[12px] text-muted-foreground">{subtitle}</p>}
    </div>
    {children && <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/block:opacity-100 group-data-[selected=true]/block:opacity-100">{children}</div>}
  </div>
}

export function IconButton({ label, onClick, children, className, disabled }: { label: string; onClick: () => void; children: ReactNode; className?: string; disabled?: boolean }) {
  return <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}
    className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary transition-colors duration-150 enabled:hover:bg-surface-100 enabled:hover:text-ink disabled:opacity-40 dark:text-ink-inverse-secondary dark:enabled:hover:bg-surface-850 dark:enabled:hover:text-ink-inverse', className)}>
    {children}
  </button>
}

/**
 * A drag handle under an embed that changes its height; the new height is stored on the node when the
 * drag ends. Pointer capture keeps the drag going over the iframe.
 */
export function useResizableHeight(stored: unknown, fallback: number, commit: (height: number) => void) {
  const saved = clampHeight(stored, fallback)
  const [height, setHeight] = useState(saved)
  const drag = useRef<{ startY: number; startHeight: number } | null>(null)
  useEffect(() => { if (!drag.current) setHeight(saved) }, [saved])
  const handle = (label: string) => <button type="button" aria-label={label} title="Drag to resize"
    data-block-resize=""
    className="flex h-3 w-full cursor-row-resize items-center justify-center border-t border-surface-200 text-ink-muted transition-colors duration-150 hover:bg-surface-100 hover:text-ink-secondary dark:border-surface-800 dark:text-ink-inverse-muted dark:hover:bg-surface-850 dark:hover:text-ink-inverse-secondary"
    onPointerDown={(event) => {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { startY: event.clientY, startHeight: height }
    }}
    onPointerMove={(event) => {
      if (!drag.current) return
      setHeight(Math.min(EMBED_HEIGHT.max, Math.max(EMBED_HEIGHT.min, drag.current.startHeight + event.clientY - drag.current.startY)))
    }}
    onPointerUp={(event) => {
      if (!drag.current) return
      event.currentTarget.releasePointerCapture(event.pointerId)
      drag.current = null
      commit(Math.round(height))
    }}
    onKeyDown={(event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      const next = clampHeight(height + (event.key === 'ArrowDown' ? 40 : -40), fallback)
      setHeight(next)
      commit(next)
    }}>
    <GripHorizontal className="size-3" />
  </button>
  return { height, handle }
}

/** An inline form row used by blocks that edit their own source (embed URL, button prompt). */
export function FieldError({ children }: { children: ReactNode }) {
  return children ? <p role="alert" className="text-[12px] text-red-600 dark:text-red-400">{children}</p> : null
}
