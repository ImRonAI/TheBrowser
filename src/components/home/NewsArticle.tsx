import { useState } from 'react'
import { formatPublished, type ArticleAttachment, type Story } from '@/lib/articles'
import { cn } from '@/utils/cn'

function readingBlocks(text: string): { heading: boolean; text: string }[] {
  const chunks = text.split(/\n\n+/).map((part) => part.replace(/\s+/g, ' ').trim()).filter((part) => part.length > 1)
  const blocks: { heading: boolean; text: string }[] = []
  for (const chunk of chunks) {
    const heading = chunk.length < 90 && !/[.!?]$/.test(chunk)
    if (heading || chunk.length < 700) {
      blocks.push({ heading, text: chunk })
      continue
    }
    const sentences = chunk.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [chunk]
    let buffer = ''
    for (const sentence of sentences) {
      if (buffer && (buffer + sentence).length > 480) {
        blocks.push({ heading: false, text: buffer.trim() })
        buffer = sentence
      } else buffer += sentence
    }
    if (buffer.trim()) blocks.push({ heading: false, text: buffer.trim() })
  }
  return blocks
}

/** Reading-room body. Explicit type tokens override the global heading and paragraph rules. */
export function NewsArticle({ story, article, loading, notice, onRetry }: {
  story: Story
  article: ArticleAttachment
  loading: boolean
  notice: string
  onRetry: () => void
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const [faviconFailed, setFaviconFailed] = useState(false)
  const blocks = readingBlocks(article.text)
  const words = article.text.split(/\s+/).filter(Boolean).length
  const minutes = Math.max(1, Math.ceil(words / 220))
  const failed = !loading && article.status === 'preview' && Boolean(notice)
  const showHero = Boolean(story.thumbnail) && !imageFailed
  const dateLabel = formatPublished(story.published, story.age)
  const firstParagraphIndex = blocks.findIndex((block) => !block.heading)

  return <article className="mx-auto max-w-[68ch]">
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300">
      <span>{story.topic}</span>
      {article.status === 'preview'
        ? <span className="text-ink-muted dark:text-ink-inverse-muted">· Preview</span>
        : <span className="text-ink-muted dark:text-ink-inverse-muted">· {minutes} min read</span>}
    </p>
    <h1 className="mt-4 font-display text-[2.35rem] font-light leading-[1.08] tracking-tight text-ink sm:text-[2.9rem] dark:text-ink-inverse">{story.title}</h1>
    {story.description && <p className="mt-5 font-display text-lg italic leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">{story.description}</p>}
    <p className="mt-6 flex items-center gap-2 text-body-sm text-ink-secondary dark:text-ink-inverse-secondary">
      {story.favicon && !faviconFailed && <img src={story.favicon} alt="" className="h-4 w-4 rounded-sm" onError={() => setFaviconFailed(true)} />}
      <span className="font-semibold text-ink dark:text-ink-inverse">{story.source}</span>
      {dateLabel && <span aria-hidden>·</span>}
      {dateLabel && <time dateTime={story.published || undefined}>{dateLabel}</time>}
    </p>
    <hr className="mt-8 border-surface-200 dark:border-surface-700" />
    {loading && <div role="status" aria-label="Retrieving the article" className="mt-10 space-y-3">
      {[92, 100, 96, 88, 100, 70].map((width, index) => <div key={index} className="h-4 animate-pulse rounded bg-surface-100 dark:bg-surface-800" style={{ width: `${width}%` }} />)}
    </div>}
    {failed && <p role="status" className="mt-8 rounded-xl border border-surface-200 bg-surface-50 p-4 text-body-sm text-ink-secondary dark:border-surface-700 dark:bg-surface-850 dark:text-ink-inverse-secondary">
      {notice} <button type="button" className="font-semibold text-indigo-600 underline underline-offset-2 dark:text-indigo-300" onClick={onRetry}>Retry</button>
    </p>}
    {!loading && <div className="mt-10">
      {showHero && <figure className="mb-6 sm:float-right sm:mb-4 sm:ml-8 sm:w-44">
        <img src={story.thumbnail} alt="" onError={() => setImageFailed(true)} className="aspect-square w-full rounded-2xl object-cover shadow-md" />
      </figure>}
      {blocks.map((block, index) => block.heading
        ? <h2 key={index} className="mb-3 mt-10 font-display text-2xl font-normal leading-snug text-ink first:mt-0 dark:text-ink-inverse">{block.text}</h2>
        : <p key={index} className={cn('mb-6 text-[1.0625rem] leading-[1.8] text-ink/90 dark:text-ink-inverse/90', index === firstParagraphIndex && 'first-letter:float-left first-letter:mr-2 first-letter:mt-1 first-letter:font-display first-letter:text-[3.4rem] first-letter:leading-[0.8] first-letter:text-indigo-600 dark:first-letter:text-indigo-300')}>{block.text}</p>)}
      <p aria-hidden className="mt-10 text-center text-indigo-500">◆</p>
    </div>}
  </article>
}
