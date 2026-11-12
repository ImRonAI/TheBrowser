import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProjectsRequest } from './projects-api.ts'
import {
  createDocument, deleteDocument, documentAncestors, documentSubtree, documentTitle, documentTree,
  createDocumentConversation, getDocumentSkill, isConflict, publishDocumentSkill, skillProblems, linkDocumentToIssue, touchDocumentConversation, listAllDocuments, listDocumentLinks, listDocuments, unlinkDocument, updateDocument,
  createProjectFromDocumentPrompt, documentErrorMessage, documentSource, documentsLibraryUrl, moveDocument, parseDocumentsLibraryUrl,
  searchDocuments, withMovedDocument,
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

test('a page publishes as the agent’s skill through the documented route; problems come back one per reference', async () => {
  const skill = { id: 'doc-d1', name: 'weekly-brief', description: 'Write a weekly brief.', agent_id: 'panel',
    files: ['SKILL.md', 'workflow.sop.md', 'manifest.json'], created_at: '2026-11-05T10:00:00Z', updated_at: '2026-11-05T11:00:00Z',
    published_version: 4, current: true, steps: 2, listed: true }
  const { request, calls } = recordingRequest([
    { status: 200, body: { skill: null } },
    { status: 200, body: { status: 'published', skill } },
    { status: 422, body: { detail: 'Unknown or unusable references: tool “nope” is not in the tool catalog; mcp “x” is not a configured MCP server.' } },
  ])
  assert.equal(await getDocumentSkill(request, 'd1', 'alice'), null)
  const published = await publishDocumentSkill(request, 'd1', 'alice')
  assert.equal(published.status, 'published')
  assert.deepEqual(published.skill, { id: 'doc-d1', name: 'weekly-brief', description: 'Write a weekly brief.', agentId: 'panel',
    files: ['SKILL.md', 'workflow.sop.md', 'manifest.json'], createdAt: Date.parse(skill.created_at), updatedAt: Date.parse(skill.updated_at),
    publishedVersion: 4, current: true, steps: 2, listed: true })
  const failure = await publishDocumentSkill(request, 'd1', 'alice').catch((error: Error & { status?: number }) => error)
  assert.equal((failure as { status?: number }).status, 422)
  assert.deepEqual(skillProblems((failure as Error).message), ['tool “nope” is not in the tool catalog', 'mcp “x” is not a configured MCP server'])
  assert.deepEqual(skillProblems('Name this page first: its title becomes the skill’s name.'), ['Name this page first: its title becomes the skill’s name.'])
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url.replace('http://localhost:8765/projects', '')}`), [
    'GET /documents/d1/skill?user_id=alice&agent_id=panel', 'POST /documents/d1/skill', 'POST /documents/d1/skill'])
  assert.deepEqual(calls[1].body, { user_id: 'alice', agent_id: 'panel' })
})

test('a personal page has no project; it is created with project_id null and opens in the library', async () => {
  const { request, calls } = recordingRequest([
    { status: 200, body: row({ id: 'n1', project_id: null }) },
    { status: 200, body: [row({ id: 'n1', project_id: null, content: undefined }), row({ id: 'd1', content: undefined })] },
  ])
  const created = await createDocument(request, { projectId: null, title: 'Notes', content: '<p>x</p>' })
  assert.equal(created.projectId, null)
  assert.deepEqual(calls[0].body, { project_id: null, parent_id: null, title: 'Notes', content: '<p>x</p>' })
  const all = await listAllDocuments(request)
  assert.deepEqual(all.map((page) => [page.id, page.projectId]), [['n1', null], ['d1', 'p1']])
  assert.equal(documentSource(all[0]), 'ron://documents/n1')
  assert.equal(documentSource(all[1]), 'ron://project/p1/docs/d1')
})

test('moving a page posts the target project and answers the moved page; refusals keep their status', async () => {
  const { request, calls } = recordingRequest([
    { status: 200, body: row({ id: 'n1', project_id: 'p2', parent_id: null, version: 3 }) },
    { status: 422, body: { detail: 'The page is already in that project' } },
    { status: 403, body: { detail: 'Project not accessible' } },
    { status: 404, body: { detail: 'Document not found or not accessible' } },
  ])
  const moved = await moveDocument(request, 'n1', 'p2')
  assert.deepEqual([moved.id, moved.projectId, moved.parentId, moved.version, moved.content], ['n1', 'p2', null, 3, '<p>Hi</p>'])
  for (const [status, detail] of [[422, /already in that project/], [403, /not accessible/], [404, /not found/]] as const) {
    const failure = await moveDocument(request, 'n1', 'p2').catch((error: Error & { status?: number }) => error)
    assert.equal((failure as { status?: number }).status, status)
    assert.match((failure as Error).message, detail)
  }
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url.replace('http://localhost:8765/projects', '')}`),
    Array(4).fill('POST /documents/n1/move'))
  assert.deepEqual(calls[0].body, { project_id: 'p2' })
})

