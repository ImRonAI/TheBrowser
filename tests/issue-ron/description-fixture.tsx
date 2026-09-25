import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { IssueDescriptionRon } from '../../src/components/projects/IssueDescriptionRon'
import { NotionEditor } from '../../src/components/board/task-detail/editor/NotionEditor'
import '../../src/index.css'

let reads = 0
const original = window.fetch.bind(window)
window.fetch = async (input, init) => {
  if (!String(input).includes('/projects/issues/')) return original(input, init)
  if (init?.method === 'POST') { reads = 0; return Response.json({ run: { id: 'run' } }, { status: 202 }) }
  reads++
  return Response.json({ runs: [{ id: 'run', output: reads === 1 ? '' : reads === 2 ? 'First visible chunk' : 'Complete final description <safe text>.',
    status: reads < 3 ? 'running' : 'completed', error: null }] })
}
function App() {
  const [content, setContent] = useState('<p>Original</p>')
  const [running, setRunning] = useState(false)
  return <main className="p-6">
    <IssueDescriptionRon issueId="test" disabled={running} beforeStart={async () => true} onPreview={setContent} onRunning={setRunning} />
    <NotionEditor canonical content={content} readOnly={running} onChange={setContent} />
    <output aria-label="Saved draft">{content}</output>
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)