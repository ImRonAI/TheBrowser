import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyBlock, opensWith, planAdSlots, readingMinutes, visibleWords, withoutLeadImage, type ArticleBlock } from './article-body.ts'

const sentence = (words: number) => Array.from({ length: words }, (_, i) => `word${i}`).join(' ') + '.'
const block = (type: ArticleBlock['type'], words: number, markdown = sentence(words)): ArticleBlock => ({ type, markdown, words })
const prose = (words = 60) => block('paragraph', words)

test('classifyBlock names what Streamdown hands it', () => {
  const kinds = (markdown: string) => classifyBlock(markdown).type
  assert.equal(kinds('## Heading'), 'heading')
  assert.equal(kinds('Plain text with a [link](https://e.com)'), 'paragraph')
  assert.equal(kinds('- one\n- two'), 'list')
  assert.equal(kinds('1. one\n2. two'), 'list')
  assert.equal(kinds('> quoted\n>\n> more'), 'quote')
  assert.equal(kinds('| a | b |\n|---|---|\n| 1 | 2 |'), 'table')
  assert.equal(kinds('```py\nx = 1\n\ny = 2\n```'), 'code')
  assert.equal(kinds('![Route map](https://e.com/map.png)'), 'image')
  assert.equal(kinds('---'), 'rule')
  assert.equal(kinds('**Bold** start'), 'paragraph')
  assert.equal(classifyBlock('![alt](https://e.com/a.png)').words, 0)
})

test('visibleWords ignores destinations, image syntax and markup', () => {
  assert.equal(visibleWords('See [the long plan](https://news.example.com/2026/11/some-very-long-slug-here) now.'), 5)
  assert.equal(visibleWords('![a very long alt text](https://e.com/a.png) caption here'), 2)
  assert.equal(visibleWords('**Bold** and *italic* and `code`'), 5)
  assert.equal(visibleWords('> "Overdue," said the mayor.'), 4)
})

test('readingMinutes is at least one and counts 220 words a minute', () => {
  assert.equal(readingMinutes([prose(10)]), 1)
  assert.equal(readingMinutes([prose(220)]), 1)
  assert.equal(readingMinutes([prose(221)]), 2)
  assert.equal(readingMinutes([prose(1100), block('image', 0)]), 5)
})

test('short articles and previews carry no ads at all', () => {
  assert.deepEqual(planAdSlots([prose(100), prose(100), prose(100)]), [])
  assert.deepEqual(planAdSlots([]), [])
})

test('inline slots follow only full prose paragraphs, are spaced, capped and leave a tail', () => {
  const blocks = Array.from({ length: 30 }, () => prose(60))
  const slots = planAdSlots(blocks)
  const inline = slots.filter((slot) => slot.position === 'inline')
  assert.equal(inline.length, 3)
  assert.deepEqual(inline.map((slot) => slot.after), [3, 10, 17])  // 240 words, then +420, then +420 (>= 380 at the next paragraph)
  assert.equal(slots.at(-1)?.position, 'end')
  assert.equal(slots.at(-1)?.after, 29)
  assert.deepEqual(slots.map((slot) => slot.id), ['ad-1', 'ad-2', 'ad-3', 'ad-end'])
  // an ad never sits on the last paragraph or inside the final 120 words
  const tight = planAdSlots([...Array.from({ length: 8 }, () => prose(60)), prose(60)], { maxInline: 9, firstAfterWords: 60, spacingWords: 60 })
  assert.ok(tight.filter((slot) => slot.position === 'inline').every((slot) => slot.after <= 6))
})

test('slots never separate a heading from its paragraph or split a list, quote, table, code or caption', () => {
  const blocks: ArticleBlock[] = [
    prose(120), block('heading', 3, '## Section'), prose(120),
    block('list', 80), prose(14), block('quote', 60), block('table', 40), block('code', 40),
    block('image', 0), block('paragraph', 20), prose(200), block('heading', 2, '## Next'), prose(200), prose(200),
  ]
  const slots = planAdSlots(blocks, { firstAfterWords: 1, spacingWords: 1, maxInline: 20, tailWords: 0 })
  for (const slot of slots.filter((s) => s.position === 'inline')) {
    const target = blocks[slot.after]
    assert.equal(target.type, 'paragraph', `slot after ${slot.after} (${target.type})`)
    assert.ok(target.words >= 15, `slot after a ${target.words}-word paragraph`)
    assert.notEqual(slot.after, 9, 'not between an image and its caption')
  }
  // a heading is never followed directly by a slot
  assert.ok(slots.every((slot) => blocks[slot.after].type !== 'heading'))
})

test('a paragraph that leads into the next block stays attached to it', () => {
  const lead = block('paragraph', 60, sentence(59).slice(0, -1) + ' include:')
  const blocks = [prose(300), lead, block('list', 40), prose(200), prose(200)]
  const slots = planAdSlots(blocks, { firstAfterWords: 1, spacingWords: 1, maxInline: 5, tailWords: 0 })
  assert.ok(!slots.some((slot) => slot.after === 1))
})

test('the end slot can be switched off', () => {
  assert.equal(planAdSlots(Array.from({ length: 12 }, () => prose(60)), { end: false }).some((slot) => slot.position === 'end'), false)
})

test('the body\'s repeat of the hero image is dropped, whatever resize URL it uses', () => {
  const lead = classifyBlock('![An illustration](https://cdn.mos.cms.futurecdn.net/qiLNW6MFxpp6cd8GpRyPmm.png)')
  const other = classifyBlock('![Chart](https://cdn.mos.cms.futurecdn.net/zzzzzzzzzzzzzzzzzzzzzz.png)')
  const blocks = [prose(), lead, other, prose()]
  assert.deepEqual(withoutLeadImage(blocks, 'https://cdn.mos.cms.futurecdn.net/qiLNW6MFxpp6cd8GpRyPmm-2000-80.png'), [blocks[0], other, blocks[3]])
  // a CDN that wraps the original in a query string
  const wrapped = classifyBlock('![x](https://g.foolcdn.com/image/?url=https%3A%2F%2Fcdn.content.foolcdn.com%2Fimages%2F98c4ccef9eacd8dcb5edbdac15d5c02a6e3a0663-1280x720.png)')
  assert.equal(withoutLeadImage([wrapped, prose()], 'https://cdn.content.foolcdn.com/images/98c4ccef9eacd8dcb5edbdac15d5c02a6e3a0663-1280x720.png').length, 1)
  // unrelated hero, no hero, and images deeper than the first three blocks are left alone
  assert.equal(withoutLeadImage(blocks, 'https://other.example/aaaaaaaaaaaaaaaaaaaaaaaa.jpg').length, 4)
  assert.equal(withoutLeadImage(blocks, undefined).length, 4)
  assert.equal(withoutLeadImage([prose(), prose(), prose(), lead], 'https://cdn.mos.cms.futurecdn.net/qiLNW6MFxpp6cd8GpRyPmm.png').length, 4)
})

test('opensWith detects a description the body already begins with', () => {
  const blocks = [classifyBlock('![i](https://e.com/a.png)'), classifyBlock('The UVEX mission will "advance fundamental frontiers in astrophysics," the agency said on Tuesday.')]
  assert.equal(opensWith(blocks, 'The UVEX mission will \u201cadvance fundamental frontiers in astrophysics,\u201d the agency'), true)
  assert.equal(opensWith(blocks, 'A summary written by the marketing team that the body does not repeat.'), false)
  assert.equal(opensWith(blocks, 'Short'), false)
  assert.equal(opensWith([], 'The UVEX mission will advance fundamental frontiers'), false)
})
