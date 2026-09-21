import { useMemo, useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useProjectsStore, projectUtils } from '@/stores/projectsStore'
import {
  IssueLinkType,
  IssuePriority,
  IssueStatus,
  IssueTypeKey,
  ISSUE_PRIORITY_CONFIG,
  ISSUE_STATUS_CONFIG,
  ISSUE_TYPE_CONFIG,
} from '@/types/projects'
import { IssueCard } from './IssueCard'
import { IssuePriorityBadge, IssueStatusBadge, IssueTypeBadge } from './badges'
import { CreateIssueDialog } from './dialogs'
import { cn } from '@/utils/cn'

const TABS = ['overview', 'sub-items', 'relationships', 'docs', 'ron', 'activity'] as const

type DrawerTab = typeof TABS[number]

interface IssueDrawerProps {
  issueId: string
  onClose: () => void
}

export function IssueDrawer({ issueId, onClose }: IssueDrawerProps) {
  const {
    issues,
    issueLinks,
    activity,
    projects,
    people,
    updateIssue,
    addIssueLink,
    removeIssueLink,
  } = useProjectsStore()
  const issue = issues.find((item) => item.id === issueId)
  const project = issue ? projects.find((p) => p.id === issue.projectId) : undefined
  const [activeTab, setActiveTab] = useState<DrawerTab>('overview')
  const [showCreateChild, setShowCreateChild] = useState(false)
  const [showRelationshipForm, setShowRelationshipForm] = useState(false)
  const [relationshipType, setRelationshipType] = useState<IssueLinkType>('blocks')
  const [relationshipTarget, setRelationshipTarget] = useState('')
  const [titleDraft, setTitleDraft] = useState(issue?.title || '')
  const [descriptionDraft, setDescriptionDraft] = useState(issue?.description || '')

  useEffect(() => {
    if (!issue) return
    setTitleDraft(issue.title)
    setDescriptionDraft(issue.description || '')
  }, [issue?.id])

  const childIssues = useMemo(() => {
    if (!issue) return []
    return issues.filter((item) => item.parentId === issue.id)
  }, [issues, issue])

  const relationships = useMemo(() => {
    if (!issue) return []
    return issueLinks.filter((link) => link.sourceId === issue.id)
  }, [issueLinks, issue])

  const availableTargets = useMemo(() => {
    if (!issue) return []
    return issues.filter((item) => item.id !== issue.id && item.projectId === issue.projectId)
  }, [issues, issue])

  const activityLog = useMemo(() => {
    if (!issue) return []
    return activity.filter((entry) => entry.issueId === issue.id)
  }, [activity, issue])

  if (!issue || !project) return null

  const handleTitleBlur = () => {
    if (titleDraft.trim() && titleDraft.trim() !== issue.title) {
      updateIssue(issue.id, { title: titleDraft.trim() })
    }
  }

  const handleDescriptionBlur = () => {
    if (descriptionDraft !== (issue.description || '')) {
      updateIssue(issue.id, { description: descriptionDraft })
    }
  }

  const toggleAssignee = (personId: string) => {
    const exists = issue.assignees.includes(personId)
    const next = exists ? issue.assignees.filter((id) => id !== personId) : [...issue.assignees, personId]
    updateIssue(issue.id, { assignees: next })
  }

  const handleRelationshipAdd = () => {
    if (!relationshipTarget) return
    addIssueLink(issue.id, relationshipTarget, relationshipType)
    setRelationshipTarget('')
    setShowRelationshipForm(false)
  }

  return (
    <div className="fixed inset-0 z-[120] flex justify-end bg-black/30 backdrop-blur-sm">
      <div className="w-full max-w-3xl h-full bg-surface-0 dark:bg-surface-950 shadow-2xl flex flex-col">
        <div className="flex items-start justify-between px-8 pt-8 pb-4 border-b border-surface-200 dark:border-surface-800">
          <div>
            <div className="flex items-center gap-3">
              <IssueTypeBadge type={issue.type} />
              <IssueStatusBadge status={issue.status} />
              <IssuePriorityBadge priority={issue.priority} />
            </div>
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleTitleBlur}
              className="mt-4 w-full bg-transparent text-2xl font-semibold text-ink dark:text-ink-inverse outline-none"
            />
            <p className="mt-2 text-body-xs text-ink-muted dark:text-ink-inverse-muted">
              {project.name} · {project.key}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800"
          >
            <X className="w-5 h-5 text-ink-muted dark:text-ink-inverse-muted" />
          </button>
        </div>

        <div className="px-8 pt-4">
          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-wider transition',
                  activeTab === tab
                    ? 'bg-ink text-white dark:bg-ink-inverse dark:text-ink'
                    : 'bg-surface-100 text-ink-muted dark:bg-surface-800 dark:text-ink-inverse-muted'
                )}
              >
                {tab.replace('-', ' ')}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto px-8 py-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <section className="grid grid-cols-2 gap-4">
                <Field label="Status">
                  <select
                    value={issue.status}
                    onChange={(e) => updateIssue(issue.id, { status: e.target.value as IssueStatus })}
                    className="w-full rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-0 dark:bg-surface-900 px-3 py-2 text-body-sm"
                  >
                    {Object.keys(ISSUE_STATUS_CONFIG).map((key) => (
                      <option key={key} value={key}>
                        {ISSUE_STATUS_CONFIG[key as IssueStatus].label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Priority">
                  <select
                    value={issue.priority}
                    onChange={(e) => updateIssue(issue.id, { priority: e.target.value as IssuePriority })}
                    className="w-full rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-0 dark:bg-surface-900 px-3 py-2 text-body-sm"
                  >
                    {Object.keys(ISSUE_PRIORITY_CONFIG).map((key) => (
                      <option key={key} value={key}>
                        {ISSUE_PRIORITY_CONFIG[key as IssuePriority].label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Due Date">
                  <input
                    type="date"
                    value={issue.dueDate ? issue.dueDate.slice(0, 10) : ''}
                    onChange={(e) => updateIssue(issue.id, { dueDate: e.target.value || undefined })}
                    className="w-full rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-0 dark:bg-surface-900 px-3 py-2 text-body-sm"
                  />
                </Field>
                <Field label="Type">
                  <select
                    value={issue.type}
                    onChange={(e) => updateIssue(issue.id, { type: e.target.value as IssueTypeKey })}
                    className="w-full rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-0 dark:bg-surface-900 px-3 py-2 text-body-sm"
                  >
                    {projectUtils.getProjectScheme(project).issueTypes.map((type) => (
                      <option key={type} value={type}>
                        {ISSUE_TYPE_CONFIG[type].label}
                      </option>
                    ))}
                  </select>
                </Field>
              </section>

              <section>
                <Field label="Description">
                  <textarea
                    value={descriptionDraft}
                    onChange={(e) => setDescriptionDraft(e.target.value)}
                    onBlur={handleDescriptionBlur}
                    className="w-full min-h-[140px] rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-0 dark:bg-surface-900 px-3 py-2 text-body-sm"
                  />
                </Field>
              </section>

              <section>
                <Field label="Assignees">
                  <div className="flex flex-wrap gap-2">
                    {people.map((person) => (
                      <button
                        key={person.id}
                        onClick={() => toggleAssignee(person.id)}
                        className={cn(
                          'px-3 py-2 rounded-full text-[11px] uppercase tracking-wider font-semibold border',
                          issue.assignees.includes(person.id)
                            ? 'bg-ink text-white border-ink dark:bg-ink-inverse dark:text-ink'
                            : 'border-surface-200 dark:border-surface-800 text-ink-muted dark:text-ink-inverse-muted'
                        )}
                      >
                        {person.name}
                      </button>
                    ))}
                  </div>
                </Field>
              </section>
            </div>
          )}

          {activeTab === 'sub-items' && (
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">Children</h3>
                <button
                  onClick={() => setShowCreateChild(true)}
                  className="text-body-xs font-semibold text-accent dark:text-accent-light"
                >
                  Add child
                </button>
              </div>
              <div className="mt-4 space-y-3">
                {childIssues.length === 0 ? (
                  <p className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">No sub-items yet.</p>
                ) : (
                  childIssues.map((child) => (
                    <IssueCard key={child.id} issue={child} compact />
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'relationships' && (
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-body-sm font-semibold text-ink dark:text-ink-inverse">Links</h3>
                <button
                  onClick={() => setShowRelationshipForm((prev) => !prev)}
                  className="text-body-xs font-semibold text-accent dark:text-accent-light"
                >
                  {showRelationshipForm ? 'Cancel' : 'Add relationship'}
                </button>
              </div>

              {showRelationshipForm && (
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <select
                    value={relationshipType}
                    onChange={(e) => setRelationshipType(e.target.value as IssueLinkType)}
                    className="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-0 dark:bg-surface-900 px-3 py-2 text-body-sm"
                  >
                    <option value="blocks">Blocks</option>
                    <option value="blocked-by">Blocked by</option>
                    <option value="relates">Relates to</option>
                    <option value="duplicates">Duplicates</option>
                  </select>
                  <select
                    value={relationshipTarget}
                    onChange={(e) => setRelationshipTarget(e.target.value)}
                    className="col-span-2 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-0 dark:bg-surface-900 px-3 py-2 text-body-sm"
                  >
                    <option value="">Select issue</option>
                    {availableTargets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.title}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleRelationshipAdd}
                    className="col-span-3 mt-2 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-body-xs font-semibold text-accent"
                  >
                    Add link
                  </button>
                </div>
              )}

              <div className="mt-6 space-y-3">
                {relationships.length === 0 ? (
                  <p className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">No relationships yet.</p>
                ) : (
                  relationships.map((link) => {
                    const target = issues.find((item) => item.id === link.targetId)
                    if (!target) return null
                    return (
                      <div key={link.id} className="flex items-center justify-between rounded-xl border border-surface-200 dark:border-surface-800 px-3 py-2">
                        <div>
                          <p className="text-body-xs font-semibold text-ink dark:text-ink-inverse">
                            {link.type.replace('-', ' ')} · {target.title}
                          </p>
                          <p className="text-[11px] text-ink-muted dark:text-ink-inverse-muted">
                            {ISSUE_TYPE_CONFIG[target.type].label}
                          </p>
                        </div>
                        <button
                          onClick={() => removeIssueLink(link.id)}
                          className="text-body-xs text-rose-500"
                        >
                          Remove
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === 'docs' && (
            <div className="rounded-2xl border border-dashed border-surface-200 dark:border-surface-800 p-6 text-body-sm text-ink-muted dark:text-ink-inverse-muted">
              Docs shell. Link project docs here.
            </div>
          )}

          {activeTab === 'ron' && (
            <div className="rounded-2xl border border-dashed border-surface-200 dark:border-surface-800 p-6 text-body-sm text-ink-muted dark:text-ink-inverse-muted">
              Ron tab shell. Agent cockpit will appear here.
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="space-y-3">
              {activityLog.length === 0 ? (
                <p className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">No activity yet.</p>
              ) : (
                activityLog.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-surface-200 dark:border-surface-800 p-4">
                    <p className="text-body-xs font-semibold text-ink dark:text-ink-inverse">
                      {entry.actorName || 'System'} · {entry.action}
                    </p>
                    {entry.field && (
                      <p className="mt-2 text-[11px] text-ink-muted dark:text-ink-inverse-muted">
                        {entry.field}: {entry.oldValue ?? '—'} → {entry.newValue ?? '—'}
                      </p>
                    )}
                    <p className="mt-2 text-[11px] uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
                      {new Date(entry.timestamp).toLocaleString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <CreateIssueDialog
        isOpen={showCreateChild}
        onClose={() => setShowCreateChild(false)}
        projectId={issue.projectId}
        parentId={issue.id}
      />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
        {label}
      </label>
      <div className="mt-2">{children}</div>
    </div>
  )
}
