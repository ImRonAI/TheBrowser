import { useState, useRef, useEffect, useCallback, useMemo, Fragment, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Transition } from '@headlessui/react'
import { XMarkIcon, PlusIcon, QueueListIcon, LightBulbIcon, HandRaisedIcon, BookmarkIcon, ChatBubbleOvalLeftIcon, MicrophoneIcon } from '@heroicons/react/24/outline'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import type { TakeoverStatePayload } from '@/pages/types/electron'
import { ThreadsList } from './ThreadsList'
import { MemoryPanel } from './MemoryPanel'
import { useAgentUi } from '@/context/AgentUiContext'
import { usePanelAgentStore } from '@/stores/panelAgentStore'
import { cn } from '@/utils/cn'
import { IDE, type IDEFile } from '@/components/ai-elements/ide'
import { Message, MessageContent } from '@/components/ai-elements/message'
import { MessageResponse } from '@/components/ai-elements/response'
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtHeader, ChainOfThoughtImage, ChainOfThoughtSearchResult, ChainOfThoughtSearchResults, ChainOfThoughtStep } from '@/components/ai-elements/chain-of-thought'
import { detectPreviewUrl, fileFromToolCall, filesFromListDir, getToolView, toolOutputText } from '@/components/ai-elements/ide-tool-mapping'
import { displayValue, groupThinkParts, repairToolTitle, isBrowserUnavailable, isHitlApproval, RENDER_UI_TOOL, supersededUiParts, uiActionText, uiViewFromOutput, type NativePart, type PanelInterrupt, type PanelMessage, type PanelPart, type RunStatus, type RuntimeOptions, type ThinkStep, type ToolPart } from '@/lib/panel-stream'
import { UiView } from './UiView'
import { ContextMentionList, ContextPicker, type ContextItem } from './ContextPicker'
import { ComposerAttachmentTray, SentAttachments } from './PromptAttachments'
import { useComposerAttachments, type ComposerAttachmentsState } from './useComposerAttachments'
import { messageTitle, parseAttachmentBlock } from '@/lib/prompt-attachments'
import { useContextSources } from './useContextSources'
import { mentionAt, removeMention, searchContexts, type ContextCategory } from '@/lib/chat-context'
import { DEFAULT_AGENT_MODEL, ModelSelector, useAgentModels, type AgentModelSelection } from './ModelSelector'
import { usePanelChat, type PanelChat } from './usePanelChat'
import { useElementWidth } from '@/hooks/useElementWidth'
import { DEFAULT_RUNTIME_OPTIONS, panelStatusText } from '@/lib/panel-chat'
import { useAuthStore } from '@/stores/authStore'
import { AGENT_LABELS, parseArticle, type AgentDestination } from '@/lib/articles'
import { articleDraftKey, EMPTY_ARTICLE_DRAFT, useArticleDraftStore } from '@/stores/articleDraftStore'
import { ArticleAttachmentCard } from '@/components/interests/ArticleAttachmentCard'
import { VoiceAgent } from './VoiceAgent'
import { Checkpoint, CheckpointIcon, CheckpointTrigger } from '@/components/ai-elements/checkpoint'
import { PANEL_COMMANDS, parsePanelCommand } from '@/lib/panel-commands'
import { RepairPanel } from './RepairPanel'
import { useTextAssist } from '@/hooks/useTextAssist'
import { TextAssist, handleAssistKey } from '@/components/shared/TextAssist'
import { RenMark } from '@/components/brand'
import { ArrowUp, ArrowUpRight, Square } from 'lucide-react'
import { agentFromSelection, projectChoices, RON_AGENT, specialistChoices, type AgentChoice } from '@/lib/panel-agents'
import { createContextClient } from '@/lib/context-api'
import { API_BASE_URL } from '@/lib/api-base'
import { useProjectsStore } from '@/stores/projectsStore'

const compactInput = 'w-full rounded-lg border border-surface-200 bg-surface-0 px-2 py-1.5 text-xs dark:border-surface-700 dark:bg-surface-850 focus:outline-none focus:ring-2 focus:ring-blurple-500/30'
export const smallButton = 'rounded-lg border border-surface-200 px-3 py-1.5 text-xs font-medium hover:bg-surface-100 disabled:opacity-50 dark:border-surface-700 dark:hover:bg-surface-800'
/** The model picker's trigger inside the composer's tool row. */
export const MODEL_SELECTOR_CLASS = 'h-8 min-w-0 max-w-[210px] rounded-full border-surface-200 bg-surface-50 px-3 text-[12px] font-medium shadow-none dark:border-surface-700 dark:bg-surface-800/70'
/** A quiet square icon button in a panel header. */
const headerIconButton = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse'
/** What the header calls each conversation (the panel names the agent itself). */
const HEADER_TITLES: Partial<Record<AgentDestination, string>> = { build: 'Build', search: 'Search' }
/** Prompt starters for an empty conversation: they fill the composer, they never send on their own. */
const STARTERS: Partial<Record<AgentDestination, string[]>> = {
  panel: ['Summarize this page', 'Research a topic and cite sources', 'Fill in this form for me', 'Make me a song to focus to'],
  search: ['Compare the top options for…', 'Explain this like I am new to it', 'Find the primary sources on…'],
}
/** JSON-mode text for a sibling interrupt during a quick reply; malformed text is sent as-is so the server reports it. */
const safeJson = (text: string | undefined): unknown => { try { return JSON.parse(text ?? '') as unknown } catch { return text ?? '' } }
const focusComposer = (element: HTMLTextAreaElement | null) => {
  if (document.activeElement?.id !== 'main-search-bar') element?.focus()
}

export function AgentPanel() {
  const { isPanelOpen } = useAgentUi()
  const user = useAuthStore((state) => state.user?.id || 'default')
  return isPanelOpen ? <AgentConversation key={user} destination="panel" /> : null
}

/** `onChat` receives the conversation's live chat state (session, messages, status, send) on every change,
 * so a host page (the Build workbench) can render the same session's files, preview and plan beside it. */
export function AgentWorkspace({ destination, onChat, hero, heroFooter }: {
  destination: AgentDestination; onChat?: (chat: PanelChat) => void
  /** Replaces the empty state; while the conversation is empty the composer sits under it, centred. */
  hero?: (pick: (prompt: string) => void) => ReactNode
  /** Rendered under the hero's composer (starter prompts); `pick` puts a prompt in the composer. */
  heroFooter?: (pick: (prompt: string) => void) => ReactNode
}) {
  const user = useAuthStore((state) => state.user?.id || 'default')
  return <AgentConversation key={`${user}:${destination}`} destination={destination} embedded onChat={onChat} hero={hero} heroFooter={heroFooter} />
}

