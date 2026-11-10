import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ATTACHMENT_TEXT_MAX, CONTEXT_NOTE, CONTEXT_TEXT_MAX, PASTED_PROMPT_CHARACTER_LIMIT, PASTED_PROMPT_INSTRUCTION,
  attachmentBlock, attachmentMeta, attachmentStats, buildAttachmentDocument, clipAttachmentText, clipWithNote,
  contextAttachment, escapeHtml, findTextMatches, tabAttachmentText,
  isLongPaste, messageForPastedPrompt, messageTitle, parseAttachmentBlock, titleFromPastedText,
  uniqueAttachmentName, wrapMatchIndex, type EditorPalette, type PromptAttachment,
} from './prompt-attachments.ts'

const PALETTE: EditorPalette = {
  scheme: 'dark', text: '#fff', muted: '#999', caret: '#8d98fe', selection: 'rgb(141 152 254 / 0.4)',
  mark: 'rgb(141 152 254 / 0.25)', markEdge: 'rgb(141 152 254 / 0.6)', current: '#8d98fe', currentText: '#000', scrollbar: '#555',
}

test('posts the task instruction with a pasted prompt attachment', () => {
  assert.equal(messageForPastedPrompt('', true), PASTED_PROMPT_INSTRUCTION)
  assert.equal(messageForPastedPrompt('   ', true), PASTED_PROMPT_INSTRUCTION)
  assert.equal(messageForPastedPrompt(PASTED_PROMPT_INSTRUCTION, true), PASTED_PROMPT_INSTRUCTION)
  assert.equal(messageForPastedPrompt('Also check mobile.', true), `${PASTED_PROMPT_INSTRUCTION}\n\nAlso check mobile.`)
  assert.equal(messageForPastedPrompt('leave me alone', false), 'leave me alone')
})

test('attaches only pastes longer than 300 characters', () => {
  assert.equal(isLongPaste('a'.repeat(PASTED_PROMPT_CHARACTER_LIMIT)), false)
  assert.equal(isLongPaste('a'.repeat(PASTED_PROMPT_CHARACTER_LIMIT + 1)), true)
  assert.equal(isLongPaste(''), false)
})

test('names a paste from its content in at most four words and avoids collisions', () => {
  const brief = 'Please build a pricing page with a yearly toggle and three tiers for a developer tool.'
  assert.equal(titleFromPastedText(brief), 'Pricing page')
  assert.equal(titleFromPastedText('# Migration plan\n\nMove the worker off the laptop.'), 'Migration plan')
  assert.equal(titleFromPastedText('Refactor the authentication middleware into composable pieces'), 'Refactor the authentication')
  assert.equal(titleFromPastedText('Supercalifragilisticexpialidocious-and-then-some-more-words').length, 32)
  assert.equal(titleFromPastedText(''), 'Untitled prompt')
  assert.equal(uniqueAttachmentName('Pricing page', []), 'Pricing page')
  assert.equal(uniqueAttachmentName('Pricing page', ['Pricing page']), 'Pricing page 2')
  assert.equal(uniqueAttachmentName('Pricing page', ['Pricing page', 'Pricing page 2']), 'Pricing page 3')
})

test('finds literal case-insensitive matches and wraps the active index', () => {
  assert.deepEqual(findTextMatches('Alpha beta ALPHA', 'alpha'), [{ start: 0, end: 5 }, { start: 11, end: 16 }])
  assert.deepEqual(findTextMatches('aaaa', 'aa'), [{ start: 0, end: 2 }, { start: 2, end: 4 }])
  assert.deepEqual(findTextMatches('hello', '   '), [])
  assert.deepEqual(findTextMatches('hello', 'z'), [])
  assert.equal(wrapMatchIndex(-1, 3), 2)
  assert.equal(wrapMatchIndex(3, 3), 0)
  assert.equal(wrapMatchIndex(1, 0), 0)
})

test('clips a paste to what one attachment carries and reports the original length', () => {
  assert.deepEqual(clipAttachmentText('short'), { text: 'short', clipped: false, total: 5 })
  const long = 'x'.repeat(ATTACHMENT_TEXT_MAX + 10)
  const clipped = clipAttachmentText(long)
  assert.equal(clipped.text.length, ATTACHMENT_TEXT_MAX)
  assert.equal(clipped.clipped, true)
  assert.equal(clipped.total, ATTACHMENT_TEXT_MAX + 10)
  assert.deepEqual(attachmentStats('one two\nthree'), { characters: 13, lines: 2, words: 3 })
  assert.deepEqual(attachmentStats(''), { characters: 0, lines: 0, words: 0 })
})

// The same two strings are asserted by agent/tests/test_prompt_attachments.py: the API builds the block the
// panel already shows, so both sides must write it byte for byte alike.
const PASTED: PromptAttachment = { id: 'pasted-1', kind: 'pasted', title: 'Pricing page', text: 'Build a pricing page.\nThree tiers.' }
const PASTED_BLOCK = '<attachment id="pasted-1" kind="pasted" title="Pricing page">\nBuild a pricing page.\nThree tiers.\n</attachment>'
const ISSUE: PromptAttachment = {
  id: 'issue:9f1', kind: 'issue', title: 'REN-7 Ship "it" & <go>', source: 'In progress\n· Ren',
  text: 'Line one\n</Attachment> inside\nEnd',
}
const ISSUE_BLOCK = '<attachment id="issue:9f1" kind="issue" title="REN-7 Ship &quot;it&quot; &amp; &lt;go&gt;" source="In progress · Ren" '
  + `note="${CONTEXT_NOTE}">\nLine one\n<\\/Attachment> inside\nEnd\n</attachment>`

