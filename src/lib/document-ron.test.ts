import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyPanelState, reducePanelEvent, type PanelEvent } from './panel-stream.ts'
import { documentContent, documentRetryMessage, documentRonMessage, hasDraft, unwrapMarkdown, withWorkflowBlocks, workflowFromFence, workflowMarkdown, type DocNode } from './document-ron.ts'
import { ronSegments, ronSessionId, workflowRonMessage } from './ron-run.ts'
import { starterWorkflow } from './workflow.ts'
import { MarkdownManager } from '@tiptap/markdown'
import { flattenExtensions, resolveExtensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

// The editor's own Markdown parser (official @tiptap/markdown over StarterKit's nodes).
const markdown = new MarkdownManager({ extensions: flattenExtensions(resolveExtensions([StarterKit])) })
const parse = (text: string) => markdown.parse(text) as DocNode

const event = (sequence: number, type: string, extra: Record<string, unknown> = {}): PanelEvent =>
  ({ version: 1, sequence, session_id: 'doc-a', run_id: 'run-1', type, node_path: [], ...extra })

test('session ids satisfy the /chat identifier rule', () => {
  assert.match(ronSessionId('doc', '8f1c/2:x y'), /^[A-Za-z0-9][A-Za-z0-9_.-]*$/)
  assert.ok(ronSessionId('wf', 'x'.repeat(300)).length <= 128)
})

test('the message names what Ron writes, carries the request, facts and current content', () => {
  const page = documentRonMessage({ target: { kind: 'page', title: '', projectName: 'Ron', projectKey: 'RON' }, intent: ' a release runbook ', currentMarkdown: '# Old' })
  assert.match(page, /page "Untitled" in the Ron \(RON\)/)
  assert.match(page, /Request: a release runbook/)
  assert.match(page, /<current>\n# Old\n<\/current>/)
  assert.match(page, /call render_workflow/)
  assert.match(page, /research it first with brave_web_search/)
  assert.match(page, /When it adds to the page .* write just that new content and do not repeat what is already there/)
  assert.match(page, /When it asks for the whole page .* write all of it: the user overwrites the page with it\./)
  assert.match(documentRetryMessage('  shorter, with sources '), /^Feedback on your draft: shorter, with sources\n\nWrite the complete revised draft again/)
  const issue = documentRonMessage({ target: { kind: 'issue', title: 'Login fails', projectName: 'R', projectKey: 'R', facts: 'Priority: high' }, intent: 'x', currentMarkdown: '' })
  assert.match(issue, /description of the issue "Login fails"/)
  assert.match(issue, /Facts to use:\nPriority: high/)
  assert.match(issue, /The description is empty\./)
  assert.match(workflowRonMessage('Release', starterWorkflow(), 'add a review'), /"id":"step-1"/)
  assert.match(workflowRonMessage('Workflow', { steps: [], connections: [] }, 'draw intake'), /There is no workflow yet\./)
})

test('narration before research is not part of the draft, and glued headings still parse', () => {
  let state = emptyPanelState('doc-a')
  for (const next of [
    event(1, 'run_started'),
    event(2, 'text_delta', { data: 'I’ll check the docs first.', cycle: 1 }),
    event(3, 'tool_input', { id: 'r1', name: 'brave_web_search', input: { query: 'strands' }, cycle: 1 }),
    event(4, 'tool_result', { id: 'r1', name: 'brave_web_search', status: 'success', content: [] }),
    event(5, 'text_delta', { data: '## Build an agent\nInstall it.', cycle: 2 }),
  ]) state = reducePanelEvent(state, next)
  assert.deepEqual(ronSegments(state), [{ kind: 'text', text: '## Build an agent\nInstall it.' }])
  assert.equal(unwrapMarkdown('Confirming the install wording.## Steps\nSee [docs](https://x.dev/#install).'), '## Steps\nSee [docs](https://x.dev/#install).')
  assert.equal(unwrapMarkdown('# Notes\nDone.## Next\nMore.'), '# Notes\nDone.\n\n## Next\nMore.')
  assert.equal(unwrapMarkdown('Plain intro. Then C# code.'), 'Plain intro. Then C# code.')
  assert.equal(unwrapMarkdown('Confirming install details from the official pages.Intro paragraph.\n\n## Install'), 'Intro paragraph.\n\n## Install')
  assert.equal(unwrapMarkdown('Node.JS runs it. Then more.'), 'Node.JS runs it. Then more.')
  assert.equal(unwrapMarkdown('Use the U.S. region. Then deploy.'), 'Use the U.S. region. Then deploy.')
})

test('Ron’s answer becomes ordered segments: top-level text and finished render_workflow calls', () => {
  let state = emptyPanelState('doc-a')
  const steps = [{ id: 'a', label: 'Ask', kind: 'start' }, { id: 'b', label: 'Approve?', kind: 'decision' }, { id: 'c', label: 'Done', kind: 'end' }]
  for (const next of [
    event(1, 'run_started'),
    event(2, 'text_delta', { data: '# Runbook\nIntro.' }),
    event(3, 'tool_input', { id: 't1', name: 'render_workflow', input: { title: 'Approval', steps, connections: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c', label: 'Yes' }] } }),
    event(4, 'tool_result', { id: 't1', name: 'render_workflow', status: 'success', content: [] }),
    event(5, 'text_delta', { data: 'sub-agent chatter', node_path: ['think'] }),
    event(6, 'tool_input', { id: 't2', name: 'render_workflow', input: { title: 'Broken', steps: [] } }),
    event(7, 'tool_result', { id: 't2', name: 'render_workflow', status: 'error', content: [] }),
    event(8, 'text_delta', { data: '## After' }),
  ]) state = reducePanelEvent(state, next)
  const segments = ronSegments(state)
  assert.deepEqual(segments.map((segment) => segment.kind), ['text', 'workflow', 'text'])
  const drawn = segments[1]
  assert.ok(drawn.kind === 'workflow' && drawn.title === 'Approval' && drawn.graph.connections[1].label === 'Yes')
  assert.ok(hasDraft(segments))
  // Without connections, render_workflow chains the steps; the drawn graph mirrors that.
  let chained = reducePanelEvent(emptyPanelState('doc-a'), event(1, 'run_started'))
  chained = reducePanelEvent(chained, event(2, 'tool_input', { id: 't', name: 'render_workflow', input: { title: 'T', steps } }))
  chained = reducePanelEvent(chained, event(3, 'tool_result', { id: 't', name: 'render_workflow', status: 'success', content: [] }))
  const only = ronSegments(chained)[0]
  assert.ok(only.kind === 'workflow' && only.graph.connections.length === 2)
})

test('segments become editor content: parsed Markdown, drawn workflows and workflow fences as blocks', () => {
  const fence = workflowMarkdown('Release', starterWorkflow())
  let n = 0
  const content = documentContent([
    { kind: 'text', text: '```markdown\n# Intro\n```' },
    { kind: 'workflow', id: 't', title: 'Drawn', graph: starterWorkflow() },
    { kind: 'text', text: `Kept:\n\n${fence}` },
    { kind: 'text', text: '   ' },
  ], parse, () => `w${(n += 1)}`)
  assert.deepEqual(content.map((node) => node.type), ['heading', 'workflow', 'paragraph', 'workflow'])
  assert.equal(content[0].content![0].text, 'Intro')
  assert.deepEqual([content[1].attrs!.title, content[3].attrs!.title], ['Drawn', 'Release'])
  assert.equal(unwrapMarkdown('```md\n# A\n```'), '# A')
})

test('workflow fences round-trip; bad fences stay code', () => {
  const fence = workflowMarkdown('Release', { ...starterWorkflow(), connections: [{ id: 'x', source: 'start', target: 'end', type: 'temporary', label: 'Skip' }] })
  const body = fence.split('\n').slice(1, -1).join('\n')
  const parsed = workflowFromFence(body)!
  assert.equal(parsed.title, 'Release')
  assert.deepEqual(parsed.graph.steps.map((step) => step.id), ['start', 'step-1', 'end'])
  assert.equal(parsed.graph.connections[0].label, 'Skip')
  assert.equal(workflowFromFence('{"steps": []}'), null)
  assert.equal(workflowFromFence('not json'), null)
  const doc = withWorkflowBlocks({ type: 'doc', content: [
    { type: 'codeBlock', attrs: { language: 'workflow' }, content: [{ type: 'text', text: 'oops' }] },
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'let a = 1' }] },
  ] }, () => 'w1')
  assert.deepEqual(doc.content!.map((node) => node.type), ['codeBlock', 'codeBlock'])
})
