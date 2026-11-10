import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ASSIST_MAX_CHARS, assistable, assistAnnouncement, assistFieldAria, assistKeyAction, assistOptionKey, assistOptions, createAssistClient,
  debounced, moveHighlight, normalizeSuggestion, type AssistKeyContext,
} from './text-assist.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('assistable enforces the documented q limits: non-empty, <=400 chars, <=50 words', () => {
  assert.equal(assistable(''), false)
  assert.equal(assistable('   '), false)
  assert.equal(assistable('palm springs'), true)
  assert.equal(assistable('w '.repeat(50).trim()), true)
  assert.equal(assistable('w '.repeat(51).trim()), false)
  assert.equal(assistable('x'.repeat(ASSIST_MAX_CHARS)), true)
  assert.equal(assistable('x'.repeat(ASSIST_MAX_CHARS + 1)), false)
})

test('normalizeSuggestion keeps the reference fields and treats unknown types as query', () => {
  assert.deepEqual(normalizeSuggestion({ query: 'palm springs' }), { query: 'palm springs', type: 'query' })
  assert.deepEqual(normalizeSuggestion({ query: 'Palm Springs', type: 'entity', title: 'Palm Springs', description: 'City', img: 'https://i' }),
    { query: 'Palm Springs', type: 'entity', title: 'Palm Springs', description: 'City', img: 'https://i' })
  assert.equal(normalizeSuggestion({ query: '2+2', type: 'something-new' })?.type, 'query')
  assert.equal(normalizeSuggestion({ type: 'query' }), null)
})

test('suggest posts the documented params (count clamped 1-20) and spellcheck returns only a real correction', async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const fetcher: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body))
    calls.push({ url: String(url), body })
    if (String(url).endsWith('/assist/suggest')) return json({ query: body.q, results: [{ query: 'palm springs' }, { query: 'Palm Springs', type: 'entity', img: 'https://i' }] })
    return json({ query: body.q, corrected: body.q === 'recieve teh pakage' ? 'receive the package' : body.q })
  }
  const client = createAssistClient('http://api/', fetcher)
  const suggestions = await client.suggest('palm spr', { count: 99 })
  assert.equal(calls[0].url, 'http://api/assist/suggest')
  assert.deepEqual(calls[0].body, { q: 'palm spr', count: 20, rich: false, country: 'US', lang: 'en' })
  assert.deepEqual(suggestions.map((s) => s.query), ['palm springs', 'Palm Springs'])
  assert.equal(await client.spellcheck('recieve teh pakage'), 'receive the package')
  assert.deepEqual(calls[1].body, { q: 'recieve teh pakage', country: 'US', lang: 'en' })
  assert.equal(await client.spellcheck('receive the package'), null, 'an echoed query is not a correction')
  assert.deepEqual(await client.suggest(''), [], 'nothing is sent for an empty query')
  assert.equal(calls.length, 3)
})

test('assist never throws: HTTP errors and network failures resolve to empty/null', async () => {
  const broken = createAssistClient('http://api', async () => json({ detail: { code: 'not_in_plan' } }, 400))
  assert.deepEqual(await broken.suggest('x'), [])
  assert.equal(await broken.spellcheck('x'), null)
  const offline = createAssistClient('http://api', async () => { throw new TypeError('fetch failed') })
  assert.deepEqual(await offline.suggest('x'), [])
})

test('debounced runs once per pause, aborts the superseded request and resolves it as undefined', async () => {
  const pending: (() => void)[] = []
  const schedule = (fn: () => void) => { pending.push(fn); return pending.length }
  const cancel = (handle: unknown) => { pending[(handle as number) - 1] = () => {} }
  const seen: AbortSignal[] = []
  const d = debounced(async (signal) => { seen.push(signal); return seen.length }, 150, schedule, cancel)
  const first = d.call()
  const second = d.call()
  assert.equal(pending.length, 2)
  pending[0]()
  pending[1]()
  assert.equal(await first, undefined, 'the superseded call resolves undefined')
  assert.equal(await second, 1, 'only the last call ran')
  const third = d.call()
  pending[2]()
  d.dispose()
  assert.equal(seen[1].aborted, true, 'dispose aborts the in-flight request')
  assert.equal(await third, undefined)
})

