import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  ActivityLogEntry,
  Issue,
  IssueLink,
  IssueLinkType,
  IssueStatus,
  IssueTypeKey,
  Person,
  Project,
  ProjectTypeKey,
  PROJECT_TYPE_SCHEMES,
  ROOT_ISSUE_TYPES,
  STANDARD_HIERARCHY,
  ISSUE_LINK_INVERSE,
} from '@/types/projects'
import { useAuthStore } from '@/stores/authStore'
import { supabase, isSupabaseConfigured } from '@/api/supabase'

type CreateIssueInput = Partial<Omit<Issue, 'id' | 'createdAt' | 'updatedAt' | 'rank'>> & {
  projectId: string
  title: string
  type: IssueTypeKey
}

type CreateIssueResult = { issue: Issue | null; error?: string }

type ProjectState = {
  projects: Project[]
  issues: Issue[]
  issueLinks: IssueLink[]
  activity: ActivityLogEntry[]
  people: Person[]
  isInitialized: boolean
  isLoading: boolean
  initialize: () => Promise<void>
  refreshFromServer: () => Promise<void>
  createProject: (input: Partial<Project> & { name: string; type: ProjectTypeKey }) => Project
  updateProject: (projectId: string, updates: Partial<Project>) => void
  createIssue: (input: CreateIssueInput) => CreateIssueResult
  updateIssue: (issueId: string, updates: Partial<Issue>) => CreateIssueResult
  moveIssueStatus: (issueId: string, status: IssueStatus) => CreateIssueResult
  reparentIssue: (issueId: string, newParentId: string | null) => CreateIssueResult
  moveIssueInParent: (issueId: string, direction: 'up' | 'down') => void
  swapIssueRank: (sourceId: string, targetId: string) => void
  addIssueLink: (sourceId: string, targetId: string, type: IssueLinkType) => void
  removeIssueLink: (linkId: string) => void
  logActivity: (entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>) => void
}

type SupabaseTable = 'projects' | 'issues' | 'issue_links' | 'activity_log'

const tableAvailability: Record<SupabaseTable, boolean | null> = {
  projects: null,
  issues: null,
  issue_links: null,
  activity_log: null,
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const status = (error as { status?: number }).status
  const code = (error as { code?: string }).code
  const message = (error as { message?: string }).message
  return (
    status === 404 ||
    code === '42P01' ||
    message?.includes('does not exist') === true ||
    message?.includes('relation') === true
  )
}

function shouldQueryTable(table: SupabaseTable): boolean {
  return tableAvailability[table] !== false
}

function markTableAvailable(table: SupabaseTable) {
  tableAvailability[table] = true
}

function handleTableError(table: SupabaseTable, error: unknown): boolean {
  if (isMissingTableError(error)) {
    if (tableAvailability[table] !== false) {
      console.warn(`[Supabase] Table "${table}" unavailable. Skipping further queries.`)
    }
    tableAvailability[table] = false
    return true
  }
  return false
}

const now = Date.now()

const seedPeople: Person[] = [
  { id: 'user-1', name: 'Tim Hunter', initials: 'TH', title: 'Owner' },
  { id: 'user-2', name: 'Alex Chen', initials: 'AC', title: 'Builder' },
  { id: 'user-3', name: 'Sarah Kim', initials: 'SK', title: 'Research' },
  { id: 'user-4', name: 'Emma Liu', initials: 'EL', title: 'Operations' },
]

const seedProjects: Project[] = [
  {
    id: 'project-ron',
    key: 'RON',
    name: 'Ron Browser Core',
    type: 'software-development',
    ownerId: 'user-1',
    summary: 'Deliver the core browser + AI agent experience.',
    createdAt: now - 1000 * 60 * 60 * 24 * 30,
    updatedAt: now - 1000 * 60 * 60 * 4,
    settings: {
      allowCrossProjectParents: false,
    },
  },
  {
    id: 'project-research',
    key: 'RES',
    name: 'AI Browser Research',
    type: 'research',
    ownerId: 'user-3',
    summary: 'Competitive analysis and research backlog.',
    createdAt: now - 1000 * 60 * 60 * 24 * 14,
    updatedAt: now - 1000 * 60 * 60 * 2,
    settings: {
      allowCrossProjectParents: false,
    },
  },
  {
    id: 'project-founder',
    key: 'FND',
    name: 'Founder Operations',
    type: 'founder',
    ownerId: 'user-1',
    summary: 'Fundraising, hiring, and operational initiatives.',
    createdAt: now - 1000 * 60 * 60 * 24 * 45,
    updatedAt: now - 1000 * 60 * 60 * 8,
    settings: {
      allowCrossProjectParents: false,
    },
  },
]

