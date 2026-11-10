import { useEffect, useRef, useState, type UIEvent } from 'react'
import { ArrowLeft, ArrowUpRight, Newspaper } from 'lucide-react'
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
    return <main className="flex h-full items-center justify-center overflow-auto bg-surface-0 px-6 py-16 text-ink dark:bg-surface-900 dark:text-ink-inverse">
      <div className="flex max-w-sm flex-col items-center text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-100 text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary">
          <Newspaper className="h-5 w-5" />
        </span>
        <h1 className="mt-4 font-display text-xl font-bold tracking-tight text-ink dark:text-ink-inverse">Nothing to read here</h1>
        <p role="alert" className="mt-1.5 text-[14px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">{notice}</p>
        <button type="button" onClick={goHome}
          className="mt-6 inline-flex h-9 items-center gap-2 rounded-lg bg-blurple-600 px-3.5 text-[13px] font-semibold text-white transition-colors duration-150 ease-out hover:bg-blurple-700 active:bg-blurple-800 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300">
          <ArrowLeft className="h-4 w-4" />Back to Discover
        </button>
      </div>
    </main>
  }

  return <main ref={mainRef} onScroll={onScroll} className="h-full overflow-auto bg-surface-0 font-normal text-ink dark:bg-surface-900 dark:text-ink-inverse">
    {/* Exact surface tokens: opaque paper/ink in Light and Dark, the frosted blue content tint in Glass. */}
    <header className="sticky top-0 z-10 border-b border-surface-200 bg-surface-0 backdrop-blur-md dark:border-surface-800 dark:bg-surface-900">
      <div className="mx-auto flex h-12 max-w-[68ch] items-center gap-2 px-4 sm:px-0">
        <button type="button" onClick={goHome}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-ink-secondary transition-colors duration-150 ease-out hover:bg-surface-100 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-850 dark:hover:text-ink-inverse">
          <ArrowLeft className="h-4 w-4" />Discover
        </button>
        <p className="min-w-0 flex-1 truncate text-center font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted">{story.source} · {story.topic}</p>
        <InterestsActionMenu article={article} onAttached={() => {}} />
        <button type="button" onClick={() => { void window.electron?.browser?.navigate(story.url) }}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-3 text-[13px] font-semibold text-blurple-600 transition-colors duration-150 ease-out hover:bg-blurple-50 hover:text-blurple-700 dark:text-blurple-400 dark:hover:bg-blurple-950/50 dark:hover:text-blurple-300">
          Original <ArrowUpRight className="h-4 w-4" />
        </button>
      </div>
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-volt" style={{ transform: `scaleX(${progress})` }} data-reading-progress={progress.toFixed(2)} />
    </header>
    <div className="px-5 pb-24 pt-12 sm:px-8">
      <NewsArticle story={story} article={article} loading={loading} notice={notice} onRetry={() => setAttempt((value) => value + 1)} />
      <p className="mx-auto mt-12 max-w-[68ch] border-t border-surface-200 pt-6 text-center text-[12px] text-ink-muted dark:border-surface-800 dark:text-ink-inverse-muted">Attach a reference. Add your message. Then send.</p>
    </div>
  </main>
}
