import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { FileText } from 'lucide-react'
import { pageHref } from '@/lib/editor-blocks'
import { UNTITLED } from '@/lib/project-documents'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projectsStore'
import { openInternalUrl, useProjectPages } from './workspace'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageLink: {
      /** An inline link to a project page at the cursor. */
      insertPageLink: (page: { documentId: string; projectId: string | null; title: string }) => ReturnType
    }
  }
}

/**
 * NOT NATIVE (Notion's "Link to page"): an inline chip for a project page, saved as
 * `<a data-type="page-link" data-document-id data-project-id href="ron://project/<p>/docs/<d>">title</a>`.
 * The chip shows the page's current title and opens it in this tab (Link marks only allow http(s), and
 * `ron://` must be navigated by the app, not `window.open`). Markdown: `[title](ron://project/<p>/docs/<d>)`.
 */
export const PageLink = Node.create({
  name: 'pageLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      documentId: { default: '', parseHTML: (element) => element.getAttribute('data-document-id') ?? '', renderHTML: (attributes) => ({ 'data-document-id': attributes.documentId }) },
      projectId: { default: '', parseHTML: (element) => element.getAttribute('data-project-id') ?? '', renderHTML: (attributes) => ({ 'data-project-id': attributes.projectId }) },
      title: { default: '', parseHTML: (element) => element.textContent ?? '', renderHTML: () => ({}) },
    }
  },

  parseHTML() {
    // Above the Link mark's `a[href]`, so the page link stays a page link.
    return [{ tag: 'a[data-type="page-link"]', priority: 100 }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { 'data-type': 'page-link', href: pageHref(node.attrs.projectId, node.attrs.documentId) }), node.attrs.title || UNTITLED]
  },

  renderMarkdown: (node) => `[${node.attrs?.title || UNTITLED}](${pageHref(String(node.attrs?.projectId ?? ''), String(node.attrs?.documentId ?? ''))})`,

  addCommands() {
    return {
      insertPageLink: (page) => ({ chain }) => !!page.documentId && chain()
        .insertContent([{ type: this.name, attrs: { documentId: page.documentId, projectId: page.projectId ?? '', title: page.title || UNTITLED } }, { type: 'text', text: ' ' }])
        .run(),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageLinkView, { as: 'span' })
  },
})

function PageLinkView({ node, selected }: NodeViewProps) {
  const { userId } = useProjectsStore()
  const pages = useProjectPages(userId)
  const page = pages.data.find((item) => item.id === node.attrs.documentId)
  const missing = pages.status === 'ready' && !page
  const title = page ? page.title || UNTITLED : String(node.attrs.title || UNTITLED)
  return <NodeViewWrapper as="span" data-type="page-link">
    <button type="button" contentEditable={false} disabled={missing}
      onClick={() => openInternalUrl(pageHref(node.attrs.projectId, node.attrs.documentId))}
      title={missing ? 'This page was deleted or you no longer have access to it' : `Open ${title}`}
      className={cn('ron-page-link mx-px inline-flex items-baseline gap-1 rounded px-0.5 align-baseline font-medium text-ink underline decoration-surface-300 underline-offset-[3px] hover:bg-surface-100 hover:decoration-ink-muted disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60 dark:text-ink-inverse dark:decoration-surface-600 dark:hover:bg-surface-800',
        selected && 'ring-2 ring-accent/40')}>
      <FileText className="size-[0.9em] self-center text-ink-muted" aria-hidden="true" />
      <span>{title}</span>
    </button>
  </NodeViewWrapper>
}
