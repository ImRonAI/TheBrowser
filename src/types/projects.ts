export type ProjectTypeKey =
  | 'software-development'
  | 'work-operations'
  | 'founder'
  | 'academic'
  | 'research'
  | 'data-accrual'
  | 'personal-goals'
  | 'product-discovery'

export type IssueTypeKey = 'initiative' | 'epic' | 'story' | 'task' | 'bug' | 'subtask' | (string & {})
export type IssueStatus = 'backlog' | 'in-progress' | 'review' | 'blocked' | 'done'
export type IssuePriority = 'critical' | 'high' | 'medium' | 'low'

export type ProjectFieldType = 'text' | 'rich-text' | 'number' | 'currency' | 'checkbox' | 'date' | 'datetime' | 'single-select' | 'multi-select' | 'person' | 'url' | 'issue'
export interface ProjectField {
  key: string
  label: string
  type: ProjectFieldType
  options?: string[]
  required?: boolean
  archived?: boolean
  issueTypes?: string[]
  default?: unknown
  [key: string]: unknown
}

export interface Person {
  id: string
  name: string
  initials: string
  avatar?: string
  title?: string
}

/** Ron, the built-in agent. A fixed UUID so it fits the uuid[] assignees column. Mirrors RON_ASSIGNEE_ID in agent/api/core/projects.py. */
export const RON_ASSIGNEE: Person = { id: '004d28ef-3a52-540d-96ea-ff0627040b8e', name: 'Ren (agent)', initials: 'R' }

export interface ProjectTypeScheme {
  key: ProjectTypeKey
  label: string
  description: string
  issueTypes: IssueTypeKey[]
  boardIssueTypes: IssueTypeKey[]
  statuses: IssueStatus[]
  estimateUnit: 'points' | 'hours' | 'effort' | 'items'
  isDiscovery?: boolean
}

export interface Project {
  id: string
  version: number
  lifecycle: 'active' | 'paused' | 'completed' | 'archived'
  key: string
  name: string
  type: ProjectTypeKey
  ownerId?: string
  summary?: string
  createdAt: number
  updatedAt: number
  settings: {
    allowCrossProjectParents: boolean
    issueTypes?: { key: IssueTypeKey; label: string; level: number }[]
    fields?: ProjectField[]
    [key: string]: unknown
  }
}

export interface Issue {
  id: string
  number: number
  version: number
  customFields: Record<string, unknown>
  workProducts: Record<string, unknown>[]
  /** The issue's Context section (`issues.context`): entries sent from the Context widget. */
  context: Record<string, unknown>[]
  projectId: string
  type: IssueTypeKey
  parentId?: string | null
  title: string
  description?: string
  status: IssueStatus
  priority: IssuePriority
  estimate?: number
  assignees: string[]
  labels: string[]
  startDate?: string
  endDate?: string
  dueDate?: string
  createdBy?: string
  createdAt: number
  updatedAt: number
  rank: number
}

export type IssueLinkType = 'blocks' | 'enables' | 'implements' | 'fixes' | 'duplicates' | 'discovers' | 'relates'

export interface IssueLink {
  id: string
  sourceId: string
  targetId: string
  type: IssueLinkType
  createdAt: number
  createdBy?: string
}

export interface ActivityLogEntry {
  id: string
  projectId: string
  issueId?: string
  actorId?: string
  actorName?: string
  actorType: 'user' | 'system' | 'ai'
  timestamp: number
  action: string
  field?: string
  oldValue?: string | number | null
  newValue?: string | number | null
}

export const STANDARD_HIERARCHY: Record<IssueTypeKey, IssueTypeKey | null> = {
  initiative: 'epic',
  epic: 'story',
  story: 'task',
  task: 'subtask',
  bug: 'subtask',
  subtask: null,
}

export const ROOT_ISSUE_TYPES: IssueTypeKey[] = ['initiative', 'epic', 'story', 'task', 'bug']