const seedIssues: Issue[] = [
  {
    id: 'iss-ron-1',
    projectId: 'project-ron',
    type: 'initiative',
    title: 'Core Browser Experience',
    description: 'Ship the browser core, execute hub, and agent cockpit.',
    status: 'in-progress',
    priority: 'high',
    estimate: 13,
    assignees: ['user-1'],
    labels: ['core'],
    startDate: new Date(now - 1000 * 60 * 60 * 24 * 7).toISOString(),
    endDate: new Date(now + 1000 * 60 * 60 * 24 * 45).toISOString(),
    dueDate: new Date(now + 1000 * 60 * 60 * 24 * 30).toISOString(),
    createdAt: now - 1000 * 60 * 60 * 24 * 12,
    updatedAt: now - 1000 * 60 * 30,
    rank: 1000,
  },
  {
    id: 'iss-ron-2',
    projectId: 'project-ron',
    type: 'epic',
    parentId: 'iss-ron-1',
    title: 'Project Management Core',
    description: 'Projects, backlog, board, list, and timeline.',
    status: 'in-progress',
    priority: 'high',
    estimate: 8,
    assignees: ['user-2'],
    labels: ['execute', 'projects'],
    startDate: new Date(now - 1000 * 60 * 60 * 24 * 5).toISOString(),
    endDate: new Date(now + 1000 * 60 * 60 * 24 * 20).toISOString(),
    dueDate: new Date(now + 1000 * 60 * 60 * 24 * 18).toISOString(),
    createdAt: now - 1000 * 60 * 60 * 24 * 10,
    updatedAt: now - 1000 * 60 * 60 * 3,
    rank: 1100,
  },
  {
    id: 'iss-ron-3',
    projectId: 'project-ron',
    type: 'story',
    parentId: 'iss-ron-2',
    title: 'Execute hub replaces Tasks',
    description: 'Build a global execution hub with filters and quick create.',
    status: 'in-progress',
    priority: 'high',
    estimate: 5,
    assignees: ['user-1', 'user-2'],
    labels: ['execute'],
    startDate: new Date(now - 1000 * 60 * 60 * 24 * 2).toISOString(),
    endDate: new Date(now + 1000 * 60 * 60 * 24 * 7).toISOString(),
    dueDate: new Date(now + 1000 * 60 * 60 * 24 * 6).toISOString(),
    createdAt: now - 1000 * 60 * 60 * 24 * 6,
    updatedAt: now - 1000 * 60 * 60,
    rank: 1200,
  },
  {
    id: 'iss-ron-4',
    projectId: 'project-ron',
    type: 'task',
    parentId: 'iss-ron-3',
    title: 'Design Execute filters',
    description: 'Project, status, assignee, due date filters.',
    status: 'review',
    priority: 'medium',
    estimate: 3,
    assignees: ['user-4'],
    labels: ['ui'],
    dueDate: new Date(now + 1000 * 60 * 60 * 24 * 2).toISOString(),
    createdAt: now - 1000 * 60 * 60 * 24 * 5,
    updatedAt: now - 1000 * 60 * 60 * 4,
    rank: 1300,
  },
  {
    id: 'iss-ron-5',
    projectId: 'project-ron',
    type: 'subtask',
    parentId: 'iss-ron-4',
    title: 'Implement status quick filter chips',
    status: 'blocked',
    priority: 'medium',
    estimate: 1,
    assignees: ['user-4'],
    labels: ['ui'],
    createdAt: now - 1000 * 60 * 60 * 24 * 3,
    updatedAt: now - 1000 * 60 * 60 * 2,
    rank: 1400,
  },
  {
    id: 'iss-res-1',
    projectId: 'project-research',
    type: 'initiative',
    title: 'AI Browser Landscape',
    description: 'Track competitive features and market signals.',
    status: 'in-progress',
    priority: 'medium',
    estimate: 8,
    assignees: ['user-3'],
    labels: ['research'],
    startDate: new Date(now - 1000 * 60 * 60 * 24 * 9).toISOString(),
    endDate: new Date(now + 1000 * 60 * 60 * 24 * 21).toISOString(),
    createdAt: now - 1000 * 60 * 60 * 24 * 9,
    updatedAt: now - 1000 * 60 * 60 * 5,
    rank: 1000,
  },
  {
    id: 'iss-res-2',
    projectId: 'project-research',
    type: 'epic',
    parentId: 'iss-res-1',
    title: 'Product Intelligence Sprints',
    status: 'backlog',
    priority: 'medium',
    estimate: 5,
    assignees: ['user-3'],
    labels: ['intel'],
    createdAt: now - 1000 * 60 * 60 * 24 * 7,
    updatedAt: now - 1000 * 60 * 60 * 7,
    rank: 1100,
  },
  {
    id: 'iss-res-3',
    projectId: 'project-research',
    type: 'story',
    parentId: 'iss-res-2',
    title: 'Deep dive on Arc and Sigma',
    status: 'backlog',
    priority: 'high',
    estimate: 3,
    assignees: ['user-3'],
    labels: ['competitive'],
    createdAt: now - 1000 * 60 * 60 * 24 * 6,
    updatedAt: now - 1000 * 60 * 60 * 6,
    rank: 1200,
  },
  {
    id: 'iss-res-4',
    projectId: 'project-research',
    type: 'task',
    parentId: 'iss-res-3',
    title: 'Compile Arc workspace features',
    status: 'in-progress',
    priority: 'medium',
    estimate: 2,
    assignees: ['user-3'],
    labels: ['research'],
    dueDate: new Date(now + 1000 * 60 * 60 * 24 * 4).toISOString(),
    createdAt: now - 1000 * 60 * 60 * 24 * 4,
    updatedAt: now - 1000 * 60 * 30,
    rank: 1300,
  },
  {
    id: 'iss-fnd-1',
    projectId: 'project-founder',
    type: 'initiative',
    title: 'Fundraising Q2',
    description: 'Prep materials and outreach.',
    status: 'in-progress',
    priority: 'high',
    estimate: 10,
    assignees: ['user-1'],
    labels: ['fundraising'],
    startDate: new Date(now - 1000 * 60 * 60 * 24 * 14).toISOString(),
    endDate: new Date(now + 1000 * 60 * 60 * 24 * 60).toISOString(),
    createdAt: now - 1000 * 60 * 60 * 24 * 20,
    updatedAt: now - 1000 * 60 * 60 * 12,
    rank: 1000,
  },
]

