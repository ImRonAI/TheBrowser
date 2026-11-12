/**
 * The people on a project (`/projects/{id}/members`, migration 023): its owner plus everyone the owner
 * invited (`public.project_members`). The owner invites an existing Ren account by email and can remove
 * anyone else; a member can leave. Everyone on a project opens and edits its issues and pages (RLS
 * `can_access_project`). A guest workspace lives on one device, so it lists only its owner and cannot invite.
 * Pure (relative imports) so node:test can run it.
 */
import type { ProjectsRequest } from './projects-api.ts'
import { isGuestUserId } from './sign-in.ts'
import type { Project } from '../types/projects.ts'

type Row = Record<string, any>

export type ProjectRole = 'owner' | 'member'

export interface ProjectMember {
  userId: string
  name: string
  /** Empty for a guest workspace's owner. */
  email: string
  role: ProjectRole
  /** When they joined (the owner: when the project began), or null when the API does not say. */
  joinedAt: number | null
}

/** The longest address the API accepts. */
export const EMAIL_MAX = 320
/** The API's plain check (it has no `EmailStr`): something@domain.tld, no spaces. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function mapMember(row: Row): ProjectMember {
  const email = typeof row.email === 'string' ? row.email.trim() : ''
  const joined = row.joined_at ? Date.parse(row.joined_at) : Number.NaN
  return {
    userId: String(row.user_id),
    // The API names people from their account; an address's local part is the fallback it uses too.
    name: String(row.name ?? '').trim() || email.split('@')[0] || 'Someone',
    email,
    role: row.role === 'owner' ? 'owner' : 'member',
    joinedAt: Number.isNaN(joined) ? null : joined,
  }
}

/** The owner first, then everyone else in the order they joined. */
export function orderMembers(members: ProjectMember[]): ProjectMember[] {
  return [...members].sort((a, b) =>
    Number(b.role === 'owner') - Number(a.role === 'owner')
    || (a.joinedAt ?? Number.POSITIVE_INFINITY) - (b.joinedAt ?? Number.POSITIVE_INFINITY)
    || a.name.localeCompare(b.name)
    || a.userId.localeCompare(b.userId))
}

/** `members` with `member` added, or replacing their earlier row (inviting someone twice answers their row again). */
export const withMember = (members: ProjectMember[], member: ProjectMember) =>
  orderMembers([...members.filter((item) => item.userId !== member.userId), member])

export const listMembers = async (request: ProjectsRequest, projectId: string) =>
  orderMembers((await request<Row[]>(`/${encodeURIComponent(projectId)}/members`)).map(mapMember))

/** Why `email` can't be invited, or null for a plain address the API will look up. */
export function emailProblem(email: string): string | null {
  const address = email.trim()
  if (!address) return 'Enter the email address of their Ren account.'
  if (address.length > EMAIL_MAX) return `An email address is at most ${EMAIL_MAX} characters.`
  if (!EMAIL_PATTERN.test(address)) return 'Enter a full email address, like name@example.com.'
  return null
}

/**
 * Invites the Ren account that uses `email` (owner only) and answers that person's row. The API says
 * "No Ren account uses …" (404) when nobody does, and refuses guests and non-owners (403).
 */
export async function inviteMember(request: ProjectsRequest, projectId: string, email: string): Promise<ProjectMember> {
  const problem = emailProblem(email)
  if (problem) throw Object.assign(new Error(problem), { status: 422 })
  return mapMember(await request<Row>(`/${encodeURIComponent(projectId)}/members`, 'POST', { email: email.trim() }))
}

/** The owner removes someone, or a member removes themselves (leaves the project). */
export async function removeMember(request: ProjectsRequest, projectId: string, userId: string): Promise<void> {
  const result = await request<{ deleted?: boolean }>(
    `/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, 'DELETE')
  if (result?.deleted !== true) throw new Error('The removal was not confirmed. Reload before trying again.')
}

/** Up to two initials from the first two words of a name ("Tim Hunter MS" → "TH", "tim.hunter" → "TH"). */
export function initials(name: string): string {
  const letters = name.split(/[\s._-]+/).map((word) => word.match(/[\p{L}\p{N}]/u)?.[0] ?? '').filter(Boolean)
  return letters.slice(0, 2).join('').toUpperCase() || '?'
}

/**
 * Whether `member` is the person looking. A guest's API identity is not their renderer `guest:` id,
 * and a guest is always the owner of their own workspace's projects.
 */
export function isCurrentMember(member: Pick<ProjectMember, 'userId' | 'role'>, userId: string | null): boolean {
  if (!userId) return false
  return isGuestUserId(userId) ? member.role === 'owner' : member.userId === userId
}

/** A project someone else owns that the signed-in user was invited to. A guest only has their own projects. */
export function isSharedProject(project: Pick<Project, 'ownerId'>, userId: string | null): boolean {
  return Boolean(userId && !isGuestUserId(userId) && project.ownerId && project.ownerId !== userId)
}
