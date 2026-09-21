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
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtHeader, ChainOfThoughtStep } from '@/components/ai-elements/chain-of-thought'
import { detectPreviewUrl, fileFromToolCall, filesFromListDir, getToolView, toolOutputText } from '@/components/ai-elements/ide-tool-mapping'
import { displayValue, groupThinkParts, type BrowserSelection, type PanelInterrupt, type PanelMessage, type PanelPart, type RunStatus, type RuntimeOptions, type ThinkStep, type ToolPart } from '@/lib/panel-stream'
import { ContextPicker, SelectedContexts, type ContextItem } from './ContextPicker'
import { DEFAULT_AGENT_MODEL, ModelSelector, useAgentModels, type AgentModelSelection } from './ModelSelector'
import { usePanelChat } from './usePanelChat'
import { useAuthStore } from '@/stores/authStore'
import { AGENT_LABELS, parseArticle, type AgentDestination } from '@/lib/articles'
import { articleDraftKey, EMPTY_ARTICLE_DRAFT, useArticleDraftStore } from '@/stores/articleDraftStore'
import { ArticleAttachmentCard } from '@/components/interests/ArticleAttachmentCard'

const compactInput = 'w-full rounded-lg border border-surface-200 bg-white/70 px-2 py-1.5 text-xs dark:border-surface-700 dark:bg-surface-850 focus:outline-none focus:ring-2 focus:ring-indigo-500/30'
const smallButton = 'rounded-lg border border-surface-200 px-3 py-1.5 text-xs font-medium hover:bg-indigo-50 disabled:opacity-50 dark:border-surface-700 dark:hover:bg-surface-800'
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
    closeAskRon, agentPanelQueuedPrompts, consumeAgentPanelPrompt } = useAgentUi()
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
  const clearSentContexts = useCallback(() => setSelectedContexts([]), [])
  const chat = usePanelChat({ ...selection, destination, attachments: draft.articles,
    contexts: selectedContexts, options, onSent: clearSentContexts })
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

  const dispatchExternal = useCallback((text: string) => {
    // Native steering applies immediately; no second /chat invocation while running.
    const id = sessionRef.current
    void sendMessage(text).then((sent) => { if (!sent && sessionRef.current === id) setInput((current) => current || text) })
  }, [sendMessage])
  useEffect(() => {
    if (destination !== 'panel' || unavailable || chat.connection !== 'connected' || !agentPanelQueuedPrompts.length) return
    if (draft.articles.length) return
    const prompt = consumeAgentPanelPrompt()
    if (prompt) dispatchExternal(prompt)
  }, [destination, draft.articles.length, agentPanelQueuedPrompts, consumeAgentPanelPrompt, dispatchExternal, unavailable, chat.connection])
  useEffect(() => {
    if (destination !== 'panel' || unavailable || chat.connection !== 'connected' || !askRonPendingPrompt) return
    if (draft.articles.length) return
    const prompt = consumeAskRonPendingPrompt()
    if (prompt) { dispatchExternal(prompt); closeAskRon() }
  }, [destination, draft.articles.length, askRonPendingPrompt, consumeAskRonPendingPrompt, dispatchExternal, closeAskRon, unavailable, chat.connection])

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

  const handleNewChat = () => {
    setSelection({ model, provider, effort })
    setOptions(runtimeOptions)
    sessionRef.current = ''
    chat.newChat()
    setSelectedContexts([])
    setInput('')
    followOutput.current = true
    focusComposer(inputRef.current)
  }
  const handleSend = () => {
    const text = input.trim()
    if (!text || unavailable || (active && draft.articles.length > 0)) return
    followOutput.current = true
    void sendMessage(text, 'message', undefined, () => {
      useArticleDraftStore.getState().clearSent(draftKey, input, draft.articles.map((article) => article.id))
    })
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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
                    {active && <button onClick={() => void chat.stop()} disabled={chat.controlBusy} className={smallButton} aria-label="Stop agent run"><StopIcon className="inline w-3 h-3 mr-1" />Stop</button>}
                    <button onClick={handleNewChat} className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800" title="New chat" aria-label="New chat"><PlusIcon className="w-5 h-5" /></button>
                    {!embedded && <button onClick={closePanel} className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800" title="Close" aria-label="Close agent panel"><XMarkIcon className="w-5 h-5" /></button>}
                  </div>
                </div>
                <div className="mt-3 flex min-w-0 items-center gap-1.5">
                  <ModelSelector value={model} provider={provider} effort={effort} includeEffort {...modelCatalogue} disabled={configurationLocked}
                    onChange={(model, provider, effort) => setSelection({ model, provider, effort })}
                    onOpen={refreshModels} className="min-w-0 flex-1" />
                  <BrowserTargetSelector value={chat.browser} onChange={chat.setBrowser} locked={chat.browserLocked || chat.connection === 'loading'} />
                </div>
                <RuntimeSettings options={runtimeOptions} onChange={setOptions} disabled={configurationLocked} />
                {chat.configurationLocked && <button onClick={handleNewChat} className="mt-2 text-xs text-indigo-600 dark:text-indigo-300 underline">New chat to change configuration</button>}
              </header>

              <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-4 space-y-4" onScroll={() => {
                const element = scrollRef.current
                if (element) followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100
              }}>
                {!messages.length && !active && <div className="h-full min-h-40 flex flex-col items-center justify-center px-6">
                  <div className="mb-7 w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 flex items-center justify-center shadow-xl shadow-indigo-600/30 text-2xl text-white font-display">R</div>
                  <h3 className="text-display-sm font-display font-light text-center mb-2">How can I help?</h3>
                  <p className="text-body-sm text-ink-muted dark:text-ink-inverse-muted text-center">Browse, search, analyze, and accomplish.</p>
                </div>}
                {messages.map((message) => <MessageBubble key={message.id} message={message} status={message.runId === chat.runId ? status : 'completed'} />)}
                {(ideState.files.length > 0 || ideState.output) && <details className="rounded-xl border border-surface-200 dark:border-surface-700 p-3">
                  <summary className="cursor-pointer text-xs font-medium">Workspace · files and terminal</summary>
                  <IDE className="mt-3 max-h-[420px]" files={ideState.files} output={ideState.output} isStreaming={active} previewUrl={ideState.previewUrl} title="Workspace" />
                </details>}
                {active && <div role="status" className="flex items-center gap-2 text-xs text-ink-muted dark:text-ink-inverse-muted"><span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />Run in progress · send a message to steer</div>}
                <div ref={messagesEndRef} />
              </div>

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
              {status === 'checkpointed' && <div className="mx-4 mb-3 rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/70 dark:bg-indigo-950/30 p-3 text-xs">
                <p className="font-semibold">Checkpoint saved</p><p className="mt-1 mb-3 text-ink-muted dark:text-ink-inverse-muted">The agent is paused. Resume to continue this run.</p>
                <button className={smallButton} onClick={() => void sendMessage('', 'checkpoint_resume')}>Resume</button>
              </div>}
              {status === 'interrupted' && <InterruptForm key={`${chat.sessionId}-${chat.runId}`} interrupts={chat.interrupts}
                onSubmit={(responses) => sendMessage('', 'interrupt_response', responses)} />}

              <footer className="flex-shrink-0 p-4 border-t border-indigo-100/50 dark:border-surface-800/80 bg-white/60 dark:bg-surface-900/60">
                <div className="max-h-48 overflow-auto">{draft.articles.map((article) => <ArticleAttachmentCard key={article.id} article={article}
                  onRemove={() => useArticleDraftStore.getState().remove(draftKey, article.id)} />)}</div>
                {active && draft.articles.length > 0 && <p className="mb-2 text-xs text-ink-muted">Your attachments are saved for the next message. Wait for this run to finish or stop it.</p>}
                <div className={cn('relative rounded-2xl border transition-all bg-white dark:bg-surface-850', input ? 'border-indigo-300 dark:border-indigo-700 shadow-md shadow-indigo-500/10 ring-2 ring-indigo-500/10' : 'border-surface-200/80 dark:border-surface-700 shadow-sm')}>
                  <SelectedContexts contexts={selectedContexts} onRemove={(id) => setSelectedContexts((previous) => previous.filter((item) => item.id !== id))} className="px-3 pt-3" />
                  <div className="flex items-center gap-2 px-3 py-2">
                    {!active && <ContextPicker selectedContexts={selectedContexts} onContextsChange={setSelectedContexts} />}
                    <textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleKeyDown}
                      aria-label={active ? 'Steer the active run' : 'Message Ron'} placeholder={paused ? 'Resume the run above…' : active ? 'Guide the active run…' : 'Ask anything…'}
                      disabled={paused || chat.recoveryRequired} rows={1} className="flex-1 min-w-0 resize-none py-1.5 bg-transparent text-body-md placeholder:text-ink-muted/60 outline-none min-h-[32px] max-h-32" />
                    <button onClick={handleSend} disabled={!input.trim() || unavailable || (active && draft.articles.length > 0)} aria-label={active ? 'Send steering' : 'Send message'}
                      className="shrink-0 rounded-lg bg-ink dark:bg-ink-inverse text-white dark:text-surface-900 px-3 h-8 text-xs font-semibold disabled:opacity-30">{active ? 'Steer' : 'Send'}</button>
                  </div>
                </div>
                <p className="text-center text-[10px] text-ink-muted dark:text-ink-inverse-muted mt-2">{active ? 'Steering updates the current run' : '↵ to send · Shift + ↵ for a new line'}</p>
              </footer>
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

