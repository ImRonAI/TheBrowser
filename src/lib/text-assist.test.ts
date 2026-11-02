import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ASSIST_MAX_CHARS, assistable, createAssistClient, debounced, normalizeSuggestion } from './text-assist.ts'

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
