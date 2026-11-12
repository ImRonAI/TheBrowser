/**
 * `@` references in page editors: a page, a tool, an agent, an MCP server or a skill, inserted as a chip
 * (`ReferenceMention`) that saves as `<span data-type="reference" data-kind data-id data-label>` and reads as
 * `@[label](ron://<kind>/<id>)` in Markdown (the same form the backend writes, `core/document_skills.py`).
 *
 * Where the choices come from:
 * - pages: `GET /projects/documents` (every page the user can open);
 * - tools, MCP servers, this agent's skills and Ron's A2A agent: `GET /teaching/references`;
 * - the user's specialists: `GET /context/agents`; project agents: the user's projects.
 * Agent ids are `ron`, `specialist/<id>` and `project/<id>`, which the skill publisher resolves.
 *
 * Pure (relative imports only) so node:test can run it.
 */

export type ReferenceKind = 'document' | 'tool' | 'agent' | 'mcp' | 'skill'

export interface ReferenceItem {
  kind: ReferenceKind
  id: string
  label: string
  description: string
  /** A finer grouping shown beside the item ("Core tools", "Library · devops", "Specialist"…). */
  group: string
}

export interface ReferenceGroup { kind: ReferenceKind; title: string; items: ReferenceItem[] }

/** Menu order and headings. */
export const REFERENCE_KINDS: { kind: ReferenceKind; title: string }[] = [
  { kind: 'document', title: 'Pages' },
  { kind: 'tool', title: 'Tools' },
  { kind: 'agent', title: 'Agents' },
  { kind: 'mcp', title: 'MCP servers' },
  { kind: 'skill', title: 'Skills' },
]
const KINDS = new Set<string>(REFERENCE_KINDS.map((entry) => entry.kind))
export const isReferenceKind = (value: unknown): value is ReferenceKind => typeof value === 'string' && KINDS.has(value)
export const referenceKindTitle = (kind: ReferenceKind) => REFERENCE_KINDS.find((entry) => entry.kind === kind)!.title

/** What `GET /teaching/references` returns. */
export interface TeachingReferenceCatalog {
  tools: CatalogEntry[]
  mcp_servers: CatalogEntry[]
  skills: CatalogEntry[]
  agents: (CatalogEntry & { a2a_url?: string })[]
}
interface CatalogEntry { id: string; label: string; description: string; group: string }

export async function fetchReferenceCatalog(apiBase: string, userId: string, agentId = 'panel',
  fetcher: typeof fetch = fetch): Promise<TeachingReferenceCatalog> {
  const query = new URLSearchParams({ user_id: userId, agent_id: agentId })
  const response = await fetcher(`${apiBase}/teaching/references?${query}`, { signal: AbortSignal.timeout(30000) })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body) throw new Error(typeof body?.detail === 'string' ? body.detail : `References could not be loaded (${response.status})`)
  return body as TeachingReferenceCatalog
}

/** Every reference the menu can offer, in menu order. */
export function referenceItems(sources: {
  catalog?: TeachingReferenceCatalog | null
  documents?: { id: string; title: string; projectId: string | null }[]
  projects?: { id: string; name: string; key?: string; summary?: string; lifecycle?: string }[]
  specialists?: { id: string; name: string; description?: string }[]
}): ReferenceItem[] {
  const projectName = new Map((sources.projects ?? []).map((project) => [project.id, project.key ? `${project.key}` : project.name]))
  const items: ReferenceItem[] = []
  for (const doc of sources.documents ?? []) {
    items.push({ kind: 'document', id: doc.id, label: doc.title || 'Untitled', description: '', group: doc.projectId ? projectName.get(doc.projectId) ?? 'Page' : 'My documents' })
  }
  const catalog = sources.catalog
  for (const entry of catalog?.tools ?? []) items.push({ kind: 'tool', ...pick(entry) })
  for (const entry of catalog?.agents ?? []) items.push({ kind: 'agent', ...pick(entry), group: 'Ren' })
  for (const agent of sources.specialists ?? []) {
    items.push({ kind: 'agent', id: `specialist/${agent.id}`, label: agent.name, description: agent.description ?? '', group: 'Specialist' })
  }
  for (const project of sources.projects ?? []) {
    if (project.lifecycle === 'archived') continue
    items.push({ kind: 'agent', id: `project/${project.id}`, label: project.key ? `${project.name} (${project.key})` : project.name,
      description: project.summary || 'The project’s agent: reads and edits its issues and pages.', group: 'Project agent' })
  }
  for (const entry of catalog?.mcp_servers ?? []) items.push({ kind: 'mcp', ...pick(entry) })
  for (const entry of catalog?.skills ?? []) items.push({ kind: 'skill', ...pick(entry) })
  return items
}
const pick = (entry: CatalogEntry) => ({ id: entry.id, label: entry.label || entry.id, description: entry.description ?? '', group: entry.group ?? '' })

const words = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/**
 * The menu for a query: groups in kind order, each with its best matches. Every word of the query must
 * prefix a word of the label, id or group (descriptions only break ties). Label matches come first.
 */
export function filterReferences(items: ReferenceItem[], query: string, perGroup = query.trim() ? 8 : 4): ReferenceGroup[] {
  const needles = words(query)
  const score = (item: ReferenceItem) => {
    if (!needles.length) return 1
    const label = words(item.label)
    const other = [...words(item.id), ...words(item.group)]
    const description = words(item.description)
    let total = 0
    for (const needle of needles) {
      if (label.some((word) => word.startsWith(needle))) total += 3
      else if (other.some((word) => word.startsWith(needle))) total += 2
      else if (description.some((word) => word.startsWith(needle))) total += 1
      else return 0
    }
    return total + (item.label.toLowerCase().startsWith(needles[0]) ? 2 : 0)
  }
  return REFERENCE_KINDS.map(({ kind, title }) => ({
    kind, title,
    items: items.filter((item) => item.kind === kind)
      .map((item, index) => ({ item, index, value: score(item) }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value || a.index - b.index)
      .slice(0, perGroup).map((entry) => entry.item),
  })).filter((group) => group.items.length > 0)
}

// --- Markdown: @[label](ron://kind/id) --------------------------------------------------------

const escapeLabel = (label: string) => label.replace(/\s+/g, ' ').trim().replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]')

export function referenceMarkdown(reference: { kind: ReferenceKind; id: string; label?: string | null }): string {
  return `@[${escapeLabel(reference.label || reference.id)}](ron://${reference.kind}/${reference.id})`
}

/** A reference at the start of `src` (the Markdown tokenizer), or null. */
export const REFERENCE_MARKDOWN = /^@\[((?:\\.|[^\]\\])*)\]\(ron:\/\/(document|tool|agent|mcp|skill)\/([^)\s]+)\)/

export function parseReferenceMarkdown(src: string): { raw: string; kind: ReferenceKind; id: string; label: string } | null {
  const match = REFERENCE_MARKDOWN.exec(src)
  if (!match) return null
  return { raw: match[0], kind: match[2] as ReferenceKind, id: match[3], label: match[1].replace(/\\(.)/g, '$1') }
}

/** Where a reference may start in `src` (-1 when none), so plain text is not tokenized past it. */
export function referenceStart(src: string): number {
  const index = src.search(/@\[(?:\\.|[^\]\\])*\]\(ron:\/\//)
  return index
}
