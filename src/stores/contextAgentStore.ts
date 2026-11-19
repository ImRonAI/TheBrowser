/**
 * Context widget state: the Context Agent (`POST /chat` destination `context`, one session per user),
 * the browsing it watches, the context the user collects (`/context/*`), its agent recommendations and
 * the specialists it saved (`harness_agents`).
 *
 * Every Context Agent turn runs through `runRon` one at a time (the runtime owns one run per session);
 * the graph and recommendations are read from the run's own tool results (`contextResults`).
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { API_BASE_URL } from '@/lib/api-base'
import { cancelRon, ronSessionId, runRon } from '@/lib/ron-run'
import {
  APPLICATIONS_CHANGED, approveAgentTurn, browsingDue, browsingTurn, cadenceLabel, contextAddedTurn, contextResults, createContextClient, dataUrlBlob, latestReply,
  phoneTurn, recordVisit, REVIEW_EVERY_MS, REVIEW_TURN, whenLabel, type AgentCadence, type AgentRecommendation, type AgentRun, type ContextItem, type Dream, type TopicReview, type NewContextFile, type NewContextItem,
  type PhoneActivity, type SpecialistAgent, type Visit,
} from '@/lib/context-api'
import { startScreenRecording, type ScreenRecording } from '@/lib/screen-recorder'
import { isGuestUserId } from '@/lib/sign-in'
import { projectAuthHeaders } from '@/lib/project-auth'
import { useInterestsStore } from './interestsStore'

export type ContextTab = 'interests' | 'context' | 'agents' | 'ask'
export interface AskTurn { id: string; question: string; answer: string; error?: string }
/** `activity` while one of the user's own Ask questions is the running turn (background turns use other labels). */
export const ASK_ACTIVITY = 'Thinking'

interface ContextAgentState {
  userId: string
  watchBrowsing: boolean
  visits: Visit[]
  recommendations: AgentRecommendation[]
  /** Recommendation ids the user approved or dismissed. */
  handled: string[]
  /** Agent name → the interest it was built for (from the approved recommendation). */
  agentInterests: Record<string, string>
  tab: ContextTab
  pinned: boolean
  asks: AskTurn[]
  /** Unseen recommendation (orb badge). */
  unseen: boolean
  /** When this device last asked the Context Agent for a `[review]`. */
  reviewedAt: number
  // not persisted
  status: 'idle' | 'running'
  activity: string
  error: string
  notice: string
  items: ContextItem[]
  itemsLoaded: boolean
  agents: SpecialistAgent[]
  agentsSignInRequired: boolean
  building: string | null
  recordingSince: number | null
  busy: string | null
  /** The specialists' runs, newest first (`/context/runs`); finished unseen ones are the widget's notifications. */
  runs: AgentRun[]
  /** The newest dream the user has not reviewed (`/context/dream`): the widget's memory notification. */
  dream: Dream | null
  /** The dream's checklist is open (ren mobile gives the widget the whole screen for it). */
  reviewingDream: boolean
  /** Agent id whose schedule is being saved, or whose Run now is starting. */
  scheduling: string | null
  starting: string | null

  setUser: (userId: string) => void
  setTab: (tab: ContextTab) => void
  setPinned: (pinned: boolean) => void
  setWatchBrowsing: (watch: boolean) => void
  clearMessages: () => void
  /** After handing work to the Agent Panel: collapse to the orb (unless pinned) so the panel is visible. */
  yieldToPanel: () => void
  observeVisit: (url: string, title: string) => void
  /** What the user said to a Ren agent in a chat. */
  observeChat: (text: string) => void
  /** Every `REVIEW_EVERY_MS`: the Context Agent goes over its journal and memory and recommends what to take on. */
  reviewIfDue: () => Promise<void>
  flushBrowsing: (force?: boolean) => Promise<void>
  /** ren mobile: the apps the user used on the phone and what Ren did there, as one Context Agent turn. */
  reportPhone: (activity: PhoneActivity) => Promise<void>
  refreshItems: () => Promise<void>
  refreshAgents: () => Promise<void>
  addContext: (item: NewContextItem) => Promise<ContextItem | null>
  uploadContext: (file: NewContextFile) => Promise<ContextItem | null>
  removeContext: (id: string) => Promise<void>
  captureScreenshot: (source?: { url: string; title: string }) => Promise<ContextItem | null>
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
  approve: (recommendation: AgentRecommendation) => Promise<void>
  dismiss: (id: string) => void
  refreshRuns: () => Promise<void>
  /** Run the specialist on its own at `cadence` (null = stop its schedule). */
  saveSchedule: (agent: SpecialistAgent, cadence: AgentCadence | null, task: string) => Promise<void>
  runNow: (agent: SpecialistAgent) => Promise<void>
  /** The user opened or dismissed this run's notification. */
  markRunSeen: (runId: string) => Promise<void>
  refreshDream: () => Promise<void>
  setReviewingDream: (reviewing: boolean) => void
  /** Close the dream's notification; topics marked wrong or commented go to the dreaming agent. Empty dismisses. */
  reviewDream: (topics: TopicReview[]) => Promise<void>
  ask: (question: string) => Promise<void>
  cancel: () => Promise<void>
}

