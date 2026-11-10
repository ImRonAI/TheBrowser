import { useEffect, useState } from 'react'
import { RenIcon } from '@/components/brand'
import { AlertTriangle, BookOpen, Check, Loader2, UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { invalidateReferences } from '@/components/board/task-detail/editor/extensions/ReferenceMention'
import { getDocumentSkill, publishDocumentSkill, skillProblems, type DocumentSkill } from '@/lib/project-documents'
import type { ProjectsRequest } from '@/lib/projects-api'
import { useAuthStore } from '@/stores/authStore'
import { useSkillLibraryStore } from '@/stores/skillLibraryStore'

/** Ron's own agent: the Agent Panel and Teach Ron's chrome studio teach and run skills under `panel`. */
const AGENT_ID = 'panel'

/**
 * "Publish as skill" for an Agent Skill page: publishes the saved page as a native Agent Skill of Ron's agent
 * (`POST /projects/documents/{id}/skill`), shows what it was published as, whether the page changed since, and
 * every problem the server names (unknown references, missing description or steps) inline.
 */
export function SkillPublishBar({ request, documentId, version, isSkill, flush }: {
  request: ProjectsRequest
  documentId: string
  /** The page's saved version (the skill knows which version it was published from). */
  version: number | undefined
  /** The page has the Agent Skill shape (Description + Steps). */
  isSkill: boolean
  /** Saves pending edits; false when the page could not be saved. */
  flush: () => Promise<boolean>
}) {
  // The panel's user: guests teach as `default`, as Teach Ron does.
  const userId = useAuthStore((state) => state.user?.id || 'default')
  const [skill, setSkill] = useState<DocumentSkill | null | undefined>(undefined)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [done, setDone] = useState<'published' | 'updated' | null>(null)

  useEffect(() => {
    let current = true
    setSkill(undefined); setLoadError(''); setProblems([]); setDone(null)
    getDocumentSkill(request, documentId, userId, AGENT_ID)
      .then((value) => { if (current) setSkill(value) })
      .catch((error) => { if (current) { setSkill(null); setLoadError(error instanceof Error ? error.message : 'The skill status could not be loaded.') } })
    return () => { current = false }
  }, [request, documentId, userId])

  if (!isSkill && !skill) return null

  const publish = async () => {
    setBusy(true); setProblems([]); setDone(null)
    try {
      if (!(await flush())) {
        setProblems(['Save the page first: it has changes that could not be saved.'])
        return
      }
      const result = await publishDocumentSkill(request, documentId, userId, AGENT_ID)
      setSkill(result.skill); setDone(result.status); setLoadError('')
      invalidateReferences()
    } catch (error) {
      setProblems(skillProblems(error instanceof Error ? error.message : 'The skill could not be published.'))
    } finally {
      setBusy(false)
    }
  }

  const stale = !!skill && version !== undefined && skill.publishedVersion !== null && skill.publishedVersion !== version
  return (
    <section aria-label="Agent skill" className="mt-5 rounded-2xl border border-accent/25 bg-accent/[0.04] px-4 py-3 dark:border-accent-light/25 dark:bg-accent-light/[0.05]">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent dark:bg-accent-light/15 dark:text-accent-light"><RenIcon className="size-4" aria-hidden /></span>
        {/* basis-48: in a narrow column (Teach Ron studio open) the buttons wrap below instead of squeezing the text. */}
        <div className="min-w-0 grow basis-48" role="status" aria-live="polite">
          {skill === undefined ? (
            <p className="flex items-center gap-2 text-body-sm text-ink-muted dark:text-ink-inverse-muted"><Loader2 className="size-3.5 animate-spin" />Checking the skill…</p>
          ) : skill ? (
            <>
              <p className="text-body-sm text-ink dark:text-ink-inverse">
                {done === 'updated' ? 'Republished as ' : 'Published as '}
                <code className="rounded bg-surface-100 px-1.5 py-0.5 font-mono text-[0.85em] dark:bg-surface-800">{skill.name}</code>
                <span className="text-ink-muted dark:text-ink-inverse-muted"> · {skill.steps} {skill.steps === 1 ? 'step' : 'steps'}</span>
              </p>
              {/* Not cn(): tailwind-merge reads text-body-xs as a colour and drops it beside text-warning. */}
              <p className={`mt-0.5 flex items-center gap-1.5 text-body-xs ${stale ? 'text-warning' : 'text-ink-muted dark:text-ink-inverse-muted'}`}>
                {stale
                  ? <><AlertTriangle className="size-3.5" />The page changed since it was published. Republish to update the skill.</>
                  : <><Check className="size-3.5 text-success" />{skill.listed ? 'In Ren’s skills: use_skill runs it' : 'Saved, but not yet listed in Ren’s skills'} · updated {new Date(skill.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>}
              </p>
            </>
          ) : (
            <>
              <p className="text-body-sm font-medium text-ink dark:text-ink-inverse">Agent skill</p>
              <p className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">Publish this page as a skill Ren can run. The title becomes its name and the Description tells Ren when to use it.</p>
            </>
          )}
        </div>
        {skill && (
          <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5 rounded-full text-ink-secondary dark:text-ink-inverse-secondary"
            onClick={() => useSkillLibraryStore.getState().show(AGENT_ID, skill.id)}>
            <BookOpen />Open in Skill library
          </Button>
        )}
        <Button type="button" size="sm" className="h-8 gap-1.5 rounded-full" disabled={busy || skill === undefined} onClick={() => void publish()}>
          {busy ? <Loader2 className="animate-spin" /> : <UploadCloud />}{skill ? 'Republish' : 'Publish as skill'}
        </Button>
      </div>
      {loadError && <p role="alert" className="mt-2 text-body-xs text-danger">The skill status could not be loaded: {loadError}</p>}
      {problems.length > 0 && (
        <div role="alert" className="mt-3 rounded-xl border border-danger/30 bg-danger/[0.06] px-3 py-2 text-body-sm text-danger">
          <p className="font-medium">{problems.length === 1 ? 'The skill was not published:' : `The skill was not published (${problems.length} problems):`}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {problems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        </div>
      )}
    </section>
  )
}
