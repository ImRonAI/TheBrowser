/**
 * The live sources behind the chat context menu (the link button and `@` mentions): open tabs (Electron), the
 * user's previous chats (`GET /sessions`), issues and projects (`useProjectsStore`), dates that matter (issue
 * due/start/end dates), interests (`useInterestsStore`), project pages (`GET /projects/documents`) and saved
 * context items (`GET /context/items`). Loaded each time the menu opens so it never shows stale entries.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { API_BASE_URL } from '@/lib/api-base'
import { listThreads, type ThreadSummary } from '@/lib/threads-api'
import { createContextClient, type ContextItem as SavedContextItem } from '@/lib/context-api'
import { listAllDocuments, type ProjectDocumentSummary } from '@/lib/project-documents'
import { isGuestUserId } from '@/lib/sign-in'
import {
  documentItem,
  importantDates,
  interestItem,
  issueItem,
  projectItem,
  tabItem,
  threadItem,
  todayItem,
  widgetContextItems,
  type ContextCategory,
  type ContextItem,
} from '@/lib/chat-context'
import { useAuthStore } from '@/stores/authStore'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { getProjectsState, projectsRequestFor, useProjectsStore } from '@/stores/projectsStore'
import { useInterestsStore } from '@/stores/interestsStore'

interface Remote<T> { items: T[]; loading: boolean; note?: string | undefined }
const idle = <T,>(): Remote<T> => ({ items: [], loading: false })
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function useContextSources(open: boolean) {
  const userId = useAuthStore((state) => state.user?.id || 'default')
  const { userId: projectsUser, projects, issues, isLoading: projectsLoading, error: projectsError } = useProjectsStore()
  const interests = useInterestsStore((state) => state.nodes)
  const storeItems = useContextAgentStore((state) => state.items)
  const asks = useContextAgentStore((state) => state.asks)
  const visits = useContextAgentStore((state) => state.visits)
  const runs = useContextAgentStore((state) => state.runs)
  const recommendations = useContextAgentStore((state) => state.recommendations)

  const [tabs, setTabs] = useState<Remote<ContextItem>>(idle)
  const [threads, setThreads] = useState<Remote<ThreadSummary>>(idle)
  const [documents, setDocuments] = useState<Remote<ProjectDocumentSummary>>(idle)
  const [saved, setSaved] = useState<Remote<SavedContextItem>>(idle)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(() => {
    let cancelled = false
    setNow(Date.now())
    void getProjectsState().initialize()

    const tabsApi = typeof window !== 'undefined' ? window.electron?.tabs : undefined
    if (tabsApi) {
      setTabs((current) => ({ ...current, loading: true }))
      tabsApi.list()
        .then((list) => { if (!cancelled) setTabs({ items: [...list].sort((a, b) => Number(b.isActive) - Number(a.isActive)).map(tabItem), loading: false }) })
        .catch((error) => { if (!cancelled) setTabs({ items: [], loading: false, note: `Tabs unavailable: ${message(error)}` }) })
    } else {
      setTabs({ items: [], loading: false, note: 'Open tabs are available in the Ren Browser app.' })
    }

    if (isGuestUserId(userId)) {
      setThreads({ items: [], loading: false, note: 'Sign in to reference your previous chats.' })
    } else {
      setThreads((current) => ({ ...current, loading: true }))
      listThreads(API_BASE_URL, userId)
        .then(({ threads: rows, sign_in_required }) => {
          if (!cancelled) setThreads({ items: rows, loading: false, note: sign_in_required ? 'Sign in to reference your previous chats.' : undefined })
        })
        .catch((error) => { if (!cancelled) setThreads({ items: [], loading: false, note: `Chats unavailable: ${message(error)}` }) })
    }

    if (projectsUser) {
      setDocuments((current) => ({ ...current, loading: true }))
      listAllDocuments(projectsRequestFor(projectsUser))
        .then((rows) => { if (!cancelled) setDocuments({ items: rows, loading: false }) })
        .catch((error) => { if (!cancelled) setDocuments({ items: [], loading: false, note: `Pages unavailable: ${message(error)}` }) })
    }

    setSaved((current) => ({ ...current, loading: true }))
    createContextClient(API_BASE_URL, userId).list()
      .then((rows) => { if (!cancelled) setSaved({ items: rows, loading: false }) })
      .catch((error) => { if (!cancelled) setSaved({ items: [], loading: false, note: `Saved context unavailable: ${message(error)}` }) })

    return () => { cancelled = true }
  }, [userId, projectsUser])

  useEffect(() => (open ? load() : undefined), [open, load])

  const categories = useMemo<ContextCategory[]>(() => {
    const visibleProjects = projects.filter((project) => project.lifecycle !== 'archived')
    const visibleIds = new Set(visibleProjects.map((project) => project.id))
    const projectMap = new Map(projects.map((project) => [project.id, project]))
    const liveIssues = issues.filter((issue) => visibleIds.has(issue.projectId))
      .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || b.updatedAt - a.updatedAt)
    const projectNote = projectsError ? `Projects unavailable: ${projectsError}` : undefined
    const contextItems = widgetContextItems(
      { savedItems: saved.items, storeItems, asks, visits, runs, recommendations },
      now,
    )
    const pages = [...documents.items]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((doc) => documentItem(doc, projects, now))

    const contextNote = saved.note ?? (contextItems.length ? undefined : 'Nothing in Context yet. Capture a page, add a note, or upload a file above.')
    const interestsNote = interests.length ? undefined : 'No interests yet. Finish the interview or turn on “Learn from my browsing”.'
    const documentsNote = documents.note ?? (pages.length ? undefined : 'No project or personal pages yet.')

    return [
      {
        id: 'context',
        name: 'Context',
        description: contextItems.length
          ? `${contextItems.length} item${contextItems.length === 1 ? '' : 's'} in your Context widget`
          : 'Saved notes, links, captures, Ask turns & browsing',
        items: contextItems,
        loading: saved.loading && !contextItems.length,
        ...(contextNote !== undefined ? { note: contextNote } : {}),
      },
      { id: 'tabs', name: 'Open tabs', description: tabs.items.length ? `${tabs.items.length} open` : 'Pages open in Ren', items: tabs.items, loading: tabs.loading, ...(tabs.note !== undefined ? { note: tabs.note } : {}) },
      { id: 'conversations', name: 'Previous chats', description: threads.items.length ? `${threads.items.length} chats` : 'Reference a past conversation',
        items: threads.items.map((thread) => threadItem(thread, now)), loading: threads.loading, ...(threads.note !== undefined ? { note: threads.note } : {}) },
      { id: 'issues', name: 'Issues', description: liveIssues.length ? `${liveIssues.length} across ${visibleProjects.length} projects` : 'Work items in your projects',
        items: liveIssues.map((issue) => issueItem(issue, projectMap, now)), loading: projectsLoading && !issues.length, ...(projectNote !== undefined ? { note: projectNote } : {}) },
      { id: 'projects', name: 'Projects', description: visibleProjects.length ? `${visibleProjects.length} projects` : 'Your projects',
        items: visibleProjects.sort((a, b) => b.updatedAt - a.updatedAt).map((project) => projectItem(project, issues)),
        loading: projectsLoading && !projects.length, ...(projectNote !== undefined ? { note: projectNote } : {}) },
      { id: 'dates', name: 'Dates & events', description: 'Today, due dates, starts and deadlines',
        items: [todayItem(now), ...importantDates(issues, projects, now)], loading: projectsLoading && !issues.length },
      { id: 'interests', name: 'Interests', description: interests.length ? `${interests.length} interests` : 'From your interview and browsing',
        items: [...interests].sort((a, b) => b.weight - a.weight).map(interestItem),
        ...(interestsNote !== undefined ? { note: interestsNote } : {}) },
      { id: 'documents', name: 'Pages & files', description: pages.length ? `${pages.length} project & personal page${pages.length === 1 ? '' : 's'}` : 'Project and personal pages', items: pages,
        loading: documents.loading, ...(documentsNote !== undefined ? { note: documentsNote } : {}) },
    ]
  }, [tabs, threads, documents, saved, storeItems, asks, visits, runs, recommendations, projects, issues, projectsLoading, projectsError, interests, now])

  return { categories, reload: load, userId }
}
