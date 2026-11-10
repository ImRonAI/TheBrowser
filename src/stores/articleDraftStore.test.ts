import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import type { ArticleAttachment } from '../lib/articles.ts'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
} })
const { articleDraftKey, useArticleDraftStore } = await import('./articleDraftStore.ts')
const article = (id: string): ArticleAttachment => ({
  id, title: `Article ${id}`, url: `https://example.com/${id}`, source: 'example.com',
  text: 'Reference text', status: 'extracted',
})
beforeEach(() => {
  storage.clear()
  useArticleDraftStore.setState({ drafts: {}, activeDestination: 'panel' })
})

test('drafts remain isolated by user and destination and survive rehydration', async () => {
  for (const user of ['alice', 'bob']) for (const destination of ['panel', 'search', 'build', 'voice'] as const) {
    const key = articleDraftKey(user, destination)
    useArticleDraftStore.getState().setText(key, key)
    assert.equal(useArticleDraftStore.getState().attach(key, article(key)), true)
  }
  const expected = structuredClone(useArticleDraftStore.getState().drafts)
  const saved = storage.get('ron-article-drafts')!
  useArticleDraftStore.setState({ drafts: {} })
  storage.set('ron-article-drafts', saved)
  await useArticleDraftStore.persist.rehydrate()
  assert.deepEqual(useArticleDraftStore.getState().drafts, expected)
  assert.equal(Object.keys(expected).length, 8)
})

test('attachment limit rejects a fourth source without silently removing drafts', () => {
  const key = articleDraftKey('alice', 'panel')
  for (const id of ['a', 'b', 'c']) assert.equal(useArticleDraftStore.getState().attach(key, article(id)), true)
  assert.equal(useArticleDraftStore.getState().attach(key, article('d')), false)
  assert.deepEqual(useArticleDraftStore.getState().drafts[key].articles.map((item) => item.id), ['a', 'b', 'c'])
  assert.equal(useArticleDraftStore.getState().attach(key, { ...article('b'), id: 'replacement' }), true)
  useArticleDraftStore.getState().remove(key, 'a')
  assert.equal(useArticleDraftStore.getState().attach(key, article('d')), true)
})

test('accepted sends clear only submitted content, preserving edits and newly attached sources', () => {
  const key = articleDraftKey('alice', 'search')
  const store = useArticleDraftStore.getState()
  store.setText(key, 'First question')
  store.attach(key, article('a'))
  store.setText(key, 'Next question')
  store.attach(key, article('b'))
  store.clearSent(key, 'First question', ['a'])
  assert.equal(useArticleDraftStore.getState().drafts[key].text, 'Next question')
  assert.deepEqual(useArticleDraftStore.getState().drafts[key].articles, [article('b')])
  store.clearSent(key, 'Next question', ['b'])
  assert.deepEqual(useArticleDraftStore.getState().drafts[key], { text: '', articles: [], pasted: [] })
})
test('pastes stay with their draft until sent or a new chat, and a late title never revives a removed one', async () => {
  const key = articleDraftKey('alice', 'panel')
  const store = useArticleDraftStore.getState()
  const pasted = (id: string) => ({ id, kind: 'pasted' as const, title: `Paste ${id}`, text: `Text ${id}` })
  store.addPasted(key, pasted('p1'))
  store.addPasted(key, pasted('p2'))
  store.updatePasted(key, 'p1', { title: 'Pricing Page Builder', text: 'Edited' })
  assert.deepEqual(useArticleDraftStore.getState().drafts[key].pasted[0], { ...pasted('p1'), title: 'Pricing Page Builder', text: 'Edited' })
  store.removePasted(key, 'p2')
  store.updatePasted(key, 'p2', { title: 'Too late' })
  assert.deepEqual(useArticleDraftStore.getState().drafts[key].pasted.map((item) => item.id), ['p1'])
  store.setText(key, 'Go')
  store.addPasted(key, pasted('p3'))
  store.clearSent(key, 'Go', ['p1'])
  assert.deepEqual(useArticleDraftStore.getState().drafts[key], { text: '', articles: [], pasted: [pasted('p3')] })
  store.setText(key, 'Unsent')
  store.attach(key, article('kept'))
  store.resetComposer(key)
  assert.deepEqual(useArticleDraftStore.getState().drafts[key], { text: '', articles: [article('kept')], pasted: [] })
  // Drafts saved before pastes existed (version 1) come back with an empty paste list.
  storage.set('ron-article-drafts', JSON.stringify({ state: { drafts: { [key]: { text: 'Old', articles: [] } }, activeDestination: 'panel' }, version: 1 }))
  await useArticleDraftStore.persist.rehydrate()
  assert.deepEqual(useArticleDraftStore.getState().drafts[key], { text: 'Old', articles: [], pasted: [] })
})
