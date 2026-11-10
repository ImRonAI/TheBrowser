import { createStore } from 'zustand/vanilla'
import { RON_ASSIGNEE, type ActivityLogEntry, type Issue, type IssueLink, type IssueLinkType, type IssueStatus, type Person, type Project, type ProjectTypeKey } from '../types/projects.ts'
import { allProjectPages, type ProjectsRequest } from '../lib/projects-api.ts'

type Row = Record<string, any>
type Result = { issue?: Issue; project?: Project; error?: string }
type CreateIssueInput = Partial<Issue> & Pick<Issue, 'projectId' | 'title' | 'type'>
export interface ProjectState {
  projects: Project[]
  issues: Issue[]
  issueLinks: IssueLink[]
  activity: ActivityLogEntry[]
  people: Person[]
  userId: string | null
  isInitialized: boolean
  isLoading: boolean
  pendingSaves: number
  error: string | null
  setIdentity: (user: { id: string; name: string } | null) => void
  initialize: () => Promise<void>
  refreshFromServer: () => Promise<{ error?: string }>
  createProject: (input: Partial<Project> & { name: string; type: ProjectTypeKey }) => Promise<Result>
  updateProject: (id: string, updates: Partial<Project>, expectedVersion?: number) => Promise<Result>
  createIssue: (input: CreateIssueInput) => Promise<Result>
  updateIssue: (id: string, updates: Partial<Issue>, expectedVersion?: number) => Promise<Result>
  moveIssueStatus: (id: string, status: IssueStatus) => Promise<Result>
  reparentIssue: (id: string, parentId: string | null) => Promise<Result>
  moveIssueInParent: (id: string, direction: 'up' | 'down') => Promise<Result>
  swapIssueRank: (sourceId: string, targetId: string) => Promise<Result>
  addIssueLink: (sourceId: string, targetId: string, type: IssueLinkType) => Promise<Result>
  removeIssueLink: (id: string) => Promise<Result>
}

const timestamp = (value: string) => Date.parse(value)
export const mapProjectRow = (row: Row): Project => ({
  id: row.id, key: row.key, version: row.version, lifecycle: row.lifecycle,
  name: row.name, type: row.type, ownerId: row.owner_id, summary: row.summary ?? '',
  settings: row.settings, createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at),
})
export const mapIssueRow = (row: Row): Issue => ({
  id: row.id, projectId: row.project_id, number: row.number, version: row.version,
  parentId: row.parent_id, type: row.type, title: row.title, description: row.description ?? '',
  status: row.status, priority: row.priority, estimate: row.estimate ?? undefined,
  assignees: row.assignees ?? [], labels: row.labels ?? [], startDate: row.start_date ?? undefined,
  endDate: row.end_date ?? undefined, dueDate: row.due_date ?? undefined, rank: Number(row.rank),
  customFields: row.custom_fields ?? {}, workProducts: row.work_products ?? [], context: row.context ?? [],
  createdBy: row.created_by, createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at),
})
/** Issues the server moved alongside a write (a blocking relationship, or a finished blocker). */
export function withMovedIssues(issues: Issue[], rows: unknown): Issue[] {
  if (!Array.isArray(rows) || rows.length === 0) return issues
  const moved = new Map(rows.map((row) => mapIssueRow(row as Row)).map((issue) => [issue.id, issue]))
  return issues.map((issue) => {
    const next = moved.get(issue.id)
    return next && next.version >= issue.version ? next : issue
  })
}
const mapLink = (row: Row): IssueLink => ({
  id: row.id, sourceId: row.source_id, targetId: row.target_id, type: row.type,
  createdBy: row.created_by, createdAt: timestamp(row.created_at),
})
const mapActivity = (row: Row): ActivityLogEntry => ({
  id: row.id, projectId: row.project_id, issueId: row.issue_id, actorId: row.actor_id,
  actorName: row.actor_name, actorType: row.actor_type, action: row.action,
  timestamp: timestamp(row.timestamp), field: row.field, oldValue: row.old_value, newValue: row.new_value,
})

/** Only mutable fields cross the API boundary. An explicit undefined clears nullable fields. */
export function issuePatch(updates: Partial<Issue>): Record<string, unknown> {
  const fields = {
    title: 'title', description: 'description', type: 'type', parentId: 'parent_id',
    status: 'status', priority: 'priority', assignees: 'assignees', labels: 'labels',
    estimate: 'estimate', startDate: 'start_date', endDate: 'end_date', dueDate: 'due_date',
    rank: 'rank', customFields: 'custom_fields', workProducts: 'work_products', context: 'context',
  } as const
  return Object.fromEntries(Object.entries(fields).filter(([key]) => Object.hasOwn(updates, key))
    .map(([key, column]) => [column, updates[key as keyof typeof fields] ?? null]))
}

