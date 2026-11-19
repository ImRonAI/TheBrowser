import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { ArrowLeft, ArrowUpRight, Newspaper } from 'lucide-react'
import { ArticleAgentActions } from '@/components/home/ArticleAgentActions'
import { NewsArticle } from '@/components/home/NewsArticle'
import { API_BASE_URL } from '@/lib/api-base'
import { cleanTitle, previewArticle, storyFromReadUrl, youtubeVideoId, type ArticleMeta } from '@/lib/articles'
import { useTabStore } from '@/stores/tabStore'

/** `POST /articles/extract`: Markdown body (`text`) plus what the page says about itself (core/articles.py). */
interface ExtractResponse {
  text: string
  status: 'extracted' | 'preview'
  truncated?: boolean
  title?: string | null
  description?: string | null
  authors?: string[]
  site_name?: string | null
  published?: string | null
  image?: string | null
  language?: string | null
}

interface VideoSummaryEvent {
  type: 'meta' | 'delta' | 'done' | 'error'
  text?: string
  message?: string
  meta?: {
    title?: string | null
    channel?: string | null
    authors?: string[]
    duration?: string | null
    published?: string | null
    image?: string | null
    site_name?: string | null
  }
}

function metaFrom(result: ExtractResponse): ArticleMeta {
  const title = result.title || undefined
  const description = result.description || undefined
  const siteName = result.site_name || undefined
  const published = result.published || undefined
  const image = result.image || undefined
  const language = result.language || undefined
  return {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    authors: Array.isArray(result.authors) ? result.authors : [],
    ...(siteName !== undefined ? { siteName } : {}),
    ...(published !== undefined ? { published } : {}),
    ...(image !== undefined ? { image } : {}),
    ...(language !== undefined ? { language } : {}),
    truncated: result.truncated === true,
  }
}

function goHome() {
  const tabs = useTabStore.getState()
  if (tabs.activeTabId) tabs.updateTab(tabs.activeTabId, { url: 'ron://home', title: 'Home' })
  void window.electron?.browser?.navigate('ron://home')
}

export function ArticleReaderPage({ href }: { href: string }) {
  const story = useMemo(() => storyFromReadUrl(href), [href])
  const [article, setArticle] = useState(() => story ? previewArticle(story) : null)
  const [meta, setMeta] = useState<ArticleMeta | null>(null)
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
    if (!story) {
      setArticle(null)
      setMeta(null)
      setLoading(false)
      setNotice('This reader link is missing a public article URL.')
      return
    }
    const controller = new AbortController()
    const basePreview = previewArticle(story)
    setArticle(basePreview)
    setLoading(true)
    setNotice('')
    setMeta(null)

    const videoId = youtubeVideoId(story.url)
    if (videoId) {
      void (async () => {
        let streamed = ''
        try {
          const response = await fetch(`${API_BASE_URL}/articles/video-summary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: story.url,
              title: story.title,
              channel: story.video?.creator || story.author || '',
              description: story.description || '',
              snippets: story.snippets || [],
            }),
            signal: controller.signal,
          })
          if (!response.ok || !response.body) {
            throw new Error('Video writeup unavailable right now.')
          }
          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let splitAt = buffer.indexOf('\n\n')
            while (splitAt !== -1) {
              const rawFrame = buffer.slice(0, splitAt).trim()
              buffer = buffer.slice(splitAt + 2)
              splitAt = buffer.indexOf('\n\n')
              if (!rawFrame.startsWith('data:')) continue
              const jsonText = rawFrame.slice(5).trim()
              if (!jsonText) continue
              const event = JSON.parse(jsonText) as VideoSummaryEvent
              if (controller.signal.aborted) return
              if (event.type === 'meta' && event.meta) {
                const metaTitle = event.meta.title || undefined
                const metaPublished = event.meta.published || undefined
                const metaImage = event.meta.image || undefined
                setMeta({
                  ...(metaTitle !== undefined ? { title: metaTitle } : {}),
                  authors: Array.isArray(event.meta.authors) ? event.meta.authors : [],
                  siteName: event.meta.site_name || 'YouTube',
                  ...(metaPublished !== undefined ? { published: metaPublished } : {}),
                  ...(metaImage !== undefined ? { image: metaImage } : {}),
                  truncated: false,
                })
              } else if (event.type === 'delta' && event.text) {
                streamed += event.text
                const snapshot = streamed
                setArticle((current) => current ? { ...current, text: snapshot, status: 'extracted' } : current)
              } else if (event.type === 'done' && event.text) {
                streamed = event.text
                const finalText = streamed
                setArticle((current) => current ? { ...current, text: finalText, status: 'extracted' } : current)
              } else if (event.type === 'error') {
                throw new Error(event.message || 'Video writeup unavailable.')
              }
            }
          }
        } catch (error) {
          if (!controller.signal.aborted && !streamed) {
            setNotice(error instanceof Error ? error.message : 'Video writeup unavailable.')
          }
        } finally {
          if (!controller.signal.aborted) setLoading(false)
        }
      })()
      return () => controller.abort()
    }

    void fetch(`${API_BASE_URL}/articles/extract`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: story.url }), signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        let message = 'Full text unavailable. You can attach the preview or open the original.'
        try {
          const payload = await response.json() as { detail?: string }
          if (typeof payload?.detail === 'string' && payload.detail.trim()) message = payload.detail
        } catch {
          // keep default message
        }
        throw new Error(message)
      }
      const result = await response.json() as ExtractResponse
      if (!controller.signal.aborted) {
        setArticle((current) => current ? { ...current, text: result.text, status: result.status } : current)
        setMeta(metaFrom(result))
        setNotice('')
      }
    }).catch((error) => {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : 'Full text unavailable.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [href, story, attempt])

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

  // Ask Ren sends the article as it is now; it waits for the full text while that is still being retrieved.
  const favicon = story.favicon || undefined
  const image = meta?.image || story.heroImage
  const askRen = {
    article,
    headline: cleanTitle(story.title, [story.source, story.hostname, meta?.siteName]),
    ...(favicon !== undefined ? { favicon } : {}),
    ...(image !== undefined ? { image } : {}),
    ready: !loading,
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
        <ArticleAgentActions {...askRen} />
        <button type="button" onClick={() => { void window.electron?.browser?.navigate(story.url) }}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-3 text-[13px] font-semibold text-blurple-600 transition-colors duration-150 ease-out hover:bg-blurple-50 hover:text-blurple-700 dark:text-blurple-400 dark:hover:bg-blurple-950/50 dark:hover:text-blurple-300">
          Original <ArrowUpRight className="h-4 w-4" />
        </button>
      </div>
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-volt" style={{ transform: `scaleX(${progress})` }} data-reading-progress={progress.toFixed(2)} />
    </header>
    <div className="px-5 pb-24 pt-12 sm:px-8">
      <NewsArticle story={story} article={article} meta={meta} loading={loading} notice={notice} onRetry={() => setAttempt((value) => value + 1)} />
      <section aria-label="Ask Ren about this article" className="mx-auto mt-12 flex max-w-[68ch] flex-col items-center gap-4 border-t border-surface-200 pt-8 dark:border-surface-800">
        <ArticleAgentActions {...askRen} variant="inline" />
      </section>
    </div>
  </main>
}
