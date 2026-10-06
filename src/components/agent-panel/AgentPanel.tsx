import { useState, useRef, useEffect, useCallback, useMemo, Fragment, type KeyboardEvent } from 'react'
import { Transition } from '@headlessui/react'
import { XMarkIcon, PlusIcon, StopIcon } from '@heroicons/react/24/outline'
import { useAgentUi } from '@/context/AgentUiContext'
import { usePanelAgentStore } from '@/stores/panelAgentStore'
import { cn } from '@/utils/cn'
import { IDE, type IDEFile } from '@/components/ai-elements/ide'
import { Message, MessageContent } from '@/components/ai-elements/message'
import { MessageResponse } from '@/components/ai-elements/response'
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtHeader, ChainOfThoughtImage, ChainOfThoughtSearchResult, ChainOfThoughtSearchResults, ChainOfThoughtStep } from '@/components/ai-elements/chain-of-thought'
import { detectPreviewUrl, fileFromToolCall, filesFromListDir, getToolView, toolOutputText } from '@/components/ai-elements/ide-tool-mapping'
import { displayValue, groupThinkParts, isBrowserUnavailable, type BrowserSelection, type NativePart, type PanelInterrupt, type PanelMessage, type PanelPart, type RunStatus, type RuntimeOptions, type ThinkStep, type ToolPart } from '@/lib/panel-stream'
import { ContextPicker, SelectedContexts, type ContextItem } from './ContextPicker'
import { DEFAULT_AGENT_MODEL, ModelSelector, useAgentModels, type AgentModelSelection } from './ModelSelector'
import { usePanelChat } from './usePanelChat'
import { useAuthStore } from '@/stores/authStore'
import { AGENT_LABELS, parseArticle, type AgentDestination } from '@/lib/articles'
import { articleDraftKey, EMPTY_ARTICLE_DRAFT, useArticleDraftStore } from '@/stores/articleDraftStore'
import { ArticleAttachmentCard } from '@/components/interests/ArticleAttachmentCard'
import { VoiceAgent } from './VoiceAgent'
import { Checkpoint, CheckpointIcon, CheckpointTrigger } from '@/components/ai-elements/checkpoint'
import { PANEL_COMMANDS, parsePanelCommand } from '@/lib/panel-commands'
import { historyFromMessages } from '@/lib/voice-events'
import { OubliStage } from './OubliStage'
import { flashAsking, useMascotStore } from '@/stores/mascotStore'
import { liveKey, liveTurnsFor, unsharedLiveTurns, useLiveSessionStore } from '@/stores/liveSessionStore'
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from '@catalyst/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@catalyst/table'
import type { RepairProposal, RepairReady } from '@/lib/panel-stream'

const compactInput = 'w-full rounded-lg border border-surface-200 bg-white/70 px-2 py-1.5 text-xs dark:border-surface-700 dark:bg-surface-850 focus:outline-none focus:ring-2 focus:ring-indigo-500/30'
const smallButton = 'rounded-lg border border-surface-200 px-3 py-1.5 text-xs font-medium hover:bg-indigo-50 disabled:opacity-50 dark:border-surface-700 dark:hover:bg-surface-800'
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

export function AgentWorkspace({ destination }: { destination: AgentDestination }) {
  const user = useAuthStore((state) => state.user?.id || 'default')
  return <AgentConversation key={`${user}:${destination}`} destination={destination} embedded />
}

