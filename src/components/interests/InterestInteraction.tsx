import { useEffect, useState } from 'react'
import { ArrowUpRight, BookOpen, MessageSquare, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { OpenIn, OpenInContent, OpenInItem, OpenInLabel, OpenInTrigger } from '@/components/ai-elements/open-in-chat'
import { useAgentUi } from '@/context/AgentUiContext'
import { useAuthStore } from '@/stores/authStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { useSearchStore } from '@/stores/searchStore'
import { articleDraftKey, useArticleDraftStore } from '@/stores/articleDraftStore'
import { AGENT_LABELS, previewArticle, type AgentDestination, type ArticleAttachment, type Story } from '@/lib/articles'

export function InterestsPreviewModal({ isOpen, onClose, story }: { isOpen: boolean; onClose: () => void; story: Story | null }) {
  if (!story || !isOpen) return null
  return <ArticleReader key={story.url} story={story} onClose={onClose} />
}

function ArticleReader({ story, onClose }: { story: Story; onClose: () => void }) {
  const [article, setArticle] = useState(() => previewArticle(story))
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setNotice('')
    void fetch('http://localhost:8765/articles/extract', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: story.url }), signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error('Full text unavailable. You can attach the preview or open the original source.')
      const result = await response.json()
      if (!controller.signal.aborted) {
        setArticle((current) => ({ ...current, text: result.text, status: result.status }))
        setNotice(result.notice)
      }
    }).catch((error) => {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : 'Full text unavailable.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [story.url, attempt])

  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent showCloseButton={false} overlayClassName="z-[200] bg-black/50 backdrop-blur-sm"
      className="z-[201] flex h-[min(860px,calc(100dvh-32px))] max-h-[calc(100dvh-32px)] w-[calc(100vw-24px)] max-w-4xl flex-col gap-0 overflow-hidden rounded-2xl border-surface-200 bg-surface-0 p-0 text-ink dark:border-surface-700 dark:bg-surface-900 dark:text-ink-inverse">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-surface-200 px-4 py-3 dark:border-surface-700 sm:px-6">
        <BookOpen size={18} className="text-indigo-500" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-widest">The reading room</span>
        <InterestsActionMenu article={article} onAttached={onClose} disabled={loading} />
        <button type="button" onClick={onClose} aria-label="Close article reader" className="rounded-lg p-2 hover:bg-surface-100 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-surface-800"><X size={18} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-8 sm:px-14 sm:py-12">
        <article className="mx-auto max-w-2xl">
          <div className="mb-5 flex flex-wrap gap-3 text-xs font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-300"><span>{story.topic}</span><span className="text-ink-muted">{story.age}</span></div>
          <DialogTitle className="font-display text-3xl font-normal leading-tight tracking-tight sm:text-5xl">{story.title}</DialogTitle>
          <DialogDescription className="mt-5 flex flex-wrap items-center gap-3 text-sm text-ink-muted dark:text-ink-inverse-muted">
            {story.hostname}<span>·</span>{article.status === 'preview' ? 'Preview only' : `${Math.max(1, Math.ceil(article.text.split(/\s+/).length / 220))} min read`}
          </DialogDescription>
          <div role="status" className="my-7 rounded-lg border border-surface-200 p-3 text-xs leading-relaxed text-ink-muted dark:border-surface-700 dark:text-ink-inverse-muted">
            {loading ? 'Retrieving readable article text…' : notice}
            {!loading && article.status === 'preview' && <button className="ml-2 underline" onClick={() => setAttempt((value) => value + 1)}>Retry</button>}
          </div>
          <div className="space-y-5 text-base leading-[1.9] sm:text-lg">{article.text.split(/\n\n+/).map((paragraph, index) => <p key={index} className="break-words">{paragraph}</p>)}</div>
        </article>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-surface-200 px-6 py-4 text-xs dark:border-surface-700">
        <span className="text-ink-muted dark:text-ink-inverse-muted">Attach a reference. Add your message. Then send.</span>
        <a href={story.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-indigo-600 dark:text-indigo-300">Original source <ArrowUpRight size={14} /></a>
      </footer>
    </DialogContent>
  </Dialog>
}

export function InterestsActionMenu({ article, onAttached, disabled }: { article: ArticleAttachment; onAttached: () => void; disabled?: boolean }) {
  const { openPanel, closePanel } = useAgentUi()
  const [error, setError] = useState('')
  const user = useAuthStore((state) => state.user?.id || 'default')
  const attach = (destination: AgentDestination) => {
    const store = useArticleDraftStore.getState()
    if (!store.attach(articleDraftKey(user, destination), article)) {
      setError(`${AGENT_LABELS[destination]} already has 3 articles. Remove one from its composer before attaching another.`)
      return
    }
    onAttached()
    if (destination === 'panel') {
      openPanel()
    } else {
      closePanel()
      if (destination === 'build') {
        useSearchStore.getState().clearSearch()
        useNavigationStore.getState().setActiveTab('build')
        window.electron?.browser?.navigate('ron://build')
      } else {
        useNavigationStore.getState().setDrawerExpanded(true)
      }
    }
  }
  return <><OpenIn query="">
    <OpenInTrigger><button type="button" disabled={disabled} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"><MessageSquare size={14} />Attach to agent</button></OpenInTrigger>
    <OpenInContent className="z-[220]">
      <OpenInLabel>Choose a composer · no auto-send</OpenInLabel>
      {(Object.keys(AGENT_LABELS) as AgentDestination[]).map((destination) => <OpenInItem key={destination} onSelect={() => attach(destination)}>{AGENT_LABELS[destination]}</OpenInItem>)}
    </OpenInContent>
  </OpenIn>{error && <p role="alert" className="basis-full text-xs text-red-600 dark:text-red-400">{error}</p>}</>
}