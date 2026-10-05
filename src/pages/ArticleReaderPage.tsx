import { useEffect, useRef, useState, type UIEvent } from 'react'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { NewsArticle } from '@/components/home/NewsArticle'
import { InterestsActionMenu } from '@/components/interests/InterestInteraction'
import { API_BASE_URL } from '@/lib/api-base'
import { previewArticle, storyFromReadUrl } from '@/lib/articles'
import { useTabStore } from '@/stores/tabStore'

function goHome() {
  const tabs = useTabStore.getState()
  if (tabs.activeTabId) tabs.updateTab(tabs.activeTabId, { url: 'ron://home', title: 'Home' })
  void window.electron?.browser?.navigate('ron://home')
}

export function ArticleReaderPage({ href }: { href: string }) {
  const story = storyFromReadUrl(href)
  const [article, setArticle] = useState(() => story ? previewArticle(story) : null)
  const [loading, setLoading] = useState(Boolean(story))
  const [notice, setNotice] = useState(story ? '' : 'This reader link is missing a public article URL.')
  const [attempt, setAttempt] = useState(0)
  const [progress, setProgress] = useState(0)
  const mainRef = useRef<HTMLElement>(null)
  const onScroll = (e: UIEvent<HTMLElement>) => {
    const el = e.currentTarget
    const max = el.scrollHeight - el.clientHeight
    setProgress(max > 0 ? el.scrollTop / max : 0)
  }

  useEffect(() => {
    if (!story) return
    const controller = new AbortController()
    setLoading(true)
    setNotice('')
    void fetch(`${API_BASE_URL}/articles/extract`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: story.url }), signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error('Full text unavailable. You can attach the preview or open the original.')
      const result = await response.json()
      if (!controller.signal.aborted) {
        setArticle((current) => current ? { ...current, text: result.text, status: result.status } : current)
        setNotice('')
      }
    }).catch((error) => {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : 'Full text unavailable.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [story?.url, attempt])

  if (!story || !article) {
    return <main className="h-full overflow-auto bg-surface-0 px-6 py-16 text-ink dark:bg-surface-900 dark:text-ink-inverse">
      <p role="alert" className="mx-auto max-w-[40rem] text-sm text-ink-muted dark:text-ink-inverse-muted">{notice}</p>
    </main>
  }

  return <main ref={mainRef} onScroll={onScroll} className="h-full overflow-auto bg-surface-0 font-normal text-ink dark:bg-surface-900 dark:text-ink-inverse">
    <header className="relative sticky top-0 z-10 border-b border-surface-200/80 bg-surface-0/90 backdrop-blur-md dark:border-surface-700/80 dark:bg-surface-900/90">
      <div className="mx-auto flex h-12 max-w-[68ch] items-center gap-2 px-4 sm:px-0">
        <button type="button" onClick={goHome}
          className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-ink-secondary hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-800">
          <ArrowLeft size={14} />Discover
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-muted dark:text-ink-inverse-muted">{story.source} · {story.topic}</p>
        <InterestsActionMenu article={article} onAttached={() => {}} />
        <button type="button" onClick={() => { void window.electron?.browser?.navigate(story.url) }}
          className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-body-xs font-semibold text-indigo-600 hover:bg-surface-100 dark:text-indigo-300 dark:hover:bg-surface-800">
          Original <ArrowUpRight size={14} />
        </button>
      </div>
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-indigo-500" style={{ transform: `scaleX(${progress})` }} data-reading-progress={progress.toFixed(2)} />
    </header>
    <div className="px-5 pb-24 pt-10 sm:px-8">
      <NewsArticle story={story} article={article} loading={loading} notice={notice} onRetry={() => setAttempt((value) => value + 1)} />
      <p className="mx-auto mt-10 max-w-[68ch] border-t border-surface-200 pt-6 text-center text-[11px] text-ink-muted dark:border-surface-700 dark:text-ink-inverse-muted">Attach a reference. Add your message. Then send.</p>
    </div>
  </main>
}
