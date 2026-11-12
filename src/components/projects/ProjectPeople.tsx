import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Check, Loader2, LogOut, UserPlus, Users, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { openInternalUrl } from '@/components/board/task-detail/editor/extensions/blocks/workspace'
import { projectsRequestFor, useProjectsStore } from '@/stores/projectsStore'
import {
  EMAIL_MAX, emailProblem, initials, inviteMember, isCurrentMember, listMembers, orderMembers, removeMember, withMember,
  type ProjectMember,
} from '@/lib/project-members'
import type { ProjectsRequest } from '@/lib/projects-api'
import { isGuestUserId, openSignIn } from '@/lib/sign-in'
import type { Project } from '@/types/projects'
import { cn } from '@/lib/utils'
import { PROPERTY_POPOVER } from './IssueProperties'

const messageOf = (cause: unknown) => (cause instanceof Error && cause.message ? cause.message : 'Something went wrong. Try again.')
const count = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

export interface ProjectMembers {
  members: ProjectMember[]
  status: 'loading' | 'ready' | 'error'
  /** The last load failure ('' when none); a failed refresh keeps the people already shown. */
  error: string
  request: ProjectsRequest | null
  reload: () => Promise<void>
  /** Applies a change the server confirmed (an invite, a removal) and drops any older load still in flight. */
  update: (change: (members: ProjectMember[]) => ProjectMember[]) => void
}

/** The people on `projectId` for the signed-in user or guest workspace; `reload` refreshes them in place. */
export function useProjectMembers(projectId: string | null): ProjectMembers {
  const { userId } = useProjectsStore()
  const request = useMemo(() => (userId ? projectsRequestFor(userId) : null), [userId])
  const key = request && projectId ? `${userId}:${projectId}` : null
  const [loaded, setLoaded] = useState<{ key: string; members: ProjectMember[]; error: string } | null>(null)
  // Only the newest load (or confirmed change) may write: an older answer would undo an invite.
  const latest = useRef(0)

  const reload = useCallback(async () => {
    if (!request || !projectId || !key) return
    const ticket = ++latest.current
    try {
      const members = await listMembers(request, projectId)
      if (ticket === latest.current) setLoaded({ key, members, error: '' })
    } catch (cause) {
      if (ticket === latest.current)
        setLoaded((current) => ({ key, members: current?.key === key ? current.members : [], error: messageOf(cause) }))
    }
  }, [request, projectId, key])

  useEffect(() => {
    void reload()
    return () => { latest.current += 1 }
  }, [reload])

  const update = useCallback((change: (members: ProjectMember[]) => ProjectMember[]) => {
    if (!key) return
    latest.current += 1
    setLoaded((current) => ({ key, members: orderMembers(change(current?.key === key ? current.members : [])), error: '' }))
  }, [key])

  const current = loaded?.key === key ? loaded : null
  return {
    members: current?.members ?? [],
    status: !current ? 'loading' : current.error && current.members.length === 0 ? 'error' : 'ready',
    error: current?.error ?? '',
    request, reload, update,
  }
}

type Confirm = { kind: 'remove'; member: ProjectMember } | { kind: 'leave' }

const FIELD = 'h-8 min-w-0 flex-1 rounded-lg border border-surface-200 bg-surface-0 px-2.5 text-[13px] text-ink placeholder:text-ink-muted transition-colors duration-150 focus:border-blurple-600 focus:outline-none focus:ring-2 focus:ring-blurple-600/20 focus-visible:ring-offset-0 aria-[invalid=true]:border-red-500 dark:border-surface-700 dark:bg-surface-900 dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted dark:focus:border-blurple-400 dark:focus:ring-blurple-400/25'
const PRIMARY = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-blurple-600 px-3 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-blurple-700 active:bg-blurple-800 disabled:opacity-40 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300 [&_svg]:size-3.5'
const QUIET = 'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-100 hover:text-ink disabled:opacity-40 dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse'

/**
 * The project header's **Share** button: the people on the project as initials, and a popover listing
 * everyone with their role. The owner invites an existing Ren account by email and removes people; a
 * member can leave (and lands back on the Projects list). A guest workspace lives on one device, so a
 * guest is told that inviting needs an account.
 */
