import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowLeft, ArrowUp, BookmarkPlus, Check, CircleDot, Code2, FileText, FolderKanban, FolderOpen, Loader2, MessagesSquare, Plus, Search, type LucideIcon } from 'lucide-react'
import { RenIcon } from '@/components/brand'
import { buildSearchRonUrl } from '@/components/chrome/UrlBar'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAgentUi } from '@/context/AgentUiContext'
import { API_BASE_URL } from '@/lib/api-base'
import {
  ARTICLE_ACTIONS, PERSONAL_DOCUMENTS, actionFilter, articleAction, articleContextEntry, chatMessage, codeMessage, documentMessage, issueMessage,
  projectMessage, searchQuery, type ArticleAction, type ArticleActionId,
} from '@/lib/article-actions'
import type { ArticleAttachment } from '@/lib/articles'
import { createContextClient } from '@/lib/context-api'
import { mergeIssueContext } from '@/lib/issue-attachments'
import { RON_AGENT, agentKindLabel, projectChoices, sameAgent, specialistChoices, type AgentChoice } from '@/lib/panel-agents'
import { LEVEL_INFO, type SearchLevel } from '@/lib/search-api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { usePanelAgentStore } from '@/stores/panelAgentStore'
import { getProjectsState, useProjectsStore } from '@/stores/projectsStore'
import { useSearchStore } from '@/stores/searchStore'
import { useTabStore } from '@/stores/tabStore'
import { ROOT_ISSUE_TYPES, type IssueTypeKey, type Project } from '@/types/projects'

const ICONS: Record<ArticleActionId, LucideIcon> = {
  search: Search, chat: MessagesSquare, project: FolderKanban, code: Code2, document: FileText, issue: CircleDot, context: BookmarkPlus,
}

/** Where each action's request goes, said under the composer before it is sent. */
const DESTINATIONS: Record<ArticleActionId, string> = {
  search: 'Opens Ren Search in a new tab',
  chat: 'Opens a new chat in the Agent Panel, with the article attached',
  project: 'Ren builds it in a new Agent Panel chat, with the article attached',
  code: 'Opens the Build agent in a new tab, with the article attached',
  document: 'Ren writes it in a new Agent Panel chat, with the article attached',
  issue: 'The project’s agent files it in a new Agent Panel chat',
  context: 'Saved straight to the issue’s Context',
}

const LABEL = 'font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted dark:text-ink-inverse-muted'
/** A control inside a capsule that shows focus itself (`focus-within`): no second ring from the global `:focus-visible`. */
const BARE = 'focus-visible:ring-0 focus-visible:ring-offset-0'
const PANEL = 'w-[min(420px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-surface-200 bg-surface-0 p-0 text-ink shadow-float dark:border-surface-800 dark:bg-surface-850 dark:text-ink-inverse'
const PICKER = 'h-9 rounded-lg border-surface-200 bg-surface-0 text-[13px] dark:border-surface-700 dark:bg-surface-900'
const PICKER_MENU = 'z-[320] rounded-xl border-surface-200 bg-surface-0 shadow-float dark:border-surface-700 dark:bg-surface-850'

async function openInNewTab(url: string) {
  const id = useTabStore.getState().createTab(url, true)
  try {
    await window.electron?.tabs.create(url, id)
    await window.electron?.tabs.switch(id)
  } catch (error) {
    console.error('Could not open the tab', error)
  }
}

function ActionTile({ action, active, className }: { action: ArticleActionId; active?: boolean; className?: string }) {
  const Icon = ICONS[action]
  return <span aria-hidden className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 ease-out',
    active ? 'bg-blurple-600 text-white dark:bg-blurple-400 dark:text-ink' : 'bg-blurple-50 text-blurple-700 dark:bg-blurple-950/60 dark:text-blurple-300', className)}>
    <Icon className="!size-4" strokeWidth={2} />
  </span>
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return <div className="space-y-1.5">
    {htmlFor ? <label htmlFor={htmlFor} className={LABEL}>{label}</label> : <p className={LABEL}>{label}</p>}
    {children}
  </div>
}