export function AgentConversation({ destination, embedded = false, onChat, hero, heroFooter }: {
  destination: AgentDestination; embedded?: boolean; onChat?: (chat: PanelChat) => void
  hero?: (pick: (prompt: string) => void) => ReactNode
  heroFooter?: (pick: (prompt: string) => void) => ReactNode
}) {
  const { isPanelOpen, closePanel, askRonPendingPrompt, consumeAskRonPendingPrompt,
    closeAskRon, agentPanelQueuedPrompts, consumeAgentPanelPrompt,
    interactionMode, setInteractionMode } = useAgentUi()
  const voice = interactionMode === 'voice'
  const liveHandOff = useRef<(() => Promise<boolean>) | null>(null)
  const registerHandOff = useCallback((handOff: (() => Promise<boolean>) | null) => { liveHandOff.current = handOff }, [])
  const [modeNotice, setModeNotice] = useState('')
  const { panelWidth, setPanelWidth, setPanelMode, requestedAgent, requestAgent, requestedThread, requestThread } = usePanelAgentStore()
  const user = useAuthStore((state) => state.user?.id || 'default')
  const draftKey = articleDraftKey(user, destination)
  const draft = useArticleDraftStore((state) => state.drafts[draftKey] || EMPTY_ARTICLE_DRAFT)
  const setInput = useCallback((value: string | ((current: string) => string)) => {
    const store = useArticleDraftStore.getState()
    store.setText(draftKey, typeof value === 'function' ? value(store.drafts[draftKey]?.text || '') : value)
  }, [draftKey])
  const { defaultModel, defaultProvider, refresh: refreshModels, ...modelCatalogue } = useAgentModels()
  const [selection, setSelection] = useState<AgentModelSelection>({ model: DEFAULT_AGENT_MODEL, provider: '', effort: '' })
  // Who the panel talks to. Always Ren, unless a chat was started for a specialist or a project agent elsewhere
  // (Chat in the Context widget, Ask the project agent); the known agents below name such a chat when it reopens.
  const [agentChoice, setAgentChoice] = useState<AgentChoice>(RON_AGENT)
  const [specialists, setSpecialists] = useState<AgentChoice[]>([])
  const projects = useProjectsStore().projects
  const agentChoices = useMemo(() => destination === 'panel'
    ? [RON_AGENT, ...specialists, ...projectChoices(projects.filter((project) => project.lifecycle !== 'archived'))] : undefined,
  [destination, specialists, projects])
  const loadSpecialists = useCallback(async () => {
    if (destination !== 'panel') return
    try {
      setSpecialists(specialistChoices((await createContextClient(API_BASE_URL, user).agents()).agents))
    } catch {
      // Names only: a pinned specialist chat still opens, titled "Specialist agent".
    }
  }, [destination, user])
  useEffect(() => { void loadSpecialists() }, [loadSpecialists])
  // Long pastes and picked context ride with the next message as attachment cards (`useComposerAttachments`).
  const attachments = useComposerAttachments(draftKey, user)
  const [options, setOptions] = useState<RuntimeOptions>(DEFAULT_RUNTIME_OPTIONS)
  const [threadsOpen, setThreadsOpen] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const sectionWidth = useElementWidth(sectionRef)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [takeoverState, setTakeoverState] = useState<TakeoverStatePayload>({ active: false, url: '', title: '', breadcrumbs: [] })
  const [giveBackPromptOpen, setGiveBackPromptOpen] = useState(false)
  const [giveBackFeedback, setGiveBackFeedback] = useState('')
  const giveBackInputRef = useRef<HTMLTextAreaElement>(null)
  // Chat and Live are two agents over the same native thread (`session_id`): each restores the
  // thread's messages from the SDK snapshot, so no history is bridged between them in the renderer.
  const chat = usePanelChat({ ...selection, agent: agentChoice, destination, attachments: draft.articles,
    promptAttachments: { count: attachments.count, resolve: attachments.forSend }, options })
  // The full header is the title block (50px + ~100px of status, so "Paused at checkpoint" fits) beside the labelled
  // mode selector, a divider and 34px per icon button (measured: 115 + 34n). Narrower, the selector shows icons and
  // the buttons tighten, which leaves the status 108px in the default 420px panel. The bookmark button counts before
  // the first message, so the header does not change size when it appears.
  const headerButtons = 4 + (voice ? 1 : 0) + (embedded ? 0 : 1)
  const headerFullWidth = 302 + 34 * headerButtons + (chat.browser === 'cloud' ? 100 : 0) + (takeoverState.active ? 68 : 0)
  const tight = sectionWidth > 0 && sectionWidth < headerFullWidth
  const iconButton = tight ? cn(headerIconButton, 'w-7') : headerIconButton
  const onChatRef = useRef(onChat)
  onChatRef.current = onChat
  const latestChat = useRef(chat)
  latestChat.current = chat
  // `chat.sendMessage` closes over this render's selection, so it is a new function on every render: a host
  // gets stable ones that call the latest. Published only when what a host renders changes; a host that stores
  // `chat` in state would otherwise re-render this conversation forever ("Maximum update depth exceeded").
  const sendLatest = useCallback<PanelChat['sendMessage']>((...args) => latestChat.current.sendMessage(...args), [])
  const newChatLatest = useCallback(() => latestChat.current.newChat(), [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onChatRef.current?.({ ...chat, sendMessage: sendLatest, newChat: newChatLatest }) }, [chat.sessionId, chat.messages, chat.status, chat.connection, chat.configuration, sendLatest, newChatLatest])
  const currentAgent = chat.configuration?.agent ? agentFromSelection({ agent: chat.configuration.agent }, agentChoices ?? []) : agentChoice
  const model = chat.configuration?.model ?? selection.model
  const provider = chat.configuration?.provider ?? selection.provider
  const effort = chat.configuration?.effort ?? selection.effort
  const runtimeOptions = { ...options, ...chat.configuration?.options }
  const configurationLocked = Boolean(chat.configurationLocked) || chat.connection === 'loading'
  const { messages, status, sendMessage } = chat
  // render_ui: a later render with the same view_id replaces the earlier one; an interaction inside
  // a view becomes a user turn (or steering while a run is active) so the agent can react to it.
  const supersededViews = useMemo(() => supersededUiParts(messages), [messages])
  const onUiAction = useCallback((viewId: string, action: unknown, payload: unknown) => {
    void sendMessage(uiActionText(viewId, action, payload))
  }, [sendMessage])
  const active = status === 'running'
  const paused = status === 'checkpointed' || status === 'interrupted'
  const unavailable = chat.connection !== 'connected' || chat.controlBusy || paused || chat.recoveryRequired
  const input = draft.text
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // `@` in the message mentions the same context the link button offers; it loads only while a mention is typed.
  const [mentionOpen, setMentionOpen] = useState(false)
  const mentionSources = useContextSources(mentionOpen)
  const composer = usePanelComposer(input, setInput, inputRef, active ? undefined
    : { categories: mentionSources.categories, selected: attachments.contexts, onPick: attachments.addContext, onOpenChange: setMentionOpen })
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef(chat.sessionId)
  sessionRef.current = chat.sessionId
  const scrollRef = useRef<HTMLDivElement>(null)
  const followOutput = useRef(true)

  useEffect(() => window.electron?.browser?.onPanelModeChanged?.((data) => {
    if (data?.width) setPanelWidth(data.width)
    if (data?.mode) setPanelMode(data.mode)
  }), [setPanelWidth, setPanelMode])

  useEffect(() => {
    void window.electron?.browser?.getTakeover?.().then((state) => {
      if (state) setTakeoverState(state)
    }).catch(() => undefined)
    return window.electron?.browser?.onTakeoverChanged?.((state) => {
      if (state) setTakeoverState(state)
    })
  }, [])

  const handleToggleTakeover = async () => {
    if (!takeoverState.active) {
      if (active) void chat.stop()
      setGiveBackPromptOpen(false)
      const next = await window.electron?.browser?.setTakeover?.(true)
      if (next) setTakeoverState(next)
      else setTakeoverState((prev) => ({ ...prev, active: true }))
    } else {
      const next = await window.electron?.browser?.setTakeover?.(false)
      if (next) setTakeoverState(next)
      else setTakeoverState((prev) => ({ ...prev, active: false }))
      setGiveBackPromptOpen(true)
      setTimeout(() => giveBackInputRef.current?.focus(), 50)
    }
  }

  const handleSendGiveBack = () => {
    const feedback = giveBackFeedback.trim()
    const crumbs = takeoverState.breadcrumbs ?? []
    const breadcrumbSummary = crumbs.length > 0
      ? `\nVisited pages during takeover:\n${crumbs.map((c) => `- ${c.title || c.url} (${c.url})`).join('\n')}`
      : takeoverState.url
        ? `\nCurrent browser page: ${takeoverState.title || takeoverState.url} (${takeoverState.url})`
        : ''
    const message = `[User Browser Handback]${breadcrumbSummary}\n\n${feedback || 'Please continue from the current browser state.'}`
    setGiveBackFeedback('')
    setGiveBackPromptOpen(false)
    followOutput.current = true
    void sendMessage(message)
  }

  useEffect(() => {
    setSelection((current) => current.model === DEFAULT_AGENT_MODEL && !current.provider
      ? { model: defaultModel, provider: defaultProvider, effort: '' } : current)
  }, [defaultModel, defaultProvider])

  useEffect(() => {
    if (!isPanelOpen) return
    const timer = setTimeout(() => focusComposer(inputRef.current), 300)
    return () => clearTimeout(timer)
  }, [isPanelOpen])

  useEffect(() => {
    if (followOutput.current) messagesEndRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [messages])

  const dispatchExternal = useCallback((text: string) => {
    // Native steering applies immediately; no second /chat invocation while running.
    const id = sessionRef.current
    void sendMessage(text).then((sent) => { if (!sent && sessionRef.current === id) setInput((current) => current || text) })
  }, [sendMessage])
  // External prompts go to the VISIBLE mode only. While Live is shown they are
  // handed to VoiceAgent (below); the hidden Chat session never receives them.
  useEffect(() => {
    if (voice || destination !== 'panel' || unavailable || chat.connection !== 'connected' || !agentPanelQueuedPrompts.length) return
    // A requested agent starts its own new chat first; the prompt then goes to that conversation.
    if (draft.articles.length || requestedAgent) return
    const prompt = consumeAgentPanelPrompt()
    if (prompt) dispatchExternal(prompt)
  }, [voice, destination, draft.articles.length, agentPanelQueuedPrompts, consumeAgentPanelPrompt, dispatchExternal, unavailable, chat.connection, requestedAgent])
  useEffect(() => {
    if (voice || destination !== 'panel' || unavailable || chat.connection !== 'connected' || !askRonPendingPrompt) return
    if (draft.articles.length) return
    const prompt = consumeAskRonPendingPrompt()
    if (prompt) { dispatchExternal(prompt); closeAskRon() }
  }, [voice, destination, draft.articles.length, askRonPendingPrompt, consumeAskRonPendingPrompt, dispatchExternal, closeAskRon, unavailable, chat.connection])
  const liveExternalPrompt = destination === 'panel' && voice ? (askRonPendingPrompt ?? agentPanelQueuedPrompts[0] ?? null) : null
  const consumeLiveExternal = useCallback(() => {
    if (consumeAskRonPendingPrompt()) { closeAskRon(); return }
    consumeAgentPanelPrompt()
  }, [consumeAskRonPendingPrompt, consumeAgentPanelPrompt, closeAskRon])
  const switchMode = async (next: 'voice' | 'text') => {
    if (next === interactionMode) return
    setModeNotice('')
    if (next === 'text' && liveHandOff.current) {
      // Capture stops first; pending Live tools must finish (or be stopped explicitly) before Chat shows.
      const done = await liveHandOff.current()
      if (!done) { setModeNotice('Live is still working. Wait for pending tools or press Stop in Live before switching.'); return }
    }
    if (next === 'voice' && active) {
      setModeNotice('A Chat run is in progress. Stop it or wait before switching to Live so nothing runs hidden.')
      return
    }
    setInteractionMode(next)
  }

  const ideState = useMemo(() => {
    const files = new Map<string, IDEFile>()
    let output = ''
    let previewUrl: string | undefined
    for (const message of messages) for (const part of message.parts) {
      if (part.kind !== 'tool' || part.path.length) continue
      const view = getToolView(part.name)
      const result = part.finished ? { content: part.output } : undefined
      if (view === 'terminal') {
        const input = part.input as { command?: string } | undefined
        if (input?.command) output += `$ ${input.command}\n`
        if (result !== undefined) output += `${toolOutputText(result)}\n`
        previewUrl = detectPreviewUrl(output) ?? previewUrl
      } else if (view === 'ide') {
        if (part.name.endsWith('list_dir')) {
          for (const file of filesFromListDir(part.input, result)) if (!files.has(file.path)) files.set(file.path, file)
        } else {
          const file = fileFromToolCall(part.name, part.input, result)
          if (file) files.set(file.path, file)
        }
      }
    }
    return { files: Array.from(files.values()), output, previewUrl }
  }, [messages])

  // Open an existing thread in the current view. Chat restores it from the server snapshot; Live
  // (VoiceAgent keyed by sessionId) reconnects and its BidiAgent restores the same native session.
  const handleOpenThread = async (id: string) => {
    if (id === chat.sessionId) { setThreadsOpen(false); return }
    if (liveHandOff.current) {
      const done = await liveHandOff.current()
      if (!done) { setModeNotice('Live is still working. Wait for pending tools or press Stop in Live before opening another thread.'); return }
    }
    setModeNotice('')
    sessionRef.current = ''
    chat.openThread(id)
    attachments.clearContexts()
    composer.setCommandFeedback('')
    setThreadsOpen(false)
  }

  const handleNewChat = async (startWith?: AgentChoice) => {
    // A new conversation must not tear down a Live session through the
    // conversationId prop effect while tools are pending: hand off first.
    if (liveHandOff.current) {
      const done = await liveHandOff.current()
      if (!done) { setModeNotice('Live is still working. Wait for pending tools or press Stop in Live before starting a new chat.'); return }
    }
    setModeNotice('')
    // Every agent starts on the default model (GLM 5.3 Flash); a plain new chat is with Ren and keeps the model in use.
    setSelection(startWith ? { model: defaultModel, provider: defaultProvider, effort: '' } : { model, provider, effort })
    setAgentChoice(startWith ?? RON_AGENT)
    setOptions(runtimeOptions)
    sessionRef.current = ''
    chat.newChat()
    attachments.clearContexts()
    // A chat opened for an agent from elsewhere keeps what the user was typing (and pasted).
    if (!startWith) useArticleDraftStore.getState().resetComposer(draftKey)
    composer.reset()
    followOutput.current = true
    focusComposer(inputRef.current)
  }
  // "Chat" on a specialist (Agents tab) or "Ask the project agent" on a project: a new chat with that agent.
  const startRequested = useRef(handleNewChat)
  startRequested.current = handleNewChat
  useEffect(() => {
    if (destination !== 'panel' || !requestedAgent || chat.connection === 'loading') return
    requestAgent(null)
    void startRequested.current(requestedAgent)
  }, [destination, requestedAgent, requestAgent, chat.connection])
  // A chat referenced in a page ("/" Reference a chat): open that thread here.
  const openRequested = useRef(handleOpenThread)
  openRequested.current = handleOpenThread
  useEffect(() => {
    if (destination !== 'panel' || !requestedThread || chat.connection === 'loading') return
    requestThread(null)
    void openRequested.current(requestedThread)
  }, [destination, requestedThread, requestThread, chat.connection])
  // Attachments go with a new message, never with steering.
  const attachmentCount = draft.articles.length + attachments.count
  const message = attachments.messageFor(input)
  const handleSend = () => {
    const text = input.trim()
    if (text) {
      const command = parsePanelCommand(text, runtimeOptions, configurationLocked)
      if (command.kind !== 'message') {
        composer.setCommandFeedback(command.message)
        if (command.kind === 'configure') {
          setOptions(command.options)
          setInput('')
        }
        return
      }
    }
    if (!message.trim() || unavailable || (active && attachmentCount > 0)) return
    composer.setCommandFeedback('')
    followOutput.current = true
    const sentIds = [...draft.articles.map((article) => article.id), ...attachments.pasted.map((item) => item.id)]
    const sentContexts = attachments.contexts.map((item) => item.id)
    void sendMessage(message, 'message', undefined, () => {
      useArticleDraftStore.getState().clearSent(draftKey, input, sentIds)
      attachments.clearContexts(sentContexts)
    })
  }

  // A host hero (Build) owns the empty conversation: the composer sits under it, centred, until the first message.
  const heroMode = Boolean(hero) && !messages.length && !active
  const pickStarter = (prompt: string) => {
    setInput(prompt)
    requestAnimationFrame(() => {
      const element = inputRef.current
      if (!element) return
      element.focus()
      element.setSelectionRange(prompt.length, prompt.length)
    })
  }
  const composerBlock = <>
    <div className="max-h-48 overflow-auto">{draft.articles.map((article) => <ArticleAttachmentCard key={article.id} article={article}
      onRemove={() => useArticleDraftStore.getState().remove(draftKey, article.id)} />)}</div>
    {active && attachmentCount > 0 && <p className="mb-2 text-xs text-ink-muted dark:text-ink-inverse-muted">Your attachments are saved for the next message. Wait for this run to finish or stop it.</p>}
    <PanelComposer composer={composer} active={active} large={heroMode} onPaste={attachments.onPaste}
      label={active ? 'Steer the active run' : 'Message Ren'}
      placeholder={paused ? 'Resume the run above…' : active ? 'Steer Ren while it works…' : heroMode ? 'Describe what you want to build…' : 'Ask Ren anything…'}
      disabled={paused || chat.recoveryRequired} onSend={handleSend} sendDisabled={!message.trim() || unavailable || (active && attachmentCount > 0)}
      onStop={() => void chat.stop()} stopDisabled={chat.controlBusy}
      before={<ComposerAttachmentTray attachments={attachments} className="pb-2.5" />}
      tools={<>
        {!active && <ContextPicker selectedContexts={attachments.contexts} onContextsChange={attachments.setContexts} />}
        <button type="button" onClick={() => setMemoryOpen((open) => !open)} aria-pressed={memoryOpen}
          className={cn('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-surface-800 dark:hover:text-ink-inverse', memoryOpen && 'bg-surface-100 text-ink dark:bg-surface-800 dark:text-ink-inverse')}
          title="Memory" aria-label="Memory"><LightBulbIcon className="w-4 h-4" /></button>
        <ModelSelector value={model} provider={provider} effort={effort} {...modelCatalogue} disabled={configurationLocked}
          onChange={(model, provider, effort) => setSelection({ model, provider, effort })}
          onOpen={refreshModels} className={MODEL_SELECTOR_CLASS} />
      </>} />
  </>

  return (
    <Transition.Root show={embedded || isPanelOpen} as={Fragment}>
      <div className={embedded ? 'relative flex h-full min-h-0' : 'absolute inset-0 z-50 flex pointer-events-none'}>
        <Transition.Child as={Fragment}
          enter="transform transition ease-smooth duration-400" enterFrom="translate-x-full" enterTo="translate-x-0"
          leave="transform transition ease-smooth duration-400" leaveFrom="translate-x-0" leaveTo="translate-x-full">
          <section ref={sectionRef} aria-label={AGENT_LABELS[destination]} className="relative ml-auto h-full max-w-full pointer-events-auto transition-all duration-300 ease-in-out" style={{ width: embedded ? '100%' : panelWidth }}>
            <div className="ron-glass-panel h-full flex flex-col bg-surface-0 dark:bg-surface-900 text-ink dark:text-ink-inverse border-l border-surface-200 dark:border-surface-800 shadow-[-24px_0_48px_-32px_rgb(26_25_23/0.25)]">
              <header className="flex-shrink-0 border-b border-surface-200/80 bg-surface-0 px-3.5 dark:border-surface-800 dark:bg-surface-900">
                <div className="flex h-[52px] items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {destination === 'panel' && currentAgent.kind !== 'ron'
                      ? <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-ink font-display text-[13px] font-extrabold text-surface-0 dark:bg-ink-inverse dark:text-ink">{currentAgent.name.charAt(0).toUpperCase()}</span>
                      : <RenMark className="h-7 w-7" />}
                    <div className="min-w-0 leading-none">
                      <h2 className="truncate font-display text-[15px] font-bold tracking-[-0.015em]"
                        title={destination === 'panel' && currentAgent.kind !== 'ron' ? `${currentAgent.name}: ${currentAgent.description}` : undefined}>
                        {destination === 'panel' ? currentAgent.kind !== 'ron' ? currentAgent.name : 'Ren' : HEADER_TITLES[destination] ?? AGENT_LABELS[destination]}
                      </h2>
                      <p role="status" className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-ink-muted dark:text-ink-inverse-muted">
                        <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDotClass(chat.connection, status))} />
                        <span className="truncate">{panelStatusText({ connection: chat.connection, status, background: runtimeOptions.background })}</span>
                      </p>
                    </div>
                    {chat.browser === 'cloud' && <span role="status" title="This thread's work moved to the cloud browser when the app disconnected; it is not driving this window."
                      className="shrink-0 rounded-full border border-amber-300/60 bg-amber-50/80 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Cloud browser</span>}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <ModeSelector value={interactionMode} onChange={(next) => void switchMode(next)} compact={tight} />
                    <span aria-hidden className={cn('mx-1 h-4 w-px bg-surface-200 dark:bg-surface-800', tight && 'mx-0.5')} />
                    <button
                      type="button"
                      onClick={() => void handleToggleTakeover()}
                      aria-pressed={takeoverState.active}
                      aria-label={takeoverState.active ? 'Give the browser back to Ren' : 'Take over the browser'}
                      title={takeoverState.active ? 'Give browser control back to Ren and tell it what you did' : 'Pause Ren and drive the browser yourself'}
                      className={takeoverState.active
                        ? 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-amber-400 px-3 text-[12px] font-semibold text-ink transition-colors hover:bg-amber-300'
                        : iconButton}
                    >
                      <HandRaisedIcon className="h-[18px] w-[18px]" />
                      {takeoverState.active && <span>Give back</span>}
                    </button>
                    {voice && <button onClick={() => setMemoryOpen((open) => !open)} aria-pressed={memoryOpen} className={cn(iconButton, memoryOpen && 'bg-surface-100 text-ink dark:bg-surface-800 dark:text-ink-inverse')} title="Memory" aria-label="Memory"><LightBulbIcon className="h-[18px] w-[18px]" /></button>}
                    <button onClick={() => setThreadsOpen((open) => !open)} aria-pressed={threadsOpen} className={cn(iconButton, threadsOpen && 'bg-surface-100 text-ink dark:bg-surface-800 dark:text-ink-inverse')} title="Threads" aria-label="Threads"><QueueListIcon className="h-[18px] w-[18px]" /></button>
                    {chat.messages.length > 0 && <button onClick={() => void useContextAgentStore.getState().addContext({ kind: 'thread', sessionId: chat.sessionId, title: messageTitle(chat.messages.find((message) => message.role === 'user')?.parts.flatMap((part) => part.kind === 'text' ? [part.text] : []) ?? []).slice(0, 80) || 'Chat thread' })}
                      className={iconButton} title="Add this conversation to Ren's context" aria-label="Add this conversation to Ren's context"><BookmarkIcon className="h-[18px] w-[18px]" /></button>}
                    <button onClick={() => void handleNewChat()} className={iconButton} title="New chat" aria-label="New chat"><PlusIcon className="h-[18px] w-[18px]" /></button>
                    {!embedded && <button onClick={closePanel} className={iconButton} title="Close" aria-label="Close agent panel"><XMarkIcon className="h-[18px] w-[18px]" /></button>}
                  </div>
                </div>
                {voice && <p className="-mt-1 pb-2.5 truncate text-[11px] text-ink-muted dark:text-ink-inverse-muted">Live model, voice and effort are chosen below · Chat model unchanged</p>}
                {modeNotice && <p role="status" className="-mt-1 pb-2.5 text-xs text-amber-700 dark:text-amber-300">{modeNotice}</p>}
              </header>
              {memoryOpen && <MemoryPanel userId={user} onClose={() => setMemoryOpen(false)} />}
              {threadsOpen && <ThreadsList userId={user} destination={destination} currentId={chat.sessionId} onClose={() => setThreadsOpen(false)}
                onOpen={(id) => { void handleOpenThread(id) }} />}
              {takeoverState.active && (
                <div role="status" className="mx-4 mt-3 rounded-xl border border-amber-300/70 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200">
                  <p className="font-semibold">You have taken over the browser</p>
                  <p className="mt-1 text-amber-800/90 dark:text-amber-300/90">
                    Ren is paused while you interact with the tab. Click <strong>Give Back</strong> above when you are ready to hand control back.
                  </p>
                </div>
              )}
              {giveBackPromptOpen && !takeoverState.active && (
                <form
                  className="mx-4 mt-3 rounded-xl border border-accent/40 bg-surface-50/95 dark:border-accent-light/40 dark:bg-surface-850/95 p-3 text-xs shadow-sm"
                  onSubmit={(event) => {
                    event.preventDefault()
                    handleSendGiveBack()
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-ink dark:text-ink-inverse">Hand back to Ren</p>
                    <button
                      type="button"
                      onClick={() => setGiveBackPromptOpen(false)}
                      className="text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse"
                      aria-label="Dismiss handback prompt"
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-1 text-ink-muted dark:text-ink-inverse-muted">
                    Describe what you did in the browser, share context, or give directions to resume in this session.
                  </p>
                  <textarea
                    ref={giveBackInputRef}
                    value={giveBackFeedback}
                    onChange={(event) => setGiveBackFeedback(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        handleSendGiveBack()
                      }
                    }}
                    aria-label="Give back feedback"
                    placeholder="e.g., I signed in and navigated to the dashboard — please continue from here…"
                    rows={3}
                    className={`${compactInput} mt-2`}
                  />
                  <div className="mt-2.5 flex items-center justify-end gap-2">
                    <button type="button" onClick={() => setGiveBackPromptOpen(false)} className={smallButton}>
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={unavailable}
                      className="rounded-lg bg-ink dark:bg-ink-inverse text-white dark:text-surface-900 px-3 py-1.5 text-xs font-semibold shadow-sm hover:opacity-90 disabled:opacity-40"
                    >
                      Send &amp; Resume
                    </button>
                  </div>
                </form>
              )}

              {voice ? <div className="flex min-h-0 flex-1">
                <VoiceAgent userId={user} agentScope={destination} sessionId={chat.sessionId} owner={`${destination}-panel`}
                  registerHandOff={registerHandOff}
                  externalPrompt={liveExternalPrompt} onExternalPromptConsumed={consumeLiveExternal} />
              </div> : <>
              <div ref={scrollRef} className={cn('flex-1 min-h-0 overflow-y-auto scrollbar-thin', heroMode ? 'flex flex-col px-6 py-10' : 'space-y-5 px-4 py-5')} onScroll={() => {
                const element = scrollRef.current
                if (element) followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100
              }}>
                {heroMode ? <div className="m-auto w-full max-w-[720px]">
                  {hero?.(pickStarter)}
                  <div className="mt-9">{composerBlock}</div>
                  {heroFooter?.(pickStarter)}
                </div> : <>
                {!messages.length && !active && <div className="flex h-full min-h-40 flex-col justify-center px-1.5 pb-4">
                  <p className="tag-label tag-label-slash">{destination === 'search' ? 'Search' : 'Ask Ren'}</p>
                  <h3 className="mt-3 font-display text-[30px] font-extrabold leading-[1.02] tracking-[-0.035em]">What’s the move?</h3>
                  <p className="mt-2.5 max-w-[36ch] text-[14px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
                    {destination === 'search' ? 'Ask a question. Ren searches, reads the sources and cites every claim.' : 'Ask about this page, search the web, or hand Ren a task. Ren can drive this browser for you.'}
                  </p>
                  {(STARTERS[destination] ?? []).length > 0 && <div className="mt-6 grid gap-1.5">
                    {(STARTERS[destination] ?? []).map((starter) => <button key={starter} type="button" onClick={() => pickStarter(starter)}
                      className="group flex items-center justify-between gap-3 rounded-xl border border-surface-200 bg-surface-0 px-3.5 py-2.5 text-left text-[13px] font-medium text-ink transition-colors duration-150 hover:border-blurple-300 hover:bg-blurple-50/70 dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:hover:border-blurple-800 dark:hover:bg-blurple-950/40">
                      <span className="truncate">{starter}</span>
                      <ArrowUpRight aria-hidden className="h-4 w-4 shrink-0 text-ink-muted transition-colors group-hover:text-volt dark:text-ink-inverse-muted" />
                    </button>)}
                  </div>}
                </div>}
                {messages.map((message) => <MessageBubble key={message.id} message={message} status={message.runId === chat.runId ? status : 'completed'} onUiAction={onUiAction} superseded={supersededViews} />)}
                {!hero && (ideState.files.length > 0 || ideState.output) && <details className="rounded-xl border border-surface-200 dark:border-surface-700 p-3">
                  <summary className="cursor-pointer text-xs font-medium">Workspace · files and terminal</summary>
                  <IDE className="mt-3 max-h-[420px]" files={ideState.files} output={ideState.output} isStreaming={active} previewUrl={ideState.previewUrl} title="Workspace" />
                </details>}
                {active && <div role="status" className="flex items-center gap-2 text-xs text-ink-muted dark:text-ink-inverse-muted"><span className="h-1.5 w-1.5 rounded-full bg-volt" />Ren is working · send a message to steer</div>}
                <div ref={messagesEndRef} />
                </>}
              </div>

              {!heroMode && <>
              <PanelRunNotices chat={chat} />

              <footer className="flex-shrink-0 border-t border-surface-200/80 bg-surface-0 px-3.5 pb-3 pt-3 dark:border-surface-800 dark:bg-surface-900">
                {composerBlock}
              </footer>
              </>}
              </>}
            </div>
          </section>
        </Transition.Child>
      </div>
    </Transition.Root>
  )
}

