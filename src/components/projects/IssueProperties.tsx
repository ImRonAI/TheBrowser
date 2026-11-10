import { useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Plus, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { ISSUE_PRIORITY_CONFIG, ISSUE_STATUS_CONFIG, ISSUE_TYPE_CONFIG, type IssuePriority, type IssueStatus, type Person } from '@/types/projects'
import { fromLocalDateTime, toLocalDateTime } from '@/lib/project-issue-utils'
import { cn } from '@/lib/utils'

/** Popovers render above the issue workspace (z-[200]). */
export const PROPERTY_POPOVER = 'z-[260] w-64 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-float'
/** A property value: reads as plain text, reveals itself as a control on hover/focus. */
export const PROPERTY_VALUE = 'group flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] text-ink transition-colors duration-150 ease-out hover:bg-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple-600/70 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent dark:text-ink-inverse dark:hover:bg-surface-850 dark:focus-visible:ring-blurple-400/70'
export const PROPERTY_ITEM = 'h-8 gap-2 rounded-lg px-2.5 py-0 text-[13px] text-ink data-[selected=true]:bg-surface-100 data-[selected=true]:text-ink dark:text-ink-inverse dark:data-[selected=true]:bg-surface-800 dark:data-[selected=true]:text-ink-inverse'
export const PROPERTY_SEARCH = 'h-9 text-[13px] text-ink placeholder:text-ink-muted dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted focus-visible:ring-0 focus-visible:ring-offset-0'
const COMMAND = 'bg-transparent text-inherit [&_[cmdk-input-wrapper]]:border-border'
const EMPTY_RESULT = 'py-5 text-center text-[13px] text-ink-muted dark:text-ink-inverse-muted'

export function PropertySection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="space-y-1">
    <div className="flex h-7 items-center justify-between px-2">
      <h3 className="font-mono text-[11px] font-medium uppercase leading-none tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted">{title}</h3>
      {action}
    </div>
    <div className="space-y-0.5">{children}</div>
  </section>
}

/** One key/value row: a mono key (with its glyph) on the left, the editable value on the right. */
export function PropertyRow({ icon, label, children, hint }: { icon: ReactNode; label: string; children: ReactNode; hint?: ReactNode }) {
  return <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-1">
    <span className="flex h-8 items-center gap-2 px-2 font-mono text-[11.5px] text-ink-muted dark:text-ink-inverse-muted [&_svg]:size-3.5 [&_svg]:shrink-0">
      {icon}<span className="truncate">{label}</span>
    </span>
    <div className="min-w-0">{children}{hint}</div>
  </div>
}

const Chevron = () => <ChevronDown className="ml-auto size-3.5 shrink-0 text-ink-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:text-ink-inverse-muted" />
const Empty = ({ children }: { children: ReactNode }) => <span className="truncate text-ink-muted dark:text-ink-inverse-muted">{children}</span>

/** Linear-style status glyph: dashed backlog, filling progress, blocked, done. */
export function StatusIcon({ status, className }: { status: IssueStatus; className?: string }) {
  const box = cn('size-3.5 shrink-0', className)
  if (status === 'done') return <svg viewBox="0 0 14 14" className={cn(box, 'text-success')} aria-hidden><circle cx="7" cy="7" r="6" fill="currentColor" /><path d="M4.2 7.2l1.9 1.9 3.7-3.9" fill="none" className="stroke-white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  if (status === 'blocked') return <svg viewBox="0 0 14 14" className={cn(box, 'text-danger')} aria-hidden><circle cx="7" cy="7" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M4.5 7h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
  if (status === 'backlog') return <svg viewBox="0 0 14 14" className={cn(box, 'text-surface-400 dark:text-surface-500')} aria-hidden><circle cx="7" cy="7" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 1.8" /></svg>
  const review = status === 'review'
  return <svg viewBox="0 0 14 14" className={cn(box, review ? 'text-blurple-500 dark:text-blurple-300' : 'text-blurple-600 dark:text-blurple-400')} aria-hidden>
    <circle cx="7" cy="7" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d={review ? 'M7 7V3a4 4 0 1 1-4 4z' : 'M7 7V3a4 4 0 0 1 0 8z'} fill="currentColor" />
  </svg>
}