const seedActivity: ActivityLogEntry[] = [
  {
    id: 'act-1',
    projectId: 'project-ron',
    issueId: 'iss-ron-3',
    actorId: 'user-2',
    actorName: 'Alex Chen',
    actorType: 'user',
    timestamp: now - 1000 * 60 * 60 * 2,
    action: 'Status changed',
    field: 'status',
    oldValue: 'backlog',
    newValue: 'in-progress',
  },
  {
    id: 'act-2',
    projectId: 'project-ron',
    issueId: 'iss-ron-4',
    actorId: 'user-4',
    actorName: 'Emma Liu',
    actorType: 'user',
    timestamp: now - 1000 * 60 * 45,
    action: 'Updated due date',
    field: 'dueDate',
    oldValue: null,
    newValue: new Date(now + 1000 * 60 * 60 * 24 * 2).toISOString(),
  },
  {
    id: 'act-3',
    projectId: 'project-research',
    issueId: 'iss-res-4',
    actorId: 'user-3',
    actorName: 'Sarah Kim',
    actorType: 'user',
    timestamp: now - 1000 * 60 * 20,
    action: 'Created issue',
  },
]

const getCurrentUser = () => {
  try {
    return useAuthStore.getState().user
  } catch {
    return null
  }
}

const getUserActor = () => {
  const user = getCurrentUser()
  if (!user) return { actorType: 'system' as const }
  return {
    actorType: 'user' as const,
    actorId: user.id,
    actorName: user.name,
  }
}

const getProjectScheme = (project: Project) => PROJECT_TYPE_SCHEMES[project.type]

const canParent = (parentType: IssueTypeKey, childType: IssueTypeKey) =>
  STANDARD_HIERARCHY[parentType] === childType

const isRootTypeAllowed = (type: IssueTypeKey) => ROOT_ISSUE_TYPES.includes(type)

const validateParentAssignment = (
  project: Project,
  issues: Issue[],
  childType: IssueTypeKey,
  parentId?: string | null
): string | null => {
  if (!parentId) {
    if (!isRootTypeAllowed(childType)) return 'Subtasks must have a parent.'
    return null
  }

  const parent = issues.find((issue) => issue.id === parentId)
  if (!parent) return 'Parent issue not found.'

  if (parent.projectId !== project.id && !project.settings.allowCrossProjectParents) {
    return 'Cross-project parenting is disabled for this project.'
  }

  if (!canParent(parent.type, childType)) {
    return `Invalid hierarchy: ${parent.type} cannot parent ${childType}.`
  }

  return null
}

const ensureTypeAllowed = (project: Project, type: IssueTypeKey): string | null => {
  const scheme = getProjectScheme(project)
  if (!scheme.issueTypes.includes(type)) {
    return `Issue type ${type} is not allowed in this project.`
  }
  return null
}

const nextRank = (issues: Issue[], projectId: string, parentId?: string | null) => {
  const siblings = issues.filter((issue) => issue.projectId === projectId && (issue.parentId || null) === (parentId || null))
  const maxRank = siblings.reduce((max, issue) => Math.max(max, issue.rank), 0)
  return maxRank + 100
}

