import { memo, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { Streamdown, parseMarkdownIntoBlocks } from 'streamdown'
import { MARKDOWN_COMPONENTS } from '@/components/ai-elements/response'
import { classifyBlock, planAdSlots, type AdSlot, type ArticleBlock } from '@/lib/article-body'
import { cn } from '@/utils/cn'

type Components = NonNullable<ComponentProps<typeof Streamdown>['components']>

/** Top-level blocks of the article Markdown, split by the same parser that renders them. */
export function articleBlocks(markdown: string): ArticleBlock[] {
  return parseMarkdownIntoBlocks(markdown).map(classifyBlock).filter((block) => block.markdown)
}

const IMAGE_FLOOR = { width: 160, height: 80 }

/**
 * A figure from the article. Publisher images are third-party content: https only, no referrer, lazy. An image that
 * fails to load, or turns out to be an icon, avatar or tracking pixel, removes its whole figure instead of leaving a gap.
 */
function ArticleFigure({ src, alt }: { src?: string; alt?: string }) {
  const [hidden, setHidden] = useState(false)
  if (!src || !/^https:\/\//i.test(src) || hidden) return null
  return <figure className="!mt-8">
    <img
      src={src} alt={alt || ''} loading="lazy" decoding="async" referrerPolicy="no-referrer"
      onError={() => setHidden(true)}
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget
        if (naturalWidth < IMAGE_FLOOR.width || naturalHeight < IMAGE_FLOOR.height) setHidden(true)
      }}
      className="w-full rounded-xl border border-surface-200 bg-surface-100 dark:border-surface-800 dark:bg-surface-850"
    />
  </figure>
}

const SAFE_LINK = /^(https?:|mailto:)/i

/**
 * Reading-room typography. Explicit type tokens override the global heading and paragraph rules. Links are real
 * links: http(s) opens a new Ren tab (`target="_blank"` is handled by the main process), mailto opens the mail
 * client, and anything else is shown as plain text.
 */