function RuntimeSettings({ options, onChange, disabled }: {
  options: RuntimeOptions; onChange: (options: RuntimeOptions) => void; disabled: boolean
}) {
  return <details className="mt-3 text-xs">
    <summary className="cursor-pointer text-ink-muted dark:text-ink-inverse-muted">Runtime · {options.context} context · {options.tool_execution} tools</summary>
    <fieldset disabled={disabled} className="mt-3 grid grid-cols-2 gap-3 disabled:opacity-60">
      <label className="space-y-1"><span>Context</span><select className={compactInput} value={options.context} onChange={(event) => onChange({ ...options, context: event.target.value as RuntimeOptions['context'] })}>
        <option value="auto">Automatic</option><option value="agentic">Agentic</option><option value="sliding">Sliding window</option>
      </select></label>
      <label className="space-y-1"><span>Tool execution</span><select className={compactInput} value={options.tool_execution} onChange={(event) => onChange({ ...options, tool_execution: event.target.value as RuntimeOptions['tool_execution'] })}>
        <option value="concurrent">Concurrent</option><option value="sequential">Sequential</option>
      </select></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={options.checkpointing} onChange={(event) => onChange({ ...options, checkpointing: event.target.checked })} />Checkpoints</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={options.background} onChange={(event) => onChange({ ...options, background: event.target.checked })} />Background tasks</label>
      <label className="col-span-2 space-y-1"><span>Goal (optional)</span><input className={compactInput} value={options.goal} onChange={(event) => onChange({ ...options, goal: event.target.value })} placeholder="What should the agent work toward?" /></label>
    </fieldset>
  </details>
}

