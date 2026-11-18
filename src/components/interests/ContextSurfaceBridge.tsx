/**
 * Bridge between `mainWindow.webContents` (the single authoritative owner of Zustand stores,
 * Supabase credentials, backend requests, file pickers, and screen capture) and Electron's
 * isolated `ContextSurface` child `WebContentsView`s (`widgetView` + `discoveryView`).
 */
import { useEffect, useRef } from 'react'
import { useAgentUi } from '@/context/AgentUiContext'
import { API_BASE_URL } from '@/lib/api-base'
import {
  createContextClient,
  runNotifications,
  type AgentCadence,
  type AgentRecommendation,
  type NewContextItem,
  type ReplyDraft,
  type SpecialistAgent,
  type TopicReview,
} from '@/lib/context-api'
import { sendContextToIssue } from '@/lib/context-to-issue'
import { kindLabel } from '@/lib/issue-attachments'
import type { AgentChoice } from '@/lib/panel-agents'
import { clipWithNote, type PromptAttachment } from '@/lib/prompt-attachments'
import { openSignIn } from '@/lib/sign-in'
import { useAuthStore } from '@/stores/authStore'
import { useContextAgentStore, type ContextTab } from '@/stores/contextAgentStore'
import { useInterestDiscoveryStore } from '@/stores/interestDiscoveryStore'
import { useInterestsStore, type InterestCategory } from '@/stores/interestsStore'
import { usePanelAgentStore } from '@/stores/panelAgentStore'
import { getProjectsState, projectsStoreApi } from '@/stores/projectsStore'
import { useUserPreferencesStore } from '@/stores/userPreferencesStore'
import type { IssueTypeKey } from '@/types/projects'

const SAVED_CONTEXT_MAX = 12_000

export type ContextSurfaceRelayedAction =
  | { type: 'interests:toggle-expanded' }
  | { type: 'interests:set-expanded'; expanded: boolean }
  | { type: 'interests:init-onboarding' }
  | { type: 'discovery:select'; id: string; label: string; category: InterestCategory }
  | { type: 'discovery:clear' }
  | { type: 'context:set-tab'; tab: ContextTab }
  | { type: 'context:set-pinned'; pinned: boolean }
  | { type: 'context:set-watch-browsing'; watch: boolean }
  | { type: 'context:clear-messages' }
  | { type: 'context:yield-to-panel' }
  | { type: 'context:flush-browsing'; force?: boolean }
  | { type: 'context:flush-review'; force?: boolean }
  | { type: 'context:refresh-items' }
  | { type: 'context:refresh-agents' }
  | { type: 'context:refresh-runs' }
  | { type: 'context:refresh-dream' }
  | { type: 'context:add'; item: NewContextItem }
  | { type: 'context:remove'; id: string }
  | { type: 'context:capture-screenshot'; source?: { url: string; title: string } }
  | { type: 'context:stop-recording' }
  | { type: 'context:approve'; recommendation: AgentRecommendation }
  | { type: 'context:dismiss'; id: string }
  | { type: 'context:send-reply'; draft: ReplyDraft; text?: string }
  | { type: 'context:dismiss-reply'; id: string }
  | { type: 'context:save-schedule'; agent: SpecialistAgent; cadence: AgentCadence | null; task: string }
  | { type: 'context:run-now'; agent: SpecialistAgent }
  | { type: 'context:mark-run-seen'; runId: string }
  | { type: 'context:set-reviewing-dream'; reviewing: boolean }
  | { type: 'context:review-dream'; topics: TopicReview[] }
  | { type: 'context:ask'; question: string }
  | { type: 'context:cancel' }
  | { type: 'projects:init' }
  | { type: 'panel:open' }
  | { type: 'panel:send'; prompt: string; attachments?: PromptAttachment[] }
  | { type: 'panel:request-agent'; agent: AgentChoice | null }
  | { type: 'panel:request-thread'; sessionId: string | null }
  | { type: 'ask-ron-items'; itemIds: string[] }

interface SendToIssuePayload {
  itemIds: string[]
  projectId: string
  mode: 'existing' | 'new'
  issueId: string
  title: string
  type: IssueTypeKey
}

