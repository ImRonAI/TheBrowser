import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ARTICLE_PREFIX, parseArticle } from './articles.ts'
import { hydratePanelSession } from './panel-stream.ts'

const article = { id: 'a', title: 'Source', url: 'https://example.com/story', source: 'example.com', text: 'Full extracted reference', status: 'extracted' }
test('article envelopes validate before rendering', () => {
  assert.deepEqual(parseArticle(ARTICLE_PREFIX + JSON.stringify(article)), article)
  assert.equal(parseArticle('ordinary text'), null)
  assert.equal(parseArticle(ARTICLE_PREFIX + '{'), null)
  assert.equal(parseArticle(ARTICLE_PREFIX + JSON.stringify({ ...article, url: 'javascript:alert(1)' })), null)
})
test('native snapshot restores attachment alongside its user message', () => {
  const state = hydratePanelSession('session', { status: 'completed', messages: [{ role: 'user', content: [
    { text: 'Compare the evidence' }, { text: ARTICLE_PREFIX + JSON.stringify(article) },
  ] }] })
  assert.equal(state.messages.length, 1)
  const parts = state.messages[0].parts
  assert.equal(parts.length, 2)
  assert.equal(parts[0].kind === 'text' && parts[0].text, 'Compare the evidence')
  assert.deepEqual(parts[1].kind === 'text' && parseArticle(parts[1].text), article)
})