/** The article that goes with the request, as the agent will receive it. */
function ArticleChip({ article, favicon, ready }: { article: ArticleAttachment; favicon?: string; ready: boolean }) {
  const [iconFailed, setIconFailed] = useState(false)
  return <div className="flex min-w-0 items-center gap-2 rounded-lg border border-surface-200 bg-surface-50 py-1 pl-1.5 pr-2 dark:border-surface-700 dark:bg-surface-900">
    {favicon && !iconFailed
      ? <img src={favicon} alt="" referrerPolicy="no-referrer" className="h-4 w-4 shrink-0 rounded-sm" onError={() => setIconFailed(true)} />
      : <FileText className="h-4 w-4 shrink-0 text-ink-muted dark:text-ink-inverse-muted" />}
    <span className="min-w-0 truncate text-[12px] font-medium text-ink-secondary dark:text-ink-inverse-secondary">{article.title}</span>
    <span className={cn('ml-auto shrink-0 rounded px-1.5 py-px font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em]',
      !ready ? 'bg-surface-200 text-ink-muted dark:bg-surface-800 dark:text-ink-inverse-muted'
        : article.status === 'extracted' ? 'bg-blurple-50 text-blurple-700 dark:bg-blurple-950/60 dark:text-blurple-300'
          : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300')}>
      {!ready ? 'Loading' : article.status === 'extracted' ? 'Full article' : 'Preview'}
    </span>
  </div>
}

function ProjectSelect({ projects, value, onChange, personal }: { projects: Project[]; value: string; onChange: (id: string) => void; personal?: boolean }) {
  return <Select value={value} onValueChange={onChange}>
    <SelectTrigger aria-label="Project" className={PICKER}><SelectValue placeholder="Choose a project" /></SelectTrigger>
    <SelectContent className={PICKER_MENU}>
      {personal && <SelectItem value={PERSONAL_DOCUMENTS} className="rounded-lg text-[13px]">
        <span className="flex items-center gap-2"><FolderOpen className="h-4 w-4 text-ink-muted" />My documents</span>
      </SelectItem>}
      {projects.length > 0 && <SelectGroup>
        {personal && <SelectLabel className={cn(LABEL, 'px-2 pt-2')}>Projects</SelectLabel>}
        {projects.map((project) => <SelectItem key={project.id} value={project.id} className="rounded-lg text-[13px]">
          <span className="flex items-center gap-2">
            <span className="rounded bg-surface-100 px-1 font-mono text-[10.5px] font-semibold text-ink-secondary dark:bg-surface-800 dark:text-ink-inverse-secondary">{project.key}</span>
            <span className="truncate">{project.name}</span>
          </span>
        </SelectItem>)}
      </SelectGroup>}
    </SelectContent>
  </Select>
}

const agentKey = (agent: AgentChoice) => `${agent.kind}:${agent.id}`

function AgentSelect({ agents, value, onChange, note }: { agents: AgentChoice[]; value: AgentChoice; onChange: (agent: AgentChoice) => void; note: string }) {
  const groups: { label: string; agents: AgentChoice[] }[] = [
    { label: 'Ren', agents: agents.filter((agent) => agent.kind === 'ron') },
    { label: 'Your specialists', agents: agents.filter((agent) => agent.kind === 'specialist') },
    { label: 'Project agents', agents: agents.filter((agent) => agent.kind === 'project') },
  ].filter((group) => group.agents.length)
  return <><Select value={agentKey(value)} onValueChange={(key) => onChange(agents.find((agent) => agentKey(agent) === key) ?? RON_AGENT)}>
    <SelectTrigger aria-label="Agent" className={cn(PICKER, 'h-auto min-h-9 py-1.5')}><SelectValue /></SelectTrigger>
    <SelectContent className={cn(PICKER_MENU, 'max-h-72')}>
      {groups.map((group) => <SelectGroup key={group.label}>
        {groups.length > 1 && <SelectLabel className={cn(LABEL, 'px-2 pt-2')}>{group.label}</SelectLabel>}
        {group.agents.map((agent) => <SelectItem key={agentKey(agent)} value={agentKey(agent)} className="rounded-lg py-1.5 text-[13px]">
          <span className="flex items-center gap-2">
            <span aria-hidden className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold',
              agent.kind === 'ron' ? 'bg-blurple-600 text-white dark:bg-blurple-400 dark:text-ink' : 'bg-surface-100 text-ink-secondary dark:bg-surface-800 dark:text-ink-inverse-secondary')}>
              {agent.kind === 'ron' ? <RenIcon className="h-3 w-3" strokeWidth={3} /> : agent.name.trim().charAt(0).toUpperCase()}
            </span>
            <span className="truncate">{agent.name}</span>
            {agent.kind !== 'ron' && <span className="shrink-0 text-[11px] text-ink-muted dark:text-ink-inverse-muted">{agentKindLabel(agent.kind)}</span>}
          </span>
        </SelectItem>)}
      </SelectGroup>)}
    </SelectContent>
  </Select>
  {note && <p className="text-[11.5px] text-ink-muted dark:text-ink-inverse-muted">{note}</p>}</>
}