/**
 * Composer behaviour shared by every panel-protocol chat (Agent Panel, Build, the issue chat): Brave Suggest +
 * Spellcheck (off while the text starts with "/" or the command list shows), the `/` command list (↑/↓, Tab or
 * Enter to pick, Esc to dismiss) and Enter to send.
 */
export interface ComposerMentions {
  /** Where `@` mentions come from (`useContextSources`). */
  categories: ContextCategory[]
  /** Already attached, shown checked. */
  selected: ContextItem[]
  onPick: (item: ContextItem) => void
  /** True while an `@query` is being typed, so the sources load only then. */
  onOpenChange?: (open: boolean) => void
}

export function usePanelComposer(input: string, setInput: (value: string) => void, inputRef: RefObject<HTMLTextAreaElement | null>,
  mentions?: ComposerMentions) {
  const [commandFeedback, setCommandFeedback] = useState('')
  const [commandIndex, setCommandIndex] = useState(0)
  const [commandsDismissed, setCommandsDismissed] = useState(false)
  const [caret, setCaret] = useState(input.length)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionDismissedAt, setMentionDismissedAt] = useState<number | null>(null)
  const commandSuggestions = !commandsDismissed && /^\/\S*$/.test(input)
    ? PANEL_COMMANDS.filter((command) => command.name.startsWith(input)) : []
  const typed = mentions && !commandSuggestions.length ? mentionAt(input, Math.min(caret, input.length)) : null
  const typedResults = typed && typed.start !== mentionDismissedAt && mentions ? searchContexts(mentions.categories, typed.query, 8) : []
  // A query with a space that matches nothing is ordinary text after an `@`, not a mention.
  const mention = typed && typed.start !== mentionDismissedAt && (typedResults.length || !/\s/.test(typed.query)) ? typed : null
  const mentionResults = mention ? typedResults : []
  const selectedMention = Math.min(mentionIndex, Math.max(0, mentionResults.length - 1))
  const mentionLoading = Boolean(mentions?.categories.some((category) => category.loading))
  const onMentionOpenChange = mentions?.onOpenChange
  const mentionOpen = mention !== null
  useEffect(() => { onMentionOpenChange?.(mentionOpen) }, [mentionOpen, onMentionOpenChange])
  const skipAssist = useCallback((value: string) => value.trimStart().startsWith('/'), [])
  const assist = useTextAssist(mentionOpen ? '' : input, { skip: skipAssist, count: 5 })
  const selectedCommand = Math.min(commandIndex, Math.max(0, commandSuggestions.length - 1))
  const chooseCommand = (name: string) => {
    setInput(`${name} `)
    setCommandFeedback('')
    focusComposer(inputRef.current)
  }
  /** Attach the mentioned item and take the `@query` out of the message. */
  const chooseMention = (item: ContextItem) => {
    if (!mention || !mentions) return
    const next = removeMention(input, mention.start, Math.min(caret, input.length))
    setInput(next.text)
    setCaret(next.caret)
    mentions.onPick(item)
    requestAnimationFrame(() => {
      const element = inputRef.current
      if (!element) return
      element.focus()
      element.setSelectionRange(next.caret, next.caret)
    })
  }
  const trackCaret = () => setCaret(inputRef.current?.selectionStart ?? input.length)
  const change = (value: string) => {
    setInput(value); setCommandIndex(0); setCommandsDismissed(false); setCommandFeedback('')
    setCaret(inputRef.current?.selectionStart ?? value.length); setMentionIndex(0)
    if (mentionDismissedAt !== null && !mentionAt(value, inputRef.current?.selectionStart ?? value.length)) setMentionDismissedAt(null)
  }
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>, send: () => void) => {
    if (event.nativeEvent.isComposing) return
    if (mention) {
      // Esc, or Enter on an empty match list, closes the list and keeps the text; the next Enter sends.
      if (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey && !mentionResults.length)) {
        event.preventDefault(); setMentionDismissedAt(mention.start); return
      }
      if (mentionResults.length) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          setMentionIndex((selectedMention + (event.key === 'ArrowDown' ? 1 : -1) + mentionResults.length) % mentionResults.length)
          return
        }
        if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
          event.preventDefault(); chooseMention(mentionResults[selectedMention].item); return
        }
      }
    }
    if (!commandSuggestions.length && handleAssistKey(event, assist, (text) => { setInput(text); assist.dismiss() })) return
    if (commandSuggestions.length) {
      if (event.key === 'Escape') { event.preventDefault(); setCommandsDismissed(true); return }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setCommandIndex((selectedCommand + (event.key === 'ArrowDown' ? 1 : -1) + commandSuggestions.length) % commandSuggestions.length)
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault(); chooseCommand(commandSuggestions[selectedCommand].name); return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault(); assist.dismiss(); send()
    }
  }
  /** A new conversation clears the last command's feedback and re-enables the command list. */
  const reset = () => { setCommandFeedback(''); setCommandsDismissed(false); setMentionDismissedAt(null) }
  return { input, setInput, inputRef, assist, commandSuggestions, selectedCommand, chooseCommand, commandFeedback, setCommandFeedback, change, keyDown, reset,
    mention, mentionResults, selectedMention, setMentionIndex, chooseMention, mentionLoading, trackCaret,
    mentionSelectedIds: new Set((mentions?.selected ?? []).map((item) => item.id)) }
}