export function AgentConversation({ destination, embedded = false }: { destination: AgentDestination; embedded?: boolean }) {
  const { isPanelOpen, closePanel, askRonPendingPrompt, consumeAskRonPendingPrompt,
    closeAskRon, agentPanelQueuedPrompts, consumeAgentPanelPrompt,
    interactionMode, setInteractionMode } = useAgentUi()
  const voice = interactionMode === 'voice'
  const liveHandOff = useRef<(() => Promise<boolean>) | null>(null)
  const registerHandOff = useCallback((handOff: (() => Promise<boolean>) | null) => { liveHandOff.current = handOff }, [])
  const [modeNotice, setModeNotice] = useState('')
  const { panelWidth, setPanelWidth, setPanelMode } = usePanelAgentStore()
  const user = useAuthStore((state) => state.user?.id || 'default')
  const draftKey = articleDraftKey(user, destination)
  const draft = useArticleDraftStore((state) => state.drafts[draftKey] || EMPTY_ARTICLE_DRAFT)
  const setInput = useCallback((value: string | ((current: string) => string)) => {
    const store = useArticleDraftStore.getState()
    store.setText(draftKey, typeof value === 'function' ? value(store.drafts[draftKey]?.text || '') : value)
  }, [draftKey])
  const { defaultModel, defaultProvider, refresh: refreshModels, ...modelCatalogue } = useAgentModels()
  const [selection, setSelection] = useState<AgentModelSelection>({ model: DEFAULT_AGENT_MODEL, provider: '', effort: '' })
  const [selectedContexts, setSelectedContexts] = useState<ContextItem[]>([])
  const [options, setOptions] = useState<RuntimeOptions>({
    checkpointing: false, tool_execution: 'concurrent', context: 'auto', goal: '', background: false,
  })
  // Live ↔ Chat shared history lives in liveSessionStore, keyed per user/scope/conversation.
  // Chat shows the final Live turns read-only; only not-yet-shared turns go out as context.
  // The key is read through a ref so usePanelChat's selection sees the current session id.
  const liveKeyRef = useRef('')
  const liveUnsharedRef = useRef<ReturnType<typeof unsharedLiveTurns>>([])
  const clearSentContexts = useCallback(() => {
    setSelectedContexts([])
    const store = useLiveSessionStore.getState()
    store.markShared(liveKeyRef.current, liveTurnsFor(store, liveKeyRef.current).length)
  }, [])
  const [commandFeedback, setCommandFeedback] = useState('')
  const [commandIndex, setCommandIndex] = useState(0)
  const [commandsDismissed, setCommandsDismissed] = useState(false)
  const chat = usePanelChat({ ...selection, destination, attachments: draft.articles,
    contexts: selectedContexts, liveHistory: liveUnsharedRef.current, options, onSent: clearSentContexts })
  const liveHistoryKey = liveKey(user, destination, chat.sessionId)
  liveKeyRef.current = liveHistoryKey
  const liveTurns = useLiveSessionStore((s) => liveTurnsFor(s, liveHistoryKey))
  const liveUnshared = useMemo(() => unsharedLiveTurns(useLiveSessionStore.getState(), liveHistoryKey), [liveHistoryKey, liveTurns])
  liveUnsharedRef.current = liveUnshared
  const model = chat.configuration?.model ?? selection.model
  const provider = chat.configuration?.provider ?? selection.provider
  const effort = chat.configuration?.effort ?? selection.effort
  const runtimeOptions = { ...options, ...chat.configuration?.options }
  const configurationLocked = Boolean(chat.configurationLocked) || chat.connection === 'loading'
  const { messages, status, sendMessage } = chat
  const active = status === 'running'
  const paused = status === 'checkpointed' || status === 'interrupted'
  const unavailable = chat.connection !== 'connected' || chat.controlBusy || paused || chat.recoveryRequired
  const input = draft.text
  const commandSuggestions = !commandsDismissed && /^\/\S*$/.test(input)
    ? PANEL_COMMANDS.filter((command) => command.name.startsWith(input)) : []
  const selectedCommand = Math.min(commandIndex, Math.max(0, commandSuggestions.length - 1))
  const inputRef = useRef<HTMLTextAreaElement>(null)
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

  // Oubli reacts to the text agent: running = processing, an unfinished tool = working, and the
  // newest reasoning text streams into his thought bubble (deltas only; a new part resets it).
  const reasoningSeen = useRef<{ key: string; length: number } | null>(null)
  useEffect(() => {
    if (destination !== 'panel' || voice) return
    const mascot = useMascotStore.getState()
    const last = messages[messages.length - 1]
    const working = active && (last?.parts.some((part) => part.kind === 'tool' && !part.finished) ?? false)
    mascot.set({ processing: active, working })
    const reasoning = last?.role === 'assistant' ? [...last.parts].reverse().find((part) => part.kind === 'reasoning' && !part.discarded) : undefined
    if (reasoning && reasoning.kind === 'reasoning' && active) {
      const seen = reasoningSeen.current
      if (!seen || seen.key !== reasoning.key) { mascot.thought({ kind: 'clear' }); mascot.thought({ kind: 'delta', text: reasoning.text }) }
      else if (reasoning.text.length > seen.length) mascot.thought({ kind: 'delta', text: reasoning.text.slice(seen.length) })
      reasoningSeen.current = { key: reasoning.key, length: reasoning.text.length }
    } else if (!active && reasoningSeen.current) { mascot.thought({ kind: 'settle' }); reasoningSeen.current = null }
  }, [messages, active, destination, voice])
  useEffect(() => () => { if (destination === 'panel') useMascotStore.getState().set({ processing: false, working: false }) }, [destination])

  const dispatchExternal = useCallback((text: string) => {
    flashAsking()
    // Native steering applies immediately; no second /chat invocation while running.
    const id = sessionRef.current
    void sendMessage(text).then((sent) => { if (!sent && sessionRef.current === id) setInput((current) => current || text) })
  }, [sendMessage])
  // External prompts go to the VISIBLE mode only. While Live is shown they are
  // handed to VoiceAgent (below); the hidden Chat session never receives them.
  useEffect(() => {
    if (voice || destination !== 'panel' || unavailable || chat.connection !== 'connected' || !agentPanelQueuedPrompts.length) return
    if (draft.articles.length) return
    const prompt = consumeAgentPanelPrompt()
    if (prompt) dispatchExternal(prompt)
  }, [voice, destination, draft.articles.length, agentPanelQueuedPrompts, consumeAgentPanelPrompt, dispatchExternal, unavailable, chat.connection])
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
  const sharedHistory = useMemo(() => historyFromMessages(messages), [messages])
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

  const handleNewChat = async () => {
    // A new conversation must not tear down a Live session through the
    // conversationId prop effect while tools are pending: hand off first.
    if (liveHandOff.current) {
      const done = await liveHandOff.current()
      if (!done) { setModeNotice('Live is still working. Wait for pending tools or press Stop in Live before starting a new chat.'); return }
    }
    setModeNotice('')
    setSelection({ model, provider, effort })
    setOptions(runtimeOptions)
    sessionRef.current = ''
    chat.newChat()
    setSelectedContexts([])
    setInput('')
    setCommandFeedback('')
    setCommandsDismissed(false)
    followOutput.current = true
    focusComposer(inputRef.current)
  }
  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    const command = parsePanelCommand(text, runtimeOptions, configurationLocked)
    if (command.kind !== 'message') {
      setCommandFeedback(command.message)
      if (command.kind === 'configure') {
        setOptions(command.options)
        setInput('')
      }
      return
    }
    if (unavailable || (active && draft.articles.length > 0)) return
    setCommandFeedback('')
    followOutput.current = true
    flashAsking()
    void sendMessage(text, 'message', undefined, () => {
      useArticleDraftStore.getState().clearSent(draftKey, input, draft.articles.map((article) => article.id))
    })
  }
  const chooseCommand = (name: string) => {
    setInput(`${name} `)
    setCommandFeedback('')
    focusComposer(inputRef.current)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
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
      event.preventDefault(); handleSend()
    }
  }

  return (
    <Transition.Root show={embedded || isPanelOpen} as={Fragment}>
      <div className={embedded ? 'relative flex h-full min-h-0' : 'absolute inset-0 z-50 flex pointer-events-none'}>
        <Transition.Child as={Fragment}
          enter="transform transition ease-smooth duration-400" enterFrom="translate-x-full" enterTo="translate-x-0"
          leave="transform transition ease-smooth duration-400" leaveFrom="translate-x-0" leaveTo="translate-x-full">
          <section aria-label={AGENT_LABELS[destination]} className="relative ml-auto h-full max-w-full pointer-events-auto transition-all duration-300 ease-in-out" style={{ width: embedded ? '100%' : panelWidth }}>
            <div className="h-full flex flex-col bg-white/95 dark:bg-surface-900/95 text-ink dark:text-ink-inverse backdrop-blur-xl border-l border-indigo-200/50 dark:border-indigo-900/50 shadow-2xl">
              <header className="flex-shrink-0 px-4 py-4 border-b border-indigo-100/50 dark:border-surface-800 bg-gradient-to-r from-white/50 via-indigo-50/30 to-white/50 dark:from-surface-900/50 dark:via-indigo-950/20 dark:to-surface-900/50">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 flex items-center justify-center shadow-lg shadow-indigo-600/30 text-white font-display">R</div>
                    <div className="min-w-0"><h2 className="text-lg font-semibold">{AGENT_LABELS[destination]}</h2>
                      <p role="status" className="text-[11px] text-ink-muted dark:text-ink-inverse-muted">
                        {chat.connection === 'loading' ? 'Restoring session…' : chat.connection === 'reconnecting' ? 'Reconnecting to run…' :
                          chat.connection === 'detached' ? 'Disconnected · run may still be active' :
                          active ? runtimeOptions.background ? 'Working · background enabled' : 'Working' :
                          status === 'checkpointed' ? 'Paused at checkpoint' : status === 'interrupted' ? 'Waiting for your response' :
                          status === 'cancelled' ? 'Stopped' : status === 'error' ? 'Run failed' : status === 'completed' ? 'Completed' : 'Ready'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <ModeSelector value={interactionMode} onChange={(next) => void switchMode(next)} />

                    {active && <button onClick={() => void chat.stop()} disabled={chat.controlBusy} className={smallButton} aria-label="Stop agent run"><StopIcon className="inline w-3 h-3 mr-1" />Stop</button>}
                    <button onClick={() => void handleNewChat()} className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800" title="New chat" aria-label="New chat"><PlusIcon className="w-5 h-5" /></button>
                    {!embedded && <button onClick={closePanel} className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800" title="Close" aria-label="Close agent panel"><XMarkIcon className="w-5 h-5" /></button>}
                  </div>
                </div>
                <div className="mt-3 flex min-w-0 items-center gap-1.5">
                  {voice
                    ? <p className="min-w-0 flex-1 truncate text-[11px] text-ink-muted dark:text-ink-inverse-muted">Live model, voice and effort are chosen below · Chat model unchanged</p>
                    : <ModelSelector value={model} provider={provider} effort={effort} includeEffort {...modelCatalogue} disabled={configurationLocked}
                        onChange={(model, provider, effort) => setSelection({ model, provider, effort })}
                        onOpen={refreshModels} className="min-w-0 flex-1" />}
                  <BrowserTargetSelector value={chat.browser} onChange={chat.setBrowser} locked={chat.browserLocked || chat.connection === 'loading' || voice} />
                </div>
                {modeNotice && <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-300">{modeNotice}</p>}
              </header>

              {voice ? <div className="flex min-h-0 flex-1">
                <VoiceAgent userId={user} agentScope={destination} browser={chat.browser} conversationId={chat.sessionId} owner={`${destination}-panel`}
                  sharedHistory={sharedHistory} registerHandOff={registerHandOff}
                  externalPrompt={liveExternalPrompt} onExternalPromptConsumed={consumeLiveExternal} />
              </div> : <>
              <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-4 space-y-4" onScroll={() => {
                const element = scrollRef.current
                if (element) followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100
              }}>
                {!messages.length && !active && <div className="h-full min-h-40 flex flex-col items-center justify-center px-6">
                  <OubliStage pinned className="mb-4" />
                  <h3 className="text-display-sm font-display font-light text-center mb-2">How can I help?</h3>
                  <p className="text-body-sm text-ink-muted dark:text-ink-inverse-muted text-center">Browse, search, analyze, and accomplish.</p>
                </div>}
                {messages.map((message) => <MessageBubble key={message.id} message={message} status={message.runId === chat.runId ? status : 'completed'} />)}
                {liveTurns.length > 0 && <LiveTurnsReadOnly turns={liveTurns} unshared={liveUnshared.length} />}
                {(ideState.files.length > 0 || ideState.output) && <details className="rounded-xl border border-surface-200 dark:border-surface-700 p-3">
                  <summary className="cursor-pointer text-xs font-medium">Workspace · files and terminal</summary>
                  <IDE className="mt-3 max-h-[420px]" files={ideState.files} output={ideState.output} isStreaming={active} previewUrl={ideState.previewUrl} title="Workspace" />
                </details>}
                {active && <div role="status" className="flex items-center gap-2 text-xs text-ink-muted dark:text-ink-inverse-muted"><span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />Run in progress · send a message to steer</div>}
                <div ref={messagesEndRef} />
              </div>
              {/* Oubli peeks out from the panel edge whenever Ron is asked something or is working. */}
              {(messages.length > 0 || active) && destination === 'panel' && <OubliStage className="-mb-1 shrink-0" />}

              {chat.historyIncomplete && <div role="status" className="mx-4 mb-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-xs">
                {active || chat.followPending
                  ? 'Replay gap: some live text and progress are unavailable. Completed SDK messages are shown; canonical history refreshes when the run finishes.'
                  : 'Replay gap: canonical history has been refreshed. Some live progress and nested events could not be recovered.'}
              </div>}
              {(chat.error || chat.transportError) && <div role="alert" className="mx-4 mb-3 rounded-xl border border-red-300/60 bg-red-50/80 p-3 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200">
                <p className="whitespace-pre-wrap break-words">{chat.error || chat.transportError}</p>
                {chat.error && chat.transportError && <p className="mt-1">{chat.transportError}</p>}
                {chat.connection === 'detached' && <button className={`${smallButton} mt-2`} onClick={chat.reconnect}>Reconnect</button>}
              </div>}
              {status === 'checkpointed' && <Checkpoint className="mx-4 mb-3" aria-label="Native checkpoint">
                <CheckpointIcon />
                <CheckpointTrigger disabled={chat.connection !== 'connected' || chat.controlBusy || chat.recoveryRequired}
                  onClick={() => void sendMessage('', 'checkpoint_resume')}>Resume checkpoint</CheckpointTrigger>
              </Checkpoint>}
              {status === 'interrupted' && <InterruptForm key={`${chat.sessionId}-${chat.runId}`} interrupts={chat.interrupts}
                onSubmit={(responses) => sendMessage('', 'interrupt_response', responses)} />}
              {chat.repairProposal && <RepairProposalAlert proposal={chat.repairProposal} busy={chat.controlBusy || active}
                onRepair={() => void chat.repairAction('repair', chat.repairProposal!.tool)}
                onDismiss={() => void chat.repairAction('dismiss', chat.repairProposal!.tool)} />}
              {chat.repairReady && <RepairReadyAlert ready={chat.repairReady} busy={chat.controlBusy}
                onActivate={() => void chat.repairAction('activate', chat.repairReady!.tool, chat.repairReady!.rev)}
                onDiscard={() => void chat.repairAction('dismiss', chat.repairReady!.tool)} />}

              <footer className="flex-shrink-0 p-4 border-t border-indigo-100/50 dark:border-surface-800/80 bg-white/60 dark:bg-surface-900/60">
                <div className="max-h-48 overflow-auto">{draft.articles.map((article) => <ArticleAttachmentCard key={article.id} article={article}
                  onRemove={() => useArticleDraftStore.getState().remove(draftKey, article.id)} />)}</div>
                {active && draft.articles.length > 0 && <p className="mb-2 text-xs text-ink-muted">Your attachments are saved for the next message. Wait for this run to finish or stop it.</p>}
                <div className={cn('relative rounded-2xl border transition-all bg-white dark:bg-surface-850', input ? 'border-indigo-300 dark:border-indigo-700 shadow-md shadow-indigo-500/10 ring-2 ring-indigo-500/10' : 'border-surface-200/80 dark:border-surface-700 shadow-sm')}>
                  {commandSuggestions.length > 0 && <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-surface-200 bg-white p-1 shadow-lg dark:border-surface-700 dark:bg-surface-900" aria-label="Prompt commands">
                    {commandSuggestions.map((command, index) => <button key={command.name} type="button"
                      aria-current={selectedCommand === index ? 'true' : undefined}
                      onMouseDown={(event) => event.preventDefault()} onClick={() => chooseCommand(command.name)}
                      className={cn('block w-full rounded-lg px-3 py-2 text-left text-xs', selectedCommand === index && 'bg-indigo-50 dark:bg-surface-800')}>
                      <span className="font-semibold">{command.usage}</span><span className="mt-1 block text-ink-muted dark:text-ink-inverse-muted">{command.description}</span>
                    </button>)}
                  </div>}
                  <SelectedContexts contexts={selectedContexts} onRemove={(id) => setSelectedContexts((previous) => previous.filter((item) => item.id !== id))} className="px-3 pt-3" />
                  <div className="flex items-center gap-2 px-3 py-2">
                    {!active && <ContextPicker selectedContexts={selectedContexts} onContextsChange={setSelectedContexts} />}
                    <textarea ref={inputRef} value={input} onChange={(event) => { setInput(event.target.value); setCommandIndex(0); setCommandsDismissed(false); setCommandFeedback('') }} onKeyDown={handleKeyDown}
                      aria-label={active ? 'Steer the active run' : 'Message Ron'} placeholder={paused ? 'Resume the run above…' : active ? 'Guide the active run…' : 'Ask anything… / for commands'}
                      disabled={paused || chat.recoveryRequired} rows={1} className="flex-1 min-w-0 resize-none py-1.5 bg-transparent text-body-md placeholder:text-ink-muted/60 outline-none min-h-[32px] max-h-32" />
                    <button onClick={handleSend} disabled={!input.trim() || unavailable || (active && draft.articles.length > 0)} aria-label={active ? 'Send steering' : 'Send message'}
                      className="shrink-0 rounded-lg bg-ink dark:bg-ink-inverse text-white dark:text-surface-900 px-3 h-8 text-xs font-semibold disabled:opacity-30">{active ? 'Steer' : 'Send'}</button>
                  </div>
                </div>
                {commandFeedback && <p role="status" className="mt-2 text-xs text-ink-muted dark:text-ink-inverse-muted">{commandFeedback}</p>}
                <p className="text-center text-[10px] text-ink-muted dark:text-ink-inverse-muted mt-2">{active ? 'Steering updates the current run' : '↵ to send · Shift + ↵ for a new line'}</p>
              </footer>
              </>}
            </div>
          </section>
        </Transition.Child>
      </div>
    </Transition.Root>
  )
}

