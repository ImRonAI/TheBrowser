import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CalendarCheck, CalendarClock, CalendarRange, Check, CircleDot, CornerLeftUp, Gauge, Loader2, Plus, Shapes, Signal, Tag, Users } from 'lucide-react'
import { getProjectsState, useProjectsStore } from '@/stores/projectsStore'
import { TaskDetailView } from '@/components/board/task-detail/TaskDetailView'
import type { Editor } from '@tiptap/react'
import { Markdown } from '@tiptap/markdown'
import { NotionEditor } from '@/components/board/task-detail/editor/NotionEditor'
import { WorkflowBlockExtension } from '@/components/board/task-detail/editor/extensions/WorkflowBlockExtension'
import type { Task } from '@/pages/types/task'
import { ISSUE_STATUS_CONFIG, PROJECT_TYPE_SCHEMES, type Issue, type Project } from '@/types/projects'
import { canPlaceIssue, issueDefinitions, validateIssueDates } from '@/lib/project-issue-utils'
import { issueDraftPatch, rebaseIssueDraft } from '@/lib/project-issue-draft'
import { pageSource, withDocumentContext, withoutDocumentContext } from '@/lib/issue-attachments'
import { relationCount } from '@/lib/issue-relationships'
import { documentSource, type DocumentIssueLink, type ProjectDocumentSummary } from '@/lib/project-documents'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ProjectFieldInput } from './ProjectFieldInput'
import { IssueRelationshipsField, type RelationshipWrite } from './IssueRelationshipsField'
import { LinkedIssuesList } from './LinkedIssuesList'
import { IssueRonChat } from './IssueRonChat'
import { IssueDescriptionRon } from './IssueDescriptionRon'
import { IssueWorkProducts } from './IssueWorkProducts'
import { IssueContext } from './IssueContext'
import { IssueComments } from './IssueComments'
import { CreateIssueDialog } from './dialogs'
import { AssistField } from '@/components/shared/TextAssist'
import {
  AssigneePicker, DateProperty, EstimateProperty, LabelsEditor, OptionPicker, PriorityPicker, PropertyRow, PropertySection,
  StatusIcon, StatusPicker, TypeChip,
} from './IssueProperties'
import { RelatedDocumentsField } from './RelatedDocumentsField'
import { useIssueComments } from './useIssueComments'
import { useIssueDocuments } from './useIssueDocuments'

/** Ren writes Markdown and draws workflows: the description editor parses both, as project pages do. */
const DESCRIPTION_EXTENSIONS = [WorkflowBlockExtension, Markdown]

/** Compact action buttons for the workspace banner and panes (Ren button recipes, merged over the shadcn variants). */
const BUTTON = 'h-8 gap-1.5 rounded-lg px-3 text-[13px] font-semibold shadow-none transition-colors duration-150 ease-out disabled:opacity-40'
const PRIMARY = `${BUTTON} bg-blurple-600 text-white hover:bg-blurple-700 active:bg-blurple-800 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300`
const SECONDARY = `${BUTTON} border border-surface-200 bg-surface-0 text-ink hover:bg-surface-50 hover:text-ink dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:hover:bg-surface-850 dark:hover:text-ink-inverse`
const GHOST = `${BUTTON} font-medium text-ink-secondary hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-850 dark:hover:text-ink-inverse`
const MUTED = 'text-ink-muted dark:text-ink-inverse-muted'