/** Signal bars for priority; critical is an alert square. */
export function PriorityIcon({ priority, className }: { priority: IssuePriority; className?: string }) {
  const box = cn('size-3.5 shrink-0', className)
  if (priority === 'critical') return <svg viewBox="0 0 14 14" className={cn(box, 'text-danger')} aria-hidden><rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor" /><path d="M7 4v3.5" className="stroke-white" strokeWidth="1.6" strokeLinecap="round" /><circle cx="7" cy="10" r="0.9" className="fill-white" /></svg>
  const level = { high: 3, medium: 2, low: 1 }[priority]
  return <svg viewBox="0 0 14 14" className={cn(box, 'text-ink-secondary dark:text-ink-inverse-secondary')} aria-hidden>
    {[0, 1, 2].map((bar) => <rect key={bar} x={1.5 + bar * 4} y={9 - bar * 3} width="3" height={4 + bar * 3} rx="1" fill="currentColor" opacity={bar < level ? 1 : 0.22} />)}
  </svg>
}

export function TypeChip({ type, label, className }: { type: string; label: string; className?: string }) {
  return <span className={cn('inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11.5px] font-semibold leading-none', ISSUE_TYPE_CONFIG[type]?.color ?? 'bg-surface-100 text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary', className)}>{label}</span>
}

export function PersonAvatar({ person, className }: { person: Pick<Person, 'name' | 'initials' | 'avatar'>; className?: string }) {
  // The built-in agent: named Ren now, Ron in rows written before the rename.
  const ron = /^R[eo]n\b/.test(person.name)
  return person.avatar
    ? <img src={person.avatar} alt="" className={cn('size-5 shrink-0 rounded-full object-cover ring-2 ring-surface-0 dark:ring-surface-900', className)} />
    : <span aria-hidden className={cn('flex size-5 shrink-0 items-center justify-center rounded-full text-[9.5px] font-semibold ring-2 ring-surface-0 dark:ring-surface-900',
      ron ? 'bg-blurple-600 text-white dark:bg-blurple-400 dark:text-ink' : 'bg-surface-200 text-ink-secondary dark:bg-surface-700 dark:text-ink-inverse-secondary', className)}>{(person.initials || person.name.slice(0, 1)).slice(0, 2).toUpperCase()}</span>
}

export interface PickerOption<T extends string> { value: T; label: string; icon?: ReactNode; detail?: string }

