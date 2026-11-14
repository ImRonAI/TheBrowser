/**
 * Ask Ron in project documents and issue descriptions. Ron (the server-owned panel agent, `POST /chat`)
 * writes Markdown and draws processes with its `render_workflow` tool; the editor's official Markdown
 * extension parses the text and each drawn workflow becomes a workflow block, in the order Ron produced
 * them. A ```workflow JSON fence (how existing workflows appear in the page context) is accepted too.
 * Ron only proposes: the user inserts or replaces, then the page saves as usual.
 * Pure (relative imports, no React) so node:test can run it.
 */
import { normalizeWorkflow, type WorkflowGraph } from './workflow.ts'
import type { RonSegment } from './ron-run.ts'

/** The page text Ron receives as context is capped so one prompt never carries a whole wiki. */
export const DOCUMENT_CONTEXT_LIMIT = 12000
export const WORKFLOW_FENCE = 'workflow'

/** A workflow as Markdown: the fence Ron writes and the editor serializes. */
export function workflowMarkdown(title: string, graph: WorkflowGraph): string {
  const steps = graph.steps.map(({ position: _position, ...step }) => step)
  const connections = graph.connections.map(({ source, target, type, label }) => ({ source, target, type, ...(label ? { label } : {}) }))
  return `\`\`\`${WORKFLOW_FENCE}\n${JSON.stringify({ title, steps, connections }, null, 2)}\n\`\`\``
}

/** What Ron is writing: a project page or an issue description. */
export interface RonWritingTarget {
  kind: 'page' | 'issue'
  /** Page title or issue title. */
  title: string
  projectName: string
  projectKey: string
  /** Extra facts Ron should use (issue type/status/priority, the issue's Context items, …). */
  facts?: string
}

export function documentRonMessage({ target, intent, currentMarkdown }: {
  target: RonWritingTarget; intent: string; currentMarkdown: string
}): string {
  const page = currentMarkdown.trim()
  const what = target.kind === 'page'
    ? `the page "${target.title.trim() || 'Untitled'}" in the ${target.projectName} (${target.projectKey}) project documentation`
    : `the description of the issue "${target.title.trim() || 'Untitled'}" in the ${target.projectName} (${target.projectKey}) project`
  const current = target.kind === 'page' ? 'Current page' : 'Current description'
  return [
    `Write ${what}.`,
    `Request: ${intent.trim()}`,
    ...(target.facts?.trim() ? [`Facts to use:\n${target.facts.trim().slice(0, DOCUMENT_CONTEXT_LIMIT)}`] : []),
    page ? `${current} (Markdown, for reference):\n<current>\n${page.slice(0, DOCUMENT_CONTEXT_LIMIT)}${page.length > DOCUMENT_CONTEXT_LIMIT ? '\n…' : ''}\n</current>` : `The ${target.kind === 'page' ? 'page' : 'description'} is empty.`,
    [
      'Reply with only the content in Markdown: headings (#, ##, ###), paragraphs, bullet and numbered lists, task lists (- [ ] item), tables, block quotes, fenced code blocks, Markdown images (![Caption](https://...)), and standalone YouTube video URLs.',
      'When images are requested or add visual clarity, embed real https:// image URLs from attached reference material or brave_image_search using ![Descriptive caption](https://...) (never invent image URLs). When an embedded video is requested or helpful, place a real https://www.youtube.com/watch?v=VIDEO_ID URL (from attached context or brave_video_search) alone on its own line so the editor renders a playable YouTube embed (never invent video IDs).',
      'When a process, plan, pipeline, approval path or decision flow would help, call render_workflow at the point in the content where the diagram belongs (write the text before it first, then call the tool, then continue). Choose each step\'s shape (kind) and label the arrows out of decisions. Existing workflows appear above as ```workflow JSON fences: to keep one unchanged, repeat its fence exactly; to change it, call render_workflow with the whole new version.',
      'When the topic needs facts you are not sure of, research it first with brave_web_search, brave_news_search, brave_image_search, brave_video_search or brave_answer and cite what you used as Markdown links.',
      `Write only what the request asks for. When it adds to the ${target.kind === 'page' ? 'page' : 'description'} (a section, a list, a summary, a workflow), write just that new content and do not repeat what is already there: the user inserts it where they choose. When it asks for the whole ${target.kind === 'page' ? 'page' : 'description'} (draft it, rewrite it, restructure it), write all of it: the user overwrites the ${target.kind === 'page' ? 'page' : 'description'} with it.`,
      'Every word you write goes into the draft: do not announce or narrate your research or add a preamble. Your first words are the content itself.',
    ].join('\n'),
  ].join('\n\n')
}

/** Try again: the user's feedback on the draft; Ron answers with the complete revised draft. */
export function documentRetryMessage(feedback: string): string {
  return [
    `Feedback on your draft: ${feedback.trim()}`,
    'Write the complete revised draft again, with the same rules: only the content in Markdown, render_workflow where a diagram belongs, research when you need facts.',
  ].join('\n\n')
}

