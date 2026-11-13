/**
 * Ask Ren on a Discover article: what Ren can do with the article the reader shows, where each action goes, and the
 * exact message it sends. The reader's `ArticleAgentActions` is the UI; this file is the contract.
 *
 * Agent actions never paste the article into the message: it rides as the conversation's native article attachment
 * (`ChatRequest.attachments`, shown as an attachment card and given to the agent as untrusted reference data), so the
 * message only says what to do with it. Pure (relative imports only) so node:test can run it.
 */
import type { ArticleAttachment } from './articles.ts'
import type { IssueContextEntry } from './issue-attachments.ts'

export type ArticleActionId = 'search' | 'chat' | 'project' | 'code' | 'document' | 'issue' | 'context'

export interface ArticleAction {
  id: ArticleActionId
  group: 'Ask' | 'Create' | 'Save'
  label: string
  description: string
  /** Typed into the action list's filter, these find the action too. */
  keywords: string[]
  /** The prompt box. `optional`: an empty prompt sends `fallback` (or, for Add to a project, no note). */
  prompt: { label: string; placeholder: string; optional: boolean }
  /** The send button. */
  submit: string
}

export const ARTICLE_ACTIONS: readonly ArticleAction[] = [
  {
    id: 'search', group: 'Ask', label: 'Search the web', description: 'Ren Search researches the story across sources.',
    keywords: ['research', 'find', 'sources', 'more'], submit: 'Search',
    prompt: { label: 'Search for', placeholder: 'What to search for', optional: false },
  },
  {
    id: 'chat', group: 'Ask', label: 'Start a conversation', description: 'Talk it through with Ren or another agent.',
    keywords: ['chat', 'ask', 'discuss', 'agent', 'specialist', 'question'], submit: 'Start chat',
    prompt: { label: 'Your message', placeholder: 'Ask anything about this article…', optional: true },
  },
  {
    id: 'project', group: 'Create', label: 'Start a project', description: 'Ren plans a project and its backlog from it.',
    keywords: ['plan', 'backlog', 'workspace', 'new project'], submit: 'Start project',
    prompt: { label: 'What the project should achieve', placeholder: 'e.g. Track how this policy affects our customers', optional: true },
  },
  {
    id: 'code', group: 'Create', label: 'Start a coding project', description: 'The Build agent turns it into working code.',
    keywords: ['build', 'code', 'app', 'prototype', 'website', 'develop'], submit: 'Start building',
    prompt: { label: 'What to build', placeholder: 'e.g. An interactive page that charts the numbers in this story', optional: true },
  },
  {
    id: 'document', group: 'Create', label: 'Create a document', description: 'Ren writes a page from the article.',
    keywords: ['page', 'doc', 'write', 'brief', 'summary', 'notes'], submit: 'Write document',
    prompt: { label: 'What the document should be', placeholder: 'e.g. A one-page brief for the team', optional: true },
  },
  {
    id: 'issue', group: 'Create', label: 'Create an issue', description: 'A project’s agent files the work as an issue.',
    keywords: ['task', 'ticket', 'bug', 'story', 'todo', 'follow up'], submit: 'Create issue',
    prompt: { label: 'What needs doing', placeholder: 'e.g. Review our pricing against this announcement', optional: true },
  },
  {
    id: 'context', group: 'Save', label: 'Add to a project', description: 'Save it in an issue’s Context for the team and its agent.',
    keywords: ['context', 'save', 'reference', 'attach', 'issue'], submit: 'Add to issue',
    prompt: { label: 'Note', placeholder: 'Why it matters here (optional)', optional: true },
  },
]

export const articleAction = (id: ArticleActionId): ArticleAction => ARTICLE_ACTIONS.find((action) => action.id === id)!

/**
 * The action list's filter (cmdk `filter`; the item's value is its label, its keywords the description and
 * `keywords`): a label match ranks first, then a keyword match. Substrings only: cmdk's default fuzzy score ranked
 * Start a conversation above Create an issue for "issue".
 */
export function actionFilter(value: string, search: string, keywords?: string[]): number {
  const needle = search.trim().toLowerCase()
  if (!needle) return 1
  if (value.toLowerCase().includes(needle)) return 1
  return keywords?.some((keyword) => keyword.toLowerCase().includes(needle)) ? 0.5 : 0
}

