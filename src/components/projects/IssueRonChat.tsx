import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { LIVE_API_BASE_URL } from '@/lib/api-base'
import { useAuthStore } from '@/stores/authStore'
import { projectsRequestFor, useProjectsStore } from '@/stores/projectsStore'
import { projectEndpoint } from '@/lib/project-endpoint'
import { MessageBubble, ModeSelector, MODEL_SELECTOR_CLASS, PanelComposer, PanelRunNotices, usePanelComposer } from '@/components/agent-panel/AgentPanel'
import { DEFAULT_AGENT_MODEL, ModelSelector, useAgentModels, type AgentModelSelection } from '@/components/agent-panel/ModelSelector'
import { usePanelChat } from '@/components/agent-panel/usePanelChat'
import { ContextPicker } from '@/components/agent-panel/ContextPicker'
import { ComposerAttachmentTray } from '@/components/agent-panel/PromptAttachments'
import { useComposerAttachments } from '@/components/agent-panel/useComposerAttachments'
import { useContextSources } from '@/components/agent-panel/useContextSources'
import { TeachSkill } from '@/components/agent-panel/TeachSkill'
import { VoiceAgent } from '@/components/agent-panel/VoiceAgent'
import { RenMark } from '@/components/brand'
import { DEFAULT_RUNTIME_OPTIONS, panelStatusText } from '@/lib/panel-chat'
import { parsePanelCommand } from '@/lib/panel-commands'
import { supersededUiParts, uiActionText, type RuntimeOptions } from '@/lib/panel-stream'
import { articleDraftKey, useArticleDraftStore } from '@/stores/articleDraftStore'
import { liveKey, liveTurnsFor, useLiveSessionStore } from '@/stores/liveSessionStore'

interface IssueRonChatProps {
  issueId: string
  /** `KEY-12`, shown in the header. */
  issueKey: string
  /** Saved issue fields: the title for the header; title and description go to Live as read-only context. */
  issue: { title: string; description?: string }
  /** Unsaved issue edits. Ron only sees saved data, so nothing is sent until the issue is saved. */
  hasUnsavedChanges: boolean
}

const iconButton = 'flex size-8 items-center justify-center rounded-lg text-ink-secondary transition-colors duration-150 ease-out hover:bg-surface-100 hover:text-ink disabled:opacity-40 dark:text-ink-inverse-secondary dark:hover:bg-surface-850 dark:hover:text-ink-inverse'
const MUTED = 'text-ink-muted dark:text-ink-inverse-muted'
/** Warnings read in yellow-brown on paper and signal yellow on ink (AA in both). */
const WARNING = 'text-[12px] font-medium text-amber-800 dark:text-amber-300'

/**
 * The issue workspace's Ron tab: a chat with this issue's own agent (`destination: 'issue'`, one session per user
 * and issue), built from the Agent Panel's parts: streamed messages, tool cards, reasoning, render_ui views,
 * interrupts, checkpoints, steering, Stop, slash commands and the model / reasoning-effort picker. Live talks to the
 * same issue's agent scope; Teach Ron teaches it skills.
 */
export function IssueRonChat(props: IssueRonChatProps) {
  const { userId: projectsUser } = useProjectsStore()
  const user = useAuthStore((state) => state.user?.id || 'default')
  // An account or issue change starts from that pair's own conversation, draft and pending requests.
  return projectsUser
    ? <IssueChat key={`${user}:${projectsUser}:${props.issueId}`} user={user} projectsUser={projectsUser} {...props} />
    : <p className="p-6 text-[13px] text-ink-muted dark:text-ink-inverse-muted">Opening your workspace…</p>
}