const NEW_ISSUE = '__new__'

/** One issue of the project (search by key or title), or a new one. */
function IssuePicker({ project, value, onChange }: { project: Project; value: string; onChange: (id: string) => void }) {
  const issues = useProjectsStore().issues
  const projectIssues = useMemo(() => issues.filter((issue) => issue.projectId === project.id).sort((a, b) => b.updatedAt - a.updatedAt), [issues, project.id])
  return <Command className="rounded-lg border border-surface-200 bg-surface-0 dark:border-surface-700 dark:bg-surface-900"
    filter={(itemValue, search) => itemValue === NEW_ISSUE || itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0}>
    <CommandInput placeholder={`Find an issue in ${project.key}`} className={cn('h-9 text-[13px]', BARE)} />
    <CommandList className="max-h-40 p-1">
      <CommandEmpty className="py-3 text-center text-[12px] text-ink-muted dark:text-ink-inverse-muted">No issue matches.</CommandEmpty>
      <CommandItem value={NEW_ISSUE} onSelect={() => onChange(NEW_ISSUE)} className="rounded-md text-[13px]">
        <Plus className="text-blurple-600 dark:text-blurple-400" />
        <span className="font-medium text-blurple-700 dark:text-blurple-300">New issue</span>
        {value === NEW_ISSUE && <Check className="ml-auto text-blurple-600 dark:text-blurple-400" />}
      </CommandItem>
      {projectIssues.map((issue) => {
        const key = `${project.key}-${issue.number}`
        return <CommandItem key={issue.id} value={`${key} ${issue.title} ${issue.id}`} onSelect={() => onChange(issue.id)} className="rounded-md text-[13px]">
          <span className="w-14 shrink-0 font-mono text-[11px] text-ink-muted dark:text-ink-inverse-muted">{key}</span>
          <span className="min-w-0 flex-1 truncate">{issue.title}</span>
          {value === issue.id && <Check className="text-blurple-600 dark:text-blurple-400" />}
        </CommandItem>
      })}
    </CommandList>
  </Command>
}

function DepthPicker({ value, onChange }: { value: SearchLevel; onChange: (level: SearchLevel) => void }) {
  const info = LEVEL_INFO.find((level) => level.id === value)
  return <div className="space-y-1.5">
    <div role="radiogroup" aria-label="Search depth" className="grid grid-cols-5 gap-1 rounded-lg bg-surface-100 p-1 dark:bg-surface-900">
      {LEVEL_INFO.map((level) => <button key={level.id} type="button" role="radio" aria-checked={level.id === value} onClick={() => onChange(level.id)}
        className={cn('h-7 rounded-md text-[12px] font-semibold transition-colors duration-150 ease-out',
          level.id === value ? 'bg-surface-0 text-ink shadow-subtle dark:bg-surface-700 dark:text-ink-inverse' : 'text-ink-secondary hover:text-ink dark:text-ink-inverse-secondary dark:hover:text-ink-inverse')}>
        {level.label}
      </button>)}
    </div>
    {info && <p className="text-[11.5px] leading-snug text-ink-muted dark:text-ink-inverse-muted">{info.description}</p>}
  </div>
}

const pickableProjects = (projects: Project[]) => projects.filter((project) => project.lifecycle !== 'archived')

/**
 * Ask Ren: what Ren can do with the article on the page. A single-select list of actions (type to filter, ↑/↓, Enter);
 * choosing one opens its prompt with what it needs (the agent, project or issue), and sending hands it to the place
 * that does it: Ren Search, a new Agent Panel chat with Ren / a specialist / a project's agent, the Build agent, or
 * the issue's Context. The article always goes with it as an attachment, never pasted into the message.
 */
