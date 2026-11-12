/**
 * Issue relationships as one issue reads them. A relationship is one directed `issue_links` row
 * (`A blocks B`: source A, target B, type `blocks`) and each end reads it from its own side, so every type but
 * `relates` has two kinds: "Blocks" on A, "Blocked by" on B. Choosing an inverse kind swaps the ends: "this
 * issue is Blocked by X" is stored as `X blocks this`. Pure, so `node --experimental-strip-types` can test it.
 */
import { issueKey } from './execute-issues.ts'
import type { Issue, IssueLink, IssueLinkType, Project } from '../types/projects.ts'

export type RelationKind =
  | 'relates'
  | 'blocks' | 'blocked-by'
  | 'enables' | 'enabled-by'
  | 'implements' | 'implemented-by'
  | 'fixes' | 'fixed-by'
  | 'discovers' | 'discovered-by'
  | 'duplicates' | 'duplicated-by'

export interface RelationKindInfo {
  kind: RelationKind
  type: IssueLinkType
  /** This issue is the link's source ("Blocks"); false when it is the target ("Blocked by"). `relates` has no direction. */
  outgoing: boolean
  label: string
  /** One line for the picker: what the relationship means, and what it does. */
  hint: string
}

const kind = (kind: RelationKind, type: IssueLinkType, outgoing: boolean, label: string, hint: string): RelationKindInfo =>
  ({ kind, type, outgoing, label, hint })

export const RELATION_KINDS: Record<RelationKind, RelationKindInfo> = {
  relates: kind('relates', 'relates', true, 'Relates to', 'Connected work, with no order between the two.'),
  blocks: kind('blocks', 'blocks', true, 'Blocks', 'That issue moves to Blocked until this one is done.'),
  'blocked-by': kind('blocked-by', 'blocks', false, 'Blocked by', 'This issue moves to Blocked until that one is done.'),
  enables: kind('enables', 'enables', true, 'Enables', 'This issue makes that one possible.'),
  'enabled-by': kind('enabled-by', 'enables', false, 'Enabled by', 'That issue makes this one possible.'),
  implements: kind('implements', 'implements', true, 'Implements', 'This issue delivers what that one describes.'),
  'implemented-by': kind('implemented-by', 'implements', false, 'Implemented by', 'That issue delivers what this one describes.'),
  fixes: kind('fixes', 'fixes', true, 'Fixes', 'This issue fixes what that one reports.'),
  'fixed-by': kind('fixed-by', 'fixes', false, 'Fixed by', 'That issue fixes what this one reports.'),
  discovers: kind('discovers', 'discovers', true, 'Discovers', 'Work on this issue turned up that one.'),
  'discovered-by': kind('discovered-by', 'discovers', false, 'Discovered by', 'This issue turned up during work on that one.'),
  duplicates: kind('duplicates', 'duplicates', true, 'Duplicates', 'This issue repeats that one, the original.'),
  'duplicated-by': kind('duplicated-by', 'duplicates', false, 'Duplicated by', 'That issue repeats this one, the original.'),
}

export const DEFAULT_RELATION: RelationKind = 'relates'

/** The picker's layout: `relates` on its own, then each type with its two readings side by side. */
export const RELATION_KIND_ROWS: readonly (readonly RelationKind[])[] = [
  ['relates'], ['blocks', 'blocked-by'], ['enables', 'enabled-by'], ['implements', 'implemented-by'],
  ['fixes', 'fixed-by'], ['discovers', 'discovered-by'], ['duplicates', 'duplicated-by'],
]

/** Group order in the views: dependencies first (what holds this issue, then what it holds), plain relations last. */
export const RELATION_GROUP_ORDER: readonly RelationKind[] = [
  'blocked-by', 'blocks', 'enabled-by', 'enables', 'implements', 'implemented-by', 'fixes', 'fixed-by',
  'discovers', 'discovered-by', 'duplicates', 'duplicated-by', 'relates',
]

/** How a link of `type` reads from its source (`outgoing`) or its target. Unknown legacy types read as "Relates to". */
export function relationKind(type: string, outgoing: boolean): RelationKind {
  if (type === 'relates') return 'relates'
  return Object.values(RELATION_KINDS).find((info) => info.type === type && info.outgoing === outgoing)?.kind ?? 'relates'
}

/** The `issue_links` row for "this issue <kind> other": an inverse kind swaps the ends. */
export function linkFor(kind: RelationKind, issueId: string, otherId: string): { sourceId: string; targetId: string; type: IssueLinkType } {
  const { type, outgoing } = RELATION_KINDS[kind]
  return outgoing ? { sourceId: issueId, targetId: otherId, type } : { sourceId: otherId, targetId: issueId, type }
}