const ARTICLE_COMPONENTS: Components = {
  ...MARKDOWN_COMPONENTS,
  h1: ({ children }) => <h2 className="!mt-12 font-display text-2xl font-bold leading-[1.15] tracking-[-0.025em] text-ink dark:text-ink-inverse">{children}</h2>,
  h2: ({ children }) => <h2 className="!mt-12 font-display text-2xl font-bold leading-[1.15] tracking-[-0.025em] text-ink dark:text-ink-inverse">{children}</h2>,
  h3: ({ children }) => <h3 className="!mt-9 font-display text-xl font-bold leading-[1.2] tracking-[-0.02em] text-ink dark:text-ink-inverse">{children}</h3>,
  h4: ({ children }) => <h4 className="!mt-7 font-display text-lg font-semibold leading-snug text-ink dark:text-ink-inverse">{children}</h4>,
  h5: ({ children }) => <h5 className="!mt-6 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-secondary dark:text-ink-inverse-secondary">{children}</h5>,
  h6: ({ children }) => <h6 className="!mt-6 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted">{children}</h6>,
  p: ({ node, children }) => {
    const only = node?.children.length === 1 ? node.children[0] : null
    if (only && only.type === 'element' && only.tagName === 'img') {
      return <ArticleFigure src={typeof only.properties?.src === 'string' ? only.properties.src : undefined}
        alt={typeof only.properties?.alt === 'string' ? only.properties.alt : undefined} />
    }
    return <p className="text-[1.0625rem] leading-[1.8] text-ink/90 dark:text-ink-inverse/90">{children}</p>
  },
  a: ({ href, children }) => href && SAFE_LINK.test(href)
    ? <a href={href} {...(/^mailto:/i.test(href) ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
        className="font-medium text-blurple-700 underline decoration-blurple-600/40 decoration-1 underline-offset-[0.22em] transition-colors duration-150 hover:decoration-2 dark:text-blurple-300 dark:decoration-blurple-400/50">{children}</a>
    : <span>{children}</span>,
  img: ({ src, alt }) => <ArticleFigure src={typeof src === 'string' ? src : undefined} alt={alt} />,
  ul: ({ children }) => <ul className="ml-6 list-disc space-y-2 text-[1.0625rem] leading-[1.75] text-ink/90 marker:text-ink-muted dark:text-ink-inverse/90 dark:marker:text-ink-inverse-muted [&_ol]:mt-2 [&_ul]:mt-2">{children}</ul>,
  ol: ({ children }) => <ol className="ml-6 list-decimal space-y-2 text-[1.0625rem] leading-[1.75] text-ink/90 marker:font-semibold marker:text-ink-secondary dark:text-ink-inverse/90 dark:marker:text-ink-inverse-secondary [&_ol]:mt-2 [&_ul]:mt-2">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  blockquote: ({ children }) => <blockquote className="!mt-8 border-l-[3px] border-blurple-600 pl-5 font-display text-[1.2rem] font-medium leading-snug tracking-[-0.005em] text-ink dark:border-blurple-400 dark:text-ink-inverse [&>p+p]:mt-3 [&>p]:text-[inherit] [&>p]:leading-[inherit] [&>p]:text-ink dark:[&>p]:text-ink-inverse">{children}</blockquote>,
  hr: () => <hr className="!my-10 border-surface-200 dark:border-surface-800" />,
  table: ({ children }) => <div className="!mt-8 overflow-x-auto rounded-xl border border-surface-200 dark:border-surface-800"><table className="w-full border-collapse text-left text-[0.95rem] leading-snug">{children}</table></div>,
  thead: ({ children }) => <thead className="bg-surface-50 dark:bg-surface-850">{children}</thead>,
  th: ({ children }) => <th className="border-b border-surface-200 px-3.5 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-secondary dark:border-surface-800 dark:text-ink-inverse-secondary">{children}</th>,
  td: ({ children }) => <td className="border-b border-surface-200 px-3.5 py-2.5 align-top text-ink/90 dark:border-surface-800 dark:text-ink-inverse/90">{children}</td>,
  strong: ({ children }) => <strong className="font-semibold text-ink dark:text-ink-inverse">{children}</strong>,
  sup: ({ children }) => <sup className="text-[0.7em] leading-none">{children}</sup>,
}

/**
 * Static-mode Streamdown renders blocks as direct children of its root, so the lede is `> p:first-child`.
 * Written out in full: Tailwind only generates classes it finds literally in the source.
 */
const DROP_CAP = '[&>p:first-child]:first-letter:float-left [&>p:first-child]:first-letter:mr-2.5 [&>p:first-child]:first-letter:mt-1 [&>p:first-child]:first-letter:font-display [&>p:first-child]:first-letter:text-[3.6rem] [&>p:first-child]:first-letter:font-extrabold [&>p:first-child]:first-letter:leading-[0.8] [&>p:first-child]:first-letter:text-blurple-600 dark:[&>p:first-child]:first-letter:text-blurple-400'

/**
 * Streamdown's root is `space-y-4`, whose specificity beats per-element margins, so the rhythm is set here instead:
 * 24px between blocks, with the few exceptions (a heading's own air, the line after a heading) as `!` overrides.
 */
const RHYTHM = 'space-y-6 [&>:is(h2,h3,h4,h5,h6)+*]:!mt-3 [&>figure+*]:!mt-8 [&>blockquote+*]:!mt-8 [&>div+*]:!mt-8'

const Markdown = memo(function Markdown({ children, dropCap }: { children: string; dropCap: boolean }) {
  return <Streamdown
    mode="static" controls={false} components={ARTICLE_COMPONENTS}
    className={cn(RHYTHM, dropCap && DROP_CAP)}
  >{children}</Streamdown>
})

/**
 * The article body: Markdown, rendered. With `renderSlot` the body is split between blocks wherever `planAdSlots`
 * allows a placement and the slot renders around the text; the Markdown itself never contains an ad. A slot whose
 * `renderSlot` returns nothing leaves no trace. Every placement carries the platform's own "Advertisement" label,
 * so disclosure never depends on what the provider renders.
 */
export function ArticleBody({ blocks, renderSlot, className }: {
  blocks: ArticleBlock[]
  renderSlot?: (slot: AdSlot) => ReactNode
  className?: string
}) {
  const slots = useMemo(() => renderSlot ? planAdSlots(blocks) : [], [blocks, renderSlot])
  const dropCap = blocks[0]?.type === 'paragraph' && blocks[0].words >= 25
  const segments = useMemo(() => {
    const cuts = slots.map((slot) => slot.after + 1)
    const out: { markdown: string; slot?: AdSlot }[] = []
    let start = 0
    slots.forEach((slot, index) => {
      out.push({ markdown: blocks.slice(start, cuts[index]).map((block) => block.markdown).join('\n\n'), slot })
      start = cuts[index]
    })
    out.push({ markdown: blocks.slice(start).map((block) => block.markdown).join('\n\n') })
    return out.filter((segment) => segment.markdown || segment.slot)
  }, [blocks, slots])

  return <div className={className}>
    {segments.map((segment, index) => {
      const sponsored = segment.slot && renderSlot ? renderSlot(segment.slot) : null
      return <div key={index}>
        {segment.markdown && <Markdown dropCap={dropCap && index === 0}>{segment.markdown}</Markdown>}
        {sponsored && <aside aria-label="Advertisement" data-ad-slot={segment.slot?.id} data-ad-position={segment.slot?.position}
          className="my-10 border-y border-surface-200 py-3 dark:border-surface-800">
          <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-muted dark:text-ink-inverse-muted">Advertisement</p>
          {sponsored}
        </aside>}
      </div>
    })}
  </div>
}
