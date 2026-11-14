import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runRon } from './ron-run.ts'
import type { PromptAttachment } from './prompt-attachments.ts'

function sseResponse(sessionId: string): Response {
  const frames = [
    { version: 1, sequence: 1, session_id: sessionId, run_id: 'r1', node_path: [], type: 'run_started' },
    { version: 1, sequence: 2, session_id: sessionId, run_id: 'r1', node_path: [], type: 'text_delta', data: 'Draft ready.' },
    { version: 1, sequence: 3, session_id: sessionId, run_id: 'r1', node_path: [], type: 'run_finished', status: 'completed' },
  ]
  const body = frames.map((item) => `data: ${JSON.stringify(item)}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

test('runRon serializes prompt_attachments and screen_frame into POST /chat', async () => {
  let postedUrl = ''
  let postedBody: Record<string, unknown> = {}
  const attachment: PromptAttachment = {
    id: 'att-1',
    kind: 'tab',
    title: 'DeepSeek R2 Architecture',
    url: 'https://example.com/deepseek-r2',
    source: 'Example Tech',
    text: 'Full extracted article body.',
  }
  const state = await runRon({
    apiBase: 'http://localhost:8765',
    destination: 'document',
    sessionId: 'ron-doc-test',
    userId: 'user-1',
    message: 'Add an architecture section grounded on this article.',
    promptAttachments: [attachment],
    screenFrame: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    fetcher: async (input, init) => {
      postedUrl = String(input)
      postedBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      return sseResponse('ron-doc-test')
    },
  })

  assert.equal(postedUrl, 'http://localhost:8765/chat')
  assert.equal(postedBody.destination, 'document')
  assert.equal(postedBody.session_id, 'ron-doc-test')
  assert.deepEqual(postedBody.prompt_attachments, [attachment])
  assert.equal(
    postedBody.screen_frame,
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  )
  assert.equal(state.status, 'completed')
})

test('runRon omits prompt_attachments and screen_frame when empty', async () => {
  let postedBody: Record<string, unknown> = {}
  await runRon({
    apiBase: 'http://localhost:8765',
    destination: 'document',
    sessionId: 'ron-doc-plain',
    userId: 'user-1',
    message: 'Summarize the page.',
    promptAttachments: [],
    fetcher: async (_input, init) => {
      postedBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      return sseResponse('ron-doc-plain')
    },
  })

  assert.equal('prompt_attachments' in postedBody, false)
  assert.equal('screen_frame' in postedBody, false)
})
