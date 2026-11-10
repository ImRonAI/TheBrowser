import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchReferenceCatalog, filterReferences, parseReferenceMarkdown, referenceItems, referenceMarkdown, referenceStart,
  type TeachingReferenceCatalog,
} from './document-references.ts'

const catalog: TeachingReferenceCatalog = {
  tools: [
    { id: 'http_request', label: 'http_request', description: 'Make HTTP requests.', group: 'Core tools' },
    { id: 'brave_web_search', label: 'brave_web_search', description: 'Search the web with Brave.', group: 'Core tools' },
    { id: 'current_time', label: 'current_time', description: 'The current time.', group: 'Library · agent_orchestration' },
  ],
  mcp_servers: [{ id: 'user_browser', label: 'user_browser', description: 'The user’s browser.', group: 'MCP servers' }],
  skills: [{ id: 'weekly-brief', label: 'weekly-brief', description: 'Write a weekly brief.', group: 'Learned skills' }],
  agents: [{ id: 'ron', label: 'Ren', description: 'Ren over A2A.', group: 'Agents', a2a_url: 'http://127.0.0.1:8765/a2a' }],
}

const items = referenceItems({
  catalog,
  documents: [{ id: 'd1', title: 'Voice guide', projectId: 'p1' }, { id: 'd2', title: '', projectId: 'p2' }],
  projects: [{ id: 'p1', name: 'Writing', key: 'WR' }, { id: 'p2', name: 'Old', key: 'OLD', lifecycle: 'archived' }],
  specialists: [{ id: 's1', name: 'Researcher', description: 'Finds sources.' }],
})

test('every kind is offered with the ids the skill publisher resolves', () => {
  assert.deepEqual(items.map((item) => `${item.kind}:${item.id}`), [
    'document:d1', 'document:d2', 'tool:http_request', 'tool:brave_web_search', 'tool:current_time', 'agent:ron',
    'agent:specialist/s1', 'agent:project/p1', 'mcp:user_browser', 'skill:weekly-brief'])
  assert.equal(items[0].group, 'WR')
  assert.equal(items[1].label, 'Untitled')
  assert.equal(items.find((item) => item.id === 'project/p1')!.label, 'Writing (WR)')
})

test('the menu groups by kind in order and filters by word prefix', () => {
  assert.deepEqual(filterReferences(items, '').map((group) => group.title), ['Pages', 'Tools', 'Agents', 'MCP servers', 'Skills'])
  assert.deepEqual(filterReferences(items, '').find((group) => group.kind === 'tool')!.items.length, 3)
  assert.deepEqual(filterReferences(items, '', 2).find((group) => group.kind === 'tool')!.items.length, 2)
  const search = filterReferences(items, 'brave')
  assert.deepEqual(search.map((group) => group.items.map((item) => item.id)), [['brave_web_search']])
  assert.deepEqual(filterReferences(items, 'voice').map((group) => group.kind), ['document'])
  assert.deepEqual(filterReferences(items, 'library').flatMap((group) => group.items.map((item) => item.id)), ['current_time'])
  // A description match only ranks below label matches.
  assert.deepEqual(filterReferences(items, 'sources').flatMap((group) => group.items.map((item) => item.id)), ['specialist/s1'])
  assert.deepEqual(filterReferences(items, 'nothing matches'), [])
})

test('Markdown is @[label](ron://kind/id), round-trips escaped labels and is found inside text', () => {
  const markdown = referenceMarkdown({ kind: 'agent', id: 'specialist/s1', label: 'Re[search]er' })
  assert.equal(markdown, '@[Re\\[search\\]er](ron://agent/specialist/s1)')
  assert.deepEqual(parseReferenceMarkdown(`${markdown} and more`), { raw: markdown, kind: 'agent', id: 'specialist/s1', label: 'Re[search]er' })
  assert.equal(parseReferenceMarkdown('@[x](https://example.com)'), null)
  assert.equal(parseReferenceMarkdown('[x](ron://tool/y)'), null)
  assert.equal(referenceStart('Use @[http_request](ron://tool/http_request) now'), 4)
  assert.equal(referenceStart('email me @ home [x](ron://tool/y)'), -1)
  assert.equal(referenceMarkdown({ kind: 'tool', id: 'shell', label: '' }), '@[shell](ron://tool/shell)')
})

test('the catalog is fetched with the scope and errors carry the server detail', async () => {
  const calls: string[] = []
  const ok = (async (url: string) => { calls.push(url); return new Response(JSON.stringify(catalog), { status: 200 }) }) as typeof fetch
  assert.deepEqual(await fetchReferenceCatalog('http://localhost:8765', 'default', 'panel', ok), catalog)
  assert.equal(calls[0], 'http://localhost:8765/teaching/references?user_id=default&agent_id=panel')
  const failing = (async () => new Response(JSON.stringify({ detail: 'Invalid user id' }), { status: 422 })) as typeof fetch
  await assert.rejects(fetchReferenceCatalog('http://x', 'bad', 'panel', failing), /Invalid user id/)
})