function buildSnapshot() {
  const interests = useInterestsStore.getState()
  const contextAgent = useContextAgentStore.getState()
  const discovery = useInterestDiscoveryStore.getState()
  const projects = getProjectsState()
  const auth = useAuthStore.getState()
  const prefs = useUserPreferencesStore.getState()

  const hasNotice =
    contextAgent.replyDrafts.length > 0 ||
    runNotifications(contextAgent.runs).length > 0 ||
    Boolean(contextAgent.dream)
  const noticeWide =
    contextAgent.replyDrafts.length === 0 &&
    runNotifications(contextAgent.runs).length === 0 &&
    Boolean(contextAgent.dream && contextAgent.reviewingDream)
  const hasLabels = interests.nodes.length > 0

  return {
    layout: {
      isExpanded: interests.isExpanded,
      hasNotice,
      noticeWide,
      hasLabels,
      discoveryOpen: Boolean(discovery.selectedInterestLabel),
    },
    htmlClassName: typeof document !== 'undefined' ? document.documentElement.className : '',
    theme: prefs.theme,
    interests: {
      nodes: interests.nodes,
      connections: interests.connections,
      isInitialized: interests.isInitialized,
      isExpanded: interests.isExpanded,
    },
    contextAgent: {
      userId: contextAgent.userId,
      ownerUserId: contextAgent.ownerUserId,
      watchBrowsing: contextAgent.watchBrowsing,
      visits: contextAgent.visits,
      searches: contextAgent.searches,
      chats: contextAgent.chats,
      recommendations: contextAgent.recommendations,
      replyDrafts: contextAgent.replyDrafts,
      handled: contextAgent.handled,
      agentInterests: contextAgent.agentInterests,
      lastReviewAt: contextAgent.lastReviewAt,
      hasNewNotes: contextAgent.hasNewNotes,
      tab: contextAgent.tab,
      pinned: contextAgent.pinned,
      asks: contextAgent.asks,
      unseen: contextAgent.unseen,
      status: contextAgent.status,
      activity: contextAgent.activity,
      error: contextAgent.error,
      notice: contextAgent.notice,
      items: contextAgent.items,
      itemsLoaded: contextAgent.itemsLoaded,
      agents: contextAgent.agents,
      agentsSignInRequired: contextAgent.agentsSignInRequired,
      building: contextAgent.building,
      sendingReply: contextAgent.sendingReply,
      recordingSince: contextAgent.recordingSince,
      busy: contextAgent.busy,
      runs: contextAgent.runs,
      dream: contextAgent.dream,
      reviewingDream: contextAgent.reviewingDream,
      scheduling: contextAgent.scheduling,
      starting: contextAgent.starting,
    },
    discovery: {
      selectedInterestId: discovery.selectedInterestId,
      selectedInterestLabel: discovery.selectedInterestLabel,
      selectedInterestCategory: discovery.selectedInterestCategory,
      isLoading: discovery.isLoading,
      content: discovery.content,
      error: discovery.error,
    },
    projects: {
      projects: projects.projects,
      issues: projects.issues,
      isInitialized: projects.isInitialized,
      isLoading: projects.isLoading,
      error: projects.error,
    },
    auth: {
      user: auth.user,
      isAuthenticated: auth.isAuthenticated,
    },
  }
}

