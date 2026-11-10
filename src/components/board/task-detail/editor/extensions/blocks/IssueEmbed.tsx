import { useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { SquareKanban, Trash2 } from 'lucide-react'
import { issueKey } from '@/lib/execute-issues'
import { issueMarkdown, projectHref } from '@/lib/editor-blocks'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projectsStore'
import { useIssueBlocking } from '@/hooks/useIssueBlocking'
import { ISSUE_STATUS_CONFIG, ISSUE_TYPE_CONFIG, type IssueStatus } from '@/types/projects'
import { AssigneeStack, DueLabel, STATUS_FILL } from '@/components/execute/IssueBits'
import { BlockedTag } from '@/components/projects/BlockedTag'
// A circular import (the issue workspace has a NotionEditor, which registers this block); safe because
// IssueDrawer is only used when a card is rendered, never while modules evaluate.
import { IssueDrawer } from '@/components/projects/IssueDrawer'
import { placeBlock } from './commands'
import { BlockFrame, IconButton } from './ui'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    issueEmbed: {
      /** A live card for an issue (key, title, status, due date) that opens the issue. */
      insertIssue: (issue: { issueId: string; projectId: string; key: string; title: string; status: string }) => ReturnType
    }
  }
}

const statusOf = (value: unknown): IssueStatus | null => (typeof value === 'string' && value in ISSUE_STATUS_CONFIG ? value as IssueStatus : null)

/**
 * NOT NATIVE: an embedded issue. Only the issue id is authoritative; `key`/`title`/`status` are the values
 * when it was embedded, kept for readers without the app (HTML, Markdown for Ron). The card always shows
 * the issue as it is now from the Projects store and opens the issue workspace on click.
 * Saved as `<div data-type="issue" data-issue-id data-project-id data-key data-title data-status>`.
 */
export const IssueEmbed = Node.create({
  name: 'issueEmbed',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    const text = (name: string) => ({
      default: '',
      parseHTML: (element: HTMLElement) => element.getAttribute(`data-${name}`) ?? '',
      renderHTML: (attributes: Record<string, unknown>) => ({ [`data-${name}`]: String(attributes[name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] ?? '') }),
    })
    return { issueId: text('issue-id'), projectId: text('project-id'), key: text('key'), title: text('title'), status: text('status') }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="issue"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = `${node.attrs.key}: ${node.attrs.title}`
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'issue' }),
      node.attrs.projectId ? ['a', { href: projectHref(node.attrs.projectId) }, label] : ['span', {}, label]]
  },

  renderMarkdown: (node) => issueMarkdown({
    key: String(node.attrs?.key ?? ''), title: String(node.attrs?.title ?? ''), projectId: String(node.attrs?.projectId ?? '') || undefined,
    status: ISSUE_STATUS_CONFIG[statusOf(node.attrs?.status) ?? 'backlog']?.label,
  }),

  addCommands() {
    return {
      insertIssue: (issue) => placeBlock((schema) => issue.issueId ? schema.nodes.issueEmbed.create(issue) : null),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(IssueView)
  },
})

function IssueView({ node, editor, selected, deleteNode }: NodeViewProps) {
  const { issues, projects, people, isInitialized } = useProjectsStore()
  const blockingOf = useIssueBlocking()
  const [open, setOpen] = useState(false)
  const issue = issues.find((item) => item.id === node.attrs.issueId)
  const project = projects.find((item) => item.id === (issue?.projectId ?? node.attrs.projectId))
  const key = issue ? issueKey(issue, projects) : String(node.attrs.key || 'Issue')
  const title = issue?.title ?? String(node.attrs.title || 'Untitled issue')
  const status = issue?.status ?? statusOf(node.attrs.status)
  const blocking = issue ? blockingOf(issue) : null
  const missing = isInitialized && !issue
  const now = Date.now()

  return <BlockFrame selected={selected} className="group/issue" data-issue-state={missing ? 'missing' : issue ? 'live' : 'loading'}>
    <div className="flex items-stretch">
      <button type="button" disabled={!issue} onClick={() => setOpen(true)}
        title={missing ? 'This issue was deleted or you no longer have access to it' : `Open ${key}`}
        className="flex min-w-0 flex-1 items-start gap-3 px-3.5 py-3 text-left transition-colors duration-150 enabled:hover:bg-surface-50 disabled:cursor-default dark:enabled:hover:bg-surface-850">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-100 text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary">
          <SquareKanban className="size-4" />
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-mono text-[11px] font-medium tabular-nums tracking-[0.02em] text-ink-secondary dark:text-ink-inverse-secondary">{key}</span>
            <span className={cn('truncate text-[14px] font-semibold text-ink dark:text-ink-inverse', status === 'done' && 'line-through decoration-ink-muted/60')}>{title}</span>
          </span>
          {missing
            ? <span className="block text-[12px] text-muted-foreground">This issue was deleted or you no longer have access to it.</span>
            : <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                {status && <span className="inline-flex items-center gap-1.5 text-ink-secondary dark:text-ink-inverse-secondary">
                  <span className={cn('size-2 rounded-full', STATUS_FILL[status])} aria-hidden="true" />{ISSUE_STATUS_CONFIG[status].label}</span>}
                {issue && <DueLabel issue={issue} now={now} />}
                {issue && <span className="text-muted-foreground">{ISSUE_TYPE_CONFIG[issue.type]?.label ?? issue.type}</span>}
                {project && <span className="truncate text-muted-foreground">{project.name}</span>}
                {blocking?.blocked && <BlockedTag label={blocking.label} keys={blocking.keys} />}
                {issue && <AssigneeStack ids={issue.assignees} people={people} />}
              </span>}
        </span>
      </button>
      {editor.isEditable && <div className="flex items-start px-1.5 py-2.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/issue:opacity-100 group-data-[selected=true]/block:opacity-100">
        <IconButton label="Remove issue embed" className="enabled:hover:text-red-600 dark:enabled:hover:text-red-400" onClick={() => deleteNode()}><Trash2 className="size-4" /></IconButton>
      </div>}
    </div>
    {open && issue && <IssueDrawer issueId={issue.id} onClose={() => setOpen(false)} />}
  </BlockFrame>
}
