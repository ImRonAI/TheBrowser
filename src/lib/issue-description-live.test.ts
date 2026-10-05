import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DRAFT_LIMIT, descriptionHtml, descriptionLivePrompt, latestProposal } from './issue-description-live.ts'

test('descriptionHtml escapes model text and keeps paragraphs', () => {
  assert.equal(descriptionHtml('a <b> & c\nd\n\ne'), '<p>a &lt;b&gt; &amp; c<br>d</p><p>e</p>')
})

test('descriptionLivePrompt strips /goal, bounds the draft and asks for review-first text', () => {
  const prompt = descriptionLivePrompt('/goal make it crisp', 'x'.repeat(DRAFT_LIMIT + 5))
  assert.ok(prompt.startsWith('Help me write the description for this issue. make it crisp'))
  assert.ok(prompt.includes('Current description draft'))
  assert.ok(prompt.includes('x'.repeat(DRAFT_LIMIT) + '…'))
  assert.ok(prompt.endsWith('I will review it before anything is saved.'))
  assert.equal(descriptionLivePrompt('short', '   ').includes('Current description draft'), false)
})

test('latestProposal returns the newest non-empty assistant turn only', () => {
  assert.equal(latestProposal([]), undefined)
  assert.equal(latestProposal([{ role: 'user', text: 'hi' }]), undefined)
  const turns = [{ role: 'assistant' as const, text: 'first' }, { role: 'user' as const, text: 'more' }, { role: 'assistant' as const, text: 'second' }, { role: 'assistant' as const, text: '  ' }]
  assert.equal(latestProposal(turns)?.text, 'second')
})
