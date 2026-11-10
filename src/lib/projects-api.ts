import { mapHistory, type ProjectHistory } from './agile-metrics.ts'

export type ProjectsRequest = <T>(path: string, method?: string, body?: unknown) => Promise<T>

/** No automatic retries: a lost write response does not mean the write failed. */
export function createProjectsRequest(
  baseUrl: string,
  getSession: () => Promise<{ user: { id: string }; access_token: string } | null>,
  userId: string,
  fetcher: typeof fetch = fetch,
): ProjectsRequest {
  return async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    const session = await getSession()
    const guest = userId.startsWith('guest:') && /^[a-f0-9]{64}$/.test(userId.slice(6))
    if (guest ? session !== null : !session || session.user.id !== userId)
      throw new Error('Session changed; reload Projects.')
    let response: Response
    try {
      response = await fetcher(`${baseUrl}/projects${path}`, {
        method,
        headers: { ...(guest ? { 'X-Ron-Workspace': userId.slice(6) } : { Authorization: `Bearer ${session!.access_token}` }), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      })
    } catch {
      throw new Error('Connection interrupted; no save was confirmed. Reload before retrying.')
    }
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = data?.detail
      const message = typeof detail === 'string' ? detail : Array.isArray(detail)
        ? detail.map((item: { msg: string }) => item.msg).join('; ') : `Project request failed (${response.status})`
      // `status` lets callers tell a version conflict (409) from other failures.
      throw Object.assign(new Error(message), { status: response.status })
    }
    if (data === null) throw new Error('No response was confirmed. Reload before retrying.')
    return data as T
  }
}

export async function allProjectPages<T>(request: ProjectsRequest, path: string): Promise<T[]> {
  const rows: T[] = []
  for (;;) {
    const page = await request<T[]>(`${path}${path.includes('?') ? '&' : '?'}offset=${rows.length}&limit=200`)
    rows.push(...page)
    if (page.length < 200) return rows
  }
}

/** One project's issue status/estimate/type transitions (`GET /projects/{id}/history`), for the dashboard. */
export async function fetchProjectHistory(request: ProjectsRequest, projectId: string): Promise<ProjectHistory> {
  return mapHistory(await request<Parameters<typeof mapHistory>[0]>(`/${encodeURIComponent(projectId)}/history`))
}
