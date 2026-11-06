import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useProjectsStore } from '@/stores/projectsStore'
import { TaskDetailView } from '@/components/board/task-detail/TaskDetailView'
import type { Editor } from '@tiptap/react'
import { Markdown } from '@tiptap/markdown'
import { NotionEditor } from '@/components/board/task-detail/editor/NotionEditor'
import { WorkflowBlockExtension } from '@/components/board/task-detail/editor/extensions/WorkflowBlockExtension'
import type { Task } from '@/pages/types/task'
import { ISSUE_PRIORITY_CONFIG, ISSUE_STATUS_CONFIG, type Issue, type Project } from '@/types/projects'
import { canPlaceIssue, fromLocalDateTime, issueDefinitions, toLocalDateTime, validateIssueDates } from '@/lib/project-issue-utils'
import { issueDraftPatch, rebaseIssueDraft } from '@/lib/project-issue-draft'
import { ProjectFieldInput, projectInputClass } from './ProjectFieldInput'
import { IssueRelationships } from './IssueRelationships'
import { IssueDocuments } from './IssueDocuments'
import { IssueRonPane } from './IssueRonPane'
import { IssueDescriptionRon } from './IssueDescriptionRon'
import { IssueWorkProducts } from './IssueWorkProducts'
import { CreateIssueDialog } from './dialogs'
import { AssistField } from '@/components/shared/TextAssist'

/** Ron writes Markdown and draws workflows: the description editor parses both, as project pages do. */
const DESCRIPTION_EXTENSIONS = [WorkflowBlockExtension, Markdown]