export function CanonicalIssueWorkspace({ issue, project, onClose, onNavigate }: {
  issue: Issue; project: Project; onClose: () => void; onNavigate: (id: string) => void
}) {
  const { issues, issueLinks, people, activity, updateIssue, refreshFromServer, pendingSaves, isLoading } = useProjectsStore()
  const [base, setBase] = useState(issue)
  const [draft, setDraft] = useState(issue)
  /** `local`: the draft failed this form's own checks (title, dates, parent), so nothing reached the server. */
  const [failure, setFailure] = useState<{ message: string; local: boolean } | null>(null)
  const error = failure?.message ?? null
  const setError = (message: string | null, local = false) => setFailure(message ? { message, local } : null)
  const [saving, setSaving] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [showChild, setShowChild] = useState(false)
  const [descriptionRunning, setDescriptionRunning] = useState(false)
  const [descriptionEditor, setDescriptionEditor] = useState<Editor | null>(null)
  /**
   * A write beside the draft is in flight and the version moves on purpose: a related page's Context entry
   * (written beside its link), or a relationship that moves this issue's status.
   */
  const [contextWriting, setContextWriting] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const baseRef = useRef(base)
  baseRef.current = base
  const docs = useIssueDocuments(issue)
  const comments = useIssueComments(issue.id)
  const dirty = Object.keys(issueDraftPatch(base, draft)).length > 0
  const conflict = base.version !== issue.version && !contextWriting
  const disabled = saving || pendingSaves > 0 || isLoading || descriptionRunning
  const form = useRef<HTMLFormElement>(null)
  const formId = `issue-form-${issue.id}`
  const issueKey = `${project.key}-${issue.number}`
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!dirty && !saving && !reviewing && !contextWriting) { setBase(issue); setDraft(issue) }
  }, [issue, dirty, saving, reviewing, contextWriting])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || saving) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty, saving])
  const edit = (values: Partial<Issue>) => setDraft((current) => ({ ...current, ...values }))
  const definitions = issueDefinitions(project)
  const typeLabel = (key: string) => definitions.find((d) => d.key === key)?.label ?? key
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
      if (!draft.parentId && !canPlaceIssue(project, draft.type)) throw new Error(`A ${typeLabel(draft.type).toLowerCase()} needs a parent issue.`)
      const result = await updateIssue(issue.id, { ...issueDraftPatch(base, draft), title: draft.title.trim() }, base.version)
      if (!mounted.current) return false
      if (result.error || !result.issue) { setError(result.error ?? 'Save was not confirmed.'); return false }
      setBase(result.issue); setDraft(result.issue); setReviewing(false)
      return true
    } catch (cause) {
      // Only the checks above throw (updateIssue reports server failures in its result).
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Save failed.', true)
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
  const discard = () => {
    if (window.confirm('Discard your unsaved changes and use the current server values?')) { setBase(issue); setDraft(issue); setError(null); setReviewing(false) }
  }

  /**
   * A related page's Context entry is written at once, beside its link, so the two never disagree. Other
   * unsaved edits stay in the draft (rebased onto the new version). In a version conflict it stays in the
   * draft and the user's save carries it.
   */
  const writeContext = async (change: (context: Record<string, unknown>[]) => Record<string, unknown>[]) => {
    const latest = getProjectsState().issues.find((item) => item.id === issue.id) ?? issue
    const next = change(latest.context)
    setDraft((current) => ({ ...current, context: change(current.context) }))
    if (JSON.stringify(next) === JSON.stringify(latest.context) || baseRef.current.version !== latest.version) return
    setContextWriting(true)
    try {
      const result = await updateIssue(issue.id, { context: next }, latest.version)
      if (!mounted.current) return
      if (result.issue) {
        const remote = result.issue
        const prior = baseRef.current
        // When this change is the draft's only Context edit, take the stored copy: jsonb re-orders keys, so
        // the local copy of the same entry would otherwise read as an unsaved change.
        setDraft((current) => {
          const rebased = rebaseIssueDraft(prior, current, remote)
          return JSON.stringify(current.context) === JSON.stringify(change(prior.context)) ? { ...rebased, context: remote.context } : rebased
        })
        setBase(remote)
      } else setError(result.error ?? 'The context was not saved. Save changes to keep it.')
    } finally { if (mounted.current) setContextWriting(false) }
  }
  const relate = async (doc: ProjectDocumentSummary) => {
    // The field offers this project's pages only, so a related page always has a project.
    const projectId = doc.projectId
    if (!projectId) return
    // One timestamp for the draft and the server copy, so the rebase sees the same entry on both sides.
    const attachedAt = new Date().toISOString()
    if (await docs.link(doc.id)) await writeContext((context) => withDocumentContext(context, { ...doc, projectId }, attachedAt))
  }
  const unrelate = async (link: DocumentIssueLink) => {
    if (await docs.unlink(link)) await writeContext((context) => withoutDocumentContext(context, link.documentId))
  }
  const openDocument = (doc: ProjectDocumentSummary) => void navigate(() => { void window.electron?.browser?.navigate(documentSource(doc)) })
  /** New document from the field: save this issue, create + link the page, add it to Context, open it in Docs. */
  const createRelated = async (title: string) => {
    if (!(await save())) return false
    const page = await docs.create(title)
    if (!page?.projectId) return false
    const projectId = page.projectId
    const latest = getProjectsState().issues.find((item) => item.id === issue.id)
    if (latest) {
      setContextWriting(true)
      try {
        const result = await updateIssue(issue.id, { context: withDocumentContext(latest.context, { ...page, projectId }) }, latest.version)
        if (result.error) { if (mounted.current) setError(`The page was created and linked, but not added to Context: ${result.error}`); return false }
      } finally { if (mounted.current) setContextWriting(false) }
    }
    void window.electron?.browser?.navigate(pageSource(projectId, page.id))
    return true
  }
  /**
   * A relationship write can move this issue on the server: "Blocked by" an unfinished issue moves it to
   * Blocked, removing its last open blocker moves it back. That is not an edit of this draft, so, as for a
   * Context entry, the draft is rebased onto the moved version instead of reading as a conflict.
   */
  const writeRelationship: RelationshipWrite = async (write) => {
    const before = getProjectsState().issues.find((item) => item.id === issue.id)
    setContextWriting(true)
    try {
      const result = await write()
      const after = getProjectsState().issues.find((item) => item.id === issue.id)
      if (mounted.current && before && after && after.version !== before.version && baseRef.current.version === before.version) {
        const prior = baseRef.current
        setDraft((current) => rebaseIssueDraft(prior, current, after))
        setBase(after)
      }
      return result
    } finally { if (mounted.current) setContextWriting(false) }
  }
  const openRelated = (id: string) => void navigate(() => onNavigate(id))

  const children = issues.filter((item) => item.parentId === issue.id).sort((a, b) => a.rank - b.rank)
  const relations = relationCount(issue.id, issueLinks)
  const parent = issues.find((item) => item.id === draft.parentId)
  const parentRequired = !canPlaceIssue(project, draft.type)
  const parentOptions = [
    ...(parentRequired ? [] : [{ value: '', label: 'No parent' }]),
    ...(draft.parentId && !issues.some((i) => i.id === draft.parentId && canPlaceIssue(project, draft.type, i)) ? [{ value: draft.parentId, label: parent ? `${parent.title} (incompatible with this type)` : 'Current parent (incompatible)' }] : []),
    ...issues.filter((i) => i.id !== issue.id && canPlaceIssue(project, draft.type, i))
      .map((i) => ({ value: i.id, label: i.title, detail: `${project.key}-${i.number}`, icon: <StatusIcon status={i.status} /> })),
  ]
  const overdue = !!draft.dueDate && draft.status !== 'done' && new Date(draft.dueDate).getTime() < Date.now()
  const customFields = (project.settings.fields ?? []).filter((f) => (!f.issueTypes?.length || f.issueTypes.includes(draft.type)) || Object.hasOwn(draft.customFields, f.key))
  const task: Task = {
    id: issueKey, title: draft.title || issue.title, description: issue.description, status: issue.status, priority: issue.priority,
    createdAt: issue.createdAt, updatedAt: issue.updatedAt, projectId: project.id, projectName: project.name,
    assignees: [], labels: [], subtasks: [], hasNotification: false,
  }

  const saveState = saving
    ? <span className={cn('inline-flex items-center gap-1.5', MUTED)}><Loader2 className="size-3.5 animate-spin" />Saving…</span>
    : dirty
      ? <span className="inline-flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300"><span className="size-1.5 rounded-full bg-amber-500" aria-hidden />Unsaved changes</span>
      : <span className={cn('inline-flex items-center gap-1.5', MUTED)}><Check className="size-3.5 text-success" />Saved</span>
  const banner = <div className="border-b border-surface-200 px-5 py-2 text-[12.5px] dark:border-surface-800">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="inline-flex h-6 items-center rounded-md bg-surface-100 px-2 font-mono text-[11px] font-semibold tabular-nums tracking-[0.02em] text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary">{issueKey}</span>
      <span className={cn('truncate', MUTED)}>{project.name}</span>
      <span className="text-ink-ghost dark:text-surface-600" aria-hidden>·</span>
      <span className={cn('font-mono text-[11.5px] tabular-nums', MUTED)} title="Saved version">v{issue.version}</span>
      <span className="text-ink-ghost dark:text-surface-600" aria-hidden>·</span>
      {saveState}
      <span className="ml-auto flex items-center gap-1.5">
        {dirty && <Button type="button" variant="ghost" size="sm" disabled={disabled} className={cn(GHOST, 'hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-400')} onClick={discard}>Discard</Button>}
        <Button type="button" variant="outline" size="sm" disabled={disabled} className={SECONDARY} onClick={() => void navigate(onClose)}>Save & close</Button>
        <Button type="button" size="sm" disabled={disabled || !dirty || conflict} className={PRIMARY} onClick={() => void save()}>Save changes</Button>
      </span>
    </div>
    {error && <p role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{error}</p>}
    {((error && !failure?.local) || conflict || reviewing) && <div className="mt-2 space-y-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 font-medium">{reviewing ? 'Review the fields that changed on the server.'
          : conflict ? 'This issue changed on the server while you were editing. Your draft is kept.'
          : 'The save was not confirmed. Your draft is kept.'}</span>
        <Button type="button" variant="outline" size="sm" disabled={disabled} className={SECONDARY} onClick={() => void reloadForReview()}>Reload server values (keep draft)</Button>
      </div>
      {reviewing && <>
        <p className="text-[12.5px] text-ink-secondary dark:text-ink-inverse-secondary">Applying your draft keeps your edits to these fields and preserves other server changes.</p>
        <div className="max-h-36 overflow-auto rounded-lg border border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-900"><table className="w-full text-left text-[12px] text-ink dark:text-ink-inverse">
          <thead className="sticky top-0 bg-surface-50 dark:bg-surface-850"><tr className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted"><th className="px-2.5 py-1.5 font-medium">Field</th><th className="px-2.5 py-1.5 font-medium">Server</th><th className="px-2.5 py-1.5 font-medium">Your draft</th></tr></thead>
          <tbody>{Object.keys(issueDraftPatch(base, draft)).map((key) => <tr key={key} className="border-t border-surface-200 dark:border-surface-800"><td className="px-2.5 py-1.5 font-mono font-medium">{key}</td>
            <td className="max-w-48 break-words px-2.5 py-1.5 font-mono text-[11.5px] text-ink-secondary dark:text-ink-inverse-secondary">{JSON.stringify(issue[key as keyof Issue]) ?? 'Not set'}</td><td className="max-w-48 break-words px-2.5 py-1.5 font-mono text-[11.5px]">{JSON.stringify(draft[key as keyof Issue]) ?? 'Not set'}</td></tr>)}</tbody>
        </table></div>
        <Button type="button" size="sm" disabled={disabled} className={PRIMARY} onClick={() => { setDraft(rebaseIssueDraft(base, draft, issue)); setBase(issue); setError(null); setReviewing(false) }}>Apply draft to reviewed version</Button>
      </>}
    </div>}
  </div>

  const sidebar = <form id={formId} ref={form} onSubmit={(event) => { event.preventDefault(); void save() }}
    className="w-full shrink-0 border-t border-surface-200 px-3 py-5 text-ink dark:border-surface-800 dark:text-ink-inverse lg:w-[22rem] lg:overflow-y-auto lg:border-t-0">
    <fieldset disabled={disabled} className="space-y-6">
      <PropertySection title="Properties">
        <PropertyRow icon={<CircleDot />} label="Status"><StatusPicker value={draft.status} disabled={disabled} onChange={(status) => edit({ status })} /></PropertyRow>
        <PropertyRow icon={<Signal />} label="Priority"><PriorityPicker value={draft.priority} disabled={disabled} onChange={(priority) => edit({ priority })} /></PropertyRow>
        <PropertyRow icon={<Shapes />} label="Type">
          <OptionPicker label="Type" value={draft.type} disabled={disabled} onChange={(type) => edit({ type })}
            options={definitions.map((d) => ({ value: d.key, label: d.label, icon: <TypeChip type={d.key} label={d.label.slice(0, 1)} className="w-5 justify-center px-0" /> }))}>
            <TypeChip type={draft.type} label={typeLabel(draft.type)} />
          </OptionPicker>
        </PropertyRow>
        <PropertyRow icon={<CornerLeftUp />} label="Parent"
          hint={parentRequired && !draft.parentId ? <p className="px-2 pt-0.5 text-[11.5px] text-red-700 dark:text-red-400">Required for a {typeLabel(draft.type).toLowerCase()}</p> : undefined}>
          <OptionPicker label="Parent issue" value={draft.parentId ?? ''} options={parentOptions} disabled={disabled} searchable width="w-80"
            placeholder="Search issues…" onChange={(parentId) => edit({ parentId: parentId || null })}>
            {parent ? <><StatusIcon status={parent.status} /><span className={cn('shrink-0 font-mono text-[11.5px] tabular-nums', MUTED)}>{project.key}-{parent.number}</span><span className="truncate">{parent.title}</span></>
              : draft.parentId ? <span className={cn('truncate', MUTED)}>Parent not loaded</span>
              : <span className={cn('truncate', parentRequired ? 'text-red-700 dark:text-red-400' : MUTED)}>{parentRequired ? 'Choose a parent' : 'No parent'}</span>}
          </OptionPicker>
        </PropertyRow>
        <PropertyRow icon={<Users />} label="Assignees"><AssigneePicker value={draft.assignees} people={people} disabled={disabled} onChange={(assignees) => edit({ assignees })} /></PropertyRow>
        <PropertyRow icon={<Tag />} label="Labels"><LabelsEditor value={draft.labels} disabled={disabled} onChange={(labels) => edit({ labels })} /></PropertyRow>
        <PropertyRow icon={<Gauge />} label="Estimate">
          <EstimateProperty value={draft.estimate} unit={PROJECT_TYPE_SCHEMES[project.type]?.estimateUnit ?? 'points'} disabled={disabled} onChange={(estimate) => edit({ estimate })} />
        </PropertyRow>
      </PropertySection>

      <PropertySection title="Schedule">
        <PropertyRow icon={<CalendarRange />} label="Start"><DateProperty label="Start" value={draft.startDate} disabled={disabled} onChange={(startDate) => edit({ startDate })} /></PropertyRow>
        <PropertyRow icon={<CalendarCheck />} label="End"><DateProperty label="End" value={draft.endDate} disabled={disabled} onChange={(endDate) => edit({ endDate })} /></PropertyRow>
        <PropertyRow icon={<CalendarClock />} label="Due"><DateProperty label="Due" value={draft.dueDate} overdue={overdue} disabled={disabled} onChange={(dueDate) => edit({ dueDate })} /></PropertyRow>
      </PropertySection>

      <PropertySection title="Related documents" action={docs.links.length > 0 ? <span className={cn('font-mono text-[11px] tabular-nums', MUTED)}>{docs.links.length}</span> : undefined}>
        <RelatedDocumentsField docs={docs} projectName={project.name} disabled={disabled || conflict}
          onRelate={relate} onUnrelate={unrelate} onCreate={createRelated} onOpen={openDocument} />
      </PropertySection>

      <PropertySection title="Relationships" action={relations > 0 ? <span className={cn('font-mono text-[11px] tabular-nums', MUTED)}>{relations}</span> : undefined}>
        <IssueRelationshipsField issue={issue} disabled={disabled} onOpen={openRelated} write={writeRelationship} />
      </PropertySection>

      {customFields.length > 0 && <PropertySection title="Fields">
        {customFields.map((field) => <div key={field.key} className="space-y-1.5 px-2 py-1">
          <p className={cn('font-mono text-[11.5px]', MUTED)}>{field.label}{field.required && <span className="text-red-700 dark:text-red-400"> *</span>}{field.archived && ' (archived)'}</p>
          <ProjectFieldInput field={field} value={draft.customFields[field.key]} disabled={disabled} people={people} issues={issues} onChange={(value) => edit({ customFields: { ...draft.customFields, [field.key]: value } })} />
          {field.issueTypes?.length && !field.issueTypes.includes(draft.type) && !field.archived && <button type="button" className="text-[11.5px] font-medium text-red-700 hover:underline dark:text-red-400" onClick={() => {
            const values = { ...draft.customFields }; delete values[field.key]; edit({ customFields: values })
          }}>Remove value (not applicable to this type)</button>}
        </div>)}
      </PropertySection>}
    </fieldset>
  </form>

  const description = <div className="h-full overflow-y-auto text-ink dark:text-ink-inverse">
    <div className="mx-auto max-w-3xl space-y-10 px-8 pb-16 pt-8">
      <header className="space-y-4">
        <div className={cn('flex flex-wrap items-center gap-2 text-[12px]', MUTED)}>
          <TypeChip type={draft.type} label={typeLabel(draft.type)} />
          <span className="inline-flex items-center gap-1.5 text-ink-secondary dark:text-ink-inverse-secondary"><StatusIcon status={draft.status} />{ISSUE_STATUS_CONFIG[draft.status].label}</span>
          {parent && <><span className="text-ink-ghost dark:text-surface-600" aria-hidden>·</span><button type="button" disabled={disabled} className="inline-flex min-w-0 items-center gap-1 rounded-md transition-colors duration-150 hover:text-ink disabled:opacity-60 dark:hover:text-ink-inverse"
            onClick={() => void navigate(() => onNavigate(parent.id))}><CornerLeftUp className="size-3 shrink-0" /><span className="truncate"><span className="font-mono tabular-nums">{project.key}-{parent.number}</span> {parent.title}</span></button></>}
        </div>
        <AssistField value={draft.title} onChange={(title) => edit({ title })} suggest count={5}>
          {(field) => <textarea aria-label="Issue title" form={formId} required maxLength={500} rows={1} disabled={disabled} value={draft.title} placeholder="Issue title"
            onChange={(event) => edit({ title: event.target.value.replace(/\n/g, ' ') })} onFocus={field.onFocus} onBlur={field.onBlur}
            onKeyDown={(event) => {
              field.onKeyDown(event)
              if (event.defaultPrevented) return
              if (event.key === 'Enter') { event.preventDefault(); descriptionEditor?.commands.focus('start') }
              if (event.key === 's' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save() }
            }}
            className="block w-full resize-none bg-transparent font-display text-display-sm font-extrabold leading-[1.1] tracking-[-0.035em] text-ink placeholder:text-ink-muted/80 [field-sizing:content] focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-60 dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted/80" />}
        </AssistField>
      </header>
      <div className="space-y-3">
        <IssueDescriptionRon issueId={issue.id} issueTitle={issue.title} currentDescription={draft.description ?? ''} editor={descriptionEditor}
          disabled={disabled || conflict} beforeStart={save} onPreview={(value) => edit({ description: value })} onRunning={setDescriptionRunning} />
        <div className="-mx-6 rounded-2xl">
          <NotionEditor canonical content={draft.description ?? ''} readOnly={disabled} extensions={DESCRIPTION_EXTENSIONS} onEditor={setDescriptionEditor}
            placeholder="Add a description, or type / for headings, tables, a workflow, Ask Ren…"
            editorClassName="prose prose-base dark:prose-invert max-w-none focus:outline-none min-h-[200px] px-6 py-2"
            onChange={(value) => edit({ description: value })} onSave={() => void save()}
            onAskRon={(goal) => window.dispatchEvent(new CustomEvent('issue-description-ron', { detail: { issueId: issue.id, goal } }))} />
        </div>
      </div>
      <Section title="Child issues" count={children.length} action={definitions.some((d) => canPlaceIssue(project, d.key, issue)) && (
        <Button type="button" variant="ghost" size="sm" disabled={disabled} className={cn(GHOST, 'h-7 gap-1 px-2.5 text-[12.5px] [&_svg]:size-3.5')} onClick={() => void navigate(() => setShowChild(true))}>
          <Plus className="size-3.5" />Create child
        </Button>)}>
        {children.length === 0 && <p className={cn('text-[13px]', MUTED)}>No child issues yet.</p>}
        {children.length > 0 && <div className="divide-y divide-surface-200 overflow-hidden rounded-xl border border-surface-200 dark:divide-surface-800 dark:border-surface-800">
          {children.map((child) => <button key={child.id} type="button" disabled={disabled} onClick={() => void navigate(() => onNavigate(child.id))}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-[13px] transition-colors duration-150 hover:bg-surface-50 disabled:opacity-60 dark:hover:bg-surface-850">
            <StatusIcon status={child.status} />
            <span className={cn('shrink-0 font-mono text-[11.5px] tabular-nums', MUTED)}>{project.key}-{child.number}</span>
            <span className="min-w-0 flex-1 truncate text-ink dark:text-ink-inverse">{child.title}</span>
            <TypeChip type={child.type} label={typeLabel(child.type)} />
          </button>)}
        </div>}
      </Section>
      <LinkedIssuesList issue={issue} disabled={disabled} onOpen={openRelated} />
      <IssueWorkProducts products={issue.workProducts} />
    </div>
  </div>

  const history = <div className="h-full overflow-y-auto px-8 py-7 text-ink dark:text-ink-inverse">
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <p className={cn('text-[12.5px]', MUTED)}>This issue’s entries from the latest 200 project activity records.</p>
        <Button type="button" variant="outline" size="sm" disabled={disabled} className={SECONDARY} onClick={() => void refreshFromServer()}>Refresh</Button>
      </div>
      <ol className="relative space-y-5 border-l border-surface-200 pl-5 dark:border-surface-800">
        {activity.filter((entry) => entry.issueId === issue.id).map((entry) => <li key={entry.id} className="relative text-[13px]">
          <span className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-surface-0 bg-volt dark:border-surface-900" aria-hidden />
          <p className="text-[13px] text-ink dark:text-ink-inverse"><span className="font-semibold">{entry.actorName ?? entry.actorId ?? entry.actorType}</span> <span className="text-ink-secondary dark:text-ink-inverse-secondary">{entry.action.toLowerCase()}</span></p>
          {entry.field && <p className={cn('mt-0.5 break-words font-mono text-[11.5px]', MUTED)}>{entry.field}: {String(entry.oldValue ?? '—')} → {String(entry.newValue ?? '—')}</p>}
          <time className={cn('mt-0.5 block font-mono text-[11px] tabular-nums', MUTED)}>{new Date(entry.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
        </li>)}
      </ol>
      {!activity.some((entry) => entry.issueId === issue.id) && <p className={cn('text-[13px]', MUTED)}>No activity for this issue in the loaded records.</p>}
    </div>
  </div>

  return <>
    <TaskDetailView task={task} onClose={() => void navigate(onClose)} workspace={{ banner, sidebar, description,
      context: <IssueContext entries={draft.context} disabled={disabled}
        onRemove={(id) => edit({ context: draft.context.filter((entry) => entry.id !== id) })} />,
      ron: <IssueRonChat issueId={issue.id} issueKey={issueKey} issue={{ title: issue.title, description: issue.description }}
        hasUnsavedChanges={dirty || saving} />,
      comments: <IssueComments issueId={issue.id} projectOwnerId={project.ownerId} thread={comments}
        onAgentSettled={() => { void refreshFromServer() }} />,
      commentsCount: comments.comments.length,
      history,
    }} />
    {showChild && <CreateIssueDialog isOpen onClose={() => setShowChild(false)} projectId={project.id} parentId={issue.id} />}
  </>
}

function Section({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return <section className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-baseline gap-2">
        <h3 className="font-display text-lg font-bold leading-tight tracking-tight text-ink dark:text-ink-inverse">{title}</h3>
        {!!count && <span className={cn('font-mono text-[11px] tabular-nums', MUTED)}>{count}</span>}
      </div>
      {action}
    </div>
    {children}
  </section>
}