const BROWSER_TARGETS: readonly { id: BrowserSelection; label: string }[] = [
  { id: 'user', label: 'Your browser' },
  { id: 'cloud', label: 'Cloud browser' },
]
const BROWSER_LOCKED_TITLE = 'Locked for this chat — start a new chat to switch'
const MODES: readonly { id: 'text' | 'voice'; label: string; title: string }[] = [
  { id: 'text', label: 'Chat', title: 'Text chat with the panel agent' },
  { id: 'voice', label: 'Live', title: 'Gemini Live voice session sharing this conversation' },
]

/** Final Live turns for this conversation, viewable in Chat. Not SDK messages: never sent as history, only as bounded context. */
function LiveTurnsReadOnly({ turns, unshared }: { turns: { id: string; role: 'user' | 'assistant'; text: string; kind: 'transcript' | 'text' }[]; unshared: number }) {
  return <section aria-label="Live turns (read-only)" className="rounded-xl border border-indigo-200/60 bg-indigo-50/30 p-3 text-xs dark:border-indigo-900 dark:bg-indigo-950/10">
    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
      Live · {turns.length} turn{turns.length === 1 ? '' : 's'}{unshared ? ` · ${unshared} will be shared as context with your next message` : ' · shared with Chat'}
    </p>
    <ul className="space-y-2">{turns.map((turn) => <li key={turn.id} className="flex gap-2">
      <span className="shrink-0 font-semibold">{turn.role === 'user' ? 'You' : 'Ron'}</span>
      <span className="min-w-0 whitespace-pre-wrap break-words">{turn.text}</span>
      <span className="ml-auto shrink-0 text-[10px] uppercase opacity-60">{turn.kind === 'transcript' ? 'speech' : 'text'}</span>
    </li>)}</ul>
  </section>
}