type ArticleRef = Pick<ArticleAttachment, 'title' | 'url' | 'source'>

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
/** How a message names the attached article: its title, publisher and link. */
export const articleRef = (article: ArticleRef) => `"${oneLine(article.title)}" (${oneLine(article.source)}, ${article.url})`

/** The prompt, or what an empty optional prompt means. */
const asked = (prompt: string, fallback: string) => prompt.trim() || fallback

/** Start a conversation: the user's own words; an empty prompt asks for the essentials. */
export function chatMessage(prompt: string): string {
  return asked(prompt, 'Read the attached article and tell me what matters in it: what happened, why it matters, and what to watch next.')
}

/** Start a project: Ren reads the article and builds a project and its backlog with its workspace tools. */
export function projectMessage(prompt: string, article: ArticleRef): string {
  return [
    `Start a project from the attached article ${articleRef(article)}.`,
    `What the project should achieve: ${asked(prompt, 'the work this article calls for.')}`,
    '1. Read the attached article.',
    '2. Create a project that fits it with create_project: a clear name, a short key and the project type that matches the work.',
    '3. Create its issues with create_issue, top-down, following the new project\'s issue types, so the work becomes the backlog. Link the article in the descriptions it informs.',
    'Then tell me the project key and what you created.',
  ].join('\n')
}

/** Start a coding project: the Build agent's own request, with the article as its brief. */
export function codeMessage(prompt: string, article: ArticleRef): string {
  return [
    asked(prompt, 'Build an interactive web page that explains this article: its key facts, people and numbers.'),
    `The attached article ${articleRef(article)} is the brief.`,
  ].join('\n\n')
}

export const PERSONAL_DOCUMENTS = 'personal'

/** Create a document: Ren writes the page and saves it where the user chose, with `create_document`. */
export function documentMessage(prompt: string, article: ArticleRef, project: { id: string; name: string; key: string } | null): string {
  const where = project
    ? `in the ${oneLine(project.name)} (${project.key}) project (project_id ${project.id})`
    : 'in my documents (no project_id)'
  return [
    `Write a document from the attached article ${articleRef(article)}.`,
    `What it should be: ${asked(prompt, 'a clear brief of the article: what happened, why it matters and what to do about it.')}`,
    `Save it with create_document ${where}, written in Markdown, with the article linked as its source.`,
    'Then tell me its title and where it is.',
  ].join('\n')
}

/** Create an issue: the project's agent writes it with its own tools and puts the article in the issue's Context. */
export function issueMessage(prompt: string, article: ArticleRef): string {
  return [
    `Create an issue in this project from the attached article ${articleRef(article)}.`,
    `What needs doing: ${asked(prompt, 'the follow-up work this article calls for.')}`,
    '1. Read the project with read_project to pick the issue type that fits.',
    '2. Create the issue with create_issue: a clear title and a Markdown description that links the article.',
    '3. Add the article to the new issue\'s Context with add_issue_context (kind article, the article\'s link as url, its key points as content).',
    'Then tell me the issue key.',
  ].join('\n')
}

/** The search Ren Search runs first: the story's own headline. */
export function searchQuery(headline: string): string {
  return oneLine(headline).slice(0, 400)
}

const httpsOnly = (value: string | undefined) => {
  if (!value) return ''
  try { return new URL(value).protocol === 'https:' ? value : '' } catch { return '' }
}

/**
 * Add to a project: the article as an issue's Context entry (`issues.context`, what the Context tab shows and the
 * issue agent reads with `read_issue`). One entry per article per issue: adding the same article again refreshes it.
 * The note, when there is one, leads the entry.
 */
export function articleContextEntry(article: ArticleAttachment, note: string, image?: string, attachedAt = new Date().toISOString()): IssueContextEntry {
  const url = httpsOnly(article.url)
  const lead = oneLine(note) ? `**Note:** ${oneLine(note)}\n\n---\n\n` : ''
  const hero = httpsOnly(image)
  return {
    id: `article:${article.url}`,
    kind: 'article',
    title: oneLine(article.title).slice(0, 500),
    content: `${lead}${article.text}`.slice(0, 500_000),
    source: article.url,
    url,
    images: hero ? [{ url: hero }] : [],
    files: [],
    added: attachedAt,
    attachedAt,
  }
}
