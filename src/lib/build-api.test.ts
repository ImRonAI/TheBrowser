import assert from 'node:assert/strict'
import test from 'node:test'
import { BuildConflict, buildFile, buildFileUrl, buildPreviewUrl, buildSaveFile, buildTree, buildWorkspace, createBuildRequest, defaultBuildFile, buildDeleteFile,
  previewVersion, workspaceRelative, type BuildEntry } from './build-api.ts'

const recording = (responses: { status: number; body?: unknown }[]) => {
  const calls: { url: string; method: string; body?: unknown }[] = []
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const next = responses.shift() ?? { status: 500 }
    return next.status === 204 ? new Response(null, { status: 204 }) : Response.json(next.body ?? null, { status: next.status })
  }) as typeof fetch
  return { request: createBuildRequest('http://localhost:8765/', fetcher), calls }
}

test('workspace, file, save and delete hit the documented /build routes scoped by user and session', async () => {
  const { request, calls } = recording([
    { status: 200, body: { workspace_id: 'a'.repeat(32), root: '/r', exists: true, entries: [], truncated: false, ignored: [], has_index: true, package: null, env: [], preview_url: `/build/preview/${'a'.repeat(32)}/` } },
    { status: 200, body: { path: 'index.html', size: 6, modified: 1, sha256: 'abc', binary: false, too_large: false, content: '<html>' } },
    { status: 200, body: { path: 'index.html', size: 7, modified: 2, sha256: 'def' } },
    { status: 204 },
  ])
  const workspace = await buildWorkspace(request, 'u 1', 's1')
  assert.equal(buildPreviewUrl('http://localhost:8765/', workspace), `http://localhost:8765/build/preview/${'a'.repeat(32)}/`)
  assert.equal((await buildFile(request, 'u 1', 's1', 'src/a b.ts')).content, '<html>')
  assert.equal((await buildSaveFile(request, 'u 1', 's1', 'index.html', '<html>!', 'abc')).sha256, 'def')
  await buildDeleteFile(request, 'u 1', 's1', 'old.txt')
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
    'GET http://localhost:8765/build/workspace?user_id=u+1&session_id=s1',
    'GET http://localhost:8765/build/file?user_id=u+1&session_id=s1&path=src%2Fa+b.ts',
    'PUT http://localhost:8765/build/file',
    'DELETE http://localhost:8765/build/file?user_id=u+1&session_id=s1&path=old.txt',
  ])
  assert.deepEqual(calls[2].body, { user_id: 'u 1', session_id: 's1', path: 'index.html', content: '<html>!', base_sha256: 'abc' })
})

test('a save against a changed file is a BuildConflict carrying the current sha; other errors carry the detail', async () => {
  const { request } = recording([
    { status: 409, body: { detail: { message: 'index.html changed on disk', sha256: 'zzz' } } },
    { status: 404, body: { detail: 'No such file: nope.txt' } },
  ])
  const conflict = await buildSaveFile(request, 'u', 's', 'index.html', 'x', 'abc').catch((error: unknown) => error)
  assert.ok(conflict instanceof BuildConflict)
  assert.equal(conflict.sha256, 'zzz')
  await assert.rejects(buildFile(request, 'u', 's', 'nope.txt'), /No such file: nope.txt/)
})

test('the listing becomes a folders-first tree; the default file prefers index.html', () => {
  const entries = [
    { path: 'src/main.ts', type: 'file' as const, size: 1, modified: 1 },
    { path: 'README.md', type: 'file' as const, size: 1, modified: 1 },
    { path: 'src', type: 'dir' as const, size: 0, modified: 1 },
    { path: 'src/lib/util.ts', type: 'file' as const, size: 1, modified: 1 },
    { path: 'index.html', type: 'file' as const, size: 1, modified: 1 },
  ]
  const tree = buildTree(entries)
  assert.deepEqual(tree.map((node) => node.name), ['src', 'index.html', 'README.md'])
  assert.deepEqual(tree[0].children.map((node) => node.name), ['lib', 'main.ts'])
  assert.equal(defaultBuildFile(entries), 'index.html')
  assert.equal(defaultBuildFile(entries.filter((entry) => entry.path !== 'index.html')), 'README.md')
  assert.equal(defaultBuildFile([]), null)
})

test('a workspace file opens at its preview route, except under a dot segment the route never serves', () => {
  const workspace = { workspace_id: 'a'.repeat(32) }
  assert.equal(buildFileUrl('http://localhost:8765/', workspace, 'assets/logo 1.png'), `http://localhost:8765/build/preview/${'a'.repeat(32)}/assets/logo%201.png`)
  assert.equal(buildFileUrl('http://localhost:8765', workspace, 'photo#2.jpg'), `http://localhost:8765/build/preview/${'a'.repeat(32)}/photo%232.jpg`)
  assert.equal(buildFileUrl('http://localhost:8765', workspace, '.env'), null)
  assert.equal(buildFileUrl('http://localhost:8765', workspace, 'public/.well-known/icon.png'), null)
})

test('the static preview’s version follows only the files a page can load', () => {
  const entries: BuildEntry[] = [
    { path: 'src', type: 'dir', size: 0, modified: 1 },
    { path: 'index.html', type: 'file', size: 1, modified: 1 },
    { path: 'style.css', type: 'file', size: 1, modified: 1 },
    { path: 'README.md', type: 'file', size: 1, modified: 1 },
    { path: '.ren-dev.log', type: 'file', size: 1, modified: 1 },
    { path: 'src/app.test.ts', type: 'file', size: 1, modified: 1 },
  ]
  const base = previewVersion(entries)
  const touch = (path: string) => entries.map((entry) => entry.path === path ? { ...entry, modified: 2 } : entry)
  assert.equal(previewVersion(touch('README.md')), base)
  assert.equal(previewVersion(touch('.ren-dev.log')), base)
  assert.equal(previewVersion(touch('src/app.test.ts')), base)
  assert.equal(previewVersion(touch('src')), base)
  assert.notEqual(previewVersion(touch('index.html')), base)
  assert.notEqual(previewVersion(touch('style.css')), base)
  assert.notEqual(previewVersion(entries.filter((entry) => entry.path !== 'style.css')), base)
  assert.notEqual(previewVersion(entries.map((entry) => entry.path === 'style.css' ? { ...entry, path: 'main.css' } : entry)), base)
  assert.equal(previewVersion(entries), base)
})

test('tool paths become workspace paths, including macOS /private aliases; paths outside stay null', () => {
  const workspace = { root: '/var/folders/x/ren-build/abc123', workspace_id: 'abc123' }
  assert.equal(workspaceRelative(workspace, '/var/folders/x/ren-build/abc123/src/app.ts'), 'src/app.ts')
  assert.equal(workspaceRelative(workspace, '/private/var/folders/x/ren-build/abc123/index.html'), 'index.html')
  assert.equal(workspaceRelative(workspace, '/etc/hosts'), null)
})