export function ArticleAgentActions({ article, headline, favicon, image, ready, className }: {
  article: ArticleAttachment
  /** The cleaned headline: the first search. */
  headline: string
  favicon?: string
  /** The article's lead image (https), kept on a Context entry. */
  image?: string
  /** False while the full article is still being retrieved: requests wait for it. */
  ready: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [actionId, setActionId] = useState<ArticleActionId | null>(null)
  const changeOpen = (next: boolean) => {
    setOpen(next)
    if (!next) setTimeout(() => setActionId(null), 150)
  }
  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild>
      <button type="button" aria-label="Ask Ren about this article"
        className={cn('inline-flex h-8 items-center gap-1.5 rounded-full bg-blurple-600 pl-2.5 pr-3 text-[13px] font-semibold text-white shadow-subtle transition-colors duration-150 ease-out hover:bg-blurple-700 active:bg-blurple-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple-400 focus-visible:ring-offset-2 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300 dark:focus-visible:ring-offset-surface-900', className)}>
        <RenIcon className="h-4 w-4" strokeWidth={2.5} />Ask Ren
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={8} collisionPadding={12} className={cn(PANEL, 'z-[300]')}
      onOpenAutoFocus={(event) => event.preventDefault()}>
      {actionId
        ? <ActionComposer key={actionId} action={articleAction(actionId)} article={article} headline={headline} favicon={favicon} image={image}
            ready={ready} onBack={() => setActionId(null)} onSwitch={setActionId} onClose={() => changeOpen(false)} />
        : <ActionList article={article} favicon={favicon} ready={ready} onPick={setActionId} />}
    </PopoverContent>
  </Popover>
}

function ActionList({ article, favicon, ready, onPick }: { article: ArticleAttachment; favicon?: string; ready: boolean; onPick: (id: ArticleActionId) => void }) {
  const groups = ['Ask', 'Create', 'Save'] as const
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { const frame = requestAnimationFrame(() => inputRef.current?.focus()); return () => cancelAnimationFrame(frame) }, [])
  return <Command loop filter={actionFilter} className="bg-transparent">
    <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
      <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blurple-600 text-white dark:bg-blurple-400 dark:text-ink">
        <RenIcon className="h-4 w-4" strokeWidth={2.5} />
      </span>
      <div className="min-w-0">
        <p className="font-display text-[15px] font-bold leading-tight tracking-[-0.01em]">Ask Ren</p>
        <p className="text-[12px] text-ink-muted dark:text-ink-inverse-muted">What should Ren do with this article?</p>
      </div>
    </div>
    <CommandInput ref={inputRef} placeholder="Search actions" className={cn('h-10 text-[13px]', BARE)} />
    <CommandList aria-label="Actions" className="max-h-[min(500px,62vh)] px-2 pb-2">
      <CommandEmpty className="py-6 text-center text-[13px] text-ink-muted dark:text-ink-inverse-muted">No action matches.</CommandEmpty>
      {groups.map((group) => <CommandGroup key={group} heading={group}
        className="p-0 pt-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.1em] [&_[cmdk-group-heading]]:text-ink-muted dark:[&_[cmdk-group-heading]]:text-ink-inverse-muted">
        {ARTICLE_ACTIONS.filter((action) => action.group === group).map((action) => <ActionRow key={action.id} action={action} onPick={onPick} />)}
      </CommandGroup>)}
    </CommandList>
    <div className="flex items-center gap-3 border-t border-surface-200 px-3 py-2.5 dark:border-surface-800">
      <p className="hidden shrink-0 font-mono text-[10.5px] text-ink-muted sm:block dark:text-ink-inverse-muted">↑↓ move · ↵ choose</p>
      <div className="min-w-0 flex-1"><ArticleChip article={article} favicon={favicon} ready={ready} /></div>
    </div>
  </Command>
}

function ActionRow({ action, onPick }: { action: ArticleAction; onPick: (id: ArticleActionId) => void }) {
  return <CommandItem value={action.label} keywords={[action.description, ...action.keywords]} onSelect={() => onPick(action.id)}
    className="group cursor-pointer items-center gap-3 rounded-xl px-2 py-2 data-[selected=true]:bg-surface-100 dark:data-[selected=true]:bg-surface-800">
    <ActionTile action={action.id} className="group-data-[selected=true]:bg-blurple-600 group-data-[selected=true]:text-white dark:group-data-[selected=true]:bg-blurple-400 dark:group-data-[selected=true]:text-ink" />
    <span className="min-w-0 flex-1">
      <span className="block text-[13.5px] font-semibold leading-tight text-ink dark:text-ink-inverse">{action.label}</span>
      <span className="mt-0.5 block truncate text-[12px] leading-snug text-ink-muted dark:text-ink-inverse-muted">{action.description}</span>
    </span>
  </CommandItem>
}