/** How `issueId` reads `link`, or null when the link does not involve it. */
export function relationOf(link: IssueLink, issueId: string): { kind: RelationKind; otherId: string } | null {
  if (link.sourceId === link.targetId) return null
  if (link.sourceId === issueId) return { kind: relationKind(link.type, true), otherId: link.targetId }
  if (link.targetId === issueId) return { kind: relationKind(link.type, false), otherId: link.sourceId }
  return null
}

export interface Relation {
  link: IssueLink
  kind: RelationKind
  otherId: string
  /** The loaded issue at the other end; missing when it is not loaded (deleted, or no longer shared). */
  other?: Issue
}

export interface RelationGroup { kind: RelationKind; label: string; relations: Relation[] }

/** The issue's relationships by kind, in RELATION_GROUP_ORDER, oldest link first in each group; empty kinds are left out. */
export function relationGroups(issueId: string, links: IssueLink[], issues: Issue[]): RelationGroup[] {
  const byId = new Map(issues.map((issue) => [issue.id, issue]))
  const groups = new Map<RelationKind, Relation[]>()
  const ordered = [...links].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.id.localeCompare(b.id))
  for (const link of ordered) {
    const relation = relationOf(link, issueId)
    if (!relation) continue
    groups.set(relation.kind, [...(groups.get(relation.kind) ?? []), { link, ...relation, other: byId.get(relation.otherId) }])
  }
  return RELATION_GROUP_ORDER.filter((kind) => groups.has(kind))
    .map((kind) => ({ kind, label: RELATION_KINDS[kind].label, relations: groups.get(kind)! }))
}

export const relationCount = (issueId: string, links: IssueLink[]) => links.filter((link) => relationOf(link, issueId)).length

/**
 * A `blocks` relationship that holds work now: its blocker is not done. "Blocked by" reads the other issue,
 * "Blocks" reads this one (`issue`); every other kind never blocks.
 */
export function isActiveBlock(relation: Relation, issue: Pick<Issue, 'status'>): boolean {
  if (relation.kind === 'blocked-by') return !!relation.other && relation.other.status !== 'done'
  if (relation.kind === 'blocks') return issue.status !== 'done'
  return false
}

export interface RelationCandidate {
  issue: Issue
  /** `<projectKey>-<number>`. */
  key: string
  project?: Project
  /** 0 exact key, 1 key prefix, 2 title prefix, 3 title contains (every issue, for an empty query). */
  tier: number
}

export const RELATION_SEARCH_LIMIT = 50

const words = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Issues of every loaded project that `issue` can be related to as `kind`, best first: an exact key ("cal-12",
 * or the number alone, "12" or "#12"), then a key prefix, a title prefix and a title containing the query;
 * within a tier the issue's own project first, then the most recently updated. Leaves out the issue itself and
 * every issue it is already related to by the same type in either direction: a second edge of one type repeats
 * the first (`relates`, and `duplicates`, which Supabase stores as one row whichever way it was made) or
 * contradicts it (A blocks B and B blocks A is a deadlock).
 */
export function relationCandidates(query: string, { issue, kind, issues, projects, links, limit = RELATION_SEARCH_LIMIT }: {
  issue: Pick<Issue, 'id' | 'projectId'>
  kind: RelationKind
  issues: Issue[]
  projects: Project[]
  links: IssueLink[]
  limit?: number
}): RelationCandidate[] {
  const type = RELATION_KINDS[kind].type
  const related = new Set(links.filter((link) => link.type === type).map((link) => relationOf(link, issue.id)?.otherId))
  const byId = new Map(projects.map((project) => [project.id, project]))
  const q = words(query)
  const number = /^#?(\d+)$/.exec(q)?.[1]
  const tierOf = (key: string, item: Issue): number | null => {
    if (!q) return 3
    const title = words(item.title)
    if (key === q || (number !== undefined && String(item.number) === number)) return 0
    if (key.startsWith(q) || (number !== undefined && String(item.number).startsWith(number))) return 1
    if (title.startsWith(q)) return 2
    return title.includes(q) ? 3 : null
  }
  const candidates: RelationCandidate[] = []
  for (const item of issues) {
    if (item.id === issue.id || related.has(item.id)) continue
    const key = issueKey(item, byId)
    const tier = tierOf(key.toLowerCase(), item)
    if (tier !== null) candidates.push({ issue: item, key, project: byId.get(item.projectId), tier })
  }
  const elsewhere = (candidate: RelationCandidate) => (candidate.issue.projectId === issue.projectId ? 0 : 1)
  return candidates.sort((a, b) => a.tier - b.tier || elsewhere(a) - elsewhere(b)
    || (b.issue.updatedAt || 0) - (a.issue.updatedAt || 0) || a.key.localeCompare(b.key, undefined, { numeric: true }))
    .slice(0, limit)
}

/** The store's error for a failed link, readable: a relationship that already exists (Postgres 23505, or the guest workspace's 409). */
export function relationError(message: string): string {
  return /duplicate key|already exists/i.test(message) ? 'These issues are already related this way.' : message
}
