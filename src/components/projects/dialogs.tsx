import { useMemo, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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
import { X, FolderKanban, CheckSquare } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// CREATE PROJECT DIALOG
// ─────────────────────────────────────────────────────────────────────────────

interface CreateProjectDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function CreateProjectDialog({ isOpen, onClose }: CreateProjectDialogProps) {
  const { createProject } = useProjectsStore()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [type, setType] = useState<ProjectTypeKey>('software-development')
  const [summary, setSummary] = useState('')

  const reset = () => {
    setName('')
    setKey('')
    setType('software-development')
    setSummary('')
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleSubmit = () => {
    if (!name.trim()) return
    createProject({ name: name.trim(), key: key.trim() || undefined, type, summary })
    handleClose()
  }

  return (
    <Dialog open={isOpen} onClose={handleClose}>
      <DialogHeader 
        icon={<FolderKanban className="w-5 h-5" />}
        title="Create Project"
        subtitle="Start a new project to organize your work"
        onClose={handleClose}
      />
      
      <div className="p-6 space-y-5">
        {/* Project Name */}
        <FormField label="Project Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Website Redesign"
            autoFocus
            className={inputClasses}
          />
        </FormField>

        {/* Key & Type Row */}
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Key (optional)">
            <input
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              placeholder="PROJ"
              className={inputClasses}
            />
          </FormField>
          <FormField label="Project Type">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ProjectTypeKey)}
              className={selectClasses}
            >
              {Object.values(PROJECT_TYPE_SCHEMES).map((scheme) => (
                <option key={scheme.key} value={scheme.key}>
                  {scheme.label}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        {/* Summary */}
        <FormField label="Summary">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Briefly describe what this project is about..."
            rows={3}
            className={cn(inputClasses, "resize-none")}
          />
        </FormField>
      </div>

      <DialogFooter
        onCancel={handleClose}
        onConfirm={handleSubmit}
        confirmText="Create Project"
        confirmDisabled={!name.trim()}
      />
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

export function CreateIssueDialog({
  isOpen,
  onClose,
  projectId,
  parentId,
  initialStatus,
  initialType,
  allowParentSelection = false,
}: CreateIssueDialogProps) {
  const { projects, issues, people, createIssue } = useProjectsStore()
  const [selectedProjectId, setSelectedProjectId] = useState(projectId || projects[0]?.id || '')
  const [selectedType, setSelectedType] = useState<IssueTypeKey>(initialType || 'task')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<IssueStatus>(initialStatus || 'backlog')
  const [priority, setPriority] = useState<IssuePriority>('medium')
  const [assignee, setAssignee] = useState<string>('')
  const [dueDate, setDueDate] = useState('')
  const [parent, setParent] = useState<string | null>(parentId ?? null)
  const [error, setError] = useState<string | null>(null)

  const selectedProject = projects.find((p) => p.id === selectedProjectId)
  const scheme = selectedProject ? PROJECT_TYPE_SCHEMES[selectedProject.type] : null

  const allowedTypes = useMemo(() => {
    if (!scheme) return []
    if (parent) {
      const parentIssue = issues.find((issue) => issue.id === parent)
      if (!parentIssue) return []
      return projectSelectors.getAllowedChildTypes(parentIssue.type)
    }
    return scheme.issueTypes.filter((type) => projectSelectors.isRootTypeAllowed(type))
  }, [scheme, parent, issues])

  const parentOptions = useMemo(() => {
    if (!selectedProject) return []
    const requiredParentType = STANDARD_PARENT_BY_CHILD[selectedType]
    if (!allowParentSelection || !requiredParentType) return []
    return issues.filter((issue) =>
      issue.projectId === selectedProject.id &&
      issue.type === requiredParentType
    )
  }, [selectedProject, selectedType, issues, allowParentSelection])

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
    setParent(parentId ?? null)
    setError(null)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleSubmit = () => {
    if (!title.trim()) {
      setError('Title is required.')
      return
    }

    const result = createIssue({
      projectId: selectedProjectId,
      title: title.trim(),
      type: selectedType,
      description: description.trim(),
      status,
      priority,
      assignees: assignee ? [assignee] : [],
      dueDate: dueDate || undefined,
      parentId: parent || undefined,
    })

    if (result.error) {
      setError(result.error)
      return
    }

    handleClose()
  }

  return (
    <Dialog open={isOpen} onClose={handleClose} size="lg">
      <DialogHeader 
        icon={<CheckSquare className="w-5 h-5" />}
        title="Create Issue"
        subtitle="Add a new issue to track your work"
        onClose={handleClose}
      />
      
      <div className="p-6 space-y-5">
        {/* Project & Type Row */}
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Project">
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className={selectClasses}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
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
                  {ISSUE_TYPE_CONFIG[type]?.label ?? type}
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
                  {issue.id} - {issue.title}
                </option>
              ))}
            </select>
          </FormField>
        )}

        {/* Title */}
        <FormField label="Title">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Issue title"
            autoFocus
            className={inputClasses}
          />
        </FormField>

        {/* Description */}
        <FormField label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the issue..."
            rows={3}
            className={cn(inputClasses, "resize-none")}
          />
        </FormField>

        {/* Status & Priority Row */}
        <div className="grid grid-cols-2 gap-4">
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
        <div className="grid grid-cols-2 gap-4">
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
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={inputClasses}
            />
          </FormField>
        </div>

        {/* Error */}
        {error && (
          <div className={cn(
            "rounded-lg px-4 py-3 text-body-sm",
            "bg-rose-500/10 text-rose-600 dark:text-rose-400",
            "border border-rose-500/20"
          )}>
            {error}
          </div>
        )}
      </div>

      <DialogFooter
        onCancel={handleClose}
        onConfirm={handleSubmit}
        confirmText="Create Issue"
        confirmDisabled={!title.trim()}
      />
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
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[200] bg-surface-900/50 dark:bg-surface-950/70 backdrop-blur-sm"
            onClick={onClose}
          />
          
          {/* Modal */}
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                "w-full",
                sizeClasses[size],
                "bg-surface-0 dark:bg-surface-900",
                "rounded-2xl",
                "border border-surface-200 dark:border-surface-800",
                "shadow-2xl shadow-surface-900/20",
                "overflow-hidden"
              )}
            >
              {children}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
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
      "flex items-start justify-between",
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
          <h2 className="text-lg font-semibold text-ink dark:text-ink-inverse">
            {title}
          </h2>
          {subtitle && (
            <p className="text-body-sm text-ink-muted dark:text-ink-inverse-muted">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      <button
        onClick={onClose}
        className={cn(
          "p-2 rounded-lg",
          "text-ink-muted hover:text-ink dark:hover:text-ink-inverse",
          "hover:bg-surface-200 dark:hover:bg-surface-800",
          "transition-colors"
        )}
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  )
}

interface DialogFooterProps {
  onCancel: () => void
  onConfirm: () => void
  confirmText: string
  confirmDisabled?: boolean
}

function DialogFooter({ onCancel, onConfirm, confirmText, confirmDisabled }: DialogFooterProps) {
  return (
    <div className={cn(
      "flex items-center justify-end gap-3",
      "px-6 py-4",
      "border-t border-surface-200 dark:border-surface-800",
      "bg-surface-50/50 dark:bg-surface-850/50"
    )}>
      <button
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
      </button>
      <button
        onClick={onConfirm}
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
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FORM COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
        {label}
      </label>
      {children}
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
  subtask: 'task',
}