export type PanelComposerState = ReturnType<typeof usePanelComposer>

/** The panel composer card: suggestions above, the message box, then tools (left) and Stop / Send or Steer (right). */
export function PanelComposer({ composer, active, label, placeholder, disabled, onSend, sendDisabled, onStop, stopDisabled, before, tools, onPaste, large = false }: {
  composer: PanelComposerState; active: boolean; label: string; placeholder: string; disabled?: boolean
  onSend: () => void; sendDisabled?: boolean; onStop: () => void; stopDisabled?: boolean
  /** A long paste becomes an attachment card (`useComposerAttachments.onPaste`). */
  onPaste?: ComposerAttachmentsState['onPaste']
  /** Rendered inside the card above the message box (selected contexts). */
  before?: ReactNode
  /** Left side of the tool row (context picker, memory, model selector). */
  tools?: ReactNode
  /** The hero composer (Build's empty state): a taller box and a larger type size. */
  large?: boolean
}) {
  const { input, setInput, inputRef, assist, commandSuggestions, selectedCommand } = composer
  return <>
    <div className={cn('ron-field relative rounded-2xl border bg-surface-0 px-3.5 pb-2.5 pt-3 transition-[border-color,box-shadow] duration-200 dark:bg-surface-850',
      'focus-within:border-blurple-400 focus-within:ring-[3px] focus-within:ring-blurple-500/15 dark:focus-within:border-blurple-500/70 dark:focus-within:ring-blurple-400/15',
      large ? 'shadow-float' : 'shadow-sm',
      input ? 'border-blurple-300 dark:border-blurple-800' : 'border-surface-200 dark:border-surface-700/80')}>
      {composer.mention && <ContextMentionList query={composer.mention.query} results={composer.mentionResults}
        activeIndex={composer.selectedMention} loading={composer.mentionLoading} selectedIds={composer.mentionSelectedIds}
        onPick={composer.chooseMention} onHover={composer.setMentionIndex} />}
      {!commandSuggestions.length && !composer.mention && <TextAssist assist={assist} placement="above"
        onPick={(text) => { setInput(text); assist.dismiss(); focusComposer(inputRef.current) }}
        onCorrect={(text) => { setInput(text); assist.dismiss(); focusComposer(inputRef.current) }} />}
      {commandSuggestions.length > 0 && <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-surface-200 bg-surface-0 p-1 shadow-[0_18px_48px_-18px_rgb(26_25_23/0.28)] dark:border-surface-700 dark:bg-surface-850" aria-label="Prompt commands">
        {commandSuggestions.map((command, index) => <button key={command.name} type="button"
          aria-current={selectedCommand === index ? 'true' : undefined}
          onMouseDown={(event) => event.preventDefault()} onClick={() => composer.chooseCommand(command.name)}
          className={cn('block w-full rounded-lg px-3 py-2 text-left text-xs', selectedCommand === index && 'bg-surface-100 dark:bg-surface-800')}>
          <span className="font-semibold">{command.usage}</span><span className="mt-1 block text-ink-muted dark:text-ink-inverse-muted">{command.description}</span>
        </button>)}
      </div>}
      {before}
      <textarea ref={inputRef} value={input} onChange={(event) => composer.change(event.target.value)} onKeyDown={(event) => composer.keyDown(event, onSend)} onPaste={onPaste}
        onSelect={composer.trackCaret} aria-expanded={composer.mention ? true : undefined}
        aria-label={label} placeholder={placeholder}
        disabled={disabled} rows={large ? 3 : 2}
        className={cn('w-full min-w-0 resize-none bg-transparent px-0.5 py-1 leading-relaxed outline-none placeholder:text-ink-muted/70 focus-visible:ring-0 focus-visible:ring-offset-0 dark:placeholder:text-ink-inverse-muted/70',
          large ? 'min-h-[84px] max-h-64 text-[16px]' : 'min-h-[48px] max-h-40 text-[14px]')} />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">{tools}</div>
        <div className="flex shrink-0 items-center gap-1.5">
          {active && <button type="button" onClick={onStop} disabled={stopDisabled} aria-label="Stop agent run" title="Stop"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink text-surface-0 transition-opacity hover:opacity-85 disabled:opacity-40 dark:bg-ink-inverse dark:text-ink"><Square aria-hidden className="h-3 w-3 fill-current" /></button>}
          <button type="button" onClick={onSend} disabled={sendDisabled} aria-label={active ? 'Send steering' : 'Send message'} title={active ? 'Steer' : 'Send'}
            className={cn('inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-blurple-600 text-white transition-colors hover:bg-blurple-700 dark:bg-blurple-500 dark:hover:bg-blurple-400',
              'disabled:bg-surface-200 disabled:text-ink-muted dark:disabled:bg-surface-800 dark:disabled:text-ink-inverse-muted', active ? 'px-3 text-[12px] font-semibold' : 'w-8')}>
            {active && 'Steer'}<ArrowUp aria-hidden className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </div>
    {composer.commandFeedback && <p role="status" className="mt-2 text-xs text-ink-muted dark:text-ink-inverse-muted">{composer.commandFeedback}</p>}
    <p className="mt-2 text-center text-[10.5px] tracking-[0.01em] text-ink-muted/80 dark:text-ink-inverse-muted/80">
      {active ? 'Steering updates the current run' : <>↵ send <span aria-hidden className="mx-1 opacity-50">·</span> ⇧↵ new line <span aria-hidden className="mx-1 opacity-50">·</span> / commands <span aria-hidden className="mx-1 opacity-50">·</span> @ context</>}
    </p>
  </>
}

/** The status dot beside the conversation's name: connected (success), working (volt), waiting (signal), failed. */
function statusDotClass(connection: PanelChat['connection'], status: RunStatus) {
  if (connection !== 'connected') return connection === 'detached' ? 'bg-red-500' : 'bg-amber-400'
  if (status === 'running') return 'bg-volt'
  if (status === 'error') return 'bg-red-500'
  if (status === 'interrupted' || status === 'checkpointed') return 'bg-amber-400'
  return 'bg-emerald-500'
}

/** Run state below the conversation: replay gap, errors (with Reconnect), checkpoint resume, interrupts and tool repair. */
export function PanelRunNotices({ chat }: { chat: PanelChat }) {
  const { status, sendMessage } = chat
  const active = status === 'running'
  return <>
    {chat.historyIncomplete && <div role="status" className="mx-4 mb-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-xs">
      {active || chat.followPending
        ? 'Replay gap: some live text and progress are unavailable. Completed SDK messages are shown; canonical history refreshes when the run finishes.'
        : 'Replay gap: canonical history has been refreshed. Some live progress and nested events could not be recovered.'}
    </div>}
    {/* Bounded: a long provider error scrolls inside the alert instead of pushing the panel past the window. */}
    {(chat.error || chat.transportError) && <div role="alert" className="mx-4 mb-3 max-h-48 shrink-0 overflow-y-auto rounded-xl border border-red-300/60 bg-red-50/80 p-3 text-xs text-red-800 scrollbar-thin dark:bg-red-950/30 dark:text-red-200">
      <p className="whitespace-pre-wrap break-words">{chat.error || chat.transportError}</p>
      {chat.error && chat.transportError && <p className="mt-1">{chat.transportError}</p>}
      {chat.error && chat.errorDetails && <details className="mt-2">
        <summary className="cursor-pointer select-none font-medium">Details</summary>
        <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] opacity-80">{chat.errorDetails}</pre>
      </details>}
      {chat.connection === 'detached' && <button className={`${smallButton} mt-2`} onClick={chat.reconnect}>Reconnect</button>}
    </div>}
    {status === 'checkpointed' && <Checkpoint className="mx-4 mb-3" aria-label="Native checkpoint">
      <CheckpointIcon />
      <CheckpointTrigger disabled={chat.connection !== 'connected' || chat.controlBusy || chat.recoveryRequired}
        onClick={() => void sendMessage('', 'checkpoint_resume')}>Resume checkpoint</CheckpointTrigger>
    </Checkpoint>}
    {status === 'interrupted' && <InterruptForm key={`${chat.sessionId}-${chat.runId}`} interrupts={chat.interrupts}
      onSubmit={(responses) => sendMessage('', 'interrupt_response', responses)} />}
    {chat.repair && <RepairPanel repair={chat.repair} busy={chat.controlBusy}
      onApprove={() => void chat.repairAction('approve', chat.repair!.tool, chat.repair!.rev, chat.repair!.approvalToken)}
      onDecline={() => void chat.repairAction('decline', chat.repair!.tool, chat.repair!.rev)}
      onCancel={() => void chat.repairAction('cancel', chat.repair!.tool)}
      onRollback={() => void chat.repairAction('rollback', chat.repair!.tool)}
      onDismiss={() => void chat.repairAction('dismiss', chat.repair!.tool)} />}
  </>
}

