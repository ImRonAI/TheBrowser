import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  ArrowUp, BookmarkPlus, Check, CircleDot, Code2, FilePlus2, FileText, FolderKanban, FolderOpen, Loader2, MessagesSquare, Plus, Search, type LucideIcon,
} from 'lucide-react'
import { Attachments } from '@/components/ai-elements/attachments'
import { PromptAttachmentCard } from '@/components/agent-panel/PromptAttachments'
import { RenIcon } from '@/components/brand'
import { buildSearchRonUrl } from '@/components/chrome/UrlBar'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAgentUi } from '@/context/AgentUiContext'
import { API_BASE_URL } from '@/lib/api-base'
import {
  ARTICLE_ACTIONS, PERSONAL_DOCUMENTS, articleAction, articleContextEntry, articlePromptAttachment, chatMessage, codeMessage,
  documentPromptDefault, issueMessage, projectMessage, searchQuery, type ArticleActionId,
} from '@/lib/article-actions'
import { youtubeVideoId, type ArticleAttachment } from '@/lib/articles'
import { createContextClient } from '@/lib/context-api'
import { mergeIssueContext } from '@/lib/issue-attachments'
import { RON_AGENT, agentKindLabel, projectChoices, sameAgent, specialistChoices, type AgentChoice } from '@/lib/panel-agents'
import { UNTITLED, listAllDocuments, type ProjectDocumentSummary } from '@/lib/project-documents'
import { LEVEL_INFO, type SearchLevel } from '@/lib/search-api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useDocumentHandoffStore } from '@/stores/documentHandoffStore'
import { usePanelAgentStore } from '@/stores/panelAgentStore'
import { getProjectsState, projectsRequestFor, useProjectsStore } from '@/stores/projectsStore'
import { useSearchStore } from '@/stores/searchStore'
import { useTabStore } from '@/stores/tabStore'
import { ROOT_ISSUE_TYPES, type IssueTypeKey, type Project } from '@/types/projects'

const ICONS: Record<ArticleActionId, LucideIcon> = {
  search: Search, chat: MessagesSquare, project: FolderKanban, code: Code2, document: FileText, issue: CircleDot, context: BookmarkPlus,
}

/** Where each action's request goes, shown under the composer before it is sent. */
const DESTINATIONS: Record<ArticleActionId, string> = {
  search: 'Opens Ren Search in a new tab with story context',
  chat: 'Opens a new chat in the Agent Panel with this context attached',
  project: 'Ren plans the project and backlog in the Agent Panel',
  code: 'Opens the Build Workbench in a new tab with this brief attached',
  document: 'Opens Documents with this context attached & live screen sharing',
  issue: 'The project’s agent files it in a new Agent Panel chat',
  context: 'Saved straight to the issue’s Context',
}

const LABEL = 'font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted dark:text-ink-inverse-muted'
const BARE = 'focus-visible:ring-0 focus-visible:ring-offset-0'
const PANEL = 'w-[min(440px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-surface-200 bg-surface-0 p-0 text-ink shadow-float dark:border-surface-800 dark:bg-surface-850 dark:text-ink-inverse'
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