/** A model sometimes wraps the whole answer in one ```markdown fence. */
export function unwrapMarkdown(text: string): string {
  const trimmed = text.trim()
  const wrapped = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/i.exec(trimmed)
  const body = wrapped ? wrapped[1].trim() : trimmed
  // A status sentence glued to the content that follows it ("Checking the docs.## Install",
  // "Confirming the details.Intro paragraph…") is narration, not content: the missing space shows two
  // separate pieces of text. A single word ("Node.JS") or an abbreviation ("the U.S.") is never taken for one.
  const status = /^[^\n#]{1,200}?[.!?…](?=#{1,6} \S)/.exec(body) ?? /^(?:[^\s#.!?…]+[ \t]+){2,}[^\s#.!?…]*[a-z][.!?…](?=[A-Z])/.exec(body)
  // A heading glued to the end of a sentence elsewhere is still a heading.
  return (status ? body.slice(status[0].length) : body).replace(/([.!?])(#{1,6} )(?=\S)/g, '$1\n\n$2')
}

export interface DocNode {
  type?: string
  attrs?: Record<string, unknown>
  content?: DocNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown>; [key: string]: unknown }>
  [key: string]: unknown
}

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/

/** Normalize a YouTube watch/short/embed/live URL to `https://www.youtube.com/watch?v=<id>`, or null. */
export function youtubeEmbedUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase()
    let id: string | null = null
    if (host === 'youtu.be') {
      id = parsed.pathname.split('/').filter(Boolean)[0] ?? null
    } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      if (parsed.pathname === '/watch') {
        id = parsed.searchParams.get('v')
      } else {
        const parts = parsed.pathname.split('/').filter(Boolean)
        if ((parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') && parts[1]) {
          id = parts[1]
        }
      }
    }
    return id && YOUTUBE_ID_RE.test(id) ? `https://www.youtube.com/watch?v=${id}` : null
  } catch {
    return null
  }
}

/** A ```workflow fence body → workflow block attributes, or null when it is not a usable workflow. */
export function workflowFromFence(body: string): { title: string; graph: WorkflowGraph } | null {
  let value: unknown
  try { value = JSON.parse(body) } catch { return null }
  const graph = normalizeWorkflow(value)
  if (graph.steps.length === 0) return null
  const title = typeof (value as { title?: unknown }).title === 'string' && (value as { title: string }).title.trim()
    ? (value as { title: string }).title.trim().slice(0, 120) : 'Workflow'
  return { title, graph }
}

/** Replace parsed ```workflow code blocks with workflow blocks and standalone YouTube URLs/fences with YouTube blocks. */
export function withWorkflowBlocks(node: DocNode, newId: () => string): DocNode {
  if (node.type === 'codeBlock') {
    const lang = typeof node.attrs?.language === 'string' ? node.attrs.language.toLowerCase() : ''
    const body = (node.content ?? []).map((child) => child.text ?? '').join('')
    if (lang === WORKFLOW_FENCE) {
      const workflow = workflowFromFence(body)
      if (workflow) return { type: 'workflow', attrs: { id: newId(), title: workflow.title, graph: workflow.graph } }
    }
    if (lang === 'youtube' || lang === 'video') {
      const firstLine = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ''
      const yt = youtubeEmbedUrl(firstLine)
      if (yt) return { type: 'youtube', attrs: { src: yt } }
    }
  }
  if (node.type === 'image' && typeof node.attrs?.src === 'string') {
    const yt = youtubeEmbedUrl(node.attrs.src)
    if (yt) return { type: 'youtube', attrs: { src: yt } }
  }
  if (node.type === 'paragraph' && node.content?.length === 1 && node.content[0].type === 'text') {
    const only = node.content[0]
    const directYt = youtubeEmbedUrl(only.text ?? '')
    if (directYt) return { type: 'youtube', attrs: { src: directYt } }
    const linkMark = (only.marks ?? []).find((mark) => mark.type === 'link' && typeof mark.attrs?.href === 'string')
    const linkedYt = linkMark ? youtubeEmbedUrl(String(linkMark.attrs?.href ?? '')) : null
    if (linkedYt) return { type: 'youtube', attrs: { src: linkedYt } }
  }
  return node.content ? { ...node, content: node.content.map((child) => withWorkflowBlocks(child, newId)) } : node
}

/**
 * Ron's ordered answer → editor block content. `parse` is the editor's Markdown parser
 * (`editor.markdown.parse`); drawn workflows and ```workflow fences become workflow blocks.
 */
export function documentContent(segments: RonSegment[], parse: (markdown: string) => DocNode, newId: () => string): DocNode[] {
  const content: DocNode[] = []
  for (const segment of segments) {
    if (segment.kind === 'workflow') {
      content.push({ type: 'workflow', attrs: { id: newId(), title: segment.title, graph: segment.graph } })
      continue
    }
    const markdown = unwrapMarkdown(segment.text)
    if (!markdown) continue
    const parsed = withWorkflowBlocks(parse(markdown), newId)
    content.push(...(parsed.content ?? []))
  }
  return content
}

/** Markdown preview of the same answer (workflows shown by the caller between the text pieces). */
export function hasDraft(segments: RonSegment[]): boolean {
  return segments.some((segment) => segment.kind === 'workflow' || unwrapMarkdown(segment.text).length > 0)
}
