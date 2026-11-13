import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ARTICLE_ACTIONS, actionFilter, articleAction, articleContextEntry, articleRef, chatMessage, codeMessage, documentMessage, issueMessage, projectMessage, searchQuery,
} from './article-actions.ts'
import type { ArticleAttachment } from './articles.ts'
import { mergeIssueContext } from './issue-attachments.ts'

const ARTICLE: ArticleAttachment = {
  id: 'a1', title: 'Fed  holds\nrates steady', url: 'https://www.example.com/fed', source: 'Example News',
  text: 'The Federal Reserve held rates.\n\n## Why it matters\n\nBorrowing costs stay high.', status: 'extracted',
}

test('every action the reader offers is listed once, in the Ask / Create / Save order', () => {
  assert.deepEqual(ARTICLE_ACTIONS.map((action) => action.id), ['search', 'chat', 'project', 'code', 'document', 'issue', 'context'])
  assert.deepEqual([...new Set(ARTICLE_ACTIONS.map((action) => action.group))], ['Ask', 'Create', 'Save'])
  assert.equal(articleAction('issue').label, 'Create an issue')
  // Only the search needs words; every other prompt has a meaning when left empty.
  assert.deepEqual(ARTICLE_ACTIONS.filter((action) => !action.prompt.optional).map((action) => action.id), ['search'])
})

test('filtering the list matches labels first, then what each action is for', () => {
  const ranked = (search: string) => ARTICLE_ACTIONS
    .map((action) => ({ id: action.id, score: actionFilter(action.label, search, [action.description, ...action.keywords]) }))
    .filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).map((entry) => entry.id)
  assert.deepEqual(ranked('issue'), ['issue', 'context'])
  assert.deepEqual(ranked('talk'), ['chat'])
  assert.deepEqual(ranked('BUILD'), ['code'])
  assert.equal(ranked('').length, ARTICLE_ACTIONS.length)
  assert.deepEqual(ranked('zzz'), [])
})

test('a message names the attached article by title, publisher and link on one line', () => {
  assert.equal(articleRef(ARTICLE), '"Fed holds rates steady" (Example News, https://www.example.com/fed)')
})

test('the article is never pasted into a message: it rides as the attachment', () => {
  for (const message of [chatMessage(''), projectMessage('', ARTICLE), codeMessage('', ARTICLE), documentMessage('', ARTICLE, null), issueMessage('', ARTICLE)]) {
    assert.ok(!message.includes('Borrowing costs stay high'))
  }
})

test('a conversation sends the user’s words as they are, or asks for the essentials', () => {
  assert.equal(chatMessage('  What does this mean for mortgages?  '), 'What does this mean for mortgages?')
  assert.match(chatMessage('   '), /^Read the attached article/)
})

test('Start a project asks Ren for the project and its backlog with its workspace tools', () => {
  const message = projectMessage('Track the impact on our loan book', ARTICLE)
  assert.match(message, /^Start a project from the attached article "Fed holds rates steady"/)
  assert.match(message, /What the project should achieve: Track the impact on our loan book/)
  assert.match(message, /create_project/)
  assert.match(message, /create_issue/)
  assert.match(projectMessage('', ARTICLE), /What the project should achieve: the work this article calls for\./)
})

test('Create a document says exactly where to save it', () => {
  const inProject = documentMessage('A one-page brief', ARTICLE, { id: 'p-1', name: 'Rates  Watch', key: 'RW' })
  assert.match(inProject, /What it should be: A one-page brief/)
  assert.match(inProject, /create_document in the Rates Watch \(RW\) project \(project_id p-1\)/)
  assert.match(documentMessage('', ARTICLE, null), /create_document in my documents \(no project_id\)/)
})

test('Create an issue asks the project agent for the issue and the article in its Context', () => {
  const message = issueMessage('Review our pricing', ARTICLE)
  assert.match(message, /What needs doing: Review our pricing/)
  for (const tool of ['read_project', 'create_issue', 'add_issue_context']) assert.match(message, new RegExp(tool))
})

test('a coding project keeps the user’s request first, with the article as its brief', () => {
  const message = codeMessage('Chart the rate path', ARTICLE)
  assert.equal(message.split('\n\n')[0], 'Chart the rate path')
  assert.match(message, /attached article "Fed holds rates steady" .* is the brief\./)
})

test('the first search is the headline on one line', () => {
  assert.equal(searchQuery('  Fed holds\n rates  '), 'Fed holds rates')
  assert.equal(searchQuery('x'.repeat(500)).length, 400)
})

test('Add to a project makes one Context entry per article: the note leads, links and images are https only', () => {
  const entry = articleContextEntry(ARTICLE, '  Affects   Q3 pricing ', 'https://cdn.example.com/hero.jpg', '2026-11-12T10:00:00.000Z')
  assert.equal(entry.id, 'article:https://www.example.com/fed')
  assert.equal(entry.kind, 'article')
  assert.equal(entry.title, 'Fed holds rates steady')
  assert.ok(entry.content.startsWith('**Note:** Affects Q3 pricing\n\n---\n\nThe Federal Reserve held rates.'))
  assert.equal(entry.url, 'https://www.example.com/fed')
  assert.deepEqual(entry.images, [{ url: 'https://cdn.example.com/hero.jpg' }])
  assert.equal(entry.added, '2026-11-12T10:00:00.000Z')

  const plain = articleContextEntry({ ...ARTICLE, url: 'http://www.example.com/fed' }, '', 'http://cdn.example.com/hero.jpg')
  assert.equal(plain.content, ARTICLE.text)
  assert.equal(plain.url, '')
  assert.deepEqual(plain.images, [])
})

test('adding the same article to an issue again refreshes its entry instead of repeating it', () => {
  const first = articleContextEntry(ARTICLE, 'first', undefined, '2026-11-12T10:00:00.000Z')
  const again = articleContextEntry(ARTICLE, 'second', undefined, '2026-11-12T11:00:00.000Z')
  const note = { id: 'n1', kind: 'note', title: 'Other' }
  const merged = mergeIssueContext(mergeIssueContext([note], [first]), [again])
  assert.equal(merged.length, 2)
  assert.match(String(merged[1].content), /\*\*Note:\*\* second/)
})
