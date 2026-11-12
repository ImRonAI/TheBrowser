import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProjectsRequest } from './projects-api.ts'
import {
  COMMENT_MAX, addComment, canDeleteComment, canEditComment, commentAuthor, commentAuthorLabel, commentEdited, commentErrorMessage,
  commentLength, commentProblem, commentTime, commentTimestamp, commentViewer, deleteComment, editComment, errorStatus, listComments,
  mapComment, orderComments, renReplyMessage, replyNotice, replyOutcome, sameComments, withComment, withoutComment, type IssueComment,
} from './issue-comments.ts'

const GUEST = `guest:${'a'.repeat(64)}`
const UTC = { locale: 'en-US', timeZone: 'UTC' }
/** ICU may put a narrow no-break space before AM/PM. */
const plain = (text: string | null) => text?.replace(/\s/g, ' ') ?? null

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1', issue_id: 'i1', project_id: 'p1', author_id: 'u1', author_name: 'Tim Hunter', author_kind: 'user', agent_name: null,
  body: 'Looks good to me.', version: 1, created_at: '2026-11-10T09:00:00Z', updated_at: '2026-11-10T09:00:00Z', edited_at: null, ...overrides,
})

const comment = (id: string, createdAt: number, overrides: Partial<IssueComment> = {}): IssueComment => ({
  id, issueId: 'i1', projectId: 'p1', authorId: 'u1', authorName: 'Tim', authorKind: 'user', agentName: null, body: id,
  version: 1, createdAt, updatedAt: createdAt, editedAt: null, ...overrides,
})

function recordingRequest(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body: unknown }> = []
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined })
    const next = responses.shift()
    if (!next) throw new Error(`Unexpected request: ${init.method ?? 'GET'} ${url}`)
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  const request = createProjectsRequest('http://localhost:8765', async () => ({ user: { id: 'u1' }, access_token: 't' }), 'u1', fetcher)
  return { request, calls }
}

const route = (call: { url: string; method: string }) => `${call.method} ${call.url.replace('http://localhost:8765/projects', '')}`

test('a comment row maps to the renderer shape; an agent comment names its agent', () => {
  assert.deepEqual(mapComment(row()), {
    id: 'c1', issueId: 'i1', projectId: 'p1', authorId: 'u1', authorName: 'Tim Hunter', authorKind: 'user', agentName: null,
    body: 'Looks good to me.', version: 1, createdAt: Date.parse('2026-11-10T09:00:00Z'), updatedAt: Date.parse('2026-11-10T09:00:00Z'), editedAt: null,
  })
  const agent = mapComment(row({ author_kind: 'agent', agent_name: 'Issue agent', version: 1 }))
  assert.equal(agent.authorKind, 'agent')
  assert.equal(agent.agentName, 'Issue agent')
  // A person's comment never carries an agent name, whatever the row says.
  assert.equal(mapComment(row({ agent_name: 'Issue agent' })).agentName, null)
  const edited = mapComment(row({ version: 3, edited_at: '2026-11-10T10:30:00Z' }))
  assert.equal(edited.editedAt, Date.parse('2026-11-10T10:30:00Z'))
  assert.equal(edited.version, 3)
  // A deleted account keeps the comment and the name it was written under.
  assert.equal(mapComment(row({ author_id: null })).authorId, null)
  assert.equal(mapComment(row({ author_name: null })).authorName, '')
})

test('the thread is oldest first by time, then id, with one row per comment', () => {
  const ordered = orderComments([comment('b', 20), comment('c', 10), comment('a', 20), comment('c', 10, { body: 'second copy' })])
  assert.deepEqual(ordered.map((item) => item.id), ['c', 'a', 'b'])
  // Pages that overlap keep the later copy.
  assert.equal(ordered[0].body, 'second copy')
  // A new comment joins in order; an edit replaces the earlier version in place.
  const added = withComment(ordered, comment('d', 15))
  assert.deepEqual(added.map((item) => item.id), ['c', 'd', 'a', 'b'])
  const edited = withComment(added, comment('a', 20, { body: 'edited', version: 2 }))
  assert.deepEqual(edited.map((item) => item.id), ['c', 'd', 'a', 'b'])
  assert.equal(edited[2].body, 'edited')
  assert.deepEqual(withoutComment(edited, 'd').map((item) => item.id), ['c', 'a', 'b'])
  // A refresh that changed nothing is the same thread; an edit, a deletion or a new comment is not.
  assert.equal(sameComments(added, added.map((item) => ({ ...item }))), true)
  assert.equal(sameComments(added, edited), false)
  assert.equal(sameComments(edited, withoutComment(edited, 'd')), false)
  assert.equal(sameComments([], []), true)
})

