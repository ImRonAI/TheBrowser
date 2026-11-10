import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { RenIcon } from '@/components/brand'
import { mergeAttributes, type Editor } from '@tiptap/core'
import Mention from '@tiptap/extension-mention'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import tippy, { type Instance } from 'tippy.js'
import { Bot, FileText, Server, Wrench, type LucideIcon } from 'lucide-react'
import { API_BASE_URL } from '@/lib/api-base'
import { createContextClient } from '@/lib/context-api'
import { projectEndpoint } from '@/lib/project-endpoint'
import { listAllDocuments } from '@/lib/project-documents'
import { isGuestUserId } from '@/lib/sign-in'
import {
  REFERENCE_KINDS, fetchReferenceCatalog, filterReferences, isReferenceKind, parseReferenceMarkdown, referenceItems,
  referenceKindTitle, referenceMarkdown, referenceStart, type ReferenceItem, type ReferenceKind,
} from '@/lib/document-references'
import { getProjectsState, projectsRequestFor } from '@/stores/projectsStore'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'

/**
 * `@` references in page editors: pages, tools, agents, MCP servers and skills (`src/lib/document-references.ts`).
 * Built on Tiptap's Mention node (`@tiptap/extension-mention` + `@tiptap/suggestion`): the same atom node,
 * suggestion plugin and Backspace behaviour, with a `kind` attribute so the chip saves as
 * `<span data-type="reference" data-kind data-id data-label>` and reads as `@[label](ron://kind/id)` in Markdown.
 */

const ICONS: Record<ReferenceKind, LucideIcon> = { document: FileText, tool: Wrench, agent: Bot, mcp: Server, skill: RenIcon }
const CACHE_MS = 60_000

interface LoadedReferences { items: ReferenceItem[]; notes: string[] }
let cache: { key: string; at: number; promise: Promise<LoadedReferences> } | null = null

/** Whose skills and specialists the menu shows: the panel's user (guests teach as `default`, like Teach Ron). */
const agentUser = () => useAuthStore.getState().user?.id || 'default'

async function loadReferences(): Promise<LoadedReferences> {
  const { userId, projects } = getProjectsState()
  const user = agentUser()
  const signedIn = !isGuestUserId(user)
  const notes: string[] = []
  const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))
  const [documents, catalog, specialists] = await Promise.allSettled([
    userId ? listAllDocuments(projectsRequestFor(userId)) : Promise.resolve([]),
    // The same backend the Projects API (and so skill publishing) uses.
    fetchReferenceCatalog(userId ? projectEndpoint(userId, API_BASE_URL) : API_BASE_URL, user),
    signedIn ? createContextClient(API_BASE_URL, user).agents() : Promise.resolve({ agents: [], signInRequired: true }),
  ])
  if (documents.status === 'rejected') notes.push(`Pages could not be loaded: ${reason(documents.reason)}`)
  if (catalog.status === 'rejected') notes.push(`Tools, MCP servers and skills could not be loaded: ${reason(catalog.reason)}`)
  if (specialists.status === 'rejected') notes.push(`Specialist agents could not be loaded: ${reason(specialists.reason)}`)
  else if (specialists.value.signInRequired) notes.push('Sign in to reference your specialist agents.')
  return {
    notes,
    items: referenceItems({
      documents: documents.status === 'fulfilled' ? documents.value : [],
      catalog: catalog.status === 'fulfilled' ? catalog.value : null,
      specialists: specialists.status === 'fulfilled' ? specialists.value.agents : [],
      projects,
    }),
  }
}

/** The menu's choices, cached briefly per user so typing `@` again does not refetch. */
function references(): Promise<LoadedReferences> {
  const key = `${getProjectsState().userId ?? ''}|${agentUser()}`
  if (!cache || cache.key !== key || Date.now() - cache.at > CACHE_MS) {
    const promise = loadReferences()
    cache = { key, at: Date.now(), promise }
    // A failed load is not cached.
    promise.catch(() => { if (cache?.promise === promise) cache = null })
  }
  return cache.promise
}

/** Drop cached choices (e.g. after publishing a skill, so it can be referenced at once). */
export function invalidateReferences() { cache = null }

let lastNotes: string[] = []

interface ReferenceAttrs { id: string; label: string; kind: ReferenceKind }
type MenuProps = SuggestionProps<ReferenceItem, ReferenceAttrs>
interface MenuHandle { onKeyDown: (props: SuggestionKeyDownProps) => boolean }