/** Chat / Live segmented control. The parent gates the switch on in-flight work. */
export function ModeSelector({ value, onChange }: { value: 'text' | 'voice'; onChange: (value: 'text' | 'voice') => void }) {
  return <div role="group" aria-label="Interaction mode"
    className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-xl border border-surface-200/80 bg-white/70 p-0.5 text-xs shadow-sm dark:border-surface-700 dark:bg-surface-850/80">
    {MODES.map((mode) => {
      const selected = mode.id === value
      return <button key={mode.id} type="button" aria-pressed={selected} title={mode.title} onClick={() => onChange(mode.id)}
        className={cn('h-full rounded-[10px] px-2.5 font-semibold transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-surface-900',
          selected ? 'bg-indigo-600 text-white shadow-sm dark:bg-indigo-500' : 'text-ink-muted hover:bg-indigo-50 hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-surface-800 dark:hover:text-ink-inverse')}>
        {mode.label}
      </button>
    })}
  </div>
}

/** Two-option segmented control; the server pins the choice once a run is reserved. */
export function BrowserTargetSelector({ value, onChange, locked }: {
  value: BrowserSelection; onChange: (value: BrowserSelection) => void; locked: boolean
}) {
  return <div role="group" aria-label="Browser target" title={locked ? BROWSER_LOCKED_TITLE : 'Which browser the agent drives for this chat'}
    className={cn('inline-flex h-9 shrink-0 items-center gap-0.5 rounded-xl border border-surface-200/80 bg-white/70 p-0.5 text-xs shadow-sm dark:border-surface-700 dark:bg-surface-850/80', locked && 'opacity-60')}>
    {BROWSER_TARGETS.map((target) => {
      const selected = target.id === value
      return <button key={target.id} type="button" disabled={locked} aria-pressed={selected} onClick={() => onChange(target.id)}
        title={locked ? BROWSER_LOCKED_TITLE : undefined}
        className={cn('h-full rounded-[10px] px-2.5 font-semibold transition-colors disabled:cursor-not-allowed',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-surface-900',
          selected ? 'bg-indigo-600 text-white shadow-sm dark:bg-indigo-500' : 'text-ink-muted hover:bg-indigo-50 hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-surface-800 dark:hover:text-ink-inverse')}>
        {target.label}
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
  const quickReply = (target: PanelInterrupt, response: 'continue' | 'cancel') => submit(interrupts.map((interrupt) => ({
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
      <label className="block"><span className="block whitespace-pre-wrap break-words mb-2">{displayValue(interrupt.reason) || interrupt.id}</span>
        <textarea aria-label={`Response to ${interrupt.id}`} rows={2} className={compactInput} value={values[interrupt.id] ?? ''} onChange={(event) => setValues({ ...values, [interrupt.id]: event.target.value })} />
      </label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={jsonMode[interrupt.id] ?? false} onChange={(event) => setJsonMode({ ...jsonMode, [interrupt.id]: event.target.checked })} />JSON response (object, list, number, boolean, or null)</label>
    </div>)}
    {error && <p role="alert" className="mt-2 text-red-600">{error}</p>}
    <button className={`${smallButton} mt-3`} disabled={busy || !interrupts.length} type="submit">{busy ? 'Resuming…' : 'Submit and resume'}</button>
  </form>
}

function MessageBubble({ message, status }: { message: PanelMessage; status: RunStatus }) {
  // Provider-neutral: nested output of a chain tool (`think` for Perplexity, the `recall`
  // memory subagent everywhere) renders as a chain-of-thought block; every other part renders flat.
  const items = useMemo(() => groupThinkParts(message.parts, status === 'running'), [message.parts, status])
  return <Message from={message.role}>
    <MessageContent variant={message.role === 'assistant' ? 'flat' : 'contained'} className={cn('min-w-0 w-full', message.role === 'user' && 'group-[.is-user]:bg-gradient-to-br group-[.is-user]:from-indigo-600 group-[.is-user]:to-indigo-800 group-[.is-user]:text-white')}>
      {items.map((item) => item.kind === 'think'
        ? <ThinkChain key={item.tool.key} tool={item.tool} steps={item.steps} running={status === 'running'} />
        : <PartView key={item.part.key} part={item.part} allParts={message.parts} isUser={message.role === 'user'} status={status} />)}
    </MessageContent>
  </Message>
}

/** Chain-tool labels: the `think` child reasons over a thought; the `recall` memory subagent searches memory for a task. */
const CHAIN_LABELS: Record<string, { streaming: string; title: string; input: string; output: string }> = {
  think: { streaming: 'Thinking…', title: 'Chain of Thought', input: 'Thought', output: 'Conclusion' },
  recall: { streaming: 'Recalling…', title: 'Memory', input: 'Task', output: 'Recalled' },
  repair: { streaming: 'Repairing…', title: 'Repair', input: 'Tool', output: 'Result' },
}

/** Interleaved reasoning + tool use from a chain tool's child agent (`think`, `recall`), as AI Elements chain of thought. */
function ThinkChain({ tool, steps, running }: { tool: ToolPart; steps: ThinkStep[]; running: boolean }) {
  const labels = CHAIN_LABELS[tool.name] ?? CHAIN_LABELS.think
  const streaming = running && !tool.finished
  const input = tool.input as { thought?: unknown; task?: unknown; tool?: unknown } | undefined
  const thought = displayValue(tool.name === 'recall' ? input?.task : tool.name === 'repair' ? input?.tool : input?.thought)
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

function PartView({ part, allParts, isUser, status }: { part: PanelPart; allParts: PanelPart[]; isUser: boolean; status: RunStatus }) {
  const path = part.path.length ? part.path.map(displayValue).join(' / ') : ''
  if (part.kind === 'tool') {
    const failed = part.status === 'error' || part.status === 'failed'
    const toolState = part.finished ? failed ? 'output-error' : 'output-available' : status === 'running' ? 'input-available' : 'input-streaming'
    return <Tool className="my-3 overflow-hidden border-surface-200 dark:border-surface-700">
      <ToolHeader type="dynamic-tool" toolName={part.name} title={part.name} state={toolState} />
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
  search_results: 'Web search', people_search_results: 'People search', finance_results: 'Finance search',
  fetch_url_results: 'Fetched page', sandbox_results: 'Sandbox', sandbox_write_file: 'Sandbox · wrote file',
  sandbox_read_file: 'Sandbox · read file', sandbox_edit_file: 'Sandbox · edited file', sandbox_apply_patch: 'Sandbox · patch',
  sandbox_glob: 'Sandbox · glob', sandbox_grep: 'Sandbox · grep', share_file: 'File', mcp_call: 'MCP call',
  mcp_list_tools: 'MCP tools', skill_loaded: 'Skill loaded', advisor_result: 'Advisor',
  'response.reasoning.search_web': 'Searching the web', 'response.reasoning.fetch_url': 'Fetching pages',
  'response.reasoning.sandbox': 'Running code', 'response.reasoning.people_search': 'Searching people',
  'response.reasoning.finance_search': 'Searching finance data', 'response.skill.loaded': 'Loading skill',
  image_search_results: 'Image search',
  'response.reasoning.image_search_queries': 'Searching for images',
  'response.reasoning.image_search_results': 'Image search results',
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object') : [])

const IMAGE_SEARCH_ITEM_TYPES = new Set(['image_search_results', 'response.reasoning.image_search_queries', 'response.reasoning.image_search_results'])

type ImageSearchHit = { image_url: string; origin_url?: string; title?: string }

function imageSearchQueries(part: NativePart): string[] {
  const queries: string[] = []
  if (Array.isArray(part.item?.queries)) queries.push(...part.item.queries.filter((q): q is string => typeof q === 'string'))
  for (const step of part.steps) {
    if (Array.isArray(step.queries)) queries.push(...step.queries.filter((q): q is string => typeof q === 'string'))
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
  for (const step of part.steps) push(list(step.results))
  return hits
}

function ImageSearchNativeCard({ part, path, streaming }: { part: NativePart; path: string; streaming: boolean }) {
  const queries = imageSearchQueries(part)
  const images = imageSearchHits(part)
  const hasItem = Boolean(part.item)
  return (
    <ChainOfThought className="my-3 space-y-2 text-xs" defaultOpen={streaming || images.length > 0}>
      <ChainOfThoughtHeader>
        {streaming && !hasItem && images.length === 0 ? 'Searching for images…' : 'Image search'}
        {path ? ` · ${path}` : ''}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {queries.length > 0 && (
          <ChainOfThoughtStep label="Queries" status={streaming && !hasItem ? 'active' : 'complete'}>
            <ChainOfThoughtSearchResults>
              {queries.map((query) => (
                <ChainOfThoughtSearchResult key={query}>{query}</ChainOfThoughtSearchResult>
              ))}
            </ChainOfThoughtSearchResults>
          </ChainOfThoughtStep>
        )}
        {images.length > 0 && (
          <ChainOfThoughtStep label="Results" status={streaming && !hasItem ? 'active' : 'complete'}>
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
        {str(part.item?.error) === 'image_search_failed' && (
          <p className="text-xs text-red-600 dark:text-red-400">Image search failed.</p>
        )}
      </ChainOfThoughtContent>
    </ChainOfThought>
  )
}

/** Perplexity Agent API server-side tool card: search results, fetched pages, sandbox runs, files. */
export function NativeToolCard({ part, path, streaming = false }: { part: NativePart; path: string; streaming?: boolean }) {
  if (IMAGE_SEARCH_ITEM_TYPES.has(part.itemType)) {
    return <ImageSearchNativeCard part={part} path={path} streaming={streaming} />
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


/** `tool_repair_proposed`: a library tool kept failing in this session. Nothing runs until Repair is clicked. */
export function RepairProposalAlert({ proposal, busy, onRepair, onDismiss }: {
  proposal: RepairProposal; busy: boolean; onRepair: () => void; onDismiss: () => void
}) {
  return <Alert open onClose={onDismiss} size="md" data-tool-repair-proposed>
    <AlertTitle>{`${proposal.tool} keeps failing — let Ron repair it?`}</AlertTitle>
    <AlertDescription>
      {`${proposal.count ?? 'Several'} failures (${proposal.exceptionClass || 'error'}) this session. Ron's fixer runs for your account only, inside a sandbox, and shows the verified result before anything changes.`}
      {proposal.kind === 'mcp' && ' Browser/MCP tool: the fix is a repaired copy of the browser server for your account, or an adapter on the call boundary.'}
      {(proposal.kind === 'core' || proposal.kind === 'other') && ' Core tool: the fix is an adapter wrapping the tool for your account; shared code is not edited.'}
      {!proposal.observation && ' Span observation is off: diagnosis uses the recorded outcomes only.'}
    </AlertDescription>
    <AlertActions>
      <button type="button" className={smallButton} onClick={onDismiss}>Not now</button>
      <button type="button" className={`${smallButton} bg-indigo-600 text-white hover:bg-indigo-500`} disabled={busy} onClick={onRepair}>Repair</button>
    </AlertActions>
  </Alert>
}

/** `tool_repair_ready`: the user-scoped revision with its five demonstrations. Activate is user-gated. */
export function RepairReadyAlert({ ready, busy, onActivate, onDiscard }: {
  ready: RepairReady; busy: boolean; onActivate: () => void; onDiscard: () => void
}) {
  const activatable = ready.status === 'verified'
  const headline = ready.status === 'verified' ? `${ready.tool} repaired (revision ${ready.rev})`
    : ready.status === 'needs_maintainer' ? `${ready.tool}: the defect is in Ron, not the tool`
    : ready.status === 'not_reproducible' ? `${ready.tool}: the failure did not reproduce`
    : ready.status === 'unverified' ? `${ready.tool}: repaired but not verified in isolation`
    : `${ready.tool}: repair ${ready.status}`
  return <Alert open onClose={onDiscard} size="2xl" data-tool-repair-ready data-status={ready.status}>
    <AlertTitle>{headline}</AlertTitle>
    <AlertDescription>{ready.summary || 'No summary was produced.'}
      {ready.sandbox && ` Sandbox: ${ready.sandbox}.`}
      {ready.repairKind === 'adapter' && ' Repair kind: adapter (wraps the tool for your account; shared code untouched).'}
      {ready.repairKind === 'server' && ' Repair kind: browser server (your browser server is restarted on the repaired copy when you activate).'}
      {ready.status === 'needs_maintainer' && ' The proposed patch and test are stored in the revision manifest; it is never applied automatically.'}
      {ready.status === 'unverified' && ' Activation is disabled because no isolated sandbox (Docker or the hosted sandbox) was available.'}
    </AlertDescription>
    <AlertBody>
      <Table dense className="text-xs">
        <TableHead><TableRow><TableHeader>Kind</TableHeader><TableHeader>Input</TableHeader><TableHeader>Status</TableHeader><TableHeader>Dry run</TableHeader><TableHeader>Source</TableHeader></TableRow></TableHead>
        <TableBody>
          {ready.demonstrations.map((demo, index) => <TableRow key={index}>
            <TableCell>{demo.kind}</TableCell>
            <TableCell className="max-w-xs truncate" title={displayValue(demo.input)}>{displayValue(demo.input).slice(0, 80)}</TableCell>
            <TableCell className={demo.status === 'passed' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}>{demo.status}</TableCell>
            <TableCell>{demo.dry_run ? 'yes' : 'no'}</TableCell>
            <TableCell>{demo.source ?? ''}</TableCell>
          </TableRow>)}
          {!ready.demonstrations.length && <TableRow><TableCell colSpan={5} className="text-ink-muted">No demonstrations were recorded.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </AlertBody>
    <AlertActions>
      <button type="button" className={smallButton} onClick={onDiscard}>Discard</button>
      <button type="button" className={`${smallButton} bg-indigo-600 text-white hover:bg-indigo-500`} disabled={busy || !activatable} onClick={onActivate}>Activate</button>
    </AlertActions>
  </Alert>
}