test('the correction leads the listbox rows, and row keys stay stable when it arrives later', () => {
  const suggestions = [{ query: 'palm springs', type: 'query' as const }, { query: 'Palm Springs', type: 'entity' as const }]
  const rows = assistOptions('palm springs ca', suggestions)
  assert.deepEqual(rows.map((row) => row.kind), ['correction', 'suggestion', 'suggestion'])
  assert.deepEqual(assistOptions(null, []), [])
  assert.deepEqual(assistOptions(null, suggestions).map(assistOptionKey), rows.slice(1).map(assistOptionKey))
  assert.equal(new Set(rows.map(assistOptionKey)).size, rows.length, 'every row has its own key')
})

test('moveHighlight: down from the field reaches the first row, wraps back to the field, up reaches the last row', () => {
  assert.equal(moveHighlight(-1, 1, 3), 0, 'the old cycling formula left ↓ stuck on the field')
  assert.equal(moveHighlight(0, 1, 3), 1)
  assert.equal(moveHighlight(2, 1, 3), -1, '↓ past the last row returns to the field')
  assert.equal(moveHighlight(-1, -1, 3), 2)
  assert.equal(moveHighlight(0, -1, 3), -1)
  assert.equal(moveHighlight(7, 1, 3), -1, 'a stale index past the end is treated as the last row')
  assert.equal(moveHighlight(-1, 1, 0), -1, 'nothing to highlight')
})

test('assistKeyAction keeps the documented keys and leaves a textarea caret alone until the list is in use', () => {
  const field: AssistKeyContext = { options: 2, active: -1, hasSuggestions: true, multiline: false, caretAtEnd: false }
  assert.deepEqual(assistKeyAction('ArrowDown', field), { type: 'move', delta: 1 })
  assert.deepEqual(assistKeyAction('ArrowUp', field), { type: 'move', delta: -1 })
  assert.equal(assistKeyAction('Enter', field), null, 'Enter with nothing highlighted is the host\'s (submit)')
  assert.deepEqual(assistKeyAction('Enter', { ...field, active: 0 }), { type: 'accept' })
  assert.deepEqual(assistKeyAction('Tab', { ...field, active: 1 }), { type: 'accept' })
  assert.deepEqual(assistKeyAction('Escape', field), { type: 'dismiss' })
  assert.equal(assistKeyAction('a', field), null)
  assert.equal(assistKeyAction('Escape', { ...field, options: 0 }), null, 'no list, nothing consumed')

  const correctionOnly: AssistKeyContext = { options: 1, active: -1, hasSuggestions: false, multiline: true, caretAtEnd: false }
  assert.equal(assistKeyAction('ArrowDown', correctionOnly), null, 'mid-text ↓ moves the caret')
  assert.equal(assistKeyAction('ArrowUp', { ...correctionOnly, caretAtEnd: true }), null)
  assert.deepEqual(assistKeyAction('ArrowDown', { ...correctionOnly, caretAtEnd: true }), { type: 'move', delta: 1 }, '↓ at the end reaches the correction')
  assert.deepEqual(assistKeyAction('ArrowUp', { ...correctionOnly, active: 0 }), { type: 'move', delta: -1 }, 'once highlighted, the arrows stay with the list')
  assert.deepEqual(assistKeyAction('ArrowDown', { ...correctionOnly, hasSuggestions: true }), { type: 'move', delta: 1 })
})

test('assistFieldAria: a combobox for single-line fields, textbox-safe properties otherwise', () => {
  assert.deepEqual(assistFieldAria('a1', 3, 1, true), {
    role: 'combobox', 'aria-expanded': true, 'aria-autocomplete': 'list', 'aria-controls': 'a1-listbox', 'aria-activedescendant': 'a1-option-1',
  })
  assert.deepEqual(assistFieldAria('a1', 0, 1, true), {
    role: 'combobox', 'aria-expanded': false, 'aria-autocomplete': 'list', 'aria-controls': undefined, 'aria-activedescendant': undefined,
  })
  const textbox = assistFieldAria('a1', 2, -1, false)
  assert.equal('role' in textbox, false, 'a textarea keeps its textbox role')
  assert.equal('aria-expanded' in textbox, false, 'aria-expanded is not a textbox property')
  assert.equal(textbox['aria-controls'], 'a1-listbox')
  assert.equal(textbox['aria-activedescendant'], undefined)
})

test('assistAnnouncement says what appeared', () => {
  assert.equal(assistAnnouncement(null, 0), '')
  assert.equal(assistAnnouncement('receive', 0), 'Did you mean receive?')
  assert.equal(assistAnnouncement(null, 1), '1 suggestion, use the arrow keys to choose.')
  assert.equal(assistAnnouncement('receive', 4), 'Did you mean receive? 4 suggestions, use the arrow keys to choose.')
})
