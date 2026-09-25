import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { IssueRonPane } from '../../src/components/projects/IssueRonPane'
import { auth } from './stores'
import '../../src/index.css'

interface Run {
  id: string; message: string; output: string; status: string
  error: null; created_at: string
}
interface Conversation {
  agent: { id: string; provider: string; model_id: string } | null
  runs: Run[]; available: boolean
}
const state = {
  fail: false, failRead: false, defer: false,
  release: null as (() => void) | null,
  conversations: {} as Record<string, Conversation>,
  calls: [] as [string, string][],
}
declare global { interface Window { smoke: typeof state } }
window.smoke = state
const original = window.fetch.bind(window)
window.fetch = async (input, init = {}) => {
  const url = String(input)
  if (!url.includes('/projects/issues/')) return original(input, init)
  state.calls.push([url, init.method || 'GET'])
  const id = url.split('/issues/')[1].split('/')[0]
  const key = `${auth.user.id}:${id}`
  const data = state.conversations[key] ??= { agent: null, runs: [], available: true }
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  if (init.method === 'POST' && state.defer) {
    await new Promise<void>((resolve) => { state.release = resolve })
    state.release = null
  }
  if (init.method === 'POST' && state.fail) return respond({ detail: 'Synthetic write failure' }, 503)
  if (url.endsWith('/messages')) {
    const run: Run = { id: crypto.randomUUID(), message: JSON.parse(String(init.body)).message,
      output: '', status: 'running', error: null, created_at: new Date().toISOString() }
    data.agent = { id: key, provider: 'offline', model_id: 'native-test' }
    data.runs.unshift(run)
    return respond({ agent: data.agent, run }, 202)
  }
  if (url.endsWith('/cancel')) {
    data.runs[0].status = 'canceled'
    return respond({ cancel_requested: true })
  }
  if (state.failRead) return respond({ detail: 'Synthetic read failure' }, 503)
  return respond(data)
}

function App() {
  const [issueId, setIssue] = useState('issue-a')
  const [dirty, setDirty] = useState(false)
  const [visible, setVisible] = useState(true)
  const [draft, setDraft] = useState('')
  const [needsReview, setNeedsReview] = useState(false)
  const [account, setAccount] = useState(0)
  return <main className="h-screen flex flex-col bg-white p-4">
    <nav className="flex gap-5 p-2">
      <button onClick={() => { setIssue(issueId === 'issue-a' ? 'issue-b' : 'issue-a'); setDraft(''); setNeedsReview(false) }}>Switch issue</button>
      <button onClick={() => { auth.user = { id: `smoke-user-${account + 1}` }; setAccount(account + 1); setDraft(''); setNeedsReview(false) }}>Switch account</button>
      <button onClick={() => setDirty(!dirty)}>Toggle dirty</button>
      <button onClick={() => setVisible(!visible)}>Toggle pane</button>
    </nav>
    <div className="flex-1 min-h-0 border rounded-xl">{visible && <IssueRonPane key={`${account}:${issueId}`}
      issueId={issueId} hasUnsavedChanges={dirty} draft={draft} onDraftChange={setDraft}
      needsReview={needsReview} onReviewChange={setNeedsReview} />}</div>
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)