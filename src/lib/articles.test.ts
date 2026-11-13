import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ARTICLE_PREFIX, cleanTitle, formatPublished, mdEscape, parseArticle, previewArticle, previewMarkdown, readStoryUrl, storyFromReadUrl, type Story } from './articles.ts'
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

const rich: Story = {
  ...story, snippets: ['A first excerpt from the page.', 'A second one.'], author: 'Anisha Sircar, J. Poe', paywalled: true, live: true,
  breaking: true, language: 'en', heroImage: 'https://cdn.example/full.jpg',
  answers: [{ question: 'How long?', answer: 'Three months.' }],
  video: { duration: '06:14:07', creator: 'NASA', publisher: 'YouTube', views: '14M' },
  discussion: { forum: 'r/hiking', answers: 19, score: '6', question: 'Best hikes?', topComment: 'South Arapaho Peak.' },
}
test('everything Brave returned for a story survives the tab URL round trip', () => {
  assert.deepEqual(storyFromReadUrl(readStoryUrl(rich)), rich)
})
test('extras are bounded: the longest pieces are dropped when they would not fit in the URL', () => {
  const heavy: Story = { ...story, snippets: Array.from({ length: 8 }, (_, i) => `${i} ` + 'x'.repeat(900)), author: 'Keep Me' }
  const url = new URL(readStoryUrl(heavy))
  assert.ok((url.searchParams.get('x') || '').length <= 6000)
  const back = storyFromReadUrl(url.href)!
  assert.equal(back.author, 'Keep Me')
  assert.ok((back.snippets?.length ?? 0) > 0 && back.snippets!.length < 8)
})
test('a tab URL is data: malformed or hostile extras are ignored field by field', () => {
  const base = 'ron://read?url=https://example.com/a&x='
  assert.equal(storyFromReadUrl(base + 'not json')!.snippets, undefined)
  assert.equal(storyFromReadUrl(base + encodeURIComponent('[1,2]'))!.author, undefined)
  const hostile = storyFromReadUrl(base + encodeURIComponent(JSON.stringify({
    snippets: [1, {}, '', 'kept'], heroImage: 'http://insecure.example/x.jpg', paywalled: 'yes', video: { duration: 5, creator: 'ok' },
    answers: [{ question: 'q' }, { question: 'q', answer: 'a', extra: 1 }], discussion: { answers: 'many', forum: 'f' },
  })))!
  assert.deepEqual(hostile.snippets, ['kept'])
  assert.equal(hostile.heroImage, undefined)
  assert.equal(hostile.paywalled, undefined)
  assert.deepEqual(hostile.video, { creator: 'ok' })
  assert.deepEqual(hostile.answers, [{ question: 'q', answer: 'a' }])
  assert.deepEqual(hostile.discussion, { forum: 'f' })
})
test('mdEscape makes plain text safe for the Markdown renderer', () => {
  assert.equal(mdEscape('  5 *stars* & [link](x) <b>bold</b>  '), '5 \\*stars\\* & \\[link\\](x) \\<b\\>bold\\</b\\>')
  assert.equal(mdEscape('# Not a heading'), '\\# Not a heading')
  assert.equal(mdEscape('1. Not a list'), '\\1. Not a list')
  assert.equal(mdEscape('- Not a bullet'), '\\- Not a bullet')
  assert.equal(mdEscape('> Not a quote'), '\\> Not a quote')
  assert.equal(mdEscape('AT&T and &amp; stay'), 'AT&T and \\&amp; stay')
})
test('the preview shows everything Brave sent as rich Markdown, never one flat line', () => {
  const md = previewMarkdown(rich)
  assert.match(md, /^Lead\n\n> Best hikes\?\n\n## Top reply\n\nSouth Arapaho Peak\./)
  assert.match(md, /## Key excerpts\n\n> A first excerpt from the page\.\n\n> A second one\./)
  assert.match(md, /## Quick answers\n\n### How long\?\n\nThree months\.$/)
  assert.equal(previewMarkdown({ ...story, description: '' }), 'A headline')
  assert.equal(previewMarkdown({ ...story, description: 'Same', snippets: ['Same', 'Other'] }), 'Same\n\n## Key excerpts\n\n> Other')
  assert.equal(previewArticle(rich).text, md)
  assert.equal(previewArticle(rich).status, 'preview')
})
test('cleanTitle removes only a trailing site name', () => {
  assert.equal(cleanTitle('Which AI Stock Is a Better Buy? | The Motley Fool', ['The Motley Fool', 'www.fool.com']), 'Which AI Stock Is a Better Buy?')
  assert.equal(cleanTitle('Council approves transit plan - Example Times', ['Example Times']), 'Council approves transit plan')
  assert.equal(cleanTitle('Council approves transit plan \u2014 nytimes.com', ['The New York Times', 'www.nytimes.com']), 'Council approves transit plan')
  assert.equal(cleanTitle('Drip coffee - Wikipedia', ['Wikipedia']), 'Drip coffee - Wikipedia')   // too short to be a headline
  assert.equal(cleanTitle('A long headline | Another Publisher', ['Example Times']), 'A long headline | Another Publisher')
  assert.equal(cleanTitle('Plain headline with no site', ['Example Times']), 'Plain headline with no site')
})
