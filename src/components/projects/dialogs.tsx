import { useMemo, useState, useEffect, useId, cloneElement, isValidElement } from 'react'
import { Dialog as DialogRoot, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useProjectsStore, projectSelectors } from '@/stores/projectsStore'
import {
  IssuePriority,
  IssueStatus,
  IssueTypeKey,
  ProjectTypeKey,
  PROJECT_TYPE_SCHEMES,
  ISSUE_PRIORITY_CONFIG,
  ISSUE_STATUS_CONFIG,
  ISSUE_TYPE_CONFIG,
} from '@/types/projects'
import { cn } from '@/utils/cn'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Select, SelectContent } from '@/components/ui/select'
import {
  X,
  FolderKanban,
  CheckSquare,
  Check,
  ChevronDown,
  CodeXml,
  BriefcaseBusiness,
  Rocket,
  GraduationCap,
  FlaskConical,
  Database,
  Target,
  Lightbulb,
  type LucideIcon,
} from 'lucide-react'
import { fromLocalDateTime } from '@/lib/project-issue-utils'
import { issueKey } from '@/lib/execute-issues'
import { ProjectFieldInput } from './ProjectFieldInput'
import { AssistField } from '@/components/shared/TextAssist'

// ─────────────────────────────────────────────────────────────────────────────
// CREATE PROJECT DIALOG
// ─────────────────────────────────────────────────────────────────────────────

interface CreateProjectDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function CreateProjectDialog({ isOpen, onClose }: CreateProjectDialogProps) {
  const { createProject, userId } = useProjectsStore()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [type, setType] = useState<ProjectTypeKey>('software-development')
  const [summary, setSummary] = useState('')

  const reset = () => {
    setError(null)
    setName('')
    setKey('')
    setType('software-development')
    setSummary('')
  }

  const handleClose = () => {
    if (saving) return
    reset()
    onClose()
  }

  const handleSubmit = async () => {
    if (saving || !name.trim()) return
    setSaving(true)
    setError(null)
    const result = await createProject({ name: name.trim(), key: key.trim() || undefined, type, summary })
    setSaving(false)
    if (result.error) { setError(result.error); return }
    reset()
    onClose()
  }

  const confirmDisabled = saving || !userId || !name.trim()

  return (
    <Dialog open={isOpen} onClose={handleClose}>
      <DialogHeader
        icon={<FolderKanban className="w-5 h-5" />}
        title="Create Project"
        subtitle="Start a new project to organize your work"
        onClose={handleClose}
      />

      <DialogForm onSubmit={() => { void handleSubmit() }} disabled={confirmDisabled}>
      <div className="min-h-0 overflow-y-auto p-4 sm:p-6 space-y-5">
        {/* Name & Key Row */}
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_7.5rem] gap-4">
          <FormField label="Project Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Website Redesign"
              autoFocus
              className={inputClasses}
            />
          </FormField>
          <FormField label="Key (optional)">
            <input
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              placeholder="PROJ"
              className={inputClasses}
            />
          </FormField>
        </div>

        {/* Project Type */}
        <FormField label="Project Type">
          {(id) => <ProjectTypeSelect id={id} value={type} onChange={setType} />}
        </FormField>

        {/* Summary */}
        <FormField label="Summary">
          {(id) => <AssistField value={summary} onChange={setSummary}>
            {(field) => <textarea
              id={id}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Briefly describe what this project is about..."
              rows={3}
              className={cn(inputClasses, "resize-none")}
              {...field}
            />}
          </AssistField>}
        </FormField>
      </div>

