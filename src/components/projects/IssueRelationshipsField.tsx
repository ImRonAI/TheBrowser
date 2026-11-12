import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, ArrowLeft, Ban, Check, ChevronDown, Copy, Hammer, Link2, Loader2, LockOpen, Search, Telescope, Wrench, X, type LucideIcon } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useProjectsStore } from '@/stores/projectsStore'
import { useIssueBlocking, type IssueBlocking } from '@/hooks/useIssueBlocking'
import { issueKey } from '@/lib/execute-issues'
import {
  DEFAULT_RELATION, RELATION_KINDS, RELATION_KIND_ROWS, isActiveBlock, linkFor, relationCandidates, relationError, relationGroups,
  type Relation, type RelationKind,
} from '@/lib/issue-relationships'
import { ISSUE_STATUS_CONFIG, type Issue, type IssueLinkType, type Project } from '@/types/projects'
import { cn } from '@/lib/utils'
import { BlockedTag } from './BlockedTag'
import { IssueStatusBadge } from './badges'
import { AddButton, PROPERTY_POPOVER, StatusIcon } from './IssueProperties'

/** Runs one relationship write for the workspace, which keeps its draft on any version the write moves this issue to. */
export type RelationshipWrite = (action: () => Promise<{ error?: string }>) => Promise<{ error?: string }>

const MUTED = 'text-ink-muted dark:text-ink-inverse-muted'
/**
 * The app's status chip (IssueStatusBadge), compact for the sidebar; the ring keeps it visible on a hovered row.
 * `leading-none` comes after the size because tailwind-merge drops an earlier leading class when a font size follows.
 */
const STATUS_CHIP = 'gap-1 px-1.5 py-[3px] text-[11px] leading-none ring-1 ring-inset ring-surface-200 dark:ring-surface-800'
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple-600/70 dark:focus-visible:ring-blurple-400/70'
/** The kinds that move an issue's status (a blocking edge from an unfinished issue). */
const BLOCKING = new Set<RelationKind>(['blocks', 'blocked-by'])

/** One glyph per relationship type; both readings share it (the group label says which way it runs). */
const RELATION_ICONS: Record<IssueLinkType, LucideIcon> = {
  relates: Link2, blocks: Ban, enables: LockOpen, implements: Hammer, fixes: Wrench, discovers: Telescope, duplicates: Copy,
}

export function RelationIcon({ kind, className }: { kind: RelationKind; className?: string }) {
  const Icon = RELATION_ICONS[RELATION_KINDS[kind].type]
  return <Icon aria-hidden className={cn('size-3.5 shrink-0', className)} />
}

/**
 * The issue's **Relationships** in the workspace sidebar. Each relationship is listed under the way this issue
 * reads it ("Blocked by", "Blocks", … "Relates to"); a row opens the other issue and × removes the link.
 * **Add relationship** picks a kind (default "Relates to") and searches the issues of every project the user
 * can open. Links are written through the projects store, which merges the issues the server moved with them:
 * a blocker that is not done moves its target to Blocked, and removing its last open blocker moves it back.
 */