const makeProjectKey = (name: string, existingKeys: string[]) => {
  const base = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 4) || 'PRJ'

  let key = base
  let counter = 2
  while (existingKeys.includes(key)) {
    key = `${base}${counter}`
    counter += 1
  }
  return key
}

const toTimestamp = (value?: string | number | null) => {
  if (!value) return Date.now()
  if (typeof value === 'number') return value
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Date.now() : parsed
}

const mapProjectRow = (row: any): Project => ({
  id: row.id,
  key: row.key || row.project_key,
  name: row.name,
  type: row.type || 'software-development',
  ownerId: row.owner_id || row.user_id,
  summary: row.summary || row.description || '',
  createdAt: toTimestamp(row.created_at),
  updatedAt: toTimestamp(row.updated_at),
  settings: row.settings || { allowCrossProjectParents: false },
})

const mapIssueRow = (row: any): Issue => ({
  id: row.id,
  projectId: row.project_id,
  parentId: row.parent_id ?? null,
  type: row.type,
  title: row.title,
  description: row.description || '',
  status: row.status || 'backlog',
  priority: row.priority || 'medium',
  estimate: row.estimate ?? undefined,
  assignees: row.assignees || [],
  labels: row.labels || [],
  startDate: row.start_date ?? undefined,
  endDate: row.end_date ?? undefined,
  dueDate: row.due_date ?? undefined,
  createdBy: row.created_by ?? undefined,
  createdAt: toTimestamp(row.created_at),
  updatedAt: toTimestamp(row.updated_at),
  rank: row.rank ?? 0,
})

const mapIssueLinkRow = (row: any): IssueLink => ({
  id: row.id,
  sourceId: row.source_id,
  targetId: row.target_id,
  type: row.type,
  createdAt: toTimestamp(row.created_at),
  createdBy: row.created_by ?? undefined,
})

const mapActivityRow = (row: any): ActivityLogEntry => ({
  id: row.id,
  projectId: row.project_id,
  issueId: row.issue_id ?? undefined,
  actorId: row.actor_id ?? undefined,
  actorName: row.actor_name ?? undefined,
  actorType: row.actor_type || 'user',
  timestamp: toTimestamp(row.timestamp),
  action: row.action,
  field: row.field ?? undefined,
  oldValue: row.old_value ?? null,
  newValue: row.new_value ?? null,
})