const MODES: readonly { id: 'text' | 'voice'; label: string; title: string }[] = [
  { id: 'text', label: 'Chat', title: 'Text chat with the panel agent' },
  { id: 'voice', label: 'Live', title: 'Gemini Live voice session sharing this conversation' },
]

const MODE_ICONS = { text: ChatBubbleOvalLeftIcon, voice: MicrophoneIcon }

/** Chat / Live segmented control. The parent gates the switch on in-flight work. `compact` (a narrow conversation)
 *  shows the two as icons, named by their aria-label and tooltip. */
export function ModeSelector({ value, onChange, compact = false }: { value: 'text' | 'voice'; onChange: (value: 'text' | 'voice') => void; compact?: boolean }) {
  return <div role="group" aria-label="Interaction mode"
    className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-full bg-surface-100 p-0.5 text-[12px] dark:bg-surface-800/80">
    {MODES.map((mode) => {
      const selected = mode.id === value
      const Icon = MODE_ICONS[mode.id]
      return <button key={mode.id} type="button" aria-pressed={selected} title={compact ? `${mode.label}: ${mode.title}` : mode.title} onClick={() => onChange(mode.id)}
        aria-label={compact ? mode.label : undefined}
        className={cn('inline-flex h-full items-center justify-center rounded-full font-semibold transition-colors', compact ? 'w-8' : 'px-3',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-surface-900',
          selected ? 'bg-surface-0 text-ink shadow-sm dark:bg-surface-700 dark:text-ink-inverse' : 'text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse')}>
        {compact ? <Icon aria-hidden className="h-4 w-4" /> : mode.label}
      </button>
    })}
  </div>
}

