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
      'Reply with only the content in Markdown: headings (#, ##, ###), paragraphs, bullet and numbered lists, task lists (- [ ] item), tables, block quotes and fenced code blocks.',
      'When a process, plan, pipeline, approval path or decision flow would help, call render_workflow at the point in the content where the diagram belongs (write the text before it first, then call the tool, then continue). Choose each step\'s shape (kind) and label the arrows out of decisions. Existing workflows appear above as ```workflow JSON fences: to keep one unchanged, repeat its fence exactly; to change it, call render_workflow with the whole new version.',
      'When the topic needs facts you are not sure of, research it first with brave_web_search, brave_news_search or brave_answer and cite what you used as Markdown links.',
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

export interface DocNode { type?: string; attrs?: Record<string, unknown>; content?: DocNode[]; text?: string; [key: string]: unknown }

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

/** Replace parsed ```workflow code blocks with workflow blocks; anything else is left as parsed. */
export function withWorkflowBlocks(node: DocNode, newId: () => string): DocNode {
  if (node.type === 'codeBlock' && node.attrs?.language === WORKFLOW_FENCE) {
    const workflow = workflowFromFence((node.content ?? []).map((child) => child.text ?? '').join(''))
    if (workflow) return { type: 'workflow', attrs: { id: newId(), title: workflow.title, graph: workflow.graph } }
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
