/**
 * The Build Studio: everything one Build conversation produced, beside the chat. Preview, Code and Project read the
 * conversation's workspace through `/build/*` (lib/build-api); Console and Plan read the conversation itself
 * (lib/build-insights); Git reads the workspace's repository. The workspace is re-read whenever one of Ren's tool
 * calls finishes, every few seconds while it works, and after edits made here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Code2, GitBranch, ListChecks, Loader2, MonitorPlay, Package, RotateCw, SquareTerminal, type LucideIcon } from 'lucide-react'
import type { PanelChat } from '@/components/agent-panel/usePanelChat'
import { API_BASE_URL } from '@/lib/api-base'
import { buildGit, buildPreviewUrl, buildWorkspace, createBuildRequest, previewVersion, workspaceRelative, type BuildGit, type BuildWorkspace } from '@/lib/build-api'
import { buildInsights } from '@/lib/build-insights'
import { cn } from '@/utils/cn'
import { CodePane } from './studio/CodePane'
import { ConsolePane } from './studio/ConsolePane'
import { GitPane } from './studio/GitPane'
import { PlanPane, type PlanRun } from './studio/PlanPane'
import { PreviewPane } from './studio/PreviewPane'
import { ProjectPane } from './studio/ProjectPane'
import { useElementWidth } from '@/hooks/useElementWidth'
import { StudioEmpty, StudioNotice, barButton, barIconButton, pillButton } from './studio/shared'

export type StudioTab = 'preview' | 'code' | 'console' | 'plan' | 'git' | 'project'

const TABS: { id: StudioTab; label: string; icon: LucideIcon }[] = [
  { id: 'preview', label: 'Preview', icon: MonitorPlay },
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'console', label: 'Console', icon: SquareTerminal },
  { id: 'plan', label: 'Plan', icon: ListChecks },
  { id: 'git', label: 'Git', icon: GitBranch },
  { id: 'project', label: 'Project', icon: Package },
]

const API_PORT = (() => { try { return Number(new URL(API_BASE_URL).port) || 80 } catch { return 8765 } })()
const POLL_MS = 4000

/**
 * Why a Studio button can't message Ren right now, or '' when it can. `sendMessage` turns text into steering while a
 * run is active and refuses it while Ren waits for an answer or a checkpoint resume, or after a recovery stop.
 */
function askBlockedReason(chat: PanelChat): string {
  if (chat.recoveryRequired) return 'This conversation stopped before it finished. Start a new chat to keep building.'
  if (chat.status === 'running') return 'Ren is working. You can ask again when this run ends.'
  if (chat.status === 'interrupted') return 'Ren is waiting for your answer in the chat.'
  if (chat.status === 'checkpointed') return 'Ren paused at a checkpoint. Resume it in the chat first.'
  return ''
}