export function InterruptForm({ interrupts, onSubmit }: {
  interrupts: PanelInterrupt[]; onSubmit: (responses: { interruptId: string; response: unknown }[]) => Promise<boolean>
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [jsonMode, setJsonMode] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = (responses: { interruptId: string; response: unknown }[]) => {
    setError(''); setBusy(true)
    void onSubmit(responses).finally(() => setBusy(false))
  }
  // browser_unavailable (BrowserAvailabilityHook): one-click continue / cancel for that interrupt,
  // any others in the same batch keep their typed answers.
  const quickReply = (target: PanelInterrupt, response: string) => submit(interrupts.map((interrupt) => ({
    interruptId: interrupt.id,
    response: interrupt.id === target.id ? response : (jsonMode[interrupt.id] ? safeJson(values[interrupt.id]) : values[interrupt.id] ?? ''),
  })))
  return <form className="mx-4 mb-3 max-h-64 overflow-y-auto rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-xs" onSubmit={(event) => {
    event.preventDefault()
    try {
      submit(interrupts.map((interrupt) => ({ interruptId: interrupt.id,
        response: jsonMode[interrupt.id] ? JSON.parse(values[interrupt.id] ?? '') as unknown : values[interrupt.id] ?? '',
      })))
    } catch { setError('Enter valid JSON for each response marked JSON.') }
  }}>
    <p className="font-semibold">The agent needs your input</p>
    {!interrupts.length && <p className="mt-2">No pending input details were returned. Reconnect to refresh the session.</p>}
    {interrupts.map((interrupt) => <div key={interrupt.id} className="mt-3 space-y-2">
      {isBrowserUnavailable(interrupt.reason) && <div className="flex flex-wrap items-center gap-2" data-browser-unavailable>
        <span className="font-semibold">{(interrupt.reason as { question: string }).question}</span>
        <button type="button" className={smallButton} disabled={busy} onClick={() => quickReply(interrupt, 'continue')}>Continue</button>
        <button type="button" className={smallButton} disabled={busy} onClick={() => quickReply(interrupt, 'cancel')}>Cancel action</button>
      </div>}
      {isHitlApproval(interrupt.reason) && <div className="flex flex-wrap items-center gap-2" data-hitl-approval>
        <span className="whitespace-pre-wrap break-words font-semibold">{interrupt.reason as string}</span>
        <button type="button" className={smallButton} disabled={busy} onClick={() => quickReply(interrupt, 'yes')}>Approve</button>
        <button type="button" className={smallButton} disabled={busy} onClick={() => quickReply(interrupt, 'no')}>Deny</button>
      </div>}
      {!isHitlApproval(interrupt.reason) && <label className="block"><span className="block whitespace-pre-wrap break-words mb-2">{displayValue(interrupt.reason) || interrupt.id}</span>
        <textarea aria-label={`Response to ${interrupt.id}`} rows={2} className={compactInput} value={values[interrupt.id] ?? ''} onChange={(event) => setValues({ ...values, [interrupt.id]: event.target.value })} />
      </label>}
      {!isHitlApproval(interrupt.reason) && <label className="flex items-center gap-2"><input type="checkbox" checked={jsonMode[interrupt.id] ?? false} onChange={(event) => setJsonMode({ ...jsonMode, [interrupt.id]: event.target.checked })} />JSON response (object, list, number, boolean, or null)</label>}
    </div>)}
    {error && <p role="alert" className="mt-2 text-red-600">{error}</p>}
    <button className={`${smallButton} mt-3`} disabled={busy || !interrupts.length} type="submit">{busy ? 'Resuming…' : 'Submit and resume'}</button>
  </form>
}

export type UiActionHandler = (viewId: string, action: unknown, payload: unknown) => void

/** One panel message (Agent Panel, Build, and Ask Ron's writing chats). */
export function MessageBubble({ message, status, onUiAction, superseded }: { message: PanelMessage; status: RunStatus; onUiAction: UiActionHandler; superseded: ReadonlySet<string> }) {
  // A user message's prompt attachments (pastes, picked context) show as cards above its bubble.
  const sent = useMemo(() => {
    const cards = new Map<string, NonNullable<ReturnType<typeof parseAttachmentBlock>>>()
    if (message.role === 'user') for (const part of message.parts) {
      const attachment = part.kind === 'text' ? parseAttachmentBlock(part.text) : null
      if (attachment) cards.set(part.key, attachment)
    }
    return cards
  }, [message.parts, message.role])
  // Nested output of a chain tool (`think` for Perplexity, the tool fixer's `repair`) renders as a
  // chain-of-thought block; every other part renders flat.
  const items = useMemo(() => groupThinkParts(message.parts.filter((part) => !sent.has(part.key)), status === 'running'), [message.parts, sent, status])
  return <Message from={message.role}>
    {sent.size > 0 && <SentAttachments attachments={[...sent.values()]} />}
    {items.length > 0 && <MessageContent variant={message.role === 'assistant' ? 'flat' : 'contained'} className={cn('min-w-0 w-full', message.role === 'user' && 'group-[.is-user]:bg-surface-100 group-[.is-user]:text-ink dark:group-[.is-user]:bg-surface-800 dark:group-[.is-user]:text-ink-inverse')}>
      {items.map((item) => item.kind === 'think'
        ? <ThinkChain key={item.tool.key} tool={item.tool} steps={item.steps} running={status === 'running'} />
        : <PartView key={item.part.key} part={item.part} allParts={message.parts} isUser={message.role === 'user'} status={status} onUiAction={onUiAction} superseded={superseded.has(item.part.key)} />)}
    </MessageContent>}
  </Message>
}

/** Chain-tool labels: the `think` child reasons over a thought; `repair` is the tool fixer's run. */
const CHAIN_LABELS: Record<string, { streaming: string; title: string; input: string; output: string }> = {
  think: { streaming: 'Thinking…', title: 'Chain of Thought', input: 'Thought', output: 'Conclusion' },
  repair: { streaming: 'Repairing…', title: 'Repair', input: 'Tool', output: 'Result' },
}

/** Interleaved reasoning + tool use from a chain tool's child agent (`think`, `repair`), as AI Elements chain of thought. */
function ThinkChain({ tool, steps, running }: { tool: ToolPart; steps: ThinkStep[]; running: boolean }) {
  const labels = CHAIN_LABELS[tool.name] ?? CHAIN_LABELS.think
  const streaming = running && !tool.finished
  const input = tool.input as { thought?: unknown; tool?: unknown } | undefined
  const thought = displayValue(tool.name === 'repair' ? input?.tool : input?.thought)
  const conclusion = tool.finished ? displayValue(Array.isArray(tool.output) ? (tool.output as { text?: unknown }[]).map((b) => b.text ?? '').join('') : tool.output) : ''
  const failed = tool.status === 'error' || tool.status === 'failed'
  return <ChainOfThought className="my-3 space-y-2 text-xs" defaultOpen={streaming} isStreaming={streaming}>
    <ChainOfThoughtHeader>{streaming ? labels.streaming : failed ? `${labels.title} · failed` : labels.title}</ChainOfThoughtHeader>
    <ChainOfThoughtContent>
      {thought && <ChainOfThoughtStep label={labels.input} status="complete"><p className="whitespace-pre-wrap break-words text-xs text-ink-muted dark:text-ink-inverse-muted">{thought}</p></ChainOfThoughtStep>}
      {steps.map((step) => step.kind === 'tool'
        ? <ChainOfThoughtStep key={step.key} label={`Using ${step.tool.name}`} status={step.active ? 'active' : 'complete'}
            description={step.tool.finished ? (step.tool.status === 'error' ? 'failed' : 'done') : step.active ? 'running…' : undefined}>
            <details className="text-xs"><summary className="cursor-pointer text-ink-muted dark:text-ink-inverse-muted">input / output</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words">{displayValue(step.tool.input)}</pre>
              {step.tool.finished && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words opacity-80">{displayValue(step.tool.output)}</pre>}
            </details>
          </ChainOfThoughtStep>
        : <ChainOfThoughtStep key={step.key} label={step.kind === 'reasoning' ? 'Thinking' : 'Reasoning'} status={step.active ? 'active' : 'complete'}>
            <p className="whitespace-pre-wrap break-words text-xs text-ink-muted dark:text-ink-inverse-muted">{step.text}</p>
          </ChainOfThoughtStep>)}
      {tool.finished && <ChainOfThoughtStep label={failed ? 'Failed' : labels.output} status="complete">
        <p className="whitespace-pre-wrap break-words text-xs">{conclusion || '(no conclusion)'}</p>
      </ChainOfThoughtStep>}
    </ChainOfThoughtContent>
  </ChainOfThought>
}

function imageSearchFinalItemPresent(parts: PanelPart[]): boolean {
  return parts.some((p) => p.kind === 'native' && p.itemType === 'image_search_results' && (p as NativePart).item)
}

function webSearchFinalItemPresent(parts: PanelPart[]): boolean {
  return parts.some((p) => p.kind === 'native' && p.itemType === 'search_results' && (p as NativePart).item)
}

function xSearchFinalItemPresent(parts: PanelPart[]): boolean {
  return parts.some((p) => p.kind === 'native' && p.itemType === 'x_search_results' && (p as NativePart).item)
}

function PartView({ part, allParts, isUser, status, onUiAction, superseded }: { part: PanelPart; allParts: PanelPart[]; isUser: boolean; status: RunStatus; onUiAction: UiActionHandler; superseded: boolean }) {
  const path = part.path.length ? part.path.map(displayValue).join(' / ') : ''
  if (part.kind === 'tool' && part.name === RENDER_UI_TOOL && part.finished) {
    // The agent built a view: render it (sandboxed iframe or the component kit) instead of its JSON result.
    const view = uiViewFromOutput(part.output)
    if (view) return <UiView view={view} superseded={superseded} onAction={(action, payload) => onUiAction(view.viewId, action, payload)} />
  }
  if (part.kind === 'tool') {
    const failed = part.status === 'error' || part.status === 'failed'
    const toolState = part.finished ? failed ? 'output-error' : 'output-available' : status === 'running' ? 'input-available' : 'input-streaming'
    return <Tool className="my-3 overflow-hidden border-surface-200 dark:border-surface-700">
      <ToolHeader type="dynamic-tool" toolName={part.name} title={repairToolTitle(part) ?? part.name} state={toolState} />
      {!part.finished && status !== 'running' && <p className="px-3 pb-2 text-xs text-ink-muted dark:text-ink-inverse-muted">{status === 'interrupted' || status === 'checkpointed' ? 'Paused' : 'No result received'} </p>}
      {path && <p className="px-3 pb-2 text-[10px] text-ink-muted dark:text-ink-inverse-muted break-words">Node · {path}</p>}
      <ToolContent>
        <ToolInput input={part.input} />
        {part.progress.length > 0 && <div className="max-h-48 overflow-auto"><h4 className="text-xs font-medium mb-2">Progress</h4><pre className="whitespace-pre-wrap break-words text-xs">{part.progress.join('\n')}</pre></div>}
        {part.finished && <ToolOutput output={part.output ?? '(empty result)'} errorText={failed ? displayValue(part.output) || 'Tool failed' : undefined} />}
      </ToolContent>
    </Tool>
  }
  if (part.kind === 'native') {
    const streaming = status === 'running'
    if (!streaming && (part.itemType === 'response.reasoning.image_search_queries' || part.itemType === 'response.reasoning.image_search_results') && imageSearchFinalItemPresent(allParts)) {
      return null
    }
    if (!streaming && part.itemType === 'response.reasoning.search_web' && webSearchFinalItemPresent(allParts)) {
      return null
    }
    if (!streaming && part.itemType === 'response.reasoning.x_search' && xSearchFinalItemPresent(allParts)) {
      return null
    }
    return <NativeToolCard part={part} path={path} streaming={streaming} />
  }
  if (part.kind === 'retry') return <div className="my-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 p-2 text-xs"><p className="font-medium">{part.text}</p></div>
  if (part.discarded) return <details className="my-2 text-xs text-ink-muted dark:text-ink-inverse-muted"><summary className="cursor-pointer">Discarded attempt · {part.kind === 'reasoning' ? 'reasoning' : 'draft'}</summary><pre className="mt-2 whitespace-pre-wrap break-words opacity-60">{part.text}</pre></details>
  if (part.kind === 'reasoning') return <ReasoningChain text={part.text} path={path} streaming={status === 'running'} />
  if (part.kind === 'activity') return <details className="my-2 text-xs"><summary className="cursor-pointer truncate">{part.text.split('\n')[0] || 'Activity'}{path ? ` · ${path}` : ''}</summary><pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words">{part.text}</pre></details>
  if (isUser) {
    const article = parseArticle(part.text)
    return article ? <ArticleAttachmentCard article={article} /> : <p className="text-body-sm leading-relaxed whitespace-pre-wrap">{part.text}</p>
  }
  return <div className="my-2">{path && <p className="text-[10px] text-ink-muted dark:text-ink-inverse-muted">Node · {path}</p>}<MessageResponse>{part.text}</MessageResponse></div>
}

const NATIVE_LABELS: Record<string, string> = {
  search_results: 'Web search', x_search_results: 'X search', people_search_results: 'People search', finance_results: 'Finance search',
  fetch_url_results: 'Fetched page', sandbox_results: 'Sandbox', sandbox_write_file: 'Sandbox · wrote file',
  sandbox_read_file: 'Sandbox · read file', sandbox_edit_file: 'Sandbox · edited file', sandbox_apply_patch: 'Sandbox · patch',
  sandbox_glob: 'Sandbox · glob', sandbox_grep: 'Sandbox · grep', share_file: 'File', mcp_call: 'MCP call',
  mcp_list_tools: 'MCP tools', skill_loaded: 'Skill loaded', advisor_result: 'Advisor',
  'response.reasoning.search_web': 'Searching the web', 'response.reasoning.x_search': 'Searching X', 'response.reasoning.fetch_url': 'Fetching pages',
  'response.reasoning.sandbox': 'Running code', 'response.reasoning.people_search': 'Searching people',
  'response.reasoning.finance_search': 'Searching finance data', 'response.skill.loaded': 'Loading skill',
  image_search_results: 'Image search',
  'response.reasoning.image_search_queries': 'Searching for images',
  'response.reasoning.image_search_results': 'Image search results',
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object') : [])

const IMAGE_SEARCH_ITEM_TYPES = new Set(['image_search_results', 'response.reasoning.image_search_queries', 'response.reasoning.image_search_results'])
const SEARCH_ITEM_TYPES = new Set(['search_results', 'response.reasoning.search_web', 'x_search_results', 'response.reasoning.x_search'])

type ImageSearchHit = { image_url: string; origin_url?: string; title?: string }
type SearchHit = { url: string; title?: string; snippet?: string; source?: string }

function imageSearchQueries(part: NativePart): string[] {
  const queries: string[] = []
  const push = (val: unknown) => {
    if (Array.isArray(val)) queries.push(...val.filter((q): q is string => typeof q === 'string' && q.trim().length > 0))
  }
  push(part.item?.queries)
  for (const step of part.steps) {
    push(step.queries)
    if (step.item && typeof step.item === 'object') push((step.item as Record<string, unknown>).queries)
  }
  return [...new Set(queries)]
}

function imageSearchHits(part: NativePart): ImageSearchHit[] {
  const hits: ImageSearchHit[] = []
  const seen = new Set<string>()
  const push = (rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      const image_url = str(row.image_url)
      if (!image_url || seen.has(image_url)) continue
      seen.add(image_url)
      hits.push({ image_url, origin_url: str(row.origin_url), title: str(row.title) })
    }
  }
  if (part.item?.type === 'image_search_results') push(list(part.item.results))
  for (const step of part.steps) {
    push(list(step.results))
    if (step.item && typeof step.item === 'object') push(list((step.item as Record<string, unknown>).results))
  }
  return hits
}

function searchHitLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    if (host === 'x.com' || host === 'twitter.com') {
      const m = parsed.pathname.match(/^\/([^/]+)\/status\/(\d+)/)
      if (m) return m[1].toLowerCase() !== 'i' ? `@${m[1]} · ${m[2]}` : `X post · ${m[2]}`
    }
    return host || url
  } catch {
    return url
  }
}