export const useProjectsStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: seedProjects,
      issues: seedIssues,
      issueLinks: [],
      activity: seedActivity,
      people: seedPeople,
      isInitialized: false,
      isLoading: false,

      initialize: async () => {
        if (get().isInitialized) return
        await get().refreshFromServer()
      },

      refreshFromServer: async () => {
        if (!isSupabaseConfigured()) {
          set({ isInitialized: true, isLoading: false })
          return
        }

        const user = getCurrentUser()
        if (!user) {
          set({ isInitialized: true, isLoading: false })
          return
        }

        set({ isLoading: true })
        try {
          const projectsRes = shouldQueryTable('projects')
            ? await supabase.from('projects').select('*').eq('user_id', user.id)
            : null

          let projectIds: string[] = []
          let visibleIssueIds: string[] = []
          let issuesRes: any | null = null
          let linksRes: any | null = null
          let activityRes: any | null = null

          if (projectsRes?.data) {
            projectIds = projectsRes.data.map((project: any) => project.id)
          }

          const [scopedIssuesRes, scopedActivityRes] = await Promise.all([
            shouldQueryTable('issues') && projectIds.length
              ? supabase.from('issues').select('*').in('project_id', projectIds)
              : Promise.resolve(null),
            shouldQueryTable('activity_log') && projectIds.length
              ? supabase.from('activity_log').select('*').in('project_id', projectIds)
              : Promise.resolve(null),
          ])
          issuesRes = scopedIssuesRes
          activityRes = scopedActivityRes

          if (issuesRes?.data) {
            visibleIssueIds = issuesRes.data.map((issue: any) => issue.id)
          }

          linksRes = shouldQueryTable('issue_links') && visibleIssueIds.length
            ? await supabase.from('issue_links').select('*').in('source_id', visibleIssueIds)
            : null
          const nextState: Partial<ProjectState> = {
            isInitialized: true,
            isLoading: false,
          }

          if (projectsRes) {
            if (projectsRes.error) {
              if (!handleTableError('projects', projectsRes.error)) {
                console.warn('Failed to load projects from Supabase:', projectsRes.error)
              }
            } else {
              markTableAvailable('projects')
              const projects = (projectsRes.data || []).map(mapProjectRow)
              nextState.projects = projects.length > 0 ? projects : []
            }
          }

          if (issuesRes) {
            if (issuesRes.error) {
              if (!handleTableError('issues', issuesRes.error)) {
                console.warn('Failed to load issues from Supabase:', issuesRes.error)
              }
            } else {
              markTableAvailable('issues')
              const issues = (issuesRes.data || []).map(mapIssueRow)
              nextState.issues = issues.length > 0 ? issues : []
            }
          }

          if (linksRes) {
            if (linksRes.error) {
              if (!handleTableError('issue_links', linksRes.error)) {
                console.warn('Failed to load issue links from Supabase:', linksRes.error)
              }
            } else {
              markTableAvailable('issue_links')
              const issueLinks = (linksRes.data || []).map(mapIssueLinkRow)
              nextState.issueLinks = issueLinks
            }
          }

          if (activityRes) {
            if (activityRes.error) {
              if (!handleTableError('activity_log', activityRes.error)) {
                console.warn('Failed to load activity log from Supabase:', activityRes.error)
              }
            } else {
              markTableAvailable('activity_log')
              const activity = (activityRes.data || []).map(mapActivityRow)
              nextState.activity = activity
            }
          }

          set(nextState)
        } catch (error) {
          console.error('Failed to load projects from Supabase:', error)
          set({ isInitialized: true, isLoading: false })
        }
      },

      createProject: (input) => {
        const state = get()
        const createdAt = Date.now()
        const key = input.key?.trim().toUpperCase() || makeProjectKey(input.name, state.projects.map((project) => project.key))
        const newProject: Project = {
          id: isSupabaseConfigured() ? crypto.randomUUID() : `project-${createdAt}`,
          key,
          name: input.name,
          type: input.type,
          ownerId: input.ownerId || getCurrentUser()?.id || seedPeople[0]?.id,
          summary: input.summary?.trim() || '',
          createdAt,
          updatedAt: createdAt,
          settings: {
            allowCrossProjectParents: input.settings?.allowCrossProjectParents ?? false,
          },
        }

        set((state) => ({
          projects: [newProject, ...state.projects],
        }))

        if (isSupabaseConfigured() && shouldQueryTable('projects')) {
          const user = getCurrentUser()
          if (user) {
            const row = {
              id: newProject.id,
              user_id: user.id,
              owner_id: newProject.ownerId || user.id,
              key: newProject.key,
              project_key: newProject.key,
              name: newProject.name,
              type: newProject.type,
              summary: newProject.summary,
              description: newProject.summary,
              settings: newProject.settings,
              created_at: new Date(newProject.createdAt).toISOString(),
              updated_at: new Date(newProject.updatedAt).toISOString(),
            }
            supabase.from('projects').upsert(row, { onConflict: 'id' }).then(({ error }) => {
              if (error) {
                if (!handleTableError('projects', error)) {
                  console.error('Failed to sync project:', error)
                }
              } else {
                markTableAvailable('projects')
              }
            })
          }
        }

        get().logActivity({
          projectId: newProject.id,
          actorType: 'user',
          actorId: newProject.ownerId,
          actorName: seedPeople.find((person) => person.id === newProject.ownerId)?.name,
          action: `Created project ${newProject.name}`,
        })

        return newProject
      },

      updateProject: (projectId, updates) => {
        const updatedProject = (() => {
          const current = get().projects.find((project) => project.id === projectId)
          if (!current) return null
          return {
            ...current,
            ...updates,
            settings: {
              ...current.settings,
              ...updates.settings,
            },
            updatedAt: Date.now(),
          }
        })()

        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === projectId
              ? {
                  ...project,
                  ...updates,
                  settings: {
                    ...project.settings,
                    ...updates.settings,
                  },
                  updatedAt: Date.now(),
                }
              : project
          ),
        }))

        if (updatedProject && isSupabaseConfigured() && shouldQueryTable('projects')) {
          const user = getCurrentUser()
          if (user) {
            const row = {
              id: updatedProject.id,
              user_id: user.id,
              owner_id: updatedProject.ownerId || user.id,
              key: updatedProject.key,
              project_key: updatedProject.key,
              name: updatedProject.name,
              type: updatedProject.type,
              summary: updatedProject.summary,
              description: updatedProject.summary,
              settings: updatedProject.settings,
              created_at: new Date(updatedProject.createdAt).toISOString(),
              updated_at: new Date(updatedProject.updatedAt).toISOString(),
            }
            supabase.from('projects').upsert(row, { onConflict: 'id' }).then(({ error }) => {
              if (error) {
                if (!handleTableError('projects', error)) {
                  console.error('Failed to sync project update:', error)
                }
              } else {
                markTableAvailable('projects')
              }
            })
          }
        }
      },

      createIssue: (input) => {
        const state = get()
        const project = state.projects.find((p) => p.id === input.projectId)
        if (!project) return { issue: null, error: 'Project not found.' }

        const typeError = ensureTypeAllowed(project, input.type)
        if (typeError) return { issue: null, error: typeError }

        const parentError = validateParentAssignment(project, state.issues, input.type, input.parentId)
        if (parentError) return { issue: null, error: parentError }

        const createdAt = Date.now()
        const issue: Issue = {
          id: isSupabaseConfigured() ? crypto.randomUUID() : `issue-${createdAt}`,
          projectId: input.projectId,
          type: input.type,
          parentId: input.parentId ?? null,
          title: input.title,
          description: input.description || '',
          status: input.status || 'backlog',
          priority: input.priority || 'medium',
          estimate: input.estimate,
          assignees: input.assignees || [],
          labels: input.labels || [],
          startDate: input.startDate,
          endDate: input.endDate,
          dueDate: input.dueDate,
          createdBy: input.createdBy || getCurrentUser()?.id,
          createdAt,
          updatedAt: createdAt,
          rank: nextRank(state.issues, input.projectId, input.parentId ?? null),
        }

        set((state) => ({
          issues: [issue, ...state.issues],
        }))

        if (isSupabaseConfigured() && shouldQueryTable('issues')) {
          const row = {
            id: issue.id,
            project_id: issue.projectId,
            parent_id: issue.parentId,
            type: issue.type,
            title: issue.title,
            description: issue.description,
            status: issue.status,
            priority: issue.priority,
            estimate: issue.estimate ?? null,
            assignees: issue.assignees,
            labels: issue.labels,
            start_date: issue.startDate ?? null,
            end_date: issue.endDate ?? null,
            due_date: issue.dueDate ?? null,
            created_by: issue.createdBy ?? getCurrentUser()?.id ?? null,
            created_at: new Date(issue.createdAt).toISOString(),
            updated_at: new Date(issue.updatedAt).toISOString(),
            rank: issue.rank,
          }
          supabase.from('issues').upsert(row, { onConflict: 'id' }).then(({ error }) => {
            if (error) {
              if (!handleTableError('issues', error)) {
                console.error('Failed to sync issue:', error)
              }
            } else {
              markTableAvailable('issues')
            }
          })
        }

        get().logActivity({
          projectId: issue.projectId,
          issueId: issue.id,
          ...getUserActor(),
          action: 'Created issue',
        })

        return { issue }
      },

      updateIssue: (issueId, updates) => {
        const state = get()
        const issue = state.issues.find((item) => item.id === issueId)
        if (!issue) return { issue: null, error: 'Issue not found.' }

        const project = state.projects.find((p) => p.id === issue.projectId)
        if (!project) return { issue: null, error: 'Project not found.' }

        const nextType = updates.type ?? issue.type
        const typeError = ensureTypeAllowed(project, nextType)
        if (typeError) return { issue: null, error: typeError }

        const parentId = updates.parentId === undefined ? issue.parentId : updates.parentId
        const parentError = validateParentAssignment(project, state.issues, nextType, parentId)
        if (parentError) return { issue: null, error: parentError }

        const updatedIssue: Issue = {
          ...issue,
          ...updates,
          type: nextType,
          parentId,
          updatedAt: Date.now(),
        }

        set((state) => ({
          issues: state.issues.map((item) => (item.id === issueId ? updatedIssue : item)),
        }))

        if (isSupabaseConfigured() && shouldQueryTable('issues')) {
          const row = {
            id: updatedIssue.id,
            project_id: updatedIssue.projectId,
            parent_id: updatedIssue.parentId ?? null,
            type: updatedIssue.type,
            title: updatedIssue.title,
            description: updatedIssue.description,
            status: updatedIssue.status,
            priority: updatedIssue.priority,
            estimate: updatedIssue.estimate ?? null,
            assignees: updatedIssue.assignees,
            labels: updatedIssue.labels,
            start_date: updatedIssue.startDate ?? null,
            end_date: updatedIssue.endDate ?? null,
            due_date: updatedIssue.dueDate ?? null,
            created_by: updatedIssue.createdBy ?? getCurrentUser()?.id ?? null,
            created_at: new Date(updatedIssue.createdAt).toISOString(),
            updated_at: new Date(updatedIssue.updatedAt).toISOString(),
            rank: updatedIssue.rank,
          }
          supabase.from('issues').upsert(row, { onConflict: 'id' }).then(({ error }) => {
            if (error) {
              if (!handleTableError('issues', error)) {
                console.error('Failed to sync issue update:', error)
              }
            } else {
              markTableAvailable('issues')
            }
          })
        }

        Object.entries(updates).forEach(([field, value]) => {
          if (field === 'updatedAt') return
          get().logActivity({
            projectId: updatedIssue.projectId,
            issueId: updatedIssue.id,
            ...getUserActor(),
            action: 'Updated field',
            field,
            oldValue: (issue as any)[field] ?? null,
            newValue: (value as any) ?? null,
          })
        })

        return { issue: updatedIssue }
      },

      moveIssueStatus: (issueId, status) => {
        return get().updateIssue(issueId, { status })
      },

      reparentIssue: (issueId, newParentId) => {
        return get().updateIssue(issueId, { parentId: newParentId })
      },

      moveIssueInParent: (issueId, direction) => {
        const state = get()
        const issue = state.issues.find((item) => item.id === issueId)
        if (!issue) return

        const siblings = state.issues
          .filter((item) => item.projectId === issue.projectId && (item.parentId || null) === (issue.parentId || null))
          .sort((a, b) => a.rank - b.rank)

        const index = siblings.findIndex((item) => item.id === issueId)
        const targetIndex = direction === 'up' ? index - 1 : index + 1
        if (targetIndex < 0 || targetIndex >= siblings.length) return

        const target = siblings[targetIndex]
        set((state) => ({
          issues: state.issues.map((item) => {
            if (item.id === issue.id) return { ...item, rank: target.rank, updatedAt: Date.now() }
            if (item.id === target.id) return { ...item, rank: issue.rank, updatedAt: Date.now() }
            return item
          }),
        }))

        if (isSupabaseConfigured() && shouldQueryTable('issues')) {
          const updatedIssue = { ...issue, rank: target.rank, updatedAt: Date.now() }
          const updatedTarget = { ...target, rank: issue.rank, updatedAt: Date.now() }
          const rows = [updatedIssue, updatedTarget].map((item) => ({
            id: item.id,
            project_id: item.projectId,
            parent_id: item.parentId ?? null,
            type: item.type,
            title: item.title,
            description: item.description,
            status: item.status,
            priority: item.priority,
            estimate: item.estimate ?? null,
            assignees: item.assignees,
            labels: item.labels,
            start_date: item.startDate ?? null,
            end_date: item.endDate ?? null,
            due_date: item.dueDate ?? null,
            created_by: item.createdBy ?? getCurrentUser()?.id ?? null,
            created_at: new Date(item.createdAt).toISOString(),
            updated_at: new Date(item.updatedAt).toISOString(),
            rank: item.rank,
          }))
          supabase.from('issues').upsert(rows, { onConflict: 'id' }).then(({ error }) => {
            if (error) {
              if (!handleTableError('issues', error)) {
                console.error('Failed to sync issue rank reorder:', error)
              }
            } else {
              markTableAvailable('issues')
            }
          })
        }
      },

      swapIssueRank: (sourceId, targetId) => {
        const state = get()
        const source = state.issues.find((item) => item.id === sourceId)
        const target = state.issues.find((item) => item.id === targetId)
        if (!source || !target) return
        if (source.projectId !== target.projectId) return
        if ((source.parentId || null) !== (target.parentId || null)) return

        set((state) => ({
          issues: state.issues.map((item) => {
            if (item.id === source.id) return { ...item, rank: target.rank, updatedAt: Date.now() }
            if (item.id === target.id) return { ...item, rank: source.rank, updatedAt: Date.now() }
            return item
          }),
        }))

        if (isSupabaseConfigured() && shouldQueryTable('issues')) {
          const updatedSource = { ...source, rank: target.rank, updatedAt: Date.now() }
          const updatedTarget = { ...target, rank: source.rank, updatedAt: Date.now() }
          const rows = [updatedSource, updatedTarget].map((item) => ({
            id: item.id,
            project_id: item.projectId,
            parent_id: item.parentId ?? null,
            type: item.type,
            title: item.title,
            description: item.description,
            status: item.status,
            priority: item.priority,
            estimate: item.estimate ?? null,
            assignees: item.assignees,
            labels: item.labels,
            start_date: item.startDate ?? null,
            end_date: item.endDate ?? null,
            due_date: item.dueDate ?? null,
            created_by: item.createdBy ?? getCurrentUser()?.id ?? null,
            created_at: new Date(item.createdAt).toISOString(),
            updated_at: new Date(item.updatedAt).toISOString(),
            rank: item.rank,
          }))
          supabase.from('issues').upsert(rows, { onConflict: 'id' }).then(({ error }) => {
            if (error) {
              if (!handleTableError('issues', error)) {
                console.error('Failed to sync issue rank swap:', error)
              }
            } else {
              markTableAvailable('issues')
            }
          })
        }
      },

      addIssueLink: (sourceId, targetId, type) => {
        const state = get()
        if (sourceId === targetId) return

        const exists = state.issueLinks.some(
          (link) => link.sourceId === sourceId && link.targetId === targetId && link.type === type
        )
        if (exists) return

        const createdAt = Date.now()
        const newLink: IssueLink = {
          id: `link-${createdAt}`,
          sourceId,
          targetId,
          type,
          createdAt,
          createdBy: getCurrentUser()?.id,
        }

        const inverseType = ISSUE_LINK_INVERSE[type]
        const inverseExists = state.issueLinks.some(
          (link) => link.sourceId === targetId && link.targetId === sourceId && link.type === inverseType
        )

        const inverseLink: IssueLink | null = inverseExists
          ? null
          : {
              id: `link-${createdAt + 1}`,
              sourceId: targetId,
              targetId: sourceId,
              type: inverseType,
              createdAt,
              createdBy: getCurrentUser()?.id,
            }

        set((state) => ({
          issueLinks: inverseLink ? [newLink, inverseLink, ...state.issueLinks] : [newLink, ...state.issueLinks],
        }))

        if (isSupabaseConfigured() && shouldQueryTable('issue_links')) {
          const rows = [newLink, inverseLink].filter(Boolean).map((link) => ({
            id: link!.id,
            source_id: link!.sourceId,
            target_id: link!.targetId,
            type: link!.type,
            created_at: new Date(link!.createdAt).toISOString(),
            created_by: link!.createdBy ?? null,
          }))
          supabase.from('issue_links').upsert(rows, { onConflict: 'id' }).then(({ error }) => {
            if (error) {
              if (!handleTableError('issue_links', error)) {
                console.error('Failed to sync issue link:', error)
              }
            } else {
              markTableAvailable('issue_links')
            }
          })
        }
      },

      removeIssueLink: (linkId) => {
        set((state) => ({
          issueLinks: state.issueLinks.filter((link) => link.id !== linkId),
        }))

        if (isSupabaseConfigured() && shouldQueryTable('issue_links')) {
          supabase.from('issue_links').delete().eq('id', linkId).then(({ error }) => {
            if (error) {
              if (!handleTableError('issue_links', error)) {
                console.error('Failed to delete issue link:', error)
              }
            } else {
              markTableAvailable('issue_links')
            }
          })
        }
      },

      logActivity: (entry) => {
        const createdAt = Date.now()
        const activity: ActivityLogEntry = {
          id: `activity-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: createdAt,
          ...entry,
          actorType: entry.actorType ?? 'system',
        }

        set((state) => ({
          activity: [activity, ...state.activity],
        }))

        if (isSupabaseConfigured() && shouldQueryTable('activity_log')) {
          const row = {
            id: activity.id,
            project_id: activity.projectId,
            issue_id: activity.issueId ?? null,
            actor_id: activity.actorId ?? null,
            actor_name: activity.actorName ?? null,
            actor_type: activity.actorType,
            action: activity.action,
            field: activity.field ?? null,
            old_value: activity.oldValue !== undefined && activity.oldValue !== null ? String(activity.oldValue) : null,
            new_value: activity.newValue !== undefined && activity.newValue !== null ? String(activity.newValue) : null,
            timestamp: new Date(activity.timestamp).toISOString(),
          }
          supabase.from('activity_log').upsert(row, { onConflict: 'id' }).then(({ error }) => {
            if (error) {
              if (!handleTableError('activity_log', error)) {
                console.error('Failed to sync activity log:', error)
              }
            } else {
              markTableAvailable('activity_log')
            }
          })
        }
      },
    }),
    {
      name: 'projects-storage',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        projects: state.projects,
        issues: state.issues,
        issueLinks: state.issueLinks,
        activity: state.activity,
        people: state.people,
      }),
      migrate: (persisted) => persisted as Partial<ProjectState>,
    }
  )
)

export const projectSelectors = {
  getProjectByKey: (projects: Project[], key: string) =>
    projects.find((project) => project.key.toLowerCase() === key.toLowerCase()),
  getIssuesForProject: (issues: Issue[], projectId: string) => issues.filter((issue) => issue.projectId === projectId),
  getChildren: (issues: Issue[], parentId: string) => issues.filter((issue) => issue.parentId === parentId),
  getRootIssues: (issues: Issue[], projectId: string) =>
    issues.filter((issue) => issue.projectId === projectId && !issue.parentId),
  getIssueById: (issues: Issue[], issueId?: string | null) => issues.find((issue) => issue.id === issueId),
  getAllowedChildTypes: (parentType: IssueTypeKey) =>
    STANDARD_HIERARCHY[parentType] ? [STANDARD_HIERARCHY[parentType] as IssueTypeKey] : [],
  isRootTypeAllowed,
}

export const projectUtils = {
  formatDate: (value?: string) => (value ? new Date(value).toLocaleDateString() : '—'),
  isOverdue: (value?: string) => (value ? new Date(value).getTime() < Date.now() : false),
  getProjectScheme,
  canParent,
}