/** Single-select picker for what Ren should do with the article or video writeup. */
function ActionSingleSelect({ value, onChange }: { value: ArticleActionId; onChange: (id: ArticleActionId) => void }) {
  const selected = articleAction(value)
  const groups = ['Ask', 'Create', 'Save'] as const
  return (
    <Select value={value} onValueChange={(next) => onChange(next as ArticleActionId)}>
      <SelectTrigger aria-label="Action" className={cn(PICKER, 'h-auto min-h-12 px-2.5 py-2 text-left')}>
        <SelectValue>
          <span className="flex min-w-0 items-center gap-2.5">
            <ActionTile action={selected.id} active />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-bold leading-tight text-ink dark:text-ink-inverse">{selected.label}</span>
              <span className="mt-0.5 block truncate text-[11.5px] leading-snug text-ink-muted dark:text-ink-inverse-muted">{selected.description}</span>
            </span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent className={cn(PICKER_MENU, 'max-h-[min(420px,68vh)] w-[var(--radix-select-trigger-width)] min-w-[300px]')}>
        {groups.map((group) => (
          <SelectGroup key={group}>
            <SelectLabel className={cn(LABEL, 'px-2.5 pb-1 pt-2')}>{group}</SelectLabel>
            {ARTICLE_ACTIONS.filter((item) => item.group === group).map((item) => (
              <SelectItem key={item.id} value={item.id} className="rounded-xl py-2 text-[13px]">
                <span className="flex min-w-0 items-center gap-2.5">
                  <ActionTile action={item.id} active={item.id === value} className="h-7 w-7" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold leading-tight text-ink dark:text-ink-inverse">{item.label}</span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted dark:text-ink-inverse-muted">{item.description}</span>
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
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

/** Searchable picker across the user's personal documents and project pages. */
function DocumentPicker({
  documents,
  projects,
  loading,
  value,
  onChange,
}: {
  documents: ProjectDocumentSummary[]
  projects: Project[]
  loading: boolean
  value: string
  onChange: (doc: ProjectDocumentSummary) => void
}) {
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  if (loading) {
    return <p className="flex items-center gap-2 rounded-lg border border-surface-200 px-3 py-2.5 text-[12px] text-ink-muted dark:border-surface-700 dark:text-ink-inverse-muted">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading your documents…
    </p>
  }
  if (!documents.length) {
    return <p className="rounded-lg border border-surface-200 bg-surface-50 px-3 py-2.5 text-[12.5px] text-ink-muted dark:border-surface-700 dark:bg-surface-900 dark:text-ink-inverse-muted">
      No saved documents yet — switch to <strong className="text-ink dark:text-ink-inverse">New document</strong> above to start one.
    </p>
  }
  return (
    <Command
      className="rounded-lg border border-surface-200 bg-surface-0 dark:border-surface-700 dark:bg-surface-900"
      filter={(itemValue, search) => itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0}
    >
      <CommandInput placeholder="Search My documents & project pages…" className={cn('h-9 text-[13px]', BARE)} />
      <CommandList className="max-h-40 p-1">
        <CommandEmpty className="py-3 text-center text-[12px] text-ink-muted dark:text-ink-inverse-muted">No document matches.</CommandEmpty>
        {documents.map((doc) => {
          const proj = doc.projectId ? projectMap.get(doc.projectId) : null
          const scopeBadge = proj ? proj.key : 'Personal'
          const title = doc.title?.trim() || UNTITLED
          return (
            <CommandItem
              key={doc.id}
              value={`${scopeBadge} ${proj?.name ?? ''} ${title} ${doc.id}`}
              onSelect={() => onChange(doc)}
              className="rounded-md text-[13px]"
            >
              <span className="shrink-0 rounded bg-surface-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-secondary dark:bg-surface-800 dark:text-ink-inverse-secondary">
                {scopeBadge}
              </span>
              <span className="min-w-0 flex-1 truncate">{title}</span>
              {value === doc.id && <Check className="text-blurple-600 dark:text-blurple-400" />}
            </CommandItem>
          )
        })}
      </CommandList>
    </Command>
  )
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

export interface ArticleAgentActionsProps {
  article: ArticleAttachment
  /** The cleaned headline: the default search / title. */
  headline: string
  favicon?: string
  /** The article's lead image (https), kept on a Context entry. */
  image?: string
  /** False while the full article or video writeup is still being retrieved. */
  ready: boolean
  /** `popover` renders the `Ask Ren` button + popover; `inline` renders the full single-select & composer card directly in the page. */
  variant?: 'popover' | 'inline'
  /** Compact hover pill styling when placed on a Discover `StoryCard`. */
  triggerVariant?: 'primary' | 'card'
  /** Optional lazy loader used by `StoryCard` to upgrade a preview into the full extracted article when opened. */
  onEnsureArticle?: () => Promise<ArticleAttachment | null>
  defaultAction?: ArticleActionId
  className?: string
}

/**
 * Ask Ren: a unified single-select action picker + dynamic prompt composer with `ai-elements` attachment cards.
 * Supports searching, chatting with Ren / specialists / project agents, starting projects or coding builds,
 * creating or updating Documents (with live Document screen sharing + MiniMax M3.1 Flash visual eyes), and
 * filing or attaching context to Issues.
 */
export function ArticleAgentActions({
  article,
  headline,
  favicon,
  image,
  ready,
  variant = 'popover',
  triggerVariant = 'primary',
  onEnsureArticle,
  defaultAction = 'chat',
  className,
}: ArticleAgentActionsProps) {
  const [open, setOpen] = useState(false)
  const [lazyArticle, setLazyArticle] = useState<ArticleAttachment | null>(null)
  const [lazyLoading, setLazyLoading] = useState(false)

  useEffect(() => {
    setLazyArticle(null)
  }, [article.url])

  const ensureLoaded = useCallback(() => {
    if (!onEnsureArticle || lazyArticle || lazyLoading || article.status === 'extracted') return
    setLazyLoading(true)
    void onEnsureArticle()
      .then((loaded) => { if (loaded) setLazyArticle(loaded) })
      .catch(() => {})
      .finally(() => setLazyLoading(false))
  }, [onEnsureArticle, lazyArticle, lazyLoading, article.status])

  const effectiveArticle = lazyArticle ?? article
  const effectiveReady = ready && !lazyLoading

  if (variant === 'inline') {
    return (
      <div className={cn(
        'w-full max-w-[68ch] rounded-2xl border border-surface-200 bg-surface-50/50 text-left text-ink shadow-subtle dark:border-surface-800 dark:bg-surface-850/70 dark:text-ink-inverse',
        className,
      )}>
        <ActionComposer
          article={effectiveArticle}
          headline={headline}
          favicon={favicon}
          image={image}
          ready={effectiveReady}
          defaultAction={defaultAction}
          inline
        />
      </div>
    )
  }

  const changeOpen = (next: boolean) => {
    setOpen(next)
    if (next) ensureLoaded()
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        {triggerVariant === 'card' ? (
          <button
            type="button"
            onClick={(event) => event.stopPropagation()}
            aria-label={`Ask Ren: ${headline}`}
            title="Ask Ren about this story"
            className={cn(
              // The logo's volt (#5543FF, RenMark's tile) with white type in Light, Dark and Glass alike.
              'inline-flex h-7 items-center gap-1 rounded-full bg-blurple-600 pl-2 pr-2.5 text-[12px] font-semibold text-white shadow-sm transition-[opacity,background-color] duration-150 ease-out hover:bg-blurple-700 active:bg-blurple-800 focus-visible:opacity-100',
              className,
            )}
          >
            <RenIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
            Ask Ren
          </button>
        ) : (
          <button
            type="button"
            aria-label="Ask Ren about this article"
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full bg-blurple-600 pl-2.5 pr-3 text-[13px] font-semibold text-white shadow-subtle transition-colors duration-150 ease-out hover:bg-blurple-700 active:bg-blurple-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-surface-900',
              className,
            )}
          >
            <RenIcon className="h-4 w-4" strokeWidth={2.5} />Ask Ren
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className={cn(PANEL, 'z-[300]')}
        onClick={(event) => event.stopPropagation()}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <ActionComposer
          article={effectiveArticle}
          headline={headline}
          favicon={favicon}
          image={image}
          ready={effectiveReady}
          defaultAction={defaultAction}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

function ActionComposer({
  article,
  headline,
  favicon,
  image,
  ready,
  defaultAction,
  inline = false,
  onClose,
}: {
  article: ArticleAttachment
  headline: string
  favicon?: string
  image?: string
  ready: boolean
  defaultAction: ArticleActionId
  inline?: boolean
  onClose?: () => void
}) {
  const { openPanel, setInteractionMode } = useAgentUi()
  const userId = useAuthStore((state) => state.user?.id || 'default')
  const signedIn = useAuthStore((state) => state.isAuthenticated)
  const {
    userId: projectsUserId,
    projects: allProjects,
    initialize,
    isInitialized,
    isLoading,
    createIssue,
    updateIssue,
  } = useProjectsStore()
  const projects = useMemo(() => pickableProjects(allProjects), [allProjects])
  const searchLevel = useSearchStore((state) => state.level)
  const promptId = useId()
  const promptRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)

  const [actionId, setActionId] = useState<ArticleActionId>(defaultAction)
  const action = articleAction(actionId)
  const [prompt, setPrompt] = useState(() => defaultAction === 'search' ? searchQuery(headline) : '')
  const [level, setLevel] = useState<SearchLevel>(searchLevel)
  const [agent, setAgent] = useState<AgentChoice>(RON_AGENT)
  const [specialists, setSpecialists] = useState<AgentChoice[]>([])
  const [projectId, setProjectId] = useState('')
  const [documentMode, setDocumentMode] = useState<'new' | 'existing'>('new')
  const [documentPlace, setDocumentPlace] = useState(PERSONAL_DOCUMENTS)
  const [documentTitle, setDocumentTitle] = useState(() => headline.slice(0, 200))
  const [documents, setDocuments] = useState<ProjectDocumentSummary[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [selectedDocId, setSelectedDocId] = useState('')
  const [issueId, setIssueId] = useState('')
  const [issueTitle, setIssueTitle] = useState(() => headline.slice(0, 200))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ text: string; projectId: string } | null>(null)

  const handleActionChange = (nextId: ArticleActionId) => {
    const defaultSearch = searchQuery(headline)
    if (nextId === 'search' && !prompt.trim()) {
      setPrompt(defaultSearch)
    } else if (actionId === 'search' && nextId !== 'search' && prompt.trim() === defaultSearch) {
      setPrompt('')
    }
    setDone(null)
    setError('')
    setActionId(nextId)
  }

  const needsProjects = actionId === 'chat' || actionId === 'document' || actionId === 'issue' || actionId === 'context'
  useEffect(() => { if (needsProjects) void initialize() }, [needsProjects, initialize])
  useEffect(() => { if (!projectId && projects[0]) setProjectId(projects[0].id) }, [projects, projectId])

  useEffect(() => {
    if (actionId !== 'document' || documentMode !== 'existing' || !projectsUserId) return
    let live = true
    setDocumentsLoading(true)
    void listAllDocuments(projectsRequestFor(projectsUserId))
      .then((rows) => {
        if (!live) return
        const sorted = [...rows].sort((a, b) => b.updatedAt - a.updatedAt)
        setDocuments(sorted)
        if (!selectedDocId && sorted[0]) setSelectedDocId(sorted[0].id)
      })
      .catch(() => { if (live) setDocuments([]) })
      .finally(() => { if (live) setDocumentsLoading(false) })
    return () => { live = false }
  }, [actionId, documentMode, projectsUserId, selectedDocId])

  useEffect(() => {
    if (actionId !== 'chat' || !signedIn) return
    let live = true
    void createContextClient(API_BASE_URL, userId).agents()
      .then(({ agents }) => { if (live) setSpecialists(specialistChoices(agents)) })
      .catch(() => {})
    return () => { live = false }
  }, [actionId, signedIn, userId])

  useEffect(() => {
    if (inline) return
    const frame = requestAnimationFrame(() => {
      const element = promptRef.current
      if (!element) return
      element.focus()
      if (actionId === 'search') element.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [actionId, inline])

  const agents = useMemo(() => [RON_AGENT, ...specialists, ...projectChoices(projects)], [specialists, projects])
  const project = projects.find((entry) => entry.id === projectId) ?? null
  const selectedDocument = documents.find((doc) => doc.id === selectedDocId) ?? null
  const issueTypes = useMemo(() => {
    const keys = project?.settings.issueTypes?.map((entry) => entry.key) ?? ROOT_ISSUE_TYPES
    const roots = keys.filter((key) => ROOT_ISSUE_TYPES.includes(key))
    return roots.length ? roots : ROOT_ISSUE_TYPES
  }, [project])
  const newIssueType: IssueTypeKey = issueTypes.includes('task') ? 'task' : issueTypes[0]
  const promptAttachment = useMemo(() => articlePromptAttachment(article), [article])
  const isVideo = Boolean(youtubeVideoId(article.url))

  const projectBound = actionId === 'issue' || actionId === 'context'
  const noProjects = projectBound && isInitialized && !projects.length
  const missing = !ready ? (isVideo ? 'Waiting for video writeup…' : 'Waiting for full article…')
    : actionId === 'search' && !prompt.trim() ? 'Type what to search for.'
      : actionId === 'document' && documentMode === 'existing' && !selectedDocument ? 'Choose an existing document.'
        : projectBound && !project ? (noProjects ? '' : 'Choose a project.')
          : actionId === 'context' && !issueId ? 'Choose an issue, or New issue.'
            : actionId === 'context' && issueId === NEW_ISSUE && !issueTitle.trim() ? 'Give the new issue a title.'
              : ''
  const blocked = busy || Boolean(missing) || noProjects

  const closeIfPopover = () => onClose?.()

  /** A new Agent Panel chat with `who`, sending the message with the article attached. */
  const toPanel = (who: AgentChoice, text: string) => {
    usePanelAgentStore.getState().requestSend({ id: crypto.randomUUID(), destination: 'panel', agent: who, text, articles: [article] })
    setInteractionMode('text')
    openPanel()
    closeIfPopover()
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
    const current = getProjectsState().issues.find((entry) => entry.id === issue!.id) ?? issue
    const result = await updateIssue(current.id, { context: mergeIssueContext(current.context, [articleContextEntry(article, prompt, image)]) }, current.version)
    if (result.error) throw new Error(result.error)
    setDone({ text: `Added to the Context of ${project.key}-${current.number} · ${current.title}`, projectId: project.id })
  }

  const sendToDocuments = () => {
    const goalText = documentPromptDefault(prompt, documentMode)
    if (documentMode === 'existing') {
      if (!selectedDocument) return
      useDocumentHandoffStore.getState().setHandoff({
        id: crypto.randomUUID(),
        mode: 'existing',
        projectId: selectedDocument.projectId,
        documentId: selectedDocument.id,
        title: selectedDocument.title || headline,
        prompt: goalText,
        attachments: [promptAttachment],
        autoSend: true,
        autoApply: false,
      })
      const targetUrl = selectedDocument.projectId
        ? `ron://project/${selectedDocument.projectId}/docs/${selectedDocument.id}`
        : `ron://documents/${selectedDocument.id}`
      void openInNewTab(targetUrl)
      closeIfPopover()
      return
    }

    const targetProjectId = documentPlace === PERSONAL_DOCUMENTS ? null : documentPlace
    useDocumentHandoffStore.getState().setHandoff({
      id: crypto.randomUUID(),
      mode: 'new',
      projectId: targetProjectId,
      documentId: null,
      title: documentTitle.trim() || headline,
      prompt: goalText,
      attachments: [promptAttachment],
      autoSend: true,
      autoApply: true,
    })
    void openInNewTab('ron://documents')
    closeIfPopover()
  }

  const send = async () => {
    if (blocked) return
    setError('')
    switch (actionId) {
      case 'search':
        useSearchStore.getState().setLevel(level)
        void openInNewTab(buildSearchRonUrl(searchQuery(prompt, article), level))
        closeIfPopover()
        return
      case 'chat':
        toPanel(agent, chatMessage(prompt))
        return
      case 'project':
        toPanel(RON_AGENT, projectMessage(prompt, article))
        return
      case 'document':
        sendToDocuments()
        return
      case 'issue':
        if (project) toPanel(projectChoices([project])[0], issueMessage(prompt, article))
        return
      case 'code':
        usePanelAgentStore.getState().requestSend({
          id: crypto.randomUUID(),
          destination: 'build',
          agent: RON_AGENT,
          text: codeMessage(prompt, article),
          articles: [article],
        })
        setInteractionMode('text')
        useSearchStore.getState().clearSearch()
        void openInNewTab('ron://build')
        closeIfPopover()
        return
      case 'context':
        setBusy(true)
        try { await addToIssue() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
    }
  }

  const onPromptKey = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    if (actionId === 'search' || event.metaKey || event.ctrlKey) {
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
        <button type="button" onClick={() => { void openInNewTab(`ron://project/${done.projectId}`); closeIfPopover() }}
          className="h-8 rounded-lg border border-surface-200 px-3 text-[12.5px] font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-100 hover:text-ink dark:border-surface-700 dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse">
          Open project
        </button>
        <button type="button" onClick={() => { setDone(null); closeIfPopover() }}
          className="h-8 rounded-lg bg-blurple-600 px-3.5 text-[12.5px] font-semibold text-white transition-colors duration-150 hover:bg-blurple-700 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300">
          Done
        </button>
      </div>
    </div>
  }

  const isSearch = actionId === 'search'
  const statusBadgeLabel = !ready ? 'Loading' : article.status === 'extracted' ? (isVideo ? 'Video writeup' : 'Full article') : 'Preview'

  return (
    <div>
      <div className="flex items-center justify-between gap-2.5 border-b border-surface-200 px-4 py-3 dark:border-surface-800">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blurple-600 text-white dark:bg-blurple-400 dark:text-ink">
            <RenIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-[14px] font-bold leading-tight tracking-[-0.01em]">Ask Ren</p>
            <p className="truncate text-[11.5px] text-ink-muted dark:text-ink-inverse-muted">
              Choose an action and tell Ren what you want accomplished
            </p>
          </div>
        </div>
        <span className={cn(
          'shrink-0 rounded-full px-2 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em]',
          !ready ? 'bg-surface-200 text-ink-muted dark:bg-surface-800 dark:text-ink-inverse-muted'
            : article.status === 'extracted' ? 'bg-blurple-50 text-blurple-700 dark:bg-blurple-950/60 dark:text-blurple-300'
              : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
        )}>
          {statusBadgeLabel}
        </span>
      </div>

      <div className="space-y-3.5 px-4 pb-4 pt-3.5">
        <Field label="Action">
          <ActionSingleSelect value={actionId} onChange={handleActionChange} />
        </Field>

        {needsProjects && !isInitialized && isLoading && (
          <p className="flex items-center gap-2 text-[12px] text-ink-muted dark:text-ink-inverse-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading your projects…
          </p>
        )}
        {noProjects && (
          <p className="rounded-lg bg-surface-100 px-3 py-2.5 text-[12.5px] leading-snug text-ink-secondary dark:bg-surface-900 dark:text-ink-inverse-secondary">
            You have no projects yet.{' '}
            <button type="button" className="font-semibold text-blurple-700 underline decoration-blurple-600/40 underline-offset-2 dark:text-blurple-300" onClick={() => handleActionChange('project')}>
              Start a project
            </button>{' '}
            from this story first.
          </p>
        )}

        {actionId === 'chat' && (
          <Field label="Agent">
            <AgentSelect
              agents={agents}
              value={agents.find((entry) => sameAgent(entry, agent)) ?? RON_AGENT}
              onChange={setAgent}
              note={signedIn ? '' : 'Sign in to chat with your specialists.'}
            />
          </Field>
        )}

        {actionId === 'document' && (
          <div className="space-y-3">
            <Field label="Target document">
              <div role="radiogroup" aria-label="Document mode" className="grid grid-cols-2 gap-1 rounded-lg bg-surface-100 p-1 dark:bg-surface-900">
                <button
                  type="button"
                  role="radio"
                  aria-checked={documentMode === 'new'}
                  onClick={() => setDocumentMode('new')}
                  className={cn(
                    'inline-flex h-7 items-center justify-center gap-1.5 rounded-md text-[12px] font-semibold transition-colors duration-150',
                    documentMode === 'new'
                      ? 'bg-surface-0 text-ink shadow-subtle dark:bg-surface-700 dark:text-ink-inverse'
                      : 'text-ink-secondary hover:text-ink dark:text-ink-inverse-secondary dark:hover:text-ink-inverse',
                  )}
                >
                  <FilePlus2 className="h-3.5 w-3.5" />New document
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={documentMode === 'existing'}
                  onClick={() => setDocumentMode('existing')}
                  className={cn(
                    'inline-flex h-7 items-center justify-center gap-1.5 rounded-md text-[12px] font-semibold transition-colors duration-150',
                    documentMode === 'existing'
                      ? 'bg-surface-0 text-ink shadow-subtle dark:bg-surface-700 dark:text-ink-inverse'
                      : 'text-ink-secondary hover:text-ink dark:text-ink-inverse-secondary dark:hover:text-ink-inverse',
                  )}
                >
                  <FileText className="h-3.5 w-3.5" />Existing document
                </button>
              </div>
            </Field>

            {documentMode === 'new' ? (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Field label="Save to">
                  <ProjectSelect projects={projects} value={documentPlace} onChange={setDocumentPlace} personal />
                </Field>
                <Field label="Document title">
                  <input
                    aria-label="Document title"
                    value={documentTitle}
                    onChange={(event) => setDocumentTitle(event.target.value)}
                    placeholder="Document title"
                    className={cn('ron-field h-9 w-full rounded-lg border border-surface-200 bg-surface-0 px-3 text-[13px] outline-none transition-colors focus:border-blurple-500 dark:border-surface-700 dark:bg-surface-900', BARE)}
                  />
                </Field>
              </div>
            ) : (
              <Field label="Choose document">
                <DocumentPicker
                  documents={documents}
                  projects={projects}
                  loading={documentsLoading}
                  value={selectedDocId}
                  onChange={(doc) => setSelectedDocId(doc.id)}
                />
              </Field>
            )}
          </div>
        )}

        {projectBound && projects.length > 0 && (
          <Field label="Project">
            <ProjectSelect projects={projects} value={projectId} onChange={(id) => { setProjectId(id); setIssueId('') }} />
          </Field>
        )}

        {actionId === 'context' && project && (
          <Field label="Issue">
            <IssuePicker project={project} value={issueId} onChange={setIssueId} />
            {issueId === NEW_ISSUE && (
              <input
                aria-label="New issue title"
                value={issueTitle}
                onChange={(event) => setIssueTitle(event.target.value)}
                placeholder="New issue title"
                className={cn('ron-field h-9 w-full rounded-lg border border-surface-200 bg-surface-0 px-3 text-[13px] outline-none transition-colors focus:border-blurple-500 dark:border-surface-700 dark:bg-surface-900', BARE)}
              />
            )}
          </Field>
        )}

        {isSearch && <Field label="Depth"><DepthPicker value={level} onChange={setLevel} /></Field>}

        <Field label={action.prompt.label} htmlFor={promptId}>
          <div className="ron-field rounded-xl border border-surface-200 bg-surface-0 transition-colors focus-within:border-blurple-500 focus-within:ring-2 focus-within:ring-blurple-500/15 dark:border-surface-700 dark:bg-surface-900">
            <div className="px-2.5 pt-2.5">
              <Attachments variant="inline" aria-label="Attached context" className="gap-2">
                <PromptAttachmentCard
                  attachment={promptAttachment}
                  editable={false}
                  favicon={favicon}
                  loading={!ready}
                />
              </Attachments>
            </div>
            {isSearch ? (
              <input
                id={promptId}
                ref={(element) => { promptRef.current = element }}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={onPromptKey}
                placeholder={action.prompt.placeholder}
                className={cn('h-10 w-full rounded-xl bg-transparent px-3 text-[14px] outline-none placeholder:text-ink-muted dark:placeholder:text-ink-inverse-muted', BARE)}
              />
            ) : (
              <textarea
                id={promptId}
                ref={(element) => { promptRef.current = element }}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={onPromptKey}
                rows={3}
                placeholder={action.prompt.placeholder}
                className={cn('block max-h-48 min-h-[72px] w-full resize-none bg-transparent px-3 pt-2 text-[14px] leading-relaxed outline-none [field-sizing:content] placeholder:text-ink-muted dark:placeholder:text-ink-inverse-muted', BARE)}
              />
            )}
            <div className="flex items-center justify-end gap-2 px-2.5 pb-2.5 pt-1">
              <button
                type="button"
                onClick={() => void send()}
                disabled={blocked}
                aria-label={action.submit}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-blurple-600 px-3 text-[12.5px] font-semibold text-white transition-colors duration-150 ease-out hover:bg-blurple-700 active:bg-blurple-800 disabled:cursor-not-allowed disabled:bg-surface-200 disabled:text-ink-muted dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300 dark:disabled:bg-surface-800 dark:disabled:text-ink-inverse-muted"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />}{action.submit}
              </button>
            </div>
          </div>
        </Field>

        {error && <p role="alert" className="text-[12px] leading-snug text-danger">{error}</p>}
        <p className="flex items-center justify-between gap-3 text-[11.5px] leading-snug text-ink-muted dark:text-ink-inverse-muted">
          <span>{missing || DESTINATIONS[actionId]}</span>
          {!isSearch && <span className="hidden shrink-0 font-mono text-[10.5px] sm:inline">⌘↵ send</span>}
        </p>
      </div>
    </div>
  )
}
