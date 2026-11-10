/**
 * Text assist over Brave Suggest and Spellcheck, proxied by the backend (`POST /assist/suggest`,
 * `POST /assist/spellcheck`; the subscription tokens never reach the renderer).
 *
 * Shapes are the API reference's, unchanged:
 * - suggest `results[]`: `{query, type?: "query" | "entity" | "calculator", title?, description?, img?}`
 *   (an unknown `type` is a plain query suggestion); `count` 1-20, default 5.
 * - spellcheck: `results[0].query` → `corrected`, or null when Brave has no correction.
 * - `q` is limited to 400 characters and 50 words on both; longer text is not sent.
 *
 * Pure (no `@/` imports) so `node --experimental-strip-types` can run the colocated test.
 */

export const ASSIST_MAX_CHARS = 400
export const ASSIST_MAX_WORDS = 50
export const SUGGEST_MAX_COUNT = 20

export type SuggestionType = 'query' | 'entity' | 'calculator'

export interface Suggestion {
  query: string
  /** `query` unless Brave says otherwise; unrecognised values are treated as `query`. */
  type: SuggestionType
  title?: string
  description?: string
  img?: string
}

export interface AssistOptions {
  count?: number
  rich?: boolean
  country?: string
  lang?: string
}

/** True when `q` satisfies the documented limits (non-empty, <=400 chars, <=50 words). */
export function assistable(q: string): boolean {
  const text = q.trim()
  return text.length > 0 && text.length <= ASSIST_MAX_CHARS && text.split(/\s+/).length <= ASSIST_MAX_WORDS
}

export function normalizeSuggestion(raw: unknown): Suggestion | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.query !== 'string' || !r.query) return null
  const type: SuggestionType = r.type === 'entity' || r.type === 'calculator' ? r.type : 'query'
  const out: Suggestion = { query: r.query, type }
  if (typeof r.title === 'string') out.title = r.title
  if (typeof r.description === 'string') out.description = r.description
  if (typeof r.img === 'string') out.img = r.img
  return out
}

type Fetcher = typeof fetch

export interface AssistClient {
  suggest: (q: string, options?: AssistOptions, signal?: AbortSignal) => Promise<Suggestion[]>
  spellcheck: (q: string, options?: Pick<AssistOptions, 'country' | 'lang'>, signal?: AbortSignal) => Promise<string | null>
}

