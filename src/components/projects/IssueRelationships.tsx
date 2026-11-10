import { useRef, useState } from 'react'
import { useProjectsStore } from '@/stores/projectsStore'
import { ISSUE_LINK_INVERSE, type Issue, type IssueLinkType } from '@/types/projects'
import { projectInputClass } from './ProjectFieldInput'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** The project's field recipe with Ren's ink text, placeholder and compact size. */
const FIELD = cn(projectInputClass, 'h-9 py-0 text-[13px] text-ink placeholder:text-ink-muted dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted')

export function IssueRelationships({ issue, onNavigate }: { issue: Issue; onNavigate: (id: string) => void }) {
  const { issues, projects, issueLinks, addIssueLink, removeIssueLink, pendingSaves } = useProjectsStore()
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState('')
  const [type, setType] = useState<IssueLinkType>('relates')
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const label = (item: Issue) => `${projects.find((p) => p.id === item.projectId)?.key ?? ''}-${item.number} · ${item.title}`
  const targets = issues.filter((i) => i.id !== issue.id && label(i).toLowerCase().includes(query.toLowerCase()))
  const operate = async (action: () => Promise<{ error?: string }>, added = false) => {
    if (busy.current || pendingSaves) return
    busy.current = true
    try {
      const result = await action()
      setError(result.error ?? null)
      if (!result.error && added) { setTarget(''); setQuery('') }
    } finally { busy.current = false }
  }
  return <section className="space-y-3">
    <h3 className="font-display text-lg font-bold leading-tight tracking-tight text-ink dark:text-ink-inverse">Relationships</h3>
    {error && <p role="alert" className="text-[13px] text-red-700 dark:text-red-400">{error}</p>}
    {issueLinks.filter((l) => l.sourceId === issue.id || l.targetId === issue.id).map((link) => {
      const outgoing = link.sourceId === issue.id
      const related = issues.find((i) => i.id === (outgoing ? link.targetId : link.sourceId))
      return <div key={link.id} className="flex items-center gap-3 rounded-xl border border-surface-200 py-2 pl-3 pr-2 dark:border-surface-800">
        <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-surface-100 px-1.5 font-mono text-[11px] font-medium text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary">{outgoing ? link.type : ISSUE_LINK_INVERSE[link.type]}</span>
        <Button type="button" variant="link" className="h-auto min-w-0 flex-1 justify-start whitespace-normal px-0 py-0.5 text-left text-[13px] font-medium text-blurple-600 underline-offset-2 hover:text-blurple-700 dark:text-blurple-400 dark:hover:text-blurple-300" disabled={!related || pendingSaves > 0} onClick={() => related && onNavigate(related.id)}>{related ? label(related) : 'Target not available'}</Button>
        <Button type="button" variant="ghost" size="sm" disabled={pendingSaves > 0} className="h-7 shrink-0 rounded-lg px-2.5 text-[12px] font-medium text-ink-muted transition-colors duration-150 hover:bg-red-50 hover:text-red-700 dark:text-ink-inverse-muted dark:hover:bg-red-950/40 dark:hover:text-red-400" onClick={() => void operate(() => removeIssueLink(link.id))}>Remove</Button>
      </div>
    })}
    <fieldset disabled={pendingSaves > 0} className="space-y-2">
      <input aria-label="Search relationship targets" className={FIELD} placeholder="Search by project, issue number or title" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <select aria-label="Relationship type" className={cn(FIELD, 'font-mono text-[12.5px]')} value={type} onChange={(e) => setType(e.target.value as IssueLinkType)}>{Object.keys(ISSUE_LINK_INVERSE).map((key) => <option key={key}>{key}</option>)}</select>
        <select aria-label="Relationship target" className={FIELD} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Choose issue</option>
          {target && !targets.some((i) => i.id === target) && <option value={target}>{issues.find((i) => i.id === target)?.title ?? target}</option>}
          {targets.map((i) => <option key={i.id} value={i.id}>{label(i)}</option>)}
        </select>
      </div>
      <Button type="button" variant="outline" disabled={!target || pendingSaves > 0}
        className="h-8 gap-1.5 rounded-lg border-surface-200 bg-surface-0 px-3 text-[13px] font-semibold text-ink shadow-none transition-colors duration-150 ease-out hover:bg-surface-50 hover:text-ink disabled:opacity-40 dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:hover:bg-surface-850 dark:hover:text-ink-inverse"
        onClick={() => void operate(() => addIssueLink(issue.id, target, type), true)}>Add relationship</Button>
    </fieldset>
  </section>
}