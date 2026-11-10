import assert from 'node:assert/strict'
import test from 'node:test'
import type { ContextItem } from './context-api.ts'
import {
  attachmentPath, documentContextEntry, entryFiles, issueContextEntries, issueContextEntry, ISSUE_ATTACHMENTS_BUCKET, kindLabel, markdownBody,
  mergeIssueContext, pageFromSource, pageSource, withDocumentContext, withoutDocumentContext,
} from './issue-attachments.ts'

const shot: ContextItem = { id: 'ctx-0190000000a1b2c', kind: 'screenshot', title: 'Checkout bug', source: 'https://shop.example.com/cart',
  added: '2026-11-06T10:00:00Z', file: { media_type: 'image/jpeg', size: 1234, name: 'screenshot 2026/11.jpg' }, preview: '', chars: 0 }
const markdown = `# ${shot.id} Checkout bug\n- kind: screenshot\n- title: Checkout bug\n- added: 2026-11-06T10:00:00Z\n- source: https://shop.example.com/cart\n- file: image/jpeg 1234 screenshot 2026/11.jpg\n\nThe total is wrong.`

test('attachment paths start with the project id (storage RLS) and are safe file names', () => {
  assert.equal(attachmentPath('p1', 'i1', shot), `p1/i1/${shot.id}-screenshot_2026_11.jpg`)
  assert.equal(attachmentPath('p1', 'i1', { id: 'ctx-1', file: { media_type: 'video/webm', size: 1, name: 'recording' } }), 'p1/i1/ctx-1-recording.webm')
  assert.equal(attachmentPath('p1', 'i1', { id: 'ctx-2', file: null }), 'p1/i1/ctx-2-ctx-2')
})

test('markdownBody drops the item heading and metadata', () => {
  assert.equal(markdownBody(markdown), 'The total is wrong.')
  assert.equal(markdownBody('plain text'), 'plain text')
})

test('an issue context entry carries the Markdown body, source, file reference and provenance', () => {
  const file = { bucket: ISSUE_ATTACHMENTS_BUCKET, path: 'p1/i1/x.jpg', name: 'x.jpg', mediaType: 'image/jpeg', size: 1234 }
  const entry = issueContextEntry(shot, markdown, file, '2026-11-06T11:00:00Z')
  assert.deepEqual(entry, { id: shot.id, kind: 'screenshot', title: 'Checkout bug', content: 'The total is wrong.', source: 'https://shop.example.com/cart',
    url: 'https://shop.example.com/cart', images: [], files: [file], added: shot.added, attachedAt: '2026-11-06T11:00:00Z' })
  const image = issueContextEntry({ ...shot, kind: 'image', file: null, source: 'https://cdn.example.com/a.png' }, `# x\n- kind: image\n`)
  assert.deepEqual(image.images, [{ url: 'https://cdn.example.com/a.png' }])
  assert.equal(image.content, 'https://cdn.example.com/a.png')
  const internal = issueContextEntry({ ...shot, kind: 'document', file: null, source: 'ron://project/p/docs/d' }, '# d\n\nPage text')
  assert.equal(internal.url, '')
  assert.equal(internal.source, 'ron://project/p/docs/d')
  assert.equal(issueContextEntry({ ...shot, source: 'http://insecure.example.com', file: null }, '').url, '')
})

test('sending an item again replaces its entry in place; new items are appended', () => {
  const a = issueContextEntry({ ...shot, id: 'a', title: 'A' }, '', undefined, 't1')
  const b = issueContextEntry({ ...shot, id: 'b', title: 'B' }, '', undefined, 't1')
  const existing = [{ id: 'kept', title: 'Kept' }, { ...a }]
  const merged = mergeIssueContext(existing, [{ ...a, title: 'A again' }, b])
  assert.deepEqual(merged.map((entry) => [entry.id, entry.title]), [['kept', 'Kept'], ['a', 'A again'], ['b', 'B']])
  assert.equal(existing[1].title, 'A')
})

test('stored entries are validated for display and files must be in the attachments bucket', () => {
  assert.deepEqual(entryFiles({ files: [
    { bucket: ISSUE_ATTACHMENTS_BUCKET, path: 'p/i/a.webm', name: 'a.webm', mediaType: 'video/webm', size: 9 },
    { bucket: 'music', path: 'x' },
    { bucket: ISSUE_ATTACHMENTS_BUCKET, path: '' },
    'nope',
  ] }), [{ bucket: ISSUE_ATTACHMENTS_BUCKET, path: 'p/i/a.webm', name: 'a.webm', mediaType: 'video/webm', size: 9 }])
  assert.deepEqual(entryFiles({}), [])
  const [entry, ...rest] = issueContextEntries([{ id: 'x', title: 'T', url: 'javascript:alert(1)', images: [{ url: 'http://a' }, 'https://b.png'], content: 7 }, { title: 'no id' }])
  assert.equal(rest.length, 0)
  assert.equal(entry.url, '')
  assert.deepEqual(entry.images, [{ url: 'https://b.png' }])
  assert.equal(entry.content, '')
  assert.equal(entry.kind, 'note')
  assert.equal(kindLabel('recording'), 'Screen recording')
  assert.equal(kindLabel('unknown'), 'Context')
})

test('a related page becomes one document entry addressed by its ron:// page link', () => {
  const page = { id: 'd1', projectId: 'p1', title: 'Rollout plan' }
  const entry = documentContextEntry(page, '2026-11-07T10:00:00Z')
  assert.deepEqual(entry, { id: 'document:d1', kind: 'document', title: 'Rollout plan', content: '', source: 'ron://project/p1/docs/d1',
    url: '', images: [], files: [], added: '2026-11-07T10:00:00Z', attachedAt: '2026-11-07T10:00:00Z' })
  assert.equal(pageSource('p1', 'd1'), entry.source)
  assert.deepEqual(pageFromSource('ron://project/p1/docs/d1'), { projectId: 'p1', documentId: 'd1' })
  assert.equal(pageFromSource('ron://project/p1'), null)
  assert.equal(pageFromSource('https://example.com/docs/d1'), null)
  // The stored entry reads back for the Context tab.
  assert.equal(issueContextEntries([{ ...entry }])[0].source, 'ron://project/p1/docs/d1')
})

test('relating a page adds it to the Context once; unrelating removes every entry for that page', () => {
  const note = { id: 'n', kind: 'note', title: 'Note', content: 'Keep' }
  const fromWidget = { id: 'ctx-9', kind: 'document', title: 'P1 · Rollout plan', content: '# Plan', source: 'ron://project/p1/docs/d1' }
  const page = { id: 'd1', projectId: 'p1', title: 'Rollout plan' }
  const added = withDocumentContext([note], page)
  assert.equal(added.length, 2)
  assert.equal(added[1].id, 'document:d1')
  assert.equal(withDocumentContext(added, page), added)
  assert.equal(withDocumentContext([note, fromWidget], page).length, 2, 'a page sent from the Context widget is not doubled')
  assert.deepEqual(withoutDocumentContext([...added, fromWidget], 'd1'), [note])
  assert.deepEqual(withoutDocumentContext([note, { id: 'l', kind: 'link', source: 'ron://project/p1/docs/d1' }], 'd1').length, 2, 'only page entries are removed')
})