test('library URLs round-trip: the library itself, one page, and nothing else', () => {
  assert.equal(documentsLibraryUrl(), 'ron://documents')
  assert.equal(documentsLibraryUrl(null), 'ron://documents')
  assert.equal(documentsLibraryUrl('d1'), 'ron://documents/d1')
  assert.deepEqual(parseDocumentsLibraryUrl('ron://documents'), { documentId: null })
  assert.deepEqual(parseDocumentsLibraryUrl('ron://documents/'), { documentId: null })
  assert.deepEqual(parseDocumentsLibraryUrl(documentsLibraryUrl('d1')), { documentId: 'd1' })
  assert.deepEqual(parseDocumentsLibraryUrl('ron://documents/d1/'), { documentId: 'd1' })
  for (const other of [undefined, null, '', 'ron://documentsx', 'ron://documents/d1/extra', 'ron://documents?id=d1', 'ron://project/p1/docs/d1', 'https://example.com/documents'])
    assert.equal(parseDocumentsLibraryUrl(other), null)
})

test('a move carries the subtree into the project and makes the moved page a root', () => {
  const docs = [doc('a', null, 1), doc('a1', 'a', 2), doc('a1x', 'a1', 3), doc('b', 'a', 4), doc('c', null, 5)].map((page) => ({ ...page, projectId: null }))
  const moved = withMovedDocument(docs, 'a1', 'p2')
  assert.deepEqual(moved.map((page) => `${page.id}:${page.projectId}:${page.parentId}`),
    ['a:null:null', 'a1:p2:null', 'a1x:p2:a1', 'b:null:a', 'c:null:null'])
  assert.notEqual(moved, docs)
  assert.equal(docs[1].projectId, null)
})

test('library search matches every word of a title and keeps each match under its ancestors', () => {
  const docs = [doc('Roadmap', null, 1), doc('Q3 launch plan', 'Roadmap', 2), doc('Launch checklist', 'Q3 launch plan', 3), doc('Notes', null, 4),
    { ...doc('untitled', null, 5), title: '' }]
  const plan = searchDocuments(docs, '  LAUNCH  plan ')
  assert.deepEqual([...plan.matches], ['Q3 launch plan'])
  assert.deepEqual(plan.shown.map((page) => page.id), ['Roadmap', 'Q3 launch plan'])
  const launch = searchDocuments(docs, 'launch')
  assert.deepEqual([...launch.matches].sort(), ['Launch checklist', 'Q3 launch plan'])
  assert.deepEqual(launch.shown.map((page) => page.id), ['Roadmap', 'Q3 launch plan', 'Launch checklist'])
  assert.deepEqual([...searchDocuments(docs, 'untitled').matches], ['untitled'])
  assert.equal(searchDocuments(docs, '   ').shown.length, 0)
  assert.equal(searchDocuments(docs, 'nothing like it').matches.size, 0)
})

test('Create project with Ren names the page and the workspace tools for each step', () => {
  const prompt = createProjectFromDocumentPrompt({ id: 'n1', title: '  Garden plan ' })
  assert.match(prompt, /^Create a project from my page "Garden plan" \(document id n1\)\./)
  for (const tool of ['read_document', 'create_project', 'create_issue', 'add_document_to_project']) assert.ok(prompt.includes(tool), tool)
  assert.match(prompt, /project key/)
  assert.doesNotMatch(prompt, /moves it/)
  assert.match(createProjectFromDocumentPrompt({ id: 'd1', title: '' }), /my page "Untitled"/)
  assert.match(createProjectFromDocumentPrompt({ id: 'd1', title: 'Spec' }, { name: 'Apollo', key: 'APL' }),
    /in the Apollo \(APL\) project now; adding it moves it, with the pages under it, into the new project/)
})

test('a lost sign-in reads as one; other failures keep the server’s words', () => {
  assert.match(documentErrorMessage(Object.assign(new Error('Missing bearer token'), { status: 401 }), 'x'), /signed out\. Sign in again/)
  assert.match(documentErrorMessage(new Error('Session changed; reload Projects.'), 'x'), /signed in or out/)
  assert.equal(documentErrorMessage(Object.assign(new Error('Project not accessible'), { status: 403 }), 'x'), 'Project not accessible')
  assert.equal(documentErrorMessage('nope', 'The page could not be saved.'), 'The page could not be saved.')
  assert.equal(documentErrorMessage(new Error(''), 'Fallback'), 'Fallback')
})