export const PROJECT_TYPE_SCHEMES: Record<ProjectTypeKey, ProjectTypeScheme> = {
  'software-development': {
    key: 'software-development',
    label: 'Software Development',
    description: 'Ship software with a structured delivery workflow.',
    issueTypes: ['initiative', 'epic', 'story', 'task', 'subtask'],
    boardIssueTypes: ['task', 'story'],
    statuses: ['backlog', 'in-progress', 'review', 'blocked', 'done'],
    estimateUnit: 'points',
  },
  'work-operations': {
    key: 'work-operations',
    label: 'Work (Operations)',
    description: 'Operational work and cross-functional execution.',
    issueTypes: ['initiative', 'epic', 'story', 'task', 'subtask'],
    boardIssueTypes: ['task'],
    statuses: ['backlog', 'in-progress', 'review', 'blocked', 'done'],
    estimateUnit: 'hours',
  },
  founder: {
    key: 'founder',
    label: 'Founder',
    description: 'Strategic initiatives, fundraising, and company building.',
    issueTypes: ['initiative', 'epic', 'story', 'task', 'subtask'],
    boardIssueTypes: ['task', 'story'],
    statuses: ['backlog', 'in-progress', 'review', 'blocked', 'done'],
    estimateUnit: 'effort',
  },
  academic: {
    key: 'academic',
    label: 'Academic',
    description: 'Research, coursework, and academic project work.',
    issueTypes: ['initiative', 'epic', 'story', 'task', 'subtask'],
    boardIssueTypes: ['task'],
    statuses: ['backlog', 'in-progress', 'review', 'blocked', 'done'],
    estimateUnit: 'hours',
  },
  research: {
    key: 'research',
    label: 'Research',
    description: 'Research tracks, experiments, and analysis.',
    issueTypes: ['initiative', 'epic', 'story', 'task', 'subtask'],
    boardIssueTypes: ['story', 'task'],
    statuses: ['backlog', 'in-progress', 'review', 'blocked', 'done'],
    estimateUnit: 'effort',
  },
  'data-accrual': {
    key: 'data-accrual',
    label: 'Data Accrual',
    description: 'Data collection and pipeline build-out.',
    issueTypes: ['initiative', 'epic', 'story', 'task', 'subtask'],
    boardIssueTypes: ['task'],
    statuses: ['backlog', 'in-progress', 'review', 'blocked', 'done'],
    estimateUnit: 'items',
  },
  'personal-goals': {
    key: 'personal-goals',
    label: 'Personal Goals',
    description: 'Personal milestones and structured self-management.',
    issueTypes: ['initiative', 'epic', 'story', 'task', 'subtask'],
    boardIssueTypes: ['task'],
    statuses: ['backlog', 'in-progress', 'review', 'blocked', 'done'],
    estimateUnit: 'effort',
  },
  'product-discovery': {
    key: 'product-discovery',
    label: 'Product Discovery',
    description: 'Discovery workflow. Specialized hierarchy coming in PRD 2.',
    issueTypes: ['initiative', 'epic', 'story', 'task', 'subtask'],
    boardIssueTypes: ['story', 'task'],
    statuses: ['backlog', 'in-progress', 'review', 'blocked', 'done'],
    estimateUnit: 'effort',
    isDiscovery: true,
  },
}

export const ISSUE_TYPE_CONFIG: Record<IssueTypeKey, { label: string; level: number; color: string }> = {
  initiative: { label: 'Initiative', level: 1, color: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' },
  epic: { label: 'Epic', level: 2, color: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  story: { label: 'Story', level: 3, color: 'bg-purple-500/15 text-purple-700 dark:text-purple-300' },
  task: { label: 'Task', level: 4, color: 'bg-indigo-400/15 text-indigo-600 dark:text-indigo-400' },
  bug: { label: 'Bug', level: 4, color: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  subtask: { label: 'Subtask', level: 5, color: 'bg-surface-300/50 text-surface-600 dark:text-surface-400' },
}

export const ISSUE_STATUS_CONFIG: Record<IssueStatus, { label: string; color: string }> = {
  backlog: { label: 'Backlog', color: 'bg-surface-200 text-ink dark:bg-surface-800 dark:text-ink-inverse' },
  'in-progress': { label: 'In Progress', color: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' },
  review: { label: 'Review', color: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  blocked: { label: 'Blocked', color: 'bg-purple-500/15 text-purple-700 dark:text-purple-300' },
  done: { label: 'Done', color: 'bg-indigo-600/15 text-indigo-700 dark:text-indigo-300' },
}

export const ISSUE_PRIORITY_CONFIG: Record<IssuePriority, { label: string; color: string }> = {
  critical: { label: 'Critical', color: 'bg-violet-600/20 text-violet-700 dark:text-violet-300' },
  high: { label: 'High', color: 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' },
  medium: { label: 'Medium', color: 'bg-indigo-400/20 text-indigo-600 dark:text-indigo-400' },
  low: { label: 'Low', color: 'bg-surface-400/20 text-surface-600 dark:text-surface-400' },
}

export const ISSUE_LINK_INVERSE: Record<IssueLinkType, string> = {
  blocks: 'blocked by',
  enables: 'enabled by',
  implements: 'implemented by',
  fixes: 'fixed by',
  discovers: 'discovered by',
  relates: 'relates',
  duplicates: 'duplicates',
}

export const INTERNAL_PROJECT_VIEWS = ['dashboard', 'backlog', 'board', 'list', 'calendar', 'timeline', 'docs', 'settings'] as const
export type ProjectView = typeof INTERNAL_PROJECT_VIEWS[number]