function InterruptForm({ interrupts, onSubmit }: {
  interrupts: PanelInterrupt[]; onSubmit: (responses: { interruptId: string; response: unknown }[]) => Promise<boolean>
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [jsonMode, setJsonMode] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return <form className="mx-4 mb-3 max-h-64 overflow-y-auto rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-xs" onSubmit={(event) => {
    event.preventDefault()
    try {
      const responses = interrupts.map((interrupt) => ({ interruptId: interrupt.id,
        response: jsonMode[interrupt.id] ? JSON.parse(values[interrupt.id] ?? '') as unknown : values[interrupt.id] ?? '',
      }))
      setError(''); setBusy(true)
      void onSubmit(responses).finally(() => setBusy(false))
    } catch { setError('Enter valid JSON for each response marked JSON.') }
  }}>
    <p className="font-semibold">The agent needs your input</p>
    {!interrupts.length && <p className="mt-2">No pending input details were returned. Reconnect to refresh the session.</p>}
    {interrupts.map((interrupt) => <div key={interrupt.id} className="mt-3 space-y-2">
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
  // Provider-neutral: nested output of a `think` tool (Perplexity config) renders
  // as a chain-of-thought block; every other part renders flat.
  const items = useMemo(() => groupThinkParts(message.parts, status === 'running'), [message.parts, status])
  return <Message from={message.role}>
    <MessageContent variant={message.role === 'assistant' ? 'flat' : 'contained'} className={cn('min-w-0 w-full', message.role === 'user' && 'group-[.is-user]:bg-gradient-to-br group-[.is-user]:from-indigo-600 group-[.is-user]:to-indigo-800 group-[.is-user]:text-white')}>
      {items.map((item) => item.kind === 'think'
        ? <ThinkChain key={item.tool.key} tool={item.tool} steps={item.steps} running={status === 'running'} />
        : <PartView key={item.part.key} part={item.part} isUser={message.role === 'user'} status={status} />)}
    </MessageContent>
  </Message>
}

/** Interleaved reasoning + tool use from the `think` child agent, as AI Elements chain of thought. */
function ThinkChain({ tool, steps, running }: { tool: ToolPart; steps: ThinkStep[]; running: boolean }) {
  const streaming = running && !tool.finished
  const thought = displayValue((tool.input as { thought?: unknown } | undefined)?.thought)
  const conclusion = tool.finished ? displayValue(Array.isArray(tool.output) ? (tool.output as { text?: unknown }[]).map((b) => b.text ?? '').join('') : tool.output) : ''
  const failed = tool.status === 'error' || tool.status === 'failed'
  return <ChainOfThought className="my-3 space-y-2 text-xs" defaultOpen={streaming} isStreaming={streaming}>
    <ChainOfThoughtHeader>{streaming ? 'Thinking…' : failed ? 'Chain of Thought · failed' : 'Chain of Thought'}</ChainOfThoughtHeader>
    <ChainOfThoughtContent>
      {thought && <ChainOfThoughtStep label="Thought" status="complete"><p className="whitespace-pre-wrap break-words text-xs text-ink-muted dark:text-ink-inverse-muted">{thought}</p></ChainOfThoughtStep>}
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
      {tool.finished && <ChainOfThoughtStep label={failed ? 'Failed' : 'Conclusion'} status="complete">
        <p className="whitespace-pre-wrap break-words text-xs">{conclusion || '(no conclusion)'}</p>
      </ChainOfThoughtStep>}
    </ChainOfThoughtContent>
  </ChainOfThought>
}

function PartView({ part, isUser, status }: { part: PanelPart; isUser: boolean; status: RunStatus }) {
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