export function IssueRelationshipsField({ issue, disabled, onOpen, write }: {
  issue: Issue
  disabled?: boolean
  /** Opens a related issue in this workspace (the workspace saves the draft first). */
  onOpen: (issueId: string) => void
  write: RelationshipWrite
}) {
  const { issues, projects, issueLinks, addIssueLink, removeIssueLink } = useProjectsStore()
  const blockingOf = useIssueBlocking()
  const id = useId()
  const groups = useMemo(() => relationGroups(issue.id, issueLinks, issues), [issue.id, issueLinks, issues])
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const remove = async (relation: Relation) => {
    if (removing) return
    setRemoving(relation.link.id)
    setError(null)
    const result = await write(() => removeIssueLink(relation.link.id))
    setRemoving(null)
    if (result.error) setError(`The relationship was not removed: ${result.error}`)
  }
  const add = async (kind: RelationKind, other: Issue) => {
    const { sourceId, targetId, type } = linkFor(kind, issue.id, other.id)
    const result = await write(() => addIssueLink(sourceId, targetId, type))
    if (result.error) return relationError(result.error)
    setError(null)
    return null
  }

  return <div className="space-y-2">
    {groups.map((group) => {
      // "Blocked by" turns rose while an unfinished blocker holds this issue.
      const held = group.kind === 'blocked-by' && group.relations.some((relation) => isActiveBlock(relation, issue))
      return <div key={group.kind} role="group" aria-labelledby={`${id}-${group.kind}`}>
        <p id={`${id}-${group.kind}`} className={cn('flex h-6 items-center gap-1.5 px-2 text-[11.5px] font-medium',
          held ? 'text-rose-700 dark:text-rose-300' : 'text-ink-secondary dark:text-ink-inverse-secondary')}>
          {group.label}<span className={cn('font-mono text-[11px] tabular-nums', MUTED)}>{group.relations.length}</span>
        </p>
        <ul className="space-y-0.5">
          {group.relations.map((relation) => <RelationRow key={relation.link.id} relation={relation} issue={issue} projectsById={projectsById}
            blocking={relation.other ? blockingOf(relation.other) : null} disabled={disabled} removing={removing === relation.link.id}
            onOpen={onOpen} onRemove={() => void remove(relation)} />)}
        </ul>
      </div>
    })}
    <AddRelationship issue={issue} disabled={disabled} onAdd={add} />
    {error && <p role="alert" className="px-2 text-[12px] text-red-700 dark:text-red-400">{error}</p>}
  </div>
}

function RelationRow({ relation, issue, projectsById, blocking, disabled, removing, onOpen, onRemove }: {
  relation: Relation
  issue: Issue
  projectsById: Map<string, Project>
  blocking: IssueBlocking | null
  disabled?: boolean
  removing: boolean
  onOpen: (issueId: string) => void
  onRemove: () => void
}) {
  const { kind, other } = relation
  const key = other ? issueKey(other, projectsById) : null
  // The key names the project; another project's name is spelled out too.
  const elsewhere = other && other.projectId !== issue.projectId ? projectsById.get(other.projectId) : undefined
  return <li className="group/rel relative flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors duration-150 ease-out hover:bg-surface-100 dark:hover:bg-surface-850">
    <RelationIcon kind={kind} className={cn('mt-[3px]', isActiveBlock(relation, issue) ? 'text-rose-600 dark:text-rose-400' : MUTED)} />
    <button type="button" disabled={!other || disabled} onClick={() => other && onOpen(other.id)}
      title={other ? `Open ${key}${elsewhere ? ` in ${elsewhere.name}` : ''}` : undefined}
      className="min-w-0 flex-1 rounded-sm text-left after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-blurple-600/70 disabled:cursor-default dark:focus-visible:after:ring-blurple-400/70">
      <span className="flex min-w-0 items-baseline gap-2">
        {key && <span className="shrink-0 font-mono text-[11.5px] font-medium tabular-nums tracking-[0.02em] text-ink-secondary dark:text-ink-inverse-secondary">{key}</span>}
        <span className={cn('truncate text-[13px]', other ? 'text-ink dark:text-ink-inverse' : MUTED)}>{other ? other.title || 'Untitled issue' : 'Issue not available'}</span>
      </span>
      <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
        {other ? <>
          {/* A Blocked status reads from the tag alone. */}
          {other.status !== 'blocked' && <IssueStatusBadge status={other.status} className={STATUS_CHIP} />}
          {blocking?.blocked && <BlockedTag label={blocking.label} />}
          {elsewhere && <span className={cn('min-w-0 truncate text-[11.5px]', MUTED)}>{elsewhere.name}</span>}
        </> : <span className={cn('text-[11.5px]', MUTED)}>Deleted, or not shared with you</span>}
      </span>
    </button>
    {removing
      ? <span role="status" aria-label="Removing the relationship" className="flex size-6 shrink-0 items-center justify-center"><Loader2 className={cn('size-3.5 animate-spin', MUTED)} /></span>
      : <button type="button" aria-label={`Remove “${RELATION_KINDS[kind].label} ${key ?? 'an unavailable issue'}”`} title="Remove relationship" disabled={disabled} onClick={onRemove}
          className={cn('relative z-[1] -mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted opacity-0 transition-[color,background-color,opacity] duration-150 hover:bg-red-50 hover:text-red-700 focus-visible:opacity-100 group-hover/rel:opacity-100 group-focus-within/rel:opacity-100 disabled:invisible dark:text-ink-inverse-muted dark:hover:bg-red-950/40 dark:hover:text-red-400', FOCUS_RING)}>
          <X className="size-3.5" />
        </button>}
  </li>
}