      <DialogError message={error} />
      <DialogFooter
        onCancel={handleClose}
        confirmText={saving ? 'Saving…' : 'Create Project'}
        confirmDisabled={confirmDisabled}
      />
      </DialogForm>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE ISSUE DIALOG
// ─────────────────────────────────────────────────────────────────────────────

interface CreateIssueDialogProps {
  isOpen: boolean
  onClose: () => void
  projectId?: string
  parentId?: string | null
  initialStatus?: IssueStatus
  initialType?: IssueTypeKey
  allowParentSelection?: boolean
}

export function CreateIssueDialog(props: CreateIssueDialogProps) {
  const { userId } = useProjectsStore()
  if (!props.isOpen) return null
  return <CreateIssueForm key={`${userId}:${props.projectId}:${props.parentId}:${props.initialType}:${props.initialStatus}`} {...props} />
}

function CreateIssueForm({
  isOpen,
  onClose,
  projectId,
  parentId,
  initialStatus,
  initialType,
  allowParentSelection = false,
}: CreateIssueDialogProps) {
  const { projects, issues, people, createIssue, userId } = useProjectsStore()
  const [saving, setSaving] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState(projectId || projects[0]?.id || '')
  const [selectedType, setSelectedType] = useState<IssueTypeKey>(initialType || 'task')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<IssueStatus>(initialStatus || 'backlog')
  const [priority, setPriority] = useState<IssuePriority>('medium')
  const [assignee, setAssignee] = useState<string>('')
  const [dueDate, setDueDate] = useState('')
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({})
  const [parent, setParent] = useState<string | null>(parentId ?? null)
  const [error, setError] = useState<string | null>(null)

  const selectedProject = projects.find((p) => p.id === selectedProjectId)
  const scheme = selectedProject ? PROJECT_TYPE_SCHEMES[selectedProject.type] : null

  const allowedTypes = useMemo(() => {
    if (!scheme) return []
    const configured = selectedProject?.settings.issueTypes
    if (configured) {
      if (!parent) return configured.filter((type) => type.level < 5).map((type) => type.key)
      const parentIssue = issues.find((issue) => issue.id === parent)
      const parentLevel = configured.find((type) => type.key === parentIssue?.type)?.level
      return configured.filter((type) => parentLevel !== undefined && type.level === parentLevel + 1).map((type) => type.key)
    }
    if (parent) {
      const parentIssue = issues.find((issue) => issue.id === parent)
      if (!parentIssue) return []
      return projectSelectors.getAllowedChildTypes(parentIssue.type)
    }
    return scheme.issueTypes.filter((type) => projectSelectors.isRootTypeAllowed(type))
  }, [scheme, selectedProject, parent, issues])

  const parentOptions = useMemo(() => {
    if (!selectedProject) return []
    if (!allowParentSelection) return []
    const configured = selectedProject.settings.issueTypes
    if (configured) {
      const level = configured.find((type) => type.key === selectedType)?.level
      return issues.filter((issue) => issue.projectId === selectedProject.id &&
        configured.some((type) => type.key === issue.type && level !== undefined && type.level === level - 1))
    }
    const requiredParentType = STANDARD_PARENT_BY_CHILD[selectedType]
    if (!allowParentSelection || !requiredParentType) return []
    return issues.filter((issue) =>
      issue.projectId === selectedProject.id &&
      issue.type === requiredParentType
    )
  }, [selectedProject, selectedType, issues, allowParentSelection])

  useEffect(() => {
    if (!selectedProjectId && projects.length) setSelectedProjectId(projectId || projects[0].id)
  }, [selectedProjectId, projects, projectId])

  useEffect(() => {
    if (allowedTypes.length === 0) return
    if (!allowedTypes.includes(selectedType)) {
      setSelectedType(allowedTypes[0])
    }
  }, [allowedTypes, selectedType])

  const reset = () => {
    setSelectedProjectId(projectId || projects[0]?.id || '')
    setSelectedType(initialType || 'task')
    setTitle('')
    setDescription('')
    setStatus(initialStatus || 'backlog')
    setPriority('medium')
    setAssignee('')
    setDueDate('')
    setCustomFields({})
    setParent(parentId ?? null)
    setError(null)
  }

  const handleClose = () => {
    if (saving) return
    reset()
    onClose()
  }

  const handleSubmit = async () => {
    if (saving) return
    if (!title.trim()) {
      setError('Title is required.')
      return
    }

    let due: string | undefined
    try { due = fromLocalDateTime(dueDate) }
    catch (cause) { setError((cause as Error).message); return }
    setSaving(true)
    setError(null)
    const result = await createIssue({
      projectId: selectedProjectId,
      title: title.trim(),
      type: selectedType,
      description: description.trim(),
      status,
      priority,
      assignees: assignee ? [assignee] : [],
      dueDate: due,
      customFields: Object.fromEntries(Object.entries(customFields).filter(([key]) =>
        selectedProject?.settings.fields?.some((field) => field.key === key && !field.archived && (!field.issueTypes?.length || field.issueTypes.includes(selectedType))))),
      parentId: parent || undefined,
    })

    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }

    reset()
    onClose()
  }

  const confirmDisabled = saving || !userId || !selectedProjectId || !allowedTypes.includes(selectedType) || !title.trim()