export function CanonicalIssueWorkspace({ issue, project, onClose, onNavigate }: {
  issue: Issue; project: Project; onClose: () => void; onNavigate: (id: string) => void
}) {
  const { issues, people, activity, updateIssue, refreshFromServer, pendingSaves, isLoading } = useProjectsStore()
  const [base, setBase] = useState(issue)
  const [draft, setDraft] = useState(issue)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [showChild, setShowChild] = useState(false)
  const [ronDraft, setRonDraft] = useState('')
  const [ronNeedsReview, setRonNeedsReview] = useState(false)
  const [descriptionRunning, setDescriptionRunning] = useState(false)
  const [descriptionEditor, setDescriptionEditor] = useState<Editor | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const dirty = Object.keys(issueDraftPatch(base, draft)).length > 0
  const conflict = base.version !== issue.version
  const disabled = saving || pendingSaves > 0 || isLoading || descriptionRunning
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!dirty && !saving && !reviewing) { setBase(issue); setDraft(issue) }
  }, [issue, dirty, saving, reviewing])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || saving) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty, saving])
  const edit = (values: Partial<Issue>) => setDraft((current) => ({ ...current, ...values }))
  const save = async () => {
    if (inFlight.current || disabled) return false
    if (!dirty) return true
    if (!form.current?.reportValidity()) return false
    if (conflict) { setError('The server version changed. Reload and review your retained draft before saving.'); return false }
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      validateIssueDates(draft)
      if (!draft.title.trim()) throw new Error('Title is required.')
      const result = await updateIssue(issue.id, { ...issueDraftPatch(base, draft), title: draft.title.trim() }, base.version)
      if (!mounted.current) return false
      if (result.error || !result.issue) { setError(result.error ?? 'Save was not confirmed.'); return false }
      setBase(result.issue); setDraft(result.issue); setReviewing(false)
      return true
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Save failed.')
      return false
    } finally {
      inFlight.current = false
      if (mounted.current) setSaving(false)
    }
  }
  const navigate = async (action: () => void) => { if (await save()) action() }
  const reloadForReview = async () => {
    setReviewing(false)
    const result = await refreshFromServer()
    if (!mounted.current) return
    setError(result.error ?? null)
    setReviewing(!result.error)
  }
  const dates = (['startDate', 'endDate', 'dueDate'] as const).map((key) => <Field key={key} label={key === 'startDate' ? 'Start' : key === 'endDate' ? 'End' : 'Due'}>
    <input aria-label={key} className={projectInputClass} type="datetime-local" value={toLocalDateTime(draft[key])} onChange={(event) => {
      try { edit({ [key]: fromLocalDateTime(event.target.value) }); event.target.setCustomValidity('') }
      catch (cause) { event.target.setCustomValidity((cause as Error).message); event.target.reportValidity() }
    }} />
  </Field>)
  const definitions = issueDefinitions(project)
  const children = issues.filter((item) => item.parentId === issue.id).sort((a, b) => a.rank - b.rank)
  const task: Task = {
    id: issue.id, title: issue.title, description: issue.description, status: issue.status, priority: issue.priority,
    createdAt: issue.createdAt, updatedAt: issue.updatedAt, projectId: project.id, projectName: project.name,
    assignees: [], labels: [], subtasks: [], hasNotification: false,
  }
  const banner = <div className="border-y border-surface-200 dark:border-surface-800 px-6 py-3 space-y-2 text-sm">
    <div className="flex flex-wrap items-center gap-3">
      <span className="mr-auto">{project.key}-{issue.number} · {definitions.find((d) => d.key === issue.type)?.label ?? issue.type} · v{issue.version} · {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}</span>
      <button disabled={disabled || !dirty || conflict} className="text-indigo-500 disabled:opacity-50" onClick={() => void save()}>Save changes</button>
      <button disabled={disabled} onClick={() => void navigate(onClose)}>Save & close</button>
      {dirty && <button disabled={disabled} className="text-rose-500" onClick={() => {
        if (window.confirm('Discard your unsaved changes and use the current server values?')) { setBase(issue); setDraft(issue); setError(null); setReviewing(false) }
      }}>Discard changes</button>}
    </div>
    {error && <p role="alert" className="text-rose-500">{error}</p>}
    {(error || conflict || reviewing) && <div className="space-y-2">
      <button disabled={disabled} className="text-indigo-500" onClick={() => void reloadForReview()}>Reload server values (keep draft)</button>
      {reviewing && <>
        <p>Review changed fields below. Applying your draft keeps your edits to these fields and preserves other server changes.</p>
        <div className="max-h-36 overflow-auto"><table className="w-full text-xs"><thead><tr><th>Field</th><th>Server</th><th>Your draft</th></tr></thead><tbody>
          {Object.keys(issueDraftPatch(base, draft)).map((key) => <tr key={key}><td>{key}</td><td className="max-w-48 break-words">{JSON.stringify(issue[key as keyof Issue]) ?? 'Not set'}</td><td className="max-w-48 break-words">{JSON.stringify(draft[key as keyof Issue]) ?? 'Not set'}</td></tr>)}
        </tbody></table></div>
        <button disabled={disabled} onClick={() => { setDraft(rebaseIssueDraft(base, draft, issue)); setBase(issue); setError(null); setReviewing(false) }}>Apply draft to reviewed version</button>
      </>}
    </div>}
  </div>
  const sidebar = <form ref={form} onSubmit={(event) => { event.preventDefault(); void save() }} className="w-full lg:w-72 shrink-0 lg:overflow-y-auto p-5 text-ink dark:text-ink-inverse">
    <fieldset disabled={disabled} className="space-y-4">
      <Field label="Title"><AssistField value={draft.title} onChange={(title) => edit({ title })} suggest count={5}>
        {(field) => <input aria-label="Issue title" required maxLength={500} className={projectInputClass} value={draft.title} onChange={(e) => edit({ title: e.target.value })} {...field} />}
      </AssistField></Field>
      <Field label="Status"><select aria-label="Issue status" className={projectInputClass} value={draft.status} onChange={(e) => edit({ status: e.target.value as Issue['status'] })}>{Object.entries(ISSUE_STATUS_CONFIG).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select></Field>
      <Field label="Priority"><select aria-label="Issue priority" className={projectInputClass} value={draft.priority} onChange={(e) => edit({ priority: e.target.value as Issue['priority'] })}>{Object.entries(ISSUE_PRIORITY_CONFIG).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select></Field>
      <Field label="Type"><select aria-label="Issue type" className={projectInputClass} value={draft.type} onChange={(e) => edit({ type: e.target.value })}>{definitions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select></Field>
      <Field label="Parent"><select aria-label="Parent issue" required={!canPlaceIssue(project, draft.type)} className={projectInputClass} value={draft.parentId ?? ''} onChange={(e) => edit({ parentId: e.target.value || null })}>
        <option value="">No parent</option>
        {draft.parentId && !issues.some((i) => i.id === draft.parentId && canPlaceIssue(project, draft.type, i)) && <option value={draft.parentId}>Current parent (incompatible with selected type)</option>}
        {issues.filter((i) => i.id !== issue.id && canPlaceIssue(project, draft.type, i)).map((i) => <option key={i.id} value={i.id}>#{i.number} · {i.title}</option>)}
      </select></Field>
      <Field label="Assignees"><select aria-label="Assignees" multiple className={projectInputClass} value={draft.assignees} onChange={(e) => edit({ assignees: Array.from(e.target.selectedOptions, (o) => o.value) })}>
        {draft.assignees.filter((id) => !people.some((p) => p.id === id)).map((id) => <option key={id} value={id}>{id}</option>)}
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></Field>
      <Field label="Labels (one per line)"><textarea aria-label="Labels" className={projectInputClass} value={draft.labels.join('\n')} onChange={(e) => edit({ labels: e.target.value.split('\n') })} /></Field>
      <Field label="Estimate"><input aria-label="Estimate" type="number" min={0} step="any" className={projectInputClass} value={draft.estimate ?? ''} onChange={(e) => edit({ estimate: e.target.value === '' ? undefined : e.target.valueAsNumber })} /></Field>
      <p className="text-xs text-ink-muted">Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}. Clearing a time removes it.</p>
      {dates}
      {(project.settings.fields ?? []).filter((f) => (!f.issueTypes?.length || f.issueTypes.includes(draft.type)) || Object.hasOwn(draft.customFields, f.key)).map((field) => <Field key={field.key} label={`${field.label}${field.required ? ' *' : ''}${field.archived ? ' (archived)' : ''}`}>
        <ProjectFieldInput field={field} value={draft.customFields[field.key]} disabled={disabled} people={people} issues={issues} onChange={(value) => edit({ customFields: { ...draft.customFields, [field.key]: value } })} />
        {field.issueTypes?.length && !field.issueTypes.includes(draft.type) && !field.archived && <button type="button" className="text-xs text-rose-500" onClick={() => {
          const values = { ...draft.customFields }; delete values[field.key]; edit({ customFields: values })
        }}>Remove value (not applicable to selected type)</button>}
      </Field>)}
    </fieldset>
  </form>
  return <>
    <TaskDetailView task={task} onClose={() => void navigate(onClose)} workspace={{ banner, sidebar,
      description: <div className="h-full overflow-y-auto p-6 space-y-6 text-ink dark:text-ink-inverse">
        <IssueDescriptionRon issueId={issue.id} issueTitle={issue.title} currentDescription={draft.description ?? ''} editor={descriptionEditor}
          disabled={disabled || conflict} beforeStart={save} onPreview={(description) => edit({ description })} onRunning={setDescriptionRunning} />
        <NotionEditor canonical content={draft.description ?? ''} readOnly={disabled} extensions={DESCRIPTION_EXTENSIONS} onEditor={setDescriptionEditor}
          onChange={(description) => edit({ description })} onSave={() => void save()}
          onAskRon={(goal) => window.dispatchEvent(new CustomEvent('issue-description-ron', { detail: { issueId: issue.id, goal } }))} />
        <section className="space-y-2"><div className="flex justify-between"><h3 className="font-semibold">Child issues</h3>
          {definitions.some((d) => canPlaceIssue(project, d.key, issue)) && <button disabled={disabled} className="text-indigo-500" onClick={() => void navigate(() => setShowChild(true))}>Create child</button>}</div>
          {children.length === 0 && <p className="text-sm text-ink-muted">No child issues.</p>}
          {children.map((child) => <button key={child.id} disabled={disabled} className="block text-left text-sm text-indigo-500" onClick={() => void navigate(() => onNavigate(child.id))}>#{child.number} · {child.title} · {ISSUE_STATUS_CONFIG[child.status].label}</button>)}
        </section>
        <IssueRelationships issue={issue} onNavigate={(id) => void navigate(() => onNavigate(id))} />
        <IssueDocuments issue={issue} disabled={disabled}
          onOpenDocument={(doc) => void navigate(() => { void window.electron?.browser?.navigate(`ron://project/${doc.projectId}/docs/${doc.id}`) })} />
        <IssueWorkProducts products={issue.workProducts} />
      </div>,
      context: <section aria-label="Issue context" className="h-full overflow-y-auto p-6">
        <h3 className="text-sm font-semibold text-ink dark:text-ink-inverse">Context</h3>
        <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-surface-200 px-6 py-12 text-center dark:border-surface-700">
          <span className="flex size-11 items-center justify-center rounded-xl bg-surface-100 text-ink-muted dark:bg-surface-800 dark:text-ink-inverse-muted">
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
          </span>
          <p className="mt-3 text-sm font-medium text-ink dark:text-ink-inverse">No context yet</p>
        </div>
      </section>,
      ron: <IssueRonPane issueId={issue.id} issue={{ title: issue.title, description: issue.description }} hasUnsavedChanges={dirty || saving} draft={ronDraft} onDraftChange={setRonDraft}
        needsReview={ronNeedsReview} onReviewChange={setRonNeedsReview} />,
      comms: <div className="p-6 text-sm">Canonical communications and attachment storage are not configured. Legacy messages, attachments, and conversations are not imported or written into custom fields.</div>,
      history: <div className="h-full overflow-y-auto p-6 space-y-3"><button disabled={disabled} className="text-indigo-500" onClick={() => void refreshFromServer()}>Refresh activity</button>
        <p className="text-xs text-ink-muted">Showing this issue’s entries from the latest 200 accessible project activity records.</p>
        {activity.filter((entry) => entry.issueId === issue.id).map((entry) => <article key={entry.id} className="rounded-xl border border-surface-200 dark:border-surface-800 p-3 text-sm">
          <p>{entry.actorName ?? entry.actorId ?? entry.actorType} · {entry.action}</p><time>{new Date(entry.timestamp).toLocaleString()}</time>
          {entry.field && <p>{entry.field}: {String(entry.oldValue ?? '—')} → {String(entry.newValue ?? '—')}</p>}
        </article>)}
        {!activity.some((entry) => entry.issueId === issue.id) && <p>No activity for this issue in the loaded records.</p>}
      </div>,
    }} />
    {showChild && <CreateIssueDialog isOpen onClose={() => setShowChild(false)} projectId={project.id} parentId={issue.id} />}
  </>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><p className="text-xs font-semibold text-ink-muted">{label}</p>{children}</div>
}