/** Assignees are deliberately limited to the signed-in user and Ron; the API enforces the same rule. */
export function assignablePeople(user: { id: string; name: string } | null): Person[] {
  if (!user) return []
  if (user.id.startsWith('guest:')) return [RON_ASSIGNEE]
  return [{ id: user.id, name: user.name, initials: user.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2) }, RON_ASSIGNEE]
}

const emptyData = () => ({ projects: [] as Project[], issues: [] as Issue[], issueLinks: [] as IssueLink[],
  activity: [] as ActivityLogEntry[], people: [] as Person[] })

/** Memory only. All writes and refreshes are serialized; old account responses are discarded. */
export function createProjectsStore(requestForUser: (userId: string) => ProjectsRequest) {
  let generation = 0
  let queue: Promise<unknown> = Promise.resolve()
  return createStore<ProjectState>((set, get) => {
    const operation = (save: boolean, work: (request: ProjectsRequest, check: () => void) => Promise<Result>): Promise<Result> => {
      const epoch = generation
      const userId = get().userId
      if (!userId) {
        const error = 'Workspace is still opening. Try again in a moment.'
        set({ error })
        return Promise.resolve({ error })
      }
      const check = () => {
        if (epoch !== generation) throw new Error('Session changed; reload Projects.')
      }
      if (save) set({ pendingSaves: get().pendingSaves + 1 })
      const run = queue.then(async () => {
        try {
          check()
          const result = await work(requestForUser(userId), check)
          check()
          set({ error: null })
          return result
        } catch (cause) {
          const error = cause instanceof Error ? cause.message : 'Project operation failed.'
          if (epoch === generation) set({ error })
          return { error }
        } finally {
          if (save && epoch === generation) set({ pendingSaves: get().pendingSaves - 1 })
        }
      })
      queue = run
      return run
    }
    return {
      ...emptyData(), userId: null, isInitialized: false, isLoading: false, pendingSaves: 0, error: null,
      setIdentity: (user) => {
        if ((user?.id ?? null) === get().userId) return
        generation++
        queue = Promise.resolve()
        set({ ...emptyData(), userId: user?.id ?? null, isInitialized: false, isLoading: false,
          pendingSaves: 0, error: null, people: assignablePeople(user) })
      },
      initialize: async () => {
        if (!get().isInitialized && !get().isLoading) await get().refreshFromServer()
      },
      refreshFromServer: async () => {
        if (get().isLoading) return { error: 'A refresh is already in progress. Wait and try again.' }
        const epoch = generation
        set({ isLoading: true })
        const result = await operation(false, async (request, check) => {
          const [projectRows, links, activity] = await Promise.all([
            allProjectPages<Row>(request, ''), allProjectPages<Row>(request, '/links'),
            request<Row[]>('/activity?offset=0&limit=200'),
          ])
          check()
          const issues = await Promise.all(projectRows.map((p) => allProjectPages<Row>(request, `/${p.id}/issues`)))
          check()
          set({ projects: projectRows.map(mapProjectRow), issues: issues.flat().map(mapIssueRow),
            issueLinks: links.map(mapLink), activity: activity.map(mapActivity), isInitialized: true })
          return {}
        })
        if (epoch === generation) set({ isLoading: false })
        return result
      },
      createProject: (input) => operation(true, async (request, check) => {
        const base = (input.name.match(/[a-z0-9]+/gi) ?? []).map((word) => word[0]).join('').toUpperCase().slice(0, 4)
        let key = input.key?.trim().toUpperCase() || (base.length >= 2 ? base : `${base || 'P'}R`)
        if (!input.key) {
          const stem = key
          let suffix = 2
          while (get().projects.some((p) => p.key === key)) key = `${stem}${suffix++}`
        }
        const row = await request<Row>('', 'POST', { name: input.name.trim(), key, type: input.type, summary: input.summary ?? '' })
        check()
        const project = mapProjectRow(row)
        set({ projects: [project, ...get().projects] })
        return { project }
      }),
      updateProject: (id, updates, expectedVersion) => operation(true, async (request, check) => {
        const current = get().projects.find((p) => p.id === id)
        if (!current) throw new Error('Project not found. Reload Projects.')
        if (expectedVersion !== undefined && current.version !== expectedVersion)
          throw new Error('Project settings changed. Reload and review before saving your retained draft.')
        const body: Row = { version: current.version }
        for (const key of ['name', 'summary', 'lifecycle'] as const) if (Object.hasOwn(updates, key)) body[key] = updates[key]
        if (updates.settings) body.settings = { ...current.settings, ...updates.settings }
        const project = mapProjectRow(await request<Row>(`/${id}`, 'PATCH', body))
        check()
        set({ projects: get().projects.map((p) => p.id === id ? project : p) })
        return { project }
      }),
      createIssue: (input) => operation(true, async (request, check) => {
        const body = issuePatch(input)
        delete body.rank
        delete body.work_products
        delete body.context
        const issue = mapIssueRow(await request<Row>('/issues', 'POST', { ...body, project_id: input.projectId }))
        check()
        set({ issues: [...get().issues, issue] })
        return { issue }
      }),
      updateIssue: (id, updates, expectedVersion) => operation(true, async (request, check) => {
        const current = get().issues.find((i) => i.id === id)
        if (!current) throw new Error('Issue not found. Reload Projects.')
        if (expectedVersion !== undefined && current.version !== expectedVersion)
          throw new Error('Issue changed while you were editing. Your draft is retained; reload and review before saving.')
        const row = await request<Row>(`/issues/${id}`, 'PATCH', { ...issuePatch(updates), version: expectedVersion ?? current.version })
        const issue = mapIssueRow(row)
        check()
        set({ issues: withMovedIssues(get().issues.map((i) => i.id === id ? issue : i), row.unblocked_issues) })
        return { issue }
      }),
      moveIssueStatus: (id, status) => get().updateIssue(id, { status }),
      reparentIssue: (id, parentId) => get().updateIssue(id, { parentId }),
      moveIssueInParent: (id, direction) => {
        const source = get().issues.find((i) => i.id === id)
        if (!source) return Promise.resolve({ error: 'Issue not found.' })
        const siblings = get().issues.filter((i) => i.projectId === source.projectId && i.parentId === source.parentId)
          .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
        const target = siblings[siblings.findIndex((i) => i.id === id) + (direction === 'up' ? -1 : 1)]
        return target ? get().swapIssueRank(id, target.id) : Promise.resolve({})
      },
      // Move a single row around its sibling; never partially commit a two-row swap.
      swapIssueRank: (sourceId, targetId) => operation(true, async (request, check) => {
        const siblings = get().issues
        const source = siblings.find((i) => i.id === sourceId)
        const target = siblings.find((i) => i.id === targetId)
        if (!source || !target || source.projectId !== target.projectId || source.parentId !== target.parentId)
          throw new Error('Reorder requires issues with the same parent and project.')
        const ordered = siblings.filter((i) => i.projectId === source.projectId && i.parentId === source.parentId)
          .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
        const down = ordered.indexOf(source) < ordered.indexOf(target)
        const rest = ordered.filter((i) => i.id !== sourceId)
        const neighbor = rest[rest.indexOf(target) + (down ? 1 : -1)]
        const rank = neighbor ? (target.rank + neighbor.rank) / 2 : target.rank + (down ? 100 : -100)
        if (neighbor && (rank === target.rank || rank === neighbor.rank))
          throw new Error('These ranks cannot be reordered safely. Reload before retrying.')
        const issue = mapIssueRow(await request<Row>(`/issues/${sourceId}`, 'PATCH', { version: source.version, rank }))
        check()
        set({ issues: get().issues.map((i) => i.id === sourceId ? issue : i) })
        return { issue }
      }),
      addIssueLink: (sourceId, targetId, type) => operation(true, async (request, check) => {
        const row = await request<Row>('/links', 'POST', { source_id: sourceId, target_id: targetId, type })
        const link = mapLink(row)
        check()
        set({ issueLinks: [...get().issueLinks.filter((l) => l.id !== link.id), link],
          issues: withMovedIssues(get().issues, row.blocked_issue ? [row.blocked_issue] : []) })
        return {}
      }),
      removeIssueLink: (id) => operation(true, async (request, check) => {
        const result = await request<{ deleted: boolean; unblocked_issues?: Row[] }>(`/links/${id}`, 'DELETE')
        if (result?.deleted !== true) throw new Error('Relationship deletion was not confirmed. Reload before retrying.')
        check()
        set({ issueLinks: get().issueLinks.filter((l) => l.id !== id), issues: withMovedIssues(get().issues, result.unblocked_issues) })
        return {}
      }),
    }
  })
}