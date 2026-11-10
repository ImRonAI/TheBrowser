import { useStore } from 'zustand'
import { useAuthStore } from '@/stores/authStore'
import { getSession } from '@/api/supabase'
import { API_BASE_URL } from '@/pages/types/api'
import { createProjectsRequest } from '@/lib/projects-api'
import { guestWorkspace } from '@/lib/project-workspace'
import { projectEndpoint } from '@/lib/project-endpoint'
import { createProjectsStore } from './projects-state'
import { PROJECT_TYPE_SCHEMES, ROOT_ISSUE_TYPES, STANDARD_HIERARCHY, type Issue, type IssueTypeKey, type Project } from '@/types/projects'

/** The Projects API as `userId` (bearer token, or the guest workspace capability). */
export const projectsRequestFor = (userId: string) => createProjectsRequest(projectEndpoint(userId, API_BASE_URL), getSession, userId)
const store = createProjectsStore(projectsRequestFor)
export const useProjectsStore = () => useStore(store)
/** The current state outside render (e.g. the newest issue version after an await). */
export const getProjectsState = () => store.getState()

// Never hydrate the old shared demo cache into an authenticated account.
try { localStorage.removeItem('projects-storage') } catch { /* Storage may be disabled. */ }
const syncIdentity = () => {
  const auth = useAuthStore.getState()
  try {
    store.getState().setIdentity(auth.isInitialized ? (auth.isAuthenticated ? auth.user : guestWorkspace()) : null)
  } catch {
    store.getState().setIdentity(null)
    store.setState({ error: 'Browser storage is unavailable. Enable local storage to retain your private workspace.' })
  }
}
syncIdentity()
const unsubscribe = useAuthStore.subscribe(syncIdentity)
if (import.meta.hot) import.meta.hot.dispose(unsubscribe)

export const projectSelectors = {
  getProjectByKey: (projects: Project[], key: string) => projects.find((p) => p.id === key) ??
    projects.find((p) => p.key.toLowerCase() === key.toLowerCase()),
  getIssuesForProject: (issues: Issue[], projectId: string) => issues.filter((i) => i.projectId === projectId),
  getChildren: (issues: Issue[], parentId: string) => issues.filter((i) => i.parentId === parentId),
  getRootIssues: (issues: Issue[], projectId: string) => issues.filter((i) => i.projectId === projectId && !i.parentId),
  getIssueById: (issues: Issue[], id?: string | null) => issues.find((i) => i.id === id),
  getAllowedChildTypes: (type: IssueTypeKey) => STANDARD_HIERARCHY[type] ? [STANDARD_HIERARCHY[type] as IssueTypeKey] : [],
  isRootTypeAllowed: (type: IssueTypeKey) => ROOT_ISSUE_TYPES.includes(type),
}
export const projectUtils = {
  formatDate: (value?: string) => value ? new Date(value).toLocaleDateString() : '—',
  isOverdue: (value?: string) => value ? new Date(value).getTime() < Date.now() : false,
  getProjectScheme: (project: Project) => ({
    ...(PROJECT_TYPE_SCHEMES[project.type] ?? PROJECT_TYPE_SCHEMES['software-development']),
    issueTypes: project.settings.issueTypes?.map((type) => type.key) ?? PROJECT_TYPE_SCHEMES['software-development'].issueTypes,
  }),
  canParent: (parent: IssueTypeKey, child: IssueTypeKey) => STANDARD_HIERARCHY[parent] === child,
}