test('a comment is 1 to 20,000 characters after trimming, counted as the API counts them', () => {
  assert.equal(commentProblem(''), 'Write something before posting the comment.')
  assert.equal(commentProblem(' \n\t '), 'Write something before posting the comment.')
  assert.equal(commentProblem('  ok  '), null)
  assert.equal(commentProblem('x'.repeat(COMMENT_MAX)), null)
  assert.equal(commentProblem(` ${'x'.repeat(COMMENT_MAX)}\n`), null)
  assert.equal(commentProblem('x'.repeat(COMMENT_MAX + 1)), 'A comment is at most 20,000 characters.')
  // An emoji is one character to the API, though two UTF-16 units in JavaScript.
  assert.equal(commentLength(' 👍🏽 ok '), 5)
  assert.equal(commentProblem('👍'.repeat(COMMENT_MAX)), null)
})

test('comments load every page and write through the documented routes and bodies', async () => {
  const page = Array.from({ length: 200 }, (_, index) => row({ id: `c${String(index).padStart(3, '0')}`, created_at: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString() }))
  const { request, calls } = recordingRequest([
    { status: 200, body: page },
    { status: 200, body: [row({ id: 'c200', created_at: '2026-11-10T00:00:00Z' })] },
    { status: 200, body: row({ id: 'n1', body: 'Shipped in v2.' }) },
    { status: 200, body: row({ id: 'n1', body: 'Shipped in v2.1.', version: 2, edited_at: '2026-11-10T09:05:00Z' }) },
    { status: 200, body: { deleted: true } },
  ])
  const thread = await listComments(request, 'i1')
  assert.equal(thread.length, 201)
  assert.equal(thread[0].id, 'c000')
  assert.equal(thread[200].id, 'c200')
  const added = await addComment(request, 'i1', '  Shipped in v2.\n')
  assert.equal(added.body, 'Shipped in v2.')
  const edited = await editComment(request, added, ' Shipped in v2.1. ')
  assert.equal(edited.version, 2)
  assert.notEqual(edited.editedAt, null)
  await deleteComment(request, 'n1')
  assert.deepEqual(calls.map(route), [
    'GET /issues/i1/comments?offset=0&limit=200',
    'GET /issues/i1/comments?offset=200&limit=200',
    'POST /issues/i1/comments',
    'PATCH /comments/n1',
    'DELETE /comments/n1',
  ])
  // The body is trimmed; the edit carries the version it was read at; nothing else is sent.
  assert.deepEqual(calls[2].body, { body: 'Shipped in v2.' })
  assert.deepEqual(calls[3].body, { version: 1, body: 'Shipped in v2.1.' })
  assert.equal(calls[4].body, undefined)
})

test('a blank or oversized comment is refused before any request; API errors keep their status', async () => {
  const { request, calls } = recordingRequest([
    { status: 409, body: { detail: 'Comment changed or you can\'t edit it. Reload the comments before saving again.' } },
    { status: 404, body: { detail: 'Comment not found or you can\'t delete it' } },
    { status: 200, body: { deleted: false } },
    { status: 401, body: { detail: 'Session expired; sign in again' } },
  ])
  await assert.rejects(addComment(request, 'i1', '   '), (error: Error) => errorStatus(error) === 422 && /Write something/.test(error.message))
  await assert.rejects(editComment(request, comment('c1', 1), 'x'.repeat(COMMENT_MAX + 1)), (error: Error) => errorStatus(error) === 422)
  assert.equal(calls.length, 0)
  await assert.rejects(editComment(request, comment('c1', 1), 'New text'), (error: Error) => errorStatus(error) === 409 && /Comment changed/.test(error.message))
  await assert.rejects(deleteComment(request, 'c1'), (error: Error) => errorStatus(error) === 404)
  await assert.rejects(deleteComment(request, 'c1'), /deletion was not confirmed/)
  const signedOut = await listComments(request, 'i1').catch((error: unknown) => error)
  assert.equal(commentErrorMessage(signedOut, 'Comments could not be loaded.'), 'You’re signed out. Sign in again to read and post comments.')
  assert.equal(commentErrorMessage(new Error(''), 'Comments could not be loaded.'), 'Comments could not be loaded.')
  assert.equal(commentErrorMessage('nope', 'Fallback.'), 'Fallback.')
})

