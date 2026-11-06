import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProjectsRequest } from './projects-api.ts'
import {
  createDocument, deleteDocument, documentAncestors, documentSubtree, documentTitle, documentTree,
  createDocumentConversation, isConflict, linkDocumentToIssue, touchDocumentConversation, listAllDocuments, listDocumentLinks, listDocuments, unlinkDocument, updateDocument,
  type ProjectDocumentSummary,
} from './project-documents.ts'

const doc = (id: string, parentId: string | null, createdAt: number): ProjectDocumentSummary =>
  ({ id, projectId: 'p', parentId, title: id, version: 1, createdBy: null, createdAt, updatedAt: createdAt })

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'd1', project_id: 'p1', parent_id: null, title: 'Spec', content: '<p>Hi</p>', version: 1,
  created_by: 'alice', created_at: '2026-11-05T10:00:00Z', updated_at: '2026-11-05T10:00:00Z', ...overrides,
})

function recordingRequest(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body: unknown }> = []
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined })
    const next = responses.shift()!
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  const request = createProjectsRequest('http://localhost:8765', async () => ({ user: { id: 'alice' }, access_token: 't' }), 'alice', fetcher)
  return { request, calls }
}

test('documents round-trip through the documented routes and bodies', async () => {
  const { request, calls } = recordingRequest([
    { status: 200, body: [row({ content: undefined })] },
    { status: 200, body: row() },
    { status: 200, body: row({ version: 2, title: 'Spec v2' }) },
    { status: 200, body: { deleted: true } },
  ])
  const [summary] = await listDocuments(request, 'p1')
  assert.equal(summary.title, 'Spec')
  assert.equal('content' in summary, false)
  const created = await createDocument(request, { projectId: 'p1', title: '   ', content: '<p>Hi</p>' })
  assert.equal(created.content, '<p>Hi</p>')
  const updated = await updateDocument(request, 'd1', 1, { title: ' Spec v2 ' })
  assert.equal(updated.version, 2)
  assert.deepEqual(await deleteDocument(request, 'd1'), { deleted: true })
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url.replace('http://localhost:8765/projects', '')}`),
    ['GET /p1/documents?offset=0&limit=200', 'POST /documents', 'PATCH /documents/d1', 'DELETE /documents/d1'])
  assert.deepEqual(calls[1].body, { project_id: 'p1', parent_id: null, title: 'Untitled', content: '<p>Hi</p>' })
  assert.deepEqual(calls[2].body, { version: 1, title: 'Spec v2' })
})

test('a stale save surfaces as a conflict, other failures do not', async () => {
  const { request } = recordingRequest([
    { status: 409, body: { detail: 'This page changed elsewhere or access was removed. Reload before saving again.' } },
    { status: 422, body: { detail: 'bad' } },
  ])
  const conflict = await updateDocument(request, 'd1', 1, { content: 'x' }).catch((error) => error)
  assert.equal(isConflict(conflict), true)
  assert.match(conflict.message, /changed elsewhere/)
  const invalid = await updateDocument(request, 'd1', 1, { content: 'x' }).catch((error) => error)
  assert.equal(isConflict(invalid), false)
})

test('tree, subtree and breadcrumb follow parent links in creation order', () => {
  const docs = [doc('b', null, 2), doc('a', null, 1), doc('a2', 'a', 4), doc('a1', 'a', 3), doc('a1x', 'a1', 5), doc('orphan', 'gone', 6)]
  assert.deepEqual(documentTree(docs).map((r) => `${'-'.repeat(r.depth)}${r.document.id}:${r.childCount}`),
    ['a:2', '-a1:1', '--a1x:0', '-a2:0', 'b:0', 'orphan:0'])
  assert.deepEqual(documentSubtree(docs, 'a').sort(), ['a', 'a1', 'a1x', 'a2'])
  assert.deepEqual(documentAncestors(docs, 'a1x').map((d) => d.id), ['a', 'a1'])
  assert.equal(documentTitle('  '), 'Untitled')
  assert.equal(documentTitle('x'.repeat(400)).length, 300)
})

test('page–issue links use the documented routes, with the filter kept beside paging', async () => {
  const link = { id: 'l1', document_id: 'd1', issue_id: 'i9', created_at: '2026-11-05T10:00:00Z' }
  const { request, calls } = recordingRequest([
    { status: 200, body: [row({ content: undefined })] },
    { status: 200, body: [link] },
    { status: 200, body: [link] },
    { status: 200, body: link },
    { status: 200, body: { deleted: true } },
  ])
  assert.equal((await listAllDocuments(request))[0].title, 'Spec')
  assert.deepEqual(await listDocumentLinks(request, { documentId: 'd1' }), [{ id: 'l1', documentId: 'd1', issueId: 'i9', createdAt: Date.parse(link.created_at) }])
  assert.equal((await listDocumentLinks(request, { issueId: 'i9' }))[0].documentId, 'd1')
  assert.equal((await linkDocumentToIssue(request, 'd1', 'i9')).id, 'l1')
  assert.deepEqual(await unlinkDocument(request, 'l1'), { deleted: true })
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url.replace('http://localhost:8765/projects', '')}`), [
    'GET /documents?offset=0&limit=200', 'GET /document-links?document_id=d1&offset=0&limit=200',
    'GET /document-links?issue_id=i9&offset=0&limit=200', 'POST /document-links', 'DELETE /document-links/l1'])
  assert.deepEqual(calls[3].body, { document_id: 'd1', issue_id: 'i9' })
})

test('page conversations are created on the page and touched on Try again; the store assigns the session', async () => {
  const conversation = { id: 'c1', document_id: 'd1', session_id: 'doc-c1', title: 'Draft the runbook', goal: false,
    created_at: '2026-11-05T10:00:00Z', updated_at: '2026-11-05T10:00:00Z' }
  const { request, calls } = recordingRequest([
    { status: 200, body: conversation },
    { status: 200, body: { ...conversation, updated_at: '2026-11-05T11:00:00Z' } },
  ])
  const created = await createDocumentConversation(request, 'd1', `  Draft   the\nrunbook ${'x'.repeat(300)}`, false)
  assert.equal(created.sessionId, 'doc-c1')
  const touched = await touchDocumentConversation(request, created)
  assert.equal(touched.updatedAt, Date.parse('2026-11-05T11:00:00Z'))
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url.replace('http://localhost:8765/projects', '')}`),
    ['POST /documents/d1/conversations', 'PATCH /document-conversations/c1'])
  const title = (calls[0].body as { title: string }).title
  assert.ok(title.startsWith('Draft the runbook xxx') && title.length === 200 && title.endsWith('…'))
  assert.deepEqual(calls[1].body, { title: 'Draft the runbook' })
})
