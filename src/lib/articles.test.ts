import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ARTICLE_PREFIX, formatPublished, parseArticle, previewArticle, readStoryUrl, storyFromReadUrl, type Story } from './articles.ts'
import { hydratePanelSession } from './panel-stream.ts'

const article = { id: 'a', title: 'Source', url: 'https://example.com/story', source: 'example.com', text: 'Full extracted reference', status: 'extracted' }
test('article envelopes validate before rendering', () => {
  assert.deepEqual(parseArticle(ARTICLE_PREFIX + JSON.stringify(article)), article)
  assert.equal(parseArticle('ordinary text'), null)
  assert.equal(parseArticle(ARTICLE_PREFIX + '{'), null)
  assert.equal(parseArticle(ARTICLE_PREFIX + JSON.stringify({ ...article, url: 'javascript:alert(1)' })), null)
})
const story: Story = {
  title: 'A headline', url: 'https://example.com/story', description: 'Lead', age: '2h',
  topic: 'Design', hostname: 'example.com', thumbnail: 'https://cdn.example/a.jpg',
  source: 'Example Daily', favicon: 'https://cdn.example/f.png', published: '2026-01-14T11:00:52', kind: 'article',
}
test('reader links round-trip story fields and reject non-https sources', () => {
  const href = readStoryUrl(story)
  assert.equal(href.startsWith('ron://read?'), true)
  assert.deepEqual(storyFromReadUrl(href), story)
  assert.equal(storyFromReadUrl('ron://read?url=http://example.com/a'), null)
  assert.equal(storyFromReadUrl('ron://read'), null)
})
test('storyFromReadUrl defaults new fields when absent', () => {
  const parsed = storyFromReadUrl('ron://read?url=https://example.com/a&title=T')
  assert.deepEqual(parsed, {
    title: 'T', url: 'https://example.com/a', description: '', age: '', topic: 'Story',
    hostname: 'example.com', thumbnail: '', source: 'example.com', favicon: '', published: '', kind: 'article',
  })
})
test('previewArticle prefers the publisher display name', () => {
  assert.equal(previewArticle(story).source, 'Example Daily')
  assert.equal(previewArticle({ ...story, source: '' }).source, 'example.com')
})
test('formatPublished renders a long date and falls back to age', () => {
  assert.equal(formatPublished('2026-01-14T11:00:52', '2 days ago'), 'January 14, 2026')
  assert.equal(formatPublished('', '2 days ago'), '2 days ago')
  assert.equal(formatPublished('garbage', ''), '')
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