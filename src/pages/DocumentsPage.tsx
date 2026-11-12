import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { PageBackground } from '@/components/shared/PageBackground'
import { DocumentWorkspace, type DocumentScope } from '@/components/projects/documents/ProjectDocuments'
import { IssueDrawer } from '@/components/projects/IssueDrawer'
import { openInternalUrl } from '@/components/board/task-detail/editor/extensions/blocks/workspace'
import { useElementWidth } from '@/hooks/useElementWidth'
import { documentsLibraryUrl, parseDocumentsLibraryUrl } from '@/lib/project-documents'
import { isGuestUserId, openSignIn } from '@/lib/sign-in'
import { useProjectsStore } from '@/stores/projectsStore'
import { useTabStore } from '@/stores/tabStore'

const LIBRARY: DocumentScope = { kind: 'library' }
/** Below this content width the page list sits above the page instead of beside it. */
const STACK_BELOW = 760

/**
 * Documents (`ron://documents[/<page>]`): every page the user can open, My documents (personal pages only they see)
 * and each project's pages, with the same page editor as a project's Docs. The tab's URL follows the open page, so
 * the link to a page reopens it here.
 */
export function DocumentsPage({ documentId }: { documentId: string | null }) {
  const { userId, error, initialize } = useProjectsStore()
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(contentRef)
  /** The saved page the workspace shows last (null: a draft, or no page). */
  const shownRef = useRef<string | null>(null)

  // The project sections, the move targets and linked issues come from the Projects store.
  useEffect(() => {
    if (userId) void initialize()
  }, [userId, initialize])

  /** The URL names the open page, while this tab still shows the library. */
  const followPage = useCallback((id: string | null) => {
    shownRef.current = id
    const tabs = useTabStore.getState()
    const url = tabs.tabs.find((tab) => tab.id === tabs.activeTabId)?.url
    if (!parseDocumentsLibraryUrl(url)) return
    const next = documentsLibraryUrl(id)
    if (url !== next) openInternalUrl(next)
  }, [])

  // ron://documents while a page is open (the sidebar's Documents) keeps that page and names it again.
  useEffect(() => {
    if (documentId === null && shownRef.current) followPage(shownRef.current)
  }, [documentId, followPage])

  const guest = Boolean(userId && isGuestUserId(userId))

  return (
    <div className="relative isolate min-h-full bg-surface-50 dark:bg-surface-900">
      <PageBackground />
      <div ref={contentRef} className="relative mx-auto w-full max-w-[1360px] px-4 pb-16 pt-8 sm:px-6 sm:pt-10 lg:px-10 lg:pt-12">
        <header className="min-w-0">
          <span className="tag-label tag-label-slash">{guest ? 'Guest workspace' : 'Library'}</span>
          <h1 className="ren-display mt-3 text-[44px] text-ink dark:text-ink-inverse sm:text-[56px]">
            Documents<span className="text-volt">.</span>
          </h1>
          <p className="mt-3 max-w-2xl text-[14px] leading-6 text-ink-secondary dark:text-ink-inverse-secondary">
            Your private pages and every project’s docs in one place. Add a page to a project when it’s ready, or have Ren build a project from it.
          </p>
        </header>

        {guest && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-100 px-4 py-2.5 text-[13px] text-ink-secondary dark:bg-surface-800 dark:text-ink-inverse-secondary">
            <span>You’re in a private guest workspace on this device. Sign in to work with your account’s documents.</span>
            <button type="button" onClick={() => openSignIn()} className="font-medium text-ink underline-offset-2 hover:underline dark:text-ink-inverse">Sign in</button>
          </div>
        )}

        <div className="mt-8">
          {userId ? (
            <DocumentWorkspace key={userId} scope={LIBRARY} openDocumentId={documentId ?? undefined} onIssueSelect={setSelectedIssueId}
              onPageChange={followPage} stacked={width > 0 && width < STACK_BELOW} />
          ) : error ? (
            <div role="alert" className="rounded-2xl bg-danger/10 px-4 py-3 text-[13px] text-danger">{error}</div>
          ) : (
            <p role="status" className="flex items-center gap-2 text-body-sm text-ink-muted dark:text-ink-inverse-muted">
              <Loader2 className="size-4 animate-spin" />Opening your workspace…
            </p>
          )}
        </div>
      </div>
      {selectedIssueId && <IssueDrawer issueId={selectedIssueId} onClose={() => setSelectedIssueId(null)} />}
    </div>
  )
}
