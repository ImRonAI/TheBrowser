import { getSession } from '@/api/supabase'
import { guestWorkspace } from '@/lib/project-workspace'

/** A project agent, an issue chat, Ren's panel and the Context Agent act with the user's own project access: the same credential the Projects API uses. */
export async function projectAuthHeaders(): Promise<Record<string, string>> {
  const session = await getSession()
  return session ? { Authorization: `Bearer ${session.access_token}` } : { 'X-Ron-Workspace': guestWorkspace().token }
}
