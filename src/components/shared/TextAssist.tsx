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
      // The field may be a textarea (whose only role is textbox): textbox-safe properties, never the combobox role.
      ...assistFieldAria(assist.id, focused ? assist.options.length : 0, assist.active, false),
    })}
    {focused && <TextAssist assist={assist} placement={placement} onPick={apply} onCorrect={apply} />}
  </div>
}

/**
 * The assist listbox for any free-text field, driven by `useTextAssist`: the spelling correction leads, then Brave's
 * suggestions (`assist.options`). Positioned by the parent (`placement`): below for single-line bars, above for
 * composers that sit at the bottom of a panel. Focus stays in the field, which points at the highlighted row
 * (`aria-activedescendant`); mouse-down is prevented so picking a row does not blur the field first. Entity
 * suggestions show Brave's title/description/image when the Autosuggest plan returns them (`rich`); plain `query`
 * suggestions are one line. A polite status region says what appeared.
 */
export function TextAssist({ assist, onPick, onCorrect, placement = 'below', className, compact = false }: {
  assist: TextAssistState
  onPick: (text: string, suggestion: Suggestion) => void
  onCorrect: (text: string) => void
  placement?: 'above' | 'below'
  className?: string
  compact?: boolean
}) {
  const { id, options, suggestions, correction, active, setActive, pick } = assist
  const list = useRef<HTMLUListElement>(null)
  // The field keeps focus, so the list keeps the highlighted row in view itself (it scrolls past max-h-72).
  useEffect(() => {
    const scroller = list.current
    const row = scroller && active >= 0 ? scroller.children[active] : null
    if (!scroller || !(row instanceof HTMLElement)) return
    scroller.scrollTop += revealDelta(row.offsetTop, row.offsetHeight, scroller.scrollTop, scroller.clientHeight, 4)
  }, [active, options])
  return <Fragment>
    <span role="status" className="sr-only">{assistAnnouncement(correction, suggestions.length)}</span>
    {options.length > 0 && <div
      className={cn('absolute left-0 right-0 z-[80] overflow-hidden rounded-xl border border-border bg-popover text-[13px] text-popover-foreground shadow-float',
        placement === 'below' ? 'top-full mt-1.5' : 'bottom-full mb-1.5', className)}>
      <ul ref={list} id={assistListboxId(id)} role="listbox" aria-label="Suggestions" className="relative max-h-72 overflow-y-auto p-1">
        {options.map((option, index) => <li key={assistOptionKey(option)} id={assistOptionId(id, index)} role="option" aria-selected={active === index}
          onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)}
          onClick={() => option.kind === 'correction' ? onCorrect(option.text) : onPick(pick(option.suggestion), option.suggestion)}
          className={cn('flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 transition-colors duration-100',
            compact ? 'min-h-8 py-1' : 'min-h-9 py-1.5',
            active === index ? 'bg-muted text-foreground' : 'hover:bg-muted/60')}>
          {option.kind === 'correction' ? <>
            <SpellCheck className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="shrink-0 text-muted-foreground">Did you mean</span>
            <span className="min-w-0 flex-1 truncate font-semibold text-blurple-700 dark:text-blurple-300">{option.text}</span>
          </> : <>
            {option.suggestion.img
              ? <img src={option.suggestion.img} alt="" className="size-6 shrink-0 rounded-md object-cover" />
              : <Search className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{option.suggestion.title ?? option.suggestion.query}</span>
              {option.suggestion.description && <span className="block truncate text-[12px] text-muted-foreground">{option.suggestion.description}</span>}
            </span>
            {option.suggestion.type !== 'query' && <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{option.suggestion.type}</span>}
          </>}
          {active === index && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        </li>)}
      </ul>
    </div>}
  </Fragment>
}

/**
 * Keyboard handling shared by every host (`assistKeyAction`): ↑/↓ move the highlight through the correction and the
 * suggestions, Enter/Tab accept the highlighted row, Escape closes the list; in a textarea the arrows stay with the
 * caret until the list is in use. Consumed keys are `defaultPrevented`; returns true when the key was consumed. An
 * accepted correction goes to `onCorrect`, which defaults to `onPick` for hosts that treat both alike.
 */
export function handleAssistKey(event: React.KeyboardEvent, assist: TextAssistState,
  onPick: (text: string, suggestion?: Suggestion) => void, onCorrect: (text: string) => void = onPick): boolean {
  // An IME composition owns the arrows and Enter until it commits.
  if (event.nativeEvent.isComposing) return false
  const field = event.currentTarget
  const editable = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field : null
  const action = assistKeyAction(event.key, {
    options: assist.options.length,
    active: assist.active,
    hasSuggestions: assist.suggestions.length > 0,
    multiline: field instanceof HTMLTextAreaElement,
    caretAtEnd: !!editable && editable.selectionStart === editable.value.length && editable.selectionEnd === editable.value.length,
  })
  if (!action) return false
  event.preventDefault()
  if (action.type === 'move') assist.move(action.delta)
  else if (action.type === 'dismiss') assist.dismiss()
  else {
    const option = assist.options[assist.active]
    if (option?.kind === 'correction') onCorrect(option.text)
    else if (option) onPick(assist.pick(option.suggestion), option.suggestion)
  }
  return true
}