/** Backend proxy client. Failures resolve to empty/null: assist must never break typing. */
export function createAssistClient(baseUrl: string, fetcher: Fetcher = fetch): AssistClient {
  const base = baseUrl.replace(/\/$/, '')
  const post = async (path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown> | null> => {
    try {
      const response = await fetcher(`${base}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
      })
      if (!response.ok) return null
      return (await response.json()) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return {
    async suggest(q, options = {}, signal) {
      if (!assistable(q)) return []
      const count = Math.max(1, Math.min(SUGGEST_MAX_COUNT, options.count ?? 5))
      const data = await post('/assist/suggest', { q: q.trim(), count, rich: options.rich ?? false, country: options.country ?? 'US', lang: options.lang ?? 'en' }, signal)
      const results = Array.isArray(data?.results) ? data!.results : []
      return results.map(normalizeSuggestion).filter((s): s is Suggestion => s !== null)
    },
    async spellcheck(q, options = {}, signal) {
      if (!assistable(q)) return null
      const data = await post('/assist/spellcheck', { q: q.trim(), country: options.country ?? 'US', lang: options.lang ?? 'en' }, signal)
      const corrected = data?.corrected
      // Brave echoes the query back unchanged when nothing needs fixing; only a real change is a correction.
      return typeof corrected === 'string' && corrected.trim() && corrected.trim() !== q.trim() ? corrected : null
    },
  }
}

/**
 * Debounce + cancel the in-flight request on every new call so a fast typist produces one Brave
 * request per pause, never a backlog. Returns the latest result, or `undefined` when superseded.
 */
export function debounced<T>(run: (signal: AbortSignal) => Promise<T>, waitMs: number, schedule: (fn: () => void, ms: number) => unknown = setTimeout,
                             cancel: (handle: unknown) => void = (h) => clearTimeout(h as ReturnType<typeof setTimeout>)) {
  let timer: unknown = null
  let controller: AbortController | null = null
  let generation = 0
  let settlePending: (() => void) | null = null
  const dispose = () => {
    if (timer !== null) cancel(timer)
    timer = null
    controller?.abort()
    controller = null
    // A superseded or disposed call must still settle, or its awaiter hangs forever.
    settlePending?.()
    settlePending = null
  }
  const call = (): Promise<T | undefined> => new Promise((resolve) => {
    dispose()
    const token = ++generation
    settlePending = () => resolve(undefined)
    timer = schedule(() => {
      timer = null
      controller = new AbortController()
      const signal = controller.signal
      run(signal).then(
        (value) => { if (token === generation) settlePending = null; resolve(token === generation && !signal.aborted ? value : undefined) },
        () => { if (token === generation) settlePending = null; resolve(undefined) },
      )
    }, waitMs)
  })
  return { call, dispose }
}

/** Apply a suggestion to a free-text field: the suggestion replaces the text being completed. */
export function applySuggestion(_current: string, suggestion: Suggestion): string {
  return suggestion.query
}

/**
 * One row of the assist listbox. The spelling correction leads, then Brave's suggestions, so the keyboard reaches the
 * correction the same way it reaches a suggestion (focus never leaves the field: the field points at the highlighted
 * row with `aria-activedescendant`).
 */
export type AssistOption =
  | { kind: 'correction'; text: string }
  | { kind: 'suggestion'; suggestion: Suggestion }

export function assistOptions(correction: string | null, suggestions: readonly Suggestion[]): AssistOption[] {
  const rows: AssistOption[] = correction ? [{ kind: 'correction', text: correction }] : []
  for (const suggestion of suggestions) rows.push({ kind: 'suggestion', suggestion })
  return rows
}

/** A stable identity for a row, so the highlight stays on the same row when the correction arrives after the suggestions. */
export function assistOptionKey(option: AssistOption): string {
  return option.kind === 'correction' ? 'correction' : `suggestion:${option.suggestion.type}:${option.suggestion.query}`
}

/**
 * Move the highlight through `count` rows. -1 is the field itself (nothing highlighted): ↓ from the field reaches the
 * first row, ↓ from the last row returns to the field, ↑ from the field reaches the last row.
 */
export function moveHighlight(active: number, delta: number, count: number): number {
  if (count <= 0) return -1
  const positions = count + 1
  const from = Math.min(Math.max(active, -1), count - 1) + 1
  return ((((from + delta) % positions) + positions) % positions) - 1
}

export interface AssistKeyContext {
  /** Rows in the listbox (correction + suggestions). */
  options: number
  /** The highlighted row, -1 when none is. */
  active: number
  hasSuggestions: boolean
  /** The field is a textarea, where ↑/↓ move the caret between lines. */
  multiline: boolean
  /** The caret sits at the very end of the text with nothing selected. */
  caretAtEnd: boolean
}

export type AssistKeyAction = { type: 'move'; delta: 1 | -1 } | { type: 'accept' } | { type: 'dismiss' } | null

/**
 * What a key does to the assist list. ↑/↓ move the highlight and Enter/Tab accept the highlighted row; Escape closes
 * the list. In a textarea the arrows stay with the caret until the list is in use: suggestions are showing, a row is
 * highlighted, or ↓ is pressed at the very end of the text (where it would not move the caret anyway), which is how a
 * lone spelling correction is reached from a long-form field.
 */
export function assistKeyAction(key: string, context: AssistKeyContext): AssistKeyAction {
  if (context.options <= 0) return null
  if (key === 'Escape') return { type: 'dismiss' }
  if (key === 'Enter' || key === 'Tab') return context.active >= 0 && context.active < context.options ? { type: 'accept' } : null
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return null
  const listInUse = !context.multiline || context.hasSuggestions || context.active >= 0 || (key === 'ArrowDown' && context.caretAtEnd)
  return listInUse ? { type: 'move', delta: key === 'ArrowDown' ? 1 : -1 } : null
}

/** The listbox's id and its rows' ids, derived from the field's assist id. */
export function assistListboxId(id: string): string {
  return `${id}-listbox`
}

export function assistOptionId(id: string, index: number): string {
  return `${id}-option-${index}`
}

/** ARIA that ties a field to its assist listbox. */
export interface AssistFieldAria {
  role?: 'combobox'
  'aria-expanded'?: boolean
  'aria-autocomplete': 'list'
  'aria-controls'?: string
  'aria-activedescendant'?: string
}

/**
 * ARIA 1.2 combobox props for a single-line field (`combobox`), or, for a field that may be a textarea (whose only
 * allowed role is textbox), just the properties a textbox supports.
 */
export function assistFieldAria(id: string, options: number, active: number, combobox: boolean): AssistFieldAria {
  const open = options > 0
  const aria: AssistFieldAria = {
    'aria-autocomplete': 'list',
    'aria-controls': open ? assistListboxId(id) : undefined,
    'aria-activedescendant': open && active >= 0 && active < options ? assistOptionId(id, active) : undefined,
  }
  return combobox ? { role: 'combobox', 'aria-expanded': open, ...aria } : aria
}

/** What a screen reader hears (politely) when the list changes. */
export function assistAnnouncement(correction: string | null, suggestions: number): string {
  const parts: string[] = []
  if (correction) parts.push(`Did you mean ${correction}?`)
  if (suggestions > 0) parts.push(`${suggestions} suggestion${suggestions === 1 ? '' : 's'}, use the arrow keys to choose.`)
  return parts.join(' ')
}