function ActionComposer({ action, article, headline, favicon, image, ready, onBack, onSwitch, onClose }: {
  action: ArticleAction
  article: ArticleAttachment
  headline: string
  favicon?: string
  image?: string
  ready: boolean
  onBack: () => void
  onSwitch: (id: ArticleActionId) => void
  onClose: () => void
}) {
  const { openPanel, setInteractionMode } = useAgentUi()
  const userId = useAuthStore((state) => state.user?.id || 'default')
  const signedIn = useAuthStore((state) => state.isAuthenticated)
  const { projects: allProjects, initialize, isInitialized, isLoading, createIssue, updateIssue } = useProjectsStore()
  const projects = useMemo(() => pickableProjects(allProjects), [allProjects])
  const searchLevel = useSearchStore((state) => state.level)
  const promptId = useId()
  const promptRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)

  const [prompt, setPrompt] = useState(() => action.id === 'search' ? searchQuery(headline) : '')
  const [level, setLevel] = useState<SearchLevel>(searchLevel)
  const [agent, setAgent] = useState<AgentChoice>(RON_AGENT)
  const [specialists, setSpecialists] = useState<AgentChoice[]>([])
  const [projectId, setProjectId] = useState('')
  const [documentPlace, setDocumentPlace] = useState(PERSONAL_DOCUMENTS)
  const [issueId, setIssueId] = useState('')
  const [issueTitle, setIssueTitle] = useState(headline.slice(0, 200))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ text: string; projectId: string } | null>(null)

  const needsProjects = action.id === 'chat' || action.id === 'document' || action.id === 'issue' || action.id === 'context'
  useEffect(() => { if (needsProjects) void initialize() }, [needsProjects, initialize])
  useEffect(() => { if (!projectId && projects[0]) setProjectId(projects[0].id) }, [projects, projectId])
  useEffect(() => {
    if (action.id !== 'chat' || !signedIn) return
    let live = true
    void createContextClient(API_BASE_URL, userId).agents()
      .then(({ agents }) => { if (live) setSpecialists(specialistChoices(agents)) })
      .catch(() => { /* Ren and the project agents are still offered. */ })
    return () => { live = false }
  }, [action.id, signedIn, userId])
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const element = promptRef.current
      if (!element) return
      element.focus()
      if (action.id === 'search') element.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [action.id])

  const agents = useMemo(() => [RON_AGENT, ...specialists, ...projectChoices(projects)], [specialists, projects])
  const project = projects.find((entry) => entry.id === projectId) ?? null
  const issueTypes = useMemo(() => {
    const keys = project?.settings.issueTypes?.map((entry) => entry.key) ?? ROOT_ISSUE_TYPES
    const roots = keys.filter((key) => ROOT_ISSUE_TYPES.includes(key))
    return roots.length ? roots : ROOT_ISSUE_TYPES
  }, [project])
  const newIssueType: IssueTypeKey = issueTypes.includes('task') ? 'task' : issueTypes[0]

  const projectBound = action.id === 'issue' || action.id === 'context'
  const noProjects = projectBound && isInitialized && !projects.length
  const missing = !ready ? 'Waiting for the full article…'
    : action.id === 'search' && !prompt.trim() ? 'Type what to search for.'
      : projectBound && !project ? (noProjects ? '' : 'Choose a project.')
        : action.id === 'context' && !issueId ? 'Choose an issue, or New issue.'
          : action.id === 'context' && issueId === NEW_ISSUE && !issueTitle.trim() ? 'Give the new issue a title.'
            : ''
  const blocked = busy || Boolean(missing) || noProjects

  /** A new Agent Panel chat with `who`, sending exactly this message with the article. */
  const toPanel = (who: AgentChoice, text: string) => {
    usePanelAgentStore.getState().requestSend({ id: crypto.randomUUID(), destination: 'panel', agent: who, text, articles: [article] })
    setInteractionMode('text')
    openPanel()
    onClose()
  }

  const addToIssue = async () => {
    if (!project) return
    let issue = getProjectsState().issues.find((entry) => entry.id === issueId)
    if (issueId === NEW_ISSUE) {
      const created = await createIssue({ projectId: project.id, title: issueTitle.trim(), type: newIssueType })
      if (created.error || !created.issue) throw new Error(created.error || 'The issue was not created.')
      issue = created.issue
    }
    if (!issue) throw new Error('Choose an issue.')
    // The newest version: the issue may have changed since the list loaded.
    const current = getProjectsState().issues.find((entry) => entry.id === issue!.id) ?? issue
    const result = await updateIssue(current.id, { context: mergeIssueContext(current.context, [articleContextEntry(article, prompt, image)]) }, current.version)
    if (result.error) throw new Error(result.error)
    setDone({ text: `Added to the Context of ${project.key}-${current.number} · ${current.title}`, projectId: project.id })
  }

  const send = async () => {
    if (blocked) return
    setError('')
    switch (action.id) {
      case 'search':
        useSearchStore.getState().setLevel(level)
        void openInNewTab(buildSearchRonUrl(prompt.trim(), level))
        onClose()
        return
      case 'chat':
        toPanel(agent, chatMessage(prompt))
        return
      case 'project':
        toPanel(RON_AGENT, projectMessage(prompt, article))
        return
      case 'document': {
        const place = documentPlace === PERSONAL_DOCUMENTS ? null : projects.find((entry) => entry.id === documentPlace) ?? null
        toPanel(RON_AGENT, documentMessage(prompt, article, place))
        return
      }
      case 'issue':
        if (project) toPanel(projectChoices([project])[0], issueMessage(prompt, article))
        return
      case 'code':
        usePanelAgentStore.getState().requestSend({ id: crypto.randomUUID(), destination: 'build', agent: RON_AGENT, text: codeMessage(prompt, article), articles: [article] })
        setInteractionMode('text')
        useSearchStore.getState().clearSearch()
        useNavigationStore.getState().setActiveTab('build')
        void openInNewTab('ron://build')
        onClose()
        return
      case 'context':
        setBusy(true)
        try { await addToIssue() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
    }
  }

  const onPromptKey = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    // The search box is one line: Enter sends. A message sends with ⌘/Ctrl+Enter; Enter is a new line.
    if (action.id === 'search' || event.metaKey || event.ctrlKey) {
      event.preventDefault()
      void send()
    }
  }

  if (done) {
    return <div className="px-5 pb-5 pt-6 text-center">
      <span aria-hidden className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-success/10 text-success"><Check className="h-5 w-5" strokeWidth={2.5} /></span>
      <p role="status" className="mt-3 text-[13.5px] font-semibold leading-snug">{done.text}</p>
      <p className="mt-1 text-[12px] text-ink-muted dark:text-ink-inverse-muted">The issue’s agent reads it with the rest of the issue.</p>
      <div className="mt-4 flex justify-center gap-2">
        <button type="button" onClick={() => { void openInNewTab(`ron://project/${done.projectId}`); onClose() }}
          className="h-8 rounded-lg border border-surface-200 px-3 text-[12.5px] font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-100 hover:text-ink dark:border-surface-700 dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse">
          Open project
        </button>
        <button type="button" onClick={onClose}
          className="h-8 rounded-lg bg-blurple-600 px-3.5 text-[12.5px] font-semibold text-white transition-colors duration-150 hover:bg-blurple-700 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300">
          Done
        </button>
      </div>
    </div>
  }

  const isSearch = action.id === 'search'
  return <div>
    <div className="flex items-center gap-2 border-b border-surface-200 px-2.5 py-2.5 dark:border-surface-800">
      <button type="button" onClick={onBack} aria-label="All actions" title="All actions"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-surface-800 dark:hover:text-ink-inverse">
        <ArrowLeft className="h-4 w-4" />
      </button>
      <ActionTile action={action.id} active />
      <div className="min-w-0">
        <p className="truncate text-[14px] font-bold leading-tight">{action.label}</p>
        <p className="truncate text-[12px] text-ink-muted dark:text-ink-inverse-muted">{action.description}</p>
      </div>
    </div>

    <div className="space-y-3.5 px-4 pb-4 pt-3.5">
      {needsProjects && !isInitialized && isLoading && <p className="flex items-center gap-2 text-[12px] text-ink-muted dark:text-ink-inverse-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading your projects…</p>}
      {noProjects && <p className="rounded-lg bg-surface-100 px-3 py-2.5 text-[12.5px] leading-snug text-ink-secondary dark:bg-surface-900 dark:text-ink-inverse-secondary">
        You have no projects yet. <button type="button" className="font-semibold text-blurple-700 underline decoration-blurple-600/40 underline-offset-2 dark:text-blurple-300" onClick={() => onSwitch('project')}>Start a project</button> from this article first.
      </p>}

      {action.id === 'chat' && <Field label="Agent">
        <AgentSelect agents={agents} value={agents.find((entry) => sameAgent(entry, agent)) ?? RON_AGENT} onChange={setAgent}
          note={signedIn ? '' : 'Sign in to chat with your specialists.'} />
      </Field>}
      {action.id === 'document' && <Field label="Save to">
        <ProjectSelect projects={projects} value={documentPlace} onChange={setDocumentPlace} personal />
      </Field>}
      {projectBound && projects.length > 0 && <Field label="Project">
        <ProjectSelect projects={projects} value={projectId} onChange={(id) => { setProjectId(id); setIssueId('') }} />
      </Field>}
      {action.id === 'context' && project && <Field label="Issue">
        <IssuePicker project={project} value={issueId} onChange={setIssueId} />
        {issueId === NEW_ISSUE && <input aria-label="New issue title" value={issueTitle} onChange={(event) => setIssueTitle(event.target.value)} placeholder="New issue title"
          className={cn('ron-field h-9 w-full rounded-lg border border-surface-200 bg-surface-0 px-3 text-[13px] outline-none transition-colors focus:border-blurple-500 dark:border-surface-700 dark:bg-surface-900', BARE)} />}
      </Field>}
      {isSearch && <Field label="Depth"><DepthPicker value={level} onChange={setLevel} /></Field>}

      <Field label={action.prompt.label} htmlFor={promptId}>
        <div className="ron-field rounded-xl border border-surface-200 bg-surface-0 transition-colors focus-within:border-blurple-500 focus-within:ring-2 focus-within:ring-blurple-500/15 dark:border-surface-700 dark:bg-surface-900">
          {isSearch
            ? <input id={promptId} ref={(element) => { promptRef.current = element }} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={onPromptKey}
                placeholder={action.prompt.placeholder} className={cn('h-10 w-full rounded-xl bg-transparent px-3 text-[14px] outline-none placeholder:text-ink-muted dark:placeholder:text-ink-inverse-muted', BARE)} />
            : <textarea id={promptId} ref={(element) => { promptRef.current = element }} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={onPromptKey}
                rows={3} placeholder={action.prompt.placeholder}
                className={cn('block max-h-48 min-h-[76px] w-full resize-none rounded-t-xl bg-transparent px-3 pt-2.5 text-[14px] leading-relaxed outline-none [field-sizing:content] placeholder:text-ink-muted dark:placeholder:text-ink-inverse-muted', BARE)} />}
          <div className="flex items-center gap-2 px-2 pb-2 pt-1">
            <div className="min-w-0 flex-1">{!isSearch && <ArticleChip article={article} favicon={favicon} ready={ready} />}</div>
            <button type="button" onClick={() => void send()} disabled={blocked} aria-label={action.submit}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-blurple-600 px-3 text-[12.5px] font-semibold text-white transition-colors duration-150 ease-out hover:bg-blurple-700 active:bg-blurple-800 disabled:cursor-not-allowed disabled:bg-surface-200 disabled:text-ink-muted dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300 dark:disabled:bg-surface-800 dark:disabled:text-ink-inverse-muted">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />}{action.submit}
            </button>
          </div>
        </div>
      </Field>

      {error && <p role="alert" className="text-[12px] leading-snug text-danger">{error}</p>}
      <p className="flex items-center justify-between gap-3 text-[11.5px] leading-snug text-ink-muted dark:text-ink-inverse-muted">
        <span>{missing || DESTINATIONS[action.id]}</span>
        {!isSearch && <span className="hidden shrink-0 font-mono text-[10.5px] sm:inline">⌘↵ send</span>}
      </p>
    </div>
  </div>
}
