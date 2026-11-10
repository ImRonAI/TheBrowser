import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { CornerDownLeft, Search, SpellCheck } from 'lucide-react'
import {
  assistAnnouncement, assistFieldAria, assistKeyAction, assistListboxId, assistOptionId, assistOptionKey,
  type AssistFieldAria, type Suggestion,
} from '@/lib/text-assist'
import { revealDelta } from '@/lib/tab-strip'
import { useTextAssist, type TextAssistState, type UseTextAssistOptions } from '@/hooks/useTextAssist'
import { cn } from '@/utils/cn'

/** What `AssistField` hands its field: the key handler, focus tracking and the ARIA that ties the field to its suggestions. */
export type AssistFieldProps = {
  onKeyDown: (event: React.KeyboardEvent) => void
  onFocus: () => void
  onBlur: () => void
} & AssistFieldAria

/**
 * Wrap any controlled `<input>`/`<textarea>` with Brave assist. The child is rendered via a
 * function that receives the key handler and focus/blur callbacks to spread onto the element, so
 * the field keeps its own `value`/`onChange`. Picking a suggestion or correction calls `onChange`
 * with the replacement text. Defaults to spellcheck only (long-form fields); pass
 * `suggest` for query-like fields. The field also receives `aria-autocomplete`, `aria-controls` and
 * `aria-activedescendant` (properties a textarea may carry too), so a screen reader follows the highlight.
 */
export function AssistField({ value, onChange, children, placement = 'below', className, ...options }: {
  value: string
  onChange: (text: string) => void
  children: (field: AssistFieldProps) => ReactNode
  placement?: 'above' | 'below'
  className?: string
} & UseTextAssistOptions) {
  const [focused, setFocused] = useState(false)
  const assist = useTextAssist(value, { suggest: false, enabled: focused, ...options })
  const apply = (text: string) => { onChange(text); assist.dismiss() }
  return <div className={cn('relative', className)}>
    {children({
      // Consumed assist keys (↑/↓/Enter/Tab on a highlighted suggestion, Esc) are marked
      // defaultPrevented so a host's own Enter-to-submit handler can skip them.
      onKeyDown: (event) => { handleAssistKey(event, assist, apply) },
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
      ...assistComboboxProps(assist, false),
    })}
    {focused && <TextAssist assist={assist} placement={placement} onPick={apply} onCorrect={apply} />}
  </div>
}

/**
 * Suggestions popover + spelling-correction chip for any free-text field, driven by
 * `useTextAssist`. Positioned by the parent (`placement`): below for single-line bars, above for
 * composers that sit at the bottom of a panel. Mouse-down is prevented so picking a suggestion
 * does not blur the field first. Entity suggestions show Brave's title/description/image when the
 * Autosuggest plan returns them (`rich`); plain `query` suggestions are one line.
 */
export function TextAssist({ assist, onPick, onCorrect, placement = 'below', className, compact = false }: {
  assist: TextAssistState
  onPick: (text: string, suggestion: Suggestion) => void
  onCorrect: (text: string) => void
  placement?: 'above' | 'below'
  className?: string
  compact?: boolean
}) {
  const { suggestions, correction, active, setActive, pick } = assist
  if (!suggestions.length && !correction) return null
  return <div role="group" aria-label="Text assist"
    className={cn('absolute left-0 right-0 z-[80] overflow-hidden rounded-xl border border-border bg-popover text-[13px] text-popover-foreground shadow-float',
      placement === 'below' ? 'top-full mt-1.5' : 'bottom-full mb-1.5', className)}>
    {correction && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onCorrect(correction)}
      className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left transition-colors duration-150 hover:bg-muted focus-visible:ring-inset focus-visible:ring-offset-0"
      aria-label={`Replace with corrected spelling: ${correction}`}>
      <SpellCheck className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-muted-foreground">Did you mean</span>
      <span className="min-w-0 truncate font-semibold text-blurple-700 dark:text-blurple-300">{correction}</span>
    </button>}
    {suggestions.length > 0 && <ul role="listbox" aria-label="Suggestions" className="max-h-72 overflow-y-auto p-1">
      {suggestions.map((suggestion, index) => <li key={`${suggestion.type}:${suggestion.query}`} role="option" aria-selected={active === index}>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)}
          onClick={() => onPick(pick(suggestion), suggestion)}
          className={cn('group/suggestion flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors duration-100',
            compact ? 'min-h-8 py-1' : 'min-h-9 py-1.5',
            active === index ? 'bg-muted text-foreground' : 'hover:bg-muted/60')}>
          {suggestion.img
            ? <img src={suggestion.img} alt="" className="size-6 shrink-0 rounded-md object-cover" />
            : <Search className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className="block truncate">{suggestion.title ?? suggestion.query}</span>
            {suggestion.description && <span className="block truncate text-[12px] text-muted-foreground">{suggestion.description}</span>}
          </span>
          {suggestion.type !== 'query' && <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{suggestion.type}</span>}
          {active === index && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        </button>
      </li>)}
    </ul>}
  </div>
}

/**
 * Keyboard handling shared by every host: ↑/↓ move through suggestions, Enter/Tab accept the
 * highlighted one, Escape dismisses. Returns true when the key was consumed.
 */
export function handleAssistKey(event: React.KeyboardEvent, assist: TextAssistState, onPick: (text: string, suggestion: Suggestion) => void): boolean {
  if (!assist.suggestions.length) {
    if (event.key === 'Escape' && assist.correction) { event.preventDefault(); assist.dismiss(); return true }
    return false
  }
  if (event.key === 'ArrowDown') { event.preventDefault(); assist.move(1); return true }
  if (event.key === 'ArrowUp') { event.preventDefault(); assist.move(-1); return true }
  if ((event.key === 'Enter' || event.key === 'Tab') && assist.active >= 0) {
    event.preventDefault()
    const suggestion = assist.suggestions[assist.active]
    onPick(assist.pick(suggestion), suggestion)
    return true
  }
  if (event.key === 'Escape') { event.preventDefault(); assist.dismiss(); return true }
  return false
}