export function BuildStudio({ chat, userId, onAsked }: {
  chat: PanelChat
  userId: string
  /** A Studio button's message reached Ren: show the chat, where Ren replies (the narrow layout hides it). */
  onAsked?: () => void
}) {
  const request = useMemo(() => createBuildRequest(API_BASE_URL), [])
  const sectionRef = useRef<HTMLElement>(null)
  // A narrow Studio (the split beside a chat on a laptop) shows tab icons, with only the open tab's name.
  const compact = useElementWidth(sectionRef) < 680
  const sessionId = chat.sessionId
  const working = chat.status === 'running'
  // Live indicators follow the run itself: a tool call or plan step left open by a stopped run is not "running".
  const run: PlanRun = working ? 'working' : chat.status === 'interrupted' || chat.status === 'checkpointed' ? 'waiting' : 'stopped'
  const insights = useMemo(() => buildInsights(chat.messages, API_PORT), [chat.messages])
  // Changes whenever one of Ren's tool calls finishes: the moment files may have changed on disk.
  const toolSignal = useMemo(() => chat.messages.reduce((count, message) =>
    count + message.parts.filter((part) => part.kind === 'tool' && part.finished).length, 0), [chat.messages])

  const [workspace, setWorkspace] = useState<BuildWorkspace | null>(null)
  const [workspaceError, setWorkspaceError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    let current = true
    setRefreshing(true)
    buildWorkspace(request, userId, sessionId)
      .then((next) => { if (current) { setWorkspace(next); setWorkspaceError('') } })
      .catch((error: unknown) => { if (current) setWorkspaceError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (current) setRefreshing(false) })
    return () => { current = false }
  }, [request, userId, sessionId, toolSignal, chat.status, revision])

  useEffect(() => {
    if (!working) return
    const timer = window.setInterval(refresh, POLL_MS)
    return () => window.clearInterval(timer)
  }, [refresh, working])

  const files = workspace?.entries.filter((entry) => entry.type === 'file').length ?? 0
  const staticUrl = workspace ? buildPreviewUrl(API_BASE_URL, workspace) : null
  const previewable = Boolean(staticUrl) || insights.servers.length > 0
  const autoTab: StudioTab = previewable ? 'preview' : files ? 'code' : insights.todos.length ? 'plan' : insights.commands.length ? 'console' : 'preview'
  const [picked, setPicked] = useState<StudioTab | null>(null)
  const tab = picked ?? autoTab
  const [openPath, setOpenPath] = useState<string | null>(null)
  // Reloads the static preview only when a file it can load changes (not a README, a test or .ren-dev.log).
  const version = useMemo(() => workspace ? previewVersion(workspace.entries) : '', [workspace])

  const [git, setGit] = useState<BuildGit | null>(null)
  const [gitError, setGitError] = useState('')
  const [gitLoading, setGitLoading] = useState(false)
  useEffect(() => {
    if (tab !== 'git' || !workspace?.exists) return
    let current = true
    setGitLoading(true)
    buildGit(request, userId, sessionId)
      .then((next) => { if (current) { setGit(next); setGitError('') } })
      .catch((error: unknown) => { if (current) setGitError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (current) setGitLoading(false) })
    return () => { current = false }
  }, [request, userId, sessionId, tab, toolSignal, revision, workspace?.exists])

  // A new conversation starts with an empty studio.
  useEffect(() => { setWorkspace(null); setGit(null); setPicked(null); setOpenPath(null) }, [sessionId])

  const relative = useCallback((path: string) => workspace ? workspaceRelative(workspace, path) : null, [workspace])
  const openFile = useCallback((path: string) => { setOpenPath(path); setPicked('code') }, [])
  // Working in a pane keeps it open: the automatic choice stops moving the user (say from Code to a new Preview).
  const pin = useCallback(() => setPicked((current) => current ?? tab), [tab])

  // Studio buttons (Git's "Ask Ren to start one", Project's Run) send a message at once: never as steering into a
  // running task, never while Ren waits in the chat; and a message Ren could not take says so.
  const askBlocked = askBlockedReason(chat)
  const [askNotice, setAskNotice] = useState('')
  const ask = useCallback(async (prompt: string) => {
    setAskNotice('')
    const sent = await chat.sendMessage(prompt, 'message', undefined, () => onAsked?.())
    if (!sent) setAskNotice('Ren couldn’t take that message. Check the chat, then try again.')
  }, [chat, onAsked])

  const running = working && insights.commands.some((command) => command.state === 'running')
  const failed = insights.commands.some((command) => command.state === 'failed') || Boolean(insights.tests?.failed)
  const done = insights.todos.filter((todo) => todo.status === 'completed').length
  const badge = (id: StudioTab) => {
    if (id === 'preview' && previewable) return <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
    if (id === 'console' && running) return <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-volt" />
    if (id === 'console' && failed) return <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-red-500" />
    if (id === 'plan' && insights.todos.length) return <span className="font-mono text-[10.5px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">{done}/{insights.todos.length}</span>
    if (id === 'code' && files) return <span className="font-mono text-[10.5px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">{files}</span>
    return null
  }
  /** What a tab's badge means, for its tooltip (with the tab's name when a compact Studio hides it). */
  const badgeMeaning = (id: StudioTab) => {
    if (id === 'preview' && previewable) return 'ready to view'
    if (id === 'console' && running) return 'a command is running'
    if (id === 'console' && failed) return 'a command or test failed'
    if (id === 'plan' && insights.todos.length) return `${done} of ${insights.todos.length} done`
    if (id === 'code' && files) return `${files} file${files === 1 ? '' : 's'}`
    return ''
  }
  const tabTitle = (id: StudioTab, label: string) => {
    const meaning = badgeMeaning(id)
    return (compact && tab !== id) || meaning ? [label, meaning].filter(Boolean).join(' · ') : undefined
  }

  const needsWorkspace = tab === 'preview' || tab === 'code' || tab === 'git' || tab === 'project'
  return (
    // Shimmer (AI Elements) paints through shadcn v4 colour variables, mapped onto Ren's tokens for the whole Studio.
    <section ref={sectionRef} aria-label="Build studio" className="ron-glass-panel flex h-full min-h-0 flex-col bg-surface-0 text-ink [--color-background:hsl(var(--background))] [--color-muted-foreground:hsl(var(--muted-foreground))] dark:bg-surface-900 dark:text-ink-inverse">
      <header className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-surface-200/80 bg-surface-0 px-2.5 dark:border-surface-800 dark:bg-surface-900">
        <nav role="tablist" aria-label="Studio" className="flex min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-none">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" role="tab" id={`studio-tab-${id}`} aria-selected={tab === id} aria-controls="studio-panel" onClick={() => setPicked(id)}
              title={tabTitle(id, label)}
              className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold transition-colors',
                tab === id ? 'bg-surface-100 text-ink dark:bg-surface-800 dark:text-ink-inverse'
                  : 'text-ink-muted hover:bg-surface-50 hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-surface-850 dark:hover:text-ink-inverse')}>
              <Icon aria-hidden className={cn('h-4 w-4', tab === id && 'text-volt')} />
              <span className={cn(compact && tab !== id && 'sr-only')}>{label}</span>
              {badge(id)}
            </button>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-1.5">
          {working && <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-volt">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-volt" /><span className={cn(compact && 'sr-only')}>Building</span></span>}
          <button type="button" className={barIconButton} onClick={refresh} title="Refresh" aria-label="Refresh the workspace">
            <RotateCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          </button>
        </div>
      </header>
      {needsWorkspace && workspaceError && workspace && (
        <StudioNotice action={<button type="button" className={barButton} onClick={refresh} disabled={refreshing}>Retry</button>}>
          Couldn’t refresh the workspace, so this may be out of date. {workspaceError}
        </StudioNotice>
      )}
      {askNotice && <StudioNotice onDismiss={() => setAskNotice('')}>{askNotice}</StudioNotice>}
      <div id="studio-panel" role="tabpanel" aria-labelledby={`studio-tab-${tab}`} className="relative min-h-0 flex-1"
        onPointerDownCapture={pin} onKeyDownCapture={pin}>
        {/* Code stays mounted once the workspace is known (hidden on other tabs), so an unsaved edit survives a tab switch. */}
        {workspace && (
          <div className={cn('absolute inset-0', tab !== 'code' && 'hidden')}>
            <CodePane request={request} userId={userId} sessionId={sessionId} workspace={workspace} onChanged={refresh}
              open={openPath} onOpened={() => setOpenPath(null)} />
          </div>
        )}
        {needsWorkspace && workspaceError && !workspace ? (
          <StudioEmpty icon={AlertTriangle} title="Can’t open the workspace"
            action={<button type="button" className={pillButton} onClick={refresh} disabled={refreshing}>{refreshing ? 'Trying again…' : 'Try again'}</button>}>
            {workspaceError}
          </StudioEmpty>
        ) : needsWorkspace && !workspace ? (
          <div role="status" className="flex h-full items-center justify-center">
            <Loader2 aria-hidden className="h-5 w-5 animate-spin text-ink-muted dark:text-ink-inverse-muted" />
            <span className="sr-only">Opening the workspace…</span>
          </div>
        ) : tab === 'preview' ? (
          <PreviewPane staticUrl={staticUrl} servers={insights.servers} version={version} />
        ) : tab === 'console' ? (
          <ConsolePane commands={insights.commands} tests={insights.tests} working={working} />
        ) : tab === 'plan' ? (
          <PlanPane todos={insights.todos} changes={insights.changes} run={run} relative={relative} onOpenFile={openFile} />
        ) : tab === 'git' ? (
          <GitPane git={workspace?.exists ? git : { repo: false, branch: null, commits: [], dirty: [] }} error={gitError} loading={gitLoading}
            askBlocked={askBlocked} onAsk={(prompt) => { void ask(prompt) }} onRetry={refresh} />
        ) : tab === 'project' && workspace ? (
          <ProjectPane workspace={workspace} blocked={askBlocked}
            onRun={(script) => { void ask(`Run \`npm run ${script}\` in the workspace and tell me what happened.`) }} />
        ) : null}
      </div>
    </section>
  )
}