function IssueChat({ user, projectsUser, issueId, issueKey, issue, hasUnsavedChanges }: IssueRonChatProps & { user: string; projectsUser: string }) {
  const [mode, setMode] = useState<'text' | 'voice'>('text')
  const [modeNotice, setModeNotice] = useState('')
  const liveHandOff = useRef<(() => Promise<boolean>) | null>(null)
  const registerHandOff = useCallback((handOff: (() => Promise<boolean>) | null) => { liveHandOff.current = handOff }, [])
  const liveTurns = useLiveSessionStore((state) => liveTurnsFor(state, liveKey(projectsUser, `issue:${issueId}`, issueId)))

  // Teach Ron and Live need the issue's owner id, read once through the Projects API (it also confirms access).
  const [owner, setOwner] = useState<{ id?: string; error?: string }>({})
  useEffect(() => {
    let ignore = false
    void (async () => {
      try {
        const data = await projectsRequestFor(projectsUser)<{ owner_id: string }>(`/issues/${issueId}/agent`)
        if (!ignore) setOwner({ id: data.owner_id })
      } catch (cause) {
        if (!ignore) setOwner({ error: cause instanceof Error ? cause.message : 'Access to this issue could not be checked.' })
      }
    })()
    return () => { ignore = true }
  }, [projectsUser, issueId])

  const { defaultModel, defaultProvider, refresh: refreshModels, ...modelCatalogue } = useAgentModels()
  const [selection, setSelection] = useState<AgentModelSelection>({ model: DEFAULT_AGENT_MODEL, provider: '', effort: '' })
  const [options, setOptions] = useState<RuntimeOptions>(DEFAULT_RUNTIME_OPTIONS)
  useEffect(() => {
    setSelection((current) => current.model === DEFAULT_AGENT_MODEL && !current.provider
      ? { model: defaultModel, provider: defaultProvider, effort: '' } : current)
  }, [defaultModel, defaultProvider])

  // The draft survives closing the issue (session storage), one per user and issue.
  const draftKey = articleDraftKey(user, 'issue', issueId)
  const input = useArticleDraftStore((state) => state.drafts[draftKey]?.text ?? '')
  const setInput = useCallback((value: string) => useArticleDraftStore.getState().setText(draftKey, value), [draftKey])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Long pastes and context attached with the link button or `@` (chats, issues, tabs, dates, interests, pages) go
  // with the next message as attachment cards.
  const attachments = useComposerAttachments(draftKey, user)
  const [mentionOpen, setMentionOpen] = useState(false)
  const mentionSources = useContextSources(mentionOpen)

  const chat = usePanelChat({ ...selection, destination: 'issue', issueId,
    promptAttachments: { count: attachments.count, resolve: attachments.forSend }, options })
  const model = chat.configuration?.model ?? selection.model
  const provider = chat.configuration?.provider ?? selection.provider
  const effort = chat.configuration?.effort ?? selection.effort
  const runtimeOptions = { ...options, ...chat.configuration?.options }
  const configurationLocked = Boolean(chat.configurationLocked) || chat.connection === 'loading'
  const { messages, status, sendMessage } = chat
  const active = status === 'running'
  const composer = usePanelComposer(input, setInput, inputRef, active ? undefined
    : { categories: mentionSources.categories, selected: attachments.contexts, onPick: attachments.addContext, onOpenChange: setMentionOpen })
  const paused = status === 'checkpointed' || status === 'interrupted'
  const unavailable = chat.connection !== 'connected' || chat.controlBusy || paused || chat.recoveryRequired
  // render_ui: a later render with the same view_id replaces the earlier one; an interaction inside a view is a
  // user turn (steering while a run is active), held back like any message while the issue has unsaved edits.
  const supersededViews = useMemo(() => supersededUiParts(messages), [messages])
  const onUiAction = useCallback((viewId: string, action: unknown, payload: unknown) => {
    if (!hasUnsavedChanges) void sendMessage(uiActionText(viewId, action, payload))
  }, [sendMessage, hasUnsavedChanges])

  // Ron edits the saved issue (content, child issues, links, work products): reload it when a run ends so the
  // workspace shows those changes. The workspace keeps unsaved edits and offers its review flow on a conflict.
  const { refreshFromServer } = useProjectsStore()
  const [reloadError, setReloadError] = useState('')
  const reloadIssue = useCallback(() => {
    void refreshFromServer().then((result) => setReloadError(result.error ? `Issue changes could not be reloaded: ${result.error}` : ''))
  }, [refreshFromServer])
  const wasRunning = useRef(false)
  useEffect(() => {
    if (active) { wasRunning.current = true; return }
    if (!wasRunning.current) return
    wasRunning.current = false
    reloadIssue()
  }, [active, reloadIssue])

  // Follow new output in this log only (scrollIntoView would also scroll the issue drawer around it), including
  // when the tab becomes visible or the drawer is resized.
  const scrollRef = useRef<HTMLDivElement>(null)
  const followOutput = useRef(true)
  useEffect(() => {
    const element = scrollRef.current
    if (element && followOutput.current) element.scrollTop = element.scrollHeight
  }, [messages, liveTurns])
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver(() => { if (followOutput.current) element.scrollTop = element.scrollHeight })
    observer.observe(element)
    return () => observer.disconnect()
  }, [mode])

  const switchMode = async (next: 'text' | 'voice') => {
    if (next === mode) return
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
    setMode(next)
  }

  const handleNewChat = () => {
    setModeNotice('')
    setSelection({ model, provider, effort })
    setOptions(runtimeOptions)
    chat.newChat()
    useArticleDraftStore.getState().resetComposer(draftKey)
    attachments.clearContexts()
    composer.reset()
    followOutput.current = true
  }

  // Attachments go with a new message, never with steering.
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
    if (!message.trim() || unavailable || hasUnsavedChanges || (active && attachments.count > 0)) return
    composer.setCommandFeedback('')
    followOutput.current = true
    const sentPasted = attachments.pasted.map((item) => item.id)
    const sentContexts = attachments.contexts.map((item) => item.id)
    void sendMessage(message, 'message', undefined, () => {
      useArticleDraftStore.getState().clearSent(draftKey, input, sentPasted)
      attachments.clearContexts(sentContexts)
    })
  }

  return <section aria-label={`Ren · ${issueKey}`} className="flex h-full min-h-0 min-w-0 flex-col text-ink dark:text-ink-inverse">
    <header className="flex-shrink-0 border-b border-surface-200 px-4 py-3 dark:border-surface-800">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <RenMark className="size-7" />
          <div className="min-w-0">
            <h2 className="truncate font-sans text-[14px] font-semibold leading-tight tracking-normal text-ink dark:text-ink-inverse" title={`${issueKey} · ${issue.title}`}>
              Ren <span className={`font-normal ${MUTED}`}>· <span className="font-mono text-[12px] tracking-[0.02em]">{issueKey}</span> · {issue.title}</span>
            </h2>
            <p role="status" className={`mt-0.5 truncate text-[11.5px] ${MUTED}`}>
              {panelStatusText({ connection: chat.connection, status, background: runtimeOptions.background })}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ModeSelector value={mode} onChange={(next) => void switchMode(next)} />
          <button type="button" onClick={reloadIssue} className={iconButton} title="Reload issue changes (keeps your unsaved edits)" aria-label="Reload issue changes">
            <RefreshCw className="size-4" /></button>
          {mode === 'text' && <button type="button" onClick={handleNewChat} className={iconButton} title="New chat" aria-label="New chat"><Plus className="size-4" /></button>}
        </div>
      </div>
      {mode === 'voice' && <p className={`mt-2 text-[11.5px] ${MUTED}`}>Live talks to this issue’s agent with the same tool limits · Live turns are not part of this chat</p>}
      {modeNotice && <p role="status" className={`mt-2 ${WARNING}`}>{modeNotice}</p>}
      {reloadError && <p role="alert" className="mt-2 text-[12px] text-red-700 dark:text-red-400">{reloadError}</p>}
    </header>
    {owner.id && <TeachSkill userId={owner.id} agentId={`issue:${issueId}`} apiBaseUrl={projectEndpoint(projectsUser, LIVE_API_BASE_URL)} />}

    {mode === 'voice' ? <div className="flex min-h-0 flex-1">
      {owner.id
        ? <VoiceAgent userId={projectsUser} agentScope={`issue:${issueId}`} sessionId={issueId} owner="issue-pane"
            issue={{ id: issueId, title: issue.title, description: issue.description }} registerHandOff={registerHandOff} />
        : <p className={`p-6 text-[13px] ${MUTED}`}>{owner.error ? `Live is unavailable: ${owner.error}` : 'Checking your access to this issue…'}</p>}
    </div> : <>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin px-4 py-4 space-y-4" onScroll={() => {
        const element = scrollRef.current
        if (element) followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100
      }}>
        {!messages.length && !active && <div className="flex h-full min-h-40 flex-col justify-center px-3">
          <div className="mb-5 flex items-center" aria-hidden>
            <RenMark className="size-11" />
          </div>
          <h3 className="mb-2 font-display text-display-sm font-extrabold leading-[1.05] tracking-[-0.035em] text-ink dark:text-ink-inverse">How can I help?</h3>
          <p className="max-w-md text-[14px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
            Ask me to edit this issue’s content, create child issues, link related issues, save work products, or work from its Context. I can’t change its status.
          </p>
        </div>}
        {messages.map((message) => <MessageBubble key={message.id} message={message} status={message.runId === chat.runId ? status : 'completed'} onUiAction={onUiAction} superseded={supersededViews} />)}
        {liveTurns.length > 0 && <section aria-label="Live turns (read-only)" className="rounded-xl border border-blurple-200 bg-blurple-50/60 p-3.5 text-[12.5px] text-ink dark:border-blurple-900 dark:bg-blurple-950/30 dark:text-ink-inverse">
          <p className="mb-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-secondary dark:text-ink-inverse-secondary">Live · {liveTurns.length} turn{liveTurns.length === 1 ? '' : 's'} · not part of this chat</p>
          <ul className="space-y-2">{liveTurns.map((turn) => <li key={turn.id} className="flex gap-2.5"><span className="w-8 shrink-0 font-semibold">{turn.role === 'user' ? 'You' : 'Ren'}</span><span className="min-w-0 whitespace-pre-wrap break-words leading-relaxed">{turn.text}</span></li>)}</ul>
        </section>}
        {active && <div role="status" className={`flex items-center gap-2 text-[12px] ${MUTED}`}><span className="size-1.5 rounded-full bg-volt" aria-hidden />Run in progress · send a message to steer</div>}
      </div>

      <PanelRunNotices chat={chat} />

      <footer className="flex-shrink-0 border-t border-surface-200 px-4 pb-4 pt-3 dark:border-surface-800">
        {hasUnsavedChanges && <p role="status" className={`mb-2 ${WARNING}`}>Save your issue draft before sending to Ren. Ren only sees saved data.</p>}
        {active && attachments.count > 0 && <p className={`mb-2 text-xs ${MUTED}`}>Your attachments are saved for the next message. Wait for this run to finish or stop it.</p>}
        <PanelComposer composer={composer} active={active} onPaste={attachments.onPaste}
          label={active ? 'Steer the active run' : `Message Ren about ${issueKey}`}
          placeholder={paused ? 'Resume the run above…' : active ? 'Guide the active run…' : 'What should Ren do for this issue? / for commands · @ for context'}
          disabled={paused || chat.recoveryRequired} onSend={handleSend} sendDisabled={!message.trim() || unavailable || hasUnsavedChanges || (active && attachments.count > 0)}
          onStop={() => void chat.stop()} stopDisabled={chat.controlBusy}
          before={<ComposerAttachmentTray attachments={attachments} className="pb-2.5" />}
          tools={<>
            {!active && <ContextPicker selectedContexts={attachments.contexts} onContextsChange={attachments.setContexts} />}
            <ModelSelector value={model} provider={provider} effort={effort} {...modelCatalogue} disabled={configurationLocked}
              onChange={(model, provider, effort) => setSelection({ model, provider, effort })}
              onOpen={refreshModels} className={MODEL_SELECTOR_CLASS} />
          </>} />
      </footer>
    </>}
  </section>
}