function searchQueries(part: NativePart): string[] {
  const queries: string[] = []
  const push = (val: unknown) => {
    if (Array.isArray(val)) queries.push(...val.filter((q): q is string => typeof q === 'string' && q.trim().length > 0))
    else if (typeof val === 'string' && val.trim().length > 0) queries.push(val.trim())
  }
  push(part.item?.queries)
  push(part.item?.query)
  for (const step of part.steps) {
    push(step.queries)
    push(step.query)
    if (step.item && typeof step.item === 'object') {
      const stepItem = step.item as Record<string, unknown>
      push(stepItem.queries)
      push(stepItem.query)
    }
  }
  return [...new Set(queries)]
}

function searchHits(part: NativePart): SearchHit[] {
  const hits: SearchHit[] = []
  const seen = new Set<string>()
  const pushRows = (rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      const url = str(row.url)
      if (!url || seen.has(url)) continue
      seen.add(url)
      hits.push({ url, title: str(row.title) ?? searchHitLabel(url), snippet: str(row.snippet), source: str(row.source) })
    }
  }
  const pushUrls = (urls: unknown) => {
    if (!Array.isArray(urls)) return
    for (const entry of urls) {
      if (typeof entry !== 'string' || !entry.trim() || seen.has(entry.trim())) continue
      const url = entry.trim()
      seen.add(url)
      hits.push({ url, title: searchHitLabel(url) })
    }
  }
  if (part.item) {
    pushRows(list(part.item.results))
    pushUrls(part.item.urls)
  }
  for (const step of part.steps) {
    pushRows(list(step.results))
    pushUrls(step.urls)
    if (step.item && typeof step.item === 'object') {
      const stepItem = step.item as Record<string, unknown>
      pushRows(list(stepItem.results))
      pushUrls(stepItem.urls)
    }
  }
  return hits
}

