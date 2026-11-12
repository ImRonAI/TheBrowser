import { useMemo } from 'react'
import { ChevronDown, ChevronRight, FilePlus, FileText, Plus } from 'lucide-react'
import { UNTITLED, documentSubtree, documentTree, type ProjectDocumentSummary } from '@/lib/project-documents'
import { cn } from '@/lib/utils'

/** The page open in the editor, as a tree shows it: its live title, and no id while it is a never-saved draft. */
export interface TreePage { id: string | null; projectId: string | null; parentId: string | null; title: string }

/**
 * One page tree (a project's pages, or My documents) in creation order: collapse, open, and add a page under one.
 * The open page shows the title being typed; a draft that belongs here (`showDraft`) shows as a Draft row under its
 * parent. With `matches` (library search) it shows the matches and their ancestors fully expanded, ancestors dimmed.
 */
export function PageTree({ documents, page, showDraft, collapsed, onToggle, onOpen, onAddChild, matches }: {
  documents: ProjectDocumentSummary[]
  page: TreePage | null
  showDraft: boolean
  collapsed: ReadonlySet<string>
  onToggle: (id: string) => void
  onOpen: (id: string) => void
  onAddChild: (parent: ProjectDocumentSummary) => void
  matches?: ReadonlySet<string>
}) {
  const tree = useMemo(() => documentTree(documents), [documents])
  const hidden = useMemo(() => {
    const result = new Set<string>()
    if (matches) return result
    for (const id of collapsed) for (const child of documentSubtree(documents, id).slice(1)) result.add(child)
    return result
  }, [collapsed, documents, matches])
  const draft = showDraft && page && !page.id ? page : null
  const draftDepth = draft?.parentId ? (tree.find((row) => row.document.id === draft.parentId)?.depth ?? -1) + 1 : 0

  return (
    <ul className="space-y-0.5">
      {tree.filter((row) => !hidden.has(row.document.id)).map(({ document: doc, depth, childCount }) => {
        const active = page?.id === doc.id
        const title = (active ? page?.title : doc.title) || UNTITLED
        const isCollapsed = !matches && collapsed.has(doc.id)
        const canToggle = childCount > 0 && !matches
        return (
          <li key={doc.id}>
            <div className={cn('group flex items-center gap-1 rounded-xl pr-1 transition-colors',
              active ? 'bg-accent/10 text-accent dark:bg-accent-light/10 dark:text-accent-light' : 'text-ink-secondary hover:bg-surface-100 dark:text-ink-inverse-secondary dark:hover:bg-surface-800',
              matches && !matches.has(doc.id) && !active && 'opacity-60')}
              style={{ paddingLeft: 4 + depth * 16 }}>
              <button type="button" aria-label={isCollapsed ? `Expand ${title}` : `Collapse ${title}`} aria-expanded={canToggle ? !isCollapsed : undefined}
                disabled={!canToggle}
                className={cn('flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface-200/60 dark:hover:bg-surface-700/60', !canToggle && 'invisible')}
                onClick={() => onToggle(doc.id)}>
                {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </button>
              <button type="button" aria-current={active ? 'page' : undefined} onClick={() => onOpen(doc.id)}
                className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-body-sm">
                <FileText className="size-4 shrink-0 opacity-70" />
                <span className="truncate">{title}</span>
              </button>
              <button type="button" title="Add a page under this one" aria-label={`Add a page under ${title}`} onClick={() => onAddChild(doc)}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted opacity-0 hover:bg-surface-200/60 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-surface-700/60">
                <Plus className="size-3.5" />
              </button>
            </div>
          </li>
        )
      })}
      {draft && (
        <li>
          <div className="flex items-center gap-2 rounded-xl bg-accent/10 px-3 py-1.5 text-body-sm text-accent dark:bg-accent-light/10 dark:text-accent-light"
            style={{ marginLeft: draftDepth * 16 }}>
            <FilePlus className="size-4 shrink-0" />
            <span className="truncate">{draft.title || UNTITLED}</span>
            <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider opacity-70">Draft</span>
          </div>
        </li>
      )}
    </ul>
  )
}
