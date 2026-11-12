import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { ArrowLeft, ArrowUpRight, FolderInput, Loader2, Search } from 'lucide-react'
import { RenIcon } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAgentUi } from '@/context/AgentUiContext'
import { RON_AGENT } from '@/lib/panel-agents'
import { UNTITLED, createProjectFromDocumentPrompt, documentErrorMessage } from '@/lib/project-documents'
import { usePanelAgentStore } from '@/stores/panelAgentStore'
import type { Project } from '@/types/projects'
import { cn } from '@/lib/utils'

const plural = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`

/** The open page as the actions need it (a never-saved draft too: it is saved before it moves). */
interface LibraryPage { title: string; parentId: string | null }

/**
 * The library's actions on the open page: Add to project (a personal page) or Move to project, Open in project, and
 * Create project with Ren, which saves the page and starts a new chat with Ren asking it to build a project from it.
 */
export function LibraryPageActions({ page, project, projects, subpages, blank, disabled, onMove, onOpenInProject, savePage }: {
  page: LibraryPage
  /** The page's project; null for a personal page. */
  project: Project | null
  /** Where the page can go: projects the user can access that are not archived, its own left out. */
  projects: Project[]
  /** Pages under this one (they move with it). */
  subpages: number
  blank: boolean
  disabled: boolean
  onMove: (projectId: string) => Promise<void>
  onOpenInProject: () => void
  /** Saves the page; its id and saved title, or null when it could not be saved. */
  savePage: () => Promise<{ id: string; title: string } | null>
}) {
  const { sendToAgentPanel } = useAgentUi()
  const [handing, setHanding] = useState(false)
  const [note, setNote] = useState<{ alert: boolean; text: string } | null>(null)

  const createWithRen = async () => {
    if (blank) { setNote({ alert: true, text: 'Write the page first: Ren builds the project from what it says.' }); return }
    setHanding(true); setNote(null)
    try {
      const saved = await savePage()
      if (!saved) { setNote({ alert: true, text: 'Save the page first: it has changes that could not be saved.' }); return }
      // A new chat with Ren (not the agent of whatever chat is open), then the request goes to that chat.
      usePanelAgentStore.getState().requestAgent(RON_AGENT)
      sendToAgentPanel(createProjectFromDocumentPrompt(saved, project))
      setNote({ alert: false, text: 'Ren is creating the project in the Agent Panel. When it’s done, reload documents to see this page in it.' })
    } catch (cause) {
      setNote({ alert: true, text: documentErrorMessage(cause, 'The page could not be sent to Ren.') })
    } finally {
      setHanding(false)
    }
  }

  return (
    <div className="mt-3">
      <div role="group" aria-label="Page actions" className="flex flex-wrap items-center gap-2">
        <MoveToProject page={page} project={project} projects={projects} subpages={subpages} disabled={disabled} onMove={onMove} />
        {project && (
          <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5 rounded-full text-ink-secondary dark:text-ink-inverse-secondary"
            title={`Open this page in ${project.name}’s Docs`} disabled={disabled} onClick={onOpenInProject}>
            <ArrowUpRight />Open in project
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 rounded-full" disabled={disabled || handing}
          title="Ren reads this page, creates a project and its issues from it, and adds the page to that project"
          onClick={() => void createWithRen()}>
          {handing ? <Loader2 className="animate-spin" /> : <RenIcon />}Create project with Ren
        </Button>
      </div>
      {note && (
        <p role={note.alert ? 'alert' : 'status'} className={cn('mt-2 text-body-xs', note.alert ? 'text-danger' : 'text-ink-muted dark:text-ink-inverse-muted')}>
          {note.text}
        </p>
      )}
    </div>
  )
}

/** Add to project / Move to project: pick a project (search, ↑/↓, Enter), then confirm what moves with the page. */
function MoveToProject({ page, project, projects, subpages, disabled, onMove }: {
  page: LibraryPage
  project: Project | null
  projects: Project[]
  subpages: number
  disabled: boolean
  onMove: (projectId: string) => Promise<void>
}) {
  const verb = project ? 'Move' : 'Add'
  const title = page.title.trim() || UNTITLED
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [target, setTarget] = useState<Project | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const words = query.trim().toLowerCase()
  const matches = useMemo(() => projects.filter((candidate) => !words || `${candidate.name} ${candidate.key}`.toLowerCase().includes(words)), [projects, words])
  const highlighted = matches[Math.min(active, matches.length - 1)]

  const reset = () => { setQuery(''); setActive(0); setTarget(null); setError('') }
  const changeOpen = (next: boolean) => {
    if (busy) return
    setOpen(next)
    if (!next) reset()
  }
  const confirm = async () => {
    if (!target || busy) return
    setBusy(true); setError('')
    try {
      await onMove(target.id)
      setOpen(false); reset()
    } catch (cause) {
      setError(documentErrorMessage(cause, `The page could not be ${project ? 'moved' : 'added'}.`))
    } finally {
      setBusy(false)
    }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (matches.length) setActive((index) => (Math.min(index, matches.length - 1) + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length)
    }
    if (event.key === 'Enter' && highlighted) { event.preventDefault(); setTarget(highlighted) }
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 rounded-full" disabled={disabled}>
          <FolderInput />{verb} to project
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="z-[200] w-80 rounded-2xl border-border p-0 data-[state=open]:shadow-float">
        {target ? (
          <div className="p-4">
            <p className="text-[14px] font-semibold leading-snug text-popover-foreground">{verb} “{title}” to {target.name}?</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[12.5px] leading-snug text-muted-foreground">
              {subpages > 0 && <li>The {plural(subpages, 'page')} under it {subpages === 1 ? 'moves' : 'move'} with it.</li>}
              {page.parentId && <li>It leaves its parent page and becomes a top-level page in {target.key}.</li>}
              <li>{project ? `It leaves ${project.name}. ` : 'It stops being private. '}Everyone in {target.name} can open and edit it.</li>
              <li>Its linked issues and Ren conversations stay with it.</li>
            </ul>
            {error && <p role="alert" className="mt-3 text-[12.5px] text-danger">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" size="sm" variant="outline" className="gap-1.5 rounded-full" disabled={busy} onClick={() => { setTarget(null); setError('') }}>
                <ArrowLeft />Back
              </Button>
              <Button type="button" size="sm" className="gap-1.5 rounded-full" disabled={busy} autoFocus onClick={() => void confirm()}>
                {busy && <Loader2 className="animate-spin" />}{verb} {subpages > 0 ? plural(subpages + 1, 'page') : 'page'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-2">
            <p className="px-1.5 pb-2 pt-1 text-[13px] font-semibold text-popover-foreground">{verb} “{title}” to a project</p>
            <label className="ron-field relative flex h-9 items-center rounded-xl border border-surface-200 bg-surface-0 focus-within:border-blurple-400 focus-within:ring-2 focus-within:ring-blurple-500/20 dark:border-surface-700 dark:bg-surface-850">
              <span className="sr-only">Find a project</span>
              <Search aria-hidden className="pointer-events-none absolute left-2.5 size-4 text-ink-muted dark:text-ink-inverse-muted" />
              <input autoFocus value={query} placeholder="Find a project" autoComplete="off" spellCheck={false}
                role="combobox" aria-expanded aria-controls={listId} aria-autocomplete="list"
                aria-activedescendant={highlighted ? `${listId}-${highlighted.id}` : undefined}
                onChange={(event) => { setQuery(event.target.value); setActive(0) }} onKeyDown={onKeyDown}
                className="h-full w-full min-w-0 bg-transparent pl-8 pr-3 text-[13px] text-ink placeholder:text-ink-muted focus:outline-none dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted" />
            </label>
            <ul id={listId} role="listbox" aria-label="Projects" className="mt-1.5 max-h-64 overflow-y-auto">
              {matches.map((candidate) => (
                <li key={candidate.id} id={`${listId}-${candidate.id}`} role="option" aria-selected={candidate === highlighted}
                  onMouseEnter={() => setActive(matches.indexOf(candidate))} onMouseDown={(event) => event.preventDefault()} onClick={() => setTarget(candidate)}
                  className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-popover-foreground', candidate === highlighted && 'bg-muted')}>
                  <span className="min-w-0 truncate">{candidate.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{candidate.key}</span>
                </li>
              ))}
            </ul>
            {matches.length === 0 && (
              <p className="px-2.5 py-3 text-[12.5px] text-muted-foreground">
                {projects.length === 0
                  ? (project ? 'You have no other projects to move it to.' : 'You have no projects yet. Create project with Ren builds one from this page.')
                  : `No projects match “${query.trim()}”.`}
              </p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