/** One choice from a short list, with type-to-filter when `searchable`. */
export function OptionPicker<T extends string>({ label, value, options, onChange, disabled, children, searchable, placeholder, width = 'w-64' }: {
  label: string
  value: T
  options: PickerOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  /** The value as shown in the property row. */
  children: ReactNode
  searchable?: boolean
  placeholder?: string
  width?: string
}) {
  const [open, setOpen] = useState(false)
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" aria-label={label} disabled={disabled} className={PROPERTY_VALUE}>{children}<Chevron /></button>
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={6} className={cn(PROPERTY_POPOVER, width)}>
      <Command className={COMMAND} loop>
        {searchable && <CommandInput placeholder={placeholder ?? `Search ${label.toLowerCase()}…`} className={PROPERTY_SEARCH} />}
        <CommandList className="max-h-72 p-0.5">
          <CommandEmpty className={EMPTY_RESULT}>No matches</CommandEmpty>
          {options.map((option) => (
            <CommandItem key={option.value || '∅'} value={`${option.label} ${option.detail ?? ''} ${option.value}`} className={PROPERTY_ITEM}
              onSelect={() => { onChange(option.value); setOpen(false) }}>
              {option.icon}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.detail && <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">{option.detail}</span>}
              <Check className={cn('size-3.5 shrink-0 text-blurple-600 dark:text-blurple-400', option.value === value ? 'opacity-100' : 'opacity-0')} />
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
}

export function StatusPicker({ value, onChange, disabled }: { value: IssueStatus; onChange: (value: IssueStatus) => void; disabled?: boolean }) {
  const options = (Object.keys(ISSUE_STATUS_CONFIG) as IssueStatus[]).map((status) => ({ value: status, label: ISSUE_STATUS_CONFIG[status].label, icon: <StatusIcon status={status} /> }))
  return <OptionPicker label="Status" value={value} options={options} onChange={onChange} disabled={disabled}>
    <StatusIcon status={value} /><span className="truncate">{ISSUE_STATUS_CONFIG[value].label}</span>
  </OptionPicker>
}

export function PriorityPicker({ value, onChange, disabled }: { value: IssuePriority; onChange: (value: IssuePriority) => void; disabled?: boolean }) {
  const options = (Object.keys(ISSUE_PRIORITY_CONFIG) as IssuePriority[]).map((priority) => ({ value: priority, label: ISSUE_PRIORITY_CONFIG[priority].label, icon: <PriorityIcon priority={priority} /> }))
  return <OptionPicker label="Priority" value={value} options={options} onChange={onChange} disabled={disabled}>
    <PriorityIcon priority={value} /><span className="truncate">{ISSUE_PRIORITY_CONFIG[value].label}</span>
  </OptionPicker>
}

/** Assignees: avatars in the row; a checklist in the popover (stays open while you pick). */
export function AssigneePicker({ value, people, onChange, disabled }: { value: string[]; people: Person[]; onChange: (value: string[]) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const known = useMemo(() => new Map(people.map((person) => [person.id, person])), [people])
  const everyone: Person[] = [...value.filter((id) => !known.has(id)).map((id) => ({ id, name: id, initials: '?' })), ...people]
  const chosen = value.map((id) => known.get(id) ?? { id, name: id, initials: '?' })
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id])
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" aria-label="Assignees" disabled={disabled} className={PROPERTY_VALUE}>
        {chosen.length === 0 && <Empty>Unassigned</Empty>}
        {chosen.length > 0 && <span className="flex shrink-0 -space-x-1.5">{chosen.slice(0, 4).map((person) => <PersonAvatar key={person.id} person={person} />)}</span>}
        {chosen.length === 1 && <span className="truncate">{chosen[0].name}</span>}
        {chosen.length > 1 && <span className="truncate text-ink-secondary dark:text-ink-inverse-secondary"><span className="font-mono tabular-nums">{chosen.length}</span> people</span>}
        <Chevron />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={6} className={PROPERTY_POPOVER}>
      <Command className={COMMAND} loop>
        <CommandInput placeholder="Assign to…" className={PROPERTY_SEARCH} />
        <CommandList className="max-h-72 p-0.5">
          <CommandEmpty className={EMPTY_RESULT}>No one matches</CommandEmpty>
          {everyone.map((person) => (
            <CommandItem key={person.id} value={`${person.name} ${person.id}`} className={PROPERTY_ITEM} onSelect={() => toggle(person.id)}>
              <PersonAvatar person={person} className="ring-0" />
              <span className="min-w-0 flex-1 truncate">{person.name}</span>
              <span className={cn('flex size-4 shrink-0 items-center justify-center rounded border transition-colors duration-150',
                value.includes(person.id)
                  ? 'border-blurple-600 bg-blurple-600 text-white dark:border-blurple-400 dark:bg-blurple-400 dark:text-ink'
                  : 'border-surface-300 dark:border-surface-600')}>
                {value.includes(person.id) && <Check className="size-3" />}
              </span>
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
}

/** Labels as chips; type and press Enter (or comma) to add, Backspace on an empty field removes the last. */
export function LabelsEditor({ value, onChange, disabled }: { value: string[]; onChange: (value: string[]) => void; disabled?: boolean }) {
  const [text, setText] = useState('')
  const labels = value.map((label) => label.trim()).filter(Boolean)
  const add = () => {
    const next = text.split(',').map((label) => label.trim()).filter(Boolean)
    if (next.length) onChange([...labels, ...next.filter((label) => !labels.some((existing) => existing.toLowerCase() === label.toLowerCase()))])
    setText('')
  }
  return <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-lg px-1.5 py-1 transition-colors duration-150 focus-within:bg-surface-100 dark:focus-within:bg-surface-850">
    {labels.map((label) => (
      <span key={label} className="group/label inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-surface-100 pl-2.5 pr-1 text-[12px] font-medium text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary">
        <span className="size-1.5 shrink-0 rounded-full bg-volt" aria-hidden />
        <span className="truncate">{label}</span>
        <button type="button" aria-label={`Remove label ${label}`} disabled={disabled} onClick={() => onChange(labels.filter((item) => item !== label))}
          className="flex size-4 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-200 hover:text-danger disabled:hidden dark:text-ink-inverse-muted dark:hover:bg-surface-700"><X className="size-3" /></button>
      </span>
    ))}
    <input aria-label="Add label" value={text} disabled={disabled} placeholder={labels.length ? 'Add…' : 'Add labels'}
      onChange={(event) => setText(event.target.value)} onBlur={add}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add() }
        if (event.key === 'Backspace' && !text && labels.length) onChange(labels.slice(0, -1))
      }}
      className="min-w-[4.5rem] flex-1 bg-transparent px-1 py-0.5 text-[13px] text-ink placeholder:text-ink-muted focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted" />
  </div>
}

const formatWhen = (iso: string) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const midnight = date.getHours() === 0 && date.getMinutes() === 0
  return date.toLocaleString(undefined, midnight
    ? { month: 'short', day: 'numeric', year: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** A date-time property: the formatted value in the row, the editor in a popover. */
export function DateProperty({ label, value, onChange, disabled, overdue }: {
  label: string; value?: string; onChange: (value: string | undefined) => void; disabled?: boolean; overdue?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [problem, setProblem] = useState('')
  return <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setProblem('') }}>
    <PopoverTrigger asChild>
      <button type="button" aria-label={`${label} date`} disabled={disabled} className={PROPERTY_VALUE}>
        {value ? <span className={cn('truncate tabular-nums', overdue && 'font-medium text-red-700 dark:text-red-400')}>{formatWhen(value)}{overdue && ' · overdue'}</span> : <Empty>Not set</Empty>}
        <Chevron />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={6} className={cn(PROPERTY_POPOVER, 'w-72 space-y-2.5 p-3')}>
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted">{label}</p>
      <input aria-label={label} type="datetime-local" value={toLocalDateTime(value)} autoFocus
        onChange={(event) => {
          try { onChange(fromLocalDateTime(event.target.value)); setProblem('') } catch (cause) { setProblem((cause as Error).message) }
        }}
        className="h-9 w-full rounded-lg border border-surface-200 bg-surface-0 px-3 text-[13px] tabular-nums text-ink transition-colors focus:border-blurple-500 focus:outline-none focus:ring-2 focus:ring-blurple-600/20 focus-visible:ring-offset-0 dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:focus:border-blurple-400 dark:focus:ring-blurple-400/25 [color-scheme:light] dark:[color-scheme:dark]" />
      {problem && <p role="alert" className="text-[12px] text-red-700 dark:text-red-400">{problem}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-[11px] text-ink-muted dark:text-ink-inverse-muted">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
        <span className="flex shrink-0 gap-1">
          {value && <button type="button" className="h-7 rounded-lg px-2.5 text-[12px] font-medium text-ink-secondary transition-colors hover:bg-surface-100 hover:text-danger dark:text-ink-inverse-secondary dark:hover:bg-surface-800" onClick={() => { onChange(undefined); setOpen(false) }}>Clear</button>}
          <button type="button" className="h-7 rounded-lg bg-ink px-3 text-[12px] font-semibold text-white transition-colors hover:bg-surface-800 dark:bg-ink-inverse dark:text-ink dark:hover:bg-white" onClick={() => setOpen(false)}>Done</button>
        </span>
      </div>
    </PopoverContent>
  </Popover>
}

/** A number typed in place, with the project's estimate unit beside it. */
export function EstimateProperty({ value, unit, onChange, disabled }: { value?: number; unit: string; onChange: (value: number | undefined) => void; disabled?: boolean }) {
  return <label className={cn(PROPERTY_VALUE, 'cursor-text focus-within:bg-surface-100 dark:focus-within:bg-surface-850')}>
    <input aria-label="Estimate" type="number" min={0} step="any" disabled={disabled} placeholder="—" value={value ?? ''}
      onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.valueAsNumber)}
      className="min-w-[2ch] max-w-24 bg-transparent font-mono text-[13px] tabular-nums text-ink [field-sizing:content] placeholder:text-ink-muted focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
    <span className="text-[12px] text-ink-muted dark:text-ink-inverse-muted">{unit}</span>
  </label>
}

export const AddButton = ({ children, ...props }: React.ComponentProps<'button'>) => (
  <button type="button" {...props} className={cn(PROPERTY_VALUE, 'text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse', props.className)}>
    <Plus className="size-3.5" />{children}
  </button>
)
