import { useRef, useState } from 'react'
import { useProjectsStore } from '@/stores/projectsStore'
import { ISSUE_LINK_INVERSE, type Issue, type IssueLinkType } from '@/types/projects'
import { projectInputClass } from './ProjectFieldInput'
import { Button } from '@/components/ui/button'

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
    <h3 className="font-semibold">Relationships</h3>
    {error && <p role="alert" className="text-rose-500">{error}</p>}
    {issueLinks.filter((l) => l.sourceId === issue.id || l.targetId === issue.id).map((link) => {
      const outgoing = link.sourceId === issue.id
      const related = issues.find((i) => i.id === (outgoing ? link.targetId : link.sourceId))
      return <div key={link.id} className="flex items-center gap-3 rounded-xl border border-surface-200 dark:border-surface-800 p-3">
        <span className="text-xs">{outgoing ? link.type : ISSUE_LINK_INVERSE[link.type]}</span>
        <Button type="button" variant="link" className="h-auto min-w-0 flex-1 whitespace-normal text-left text-sm text-indigo-500" disabled={!related || pendingSaves > 0} onClick={() => related && onNavigate(related.id)}>{related ? label(related) : 'Target not available'}</Button>
        <Button type="button" variant="ghost" size="sm" disabled={pendingSaves > 0} className="text-rose-500" onClick={() => void operate(() => removeIssueLink(link.id))}>Remove</Button>
      </div>
    })}
    <fieldset disabled={pendingSaves > 0} className="space-y-2">
      <input aria-label="Search relationship targets" className={projectInputClass} placeholder="Search by project, issue number or title" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select aria-label="Relationship type" className={projectInputClass} value={type} onChange={(e) => setType(e.target.value as IssueLinkType)}>{Object.keys(ISSUE_LINK_INVERSE).map((key) => <option key={key}>{key}</option>)}</select>
        <select aria-label="Relationship target" className={projectInputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Choose issue</option>
          {target && !targets.some((i) => i.id === target) && <option value={target}>{issues.find((i) => i.id === target)?.title ?? target}</option>}
          {targets.map((i) => <option key={i.id} value={i.id}>{label(i)}</option>)}
        </select>
      </div>
      <Button type="button" variant="outline" disabled={!target || pendingSaves > 0} onClick={() => void operate(() => addIssueLink(issue.id, target, type), true)}>Add relationship</Button>
    </fieldset>
  </section>
}