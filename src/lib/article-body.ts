/**
 * Block model of a reader article, and the editorial rules for where the platform may place advertising in it.
 *
 * Pure functions only (no DOM, no React) so `node --experimental-strip-types` can test them. The body itself is
 * Markdown produced by `agent/api/core/article_markdown.py`; `parseMarkdownIntoBlocks` from Streamdown splits it
 * into top-level blocks and `classifyBlock` says what each one is.
 *
 * Ads are never part of the article text. The body stays editorial Markdown (it is also what an agent or a Context
 * item receives); `planAdSlots` only says *between which blocks* the reader may render a sponsored placement, and
 * the reader renders it around the body. Nothing here knows about an ad network.
 */

export type BlockType = 'heading' | 'paragraph' | 'list' | 'quote' | 'image' | 'table' | 'code' | 'rule'

export interface ArticleBlock {
  type: BlockType
  markdown: string
  /** Words a reader would read: link destinations, image syntax and Markdown punctuation do not count. */
  words: number
}

export function visibleWords(markdown: string): number {
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\((?:<[^>]*>|[^)]*)\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~|\\-]+/g, ' ')
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length
}

export function classifyBlock(markdown: string): ArticleBlock {
  const text = markdown.trim()
  let type: BlockType = 'paragraph'
  if (/^#{1,6}\s/.test(text)) type = 'heading'
  else if (/^(```|~~~)/.test(text)) type = 'code'
  else if (/^>/.test(text)) type = 'quote'
  else if (/^(?:[-*+]|\d+[.)])\s/.test(text)) type = 'list'
  else if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(text)) type = 'rule'
  else if (/^\|.*\|\s*\n\s*\|?\s*:?-{2,}/.test(text)) type = 'table'
  else if (/^!\[[^\]]*\]\([^)]*\)\s*$/.test(text)) type = 'image'
  return { type, markdown: text, words: type === 'image' || type === 'rule' ? 0 : visibleWords(text) }
}

export function totalWords(blocks: readonly ArticleBlock[]): number {
  return blocks.reduce((sum, block) => sum + block.words, 0)
}

/** Reading time at 220 wpm, never below one minute. */
export function readingMinutes(blocks: readonly ArticleBlock[]): number {
  return Math.max(1, Math.ceil(totalWords(blocks) / 220))
}

export interface AdSlot {
  id: string
  position: 'inline' | 'end'
  /** Index of the block the slot follows. */
  after: number
}

export interface AdPlanOptions {
  /** Articles shorter than this carry no ads (previews and short wire items never do). */
  minWords: number
  /** Words of article before the first inline slot. */
  firstAfterWords: number
  /** Words between inline slots. */
  spacingWords: number
  /** Inline slots at most. */
  maxInline: number
  /** Words that must follow an inline slot, so an ad never sits on the last paragraph. */
  tailWords: number
  /** One more slot after the last block. */
  end: boolean
}

export const DEFAULT_AD_PLAN: AdPlanOptions = { minWords: 450, firstAfterWords: 220, spacingWords: 380, maxInline: 3, tailWords: 120, end: true }

/** A paragraph that introduces what follows ("The changes are:") must stay attached to it. */
const leadsIn = (block: ArticleBlock) => /[:…]\s*$/.test(block.markdown)

/**
 * Where sponsored placements may go. An inline slot follows a full prose paragraph only: never a heading (it
 * would separate a heading from its first paragraph), a list, quote, table or code block, a caption under an image,
 * or a paragraph that leads into the block after it. At most `maxInline` inline slots, `spacingWords` apart, and
 * none within `tailWords` of the end; `end` adds one after the last block. Short articles get none.
 */
export function planAdSlots(blocks: readonly ArticleBlock[], options: Partial<AdPlanOptions> = {}): AdSlot[] {
  const plan = { ...DEFAULT_AD_PLAN, ...options }
  const total = totalWords(blocks)
  if (total < plan.minWords) return []
  const slots: AdSlot[] = []
  let sinceLast = 0
  let threshold = plan.firstAfterWords
  let read = 0
  for (let index = 0; index < blocks.length - 1 && slots.length < plan.maxInline; index++) {
    const block = blocks[index]
    read += block.words
    sinceLast += block.words
    const caption = blocks[index - 1]?.type === 'image' && block.words < 25
    const eligible = block.type === 'paragraph' && block.words >= 15 && !caption && !leadsIn(block)
    if (eligible && sinceLast >= threshold && total - read >= plan.tailWords) {
      slots.push({ id: `ad-${slots.length + 1}`, position: 'inline', after: index })
      sinceLast = 0
      threshold = plan.spacingWords
    }
  }
  if (plan.end && blocks.length) slots.push({ id: 'ad-end', position: 'end', after: blocks.length - 1 })
  return slots
}

/** Long identifier-like fragments of an image URL ("qiLNW6MFxpp6cd8GpRyPmm"), which survive CDN resize suffixes and wrappers. */
function imageTokens(url: string): Set<string> {
  let decoded = url
  try { decoded = decodeURIComponent(url) } catch { /* keep the raw URL */ }
  // Hash- or id-like runs only: a digit or mixed case, so long words in a URL slug never match.
  const ids = (decoded.match(/[A-Za-z0-9]{16,}/g) ?? []).filter((token) => /\d/.test(token) || (/[a-z]/.test(token) && /[A-Z]/.test(token)))
  return new Set(ids)
}

const IMAGE_SRC = /^!\[[^\]]*\]\((?:<([^>]*)>|([^)\s]*))/

/**
 * The page's lead image is shown as the hero, and many publishers repeat it as the body's first image (usually
 * under another resize URL). Drop that repeat, looking only at the first few blocks.
 */
export function withoutLeadImage(blocks: readonly ArticleBlock[], heroUrl: string | undefined): ArticleBlock[] {
  if (!heroUrl) return [...blocks]
  const hero = imageTokens(heroUrl)
  const index = blocks.slice(0, 3).findIndex((block) => {
    if (block.type !== 'image') return false
    const src = block.markdown.match(IMAGE_SRC)
    const tokens = src ? imageTokens(src[1] ?? src[2] ?? '') : new Set<string>()
    return [...tokens].some((token) => hero.has(token))
  })
  return index < 0 ? [...blocks] : blocks.filter((_, i) => i !== index)
}

/** First paragraph's words folded for comparison, to hide a description the body already opens with. */
export function opensWith(blocks: readonly ArticleBlock[], text: string): boolean {
  const fold = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const wanted = fold(text).slice(0, 60)
  const first = blocks.find((block) => block.type === 'paragraph')
  return wanted.length >= 20 && !!first && fold(visibleText(first.markdown)).startsWith(wanted)
}

function visibleText(markdown: string): string {
  return markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\((?:<[^>]*>|[^)]*)\)/g, '$1').replace(/[*_`~]/g, '')
}
