import { useMemo, useState, type ReactNode } from 'react'
import { ArrowUpRight, Lock, Play, TriangleAlert } from 'lucide-react'
import { RenWordmark } from '@/components/brand'
import { ArticleBody, articleBlocks } from '@/components/home/ArticleBody'
import { opensWith, readingMinutes, totalWords, withoutLeadImage, type AdSlot } from '@/lib/article-body'
import { cleanTitle, formatPublished, type ArticleAttachment, type ArticleMeta, type Story } from '@/lib/articles'

/** A publisher image narrower than this is a logo or icon, not a lead photo: the full-width hero is for real photographs. */
const HERO_MIN_WIDTH = 480

const META_LINE = 'flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted'

function Badge({ children, pulse }: { children: ReactNode; pulse?: boolean }) {
  return <span className="inline-flex items-center gap-1.5 rounded bg-ink px-1.5 py-0.5 text-[10px] font-bold tracking-[0.1em] text-white dark:bg-ink-inverse dark:text-ink">
    {pulse && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse" />}{children}
  </span>
}

/** Reading-room page for one story. The body is Markdown (full article or Brave's own data) rendered by `ArticleBody`. */
export function NewsArticle({ story, article, meta, loading, notice, onRetry, renderSlot }: {
  story: Story
  article: ArticleAttachment
  meta: ArticleMeta | null
  loading: boolean
  notice: string
  onRetry: () => void
  /** Sponsored placements around the body; see `ArticleBody`. The reader wires no ad provider yet. */
  renderSlot?: (slot: AdSlot) => ReactNode
}) {
  const [heroFailed, setHeroFailed] = useState(false)
  const [thumbFailed, setThumbFailed] = useState(false)
  const [faviconFailed, setFaviconFailed] = useState(false)
  const preview = article.status === 'preview'
  const headline = cleanTitle(story.title, [story.source, story.hostname, meta?.siteName])
  // A full-width hero must be a lead photo: a video's thumbnail, or the extracted article's own og:image. Brave's
  // full-size `thumbnail.original` for any other result is often the site's default share banner (Reddit's logo), so
  // those previews keep the small thumbnail beside the text.
  const heroSource = story.kind === 'video' ? story.heroImage || meta?.image || '' : meta?.image || ''
  const hero = heroSource && !heroFailed ? heroSource : ''
  const thumbSource = story.thumbnail || story.heroImage || ''
  const thumb = !hero && thumbSource && !thumbFailed ? thumbSource : ''
  const allBlocks = useMemo(() => articleBlocks(article.text), [article.text])
  const blocks = useMemo(() => withoutLeadImage(allBlocks, hero || undefined), [allBlocks, hero])
  const minutes = readingMinutes(blocks)
  const sparse = totalWords(blocks) < 20
  const failed = !loading && preview && Boolean(notice)
  const dek = !preview && meta?.description && meta.description.length <= 320 && !opensWith(blocks, meta.description) ? meta.description : ''
  const authors = meta?.authors.length ? meta.authors : story.author ? [story.author] : []
  const dateLabel = formatPublished(story.published || meta?.published || '', story.age)
  const video = story.video
  const discussion = story.discussion
  const heroClass = 'aspect-video w-full rounded-2xl border border-surface-200 bg-surface-100 object-cover dark:border-surface-800 dark:bg-surface-850'
  const onHeroLoad = (width: number) => { if (width < HERO_MIN_WIDTH) setHeroFailed(true) }

  return <article className="mx-auto max-w-[68ch]" lang={meta?.language || story.language || undefined}>
    <p className="tag-label tag-label-slash flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-ink dark:text-ink-inverse">{story.topic}</span>
      {story.live && <Badge pulse>LIVE</Badge>}
      {story.breaking && <Badge>BREAKING</Badge>}
      {preview ? <span>· Preview</span> : <span className="tabular-nums">· {minutes} min read</span>}
      {story.paywalled && <span className="inline-flex items-center gap-1"><span aria-hidden>·</span><Lock className="h-3 w-3" aria-hidden />Subscription may be required</span>}
    </p>
    <h1 className="mt-5 font-display text-display-sm font-extrabold tracking-[-0.035em] text-ink sm:text-display-md dark:text-ink-inverse">{headline}</h1>
    {dek && <p className="mt-5 font-display text-[1.25rem] font-medium leading-snug tracking-[-0.01em] text-ink-secondary dark:text-ink-inverse-secondary">{dek}</p>}
    <p className={`${META_LINE} mt-6`}>
      {story.favicon && !faviconFailed && <img src={story.favicon} alt="" referrerPolicy="no-referrer" className="h-4 w-4 rounded-sm" onError={() => setFaviconFailed(true)} />}
      <span className="font-semibold text-ink dark:text-ink-inverse">{story.source}</span>
      {authors.length > 0 && <><span aria-hidden>·</span><span>By {authors.join(', ')}</span></>}
      {dateLabel && <><span aria-hidden>·</span><time dateTime={story.published || meta?.published || undefined}>{dateLabel}</time></>}
    </p>
    {video && <p className={`${META_LINE} mt-2`}>
      {[video.duration, video.creator, video.publisher, video.views && `${video.views} views`].filter(Boolean).map((part, index) => <span key={index}>{index > 0 && <span aria-hidden className="mr-2">·</span>}{part}</span>)}
    </p>}
    {discussion && <p className={`${META_LINE} mt-2`}>
      {[discussion.forum, discussion.answers !== undefined && `${discussion.answers} ${discussion.answers === 1 ? 'answer' : 'answers'}`, discussion.score && `Score ${discussion.score}`].filter(Boolean).map((part, index) => <span key={index}>{index > 0 && <span aria-hidden className="mr-2">·</span>}{part}</span>)}
    </p>}
    <hr className="mt-8 border-surface-200 dark:border-surface-800" />

    {hero && (story.kind === 'video'
      ? <a href={story.url} target="_blank" rel="noopener noreferrer" aria-label={`Watch: ${headline}`} className="group relative mt-8 block overflow-hidden rounded-2xl">
        <img src={hero} alt="" referrerPolicy="no-referrer" className={heroClass} onError={() => setHeroFailed(true)} onLoad={(event) => onHeroLoad(event.currentTarget.naturalWidth)} />
        <span aria-hidden className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-ink/80 text-white backdrop-blur-sm transition-transform duration-200 ease-out group-hover:scale-105">
            <Play className="h-6 w-6 translate-x-0.5" fill="currentColor" />
          </span>
        </span>
      </a>
      : <figure className="mt-8">
        <img src={hero} alt="" referrerPolicy="no-referrer" className={heroClass} onError={() => setHeroFailed(true)} onLoad={(event) => onHeroLoad(event.currentTarget.naturalWidth)} />
      </figure>)}

    {loading && <div role="status" aria-label="Retrieving the article" className="mt-8">
      <p className={`${META_LINE} text-ink-secondary dark:text-ink-inverse-secondary`}>
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-volt motion-safe:animate-pulse" />Retrieving the full article
      </p>
      {sparse && <div className="mt-6 space-y-3">
        {[92, 100, 96, 88, 100, 70].map((width, index) => <div key={index} className="h-4 rounded bg-surface-100 motion-safe:animate-pulse dark:bg-surface-850" style={{ width: `${width}%` }} />)}
      </div>}
    </div>}
    {failed && <p role="status" className="mt-8 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-[14px] leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
      <TriangleAlert className="mt-[3px] h-4 w-4 shrink-0" />
      <span>{notice} <button type="button" className="font-semibold text-ink underline decoration-2 underline-offset-2 dark:text-ink-inverse" onClick={onRetry}>Retry</button></span>
    </p>}

    {!sparse || !loading ? <div className="mt-10">
      {thumb && <figure className="mb-6 sm:float-right sm:mb-4 sm:ml-8 sm:w-44">
        <img src={thumb} alt="" referrerPolicy="no-referrer" onError={() => setThumbFailed(true)} className="aspect-square w-full rounded-xl border border-surface-200 object-cover dark:border-surface-800" />
      </figure>}
      <ArticleBody blocks={blocks} renderSlot={preview ? undefined : renderSlot} />
      <a href={story.url} target="_blank" rel="noopener noreferrer"
        className="group mt-12 flex items-center justify-between gap-4 rounded-xl border border-surface-200 px-4 py-3.5 transition-colors duration-150 ease-out hover:border-surface-300 hover:bg-surface-50 dark:border-surface-800 dark:hover:border-surface-700 dark:hover:bg-surface-850">
        <span className="min-w-0">
          <span className="block font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted">
            {preview ? 'Read the full story' : meta?.truncated ? 'This article was shortened here. Continue reading' : 'Original source'}
          </span>
          <span className="mt-0.5 block truncate font-display text-[1.0625rem] font-bold text-ink dark:text-ink-inverse">{story.source}</span>
        </span>
        <ArrowUpRight className="h-5 w-5 shrink-0 text-blurple-600 transition-transform duration-150 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5 dark:text-blurple-400" />
      </a>
      <p aria-hidden className="mt-14 flex justify-center text-ink dark:text-ink-inverse"><RenWordmark className="text-[30px]" /></p>
    </div> : null}
  </article>
}