function SearchNativeCard({ part, path, streaming }: { part: NativePart; path: string; streaming: boolean }) {
  const isXSearch = part.itemType === 'x_search_results' || part.itemType === 'response.reasoning.x_search' || str(part.item?.type) === 'x_search_results'
  const queries = searchQueries(part)
  const hits = searchHits(part)
  const images = imageSearchHits(part)
  const itemStatus = str(part.item?.status)
  const isPending = streaming && (!part.item || itemStatus === 'in_progress')
  const failed = itemStatus === 'failed' || itemStatus === 'timed_out' || Boolean(str(part.item?.error))
  const headerTitle = isXSearch
    ? (isPending && hits.length === 0 ? 'Searching X…' : failed ? 'X search · failed' : 'X search')
    : (isPending && hits.length === 0 ? 'Searching the web…' : failed ? 'Web search · failed' : 'Web search')
  return (
    <ChainOfThought className="my-3 space-y-2 text-xs" defaultOpen={isPending || hits.length > 0 || queries.length > 0 || images.length > 0} isStreaming={isPending}>
      <ChainOfThoughtHeader>
        {headerTitle}
        {path ? ` · ${path}` : ''}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {queries.length > 0 && (
          <ChainOfThoughtStep label={isXSearch ? 'X search queries' : 'Searching for'} status={isPending && hits.length === 0 ? 'active' : 'complete'}>
            <ChainOfThoughtSearchResults>
              {queries.map((query) => (
                <ChainOfThoughtSearchResult key={query}>{query}</ChainOfThoughtSearchResult>
              ))}
            </ChainOfThoughtSearchResults>
          </ChainOfThoughtStep>
        )}
        {hits.length > 0 && (
          <ChainOfThoughtStep label={isXSearch ? `X posts (${hits.length})` : `Sources (${hits.length})`} status={isPending ? 'active' : 'complete'}>
            <ChainOfThoughtSearchResults>
              {hits.map((hit) => (
                <ChainOfThoughtSearchResult key={hit.url} title={hit.snippet ?? hit.title ?? hit.url}>
                  <a href={hit.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {hit.title || searchHitLabel(hit.url)}
                  </a>
                </ChainOfThoughtSearchResult>
              ))}
            </ChainOfThoughtSearchResults>
          </ChainOfThoughtStep>
        )}
        {images.length > 0 && (
          <ChainOfThoughtStep label="Images" status={isPending ? 'active' : 'complete'}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {images.map((image) => (
                <ChainOfThoughtImage key={image.image_url} caption={image.title ?? image.origin_url}>
                  {image.origin_url ? (
                    <a href={image.origin_url} target="_blank" rel="noreferrer" className="block max-h-full max-w-full">
                      <img src={image.image_url} alt={image.title ?? 'Search result'} loading="lazy" referrerPolicy="no-referrer" className="max-h-full max-w-full object-contain" />
                    </a>
                  ) : (
                    <img src={image.image_url} alt={image.title ?? 'Search result'} loading="lazy" referrerPolicy="no-referrer" className="max-h-full max-w-full object-contain" />
                  )}
                </ChainOfThoughtImage>
              ))}
            </div>
          </ChainOfThoughtStep>
        )}
        {failed && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {str(part.item?.error) ?? (isXSearch ? 'X search failed.' : 'Web search failed.')}
          </p>
        )}
      </ChainOfThoughtContent>
    </ChainOfThought>
  )
}

function ImageSearchNativeCard({ part, path, streaming }: { part: NativePart; path: string; streaming: boolean }) {
  const queries = imageSearchQueries(part)
  const images = imageSearchHits(part)
  const itemStatus = str(part.item?.status)
  const isPending = streaming && (!part.item || itemStatus === 'in_progress')
  const failed = itemStatus === 'failed' || itemStatus === 'timed_out' || str(part.item?.error) === 'image_search_failed' || Boolean(str(part.item?.error))
  return (
    <ChainOfThought className="my-3 space-y-2 text-xs" defaultOpen={isPending || images.length > 0 || queries.length > 0} isStreaming={isPending}>
      <ChainOfThoughtHeader>
        {isPending && images.length === 0 ? 'Searching for images…' : failed ? 'Image search · failed' : 'Image search'}
        {path ? ` · ${path}` : ''}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {queries.length > 0 && (
          <ChainOfThoughtStep label="Queries" status={isPending && images.length === 0 ? 'active' : 'complete'}>
            <ChainOfThoughtSearchResults>
              {queries.map((query) => (
                <ChainOfThoughtSearchResult key={query}>{query}</ChainOfThoughtSearchResult>
              ))}
            </ChainOfThoughtSearchResults>
          </ChainOfThoughtStep>
        )}
        {images.length > 0 && (
          <ChainOfThoughtStep label="Results" status={isPending ? 'active' : 'complete'}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {images.map((image) => (
                <ChainOfThoughtImage key={image.image_url} caption={image.title ?? image.origin_url}>
                  {image.origin_url ? (
                    <a href={image.origin_url} target="_blank" rel="noreferrer" className="block max-h-full max-w-full">
                      <img src={image.image_url} alt={image.title ?? 'Search result'} loading="lazy" referrerPolicy="no-referrer" className="max-h-full max-w-full object-contain" />
                    </a>
                  ) : (
                    <img src={image.image_url} alt={image.title ?? 'Search result'} loading="lazy" referrerPolicy="no-referrer" className="max-h-full max-w-full object-contain" />
                  )}
                </ChainOfThoughtImage>
              ))}
            </div>
          </ChainOfThoughtStep>
        )}
        {failed && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {str(part.item?.error) && str(part.item?.error) !== 'image_search_failed' ? str(part.item?.error) : 'Image search failed.'}
          </p>
        )}
      </ChainOfThoughtContent>
    </ChainOfThought>
  )
}

/** Native provider server-side tool card: web/X/image search results, fetched pages, sandbox runs, files. */
export function NativeToolCard({ part, path, streaming = false }: { part: NativePart; path: string; streaming?: boolean }) {
  if (IMAGE_SEARCH_ITEM_TYPES.has(part.itemType)) {
    return <ImageSearchNativeCard part={part} path={path} streaming={streaming} />
  }
  if (SEARCH_ITEM_TYPES.has(part.itemType)) {
    return <SearchNativeCard part={part} path={path} streaming={streaming} />
  }
  const label = NATIVE_LABELS[part.itemType] ?? part.itemType.replace(/^response\./, '').replace(/[._]/g, ' ')
  const item = part.item
  const status = str(item?.status)
  const failed = status === 'failed' || status === 'timed_out'
  return <Tool className="my-3 overflow-hidden border-surface-200 dark:border-surface-700">
    <ToolHeader type="dynamic-tool" toolName={label} title={label} state={item ? (failed ? 'output-error' : 'output-available') : 'input-available'} />
    {path && <p className="px-3 pb-2 text-[10px] text-ink-muted dark:text-ink-inverse-muted break-words">Node · {path}</p>}
    <ToolContent>
      {!item && <ul className="px-3 pb-2 text-xs space-y-1">{part.steps.map((step, i) => {
        const queries = list(step.queries).length ? (step.queries as string[]) : Array.isArray(step.queries) ? step.queries as string[] : []
        const urls = Array.isArray(step.urls) ? step.urls as string[] : []
        return <li key={i} className="truncate">{queries.length ? queries.join(' · ') : urls.length ? urls.join(' · ') : str(step.name) ?? displayValue(step)}</li>
      })}</ul>}
      {item?.type === 'sandbox_results' && <div className="px-3 pb-3 text-xs space-y-2">
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-100 dark:bg-surface-850 p-2">{str(item.code)}</pre>
        {list(item.results).map((run, i) => <div key={i}>
          <p className="text-[10px] text-ink-muted dark:text-ink-inverse-muted">exit {String(run.exit_code)} · {String(run.duration_ms)} ms · {str(run.status)}</p>
          {str(run.stdout) && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{str(run.stdout)}</pre>}
          {str(run.stderr) && <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-red-600 dark:text-red-400">{str(run.stderr)}</pre>}
        </div>)}
      </div>}
      {(item?.type === 'search_results' || item?.type === 'people_search_results' || item?.type === 'finance_results') && <ol className="px-3 pb-3 text-xs space-y-1 list-decimal list-inside">
        {list(item.results).map((r, i) => <li key={i} className="truncate">{str(r.url) ? <a href={str(r.url)} target="_blank" rel="noreferrer" className="underline">{str(r.title) ?? str(r.url)}</a> : str(r.title) ?? displayValue(r)}{str(r.snippet) ? <span className="text-ink-muted dark:text-ink-inverse-muted"> — {str(r.snippet)?.slice(0, 140)}</span> : null}</li>)}
      </ol>}
      {item?.type === 'fetch_url_results' && <ul className="px-3 pb-3 text-xs space-y-1">{list(item.results).map((r, i) => <li key={i} className="truncate"><a href={str(r.url)} target="_blank" rel="noreferrer" className="underline">{str(r.title) ?? str(r.url)}</a></li>)}</ul>}
      {item?.type === 'share_file' && <p className="px-3 pb-3 text-xs">{str(item.url) ? <a href={str(item.url)} target="_blank" rel="noreferrer" className="underline">{str(item.filename) ?? 'Download file'}</a> : str(item.filename) ?? 'File'}{typeof item.bytes === 'number' ? <span className="text-ink-muted dark:text-ink-inverse-muted"> · {item.bytes} bytes</span> : null}</p>}
      {item && !['sandbox_results', 'search_results', 'people_search_results', 'finance_results', 'fetch_url_results', 'share_file'].includes(str(item.type) ?? '') && <ToolOutput output={item} errorText={failed ? status : undefined} />}
    </ToolContent>
  </Tool>
}

/** Split streamed reasoning into steps. Providers (Gemini, xAI) emit summaries as
 *  `**Heading**\n\nbody` blocks; anything unstructured becomes one step. */
function reasoningSteps(text: string): { label: string; body: string }[] {
  const steps: { label: string; body: string }[] = []
  const pattern = /\*\*([^*\n]+)\*\*\s*/g
  let match: RegExpExecArray | null
  let cursor = 0
  let label = ''
  while ((match = pattern.exec(text)) !== null) {
    const body = text.slice(cursor, match.index).trim()
    if (label || body) steps.push({ label: label || 'Thinking', body })
    label = match[1].trim()
    cursor = pattern.lastIndex
  }
  const tail = text.slice(cursor).trim()
  if (label || tail) steps.push({ label: label || 'Thinking', body: tail })
  return steps
}

function ReasoningChain({ text, path, streaming }: { text: string; path: string; streaming: boolean }) {
  const steps = useMemo(() => reasoningSteps(text), [text])
  return <ChainOfThought className="my-3 space-y-2 text-xs" defaultOpen={streaming} isStreaming={streaming}>
    <ChainOfThoughtHeader>{streaming ? 'Thinking…' : 'Chain of Thought'}{path ? ` · ${path}` : ''}</ChainOfThoughtHeader>
    <ChainOfThoughtContent>
      {steps.map((step, index) => <ChainOfThoughtStep key={`${index}-${step.label}`} label={step.label}
        status={streaming && index === steps.length - 1 ? 'active' : 'complete'}>
        {step.body && <p className="whitespace-pre-wrap break-words text-xs text-ink-muted dark:text-ink-inverse-muted">{step.body}</p>}
      </ChainOfThoughtStep>)}
    </ChainOfThoughtContent>
  </ChainOfThought>
}
