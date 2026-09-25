import { useEffect, useRef, useState } from 'react'
import { useProjectsStore } from '@/stores/projectsStore'
import type { Project, ProjectField, ProjectFieldType } from '@/types/projects'
import { issueDefinitions } from '@/lib/project-issue-utils'
import { ProjectFieldInput, projectInputClass } from './ProjectFieldInput'

const fieldTypes: ProjectFieldType[] = ['text', 'rich-text', 'number', 'currency', 'checkbox', 'date', 'datetime', 'single-select', 'multi-select', 'person', 'url', 'issue']

export function ProjectConfigurationEditor({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const { issues, people, updateProject, refreshFromServer, pendingSaves, isLoading } = useProjectsStore()
  const [base, setBase] = useState(project)
  const [types, setTypes] = useState(() => issueDefinitions(project))
  const [fields, setFields] = useState<ProjectField[]>(() => project.settings.fields ?? [])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [review, setReview] = useState(false)
  const saving = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const form = useRef<HTMLFormElement>(null)
  const disabled = !canEdit || pendingSaves > 0 || isLoading
  const changeField = (index: number, patch: Partial<ProjectField>) => setFields((current) => current.map((field, i) => i === index ? { ...field, ...patch } : field))
  const save = async () => {
    if (saving.current || disabled || !form.current?.reportValidity()) return
    const duplicates = (values: string[]) => new Set(values).size !== values.length
    if (duplicates(types.map((t) => t.key)) || duplicates(fields.map((f) => f.key))) { setError('Keys must be unique.'); return }
    saving.current = true
    try {
      const result = await updateProject(project.id, { settings: { ...base.settings, issueTypes: types, fields } }, base.version)
      if (!mounted.current) return
      setError(result.error ?? null)
      if (result.project) {
        setBase(result.project); setTypes(issueDefinitions(result.project)); setFields(result.project.settings.fields ?? [])
        setMessage('Configuration saved.'); setReview(false)
      }
    } finally { saving.current = false }
  }
  return <form ref={form} className="mt-6 space-y-6 text-ink dark:text-ink-inverse" onSubmit={(e) => { e.preventDefault(); void save() }}>
    <p className="text-sm text-ink-muted">Owner-managed configuration. Existing field keys and types are immutable; archive fields to retain their values. In-use issue types cannot be removed or moved to another level.</p>
    {error && <p role="alert" className="text-rose-500">{error}</p>}
    {message && <p role="status">{message}</p>}
    {(base.version !== project.version || error) && <div className="space-y-2 rounded-xl border border-amber-500/40 p-3 text-sm">
      <p>Settings may have changed. Your configuration draft is retained.</p>
      <button type="button" disabled={disabled} className="text-indigo-500" onClick={async () => {
        setReview(false)
        const result = await refreshFromServer()
        if (!mounted.current) return
        setError(result.error ?? null)
        setReview(!result.error)
      }}>Reload server configuration for review</button>
      {review && <>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(project.settings, null, 2)}</pre>
        <button type="button" disabled={disabled} onClick={() => {
          if (window.confirm('Discard your configuration draft and load these server settings?')) {
            setBase(project); setTypes(issueDefinitions(project)); setFields(project.settings.fields ?? []); setError(null); setReview(false)
          }
        }}>Discard draft and use server configuration</button>
      </>}
    </div>}
    <fieldset disabled={disabled} className="space-y-6">
      <section className="space-y-3"><h3 className="font-semibold">Issue hierarchy</h3>
        <p className="text-xs text-ink-muted">Levels 1–5. Parents must be exactly one level above; level 5 requires a parent.</p>
        {types.map((type, index) => {
          const existing = issueDefinitions(base).some((t) => t.key === type.key)
          const inUse = issues.some((i) => i.projectId === project.id && i.type === type.key)
          const update = (patch: Partial<typeof type>) => setTypes((current) => current.map((t, i) => i === index ? { ...t, ...patch } : t))
          return <div key={index} className="grid grid-cols-[1fr_1fr_5rem_auto] gap-2">
            <input aria-label={`Type ${index + 1} key`} required pattern="[a-z][a-z0-9-]{0,49}" disabled={existing} className={projectInputClass} value={type.key} onChange={(e) => update({ key: e.target.value })} />
            <input aria-label={`Type ${index + 1} label`} required className={projectInputClass} value={type.label} onChange={(e) => update({ label: e.target.value })} />
            <input aria-label={`Type ${index + 1} level`} required type="number" min={1} max={5} step={1} disabled={inUse} className={projectInputClass} value={type.level} onChange={(e) => update({ level: e.target.valueAsNumber })} />
            <button type="button" disabled={inUse || types.length === 1} className="text-xs text-rose-500 disabled:opacity-40" onClick={() => setTypes((current) => current.filter((_, i) => i !== index))}>Remove</button>
          </div>
        })}
        <button type="button" className="text-indigo-500" onClick={() => setTypes((current) => [...current, { key: '', label: '', level: 4 }])}>Add issue type</button>
      </section>
      <section className="space-y-4"><h3 className="font-semibold">Custom fields</h3>
        {fields.map((field, index) => {
          const existing = base.settings.fields?.some((f) => f.key === field.key)
          return <div key={index} className="space-y-3 rounded-xl border border-surface-200 dark:border-surface-800 p-4">
            <div className="grid grid-cols-3 gap-2">
              <input aria-label={`Field ${index + 1} key`} required pattern="[a-z][a-z0-9-]{0,49}" disabled={existing} className={projectInputClass} value={field.key} onChange={(e) => changeField(index, { key: e.target.value })} />
              <input aria-label={`Field ${index + 1} label`} required className={projectInputClass} value={field.label} onChange={(e) => changeField(index, { label: e.target.value })} />
              <select aria-label={`Field ${index + 1} type`} disabled={existing} className={projectInputClass} value={field.type} onChange={(e) => changeField(index, { type: e.target.value as ProjectFieldType, default: undefined, options: ['single-select', 'multi-select'].includes(e.target.value) ? field.options ?? [] : undefined })}>{fieldTypes.map((type) => <option key={type}>{type}</option>)}</select>
            </div>
            <div className="flex gap-4 text-sm">
              <label><input type="checkbox" checked={field.required ?? false} onChange={(e) => changeField(index, { required: e.target.checked })} /> Required</label>
              <label><input type="checkbox" checked={field.archived ?? false} onChange={(e) => changeField(index, { archived: e.target.checked })} /> Archived</label>
              {!existing && <button type="button" className="text-rose-500" onClick={() => setFields((current) => current.filter((_, i) => i !== index))}>Remove new field</button>}
            </div>
            {['single-select', 'multi-select'].includes(field.type) && <label className="block text-xs">Options (one per line)<textarea className={projectInputClass} value={(field.options ?? []).join('\n')} onChange={(e) => changeField(index, { options: e.target.value.split('\n') })} /></label>}
            <label className="block text-xs">Applies to issue types (none selected means all)<select multiple className={projectInputClass} value={field.issueTypes ?? []} onChange={(e) => changeField(index, { issueTypes: Array.from(e.target.selectedOptions, (o) => o.value) })}>{types.filter((t) => t.key).map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}</select></label>
            <label className="block text-xs"><input type="checkbox" checked={field.default !== undefined} onChange={(e) => changeField(index, { default: e.target.checked ? (field.type === 'checkbox' ? false : field.type === 'multi-select' ? [] : ['number', 'currency'].includes(field.type) ? 0 : '') : undefined })} /> Default for new issues</label>
            {field.default !== undefined && <ProjectFieldInput field={{ ...field, archived: false, required: false }} value={field.default} onChange={(value) => changeField(index, { default: value })} issues={issues.filter((i) => i.projectId === project.id)} people={people} disabled={disabled} />}
          </div>
        })}
        <button type="button" className="text-indigo-500" onClick={() => setFields((current) => [...current, { key: '', label: '', type: 'text' }])}>Add custom field</button>
      </section>
      <button type="submit" disabled={base.version !== project.version} className="rounded-xl bg-indigo-500 px-4 py-2 text-white disabled:opacity-50">Save configuration</button>
    </fieldset>
  </form>
}