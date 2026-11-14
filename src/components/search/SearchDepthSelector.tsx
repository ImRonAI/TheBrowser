/**
 * The search reasoning level as a dropdown select: every search runs at this preset
 * (fast/low/medium/high/xhigh, `LEVEL_INFO`). Persisted in the search store. Used by the
 * sidebar's search composer (`sm`) and the home page's search bar (`md`).
 */
import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSearchStore } from '@/stores/searchStore'
import { LEVEL_INFO } from '@/lib/search-api'
import { cn } from '@/utils/cn'

const TRIGGER = {
  sm: 'h-6 gap-1 pl-2 pr-1.5 text-[12px]',
  md: 'h-9 gap-1.5 pl-3.5 pr-2.5 text-[13px]',
} as const

export function SearchDepthSelector({ size = 'sm', align = 'end' }: { size?: keyof typeof TRIGGER; align?: 'start' | 'end' }) {
  const { level, setLevel } = useSearchStore()
  const [open, setOpen] = useState(false)
  const active = LEVEL_INFO.find((info) => info.id === level)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Reasoning effort: ${active?.label ?? level}`}
          title="Reasoning effort"
          className={cn(
            'flex flex-shrink-0 items-center rounded-full font-medium',
            'text-ink-secondary transition-colors duration-150 ease-out hover:bg-surface-100 hover:text-ink data-[state=open]:bg-surface-100 data-[state=open]:text-ink',
            'dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse dark:data-[state=open]:bg-surface-800 dark:data-[state=open]:text-ink-inverse',
            TRIGGER[size],
          )}
        >
          {size === 'md' && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-volt" />}
          <span>{active?.label ?? level}</span>
          <ChevronDown className={cn(size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3', 'opacity-70 transition-transform duration-200', open && 'rotate-180')} />
        </button>
      </PopoverTrigger>
      {/* `data-[state=open]:shadow-float`: outranks the primitive's own shadow-md, still yields to Glass.
          Contained like the context menu: a fixed narrow width, right edge on the trigger's (the search
          card's), and a list capped at 300px or the room Radix reports to the window edge, scrolling past that. */}
      <PopoverContent
        align={align}
        side="bottom"
        sideOffset={6}
        collisionPadding={16}
        className="z-[200] flex w-64 flex-col rounded-xl border-border p-1 data-[state=open]:shadow-float"
        style={{ maxHeight: 'min(300px, var(--radix-popover-content-available-height))' }}
      >
        <p className="px-2.5 pb-1 pt-1.5 text-[12px] font-medium text-muted-foreground">Reasoning effort</p>
        <div role="listbox" aria-label="Reasoning effort" className="min-h-0 overflow-y-auto overscroll-contain">
          {LEVEL_INFO.map((info) => {
            const isActive = info.id === level
            return (
              <button
                key={info.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  setLevel(info.id)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 ease-out focus-visible:ring-inset focus-visible:ring-offset-0',
                  isActive ? 'bg-muted' : 'hover:bg-muted/70',
                )}
              >
                <span className={cn('mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center', !isActive && 'opacity-0')}>
                  <Check className="h-3.5 w-3.5 text-volt" strokeWidth={2.5} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-popover-foreground">{info.label}</span>
                  <span className="mt-px block text-[11.5px] leading-snug text-muted-foreground">
                    {info.description}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