/**
 * The **Add relationship** popover: the chosen kind with its one-line hint (a button that opens the kind
 * picker), then a search over every loaded project's issues (↑/↓ move, Enter links, Esc closes). It closes
 * once the link is saved; a failure stays here, inline.
 */
function AddRelationship({ issue, disabled, onAdd }: {
  issue: Issue
  disabled?: boolean
  /** Creates the link; resolves to the error to show, or null once it is saved. */
  onAdd: (kind: RelationKind, other: Issue) => Promise<string | null>
}) {
  const { issues, projects, issueLinks, isInitialized } = useProjectsStore()
  const [open, setOpen] = useState(false)
  const [choosingKind, setChoosingKind] = useState(false)
  const [kind, setKind] = useState<RelationKind>(DEFAULT_RELATION)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [adding, setAdding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const id = useId()
  const candidates = useMemo(() => (open ? relationCandidates(query, { issue, kind, issues, projects, links: issueLinks }) : []),
    [open, query, kind, issue, issues, projects, issueLinks])
  const current = Math.min(active, candidates.length - 1)
  const busy = !!disabled || adding !== null
  const { label, hint } = RELATION_KINDS[kind]

  useEffect(() => { if (open && !choosingKind) input.current?.focus() }, [open, choosingKind])
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' }) }, [current])

  const close = () => { setOpen(false); setChoosingKind(false); setKind(DEFAULT_RELATION); setQuery(''); setActive(0); setError(null) }
  const choose = async (index: number) => {
    const candidate = candidates[index]
    if (!candidate || busy) return
    setAdding(candidate.issue.id)
    setError(null)
    const problem = await onAdd(kind, candidate.issue)
    setAdding(null)
    if (problem) setError(problem)
    else close()
  }
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive(Math.max(0, Math.min(current + step, candidates.length - 1)))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      void choose(current)
    }
  }
  const others = issues.some((item) => item.id !== issue.id)
  const empty = !isInitialized ? 'Loading issues…'
    : !others ? 'There are no other issues to relate yet.'
    : query.trim() ? `No other issue matches “${query.trim()}”.`
    : 'Every other issue is already related this way.'

  return <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
    <PopoverTrigger asChild>
      <AddButton aria-label="Add relationship" disabled={disabled}>Add relationship</AddButton>
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={6} collisionPadding={12}
      className={cn(PROPERTY_POPOVER, 'flex w-[26rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden p-0')}
      style={{ maxHeight: 'min(32rem, var(--radix-popover-content-available-height))' }}
      onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus() }}
      // In the kind picker, Esc steps back to the search; from the search it closes (and the issue stays open).
      onEscapeKeyDown={(event) => { if (choosingKind) { event.preventDefault(); setChoosingKind(false) } }}>
      {choosingKind
        ? <KindPicker value={kind} onBack={() => setChoosingKind(false)}
            onChoose={(next) => { setKind(next); setActive(0); setError(null); setChoosingKind(false) }} />
        : <>
          <div className="shrink-0 border-b border-border p-1.5">
            <button type="button" onClick={() => setChoosingKind(true)} aria-label={`Relationship: ${label}. Change it`} aria-describedby={`${id}-hint`}
              className={cn('group flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-100 dark:hover:bg-surface-800', FOCUS_RING)}>
              <span className={cn('mt-px flex size-6 shrink-0 items-center justify-center rounded-md', BLOCKING.has(kind)
                ? 'bg-rose-500/10 text-rose-600 dark:bg-rose-400/10 dark:text-rose-300'
                : 'bg-blurple-50 text-blurple-600 dark:bg-blurple-400/15 dark:text-blurple-300')}><RelationIcon kind={kind} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-[13px] font-semibold text-ink dark:text-ink-inverse">{label}<ChevronDown className={cn('size-3.5', MUTED)} /></span>
                <span id={`${id}-hint`} className={cn('mt-0.5 block text-[12px] leading-snug', MUTED)}>{hint}</span>
              </span>
              <span aria-hidden className="mt-0.5 shrink-0 text-[12px] font-medium text-blurple-600 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:text-blurple-400">Change</span>
            </button>
          </div>
          <div className="ron-field flex shrink-0 items-center gap-2 border-b border-border px-3">
            <Search className={cn('size-3.5 shrink-0', MUTED)} />
            <input ref={input} role="combobox" aria-expanded aria-controls={`${id}-list`} aria-autocomplete="list"
              aria-activedescendant={current >= 0 ? `${id}-option-${current}` : undefined}
              aria-label={`Search issues to add as “${label}”`} placeholder="Search every project by key or title…" value={query}
              onChange={(event) => { setQuery(event.target.value); setActive(0); setError(null) }} onKeyDown={onSearchKey}
              className="h-10 w-full bg-transparent text-[13px] text-ink placeholder:text-ink-muted focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted" />
          </div>
          {candidates.length === 0 && <p className={cn('shrink-0 px-3 py-6 text-center text-[13px]', MUTED)}>{empty}</p>}
          <ul ref={list} id={`${id}-list`} role="listbox" aria-label={`Issues to add as “${label}”`} aria-busy={adding !== null}
            className={cn('min-h-0 flex-1 overflow-y-auto p-1', candidates.length === 0 && 'hidden')}>
            {candidates.map((candidate, index) => {
              const elsewhere = candidate.issue.projectId !== issue.projectId
              return <li key={candidate.issue.id} id={`${id}-option-${index}`} role="option" aria-selected={index === current} aria-disabled={busy || undefined}
                data-index={index} onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => void choose(index)}
                className={cn('flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-ink dark:text-ink-inverse',
                  index === current && 'bg-surface-100 dark:bg-surface-800', busy ? 'cursor-default' : 'cursor-pointer',
                  adding !== null && adding !== candidate.issue.id && 'opacity-50')}>
                {adding === candidate.issue.id ? <Loader2 className="size-3.5 shrink-0 animate-spin text-volt" /> : <StatusIcon status={candidate.issue.status} />}
                <span className="min-w-[3.5rem] shrink-0 font-mono text-[11.5px] font-medium tabular-nums tracking-[0.02em] text-ink-secondary dark:text-ink-inverse-secondary">{candidate.key}</span>
                <span className="min-w-0 flex-1 truncate">{candidate.issue.title || 'Untitled issue'}</span>
                <span className="sr-only">, {ISSUE_STATUS_CONFIG[candidate.issue.status]?.label ?? candidate.issue.status}</span>
                <span className={cn('max-w-[6.5rem] shrink-0 truncate text-[11.5px]', elsewhere ? 'text-ink-secondary dark:text-ink-inverse-secondary' : MUTED)}>{candidate.project?.name}</span>
              </li>
            })}
          </ul>
          {error && <p role="alert" className="flex shrink-0 items-start gap-2 border-t border-border bg-red-50 px-3 py-2 text-[12px] leading-snug text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />{error}
          </p>}
          <p aria-hidden className={cn('flex shrink-0 items-center gap-3 border-t border-border px-3 py-1.5 font-mono text-[10.5px]', MUTED)}>
            <span>↑↓ move</span><span>↵ link</span><span>esc close</span>
          </p>
        </>}
    </PopoverContent>
  </Popover>
}

