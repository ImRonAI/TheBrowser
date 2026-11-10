import type { Issue, Person, ProjectField } from '@/types/projects'
import { NotionEditor } from '@/components/board/task-detail/editor/NotionEditor'
import { fromLocalDateTime, toLocalDateTime } from '@/lib/project-issue-utils'

export const projectInputClass = 'w-full rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-0 dark:bg-surface-900 px-3 py-[7px] text-[13px] leading-5 text-ink dark:text-ink-inverse placeholder:text-ink-muted dark:placeholder:text-ink-inverse-muted transition-colors focus:border-blurple-500 dark:focus:border-blurple-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40'

export function ProjectFieldInput({ field, value, onChange, people, issues, disabled = false }: {
  field: ProjectField; value: unknown; onChange: (value: unknown) => void
  people: Person[]; issues: Issue[]; disabled?: boolean
}) {
  const text = typeof value === 'string' ? value : ''
  const props = { 'aria-label': field.label, disabled: disabled || field.archived, required: field.required, className: projectInputClass }
  if (field.type === 'checkbox') return <select {...props} value={typeof value === 'boolean' ? String(value) : ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'true')}>
    <option value="">Not set</option><option value="true">Yes</option><option value="false">No</option>
  </select>
  if (field.type === 'rich-text') return <NotionEditor canonical content={text} readOnly={props.disabled} onChange={onChange} />
  if (['single-select', 'multi-select', 'person', 'issue'].includes(field.type)) {
    const options = field.type === 'person' ? people.map((p) => ({ value: p.id, label: p.name }))
      : field.type === 'issue' ? issues.map((i) => ({ value: i.id, label: `#${i.number} · ${i.title}` }))
      : (field.options ?? []).map((option) => ({ value: option, label: option }))
    const multi = field.type === 'multi-select'
    const selected = multi ? (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []) : text
    const missing = (Array.isArray(selected) ? selected : [selected]).filter((v) => v && !options.some((o) => o.value === v))
    return <select {...props} multiple={multi} value={selected} onChange={(e) => onChange(multi ? Array.from(e.target.selectedOptions, (o) => o.value) : e.target.value || null)}>
      {!multi && <option value="">Not set</option>}
      {missing.map((id) => <option key={id} value={id}>{id} (not in available choices)</option>)}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  }
  if (field.type === 'number' || field.type === 'currency') return <input {...props} type="number" step="any" value={typeof value === 'number' ? value : ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.valueAsNumber)} />
  if (field.type === 'datetime') return <input {...props} type="datetime-local" value={toLocalDateTime(text)} onChange={(e) => {
    try { onChange(fromLocalDateTime(e.target.value) ?? null); e.target.setCustomValidity('') }
    catch (error) { e.target.setCustomValidity((error as Error).message); e.target.reportValidity() }
  }} />
  return <input {...props} type={field.type === 'date' ? 'date' : field.type === 'url' ? 'url' : 'text'} value={text} onChange={(e) => onChange(e.target.value || null)} />
}