const ReferenceMenu = forwardRef<MenuHandle, MenuProps>(function ReferenceMenu({ items, query, command }, ref) {
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => REFERENCE_KINDS
    .map(({ kind, title }) => ({ kind, title, items: items.filter((item) => item.kind === kind) }))
    .filter((group) => group.items.length > 0), [items])
  const ordered = useMemo(() => groups.flatMap((group) => group.items), [groups])

  useEffect(() => setSelected(0), [items])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const choose = (item: ReferenceItem | undefined) => {
    if (item) command({ id: item.id, label: item.label, kind: item.kind })
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!ordered.length) return false
      if (event.key === 'ArrowDown') { setSelected((index) => (index + 1) % ordered.length); return true }
      if (event.key === 'ArrowUp') { setSelected((index) => (index + ordered.length - 1) % ordered.length); return true }
      if (event.key === 'Enter' || event.key === 'Tab') { choose(ordered[selected]); return true }
      return false
    },
  }), [ordered, selected])

  let index = -1
  return (
    <div className="z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-surface-200/60 bg-surface-0 p-1 text-ink shadow-dramatic dark:border-surface-700/60 dark:bg-surface-900 dark:text-ink-inverse dark:shadow-dark-bold">
      <div className="flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
        <span>Reference</span>
        <span className="normal-case tracking-normal">{query ? `“${query}”` : 'Type to search'}</span>
      </div>
      <div ref={listRef} role="listbox" aria-label="References" className="max-h-[340px] overflow-y-auto scrollbar-thin">
        {groups.map((group) => (
          <div key={group.kind} role="group" aria-label={group.title}>
            <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-muted/80 dark:text-ink-inverse-muted/80">{group.title}</div>
            {group.items.map((item) => {
              index += 1
              const position = index
              const active = position === selected
              const Icon = ICONS[item.kind]
              return (
                <button key={`${item.kind}:${item.id}`} type="button" role="option" aria-selected={active} data-index={position}
                  onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setSelected(position)} onClick={() => choose(item)}
                  className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                    active ? 'bg-accent/10 text-accent dark:bg-accent-light/10 dark:text-accent-light' : 'hover:bg-surface-100 dark:hover:bg-surface-800')}>
                  <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-md',
                    active ? 'bg-accent text-white dark:bg-accent-light dark:text-surface-900' : 'bg-surface-100 text-ink-muted dark:bg-surface-800 dark:text-ink-inverse-muted')}>
                    <Icon size={14} strokeWidth={2} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-body-sm font-medium">{item.label}</span>
                      {item.group && <span className="shrink-0 truncate text-[10px] text-ink-muted dark:text-ink-inverse-muted">{item.group}</span>}
                    </span>
                    {item.description && <span className="block truncate text-[11px] text-ink-muted dark:text-ink-inverse-muted">{item.description}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
        {!ordered.length && <p className="px-2 py-3 text-body-xs text-ink-muted dark:text-ink-inverse-muted">No pages, tools, agents, MCP servers or skills match.</p>}
      </div>
      {lastNotes.length > 0 && (
        <div role="status" className="mt-1 space-y-0.5 border-t border-surface-200/60 px-2 pb-1 pt-1.5 text-[11px] text-ink-muted dark:border-surface-700/60 dark:text-ink-inverse-muted">
          {lastNotes.map((note) => <p key={note} className="text-[11px] leading-snug text-ink-muted dark:text-ink-inverse-muted">{note}</p>)}
        </div>
      )}
    </div>
  )
})

export const ReferenceMention = Mention.extend({
  name: 'reference',

  addAttributes() {
    return {
      ...this.parent?.(),
      kind: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-kind'),
        renderHTML: (attributes: { kind?: string | null }) => (attributes.kind ? { 'data-kind': attributes.kind } : {}),
      },
    }
  },

  // Warm the menu's choices when an editor is focused, so `@` opens with them.
  onFocus() {
    if (this.editor.isEditable) void references().catch(() => undefined)
  },

  // @tiptap/markdown: `@[label](ron://kind/id)` (Mention's own shortcode spec is bound to the `mention` node name).
  markdownTokenizer: {
    name: 'reference',
    level: 'inline',
    start: (src: string) => referenceStart(src),
    tokenize(src: string) {
      const match = parseReferenceMarkdown(src)
      if (!match) return undefined
      return { type: 'reference', raw: match.raw, attributes: { kind: match.kind, id: match.id, label: match.label } }
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode('reference', { ...token.attributes, mentionSuggestionChar: '@' }),
  renderMarkdown: (node) => {
    const kind = node.attrs?.kind
    return isReferenceKind(kind) && node.attrs?.id
      ? referenceMarkdown({ kind, id: String(node.attrs.id), label: node.attrs.label })
      : `@${node.attrs?.label ?? node.attrs?.id ?? ''}`
  },
}).configure({
  HTMLAttributes: {
    class: 'reference-chip rounded-md bg-accent/10 px-1 py-0.5 font-medium text-accent no-underline dark:bg-accent-light/15 dark:text-accent-light',
  },
  renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
  renderHTML: ({ options, node }) => [
    'span',
    mergeAttributes(options.HTMLAttributes, isReferenceKind(node.attrs.kind) ? { title: `${referenceKindTitle(node.attrs.kind)}: ${node.attrs.id}` } : {}),
    `@${node.attrs.label ?? node.attrs.id}`,
  ],
  suggestion: {
    char: '@',
    items: async ({ query }: { query: string; editor: Editor }) => {
      try {
        const loaded = await references()
        lastNotes = loaded.notes
        return filterReferences(loaded.items, query).flatMap((group) => group.items)
      } catch (error) {
        lastNotes = [`References could not be loaded: ${error instanceof Error ? error.message : String(error)}`]
        return []
      }
    },
    render: () => {
      let component: ReactRenderer<MenuHandle, MenuProps> | null = null
      let popup: Instance | null = null
      return {
        onStart: (props: MenuProps) => {
          component = new ReactRenderer(ReferenceMenu, { props, editor: props.editor })
          if (!props.clientRect) return
          popup = tippy(document.body, {
            getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: 'manual',
            placement: 'bottom-start',
            zIndex: 300,
          })
        },
        onUpdate: (props: MenuProps) => {
          component?.updateProps(props)
          if (props.clientRect) popup?.setProps({ getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect() })
        },
        onKeyDown: (props: SuggestionKeyDownProps) => {
          if (props.event.key === 'Escape') { popup?.hide(); return true }
          return component?.ref?.onKeyDown(props) ?? false
        },
        onExit: () => {
          popup?.destroy()
          component?.destroy()
          popup = null
          component = null
        },
      }
    },
  },
})