test('ids in paths are encoded', async () => {
  const { request, calls } = recordingRequest([{ status: 200, body: [] }, { status: 200, body: { deleted: true } }])
  await listComments(request, 'a/b')
  await deleteComment(request, 'c?1')
  assert.deepEqual(calls.map(route), ['GET /issues/a%2Fb/comments?offset=0&limit=200', 'DELETE /comments/c%3F1'])
})

test('a person is named; an agent is named with the person it works for', () => {
  const person = comment('c1', 1, { authorName: 'Alice Smith' })
  assert.deepEqual(commentAuthor(person), { name: 'Alice Smith', forName: null })
  assert.equal(commentAuthorLabel(person), 'Alice Smith')
  const agent = comment('c2', 1, { authorKind: 'agent', agentName: 'Issue agent', authorName: 'Alice Smith' })
  assert.deepEqual(commentAuthor(agent), { name: 'Issue agent', forName: 'Alice Smith' })
  assert.equal(commentAuthorLabel(agent), 'Issue agent · for Alice Smith')
  // A guest's rows are stamped "You".
  assert.equal(commentAuthorLabel({ ...agent, agentName: 'Project agent', authorName: 'You' }), 'Project agent · for You')
  assert.equal(commentAuthorLabel({ ...person, authorName: '  ' }), 'Someone')
  assert.equal(commentAuthorLabel({ ...agent, agentName: null, authorName: '' }), 'Agent · for Someone')
})

test('times read as a thread says them, then as a date, with the year only when it differs', () => {
  const now = Date.parse('2026-11-11T12:00:00Z')
  const ago = (ms: number) => commentTime(now - ms, { now, ...UTC })
  assert.equal(ago(0), 'just now')
  assert.equal(ago(59_000), 'just now')
  assert.equal(commentTime(now + 5_000, { now, ...UTC }), 'just now')
  assert.equal(ago(60_000), '1m ago')
  assert.equal(ago(59 * 60_000 + 59_000), '59m ago')
  assert.equal(ago(60 * 60_000), '1h ago')
  assert.equal(ago(23 * 3_600_000 + 3_599_000), '23h ago')
  assert.equal(ago(24 * 3_600_000), '1d ago')
  assert.equal(ago(6 * 86_400_000), '6d ago')
  assert.equal(commentTime(Date.parse('2026-11-03T08:00:00Z'), { now, ...UTC }), 'Nov 3')
  assert.equal(commentTime(Date.parse('2025-12-30T08:00:00Z'), { now, ...UTC }), 'Dec 30, 2025')
  assert.equal(commentTime(Number.NaN, { now, ...UTC }), '')
  assert.equal(plain(commentTimestamp(Date.parse('2026-11-11T15:04:00Z'), UTC)), 'Nov 11, 2026, 3:04 PM')
})

test('the edited marker appears only on an edited comment, with when it was edited', () => {
  assert.equal(commentEdited(comment('c1', 1), UTC), null)
  assert.equal(plain(commentEdited(comment('c1', 1, { editedAt: Date.parse('2026-11-11T15:04:00Z') }), UTC)), 'Edited Nov 11, 2026, 3:04 PM')
})

