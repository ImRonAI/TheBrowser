import { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL } from '@/lib/api-base'
import type { ContextItem } from '@/lib/context-api'
import { sendContextToIssue } from '@/lib/context-to-issue'
import { openSignIn } from '@/lib/sign-in'
import { useAuthStore } from '@/stores/authStore'
import { useProjectsStore } from '@/stores/projectsStore'
import { ROOT_ISSUE_TYPES, type IssueTypeKey } from '@/types/projects'
import { cn } from '@/utils/cn'

const field = 'w-full rounded-md border border-zinc-200 bg-white/70 px-2 py-1.5 text-xs text-ron-text outline-none focus:border-royal dark:border-white/10 dark:bg-white/5 dark:text-white'

/** Inline (not a modal) so it shows over websites inside the widget's reserved strip. */
export function SendToIssue({ items, onDone, onCancel }: { items: ContextItem[]; onDone: (message: string) => void; onCancel: () => void }) {
  const { projects, issues, initialize, isInitialized, isLoading, createIssue, updateIssue, error: projectsError } = useProjectsStore()
  const userId = useAuthStore((state) => state.user?.id || 'default')
  const signedIn = useAuthStore((state) => state.isAuthenticated)
  const [projectId, setProjectId] = useState('')
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [issueId, setIssueId] = useState('')
  const [query, setQuery] = useState('')
  const [title, setTitle] = useState(() => items.length === 1 ? items[0].title.slice(0, 200) : '')
  const [type, setType] = useState<IssueTypeKey>('task')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { void initialize() }, [initialize])
  useEffect(() => { if (!projectId && projects[0]) setProjectId(projects[0].id) }, [projects, projectId])

  const project = projects.find((entry) => entry.id === projectId)
  const types = useMemo(() => {
    const keys = project?.settings.issueTypes?.map((entry) => entry.key) ?? ROOT_ISSUE_TYPES
    const roots = keys.filter((key) => ROOT_ISSUE_TYPES.includes(key))
    return roots.length ? roots : ROOT_ISSUE_TYPES
  }, [project])
  useEffect(() => { if (!types.includes(type)) setType(types.includes('task') ? 'task' : types[0]) }, [types, type])

  const projectIssues = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return issues.filter((issue) => issue.projectId === projectId)
      .filter((issue) => !needle || issue.title.toLowerCase().includes(needle) || `${project?.key}-${issue.number}`.toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50)
  }, [issues, projectId, query, project?.key])
  const withFiles = items.filter((item) => item.file).length

  const send = async () => {
    setError('')
    if (!project) { setError('Choose a project.'); return }
    setSending(true)
    try {
      let issue = issues.find((entry) => entry.id === issueId)
      if (mode === 'new') {
        if (!title.trim()) throw new Error('Give the new issue a title.')
        const created = await createIssue({ projectId: project.id, title: title.trim(), type })
        if (created.error || !created.issue) throw new Error(created.error || 'The issue was not created.')
        issue = created.issue
      }
      if (!issue) throw new Error('Choose an issue.')
      const result = await sendContextToIssue({ apiBase: API_BASE_URL, userId, signedIn, items, issue, updateIssue })
      const label = `${project.key}-${issue.number}`
      onDone(`Added ${result.added} item${result.added === 1 ? '' : 's'} to the Context of ${label}${result.filesSkipped ? ` (files need sign-in, ${result.filesSkipped} kept as text)` : ''}.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSending(false)
    }
  }

  return <div className="space-y-2 rounded-lg border border-royal/20 bg-royal/5 p-3 dark:border-royal-light/20 dark:bg-royal-light/5" data-testid="send-to-issue">
    <div className="flex items-center justify-between">
      <p className="text-xs font-raleway font-raleway-bold text-ron-text dark:text-white">Send {items.length} item{items.length === 1 ? '' : 's'} to an issue</p>
      <button type="button" onClick={onCancel} className="text-[11px] text-ron-text/50 hover:text-ron-text dark:text-white/50">Cancel</button>
    </div>
    {!signedIn && withFiles > 0 && <p className="text-[11px] text-amber-700 dark:text-amber-300">
      Files are stored in your project only when you are signed in; as a guest {withFiles === 1 ? 'the file is' : 'files are'} sent as text. <button type="button" className="underline" onClick={() => openSignIn()}>Sign in</button>
    </p>}
    {!isInitialized && isLoading && <p className="text-[11px] text-ron-text/50 dark:text-white/50">Loading projects…</p>}
    {isInitialized && !projects.length && <p className="text-[11px] text-ron-text/60 dark:text-white/60">You have no projects yet. Create one in Projects first.</p>}
    {projects.length > 0 && <>
      <label className="block text-[11px] text-ron-text/60 dark:text-white/60">Project
        <select aria-label="Project" className={field} value={projectId} onChange={(event) => { setProjectId(event.target.value); setIssueId('') }}>
          {projects.map((entry) => <option key={entry.id} value={entry.id}>{entry.key} · {entry.name}</option>)}
        </select>
      </label>
      <div className="flex gap-1 text-[11px]">
        {(['existing', 'new'] as const).map((value) => <button key={value} type="button" onClick={() => setMode(value)}
          className={cn('rounded-md px-2 py-1', mode === value ? 'bg-royal text-white dark:bg-royal-light' : 'text-ron-text/60 hover:bg-zinc-100 dark:text-white/60 dark:hover:bg-white/5')}>
          {value === 'existing' ? 'Existing issue' : 'New issue'}</button>)}
      </div>
      {mode === 'existing' ? <>
        <input aria-label="Find issue" className={field} placeholder="Find an issue" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="max-h-28 overflow-y-auto rounded-md border border-zinc-200 dark:border-white/10" role="listbox" aria-label="Issues">
          {!projectIssues.length && <p className="px-2 py-1.5 text-[11px] text-ron-text/50 dark:text-white/50">No issues in this project.</p>}
          {projectIssues.map((issue) => <button key={issue.id} type="button" role="option" aria-selected={issue.id === issueId} onClick={() => setIssueId(issue.id)}
            className={cn('block w-full truncate px-2 py-1 text-left text-[11px]', issue.id === issueId ? 'bg-royal/15 text-royal dark:text-royal-light' : 'text-ron-text hover:bg-zinc-100 dark:text-white dark:hover:bg-white/5')}>
            <span className="text-ron-text/50 dark:text-white/50">{project?.key}-{issue.number}</span> {issue.title}</button>)}
        </div>
      </> : <div className="flex gap-2">
        <input aria-label="New issue title" className={field} placeholder="Issue title" value={title} onChange={(event) => setTitle(event.target.value)} />
        <select aria-label="Issue type" className={cn(field, 'w-28')} value={type} onChange={(event) => setType(event.target.value)}>
          {types.map((key) => <option key={key} value={key}>{key}</option>)}
        </select>
      </div>}
    </>}
    {(error || projectsError) && <p className="text-[11px] text-red-600 dark:text-red-400" role="alert">{error || projectsError}</p>}
    <button type="button" disabled={sending || !project || (mode === 'existing' && !issueId)} onClick={() => void send()}
      className="w-full rounded-md bg-royal px-3 py-1.5 text-xs font-raleway font-raleway-bold text-white disabled:opacity-40 dark:bg-royal-light">
      {sending ? 'Sending…' : mode === 'new' ? 'Create issue with this context' : 'Add to issue context'}
    </button>
  </div>
}