const client = (userId: string) => createContextClient(API_BASE_URL, userId)
const sessionFor = (userId: string) => ronSessionId('context', userId)
const graph = () => useInterestsStore.getState().nodes.map(({ label, weight }) => ({ label, weight }))
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

let chain: Promise<unknown> = Promise.resolve()
let recording: ScreenRecording | null = null

export const useContextAgentStore = create<ContextAgentState>()(persist((set, get) => {
  /** One Context Agent turn, queued behind any running one. Resolves with the reply text. */
  const run = (message: string, activity: string): Promise<string> => {
    const next = chain.catch(() => undefined).then(async () => {
      const userId = get().userId
      set({ status: 'running', activity, error: '' })
      try {
        const headers = await projectAuthHeaders()
        const state = await runRon({ apiBase: API_BASE_URL, destination: 'context', sessionId: sessionFor(userId), userId, message, headers })
        if (get().userId !== userId) return ''
        const results = contextResults(state.messages)
        if (results.interests) useInterestsStore.getState().applyAgentGraph(results.interests)
        if (results.recommendations.length) {
          const known = new Set([...get().recommendations.map((item) => item.id), ...get().handled])
          const fresh = results.recommendations.filter((item) => !known.has(item.id))
          if (fresh.length) set({ recommendations: [...fresh, ...get().recommendations].slice(0, 12), unseen: true })
        }
        if (results.created.length) void get().refreshAgents()
        if (state.error) throw new Error(state.error)
        return latestReply(state)
      } finally {
        set({ status: 'idle', activity: '' })
      }
    })
    chain = next
    return next
  }

  const collected = (item: ContextItem) => {
    useInterestsStore.getState().setExpanded(true)
    set({ tab: 'context', items: [item, ...get().items.filter((entry) => entry.id !== item.id)], notice: `Added “${item.title || item.kind}” to your context.` })
    run(contextAddedTurn(item, graph()), 'Reading what you added').catch((error) => set({ error: messageOf(error) }))
    return item
  }

  /** An approved app: OpenCode builds it on Ren's workspace computer and the Context Agent lists it under Applications. */
  const buildApp = async (recommendation: AgentRecommendation) => {
    const userId = get().userId
    if (isGuestUserId(userId)) { set({ error: 'Sign in to build apps.' }); return }
    set({ building: recommendation.id, error: '', notice: '' })
    const started = Date.now() / 1000
    try {
      const reply = await run(approveAgentTurn(recommendation), `Building ${recommendation.name}`)
      const name = recommendation.name.trim().toLowerCase()
      const fresh = (await client(userId).applications()).filter((app) => app.created_at >= started)
      const built = fresh.find((app) => app.name.trim().toLowerCase() === name) ?? fresh[0]
      if (!built) throw new Error(reply || 'Context Agent did not finish the app.')
      window.dispatchEvent(new Event(APPLICATIONS_CHANGED))
      set({ handled: [...get().handled, recommendation.id], recommendations: get().recommendations.filter((item) => item.id !== recommendation.id),
        notice: reply || `${built.name} is in your Applications.` })
    } catch (error) {
      set({ error: `${recommendation.name} was not built: ${messageOf(error)}` })
    } finally {
      set({ building: null })
    }
  }

  /** An approved project or reply draft: the Context Agent creates the project, or sends exactly the reply through the phone. */
  const act = async (recommendation: AgentRecommendation) => {
    set({ building: recommendation.id, error: '', notice: '' })
    try {
      const reply = await run(approveAgentTurn(recommendation), recommendation.kind === 'reply' ? `Sending ${recommendation.name.toLowerCase()}` : `Creating ${recommendation.name}`)
      set({ handled: [...get().handled, recommendation.id], recommendations: get().recommendations.filter((item) => item.id !== recommendation.id),
        notice: reply || `${recommendation.name}: done.` })
    } catch (error) {
      set({ error: `${recommendation.name}: ${messageOf(error)}` })
    } finally {
      set({ building: null })
    }
  }

  /**
   * A failed add, upload or capture opens the panel on Context, as a success does, so the error is
   * seen even when it was started from Home, Search or a page menu with the widget closed.
   */
  const failed = (error: string) => {
    useInterestsStore.getState().setExpanded(true)
    set({ tab: 'context', error })
  }

  return {
    userId: 'default', watchBrowsing: true, visits: [], recommendations: [], handled: [], agentInterests: {}, tab: 'interests', pinned: false, asks: [], unseen: false, reviewedAt: 0,
    status: 'idle', activity: '', error: '', notice: '', items: [], itemsLoaded: false, agents: [], agentsSignInRequired: false,
    building: null, recordingSince: null, busy: null, runs: [], dream: null, reviewingDream: false, scheduling: null, starting: null,

    setUser: (userId) => {
      if (userId === get().userId && get().itemsLoaded) return
      set({ userId, items: [], itemsLoaded: false, agents: [], agentsSignInRequired: false, runs: [], dream: null, reviewingDream: false, error: '', notice: '' })
      void get().refreshItems()
      void get().refreshAgents()
      void get().refreshRuns()
      void get().refreshDream()
    },
    setTab: (tab) => set({ tab, ...(tab === 'agents' ? { unseen: false } : {}) }),
    setPinned: (pinned) => set({ pinned }),
    setWatchBrowsing: (watchBrowsing) => set({ watchBrowsing, ...(watchBrowsing ? {} : { visits: [] }) }),
    clearMessages: () => set({ error: '', notice: '' }),
    yieldToPanel: () => { if (!get().pinned) useInterestsStore.getState().setExpanded(false) },

    observeVisit: (url, title) => {
      if (!get().watchBrowsing) return
      const visits = recordVisit(get().visits, { url, title, at: Date.now() })
      if (visits !== get().visits) set({ visits })
    },

    observeChat: (text) => {
      if (get().watchBrowsing) set({ visits: recordVisit(get().visits, { url: '', title: text, at: Date.now(), kind: 'chat' }) })
    },

    reviewIfDue: async () => {
      const { reviewedAt, status } = get()
      if (status === 'running' || Date.now() - reviewedAt < REVIEW_EVERY_MS) return
      set({ reviewedAt: Date.now() })
      // The first check starts the clock: a review needs something learned to go over.
      if (!reviewedAt) return
      try {
        await run(REVIEW_TURN, 'Looking for what Ren could take on')
      } catch (error) {
        set({ error: `Context Agent could not review what it learned: ${messageOf(error)}` })
      }
    },

    flushBrowsing: async (force = false) => {
      const { visits, status } = get()
      if (!visits.length || status === 'running' || (!force && !browsingDue(visits, Date.now()))) return
      set({ visits: [] })
      try {
        await run(browsingTurn(visits, graph()), `Reading ${visits.length} page${visits.length === 1 ? '' : 's'} you visited`)
      } catch (error) {
        set({ error: `Context Agent could not read your browsing: ${messageOf(error)}` })
      }
    },

    reportPhone: async (activity) => {
      if (!activity.apps.length && !activity.actions.length && !activity.notifications?.length) return
      try {
        await run(phoneTurn(activity, graph()), 'Reading what you did on your phone')
      } catch (error) {
        set({ error: `Context Agent could not read your phone activity: ${messageOf(error)}` })
      }
    },

    refreshItems: async () => {
      const userId = get().userId
      try {
        const items = await client(userId).list()
        if (get().userId === userId) set({ items, itemsLoaded: true })
      } catch (error) {
        if (get().userId === userId) set({ itemsLoaded: true, error: `Context could not load: ${messageOf(error)}` })
      }
    },

    refreshAgents: async () => {
      const userId = get().userId
      try {
        const { agents, signInRequired } = await client(userId).agents()
        if (get().userId === userId) set({ agents, agentsSignInRequired: signInRequired })
      } catch (error) {
        if (get().userId === userId) set({ error: `Agents could not load: ${messageOf(error)}` })
      }
    },

    addContext: async (item) => {
      set({ busy: 'Adding to your context…', error: '', notice: '' })
      try {
        return collected(await client(get().userId).add(item))
      } catch (error) {
        failed(`Could not add to your context: ${messageOf(error)}`)
        return null
      } finally {
        set({ busy: null })
      }
    },

    uploadContext: async (file) => {
      set({ busy: `Uploading ${file.name}…`, error: '', notice: '' })
      try {
        return collected(await client(get().userId).upload(file))
      } catch (error) {
        failed(`Could not upload ${file.name}: ${messageOf(error)}`)
        return null
      } finally {
        set({ busy: null })
      }
    },

    removeContext: async (id) => {
      try {
        await client(get().userId).remove(id)
        set({ items: get().items.filter((item) => item.id !== id) })
      } catch (error) {
        set({ error: `Could not remove it: ${messageOf(error)}` })
      }
    },

    captureScreenshot: async (source) => {
      const browser = window.electron?.browser
      if (!browser?.screenshot) { failed('Screenshots need the Ren desktop app.'); return null }
      set({ busy: 'Taking a screenshot…', error: '', notice: '' })
      let page = source
      try {
        if (!page) {
          const tabs = await window.electron?.tabs?.list?.().catch(() => []) ?? []
          const active = tabs.find((tab) => tab.isActive)
          page = { url: active?.url ?? await browser.getUrl().catch(() => ''), title: active?.title ?? '' }
        }
        const dataUrl = await browser.screenshot()
        if (!dataUrl) throw new Error('Nothing to capture on this page.')
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
        return await get().uploadContext({ kind: 'screenshot', blob: dataUrlBlob(dataUrl), name: `screenshot-${stamp}.jpg`,
          title: page.title ? `Screenshot: ${page.title}` : 'Screenshot', source: page.url })
      } catch (error) {
        set({ busy: null })
        failed(`Screenshot failed: ${messageOf(error)}`)
        return null
      }
    },

    startRecording: async () => {
      if (recording) return
      set({ error: '', notice: '' })
      try {
        recording = await startScreenRecording()
      } catch (error) {
        recording = null
        const text = messageOf(error)
        set({ error: /denied|abort|NotAllowed/i.test(text) ? 'Screen recording was cancelled.' : `Screen recording could not start: ${text}` })
        return
      }
      set({ recordingSince: recording.startedAt })
      const current = recording
      try {
        const blob = await current.done
        recording = null
        set({ recordingSince: null })
        if (!blob.size) throw new Error('The recording is empty.')
        const seconds = Math.max(1, Math.round((Date.now() - current.startedAt) / 1000))
        const stamp = new Date(current.startedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-')
        await get().uploadContext({ kind: 'recording', blob, name: `screen-recording-${stamp}.webm`, title: `Screen recording (${seconds}s)` })
      } catch (error) {
        recording = null
        set({ recordingSince: null })
        failed(messageOf(error))
      }
    },

    stopRecording: async () => {
      if (recording) await recording.stop().catch(() => undefined)
    },

    approve: async (recommendation) => {
      if (recommendation.kind === 'web' || recommendation.kind === 'android') return buildApp(recommendation)
      if (recommendation.kind === 'project' || recommendation.kind === 'reply') return act(recommendation)
      if (isGuestUserId(get().userId)) { set({ error: 'Sign in to save agents.' }); return }
      set({ building: recommendation.id, error: '', notice: '' })
      // create_harness upserts by name: a rebuilt agent keeps its id and gets a new updated_at.
      const before = new Map(get().agents.map((agent) => [agent.id, agent.updated_at]))
      try {
        const reply = await run(approveAgentTurn(recommendation), `Building ${recommendation.name}`)
        await get().refreshAgents()
        const saved = get().agents.some((agent) => !before.has(agent.id) || before.get(agent.id) !== agent.updated_at)
        if (!saved) throw new Error(reply || 'Context Agent did not save the agent.')
        set({ handled: [...get().handled, recommendation.id], recommendations: get().recommendations.filter((item) => item.id !== recommendation.id),
          agentInterests: { ...get().agentInterests, [recommendation.name]: recommendation.interest },
          notice: reply || `${recommendation.name} is saved.` })
      } catch (error) {
        set({ error: `${recommendation.name} was not saved: ${messageOf(error)}` })
      } finally {
        set({ building: null })
      }
    },

    dismiss: (id) => set({ handled: [...get().handled, id], recommendations: get().recommendations.filter((item) => item.id !== id) }),

    refreshRuns: async () => {
      const userId = get().userId
      if (isGuestUserId(userId)) return
      try {
        const { runs } = await client(userId).runs()
        if (get().userId === userId) set({ runs })
      } catch {
        // Notifications are best effort: the next poll tries again (the API may be restarting).
      }
    },

    saveSchedule: async (agent, cadence, task) => {
      set({ scheduling: agent.id, error: '', notice: '' })
      try {
        const schedule = await client(get().userId).setSchedule(agent.id, cadence, task)
        set({ agents: get().agents.map((entry) => entry.id === agent.id ? { ...entry, schedule } : entry),
          notice: schedule
            ? `${agent.name} runs ${cadenceLabel(schedule.cadence).toLowerCase()}${schedule.next_run_at ? `. Next run ${whenLabel(schedule.next_run_at)}` : ''}.`
            : `${agent.name} no longer runs on a schedule.` })
      } catch (error) {
        set({ error: `${agent.name}'s schedule was not saved: ${messageOf(error)}` })
      } finally {
        set({ scheduling: null })
      }
    },

    runNow: async (agent) => {
      set({ starting: agent.id, error: '', notice: '' })
      try {
        const run = await client(get().userId).runNow(agent.id)
        set({ runs: [run, ...get().runs.filter((entry) => entry.id !== run.id)],
          notice: `${agent.name} is running. Ren lets you know here when it finishes.` })
      } catch (error) {
        set({ error: `${agent.name} did not start: ${messageOf(error)}` })
      } finally {
        set({ starting: null })
      }
    },

    markRunSeen: async (runId) => {
      const seen = new Date().toISOString()
      set({ runs: get().runs.map((run) => run.id === runId ? { ...run, seen_at: run.seen_at ?? seen } : run) })
      try {
        await client(get().userId).markRunSeen(runId)
      } catch (error) {
        set({ error: `Could not mark the run as read: ${messageOf(error)}` })
      }
    },

    refreshDream: async () => {
      const userId = get().userId
      try {
        const dream = await client(userId).dream()
        if (get().userId === userId && dream?.version !== get().dream?.version) set({ dream, reviewingDream: false })
      } catch {
        // Best effort, like the runs: the next poll tries again.
      }
    },

    setReviewingDream: (reviewingDream) => set({ reviewingDream }),

    reviewDream: async (topics) => {
      const dream = get().dream
      if (!dream) return
      set({ dream: null, reviewingDream: false })
      try {
        await client(get().userId).reviewDream(dream.version, topics)
      } catch (error) {
        set({ dream, error: `Your review was not sent: ${messageOf(error)}` })
      }
    },

    ask: async (question) => {
      const text = question.trim()
      if (!text) return
      const id = `ask-${Date.now().toString(36)}`
      set({ asks: [...get().asks, { id, question: text, answer: '' }].slice(-20) })
      const update = (patch: Partial<AskTurn>) => set({ asks: get().asks.map((turn) => turn.id === id ? { ...turn, ...patch } : turn) })
      try {
        update({ answer: await run(text, ASK_ACTIVITY) || 'Done.' })
      } catch (error) {
        update({ error: messageOf(error) })
      }
    },

    cancel: async () => {
      if (get().status !== 'running') return
      await cancelRon(API_BASE_URL, sessionFor(get().userId), get().userId).catch((error) => set({ error: messageOf(error) }))
    },
  }
}, {
  name: 'context-agent-storage',
  storage: createJSONStorage(() => localStorage),
  version: 1,
  partialize: (state) => ({
    watchBrowsing: state.watchBrowsing, visits: state.visits, recommendations: state.recommendations, handled: state.handled.slice(-200), agentInterests: state.agentInterests,
    tab: state.tab, pinned: state.pinned, asks: state.asks, unseen: state.unseen, reviewedAt: state.reviewedAt,
  }),
}))
