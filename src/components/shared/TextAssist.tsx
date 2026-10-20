import { useState, type ReactNode } from 'react'
import { SparklesIcon } from 'lucide-react'
import type { Suggestion } from '@/lib/text-assist'
import { useTextAssist, type TextAssistState, type UseTextAssistOptions } from '@/hooks/useTextAssist'
import { cn } from '@/utils/cn'

/**
 * Wrap any controlled `<input>`/`<textarea>` with Brave assist. The child is rendered via a
 * function that receives the key handler and focus/blur callbacks to spread onto the element, so
 * the field keeps its own `value`/`onChange`. Picking a suggestion or correction calls `onChange`
 * with the replacement text. Defaults to spellcheck only (long-form fields); pass
 * `suggest` for query-like fields.
 */
export function AssistField({ value, onChange, children, placement = 'below', className, ...options }: {
  value: string
  onChange: (text: string) => void
  children: (field: { onKeyDown: (event: React.KeyboardEvent) => void; onFocus: () => void; onBlur: () => void }) => ReactNode
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
    className={cn('absolute left-0 right-0 z-[80] overflow-hidden rounded-xl border border-surface-200 bg-white text-xs shadow-lg dark:border-surface-700 dark:bg-surface-900',
      placement === 'below' ? 'top-full mt-1.5' : 'bottom-full mb-1.5', className)}>
    {correction && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onCorrect(correction)}
      className="flex w-full items-center gap-2 border-b border-surface-100 px-3 py-2 text-left hover:bg-indigo-50 dark:border-surface-800 dark:hover:bg-surface-800"
      aria-label={`Replace with corrected spelling: ${correction}`}>
      <span className="text-ink-muted dark:text-ink-inverse-muted">Did you mean</span>
      <span className="font-semibold text-indigo-700 dark:text-indigo-300">{correction}</span>
    </button>}
    {suggestions.length > 0 && <ul role="listbox" aria-label="Suggestions" className="max-h-72 overflow-y-auto p-1">
      {suggestions.map((suggestion, index) => <li key={`${suggestion.type}:${suggestion.query}`} role="option" aria-selected={active === index}>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)}
          onClick={() => onPick(pick(suggestion), suggestion)}
          className={cn('flex w-full items-center gap-2 rounded-lg px-3 text-left', compact ? 'py-1.5' : 'py-2',
            active === index ? 'bg-indigo-50 dark:bg-surface-800' : 'hover:bg-surface-50 dark:hover:bg-surface-850')}>
          {suggestion.img
            ? <img src={suggestion.img} alt="" className="size-6 shrink-0 rounded object-cover" />
            : <SparklesIcon className="size-3.5 shrink-0 text-ink-muted dark:text-ink-inverse-muted" aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className="block truncate">{suggestion.title ?? suggestion.query}</span>
            {suggestion.description && <span className="block truncate text-ink-muted dark:text-ink-inverse-muted">{suggestion.description}</span>}
          </span>
          {suggestion.type !== 'query' && <span className="shrink-0 rounded-full border border-surface-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-muted dark:border-surface-700 dark:text-ink-inverse-muted">{suggestion.type}</span>}
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
    if (event.key === 'Escape' && assist.correction) { assist.dismiss(); return true }
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