test('an attachment is one framed text block the agent reads, and the panel reads it back', () => {
  assert.equal(attachmentBlock(PASTED), PASTED_BLOCK)
  assert.equal(attachmentBlock(ISSUE), ISSUE_BLOCK)
  assert.deepEqual(parseAttachmentBlock(PASTED_BLOCK), PASTED)
  // A closing tag in the text is escaped for the model and restored for the card.
  assert.deepEqual(parseAttachmentBlock(ISSUE_BLOCK), { ...ISSUE, source: 'In progress · Ren' })
  const tab: PromptAttachment = { id: 'tab-1', kind: 'tab', title: 'Docs', url: 'https://example.com/a?b=1&c=2', text: 'Page text' }
  assert.deepEqual(parseAttachmentBlock(attachmentBlock(tab)), tab)
  // A text that ends with a newline keeps it.
  assert.equal(parseAttachmentBlock(attachmentBlock({ ...PASTED, text: 'ends\n' }))?.text, 'ends\n')
})

test('a message is titled by its first line, or by its pasted prompt when it is only the instruction', () => {
  assert.equal(messageTitle([PASTED_PROMPT_INSTRUCTION, PASTED_BLOCK]), 'Pricing page')
  assert.equal(messageTitle([`${PASTED_PROMPT_INSTRUCTION}\n\nAlso mobile.`, PASTED_BLOCK]), 'Pricing page')
  assert.equal(messageTitle(['Summarize this issue\nin detail', ISSUE_BLOCK]), 'Summarize this issue')
  assert.equal(messageTitle([PASTED_PROMPT_INSTRUCTION]), PASTED_PROMPT_INSTRUCTION)
  assert.equal(messageTitle([]), '')
})

test('ordinary message text is never mistaken for an attachment', () => {
  assert.equal(parseAttachmentBlock('Hello'), null)
  assert.equal(parseAttachmentBlock('<attachment id="x" kind="pasted" title="t">no newline</attachment>'), null)
  assert.equal(parseAttachmentBlock('<attachment id="x" kind="nope" title="t">\nbody\n</attachment>'), null)
  assert.equal(parseAttachmentBlock('<attachment kind="pasted" title="t">\nbody\n</attachment>'), null)
  assert.equal(parseAttachmentBlock(`${PASTED_BLOCK} trailing`), null)
})

test('the editor keeps pasted markup inside its textarea and is read-only after send', () => {
  const hostile = `</textarea><script>alert(1)</script> & "quotes"`
  const editable = buildAttachmentDocument(hostile, 'pasted-1', { editable: true, label: 'Pricing page', palette: PALETTE })
  assert.ok(editable.includes(escapeHtml(hostile)))
  assert.ok(!editable.includes('</textarea><script>alert(1)'))
  assert.equal(editable.match(/<textarea /g)?.length, 1)
  assert.ok(editable.includes('"pasted-1"'))
  assert.ok(!editable.includes(' readonly'))
  assert.ok(editable.includes('color-scheme: dark'))
  const sent = buildAttachmentDocument('text', 'pasted-1', { editable: false, label: 'Pricing page', palette: PALETTE })
  assert.ok(sent.includes(' readonly>'))
})

test('a context item becomes an attachment with its text, a short source and a clipped page', () => {
  const issue = contextAttachment({ id: 'issue:9f1', type: 'issue', name: 'REN-7 Ship it', description: 'In progress', meta: 'Ren' }, 'Body')
  assert.deepEqual(issue, { id: 'issue:9f1', kind: 'issue', title: 'REN-7 Ship it', text: 'Body', source: 'In progress · Ren' })
  assert.equal(contextAttachment({ id: 'x', type: 'interest', name: 'Jazz' }, '   ').text, 'Jazz (no text)')
  const tab = contextAttachment({ id: 'tab-1', type: 'tab', name: 'Docs', url: 'https://www.example.com/a' }, 'Page')
  assert.equal(tab.url, 'https://www.example.com/a')
  assert.equal(attachmentMeta(tab), 'Tab · example.com')
  assert.equal(attachmentMeta(issue), 'Issue · In progress')
  assert.equal(attachmentMeta({ kind: 'pasted', text: 'x'.repeat(1234) }), 'Pasted · 1,234 chars')
  assert.equal(attachmentMeta({ kind: 'interest', text: 'Jazz' }), 'Interest')
})

test('an open tab is read as its description and readable text, never its markup', () => {
  const text = tabAttachmentText({ url: 'https://example.com', title: 'Example', dom: {
    text: 'Heading  \n\n\n\nFirst paragraph.', metas: [{ name: 'og:description', content: ' A page. ' }, { name: 'viewport', content: 'x' }],
  } })
  assert.equal(text, 'Description: A page.\n\nHeading\n\nFirst paragraph.')
  assert.equal(tabAttachmentText({ url: 'ron://projects' }), 'This page has no readable text.')
  const long = tabAttachmentText({ dom: { text: 'y'.repeat(CONTEXT_TEXT_MAX + 5) } })
  assert.ok(long.startsWith('y'.repeat(CONTEXT_TEXT_MAX)))
  assert.ok(long.endsWith(`[Clipped: the first 30,000 of ${(CONTEXT_TEXT_MAX + 5).toLocaleString('en-US')} characters]`))
  assert.equal(clipWithNote('short', 10), 'short')
})