export function ProjectPeople({ project, people }: { project: Project; people: ProjectMembers }) {
  const { userId, refreshFromServer } = useProjectsStore()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const leaveRef = useRef<HTMLButtonElement>(null)
  // Set when the confirmation closes, so focus returns to the form instead of the page.
  const returnFocus = useRef(false)
  const inputId = useId()
  const hintId = useId()

  const guest = isGuestUserId(userId)
  const owner = !guest && project.ownerId === userId
  const { members, request } = people

  useEffect(() => {
    if (confirm || !returnFocus.current) return
    returnFocus.current = false
    ;(inputRef.current ?? leaveRef.current)?.focus()
  }, [confirm])

  const close = () => { setOpen(false); setConfirm(null); setInviteError(''); setNotice(''); setActionError('') }
  const onOpenChange = (next: boolean) => {
    if (next) { setOpen(true); void people.reload() }
    else if (!busy) close()
  }
  const ask = (next: Confirm) => { setNotice(''); setActionError(''); setConfirm(next) }
  const backToList = () => { returnFocus.current = true; setConfirm(null); setActionError('') }

  const invite = async (event: FormEvent) => {
    event.preventDefault()
    if (inviting || !request) return
    setNotice('')
    const problem = emailProblem(email)
    if (problem) { setInviteError(problem); inputRef.current?.focus(); return }
    setInviting(true)
    setInviteError('')
    try {
      const member = await inviteMember(request, project.id, email)
      const already = members.some((item) => item.userId === member.userId)
      people.update((current) => withMember(current, member))
      setEmail('')
      setNotice(already ? `${member.name} is already on this project.` : `${member.name} can now open ${project.name}.`)
    } catch (cause) {
      setInviteError(messageOf(cause))
    } finally {
      setInviting(false)
      // A click on Invite disabled the button under the cursor; keep typing in the field.
      inputRef.current?.focus()
    }
  }

  const confirmed = async () => {
    if (!confirm || !request || !userId || busy) return
    const target = confirm.kind === 'remove' ? confirm.member : null
    setBusy(true)
    setActionError('')
    try {
      await removeMember(request, project.id, target ? target.userId : userId)
      setBusy(false)
      if (target) {
        people.update((current) => current.filter((item) => item.userId !== target.userId))
        setNotice(`${target.name} no longer has access.`)
        backToList()
        return
      }
      close()
      // The project left this account: go back to the list and reload it without the project.
      openInternalUrl('ron://projects')
      void refreshFromServer()
    } catch (cause) {
      setActionError(messageOf(cause))
      setBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className={cn('rounded-full', members.length > 0 && 'pl-1.5')}>
          <Faces members={members} />
          Share
          {members.length > 0 && <span className="sr-only">, {count(members.length)} on this project</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} collisionPadding={16}
        className={cn(PROPERTY_POPOVER, 'w-[min(22rem,calc(100vw-2rem))] overflow-hidden p-0')}
        onOpenAutoFocus={(event) => { if (owner) { event.preventDefault(); inputRef.current?.focus() } }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault()
          else if (confirm) { event.preventDefault(); backToList() }
        }}>
        {confirm ? (
          <div className="p-4">
            <p className="text-[13.5px] font-semibold text-ink dark:text-ink-inverse">
              {confirm.kind === 'remove' ? `Remove ${confirm.member.name}?` : `Leave ${project.name}?`}
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
              {confirm.kind === 'remove'
                ? `They lose access to ${project.name}’s issues and documents. You can invite them again any time.`
                : 'You lose access to its issues and documents. The owner can invite you again.'}
            </p>
            {actionError && <p role="alert" className="mt-2 text-[12px] text-red-700 dark:text-red-400">{actionError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" autoFocus disabled={busy} onClick={backToList} className={QUIET}>Cancel</button>
              <Button type="button" size="sm" variant="destructive" className="rounded-lg text-[13px]" disabled={busy} onClick={() => void confirmed()}>
                {busy && <Loader2 className="animate-spin" />}{confirm.kind === 'remove' ? 'Remove' : 'Leave project'}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-border px-4 pb-3 pt-3.5">
              <p className="truncate text-[13.5px] font-semibold text-ink dark:text-ink-inverse">Share “{project.name}”</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
                Everyone on this project can open and edit its issues and documents.
              </p>
            </div>
            <div className="max-h-72 overflow-y-auto p-1.5">
              <ul aria-label="People on this project">
                {members.map((member) => {
                  const you = isCurrentMember(member, userId)
                  return (
                    <li key={member.userId} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                      <Avatar member={member} className="size-7 text-[11px]" />
                      <div className="min-w-0 flex-1">
                        <p className="flex min-w-0 items-baseline gap-1.5 text-[13px] font-medium text-ink dark:text-ink-inverse">
                          <span className="truncate">{member.name}</span>
                          {you && member.name !== 'You' && <span className="shrink-0 text-[12px] font-normal text-ink-muted dark:text-ink-inverse-muted">(you)</span>}
                        </p>
                        {member.email && <p className="truncate text-[12px] text-ink-muted dark:text-ink-inverse-muted">{member.email}</p>}
                      </div>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4',
                        member.role === 'owner'
                          ? 'bg-blurple-600/10 text-blurple-700 dark:bg-blurple-400/15 dark:text-blurple-300'
                          : 'bg-surface-100 text-ink-secondary dark:bg-surface-800 dark:text-ink-inverse-secondary')}>
                        {member.role === 'owner' ? 'Owner' : 'Member'}
                      </span>
                      {owner && member.role !== 'owner' && (
                        <button type="button" aria-label={`Remove ${member.name} from ${project.name}`} title={`Remove ${member.name}`}
                          onClick={() => ask({ kind: 'remove', member })}
                          className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple-600/60 dark:text-ink-inverse-muted dark:hover:bg-red-950/40 dark:hover:text-red-400 dark:focus-visible:ring-blurple-400/60">
                          <X className="size-3.5" />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
              {people.status === 'loading' && (
                <p role="status" className="flex items-center gap-2 px-2 py-2 text-[12.5px] text-ink-muted dark:text-ink-inverse-muted">
                  <Loader2 className="size-3.5 animate-spin" />Loading people…
                </p>
              )}
              {people.error && (
                <div role="alert" className="flex items-center justify-between gap-2 px-2 py-2 text-[12.5px] text-red-700 dark:text-red-400">
                  <span className="min-w-0">{people.status === 'error' ? `Couldn’t load the people on this project. ${people.error}` : people.error}</span>
                  <button type="button" onClick={() => void people.reload()} className="shrink-0 font-medium underline-offset-2 hover:underline">Try again</button>
                </div>
              )}
            </div>
            <div className="border-t border-border p-3">
              {guest ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12.5px] leading-snug text-ink-secondary dark:text-ink-inverse-secondary">Inviting people needs a Ren account.</p>
                  <button type="button" className={PRIMARY} onClick={() => { close(); openSignIn() }}>Sign in</button>
                </div>
              ) : owner ? (
                <form noValidate onSubmit={(event) => void invite(event)}>
                  <label htmlFor={inputId} className="mb-1.5 block text-[12px] font-medium text-ink-secondary dark:text-ink-inverse-secondary">
                    Invite someone by email
                  </label>
                  <div className="flex gap-2">
                    <input ref={inputRef} id={inputId} type="email" inputMode="email" autoComplete="off" spellCheck={false}
                      maxLength={EMAIL_MAX} value={email} placeholder="name@example.com"
                      aria-invalid={inviteError ? true : undefined} aria-describedby={hintId}
                      onChange={(event) => { setEmail(event.target.value); setInviteError(''); setNotice('') }}
                      className={FIELD} />
                    <button type="submit" disabled={inviting || !email.trim()} className={PRIMARY}>
                      {inviting ? <Loader2 className="animate-spin" /> : <UserPlus />}Invite
                    </button>
                  </div>
                  <div id={hintId} className="mt-1.5 min-h-4 text-[12px] leading-4">
                    {inviteError ? (
                      <p role="alert" className="text-red-700 dark:text-red-400">{inviteError}</p>
                    ) : notice ? (
                      <p role="status" className="flex items-center gap-1.5 text-ink-secondary dark:text-ink-inverse-secondary">
                        <Check className="size-3.5 shrink-0 text-success" />{notice}
                      </p>
                    ) : (
                      <p className="text-ink-muted dark:text-ink-inverse-muted">They need a Ren account. The project then appears in their Projects list.</p>
                    )}
                  </div>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12.5px] leading-snug text-ink-muted dark:text-ink-inverse-muted">Only the owner can invite or remove people.</p>
                  <button ref={leaveRef} type="button" onClick={() => ask({ kind: 'leave' })}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-red-700 transition-colors duration-150 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
                    <LogOut className="size-3.5" />Leave project
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Up to three people as overlapping initials, then "+N". */
function Faces({ members }: { members: ProjectMember[] }) {
  if (members.length === 0) return <Users aria-hidden />
  const shown = members.slice(0, 3)
  const more = members.length - shown.length
  return (
    <span aria-hidden className="flex -space-x-1.5">
      {shown.map((member) => <Avatar key={member.userId} member={member} className="size-6 text-[10px] ring-2 ring-background" />)}
      {more > 0 && (
        <span className="flex size-6 items-center justify-center rounded-full bg-surface-100 text-[10px] font-semibold tabular-nums text-ink-secondary ring-2 ring-background dark:bg-surface-800 dark:text-ink-inverse-secondary">
          +{more}
        </span>
      )}
    </span>
  )
}

function Avatar({ member, className }: { member: ProjectMember; className?: string }) {
  return (
    <span aria-hidden title={member.name}
      className={cn('flex shrink-0 items-center justify-center rounded-full bg-surface-200 font-semibold text-ink-secondary dark:bg-surface-700 dark:text-ink-inverse-secondary', className)}>
      {initials(member.name)}
    </span>
  )
}
