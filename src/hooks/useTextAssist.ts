import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { API_BASE_URL } from '@/lib/api-base'
import {
  applySuggestion, assistable, assistOptionKey, assistOptions as listOptions, createAssistClient, debounced, moveHighlight,
  type AssistOption, type AssistOptions, type Suggestion,
} from '@/lib/text-assist'

/**
 * Brave Suggest + Spellcheck for one free-text field.
 *
 * `suggest` and `spellcheck` can be enabled independently (the URL bar and search bar want both;
 * a long issue description wants spelling only). Requests are debounced per field and the
 * in-flight one is cancelled on every keystroke, so a typist produces one call per pause. Both
 * plans allow 100 req/s; the client never exceeds one outstanding request per field. Suggestions
 * clear when the text no longer matches what they were fetched for; the correction clears when
 * the text changes or when it is identical to what the user already typed.
 */
export interface UseTextAssistOptions extends AssistOptions {
  suggest?: boolean
  spellcheck?: boolean
  /** Debounce before calling Brave (ms). Suggest wants to feel instant; spellcheck can wait. */
  suggestDelayMs?: number
  spellcheckDelayMs?: number
  /** Skip assist entirely (e.g. while the field holds a URL or a slash command). */
  skip?: (value: string) => boolean
  enabled?: boolean
}

export interface TextAssistState {
  /** Unique per field: the assist listbox and its rows derive their element ids from it. */
  id: string
  suggestions: Suggestion[]
  correction: string | null
  /** The listbox rows: the correction (when there is one) first, then the suggestions. */
  options: AssistOption[]
  /** Highlighted row in `options` for keyboard navigation (-1 = none). */
  active: number
  setActive: (index: number) => void
  /** Move the highlight through `options`; returns the new index. */
  move: (delta: number) => number
  /** Text to put in the field when the user picks a suggestion. */
  pick: (suggestion: Suggestion) => string
  /** Clear suggestions + correction (after submit/blur/escape). */
  dismiss: () => void
}

const client = createAssistClient(API_BASE_URL)

export function useTextAssist(value: string, settings: UseTextAssistOptions = {}): TextAssistState {
  const { suggest = true, spellcheck = true, suggestDelayMs = 180, spellcheckDelayMs = 700, skip, enabled = true,
    count, rich, country, lang } = settings
  const id = `assist${useId().replace(/[^\w-]/g, '')}`
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [correction, setCorrection] = useState<string | null>(null)
  // The highlight follows a row, not a position: the correction usually lands after the suggestions and leads the list.
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const options = useMemo(() => listOptions(correction, suggestions), [correction, suggestions])
  const active = activeKey === null ? -1 : options.findIndex((option) => assistOptionKey(option) === activeKey)
  const setActive = useCallback((index: number) => {
    setActiveKey(index >= 0 && index < options.length ? assistOptionKey(options[index]) : null)
  }, [options])
  const forValue = useRef('')
  const assistOptions = useMemo<AssistOptions>(() => ({ count, rich, country, lang }), [count, rich, country, lang])

  const suggestRun = useMemo(() => debounced((signal) => client.suggest(forValue.current, assistOptions, signal), suggestDelayMs), [assistOptions, suggestDelayMs])
  const spellRun = useMemo(() => debounced((signal) => client.spellcheck(forValue.current, assistOptions, signal), spellcheckDelayMs), [assistOptions, spellcheckDelayMs])

  useEffect(() => {
    forValue.current = value
    setActiveKey(null)
    const wanted = enabled && assistable(value) && !(skip?.(value) ?? false)
    if (!wanted) {
      suggestRun.dispose(); spellRun.dispose()
      setSuggestions([]); setCorrection(null)
      return
    }
    const requested = value
    if (suggest) void suggestRun.call().then((result) => { if (result !== undefined && forValue.current === requested) setSuggestions(result) })
    else setSuggestions([])
    if (spellcheck) void spellRun.call().then((result) => { if (result !== undefined && forValue.current === requested) setCorrection(result) })
    else setCorrection(null)
  }, [value, enabled, suggest, spellcheck, skip, suggestRun, spellRun])

  useEffect(() => () => { suggestRun.dispose(); spellRun.dispose() }, [suggestRun, spellRun])

  const dismiss = useCallback(() => { suggestRun.dispose(); spellRun.dispose(); setSuggestions([]); setCorrection(null); setActiveKey(null) }, [suggestRun, spellRun])
  const move = useCallback((delta: number) => {
    const next = moveHighlight(active, delta, options.length)
    setActive(next)
    return next
  }, [active, options.length, setActive])
  const pick = useCallback((suggestion: Suggestion) => applySuggestion(forValue.current, suggestion), [])

  return { id, suggestions, correction, options, active, setActive, move, pick, dismiss }
}