test('people edit their own comments and delete their own and their agents’; the owner deletes any', () => {
  const own = comment('c1', 1, { authorId: 'u1' })
  const ownAgent = comment('c2', 1, { authorId: 'u1', authorKind: 'agent', agentName: 'Issue agent' })
  const theirs = comment('c3', 1, { authorId: 'u2' })
  const theirAgent = comment('c4', 1, { authorId: 'u2', authorKind: 'agent', agentName: 'Project agent' })
  const orphan = comment('c5', 1, { authorId: null })

  const member = commentViewer('u1', 'u2')
  assert.deepEqual(member, { authorId: 'u1', owner: false })
  assert.deepEqual([own, ownAgent, theirs, theirAgent, orphan].map((item) => canEditComment(item, member)), [true, false, false, false, false])
  assert.deepEqual([own, ownAgent, theirs, theirAgent, orphan].map((item) => canDeleteComment(item, member)), [true, true, false, false, false])

  const owner = commentViewer('u2', 'u2')
  assert.deepEqual(owner, { authorId: 'u2', owner: true })
  assert.deepEqual([own, ownAgent, theirs, theirAgent, orphan].map((item) => canEditComment(item, owner)), [false, false, true, false, false])
  assert.deepEqual([own, ownAgent, theirs, theirAgent, orphan].map((item) => canDeleteComment(item, owner)), [true, true, true, true, true])

  // A guest's rows carry the workspace identity, which owns every project in it (not the renderer's guest: id).
  const guest = commentViewer(GUEST, 'w1')
  assert.deepEqual(guest, { authorId: 'w1', owner: true })
  assert.equal(canEditComment(comment('c6', 1, { authorId: 'w1', authorName: 'You' }), guest), true)
  assert.equal(canEditComment(comment('c7', 1, { authorId: 'w1', authorKind: 'agent', agentName: 'Issue agent' }), guest), false)

  // Nobody signed in, or a project without a known owner, offers nothing it can't do.
  const nobody = commentViewer(null, 'u2')
  assert.equal(canEditComment(orphan, nobody) || canDeleteComment(orphan, nobody), false)
  assert.deepEqual(commentViewer('u1', undefined), { authorId: 'u1', owner: false })
})

test('the reply request names the comment and asks for one reply with add_comment', () => {
  const message = renReplyMessage('3f2c')
  assert.match(message, /comment 3f2c/)
  assert.match(message, /read_comments/)
  assert.match(message, /add_comment/)
  assert.ok(message.length < 20000)
})

test('a finished reply run says whether Ren replied, or why it did not', () => {
  const run = (status: string, activity: Array<{ id: string; name: string; status: string }>, extra: { error?: string | null; output?: string } = {}) =>
    ({ id: 'r1', status, output: extra.output ?? '', error: extra.error ?? null, activity })
  const replied = replyOutcome(run('completed', [
    { id: 't1', name: 'read_comments', status: 'running' }, { id: 't1', name: 'read_comments', status: 'success' },
    { id: 't2', name: 'add_comment', status: 'running' }, { id: 't2', name: 'add_comment', status: 'success' },
  ]))
  assert.deepEqual(replied, { status: 'completed', replied: true, error: null, output: '' })
  assert.equal(replyNotice(replied), null)

  // A call that only started, or failed, did not happen.
  const silent = replyOutcome(run('completed', [
    { id: 't2', name: 'add_comment', status: 'running' }, { id: 't2', name: 'add_comment', status: 'error' },
    { id: 't3', name: 'update_issue', status: 'running' },
  ], { output: '  The tests pass now.  ' }))
  assert.deepEqual(silent, { status: 'completed', replied: false, error: null, output: 'The tests pass now.' })
  assert.deepEqual(replyNotice(silent), { tone: 'info', text: 'Ren finished without replying in the comments.', output: 'The tests pass now.' })

  // A run that failed after it posted its reply still shows its error, without claiming there was no reply.
  const failedAfterReply = replyOutcome(run('failed', [{ id: 't4', name: 'add_comment', status: 'success' }], { error: 'Timed out' }))
  assert.equal(failedAfterReply.replied, true)
  assert.deepEqual(replyNotice(failedAfterReply), { tone: 'error', text: 'Ren replied, then stopped with an error: Timed out', output: '' })

  const stopped = replyOutcome(run('canceled', []))
  assert.equal(stopped.status, 'cancelled')
  assert.deepEqual(replyNotice(stopped), { tone: 'info', text: 'Stopped before Ren replied.', output: '' })
  assert.equal(replyNotice(replyOutcome(run('canceled', [{ id: 't2', name: 'add_comment', status: 'success' }]))), null)

  const failed = replyOutcome(run('failed', [], { error: 'Model provider is unavailable' }))
  assert.deepEqual(replyNotice(failed), { tone: 'error', text: 'Ren couldn’t reply: Model provider is unavailable', output: '' })
  const interrupted = replyOutcome(run('interrupted', [], { error: null }))
  assert.equal(interrupted.status, 'failed')
  assert.equal(interrupted.error, 'Ren stopped before it finished.')
})