export function ContextSurfaceBridge() {
  const { openPanel, sendToAgentPanel } = useAgentUi()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const actionHandlersRef = useRef({ openPanel, sendToAgentPanel })
  actionHandlersRef.current = { openPanel, sendToAgentPanel }

  useEffect(() => {
    const interests = useInterestsStore.getState()
    if (!interests.isInitialized) {
      interests.initializeFromOnboarding()
    }
  }, [])

  // Push coalesced store + theme class snapshots into Electron's ContextSurface.
  useEffect(() => {
    const setSurface = window.electron?.browser?.setContextSurface
    if (!setSurface) return

    let scheduled = false
    const flush = () => {
      scheduled = false
      void setSurface(buildSnapshot())
    }
    const schedule = () => {
      if (scheduled) return
      scheduled = true
      queueMicrotask(flush)
    }

    flush()

    const unsubs = [
      useInterestsStore.subscribe(schedule),
      useContextAgentStore.subscribe(schedule),
      useInterestDiscoveryStore.subscribe(schedule),
      projectsStoreApi.subscribe(schedule),
      useAuthStore.subscribe(schedule),
      useUserPreferencesStore.subscribe(schedule),
    ]

    const htmlObserver = new MutationObserver(schedule)
    htmlObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => {
      for (const off of unsubs) off()
      htmlObserver.disconnect()
    }
  }, [])

  // Handle relayed actions, SendToIssue, and Sign-in requests from ContextSurface.
  useEffect(() => {
    const browser = window.electron?.browser
    if (!browser) return

    const reply = (requestId: string, result: unknown) => {
      browser.replyContextSurfaceAction?.(requestId, result)
    }

    const offAction = browser.onContextSurfaceAction?.(({ requestId, payload }) => {
      void (async () => {
        try {
          const action = payload as ContextSurfaceRelayedAction
          const interests = useInterestsStore.getState()
          const context = useContextAgentStore.getState()
          const discovery = useInterestDiscoveryStore.getState()

          switch (action.type) {
            case 'interests:toggle-expanded':
              interests.toggleExpanded()
              reply(requestId, true)
              return
            case 'interests:set-expanded':
              interests.setExpanded(action.expanded)
              reply(requestId, true)
              return
            case 'interests:init-onboarding':
              interests.initializeFromOnboarding()
              reply(requestId, true)
              return
            case 'discovery:select':
              discovery.selectInterest(action.id, action.label, action.category)
              reply(requestId, true)
              return
            case 'discovery:clear':
              discovery.clearSelection()
              reply(requestId, true)
              return
            case 'context:set-tab':
              context.setTab(action.tab)
              reply(requestId, true)
              return
            case 'context:set-pinned':
              context.setPinned(action.pinned)
              reply(requestId, true)
              return
            case 'context:set-watch-browsing':
              context.setWatchBrowsing(action.watch)
              reply(requestId, true)
              return
            case 'context:clear-messages':
              context.clearMessages()
              reply(requestId, true)
              return
            case 'context:yield-to-panel':
              context.yieldToPanel()
              reply(requestId, true)
              return
            case 'context:flush-browsing':
              await context.flushBrowsing(action.force)
              reply(requestId, true)
              return
            case 'context:flush-review':
              await context.flushReview(action.force)
              reply(requestId, true)
              return
            case 'context:refresh-items':
              await context.refreshItems()
              reply(requestId, true)
              return
            case 'context:refresh-agents':
              await context.refreshAgents()
              reply(requestId, true)
              return
            case 'context:refresh-runs':
              await context.refreshRuns()
              reply(requestId, true)
              return
            case 'context:refresh-dream':
              await context.refreshDream()
              reply(requestId, true)
              return
            case 'context:add':
              reply(requestId, await context.addContext(action.item))
              return
            case 'context:remove':
              await context.removeContext(action.id)
              reply(requestId, true)
              return
            case 'context:capture-screenshot':
              reply(requestId, await context.captureScreenshot(action.source))
              return
            case 'context:stop-recording':
              await context.stopRecording()
              reply(requestId, true)
              return
            case 'context:approve':
              await context.approve(action.recommendation)
              reply(requestId, true)
              return
            case 'context:dismiss':
              context.dismiss(action.id)
              reply(requestId, true)
              return
            case 'context:send-reply':
              await context.sendReply(action.draft, action.text)
              reply(requestId, true)
              return
            case 'context:dismiss-reply':
              context.dismissReply(action.id)
              reply(requestId, true)
              return
            case 'context:save-schedule':
              await context.saveSchedule(action.agent, action.cadence, action.task)
              reply(requestId, true)
              return
            case 'context:run-now':
              await context.runNow(action.agent)
              reply(requestId, true)
              return
            case 'context:mark-run-seen':
              await context.markRunSeen(action.runId)
              reply(requestId, true)
              return
            case 'context:set-reviewing-dream':
              context.setReviewingDream(action.reviewing)
              reply(requestId, true)
              return
            case 'context:review-dream':
              await context.reviewDream(action.topics)
              reply(requestId, true)
              return
            case 'context:ask':
              await context.ask(action.question)
              reply(requestId, true)
              return
            case 'context:cancel':
              await context.cancel()
              reply(requestId, true)
              return
            case 'projects:init':
              await getProjectsState().initialize()
              reply(requestId, true)
              return
            case 'panel:open':
              actionHandlersRef.current.openPanel()
              reply(requestId, true)
              return
            case 'panel:send':
              actionHandlersRef.current.sendToAgentPanel(action.prompt, action.attachments)
              reply(requestId, true)
              return
            case 'panel:request-agent':
              usePanelAgentStore.getState().requestAgent(action.agent)
              reply(requestId, true)
              return
            case 'panel:request-thread':
              usePanelAgentStore.getState().requestThread(action.sessionId)
              reply(requestId, true)
              return
            case 'ask-ron-items': {
              const client = createContextClient(API_BASE_URL, context.userId)
              const targets = context.items.filter((entry) => action.itemIds.includes(entry.id))
              const attachments = await Promise.all(
                targets.map(async (item): Promise<PromptAttachment> => {
                  const markdown = await client.markdown(item.id).catch(() => `# ${item.title || item.kind}`)
                  const url = /^https?:/i.test(item.source) ? item.source.slice(0, 4096) : undefined
                  return {
                    id: `context-${item.id}`.slice(0, 200),
                    kind: 'file',
                    title: (item.title || item.source || kindLabel(item.kind)).slice(0, 300),
                    text: clipWithNote(markdown, SAVED_CONTEXT_MAX),
                    source: `Saved ${kindLabel(item.kind).toLowerCase()}`,
                    ...(url ? { url } : {}),
                  }
                }),
              )
              actionHandlersRef.current.sendToAgentPanel('', attachments)
              context.yieldToPanel()
              reply(requestId, true)
              return
            }
          }
        } catch (err) {
          console.error('ContextSurfaceBridge action failed:', err)
          reply(requestId, null)
        }
      })()
    })

    const offSendToIssue = browser.onContextSurfaceSendToIssue?.(({ requestId, payload }) => {
      void (async () => {
        try {
          const req = payload as SendToIssuePayload
          const projectsState = getProjectsState()
          if (!projectsState.isInitialized) {
            await projectsState.initialize()
          }
          const latestProjects = getProjectsState()
          const project = latestProjects.projects.find((entry) => entry.id === req.projectId)
          if (!project) {
            reply(requestId, { error: 'Choose a project.' })
            return
          }

          let issue = latestProjects.issues.find((entry) => entry.id === req.issueId)
          if (req.mode === 'new') {
            if (!req.title.trim()) {
              reply(requestId, { error: 'Give the new issue a title.' })
              return
            }
            const created = await latestProjects.createIssue({
              projectId: project.id,
              title: req.title.trim(),
              type: req.type,
            })
            if (created.error || !created.issue) {
              reply(requestId, { error: created.error || 'The issue was not created.' })
              return
            }
            issue = created.issue
          }
          if (!issue) {
            reply(requestId, { error: 'Choose an issue.' })
            return
          }

          const auth = useAuthStore.getState()
          const userId = auth.user?.id || 'default'
          const signedIn = auth.isAuthenticated
          const items = useContextAgentStore
            .getState()
            .items.filter((entry) => req.itemIds.includes(entry.id))

          const result = await sendContextToIssue({
            apiBase: API_BASE_URL,
            userId,
            signedIn,
            items,
            issue,
            updateIssue: getProjectsState().updateIssue,
          })
          const label = `${project.key}-${issue.number}`
          const message = `Added ${result.added} item${result.added === 1 ? '' : 's'} to the Context of ${label}${result.filesSkipped ? ` (files need sign-in, ${result.filesSkipped} kept as text)` : ''}.`
          useContextAgentStore.setState({ notice: message })
          reply(requestId, { message })
        } catch (err) {
          reply(requestId, { error: err instanceof Error ? err.message : String(err) })
        }
      })()
    })

    const offSignIn = browser.onContextSurfaceOpenSignIn?.(() => {
      openSignIn()
    })

    return () => {
      offAction?.()
      offSendToIssue?.()
      offSignIn?.()
    }
  }, [])

  // Handle user-gesture delegated file upload & screen recording requests.
  useEffect(() => {
    const onGesture = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string }>).detail
      if (detail?.kind === 'upload') {
        fileInputRef.current?.click()
      } else if (detail?.kind === 'record') {
        void useContextAgentStore.getState().startRecording()
      }
    }
    window.addEventListener('ron:context-surface-gesture', onGesture)
    return () => window.removeEventListener('ron:context-surface-gesture', onGesture)
  }, [])

  const onFilesSelected = async (files: FileList | null) => {
    const store = useContextAgentStore.getState()
    for (const file of Array.from(files ?? [])) {
      const kind = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('video/')
          ? 'video'
          : 'file'
      await store.uploadContext({ kind, blob: file, name: file.name, title: file.name })
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      hidden
      aria-hidden="true"
      tabIndex={-1}
      accept="image/*,video/*,.pdf,.txt,.md,.csv,.json"
      onChange={(e) => void onFilesSelected(e.target.files)}
    />
  )
}