/**
 * The kinds as a radio group laid out in pairs: "Relates to", then each type with its two readings side by
 * side. Arrow keys move (↑/↓ between rows, ←/→ through the list), Enter or a click picks; the hint follows
 * the pointer or focus.
 */
function KindPicker({ value, onChoose, onBack }: { value: RelationKind; onChoose: (kind: RelationKind) => void; onBack: () => void }) {
  const [focused, setFocused] = useState(value)
  const [hovered, setHovered] = useState<RelationKind | null>(null)
  const buttons = useRef(new Map<RelationKind, HTMLButtonElement>())
  const id = useId()
  useEffect(() => { buttons.current.get(value)?.focus() }, [value])
  const order = RELATION_KIND_ROWS.flat()
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const row = RELATION_KIND_ROWS.findIndex((kinds) => kinds.includes(focused))
    const column = RELATION_KIND_ROWS[row].indexOf(focused)
    const inRow = (index: number) => {
      const kinds = RELATION_KIND_ROWS[Math.max(0, Math.min(index, RELATION_KIND_ROWS.length - 1))]
      return kinds[Math.min(column, kinds.length - 1)]
    }
    const at = order.indexOf(focused)
    const next = ({
      ArrowDown: inRow(row + 1), ArrowUp: inRow(row - 1),
      ArrowRight: order[Math.min(at + 1, order.length - 1)], ArrowLeft: order[Math.max(at - 1, 0)],
      Home: order[0], End: order[order.length - 1],
    } as Partial<Record<string, RelationKind>>)[event.key]
    if (!next) return
    event.preventDefault()
    setFocused(next)
    buttons.current.get(next)?.focus()
  }
  return <div className="flex min-h-0 flex-col">
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-1.5 py-1.5">
      <button type="button" aria-label="Back to the issue search" onClick={onBack}
        className={cn('flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-surface-800 dark:hover:text-ink-inverse', FOCUS_RING)}>
        <ArrowLeft className="size-3.5" />
      </button>
      <p id={`${id}-title`} className="text-[13px] font-semibold text-ink dark:text-ink-inverse">How are they related?</p>
    </div>
    <div role="radiogroup" aria-labelledby={`${id}-title`} onKeyDown={move} onMouseLeave={() => setHovered(null)}
      className="grid min-h-0 grid-cols-2 gap-1 overflow-y-auto p-1.5">
      {RELATION_KIND_ROWS.map((kinds) => kinds.map((kind) => {
        const checked = kind === value
        const info = RELATION_KINDS[kind]
        return <button key={kind} type="button" role="radio" aria-checked={checked} tabIndex={kind === focused ? 0 : -1}
          ref={(node) => { if (node) buttons.current.set(kind, node); else buttons.current.delete(kind) }}
          onFocus={() => setFocused(kind)} onMouseEnter={() => setHovered(kind)} onClick={() => onChoose(kind)}
          className={cn('flex h-8 min-w-0 items-center gap-2 rounded-lg px-2.5 text-left text-[12.5px] font-medium transition-colors duration-150', FOCUS_RING,
            kinds.length === 1 && 'col-span-2',
            checked ? 'bg-blurple-50 text-blurple-700 dark:bg-blurple-950/50 dark:text-blurple-300' : 'text-ink hover:bg-surface-100 dark:text-ink-inverse dark:hover:bg-surface-800')}>
          <RelationIcon kind={kind} className={BLOCKING.has(kind) ? 'text-rose-600 dark:text-rose-400' : checked ? undefined : MUTED} />
          <span className="min-w-0 flex-1 truncate">{info.label}<span className="sr-only">: {info.hint}</span></span>
          {checked && <Check aria-hidden className="size-3.5 shrink-0" />}
        </button>
      }))}
    </div>
    <p aria-hidden className={cn('shrink-0 border-t border-border px-3 py-2 text-[12px] leading-snug', MUTED)}>{RELATION_KINDS[hovered ?? focused].hint}</p>
  </div>
}