  return (
    <Dialog open={isOpen} onClose={handleClose} size="lg">
      <DialogHeader 
        icon={<CheckSquare className="w-5 h-5" />}
        title="Create Issue"
        subtitle="Add a new issue to track your work"
        onClose={handleClose}
      />
      
      <DialogForm onSubmit={() => { void handleSubmit() }} disabled={confirmDisabled}>
      <div className="min-h-0 overflow-y-auto p-4 sm:p-6 space-y-5">
        {/* Project & Type Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Project">
            <select
              value={selectedProjectId}
              disabled={Boolean(parentId) || saving}
              onChange={(e) => { setSelectedProjectId(e.target.value); setParent(null); setCustomFields({}) }}
              className={selectClasses}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {`${project.name}${project.lifecycle === 'archived' ? ' (archived)' : ''}`}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Issue Type">
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as IssueTypeKey)}
              className={selectClasses}
            >
              {allowedTypes.map((type) => (
                <option key={type} value={type}>
                  {selectedProject?.settings.issueTypes?.find((definition) => definition.key === type)?.label ?? ISSUE_TYPE_CONFIG[type]?.label ?? type}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        {/* Parent Selection */}
        {allowParentSelection && parentOptions.length > 0 && (
          <FormField label="Parent Issue">
            <select
              value={parent || ''}
              onChange={(e) => setParent(e.target.value || null)}
              className={selectClasses}
            >
              <option value="">No parent</option>
              {parentOptions.map((issue) => (
                <option key={issue.id} value={issue.id}>
                  {`${issueKey(issue, projects)} · ${issue.title}`}
                </option>
              ))}
            </select>
          </FormField>
        )}

        {/* Title */}
        <FormField label="Title">
          {(id) => <AssistField value={title} onChange={setTitle} suggest count={5}>
            {(field) => <input
              id={id}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Issue title"
              autoFocus
              className={inputClasses}
              {...field}
            />}
          </AssistField>}
        </FormField>

        {/* Description */}
        <FormField label="Description">
          {(id) => <AssistField value={description} onChange={setDescription}>
            {(field) => <textarea
              id={id}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the issue..."
              rows={3}
              className={cn(inputClasses, "resize-none")}
              {...field}
            />}
          </AssistField>}
        </FormField>

        {/* Status & Priority Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as IssueStatus)}
              className={selectClasses}
            >
              {Object.keys(ISSUE_STATUS_CONFIG).map((key) => (
                <option key={key} value={key}>
                  {ISSUE_STATUS_CONFIG[key as IssueStatus].label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Priority">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as IssuePriority)}
              className={selectClasses}
            >
              {Object.keys(ISSUE_PRIORITY_CONFIG).map((key) => (
                <option key={key} value={key}>
                  {ISSUE_PRIORITY_CONFIG[key as IssuePriority].label}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        {/* Assignee & Due Date Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Assignee">
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className={selectClasses}
            >
              <option value="">Unassigned</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Due Date">
            <input
              type="datetime-local"
              aria-label={`Due time in ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={inputClasses}
            />
          </FormField>
        </div>

        {/* Custom fields */}
        {(selectedProject?.settings.fields ?? []).filter((field) => !field.archived && (!field.issueTypes?.length || field.issueTypes.includes(selectedType))).map((field) => <FormField key={field.key} label={`${field.label}${field.required ? ' *' : ''}`}>
          <ProjectFieldInput field={field} value={Object.hasOwn(customFields, field.key) ? customFields[field.key] : field.default} people={people} issues={issues} disabled={saving} onChange={(value) => setCustomFields((current) => ({ ...current, [field.key]: value }))} />
        </FormField>)}
      </div>

      <DialogError message={error} />
      <DialogFooter
        onCancel={handleClose}
        confirmText={saving ? 'Saving…' : 'Create Issue'}
        confirmDisabled={confirmDisabled}
      />
      </DialogForm>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BASE DIALOG COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface DialogProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  size?: 'md' | 'lg' | 'xl'
}

function Dialog({ open, onClose, children, size = 'md' }: DialogProps) {
  const sizeClasses = {
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
  }

  return (
    <DialogRoot open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent showCloseButton={false}
        overlayClassName="z-[220] bg-surface-900/50 backdrop-blur-sm"
        className={cn('z-[221] flex flex-col gap-0 p-0 w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] overflow-hidden rounded-2xl bg-surface-0 dark:bg-surface-900 text-ink dark:text-ink-inverse', sizeClasses[size])}>
        {children}
      </DialogContent>
    </DialogRoot>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DIALOG COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

interface DialogHeaderProps {
  icon: React.ReactNode
  title: string
  subtitle?: string
  onClose: () => void
}

function DialogHeader({ icon, title, subtitle, onClose }: DialogHeaderProps) {
  return (
    <div className={cn(
      "flex shrink-0 items-start justify-between gap-2",
      "px-6 py-5",
      "border-b border-surface-200 dark:border-surface-800",
      "bg-surface-50/50 dark:bg-surface-850/50"
    )}>
      <div className="flex items-center gap-3">
        <div className={cn(
          "w-10 h-10 rounded-xl",
          "bg-indigo-500/10 dark:bg-indigo-500/20",
          "flex items-center justify-center",
          "text-indigo-600 dark:text-indigo-400"
        )}>
          {icon}
        </div>
        <div>
          <DialogTitle className="text-lg font-semibold text-ink dark:text-ink-inverse">
            {title}
          </DialogTitle>
          {subtitle && (
            <DialogDescription className="text-body-sm text-ink-muted dark:text-ink-inverse-muted">
              {subtitle}
            </DialogDescription>
          )}
        </div>
      </div>
      <Button type="button" variant="ghost" size="icon" aria-label="Close dialog"
        onClick={onClose}
        className={cn(
          "p-2 rounded-lg",
          "text-ink-muted hover:text-ink dark:hover:text-ink-inverse",
          "hover:bg-surface-200 dark:hover:bg-surface-800",
          "transition-colors"
        )}
      >
        <X className="w-5 h-5" />
      </Button>
    </div>
  )
}

/**
 * The fields and the footer as one form, so Enter in a single-line field submits like the confirm
 * button. Validation stays the dialog's own (`noValidate`). A submit from a form nested in a field
 * (an editor block's link row, rendered through a React portal) is that form's, not this one's.
 */
function DialogForm({ onSubmit, disabled, children }: { onSubmit: () => void; disabled: boolean; children: React.ReactNode }) {
  return (
    <form noValidate className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        if (!disabled) onSubmit()
      }}>
      {children}
    </form>
  )
}

/** A failed save, between the fields and the buttons so it stays in view however far the fields scroll. */
function DialogError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="shrink-0 border-t border-rose-500/20 bg-rose-500/10 px-4 py-3 text-body-sm text-rose-600 dark:text-rose-400 sm:px-6">
      {message}
    </p>
  )
}

interface DialogFooterProps {
  onCancel: () => void
  confirmText: string
  confirmDisabled?: boolean
}

/** Rendered inside a DialogForm: the confirm button submits it. */
function DialogFooter({ onCancel, confirmText, confirmDisabled }: DialogFooterProps) {
  return (
    <div className={cn(
      "flex shrink-0 flex-wrap items-center justify-end gap-3",
      "px-6 py-4",
      "border-t border-surface-200 dark:border-surface-800",
      "bg-surface-50/50 dark:bg-surface-850/50"
    )}>
      <Button type="button" variant="ghost"
        onClick={onCancel}
        className={cn(
          "px-4 py-2 rounded-xl",
          "text-body-sm font-medium",
          "text-ink-muted dark:text-ink-inverse-muted",
          "hover:text-ink dark:hover:text-ink-inverse",
          "hover:bg-surface-200 dark:hover:bg-surface-800",
          "transition-colors"
        )}
      >
        Cancel
      </Button>
      <Button type="submit"
        disabled={confirmDisabled}
        className={cn(
          "px-4 py-2 rounded-xl",
          "text-body-sm font-medium text-white",
          "bg-indigo-500 hover:bg-indigo-600",
          "shadow-sm shadow-indigo-500/20",
          "transition-colors",
          confirmDisabled && "opacity-50 cursor-not-allowed"
        )}
      >
        {confirmText}
      </Button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FORM COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

/** A function child receives the label's id, for controls wrapped in another component (AssistField, a Radix trigger). */
function FormField({ label, children }: { label: string; children: React.ReactNode | ((id: string) => React.ReactNode) }) {
  const id = useId()
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
        {label}
      </label>
      {typeof children === 'function' ? children(id)
        : isValidElement<{ id?: string }>(children) && typeof children.type === 'string' ? cloneElement(children, { id }) : children}
    </div>
  )
}

const inputClasses = cn(
  "w-full px-3 py-2.5 rounded-xl",
  "bg-surface-0 dark:bg-surface-900",
  "border border-surface-200 dark:border-surface-800",
  "text-body-sm text-ink dark:text-ink-inverse",
  "placeholder:text-ink-muted/40",
  "focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-600",
  "transition-colors"
)

const PROJECT_TYPE_ICONS: Record<ProjectTypeKey, LucideIcon> = {
  'software-development': CodeXml,
  'work-operations': BriefcaseBusiness,
  founder: Rocket,
  academic: GraduationCap,
  research: FlaskConical,
  'data-accrual': Database,
  'personal-goals': Target,
  'product-discovery': Lightbulb,
}

function ProjectTypeSelect({ id, value, onChange }: { id?: string; value: ProjectTypeKey; onChange: (value: ProjectTypeKey) => void }) {
  const selected = PROJECT_TYPE_SCHEMES[value]
  const SelectedIcon = PROJECT_TYPE_ICONS[value]

  return (
    <Select value={value} onValueChange={(next) => onChange(next as ProjectTypeKey)}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label="Project type"
        className={cn(
          "ron-field group flex w-full items-center gap-3 px-3 py-2.5 rounded-xl text-left",
          "bg-surface-0 dark:bg-surface-900",
          "border border-surface-200 dark:border-surface-800",
          "hover:border-surface-300 dark:hover:border-surface-700",
          "focus:outline-none focus-visible:border-indigo-400 dark:focus-visible:border-indigo-600",
          "focus-visible:ring-4 focus-visible:ring-indigo-500/10",
          "data-[state=open]:border-indigo-400 dark:data-[state=open]:border-indigo-600",
          "data-[state=open]:ring-4 data-[state=open]:ring-indigo-500/10",
          "transition-[border-color,box-shadow] cursor-pointer"
        )}
      >
        <span className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          "bg-indigo-500/10 dark:bg-indigo-500/20",
          "text-indigo-600 dark:text-indigo-400"
        )}>
          <SelectedIcon className="h-[18px] w-[18px]" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-sm font-medium text-ink dark:text-ink-inverse">
            <SelectPrimitive.Value>{selected.label}</SelectPrimitive.Value>
          </span>
          <span className="truncate text-xs text-ink-muted dark:text-ink-inverse-muted">
            {selected.description}
          </span>
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className={cn(
            "h-4 w-4 shrink-0 text-ink-muted dark:text-ink-inverse-muted",
            "transition-transform duration-200 group-data-[state=open]:rotate-180"
          )} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectContent
        position="popper"
        sideOffset={6}
        className={cn(
          "z-[230] w-[var(--radix-select-trigger-width)] rounded-2xl",
          "bg-surface-0 dark:bg-surface-900 text-ink dark:text-ink-inverse",
          "border-surface-200 dark:border-surface-800",
          "shadow-bold dark:shadow-dark-bold"
        )}
      >
        {Object.values(PROJECT_TYPE_SCHEMES).map((scheme) => {
          const Icon = PROJECT_TYPE_ICONS[scheme.key]
          return (
            <SelectPrimitive.Item
              key={scheme.key}
              value={scheme.key}
              className={cn(
                "group relative flex w-full cursor-pointer select-none items-center gap-3",
                "rounded-xl py-1.5 pl-2 pr-9 outline-none transition-colors",
                "data-[highlighted]:bg-surface-200/60 dark:data-[highlighted]:bg-surface-800",
                "data-[state=checked]:bg-indigo-500/[0.07] dark:data-[state=checked]:bg-indigo-500/10"
              )}
            >
              <span className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                "bg-surface-100 text-ink-secondary dark:bg-surface-800 dark:text-ink-inverse-secondary",
                "group-data-[highlighted]:bg-surface-0 dark:group-data-[highlighted]:bg-surface-900",
                "group-data-[state=checked]:bg-indigo-500/15 group-data-[state=checked]:text-indigo-600",
                "dark:group-data-[state=checked]:bg-indigo-500/20 dark:group-data-[state=checked]:text-indigo-400"
              )}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-body-sm font-medium text-ink dark:text-ink-inverse">
                  <SelectPrimitive.ItemText>{scheme.label}</SelectPrimitive.ItemText>
                </span>
                <span className="text-xs leading-snug text-ink-muted dark:text-ink-inverse-muted">
                  {scheme.description}
                </span>
              </span>
              <SelectPrimitive.ItemIndicator className="absolute right-3 top-1/2 -translate-y-1/2 text-indigo-600 dark:text-indigo-400">
                <Check className="h-4 w-4" />
              </SelectPrimitive.ItemIndicator>
            </SelectPrimitive.Item>
          )
        })}
      </SelectContent>
    </Select>
  )
}

const selectClasses = cn(
  "w-full px-3 py-2.5 rounded-xl",
  "bg-surface-0 dark:bg-surface-900",
  "border border-surface-200 dark:border-surface-800",
  "text-body-sm text-ink dark:text-ink-inverse",
  "focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-600",
  "transition-colors cursor-pointer"
)

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const STANDARD_PARENT_BY_CHILD: Record<IssueTypeKey, IssueTypeKey | null> = {
  initiative: null,
  epic: 'initiative',
  story: 'epic',
  task: 'story',
  bug: 'story',
  subtask: 'task',
}
